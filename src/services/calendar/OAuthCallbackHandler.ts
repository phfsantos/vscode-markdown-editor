/**
 * OAuthCallbackHandler - Handles OAuth callbacks via VS Code URI handler
 * 
 * Uses {uriScheme}://phfsantos.markdown-editor/oauth/callback?code=xxx&state=yyy
 * where uriScheme is 'vscode' or 'vscode-insiders' depending on the VS Code version
 * This allows the browser to redirect back to VS Code after OAuth
 */

import * as vscode from 'vscode';
import { logger } from '../../utils/Logger';

/**
 * Get the OAuth redirect URI for the current VS Code instance
 * Dynamically uses vscode:// or vscode-insiders:// based on the running instance
 */
export function getOAuthRedirectUri(): string {
  // vscode.env.uriScheme returns 'vscode', 'vscode-insiders', 'code-oss', etc.
  return `${vscode.env.uriScheme}://phfsantos.markdown-editor/oauth/callback`;
}

// Pending OAuth requests waiting for callbacks
interface PendingAuth {
  state: string;
  provider: 'outlook' | 'google';
  codeVerifier: string;
  resolve: (code: string | null) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

class OAuthCallbackHandlerImpl implements vscode.UriHandler {
  private _pendingAuths = new Map<string, PendingAuth>();
  private _isRegistered = false;
  
  /**
   * Register this handler with VS Code
   */
  public register(context: vscode.ExtensionContext): void {
    if (this._isRegistered) return;
    
    context.subscriptions.push(
      vscode.window.registerUriHandler(this)
    );
    
    this._isRegistered = true;
    logger.debug('📅 OAuth: URI handler registered');
  }
  
  /**
   * Handle incoming URI from browser redirect
   */
  public handleUri(uri: vscode.Uri): void {
    logger.debug(`📅 OAuth: Received callback URI: ${uri.toString()}`);
    
    // Parse query parameters
    const params = new URLSearchParams(uri.query);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');
    const errorDescription = params.get('error_description');
    
    // Handle Google success/error notifications (no code/state, just success indicator)
    const provider = params.get('provider');
    const success = params.get('success');
    if (provider === 'google') {
      if (success === 'true') {
        logger.debug('📅 OAuth: Google authentication completed successfully');
        // Just a notification redirect, no action needed - the local server already handled the code
      } else if (error) {
        logger.error(`📅 OAuth: Google auth failed - ${error}`);
        vscode.window.showErrorMessage(`Google Calendar authentication failed: ${error}`);
      }
      return;
    }
    
    if (!state) {
      logger.error('📅 OAuth: Callback missing state parameter');
      return;
    }
    
    // Find the pending auth request
    const pending = this._pendingAuths.get(state);
    if (!pending) {
      logger.warn(`📅 OAuth: No pending auth found for state: ${state}`);
      vscode.window.showWarningMessage('OAuth callback received but no pending authentication found.');
      return;
    }
    
    // Clear the timeout
    clearTimeout(pending.timeout);
    this._pendingAuths.delete(state);
    
    if (error) {
      logger.error(`📅 OAuth: Auth failed - ${error}: ${errorDescription}`);
      vscode.window.showErrorMessage(`Authentication failed: ${errorDescription || error}`);
      pending.resolve(null);
      return;
    }
    
    if (!code) {
      logger.error('📅 OAuth: Callback missing code parameter');
      pending.resolve(null);
      return;
    }
    
    logger.debug(`📅 OAuth: Successfully received auth code for ${pending.provider}`);
    pending.resolve(code);
  }
  
  /**
   * Start an OAuth flow and wait for the callback
   * 
   * @param provider - The provider name ('outlook' or 'google')
   * @param state - The state parameter for CSRF protection
   * @param codeVerifier - The PKCE code verifier
   * @param timeoutMs - Timeout in milliseconds (default 5 minutes)
   * @returns Promise that resolves with the auth code, or null if failed/cancelled
   */
  public waitForCallback(
    provider: 'outlook' | 'google',
    state: string,
    codeVerifier: string,
    timeoutMs: number = 5 * 60 * 1000
  ): Promise<string | null> {
    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this._pendingAuths.delete(state);
        logger.warn(`📅 OAuth: Timeout waiting for ${provider} callback`);
        resolve(null);
      }, timeoutMs);
      
      // Store the pending auth
      this._pendingAuths.set(state, {
        state,
        provider,
        codeVerifier,
        resolve,
        reject,
        timeout,
      });
      
      logger.debug(`📅 OAuth: Waiting for ${provider} callback with state: ${state.substring(0, 8)}...`);
    });
  }
  
  /**
   * Get the code verifier for a pending auth (needed for token exchange)
   */
  public getCodeVerifier(state: string): string | undefined {
    return this._pendingAuths.get(state)?.codeVerifier;
  }
  
  /**
   * Cancel a pending auth
   */
  public cancelPending(state: string): void {
    const pending = this._pendingAuths.get(state);
    if (pending) {
      clearTimeout(pending.timeout);
      this._pendingAuths.delete(state);
      pending.resolve(null);
    }
  }
  
  /**
   * Cancel all pending auths
   */
  public cancelAll(): void {
    for (const [state, pending] of this._pendingAuths) {
      clearTimeout(pending.timeout);
      pending.resolve(null);
    }
    this._pendingAuths.clear();
  }
}

// Singleton instance
export const OAuthCallbackHandler = new OAuthCallbackHandlerImpl();
