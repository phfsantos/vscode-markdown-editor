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

export class ScriptExecutor {
  private static instance: ScriptExecutor;
  private readonly DEFAULT_TIMEOUT = 5000; // 5 seconds
  private readonly MAX_TIMEOUT = 30000; // 30 seconds
  
  private constructor() {}
  
  /**
   * Get singleton instance
   */
  static getInstance(): ScriptExecutor {
    if (!ScriptExecutor.instance) {
      ScriptExecutor.instance = new ScriptExecutor();
    }
    return ScriptExecutor.instance;
  }
  
  /**
   * Execute script with context
   */
  async execute(
    script: string,
    context: ScriptContext = {},
    timeout: number = this.DEFAULT_TIMEOUT
  ): Promise<ScriptResult> {
    const startTime = performance.now();
    
    // Validate timeout
    const safeTimeout = Math.min(timeout, this.MAX_TIMEOUT);
    
    try {
      // Sanitize script
      const sanitizedScript = this.sanitizeScript(script);
      
      // Build sandbox context
      const sandboxContext = this.buildSandboxContext(context);
      
      // Execute with timeout
      const result = await this.executeWithTimeout(
        sanitizedScript,
        sandboxContext,
        safeTimeout
      );
      
      const executionTime = performance.now() - startTime;
      
      console.log(`[ScriptExecutor] Executed in ${executionTime.toFixed(2)}ms`);
      
      return {
        success: true,
        result,
        executionTime
      };
    } catch (error) {
      const executionTime = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      console.error('[ScriptExecutor] Execution error:', errorMessage);
      
      return {
        success: false,
        error: errorMessage,
        executionTime
      };
    }
  }
  
  /**
   * Execute script synchronously (use with caution)
   */
  executeSync(script: string, context: ScriptContext = {}): ScriptResult {
    const startTime = performance.now();
    
    try {
      const sanitizedScript = this.sanitizeScript(script);
      const sandboxContext = this.buildSandboxContext(context);
      
      const result = this.executeSyncInternal(sanitizedScript, sandboxContext);
      
      const executionTime = performance.now() - startTime;
      
      return {
        success: true,
        result,
        executionTime
      };
    } catch (error) {
      const executionTime = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      return {
        success: false,
        error: errorMessage,
        executionTime
      };
    }
  }
  
  /**
   * Sanitize script (basic checks)
   */
  private sanitizeScript(script: string): string {
    // Remove dangerous patterns
    const dangerous = [
      /eval\s*\(/gi,
      /Function\s*\(/gi,
      /setTimeout\s*\(/gi,
      /setInterval\s*\(/gi,
      /\bimport\s+/gi,
      /\brequire\s*\(/gi
    ];
    
    for (const pattern of dangerous) {
      if (pattern.test(script)) {
        throw new Error(`Script contains forbidden pattern: ${pattern.source}`);
      }
    }
    
    return script.trim();
  }
  
  /**
   * Build sandbox context with safe API
   */
  private buildSandboxContext(context: ScriptContext): any {
    // Provide safe APIs
    const safeContext = {
      // User context
      ...context,
      
      // Safe built-ins
      console: {
        log: (...args: any[]) => console.log('[Widget Script]', ...args),
        warn: (...args: any[]) => console.warn('[Widget Script]', ...args),
        error: (...args: any[]) => console.error('[Widget Script]', ...args)
      },
      
      // Safe utilities
      JSON: JSON,
      Math: Math,
      Date: Date,
      String: String,
      Number: Number,
      Boolean: Boolean,
      Array: Array,
      Object: Object,
      
      // Async support
      Promise: Promise,
      
      // Helper functions
      fetch: this.createSafeFetch(),
      
      // Prevent access to dangerous globals
      window: undefined,
      document: undefined,
      globalThis: undefined,
      self: undefined,
      parent: undefined,
      top: undefined,
      frames: undefined
    };
    
    return safeContext;
  }
  
  /**
   * Create safe fetch function
   */
  private createSafeFetch() {
    return async (url: string, options?: RequestInit) => {
      // Only allow specific domains (can be configured)
      try {
        const urlObj = new URL(url);
        
        // Block localhost and private IPs
        if (
          urlObj.hostname === 'localhost' ||
          urlObj.hostname === '127.0.0.1' ||
          urlObj.hostname.startsWith('192.168.') ||
          urlObj.hostname.startsWith('10.') ||
          urlObj.hostname.startsWith('172.')
        ) {
          throw new Error('Access to local/private networks is not allowed');
        }
        
        // Make request with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        try {
          const response = await fetch(url, {
            ...options,
            signal: controller.signal
          });
          
          return response;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        throw new Error(`Fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };
  }
  
  /**
   * Execute with timeout
   */
  private async executeWithTimeout(
    script: string,
    context: any,
    timeout: number
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Script execution timeout (${timeout}ms)`));
      }, timeout);
      
      try {
        // Create function with context as parameters
        const contextKeys = Object.keys(context);
        const contextValues = contextKeys.map(key => context[key]);
        
        // Wrap in async function to support await
        const func = new Function(
          ...contextKeys,
          `return (async () => { ${script} })();`
        );
        
        // Execute
        const result = func(...contextValues);
        
        // Handle promises
        if (result && typeof result.then === 'function') {
          result
            .then((value: any) => {
              clearTimeout(timeoutId);
              resolve(value);
            })
            .catch((error: any) => {
              clearTimeout(timeoutId);
              reject(error);
            });
        } else {
          clearTimeout(timeoutId);
          resolve(result);
        }
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }
  
  /**
   * Execute synchronously (internal)
   */
  private executeSyncInternal(script: string, context: any): any {
    const contextKeys = Object.keys(context);
    const contextValues = contextKeys.map(key => context[key]);
    
    const func = new Function(...contextKeys, script);
    
    return func(...contextValues);
  }
  
  /**
   * Validate script syntax
   */
  validateSyntax(script: string): { valid: boolean; error?: string } {
    try {
      new Function(script);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Syntax error'
      };
    }
  }
  
  /**
   * Test script execution
   */
  async test(script: string, testContext: ScriptContext = {}): Promise<{
    passed: boolean;
    result?: ScriptResult;
    error?: string;
  }> {
    try {
      const result = await this.execute(script, testContext);
      return {
        passed: result.success,
        result
      };
    } catch (error) {
      return {
        passed: false,
        error: error instanceof Error ? error.message : 'Test failed'
      };
    }
  }
  
  /**
   * Create a reusable script function
   */
  createFunction(script: string, paramNames: string[] = []): (...args: any[]) => Promise<any> {
    return async (...args: any[]) => {
      const context: ScriptContext = {};
      
      // Map arguments to parameter names
      paramNames.forEach((name, index) => {
        context[name] = args[index];
      });
      
      const result = await this.execute(script, context);
      
      if (!result.success) {
        throw new Error(result.error);
      }
      
      return result.result;
    };
  }
  
  /**
   * Get execution stats
   */
  getStats(): {
    defaultTimeout: number;
    maxTimeout: number;
  } {
    return {
      defaultTimeout: this.DEFAULT_TIMEOUT,
      maxTimeout: this.MAX_TIMEOUT
    };
  }
}
