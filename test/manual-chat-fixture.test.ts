import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('./fixtures/agent-activity-chat-check/extension.js', import.meta.url), 'utf8');

afterEach(() => vi.useRealTimers());

it.each([false, true])('keeps an in-flight snapshot intact after a repeated Start (external edit: %s)', async externalEdit => {
  vi.useFakeTimers();
  const commands = new Map<string, () => Promise<any>>();
  const output: string[] = [];
  const subscriptions: { dispose(): void }[] = [];
  const uri = { path: '/test/tasks.md', toString: () => 'file:///test/tasks.md' };
  const text = '# Native chat check\n\n- [ ] Task\n';
  let documentText = text;
  const doc = { uri, version: 1, isDirty: false, getText: () => documentText };
  let reads = 0;
  let releaseAfter!: (value: Buffer) => void;
  let snapshotStarted!: () => void;
  const afterStarted = new Promise<void>(resolve => { snapshotStarted = resolve; });
  const sessions = new Set<string>();
  const host = {
    version: '1.145.0-insider',
    Uri: { joinPath: (_base: unknown, name: string) => ({ path: '/storage/' + name }) },
    extensions: { getExtension: () => ({ packageJSON: { version: '0.5.11' } }) },
    window: {
      activeTextEditor: { document: doc } as { document: typeof doc } | undefined,
      createOutputChannel: () => ({ appendLine: (line: string) => output.push(line), show() {}, dispose() {} }),
      showErrorMessage: vi.fn(), showInformationMessage: vi.fn(), showWarningMessage: vi.fn(),
    },
    workspace: {
      getConfiguration: () => ({ inspect: (key: string) => ({ key, defaultValue: true }) }),
      fs: {
        readFile: async () => {
          if (++reads === 2) {
            snapshotStarted();
            return new Promise<Buffer>(resolve => { releaseAfter = resolve; });
          }
          return Buffer.from(text);
        },
        createDirectory: async () => {}, writeFile: async () => {},
      },
    },
    commands: {
      registerCommand: (id: string, callback: () => Promise<any>) => { commands.set(id, callback); return { dispose() {} }; },
      executeCommand: async (id: string, args: any) => {
        if (id.endsWith('startSession')) { sessions.add('session'); return { sessionId: 'session', token: 'fixture' }; }
        if (id.endsWith('endSession')) sessions.delete(args.sessionId);
        if (id.endsWith('update') && externalEdit) { documentText += '\n'; doc.version++; doc.isDirty = true; }
        return undefined;
      },
    },
  };
  const module = { exports: {} as { activate(context: unknown): void } };
  runInNewContext(source, { exports: module.exports, require: (id: string) => id === 'vscode' ? host : require(id),
    Buffer, setTimeout, clearTimeout, setInterval, clearInterval });
  module.exports.activate({ subscriptions, globalStorageUri: { path: '/storage' } });
  try {
    const start = commands.get('markdown-activity-check.start')!;
    const first = start();
    await afterStarted;
    host.window.activeTextEditor = undefined;
    await start();
    releaseAfter(Buffer.from(text));
    const result = await first;
    if (externalEdit) {
      expect(result).toBeUndefined();
      const failure = await commands.get('markdown-activity-check.report')!();
      expect(failure.reported).toBe(false);
      expect(failure.after.version).toBe(2);
      expect(failure.error).toContain('Reporting activity changed document or settings');
      expect(host.window.showErrorMessage).toHaveBeenCalledTimes(1);
      expect(sessions.size).toBe(0);
      return;
    }
    expect(result?.reported).toBe(true);
    expect(result?.preserved).toBe(true);
    expect(result?.error).toBeUndefined();
    expect(host.window.showErrorMessage).not.toHaveBeenCalled();
    const cleared = await commands.get('markdown-activity-check.clear')!();
    expect(cleared.clear.preserved).toBe(true);
    expect(sessions.size).toBe(0);
  } finally { for (const disposable of subscriptions) disposable.dispose(); }
});
