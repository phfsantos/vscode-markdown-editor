import { IDataSource } from './types';

export declare class DataProvider {
    private static instance;
    private cache;
    private pendingRequests;
    private vscode;
    private constructor();
    /**
     * Get singleton instance
     */
    static getInstance(): DataProvider;
    /**
     * Initialize VSCode API
     */
    private initializeVSCode;
    /**
     * Fetch data from a data source
     */
    fetchData(source: IDataSource, params?: Record<string, any>): Promise<any>;
    /**
     * Make the actual request based on source type
     */
    private makeRequest;
    /**
     * Fetch from REST API
     */
    private fetchFromAPI;
    /**
     * Fetch from file system (via VSCode)
     */
    private fetchFromFile;
    /**
     * Fetch static data
     */
    private fetchStatic;
    /**
     * Fetch from widget
     */
    private fetchFromWidget;
    /**
     * Fetch computed data
     */
    private fetchComputed;
    /**
     * Apply transform expression to data
     */
    private applyTransform;
    /**
     * Generate cache key
     */
    private getCacheKey;
    /**
     * Get from cache
     */
    private getFromCache;
    /**
     * Set cache
     */
    private setCache;
    /**
     * Clear cache
     */
    clearCache(pattern?: string): void;
    /**
     * Invalidate specific cache entry
     */
    invalidate(source: IDataSource, params?: Record<string, any>): void;
    /**
     * Prefetch data
     */
    prefetch(source: IDataSource, params?: Record<string, any>): Promise<void>;
    /**
     * Get cache stats
     */
    getCacheStats(): {
        size: number;
        entries: string[];
        pendingRequests: number;
    };
}
//# sourceMappingURL=DataProvider.d.ts.map