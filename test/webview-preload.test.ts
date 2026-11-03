import { expect, test, vi } from 'vitest';

test('the webview preload exposes `global` before the editor boots', async () => {
  const window: Record<string, unknown> = {};
  vi.stubGlobal('window', window);

  await import('../packages/media/src/preload');

  expect(window.global).toBe(globalThis);
});
