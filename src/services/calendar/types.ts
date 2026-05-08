/**
 * Calendar API Types
 * 
 * Interfaces for calendar providers, events, and caching
 */

/**
 * Calendar event structure for display in widgets
 */
export interface CalendarEvent {
  /** Unique event ID from provider */
  id: string;
  /** Event subject/summary */
  title: string;
  /** Formatted display time (e.g., "9:00 AM - 10:00 AM") */
  time: string;
  /** ISO 8601 start datetime */
  startTime: string;
  /** ISO 8601 end datetime */
  endTime: string;
  /** Color name or hex */
  color?: string;
  /** Has video conference link */
  hasVideo?: boolean;
  /** Event web link or video URL */
  link?: string;
  /** Event location */
  location?: string;
  /** Event description (truncated) */
  description?: string;
  /** Provider identifier */
  source: 'google' | 'outlook';
  /** All-day event flag */
  allDay?: boolean;
  /** Event organizer email */
  organizer?: string;
}

/**
 * Calendar provider interface - implemented by each calendar API integration
 */
export interface CalendarProvider {
  /** Provider identifier */
  readonly id: 'google' | 'outlook';
  /** Display name for UI */
  readonly displayName: string;
  /** OAuth scopes required */
  readonly scopes: string[];
  
  /**
   * Authenticate with the provider
   * @returns true if authentication successful
   */
  authenticate(): Promise<boolean>;
  
  /**
   * Check if user is authenticated
   * @returns true if user has valid session
   */
  isAuthenticated(): Promise<boolean>;
  
  /**
   * Get events for a specific date
   * @param date - The date to fetch events for
   * @returns Array of calendar events
   */
  getEvents(date: Date): Promise<CalendarEvent[]>;
  
  /**
   * Sign out from the provider
   */
  signOut(): Promise<void>;
}

/**
 * Cached events with TTL
 */
export interface CachedEvents {
  /** Date in YYYY-MM-DD format */
  date: string;
  /** Provider identifier */
  provider: 'google' | 'outlook';
  /** Cached events */
  events: CalendarEvent[];
  /** Unix timestamp when fetched */
  fetchedAt: number;
  /** Unix timestamp when cache expires */
  expiresAt: number;
}

/**
 * Calendar service configuration
 */
export interface CalendarServiceConfig {
  /** Cache TTL in milliseconds (default: 5 minutes) */
  cacheTTL?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Authentication state for a provider
 */
export interface AuthState {
  /** Whether authenticated */
  authenticated: boolean;
  /** Account email if available */
  email?: string;
  /** Token expiry time */
  expiresAt?: number;
}

/**
 * Calendar request message from widget
 */
export interface CalendarRequestMessage {
  command: 'calendar-request';
  date: string;
  provider: 'google' | 'outlook';
  widgetId?: string;
  requestId?: string;
}

/**
 * Calendar auth message from widget
 */
export interface CalendarAuthMessage {
  command: 'calendar-auth';
  provider: 'google' | 'outlook';
  action?: 'signin' | 'signout';
}

/**
 * Calendar events response to widget
 */
export interface CalendarEventsResponse {
  command: 'calendar-events';
  action: 'set' | 'add' | 'remove' | 'clear';
  events: CalendarEvent[];
  date?: string;
  provider?: 'google' | 'outlook';
  widgetId?: string;
}
