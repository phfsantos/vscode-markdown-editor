import { describe, expect, it, vi } from 'vitest';
import { createWebviewMessageRouter } from '../src/app/webviewMessageRouter';

function router(overrides: Partial<Parameters<typeof createWebviewMessageRouter>[0]> = {}) {
  const reject = vi.fn();
  const route = createWebviewMessageRouter({ routeGroups: [], reject, ...overrides });
  return { route, reject };
}

describe('host webview message router', () => {
  it('dispatches a parsed message to the route group that owns its command', async () => {
    const requestAiAction = vi.fn();
    const { route } = router({ routeGroups: [{ ready: vi.fn() }, { requestAiAction }] });

    const outcome = await route({ command: 'requestAiAction', action: 'validate', extra: 'dropped' });

    expect(outcome).toBe('handled');
    expect(requestAiAction).toHaveBeenCalledWith({ command: 'requestAiAction', action: 'validate' });
  });

  it('rejects a malformed known command without calling its route', async () => {
    const save = vi.fn();
    const { route, reject } = router({ routeGroups: [{ save }] });

    const outcome = await route({ command: 'save', content: 'x', generation: 0 });

    expect(outcome).toBe('rejected');
    expect(save).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledWith({
      command: 'messageRejected',
      rejectedCommand: 'save',
      issues: ['revision is required'],
    });
  });

  it('ignores unknown input and known commands no group routes', async () => {
    const { route, reject } = router({ routeGroups: [{ ready: vi.fn() }] });

    await expect(route({ command: 'somethingNew' })).resolves.toBe('ignored');
    await expect(route('not a message')).resolves.toBe('ignored');
    await expect(route({ command: 'find' })).resolves.toBe('ignored');
    expect(reject).not.toHaveBeenCalled();
  });

  it('offers raw input to delegates before parsing the shared protocol', async () => {
    const ready = vi.fn();
    const delegate = vi.fn(async (raw: unknown) => (raw as { command?: string }).command === 'kanban-save-data');
    const { route } = router({ routeGroups: [{ ready }], delegates: [delegate] });

    await expect(route({ command: 'kanban-save-data', data: {} })).resolves.toBe('handled');
    await expect(route({ command: 'ready' })).resolves.toBe('handled');
    expect(delegate).toHaveBeenCalledTimes(2);
    expect(ready).toHaveBeenCalledOnce();
  });

  it('refuses to compose two groups that route the same command', () => {
    expect(() => router({ routeGroups: [{ save: vi.fn() }, { save: vi.fn() }] })).toThrow(/save/);
  });
});
