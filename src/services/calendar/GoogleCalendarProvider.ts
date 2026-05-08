/**
 * GoogleCalendarProvider - Google Calendar API integration
 * 
 * Uses a custom OAuth flow with PKCE for authentication.
 * IMPORTANT: Google OAuth does NOT support custom URI schemes like vscode://
 * for desktop apps. We must use a local HTTP server on localhost for the redirect.
 * 
 * Uses a built-in Google OAuth client by default. Users can override with their own
 * client ID via the markdown-editor.calendar.googleClientId setting.
 */

import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import dotenv from 'dotenv';
import type { CalendarProvider, CalendarEvent, AuthState } from './types';
import { getOAuthRedirectUri } from './OAuthCallbackHandler';
import { logger } from '../../utils/Logger';

dotenv.config();

// Google OAuth endpoints
const OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Google Calendar API base URL
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

// Default Google OAuth client ID (built-in, users can override in settings)
const DEFAULT_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const DEFAULT_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';

// Required OAuth scopes
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

// Legacy export for backwards compatibility
export const GOOGLE_CALENDAR_AUTH_PROVIDER_ID = 'google-calendar';

/**
 * Color mapping from Google Calendar color IDs to CSS colors
 */
const GOOGLE_COLOR_MAP: Record<string, string> = {
  '1': '#7986cb',  // Lavender
  '2': '#33b679',  // Sage
  '3': '#8e24aa',  // Grape
  '4': '#e67c73',  // Flamingo
  '5': '#f6c026',  // Banana
  '6': '#f5511d',  // Tangerine
  '7': '#039be5',  // Peacock
  '8': '#616161',  // Graphite
  '9': '#3f51b5',  // Blueberry
  '10': '#0b8043', // Basil
  '11': '#d60000', // Tomato
};

/**
 * Helper to make HTTPS requests
 */
function httpsRequest(
  url: string, 
  options: { 
    method?: 'GET' | 'POST'; 
    headers?: Record<string, string>;
    body?: string;
  } = {}
): Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = https.request({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode! >= 200 && res.statusCode! < 300,
          status: res.statusCode!,
          text: () => Promise.resolve(data),
          json: () => Promise.resolve(JSON.parse(data)),
        });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Token storage interface
 */
interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  email?: string;
}

/**
 * Google Calendar event type from Google Calendar API
 */
interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  end: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  colorId?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: {
      entryPointType: string;
      uri: string;
      label?: string;
    }[];
  };
  organizer?: {
    email?: string;
    displayName?: string;
    self?: boolean;
  };
  attendees?: {
    email?: string;
    displayName?: string;
    responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  }[];
  status?: 'confirmed' | 'tentative' | 'cancelled';
}

export class GoogleCalendarProvider implements CalendarProvider {
  public readonly id = 'google' as const;
  public readonly displayName = 'Google Calendar';
  public readonly scopes = GOOGLE_SCOPES;
  
  private _tokenData: TokenData | undefined;
  private _context: vscode.ExtensionContext | undefined;
  private _clientId: string = DEFAULT_CLIENT_ID;
  private _clientSecret: string = DEFAULT_CLIENT_SECRET; // Optional: needed for Web application type OAuth clients
  
  /**
   * Initialize the provider with extension context for secure token storage
   */
  public initialize(context: vscode.ExtensionContext): void {
    this._context = context;
    
    // Load client ID and optional secret from settings
    const config = vscode.workspace.getConfiguration('markdown-editor.calendar');
    this._clientId = config.get<string>('googleClientId') || DEFAULT_CLIENT_ID;
    this._clientSecret = config.get<string>('googleClientSecret') || DEFAULT_CLIENT_SECRET;
    
    // Load saved token data
    this._loadTokenData();
  }
  
  /**
   * Load token data from secure storage
   */
  private async _loadTokenData(): Promise<void> {
    if (!this._context) return;
    
    try {
      const stored = await this._context.secrets.get('google-calendar-token');
      if (stored) {
        this._tokenData = JSON.parse(stored);
        logger.debug('📅 Google: Loaded saved token data');
      }
    } catch {
      logger.debug('📅 Google: No saved token data');
    }
  }
  
  /**
   * Save token data to secure storage
   */
  private async _saveTokenData(): Promise<void> {
    if (!this._context || !this._tokenData) return;
    
    try {
      await this._context.secrets.store(
        'google-calendar-token',
        JSON.stringify(this._tokenData)
      );
      logger.debug('📅 Google: Saved token data');
    } catch (error) {
      logger.error('📅 Google: Failed to save token data', error);
    }
  }
  
  /**
   * Clear token data from storage
   */
  private async _clearTokenData(): Promise<void> {
    this._tokenData = undefined;
    if (this._context) {
      await this._context.secrets.delete('google-calendar-token');
    }
  }
  
  /**
   * Authenticate with Google using custom OAuth flow with PKCE
   * Uses local HTTP server for redirect since Google doesn't support custom URI schemes
   */
  public async authenticate(): Promise<boolean> {
    try {
      logger.debug('📅 Google: Starting authentication...');
      
      // Generate PKCE code verifier and challenge
      const codeVerifier = this._generateCodeVerifier();
      const codeChallenge = this._generateCodeChallenge(codeVerifier);
      const state = crypto.randomBytes(16).toString('hex');
      
      // Start local server to receive OAuth callback
      // Google doesn't support custom URI schemes - must use localhost
      const { authCode, port, cleanup } = await this._startOAuthServer(state);
      const redirectUri = `http://localhost:${port}/callback`;
      
      // Build authorization URL
      const authUrl = `${OAUTH_AUTHORIZE_URL}?` + new URLSearchParams({
        client_id: this._clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: this.scopes.join(' '),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        access_type: 'offline', // Request refresh token
        prompt: 'consent', // Always show consent to get refresh token
      });
      
      // Open browser for user to authenticate
      logger.debug('📅 Google: Opening browser for authentication...');
      await vscode.env.openExternal(vscode.Uri.parse(authUrl));
      
      // Wait for the auth code from callback
      const code = await authCode;
      cleanup();
      
      if (!code) {
        logger.error('📅 Google: No auth code received');
        return false;
      }
      
      // Exchange code for tokens
      logger.debug('📅 Google: Exchanging code for tokens...');
      const tokens = await this._exchangeCodeForTokens(code, redirectUri, codeVerifier);
      
      if (!tokens) {
        return false;
      }
      
      // Get user info
      const userInfo = await this._getUserInfo(tokens.accessToken);
      
      // Store token data
      this._tokenData = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: Date.now() + (tokens.expiresIn * 1000),
        email: userInfo?.email,
      };
      
      await this._saveTokenData();
      
      logger.debug(`📅 Google: Authenticated as ${this._tokenData.email || 'user'}`);
      vscode.window.showInformationMessage(`Connected to Google Calendar as ${this._tokenData.email || 'user'}`);
      return true;
    } catch (error) {
      logger.error('📅 Google: Authentication failed', error);
      return false;
    }
  }
  
  /**
   * Start a local HTTP server to receive OAuth callback
   * Google requires http://localhost for desktop OAuth apps
   */
  private _startOAuthServer(expectedState: string): Promise<{ authCode: Promise<string | null>; port: number; cleanup: () => void }> {
    return new Promise((resolve, reject) => {
      let authCodeResolve: (code: string | null) => void;
      const authCode = new Promise<string | null>(r => { authCodeResolve = r; });
      
      const server = http.createServer((req, res) => {
        const url = new URL(req.url || '', `http://localhost`);
        
        if (url.pathname === '/callback') {
          const code = url.searchParams.get('code');
          const state = url.searchParams.get('state');
          const error = url.searchParams.get('error');
          
          if (error) {
            const errorMsg = url.searchParams.get('error_description') || error;
            const vscodeErrorUri = getOAuthRedirectUri() + '?provider=google&error=' + encodeURIComponent(errorMsg);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <!DOCTYPE html>
              <html><head>
                <meta charset="utf-8">
                <title>Authentication Failed</title>
              </head>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1 style="color: #ef4444;">&#10008; Authentication Failed</h1>
                <p>${errorMsg}</p>
                <p style="color: #666; font-size: 14px;">Redirecting back to VS Code...</p>
                <script>
                  setTimeout(function() {
                    window.location.href = '${vscodeErrorUri}';
                    setTimeout(function() { window.close(); }, 500);
                  }, 1000);
                </script>
              </body></html>
            `);
            authCodeResolve(null);
          } else if (state !== expectedState) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end('<html><body><h1>Invalid state</h1></body></html>');
            authCodeResolve(null);
          } else {
            // Build VS Code redirect URI with success indicator
            const vscodeRedirectUri = getOAuthRedirectUri() + '?provider=google&success=true';
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <!DOCTYPE html>
              <html><head>
                <meta charset="utf-8">
                <title>Authentication Successful</title>
              </head>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1 style="color: #22c55e;">&#10004; Authentication Successful!</h1>
                <p>Redirecting back to VS Code...</p>
                <p style="color: #666; font-size: 14px;">If you're not redirected automatically, <a href="${vscodeRedirectUri}">click here</a> or close this window.</p>
                <script>
                  // Redirect to VS Code URI handler and close the tab
                  setTimeout(function() {
                    window.location.href = '${vscodeRedirectUri}';
                    setTimeout(function() { window.close(); }, 500);
                  }, 500);
                </script>
              </body></html>
            `);
            authCodeResolve(code);
          }
        }
      });
      
      server.listen(0, 'localhost', () => {
        const address = server.address();
        const port = typeof address === 'object' ? address?.port || 0 : 0;
        logger.debug(`📅 Google: OAuth callback server listening on port ${port}`);
        
        const cleanup = () => {
          server.close();
        };
        
        resolve({ authCode, port, cleanup });
      });
      
      server.on('error', reject);
      
      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        authCodeResolve(null);
      }, 5 * 60 * 1000);
    });
  }
  
  /**
   * Generate PKCE code verifier
   */
  private _generateCodeVerifier(): string {
    return crypto.randomBytes(32)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }
  
  /**
   * Generate PKCE code challenge from verifier
   */
  private _generateCodeChallenge(verifier: string): string {
    return crypto.createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }
  
  /**
   * Convert Date to ISO string with local timezone offset
   * This ensures Google Calendar API interprets the date in the user's local timezone
   */
  private _toLocalISOString(date: Date): string {
    const tzOffset = -date.getTimezoneOffset();
    const sign = tzOffset >= 0 ? '+' : '-';
    const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
    
    return date.getFullYear() +
      '-' + pad(date.getMonth() + 1) +
      '-' + pad(date.getDate()) +
      'T' + pad(date.getHours()) +
      ':' + pad(date.getMinutes()) +
      ':' + pad(date.getSeconds()) +
      sign + pad(tzOffset / 60) +
      ':' + pad(tzOffset % 60);
  }
  
  /**
   * Exchange authorization code for tokens
   */
  private async _exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    codeVerifier: string
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number } | null> {
    try {
      const bodyParams: Record<string, string> = {
        client_id: this._clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      };
      
      // Include client_secret if provided (needed for Web application type OAuth clients)
      if (this._clientSecret) {
        bodyParams.client_secret = this._clientSecret;
      }
      
      const body = new URLSearchParams(bodyParams);
      
      const response = await httpsRequest(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        logger.error('📅 Google: Token exchange failed', errorData);
        vscode.window.showErrorMessage(`Google auth failed: ${errorData.error_description || errorData.error}`);
        return null;
      }
      
      const data = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in || 3600,
      };
    } catch (error) {
      logger.error('📅 Google: Token exchange error', error);
      return null;
    }
  }
  
  /**
   * Refresh the access token using refresh token
   */
  private async _refreshAccessToken(): Promise<boolean> {
    if (!this._tokenData?.refreshToken || !this._clientId) {
      return false;
    }
    
    try {
      logger.debug('📅 Google: Refreshing access token...');
      
      const bodyParams: Record<string, string> = {
        client_id: this._clientId,
        grant_type: 'refresh_token',
        refresh_token: this._tokenData.refreshToken,
      };
      
      // Include client_secret if provided (needed for Web application type OAuth clients)
      if (this._clientSecret) {
        bodyParams.client_secret = this._clientSecret;
      }
      
      const body = new URLSearchParams(bodyParams);
      
      const response = await httpsRequest(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
      
      if (!response.ok) {
        logger.error('📅 Google: Token refresh failed');
        await this._clearTokenData();
        return false;
      }
      
      const data = await response.json();
      
      this._tokenData = {
        ...this._tokenData,
        accessToken: data.access_token,
        // Google doesn't always return a new refresh token
        refreshToken: data.refresh_token || this._tokenData.refreshToken,
        expiresAt: Date.now() + ((data.expires_in || 3600) * 1000),
      };
      
      await this._saveTokenData();
      logger.debug('📅 Google: Token refreshed successfully');
      return true;
    } catch (error) {
      logger.error('📅 Google: Token refresh error', error);
      await this._clearTokenData();
      return false;
    }
  }
  
  /**
   * Get user info from Google
   */
  private async _getUserInfo(accessToken: string): Promise<{ email?: string } | null> {
    try {
      const response = await httpsRequest(USERINFO_URL, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        return { email: data.email };
      }
    } catch (error) {
      logger.debug('📅 Google: Failed to get user info', error);
    }
    return null;
  }
  
  /**
   * Ensure we have a valid access token
   */
  private async _ensureValidToken(): Promise<string | null> {
    if (!this._tokenData) {
      return null;
    }
    
    // Check if token is expired or about to expire (within 5 minutes)
    if (this._tokenData.expiresAt < Date.now() + 5 * 60 * 1000) {
      if (!await this._refreshAccessToken()) {
        return null;
      }
    }
    
    return this._tokenData.accessToken;
  }
  
  /**
   * Check if user has a valid session
   */
  public async isAuthenticated(): Promise<boolean> {
    // Load token data if not already loaded
    if (!this._tokenData && this._context) {
      await this._loadTokenData();
    }
    
    if (!this._tokenData) {
      return false;
    }
    
    // Try to ensure token is valid
    const token = await this._ensureValidToken();
    return !!token;
  }
  
  /**
   * Get current auth state
   */
  public async getAuthState(): Promise<AuthState> {
    const authenticated = await this.isAuthenticated();
    
    return {
      authenticated,
      email: this._tokenData?.email,
    };
  }
  
  /**
   * Get events for a specific date
   */
  public async getEvents(date: Date): Promise<CalendarEvent[]> {
    const accessToken = await this._ensureValidToken();
    
    if (!accessToken) {
      throw new Error('Not authenticated with Google');
    }
    
    try {
      // Calculate start and end of day in LOCAL timezone
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      
      // Format with timezone offset for accurate local date queries
      const timeMin = this._toLocalISOString(startOfDay);
      const timeMax = this._toLocalISOString(endOfDay);
      
      logger.debug(`📅 Google: Querying ${timeMin} to ${timeMax}`);
      
      // Build Google Calendar API URL
      const url = `${CALENDAR_API_BASE}/calendars/primary/events?` + new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '50',
      });
      
      const response = await httpsRequest(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`📅 Google: API error ${response.status}: ${errorText}`);
        throw new Error(`Failed to fetch Google events: ${response.status}`);
      }
      
      const data = await response.json() as { items: GoogleEvent[] };
      const events = (data.items || []).map(event => this._convertEvent(event));
      
      logger.debug(`📅 Google: Fetched ${events.length} events`);
      return events;
    } catch (error) {
      logger.error('📅 Google: Failed to fetch events', error);
      throw error;
    }
  }
  
  /**
   * Sign out from Google
   */
  public async signOut(): Promise<void> {
    try {
      await this._clearTokenData();
      logger.debug('📅 Google: Signed out');
      vscode.window.showInformationMessage('Disconnected from Google Calendar');
    } catch (error) {
      logger.error('📅 Google: Sign out failed', error);
      throw error;
    }
  }
  
  /**
   * Convert Google Calendar event to our CalendarEvent format
   */
  private _convertEvent(event: GoogleEvent): CalendarEvent {
    // Handle all-day events (have date instead of dateTime)
    const allDay = !!event.start.date && !event.start.dateTime;
    
    let startTime: Date;
    let endTime: Date;
    
    if (allDay) {
      startTime = new Date(event.start.date!);
      endTime = new Date(event.end.date!);
    } else {
      startTime = new Date(event.start.dateTime!);
      endTime = new Date(event.end.dateTime!);
    }
    
    const time = allDay ? 'All day' : this._formatTimeRange(startTime, endTime);
    const color = event.colorId 
      ? (GOOGLE_COLOR_MAP[event.colorId] || '#0e639c')
      : '#0e639c';
    
    const hasVideo = !!(
      event.hangoutLink || 
      event.conferenceData?.entryPoints?.some(e => e.entryPointType === 'video')
    );
    
    const videoLink = event.hangoutLink || 
      event.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri;
    
    const link = videoLink || event.htmlLink;
    
    return {
      id: event.id,
      title: event.summary || '(No title)',
      time,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      color,
      hasVideo,
      link,
      location: event.location,
      description: event.description?.substring(0, 200),
      source: 'google',
      allDay,
      organizer: event.organizer?.email,
    };
  }
  
  /**
   * Format time range for display
   */
  private _formatTimeRange(start: Date, end: Date): string {
    const options: Intl.DateTimeFormatOptions = { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true,
    };
    
    const startStr = start.toLocaleTimeString('en-US', options);
    const endStr = end.toLocaleTimeString('en-US', options);
    
    return `${startStr} - ${endStr}`;
  }
}
