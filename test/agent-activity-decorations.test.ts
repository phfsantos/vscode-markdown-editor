import { expect, it } from 'vitest';
import * as vscode from 'vscode';
import { AgentActivityRegistry } from '../src/integration/AgentActivityRegistry';
import { AgentActivityDecorations } from '../src/integration/AgentActivityDecorations';
it('projects static badges, targeted events and active URI status with cleanup', () => {
  const registry = new AgentActivityRegistry(); const uri = vscode.Uri.parse('vscode-remote://host/notes.md');
  const events: any[] = []; let active: vscode.Uri | undefined = uri; let disposed = 0;
  const focus = new vscode.EventEmitter<void>();
  const status = { text: '', tooltip: '', name: '', show() { events.push('show'); }, hide() { events.push('hide'); }, dispose() { disposed++; } };
  let provider: any;
  const service = new AgentActivityDecorations(registry, { getActiveUri: () => active, onDidChangeActiveUri: focus.event,
    createStatusBarItem: () => status, registerFileDecorationProvider: (p: any) => { provider = p; return { dispose() { disposed++; } }; } } as any);
  const changed: any[] = []; provider.onDidChangeFileDecorations((u: any) => changed.push(u.toString()));
  const a = registry.createSession({ id: 'a', label: 'Agent A' });
  a.setActivity({ id: '1', uri, state: 'working', label: 'Editing' });
  expect(provider.provideFileDecoration(uri)).toMatchObject({ badge: 'A', propagate: false, tooltip: expect.stringContaining('Agent A') });
  expect(status.text).toContain('$(loading~spin)'); expect(status.text).toContain('working');
  expect(changed).toEqual([uri.toString()]);
  active = undefined; focus.fire(); expect(events.at(-1)).toBe('hide');
  a.clearActivity('1'); expect(provider.provideFileDecoration(uri)).toBeUndefined();
  service.dispose(); expect(disposed).toBe(2); registry.dispose();
});
it('aggregates states and bounds tooltip producer lists', () => {
  const r = new AgentActivityRegistry(); const uri = vscode.Uri.file('/a.md');
  const service = new AgentActivityDecorations(r, { getActiveUri: () => undefined,
    onDidChangeActiveUri: () => ({ dispose() {} }), createStatusBarItem: () => ({hide() {}, show() {}, dispose() {}}),
    registerFileDecorationProvider: () => ({ dispose() {} }) } as any);
  for (let i = 0; i < 5; i++) r.createSession({id: String(i), label: `Agent ${i}`}).setActivity({id:'1',uri,state:i ? 'review':'waiting',label:'Work'});
  expect(service.provideFileDecoration(uri)?.tooltip).toContain('waiting');
  expect(service.provideFileDecoration(uri)?.tooltip).toContain('+2');
  service.dispose(); r.dispose();
});
