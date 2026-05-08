/**
 * EventCache - LRU cache for calendar events with TTL
 * 
 * Caches fetched calendar events to reduce API calls
 * Default TTL: 5 minutes
 */

import type { CalendarEvent, CachedEvents } from './types';
import { logger } from '../../utils/Logger';

export class EventCache {
  private static _instance: EventCache | undefined;
  
  /** Cache storage: key = `${provider}-${YYYY-MM-DD}` */
  private _cache = new Map<string, CachedEvents>();
  
  /** Default cache TTL: 5 minutes */
  private readonly _defaultTTL = 5 * 60 * 1000;
  
  /** Maximum cache entries */
  private readonly _maxEntries = 100;
  
  private constructor() {
    logger.debug('📅 EventCache initialized');
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(): EventCache {
    if (!EventCache._instance) {
      EventCache._instance = new EventCache();
    }
    return EventCache._instance;
  }
  
  /**
   * Generate cache key for a date and provider
   */
  private _getCacheKey(provider: 'google' | 'outlook', date: Date): string {
    const dateStr = this._formatDate(date);
    return `${provider}-${dateStr}`;
  }
  
  /**
   * Format date as YYYY-MM-DD
   */
  private _formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
  
  /**
   * Get cached events if available and not expired
   */
  public get(provider: 'google' | 'outlook', date: Date): CalendarEvent[] | null {
    const key = this._getCacheKey(provider, date);
    const cached = this._cache.get(key);
    
    if (!cached) {
      logger.debug(`📅 Cache MISS: ${key}`);
      return null;
    }
    
    const now = Date.now();
    if (now > cached.expiresAt) {
      // Cache expired, remove it
      logger.debug(`📅 Cache EXPIRED: ${key}`);
      this._cache.delete(key);
      return null;
    }
    
    logger.debug(`📅 Cache HIT: ${key} (${cached.events.length} events)`);
    return cached.events;
  }
  
  /**
   * Store events in cache
   */
  public set(
    provider: 'google' | 'outlook', 
    date: Date, 
    events: CalendarEvent[],
    ttl?: number
  ): void {
    const key = this._getCacheKey(provider, date);
    const now = Date.now();
    const cacheTTL = ttl ?? this._defaultTTL;
    
    // Enforce max entries using LRU eviction
    if (this._cache.size >= this._maxEntries) {
      this._evictOldest();
    }
    
    const cached: CachedEvents = {
      date: this._formatDate(date),
      provider,
      events,
      fetchedAt: now,
      expiresAt: now + cacheTTL,
    };
    
    this._cache.set(key, cached);
    logger.debug(`📅 Cache SET: ${key} (${events.length} events, TTL: ${cacheTTL}ms)`);
  }
  
  /**
   * Invalidate cache for a specific date/provider
   */
  public invalidate(provider: 'google' | 'outlook', date: Date): void {
    const key = this._getCacheKey(provider, date);
    if (this._cache.has(key)) {
      this._cache.delete(key);
      logger.debug(`📅 Cache INVALIDATED: ${key}`);
    }
  }
  
  /**
   * Invalidate all cache for a provider
   */
  public invalidateProvider(provider: 'google' | 'outlook'): void {
    let count = 0;
    for (const key of this._cache.keys()) {
      if (key.startsWith(`${provider}-`)) {
        this._cache.delete(key);
        count++;
      }
    }
    logger.debug(`📅 Cache CLEARED for ${provider}: ${count} entries removed`);
  }
  
  /**
   * Clear all cache
   */
  public clear(): void {
    const count = this._cache.size;
    this._cache.clear();
    logger.debug(`📅 Cache CLEARED: ${count} entries removed`);
  }
  
  /**
   * Get cache statistics
   */
  public getStats(): { 
    size: number; 
    providers: Record<string, number>;
    oldestEntry?: Date;
    newestEntry?: Date;
  } {
    const providers: Record<string, number> = { google: 0, outlook: 0 };
    let oldest: number | undefined;
    let newest: number | undefined;
    
    for (const cached of this._cache.values()) {
      providers[cached.provider]++;
      if (!oldest || cached.fetchedAt < oldest) oldest = cached.fetchedAt;
      if (!newest || cached.fetchedAt > newest) newest = cached.fetchedAt;
    }
    
    return {
      size: this._cache.size,
      providers,
      oldestEntry: oldest ? new Date(oldest) : undefined,
      newestEntry: newest ? new Date(newest) : undefined,
    };
  }
  
  /**
   * Evict oldest entries when cache is full
   */
  private _evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;
    
    for (const [key, cached] of this._cache) {
      if (cached.fetchedAt < oldestTime) {
        oldestTime = cached.fetchedAt;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this._cache.delete(oldestKey);
      logger.debug(`📅 Cache EVICTED (LRU): ${oldestKey}`);
    }
  }
  
  /**
   * Clean up expired entries (can be called periodically)
   */
  public cleanup(): number {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, cached] of this._cache) {
      if (now > cached.expiresAt) {
        this._cache.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      logger.debug(`📅 Cache CLEANUP: ${removed} expired entries removed`);
    }
    
    return removed;
  }
}
