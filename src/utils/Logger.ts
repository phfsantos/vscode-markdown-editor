/**
 * Production-safe logging utility
 * Logs to VS Code output channel, respecting debug mode setting
 */
import * as vscode from 'vscode';

class Logger {
  private static instance: Logger;
  private debugEnabled: boolean = false;
  private outputChannel: vscode.OutputChannel;

  private constructor() {
    // Create output channel for markdown editor logs
    this.outputChannel = vscode.window.createOutputChannel('Markdown Editor');
    this.updateConfig();
    
    // Listen for config changes
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('markdown-editor.enableDebugLogging')) {
        this.updateConfig();
      }
    });
  }

  private updateConfig(): void {
    const config = vscode.workspace.getConfiguration('markdown-editor');
    this.debugEnabled = config.get<boolean>('enableDebugLogging', false);
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private formatMessage(level: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    return `[${timestamp}] [${level}] ${message}`;
  }

  public debug(...args: any[]): void {
    if (this.debugEnabled) {
      this.outputChannel.appendLine(this.formatMessage('DEBUG', ...args));
    }
  }

  public info(...args: any[]): void {
    // Info messages always visible (not gated by debug setting)
    this.outputChannel.appendLine(this.formatMessage('INFO', ...args));
  }

  public warn(...args: any[]): void {
    if (this.debugEnabled) {
      this.outputChannel.appendLine(this.formatMessage('WARN', ...args));
    }
  }

  public error(...args: any[]): void {
    if (this.debugEnabled) {
      this.outputChannel.appendLine(this.formatMessage('ERROR', ...args));
    }
  }

  public show(): void {
    this.outputChannel.show();
  }

  public dispose(): void {
    this.outputChannel.dispose();
  }
}

export const logger = Logger.getInstance();
