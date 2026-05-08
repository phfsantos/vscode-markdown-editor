/**
 * ScriptExecutor - Sandboxed JavaScript execution for widget actions
 *
 * Executes user-defined JavaScript in a controlled environment with:
 * - Timeout protection
 * - Limited API access
 * - Error handling
 * - Context isolation
 */
export interface ScriptContext {
    widget?: any;
    data?: any;
    event?: any;
    vscode?: any;
    [key: string]: any;
}
export interface ScriptResult {
    success: boolean;
    result?: any;
    error?: string;
    executionTime: number;
}
export declare class ScriptExecutor {
    private static instance;
    private readonly DEFAULT_TIMEOUT;
    private readonly MAX_TIMEOUT;
    private constructor();
    /**
     * Get singleton instance
     */
    static getInstance(): ScriptExecutor;
    /**
     * Execute script with context
     */
    execute(script: string, context?: ScriptContext, timeout?: number): Promise<ScriptResult>;
    /**
     * Execute script synchronously (use with caution)
     */
    executeSync(script: string, context?: ScriptContext): ScriptResult;
    /**
     * Sanitize script (basic checks)
     */
    private sanitizeScript;
    /**
     * Build sandbox context with safe API
     */
    private buildSandboxContext;
    /**
     * Create safe fetch function
     */
    private createSafeFetch;
    /**
     * Execute with timeout
     */
    private executeWithTimeout;
    /**
     * Execute synchronously (internal)
     */
    private executeSyncInternal;
    /**
     * Validate script syntax
     */
    validateSyntax(script: string): {
        valid: boolean;
        error?: string;
    };
    /**
     * Test script execution
     */
    test(script: string, testContext?: ScriptContext): Promise<{
        passed: boolean;
        result?: ScriptResult;
        error?: string;
    }>;
    /**
     * Create a reusable script function
     */
    createFunction(script: string, paramNames?: string[]): (...args: any[]) => Promise<any>;
    /**
     * Get execution stats
     */
    getStats(): {
        defaultTimeout: number;
        maxTimeout: number;
    };
}
//# sourceMappingURL=ScriptExecutor.d.ts.map