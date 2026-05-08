/**
 * CalendarService - Main calendar service for managing calendar providers
 * 
 * Provides a unified API for calendar operations across different providers
 * (Google Calendar, Microsoft Outlook) with caching support.
 */

import * as vscode from 'vscode';
import type { CalendarProvider, CalendarEvent, CalendarServiceConfig, AuthState } from './types';
import { OutlookCalendarProvider } from './OutlookCalendarProvider';
import { GoogleCalendarProvider } from './GoogleCalendarProvider';
import { EventCache } from './EventCache';
import { logger } from '../../utils/Logger';

export class CalendarService {
  private static _instance: CalendarService | undefined;
  
  private readonly _providers = new Map<string, CalendarProvider>();
  private readonly _cache: EventCache;
  private readonly _config: CalendarServiceConfig;
  private _context: vscode.ExtensionContext | undefined;
  
  private constructor(config: CalendarServiceConfig = {}) {
    this._config = {
      cacheTTL: config.cacheTTL ?? 5 * 60 * 1000, // 5 minutes default
      debug: config.debug ?? false,
    };
    
    this._cache = EventCache.getInstance();
    
    // Register built-in providers
    this._registerBuiltInProviders();
    
    logger.debug('📅 CalendarService initialized');
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config?: CalendarServiceConfig): CalendarService {
    if (!CalendarService._instance) {
      CalendarService._instance = new CalendarService(config);
    }
    return CalendarService._instance;
  }
  
  /**
   * Initialize the service with extension context
   * Required for providers that need secure storage
   */
  public initialize(context: vscode.ExtensionContext): void {
    this._context = context;
    
    // Initialize providers that need context
    const outlook = this._providers.get('outlook') as OutlookCalendarProvider | undefined;
    if (outlook && 'initialize' in outlook) {
      outlook.initialize(context);
    }
    
    const google = this._providers.get('google') as GoogleCalendarProvider | undefined;
    if (google && 'initialize' in google) {
      google.initialize(context);
    }
    
    logger.debug('📅 CalendarService context initialized');
  }
  
  /**
   * Register built-in calendar providers
   */
  private _registerBuiltInProviders(): void {
    // Register Outlook (Microsoft Graph)
    const outlook = new OutlookCalendarProvider();
    this._providers.set(outlook.id, outlook);
    
    // Register Google Calendar
    const google = new GoogleCalendarProvider();
    this._providers.set(google.id, google);
    
    logger.debug(`📅 Registered ${this._providers.size} calendar providers`);
  }
  
  /**
   * Get a calendar provider by ID
   */
  public getProvider(providerId: 'google' | 'outlook'): CalendarProvider | undefined {
    return this._providers.get(providerId);
  }
  
  /**
   * Get all available providers
   */
  public getProviders(): CalendarProvider[] {
    return Array.from(this._providers.values());
  }
  
  /**
   * Authenticate with a specific provider
   */
  public async authenticate(providerId: 'google' | 'outlook'): Promise<boolean> {
    const provider = this._providers.get(providerId);
    if (!provider) {
      logger.error(`📅 Unknown provider: ${providerId}`);
      return false;
    }
    
    try {
      const success = await provider.authenticate();
      if (success) {
        logger.debug(`📅 Authentication successful for ${provider.displayName}`);
      }
      return success;
    } catch (error) {
      logger.error(`📅 Authentication failed for ${providerId}`, error);
      return false;
    }
  }
  
  /**
   * Check if authenticated with a provider
   */
  public async isAuthenticated(providerId: 'google' | 'outlook'): Promise<boolean> {
    const provider = this._providers.get(providerId);
    if (!provider) {
      return false;
    }
    return provider.isAuthenticated();
  }
  
  /**
   * Get auth state for all providers
   */
  public async getAuthStates(): Promise<Record<string, AuthState>> {
    const states: Record<string, AuthState> = {};
    
    for (const [id, provider] of this._providers) {
      const authenticated = await provider.isAuthenticated();
      states[id] = {
        authenticated,
        // Email would require additional API call, omit for now
      };
    }
    
    return states;
  }
  
  /**
   * Get events for a specific date from a provider
   * Uses cache when available
   */
  public async getEvents(
    providerId: 'google' | 'outlook', 
    date: Date
  ): Promise<CalendarEvent[]> {
    const provider = this._providers.get(providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    
    // Check cache first
    const cachedEvents = this._cache.get(providerId, date);
    if (cachedEvents) {
      logger.debug(`📅 Using cached events for ${providerId} on ${date.toDateString()}`);
      return cachedEvents;
    }
    
    // Fetch from provider
    logger.debug(`📅 Fetching events from ${provider.displayName} for ${date.toDateString()}`);
    
    const events = await provider.getEvents(date);
    
    // Cache the results
    this._cache.set(providerId, date, events, this._config.cacheTTL);
    
    return events;
  }
  
  /**
   * Get events from all authenticated providers
   */
  public async getEventsFromAll(date: Date): Promise<CalendarEvent[]> {
    const allEvents: CalendarEvent[] = [];
    
    for (const [id, provider] of this._providers) {
      try {
        const authenticated = await provider.isAuthenticated();
        if (authenticated) {
          const events = await this.getEvents(id as 'google' | 'outlook', date);
          allEvents.push(...events);
        }
      } catch (error) {
        logger.warn(`📅 Failed to get events from ${id}:`, error);
      }
    }
    
    // Sort by start time
    allEvents.sort((a, b) => {
      const aTime = new Date(a.startTime).getTime();
      const bTime = new Date(b.startTime).getTime();
      return aTime - bTime;
    });
    
    return allEvents;
  }
  
  /**
   * Sign out from a provider
   */
  public async signOut(providerId: 'google' | 'outlook'): Promise<void> {
    const provider = this._providers.get(providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    
    await provider.signOut();
    
    // Clear cache for this provider
    this._cache.invalidateProvider(providerId);
  }
  
  /**
   * Invalidate cache for a specific date/provider
   */
  public invalidateCache(providerId: 'google' | 'outlook', date: Date): void {
    this._cache.invalidate(providerId, date);
  }
  
  /**
   * Clear all cache
   */
  public clearCache(): void {
    this._cache.clear();
  }
  
  /**
   * Get cache statistics
   */
  public getCacheStats() {
    return this._cache.getStats();
  }
}

// Re-export types for convenience
export * from './types';
export { OutlookCalendarProvider } from './OutlookCalendarProvider';
export { GoogleCalendarProvider, GOOGLE_CALENDAR_AUTH_PROVIDER_ID } from './GoogleCalendarProvider';
export { EventCache } from './EventCache';
