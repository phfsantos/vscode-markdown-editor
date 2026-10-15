import { expect, test, vi } from 'vitest';

const loaded = vi.hoisted(() => ({ bridge: false }));

vi.mock('../packages/media/src/ai-markdown-bridge', () => {
  loaded.bridge = true;
  return {};
});

test('the webview preload installs the AI markdown bridge before the editor boots', async () => {
  vi.stubGlobal('window', {});

  await import('../packages/media/src/preload');

  expect(loaded.bridge).toBe(true);
});
