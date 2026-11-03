import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHostToWebviewMessage, parseWebviewToHostMessage } from '@markdown-editor/core';
import { installCalendarBridge } from '../packages/media/src/calendar-bridge';

describe('calendar webview bridge', () => {
  let target: EventTarget;
  let post: ReturnType<typeof vi.fn>;
  let uninstall: () => void;
  let results: Array<Record<string, unknown>>;

  beforeEach(() => {
    target = new EventTarget();
    post = vi.fn();
    uninstall = installCalendarBridge(target, post);
    results = [];
    target.addEventListener('calendar-signout-result', (e) => results.push((e as CustomEvent).detail));
  });

  afterEach(() => uninstall());

  function widgetRequests(type: string, detail: Record<string, unknown>) {
    target.dispatchEvent(new CustomEvent(type, { detail }));
  }

  it('answers a sign-out without a valid provider with a local failure result', () => {
    widgetRequests('calendar-signout', { requestId: 7 });

    expect(post).not.toHaveBeenCalled();
    expect(results).toEqual([
      expect.objectContaining({ requestId: 7, success: false, error: expect.any(String) }),
    ]);
  });

  it('forwards a sign-out with a provider and numeric request id as a valid protocol message', () => {
    widgetRequests('calendar-signout', { provider: 'google', requestId: 3 });

    expect(post).toHaveBeenCalledOnce();
    const parsed = parseWebviewToHostMessage(post.mock.calls[0][0]);
    expect(parsed).toEqual({ kind: 'message', message: { command: 'calendar-signout', provider: 'google', requestId: 3 } });
    expect(results).toEqual([]);
  });

  it('forwards calendar auth and event requests with numeric request ids as valid protocol messages', () => {
    widgetRequests('calendar-auth', { provider: 'outlook', requestId: 1 });
    widgetRequests('calendar-request', { provider: 'all', date: '2026-10-26', requestId: 2 });

    expect(post.mock.calls.map(([message]) => parseWebviewToHostMessage(message).kind)).toEqual(['message', 'message']);
  });

  it('accepts the host sign-out result echoing a numeric request id', () => {
    const parsed = parseHostToWebviewMessage({ command: 'calendar-signout-result', requestId: 3, provider: 'google', success: true });

    expect(parsed.kind).toBe('message');
  });
});
