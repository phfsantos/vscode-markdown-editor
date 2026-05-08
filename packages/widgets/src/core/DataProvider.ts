/**
 * DataProvider - Multi-source data fetching and caching
 * 
 * Handles data fetching from various sources: REST APIs, file system, inline JSON.
 * Provides caching, error handling, and request deduplication.
 */

import type { IDataSource } from './types';

interface CacheEntry {
  data: any;
  timestamp: number;
  expiresAt: number;
}

export class DataProvider {
  private static instance: DataProvider;
  private cache: Map<string, CacheEntry> = new Map();
  private pendingRequests: Map<string, Promise<any>> = new Map();
  private vscode: any = null;
  
  private constructor() {
    this.initializeVSCode();
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(): DataProvider {
    if (!DataProvider.instance) {
      DataProvider.instance = new DataProvider();
    }
    return DataProvider.instance;
  }
  
  /**
   * Initialize VSCode API
   */
  private initializeVSCode(): void {
    if (typeof window !== 'undefined' && (window as any).acquireVsCodeApi) {
      this.vscode = (window as any).acquireVsCodeApi();
    }
  }
  
  /**
   * Fetch data from a data source
   */
  async fetchData(source: IDataSource, params?: Record<string, any>): Promise<any> {
    const cacheKey = this.getCacheKey(source, params);
    
    // Check cache first (default 5 minutes)
    const cached = this.getFromCache(cacheKey, 300000);
    if (cached !== null) {
      console.log(`[DataProvider] Cache hit for ${cacheKey}`);
      return cached;
    }
    
    // Check for pending request (deduplication)
    if (this.pendingRequests.has(cacheKey)) {
      console.log(`[DataProvider] Deduplicating request for ${cacheKey}`);
      return this.pendingRequests.get(cacheKey);
    }
    
    // Make new request
    const requestPromise = this.makeRequest(source, params);
    this.pendingRequests.set(cacheKey, requestPromise);
    
    try {
      const data = await requestPromise;
      
      // Cache result (5 minutes)
      this.setCache(cacheKey, data, 300000);
      
      return data;
    } finally {
      this.pendingRequests.delete(cacheKey);
    }
  }
  
  /**
   * Make the actual request based on source type
   */
  private async makeRequest(source: IDataSource, params?: Record<string, any>): Promise<any> {
    switch (source.type) {
      case 'api':
        return this.fetchFromAPI(source, params);
      
      case 'file':
        return this.fetchFromFile(source);
      
      case 'static':
        return this.fetchStatic(source);
      
      case 'widget':
        return this.fetchFromWidget(source);
      
      case 'computed':
        return this.fetchComputed(source);
      
      default:
        throw new Error(`Unknown data source type: ${source.type}`);
    }
  }
  
  /**
   * Fetch from REST API
   */
  private async fetchFromAPI(source: IDataSource, params?: Record<string, any>): Promise<any> {
    if (!source.config.url) {
      throw new Error('API source requires url');
    }
    
    // Build URL with params
    let url = source.config.url;
    if (params) {
      const urlParams = new URLSearchParams(params);
      url += (url.includes('?') ? '&' : '?') + urlParams.toString();
    }
    
    // Build headers
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...source.config.headers
    };
    
    // Make request
    console.log(`[DataProvider] Fetching from API: ${url}`);
    
    const response = await fetch(url, {
      method: source.config.method || 'GET',
      headers,
      body: source.config.body ? JSON.stringify(source.config.body) : undefined
    });
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Apply transform if provided
    return source.config.transform ? this.applyTransform(data, source.config.transform) : data;
  }
  
  /**
   * Fetch from file system (via VSCode)
   */
  private async fetchFromFile(source: IDataSource): Promise<any> {
    if (!source.config.path) {
      throw new Error('File source requires path');
    }
    
    if (!this.vscode) {
      throw new Error('VSCode API not available');
    }
    
    console.log(`[DataProvider] Fetching from file: ${source.config.path}`);
    
    // Request file content from VSCode extension
    return new Promise((resolve, reject) => {
      const messageId = `file-${Date.now()}-${Math.random()}`;
      
      const handleMessage = (event: MessageEvent) => {
        const message = event.data;
        if (message.id === messageId) {
          window.removeEventListener('message', handleMessage);
          
          if (message.error) {
            reject(new Error(message.error));
          } else {
            let data = message.data;
            
            // Parse if JSON
            if (typeof data === 'string' && source.config.format === 'json') {
              try {
                data = JSON.parse(data);
              } catch (e) {
                console.warn('[DataProvider] Failed to parse JSON file:', e);
              }
            }
            
            // Apply transform
            data = source.config.transform ? this.applyTransform(data, source.config.transform) : data;
            
            resolve(data);
          }
        }
      };
      
      window.addEventListener('message', handleMessage);
      
      this.vscode.postMessage({
        type: 'read-file',
        id: messageId,
        path: source.config.path
      });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        window.removeEventListener('message', handleMessage);
        reject(new Error('File read timeout'));
      }, 30000);
    });
  }
  
  /**
   * Fetch static data
   */
  private async fetchStatic(source: IDataSource): Promise<any> {
    if (!source.config.data) {
      throw new Error('Static source requires data');
    }
    
    console.log('[DataProvider] Using static data');
    
    // Clone to avoid mutation
    const data = JSON.parse(JSON.stringify(source.config.data));
    
    // Apply transform if provided
    return source.config.transform ? this.applyTransform(data, source.config.transform) : data;
  }
  
  /**
   * Fetch from widget
   */
  private async fetchFromWidget(source: IDataSource): Promise<any> {
    if (!source.config.widgetId) {
      throw new Error('Widget source requires widgetId');
    }
    
    console.log(`[DataProvider] Fetching from widget: ${source.config.widgetId}`);
    
    // This would need to integrate with WidgetBus
    // For now, return empty
    return {};
  }
  
  /**
   * Fetch computed data
   */
  private async fetchComputed(source: IDataSource): Promise<any> {
    if (!source.config.expression) {
      throw new Error('Computed source requires expression');
    }
    
    console.log('[DataProvider] Computing data');
    
    // Execute expression
    return this.applyTransform({}, source.config.expression);
  }
  
  /**
   * Apply transform expression to data
   */
  private applyTransform(data: any, transform: string): any {
    try {
      const func = new Function('data', `return ${transform}`);
      return func(data);
    } catch (error) {
      console.error('[DataProvider] Transform error:', error);
      return data;
    }
  }
  
  /**
   * Generate cache key
   */
  private getCacheKey(source: IDataSource, params?: Record<string, any>): string {
    const base = `${source.type}:${source.config.url || source.config.path || 'inline'}`;
    const paramsKey = params ? `:${JSON.stringify(params)}` : '';
    return base + paramsKey;
  }
  
  /**
   * Get from cache
   */
  private getFromCache(key: string, _ttl: number): any | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }
    
    const now = Date.now();
    if (now > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }
  
  /**
   * Set cache
   */
  private setCache(key: string, data: any, ttl: number): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + ttl
    });
  }
  
  /**
   * Clear cache
   */
  clearCache(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      console.log('[DataProvider] Cache cleared');
      return;
    }
    
    const regex = new RegExp(pattern);
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
    
    console.log(`[DataProvider] Cache cleared for pattern: ${pattern}`);
  }
  
  /**
   * Invalidate specific cache entry
   */
  invalidate(source: IDataSource, params?: Record<string, any>): void {
    const key = this.getCacheKey(source, params);
    this.cache.delete(key);
    console.log(`[DataProvider] Invalidated cache: ${key}`);
  }
  
  /**
   * Prefetch data
   */
  async prefetch(source: IDataSource, params?: Record<string, any>): Promise<void> {
    try {
      await this.fetchData(source, params);
      console.log('[DataProvider] Prefetch completed');
    } catch (error) {
      console.error('[DataProvider] Prefetch failed:', error);
    }
  }
  
  /**
   * Get cache stats
   */
  getCacheStats(): {
    size: number;
    entries: string[];
    pendingRequests: number;
  } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
      pendingRequests: this.pendingRequests.size
    };
  }
}
