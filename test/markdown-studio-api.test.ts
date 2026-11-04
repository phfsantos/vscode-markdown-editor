import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { MarkdownStudioApiService } from '../src/integration/MarkdownStudioApiService';
import manifest from '../package.json';

function fixture() {
  const emitter = new vscode.EventEmitter<any>();
  let current: any;
  const registered = new Map<string, Function>();
  const service = new MarkdownStudioApiService({ getActiveContext: () => current, onDidChangeActiveContext: emitter.event }, {
    registerCommand: (name: string, callback: Function) => { registered.set(name, callback); return { dispose: () => registered.delete(name) }; },
  } as any);
  return { service, registered, set(value: any) { current = value; emitter.fire(value); } };
}
describe('public Markdown Studio API', () => {
  it('exports v1 with no active context and a cold activation command', () => {
    const f = fixture();
    expect(f.service.api.apiVersion).toBe(1);
    expect(f.service.api.getActiveContext()).toBeUndefined();
    expect(f.registered.get('markdown-editor.getActiveContext')!()).toBeUndefined();
    expect(manifest.activationEvents).toContain('onCommand:markdown-editor.getActiveContext');
    f.service.dispose();
    expect(f.registered.size).toBe(0);
  });
  it('isolates snapshots and serializes remote URIs and UTF-16 positions', () => {
    const f = fixture();
    f.set({ panelId: 'A', uri: vscode.Uri.parse('vscode-remote://ssh-remote+dev/notes/tasks.md'), documentVersion: 7, selectionStatus: 'exact', selection: new vscode.Range(0, 8, 0, 12) });
    const a = f.service.api.getActiveContext()!;
    (a as any).panelId = 'bad'; (a.selection!.start as any).character = 50;
    expect(f.service.api.getActiveContext()!.selection!.start.character).toBe(8);
    expect(f.registered.get('markdown-editor.getActiveContext')!()).toEqual({ panelId: 'A', uri: 'vscode-remote://ssh-remote+dev/notes/tasks.md', documentVersion: 7, selectionStatus: 'exact', selection: { start: { line: 0, character: 8 }, end: { line: 0, character: 12 } } });
    f.service.dispose();
  });
  it('delivers events and stops subscriptions after disposal', () => {
    const f = fixture(); const events: any[] = [];
    const listener = f.service.api.onDidChangeActiveContext(value => events.push(value));
    f.set({ panelId: 'B', uri: vscode.Uri.file('/B.md'), documentVersion: 1, selectionStatus: 'unavailable' });
    f.set(undefined);
    expect(events.map(value => value?.panelId)).toEqual(['B', undefined]);
    listener.dispose(); f.set(undefined); expect(events).toHaveLength(2);
    f.service.dispose(); f.service.dispose();
    expect(f.service.api.getActiveContext()).toBeUndefined();
  });
});

it('keeps a Uri object for opt-in cross-host transformation while preserving default JSON', () => {
  const f = fixture(); const uri = vscode.Uri.file('/notes/tasks.md');
  f.set({ panelId: 'remote', uri, documentVersion: 2, selectionStatus: 'unavailable' });
  const callback = f.registered.get('markdown-editor.getActiveContext')!;
  expect(callback({ uriFormat: 'object' }).uri).toBeInstanceOf(vscode.Uri);
  expect(callback().uri).toBe('file:///notes/tasks.md');
  f.service.dispose();
});
