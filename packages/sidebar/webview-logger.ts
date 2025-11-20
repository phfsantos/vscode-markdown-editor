/**
 * Webview logging utility for sidebar
 * Sends log messages to extension host for filtering based on debug settings
 */

declare const vscode: {
  postMessage(message: any): void;
};

/**
 * Send log message to extension host
 */
function sendLogToExtension(level: 'debug' | 'info' | 'warn' | 'error', ...args: any[]): void {
  if (typeof vscode !== 'undefined') {
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    
    vscode.postMessage({
      command: 'log',
      level: level,
      message: message
    });
  }
}

/**
 * Log info message (visible to users)
 */
export function vscodeLogInfo(...args: any[]): void {
  sendLogToExtension('info', ...args);
}

/**
 * Log warning message (respects debug setting)
 */
export function vscodeLogWarn(...args: any[]): void {
  sendLogToExtension('warn', ...args);
}

/**
 * Log error message (respects debug setting)
 */
export function vscodeLogError(...args: any[]): void {
  sendLogToExtension('error', ...args);
}

/**
 * Log debug message (only when debug logging enabled)
 */
export function vscodeLog(...args: any[]): void {
  sendLogToExtension('debug', ...args);
}
