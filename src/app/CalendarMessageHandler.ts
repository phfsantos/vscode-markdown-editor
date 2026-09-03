import { logger } from "../utils/Logger";
import { CalendarService } from "../services";

/**
 * Webview message handlers for calendar widgets (auth, event requests,
 * sign-out). Extracted from EditorPanel; responses go back through the
 * injected postMessage.
 */
export class CalendarMessageHandler {
  constructor(private readonly postMessage: (message: unknown) => void) {}

  /**
   * Handle calendar authentication requests from widget
   */
  public async handleCalendarAuth(message: any): Promise<void> {
    const { provider, requestId } = message;
    
    try {
      logger.debug(`[EditorPanel] Calendar auth request for provider: ${provider}`);
      
      const calendarService = CalendarService.getInstance();
      const success = await calendarService.authenticate(provider);
      
      // Send auth result back to webview
      this.postMessage({
        command: "calendar-auth-result",
        requestId,
        provider,
        success,
      });
      
      // If auth succeeded, automatically fetch events for today
      if (success) {
        try {
          const today = new Date();
          logger.debug(`[EditorPanel] Auto-fetching events for ${provider} after successful auth`);
          const events = await calendarService.getEvents(provider, today);
          logger.debug(`[EditorPanel] Fetched ${events?.length || 0} events after auth`);
          
          this.postMessage({
            command: "calendar-events",
            requestId, // Include requestId so only the widget that initiated auth receives events
            provider,
            date: today.toISOString().split('T')[0],
            events,
          });
        } catch (fetchError) {
          // Don't fail the auth if event fetch fails - just log it
          logger.error(`[EditorPanel] Failed to auto-fetch events after auth:`, fetchError);
          this.postMessage({
            command: "calendar-error",
            requestId, // Include requestId so only the widget that initiated auth sees the error
            provider,
            error: fetchError instanceof Error ? fetchError.message : String(fetchError),
          });
        }
      }
    } catch (error) {
      logger.error(`[EditorPanel] Calendar auth failed:`, error);
      
      this.postMessage({
        command: "calendar-auth-result",
        requestId,
        provider,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle calendar events request from widget
   */
  public async handleCalendarRequest(message: any): Promise<void> {
    const { provider, date, requestId } = message;
    
    try {
      logger.debug(`[EditorPanel] Calendar request for ${provider} on ${date}`);
      
      // Send loading state
      this.postMessage({
        command: "calendar-loading",
        requestId,
        provider,
        date,
        loading: true,
      });
      
      const calendarService = CalendarService.getInstance();
      
      // Parse date string (YYYY-MM-DD) as local date, not UTC
      // new Date('2025-12-10') would parse as UTC midnight, causing timezone issues
      const [year, month, day] = date.split('-').map(Number);
      const dateObj = new Date(year, month - 1, day); // month is 0-indexed
      
      logger.debug(`[EditorPanel] Parsed date: ${dateObj.toDateString()}`);
      
      // Fetch events from specified provider or all providers
      let events;
      if (provider === 'all') {
        events = await calendarService.getEventsFromAll(dateObj);
      } else {
        events = await calendarService.getEvents(provider, dateObj);
      }
      
      // Send events back to webview
      this.postMessage({
        command: "calendar-events",
        requestId,
        provider,
        date,
        events,
      });
    } catch (error) {
      logger.error(`[EditorPanel] Calendar request failed:`, error);
      
      this.postMessage({
        command: "calendar-error",
        requestId,
        provider,
        date,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle calendar sign out from widget
   */
  public async handleCalendarSignOut(message: any): Promise<void> {
    const { provider, requestId } = message;
    
    try {
      logger.debug(`[EditorPanel] Calendar sign out for provider: ${provider}`);
      
      const calendarService = CalendarService.getInstance();
      await calendarService.signOut(provider);
      
      // Send sign out confirmation back to webview
      this.postMessage({
        command: "calendar-signout-result",
        requestId,
        provider,
        success: true,
      });
    } catch (error) {
      logger.error(`[EditorPanel] Calendar sign out failed:`, error);
      
      this.postMessage({
        command: "calendar-signout-result",
        requestId,
        provider,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
