import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { GoogleCalendarProvider } from '../src/services/calendar/GoogleCalendarProvider';
import { OutlookCalendarProvider } from '../src/services/calendar/OutlookCalendarProvider';
import * as https from 'https';
import { EventEmitter } from 'events';

vi.mock('https', () => ({ request: vi.fn() }));

describe.each([
  ['Google', GoogleCalendarProvider],
  ['Outlook', OutlookCalendarProvider],
] as const)('%s token loading', (_name, Provider) => {
  it('leaves secret storage untouched until a calendar operation needs it', async () => {
    const get = vi.fn().mockResolvedValue(undefined);
    const provider = new Provider();
    provider.initialize({ secrets: { get } } as unknown as vscode.ExtensionContext);

    expect(get).not.toHaveBeenCalled();
    await expect(provider.getAuthState()).resolves.toEqual({ authenticated: false, email: undefined });
    expect(get).toHaveBeenCalledWith(`${provider.id}-calendar-token`);
  });

  it('restores a stored session before a direct event request', async () => {
    let resolveToken!: (token: string) => void;
    const get = vi.fn(() => new Promise<string>(resolve => { resolveToken = resolve; }));
    const provider = new Provider();
    provider.initialize({ secrets: { get } } as unknown as vscode.ExtensionContext);
    const request = vi.mocked(https.request);
    request.mockReset();
    request.mockImplementation(((_options: unknown, callback: (response: EventEmitter) => void) => {
      const req = new EventEmitter() as EventEmitter & { end(): void };
      req.end = () => {
        const response = Object.assign(new EventEmitter(), { statusCode: 200 });
        callback(response);
        response.emit('data', JSON.stringify({ items: [], value: [] }));
        response.emit('end');
      };
      return req;
    }) as typeof https.request);

    const events = provider.getEvents(new Date('2026-11-09T12:00:00Z'));
    // Observe early rejections even when the storage assertion fails first.
    void events.catch(() => {});
    expect(get).toHaveBeenCalledWith(`${provider.id}-calendar-token`);
    expect(request).not.toHaveBeenCalled();
    resolveToken(JSON.stringify({ accessToken: 'stored-fixture-token', expiresAt: Date.now() + 3600000 }));

    await expect(events).resolves.toEqual([]);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer stored-fixture-token' }),
    }), expect.any(Function));
  });
});
