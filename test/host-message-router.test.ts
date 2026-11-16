import { describe, expect, it, vi } from 'vitest';
import { createHostMessageRouter } from '../packages/media/src/host-message-router';

describe('webview host message router', () => {
  it('dispatches a parsed host message to the group that owns it', () => {
    const insertTextAtCursor = vi.fn();
    const route = createHostMessageRouter({
      routeGroups: [{ showFind: vi.fn() }, { insertTextAtCursor }],
      reportMalformed: vi.fn(),
    });

    expect(route({ command: 'insertTextAtCursor', text: 'hello', stray: 1 })).toBe('handled');
    expect(insertTextAtCursor).toHaveBeenCalledWith({ command: 'insertTextAtCursor', text: 'hello' });
  });

  it('reports a malformed known message instead of handling it', () => {
    const update = vi.fn();
    const reportMalformed = vi.fn();
    const route = createHostMessageRouter({ routeGroups: [{ update }], reportMalformed });

    expect(route({ command: 'update', content: 42 })).toBe('rejected');
    expect(update).not.toHaveBeenCalled();
    expect(reportMalformed).toHaveBeenCalledWith('update', ['content must be a string']);
  });

  it('ignores messages owned by other listeners', () => {
    const reportMalformed = vi.fn();
    const route = createHostMessageRouter({ routeGroups: [{ update: vi.fn() }], reportMalformed });

    expect(route({ type: 'legacy-untyped-message' })).toBe('ignored');
    expect(route({ command: 'widget-to-widget-action' })).toBe('ignored');
    expect(route({ command: 'showFind' })).toBe('ignored');
    expect(reportMalformed).not.toHaveBeenCalled();
  });

  it('refuses to compose two groups that route the same command', () => {
    expect(() => createHostMessageRouter({
      routeGroups: [{ update: vi.fn() }, { update: vi.fn() }],
      reportMalformed: vi.fn(),
    })).toThrow(/update/);
  });
});
