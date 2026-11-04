import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function fixture(provider?: unknown) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const writes: string[] = [];
  const snapshots: unknown[] = [];
  const api: Record<string, any> = {};
  const activateProvider = vi.fn(async () => provider);
  const vscode = {
    extensions: { getExtension: () => provider ? { activate: activateProvider } : undefined },
    commands: {
      registerCommand: (id: string, callback: (...args: any[]) => any) => {
        handlers.set(id, callback);
        return { dispose: () => handlers.delete(id) };
      },
      executeCommand: vi.fn(async () => snapshots.shift()),
    },
    env: { clipboard: { writeText: async (text: string) => { writes.push(text); } } },
    window: { createOutputChannel: () => ({ appendLine() {}, dispose() {} }) },
  };
  const filename = resolve('test/fixtures/agent-context-consumer/extension.js');
  if (existsSync(filename)) {
    runInNewContext(readFileSync(filename, 'utf8'), { exports: api, require: () => vscode });
  }
  const subscriptions: { dispose(): void }[] = [];
  return { api, handlers, snapshots, writes, vscode, activateProvider, context: { subscriptions } };
}

describe('independent agent context consumer fixture', () => {
  it('activates a same-host provider and observes clearing without opening an editor', async () => {
    let listener: ((value: unknown) => void) | undefined;
    const disposed = vi.fn();
    const context = { panelId: 'A', uri: { toString: () => 'file:///a.md' }, documentVersion: 2, selectionStatus: 'unavailable' };
    const f = fixture({ apiVersion: 1, getActiveContext: () => context, onDidChangeActiveContext: (fn: any) => { listener = fn; return { dispose: disposed }; } });
    expect(f.api.activate).toBeTypeOf('function');
    await f.api.activate(f.context);
    expect(f.activateProvider).not.toHaveBeenCalled();
    expect(await f.handlers.get('agent-context-consumer.readExports')!()).toEqual({ ...context, uri: 'file:///a.md' });
    expect(f.activateProvider).toHaveBeenCalledOnce();
    listener!(undefined);
    expect(f.handlers.get('agent-context-consumer.getObservations')!().at(-1)).toEqual({ transport: 'event' });
    f.context.subscriptions.forEach(x => x.dispose());
    expect(disposed).toHaveBeenCalledOnce();
  });
  it('reads command fallback preserving a remote URI without local exports', async () => {
    const f = fixture();
    await f.api.activate(f.context);
    f.snapshots.push({ panelId: 'remote-A', uri: 'vscode-remote://ssh-remote+notes/home/me/a%20b.md', documentVersion: 7, selectionStatus: 'exact', selection: { start: { line: 0, character: 8 }, end: { line: 0, character: 12 } } });
    const result = await f.handlers.get('agent-context-consumer.readCommand')!();
    expect(result.uri).toBe('vscode-remote://ssh-remote+notes/home/me/a%20b.md');
    expect(f.vscode.commands.executeCommand).toHaveBeenCalledWith('markdown-editor.getActiveContext', { uriFormat: 'object' });
    await expect(f.handlers.get('agent-context-consumer.readExports')!()).rejects.toThrow();
  });

  it('asserts source selection, panel switching, and unavailable context through commands', async () => {
    const f = fixture();
    await f.api.activate(f.context);
    const assert = f.handlers.get('agent-context-consumer.assertContext');
    expect(assert).toBeTypeOf('function');
    const a = { panelId: 'A', uri: 'file:///a.md', documentVersion: 1, selectionStatus: 'exact', selection: { start: { line: 0, character: 8 }, end: { line: 0, character: 12 } } };
    f.snapshots.push(a);
    expect(await assert!({ uri: 'file:///a.md', selection: a.selection, selectionStatus: 'exact' })).toEqual(a);
    f.snapshots.push({ ...a, panelId: 'B', uri: 'file:///b.md' });
    expect((await assert!({ uri: 'file:///b.md', differentPanelId: 'A' })).panelId).toBe('B');
    f.snapshots.push(undefined);
    expect(await assert!({ unavailable: true })).toBeUndefined();
    f.snapshots.push(a);
    await expect(assert!({ unavailable: true })).rejects.toThrow('Expected no active');
  });

  it('copies only file and exact range context when explicitly invoked', async () => {
    const f = fixture();
    await f.api.activate(f.context);
    expect(f.writes).toEqual([]);
    const copy = f.handlers.get('agent-context-consumer.copyContext');
    expect(copy).toBeTypeOf('function');
    f.snapshots.push({ panelId: 'A', uri: 'vscode-remote://ssh-remote+notes/home/a.md', documentVersion: 3, selectionStatus: 'unavailable' });
    await copy!();
    expect(JSON.parse(f.writes[0])).toEqual({ uri: 'vscode-remote://ssh-remote+notes/home/a.md', documentVersion: 3, selectionStatus: 'unavailable' });
  });

  it('keeps command transport available when export version is unsupported', async () => {
    const f = fixture({ apiVersion: 2 });
    await f.api.activate(f.context);
    await expect(f.handlers.get('agent-context-consumer.readExports')!()).rejects.toThrow('API v1 exports unavailable');
    f.snapshots.push(undefined);
    expect(await f.handlers.get('agent-context-consumer.readCommand')!()).toBeUndefined();
  });

  it('does not activate same-host exports while reading a cold command', async () => {
    const f = fixture({ apiVersion: 1 });
    await f.api.activate(f.context);
    f.snapshots.push(undefined);
    await f.handlers.get('agent-context-consumer.readCommand')!();
    expect(f.activateProvider).not.toHaveBeenCalled();
  });

  it('copies exact UTF-16 coordinates without changing the resource string', async () => {
    const f = fixture();
    await f.api.activate(f.context);
    const selection = { start: { line: 0, character: 8 }, end: { line: 0, character: 12 } };
    f.snapshots.push({ panelId: 'A', uri: 'file:///notes/a%20b.md', documentVersion: 3, selectionStatus: 'exact', selection });
    await f.handlers.get('agent-context-consumer.copyContext')!();
    expect(JSON.parse(f.writes[0])).toEqual({ uri: 'file:///notes/a%20b.md', documentVersion: 3, selectionStatus: 'exact', selection });
  });

  it('refuses to copy when no custom editor is active', async () => {
    const f = fixture();
    await f.api.activate(f.context);
    f.snapshots.push(undefined);
    await expect(f.handlers.get('agent-context-consumer.copyContext')!()).rejects.toThrow('No active');
    expect(f.writes).toEqual([]);
  });

});
