/**
 * OutlookCalendarProvider - Microsoft Graph API integration for Outlook Calendar
 * 
 * IMPORTANT: VS Code's built-in 'microsoft' auth provider does NOT support
 * Calendars.Read scope. This implementation uses a custom OAuth flow with PKCE.
 * 
 * Uses a built-in Azure AD app by default. Users can override with their own
 * client ID via the markdown-editor.calendar.outlookClientId setting.
 */

import * as vscode from 'vscode';
import * as https from 'https';
import * as crypto from 'crypto';
import type { CalendarProvider, CalendarEvent, AuthState } from './types';
import { OAuthCallbackHandler, getOAuthRedirectUri } from './OAuthCallbackHandler';
import { logger } from '../../utils/Logger';

// Microsoft Graph API base URL
const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

// OAuth endpoints
const OAUTH_AUTHORITY = 'https://login.microsoftonline.com/common';
const OAUTH_AUTHORIZE_URL = `${OAUTH_AUTHORITY}/oauth2/v2.0/authorize`;
const OAUTH_TOKEN_URL = `${OAUTH_AUTHORITY}/oauth2/v2.0/token`;

// Default Azure AD app client ID (built-in, users can override in settings)
const DEFAULT_CLIENT_ID = '07b9e9e9-6c4c-44fa-ab50-2218131c1f69';

// Required OAuth scopes for calendar access
const OUTLOOK_SCOPES = [
  'offline_access',
  'openid',
  'profile',
  'User.Read',
  'Calendars.Read',
];

/**
 * Color mapping from Microsoft Graph to CSS colors
 */
const OUTLOOK_COLOR_MAP: Record<string, string> = {
  lightBlue: '#3b82f6',
  lightGreen: '#22c55e',
  lightOrange: '#f97316',
  lightGray: '#6b7280',
  lightYellow: '#eab308',
  lightTeal: '#14b8a6',
  lightPink: '#ec4899',
  lightBrown: '#78716c',
  lightRed: '#ef4444',
  maxColor: '#0e639c',
  auto: '#0e639c',
  preset0: '#ef4444',
  preset1: '#f97316',
  preset2: '#eab308',
  preset3: '#22c55e',
  preset4: '#14b8a6',
  preset5: '#3b82f6',
  preset6: '#8b5cf6',
  preset7: '#ec4899',
  preset8: '#78716c',
  preset9: '#6b7280',
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
 * Outlook event type from Microsoft Graph API
 */
interface OutlookEvent {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName?: string };
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string };
  webLink?: string;
  bodyPreview?: string;
  organizer?: { emailAddress?: { name?: string; address?: string } };
  categories?: string[];
  showAs?: 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere' | 'unknown';
  isAllDay?: boolean;
}

export class OutlookCalendarProvider implements CalendarProvider {
  public readonly id = 'outlook' as const;
  public readonly displayName = 'Microsoft Outlook';
  public readonly scopes = OUTLOOK_SCOPES;
  
  private _tokenData: TokenData | undefined;
  private _context: vscode.ExtensionContext | undefined;
  private _clientId: string = DEFAULT_CLIENT_ID;
  
  /**
   * Initialize the provider with extension context for secure token storage
   */
  public initialize(context: vscode.ExtensionContext): void {
    this._context = context;
    
    // Load client ID from settings
    const config = vscode.workspace.getConfiguration('markdown-editor.calendar');
    this._clientId = config.get<string>('outlookClientId') || DEFAULT_CLIENT_ID;
    
    // Load saved token data
    this._loadTokenData();
  }
  
  /**
   * Load token data from secure storage
   */
  private async _loadTokenData(): Promise<void> {
    if (!this._context) return;
    
    try {
      const stored = await this._context.secrets.get('outlook-calendar-token');
      if (stored) {
        this._tokenData = JSON.parse(stored);
        logger.debug('📅 Outlook: Loaded saved token data');
      }
    } catch {
      logger.debug('📅 Outlook: No saved token data');
    }
  }
  
  /**
   * Save token data to secure storage
   */
  private async _saveTokenData(): Promise<void> {
    if (!this._context || !this._tokenData) return;
    
    try {
      await this._context.secrets.store(
        'outlook-calendar-token',
        JSON.stringify(this._tokenData)
      );
      logger.debug('📅 Outlook: Saved token data');
    } catch (error) {
      logger.error('📅 Outlook: Failed to save token data', error);
    }
  }
  
  /**
   * Clear token data from storage
   */
  private async _clearTokenData(): Promise<void> {
    this._tokenData = undefined;
    if (this._context) {
      await this._context.secrets.delete('outlook-calendar-token');
    }
  }
  
  /**
   * Authenticate with Microsoft using custom OAuth flow with PKCE
   * Uses VS Code URI handler for redirect (vscode://phfsantos.markdown-editor/oauth/callback)
   */
  public async authenticate(): Promise<boolean> {
    try {
      logger.debug('📅 Outlook: Starting authentication...');
      
      // Generate PKCE code verifier and challenge
      const codeVerifier = this._generateCodeVerifier();
      const codeChallenge = this._generateCodeChallenge(codeVerifier);
      const state = crypto.randomBytes(16).toString('hex');
      
      // Build authorization URL with VS Code URI as redirect
      const authUrl = `${OAUTH_AUTHORIZE_URL}?` + new URLSearchParams({
        client_id: this._clientId,
        response_type: 'code',
        redirect_uri: getOAuthRedirectUri(),
        scope: this.scopes.join(' '),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      
      // Start waiting for callback before opening browser
      const authCodePromise = OAuthCallbackHandler.waitForCallback('outlook', state, codeVerifier);
      
      // Open browser for user to authenticate
      logger.debug('📅 Outlook: Opening browser for authentication...');
      await vscode.env.openExternal(vscode.Uri.parse(authUrl));
      
      // Wait for the auth code from URI handler callback
      const code = await authCodePromise;
      
      if (!code) {
        logger.error('📅 Outlook: No auth code received');
        return false;
      }
      
      // Exchange code for tokens
      logger.debug('📅 Outlook: Exchanging code for tokens...');
      const tokens = await this._exchangeCodeForTokens(code, codeVerifier);
      
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
      
      logger.debug(`📅 Outlook: Authenticated as ${this._tokenData.email || 'user'}`);
      vscode.window.showInformationMessage(`Connected to Outlook Calendar as ${this._tokenData.email || 'user'}`);
      return true;
    } catch (error) {
      logger.error('📅 Outlook: Authentication failed', error);
      return false;
    }
  }
  
  /**
   * Generate PKCE code verifier
   */
  private _generateCodeVerifier(): string {
    // Convert base64 to base64url (URL-safe)
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
    // Convert base64 to base64url (URL-safe)
    return crypto.createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }
  
  /**
   * Convert Date to ISO string with local timezone offset
   * This ensures Microsoft Graph API interprets the date in the user's local timezone
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
    codeVerifier: string
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number } | null> {
    try {
      const body = new URLSearchParams({
        client_id: this._clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: getOAuthRedirectUri(),
        code_verifier: codeVerifier,
      });
      
      const response = await httpsRequest(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        logger.error('📅 Outlook: Token exchange failed', errorData);
        vscode.window.showErrorMessage(`Outlook auth failed: ${errorData.error_description || errorData.error}`);
        return null;
      }
      
      const data = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in || 3600,
      };
    } catch (error) {
      logger.error('📅 Outlook: Token exchange error', error);
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
      logger.debug('📅 Outlook: Refreshing access token...');
      
      const body = new URLSearchParams({
        client_id: this._clientId,
        grant_type: 'refresh_token',
        refresh_token: this._tokenData.refreshToken,
        scope: this.scopes.join(' '),
      });
      
      const response = await httpsRequest(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
      
      if (!response.ok) {
        logger.error('📅 Outlook: Token refresh failed');
        await this._clearTokenData();
        return false;
      }
      
      const data = await response.json();
      
      this._tokenData = {
        ...this._tokenData,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || this._tokenData.refreshToken,
        expiresAt: Date.now() + ((data.expires_in || 3600) * 1000),
      };
      
      await this._saveTokenData();
      logger.debug('📅 Outlook: Token refreshed successfully');
      return true;
    } catch (error) {
      logger.error('📅 Outlook: Token refresh error', error);
      await this._clearTokenData();
      return false;
    }
  }
  
  /**
   * Get user info from Microsoft Graph
   */
  private async _getUserInfo(accessToken: string): Promise<{ email?: string } | null> {
    try {
      const response = await httpsRequest(`${GRAPH_API_BASE}/me`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        return { email: data.mail || data.userPrincipalName };
      }
    } catch (error) {
      logger.debug('📅 Outlook: Failed to get user info', error);
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
      throw new Error('Not authenticated with Outlook');
    }
    
    try {
      // Calculate start and end of day in LOCAL timezone
      // Then format as ISO string with timezone offset for Microsoft Graph
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      
      // Format with timezone offset for accurate local date queries
      // Microsoft Graph API accepts ISO 8601 with timezone
      const startDateTime = this._toLocalISOString(startOfDay);
      const endDateTime = this._toLocalISOString(endOfDay);
      
      logger.debug(`📅 Outlook: Querying ${startDateTime} to ${endDateTime}`);
      
      // Build Graph API URL for calendarView
      const url = `${GRAPH_API_BASE}/me/calendarView?` + new URLSearchParams({
        startDateTime,
        endDateTime,
        '$orderby': 'start/dateTime',
        '$select': 'id,subject,start,end,location,isOnlineMeeting,onlineMeeting,webLink,bodyPreview,organizer,categories,showAs',
        '$top': '50',
      });
      
      logger.debug(`📅 Outlook: Fetching events for ${date.toDateString()}`);
      
      const response = await httpsRequest(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`📅 Outlook: API error ${response.status}: ${errorText}`);
        throw new Error(`Failed to fetch Outlook events: ${response.status}`);
      }
      
      const data = await response.json() as { value: OutlookEvent[] };
      const events = data.value.map(event => this._convertEvent(event));
      
      logger.debug(`📅 Outlook: Fetched ${events.length} events`);
      return events;
    } catch (error) {
      logger.error('📅 Outlook: Failed to fetch events', error);
      throw error;
    }
  }
  
  /**
   * Sign out from Microsoft
   */
  public async signOut(): Promise<void> {
    try {
      await this._clearTokenData();
      logger.debug('📅 Outlook: Signed out');
      vscode.window.showInformationMessage('Disconnected from Outlook Calendar');
    } catch (error) {
      logger.error('📅 Outlook: Sign out failed', error);
      throw error;
    }
  }
  
  /**
   * Convert Outlook event to our CalendarEvent format
   */
  private _convertEvent(event: OutlookEvent): CalendarEvent {
    const startTime = new Date(event.start.dateTime + 'Z');
    const endTime = new Date(event.end.dateTime + 'Z');
    
    const allDay = event.isAllDay ?? this._isAllDay(startTime, endTime);
    const time = allDay ? 'All day' : this._formatTimeRange(startTime, endTime);
    const color = this._getEventColor(event);
    const hasVideo = event.isOnlineMeeting || !!event.onlineMeeting?.joinUrl;
    const link = event.onlineMeeting?.joinUrl || event.webLink;
    
    return {
      id: event.id,
      title: event.subject || '(No title)',
      time,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      color,
      hasVideo,
      link,
      location: event.location?.displayName,
      description: event.bodyPreview,
      source: 'outlook',
      allDay,
      organizer: event.organizer?.emailAddress?.address,
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
  
  /**
   * Check if event spans the full day
   */
  private _isAllDay(start: Date, end: Date): boolean {
    const startHour = start.getHours();
    const startMin = start.getMinutes();
    const endHour = end.getHours();
    const endMin = end.getMinutes();
    
    return startHour === 0 && startMin === 0 && endHour === 0 && endMin === 0;
  }
  
  /**
   * Get event color from categories or showAs
   */
  private _getEventColor(event: OutlookEvent): string {
    if (event.categories && event.categories.length > 0) {
      const category = event.categories[0].toLowerCase();
      for (const [key, color] of Object.entries(OUTLOOK_COLOR_MAP)) {
        if (category.includes(key.toLowerCase())) {
          return color;
        }
      }
    }
    
    switch (event.showAs) {
      case 'busy':
        return '#3b82f6';
      case 'tentative':
        return '#eab308';
      case 'oof':
        return '#a855f7';
      case 'free':
        return '#22c55e';
      case 'workingElsewhere':
        return '#14b8a6';
      default:
        return '#0e639c';
    }
  }
}
