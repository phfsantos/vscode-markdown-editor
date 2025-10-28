/**
 * Webview Logger - Production-safe logging for webview context
 * 
 * Sends log messages to the extension host via postMessage.
 * The extension host respects the markdown-editor.enableDebugLogging setting.
 * 
 * By default, debug/info logs are OFF in production.
 * Error and warning logs are always sent but can be filtered by extension host.
 */

declare const vscode: any;

/**
 * Send a log message to the extension host
 * The extension host will filter based on markdown-editor.enableDebugLogging setting
 */
function sendLogToExtension(level: 'debug' | 'info' | 'warn' | 'error', ...args: any[]): void {
  if (typeof vscode !== 'undefined') {
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    
    vscode.postMessage({
      command: 'log',
      level: level,
      message: message
    });
  }
}

/**
 * Log a debug message (respects enableDebugLogging setting)
 */
export function vscodeLog(message: string): void {
  sendLogToExtension('debug', message);
}

/**
 * Log an info message (respects enableDebugLogging setting)
 */
export function vscodeLogInfo(...args: any[]): void {
  sendLogToExtension('info', ...args);
}

/**
 * Log a warning message (respects enableDebugLogging setting)
 */
export function vscodeLogWarn(...args: any[]): void {
  sendLogToExtension('warn', ...args);
}

/**
 * Log an error message (respects enableDebugLogging setting)
 */
export function vscodeLogError(...args: any[]): void {
  sendLogToExtension('error', ...args);
}

// Legacy export for backward compatibility
export { vscodeLog as default };
