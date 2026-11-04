import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AgentActivityRegistry } from '../src/integration/AgentActivityRegistry';
import { AgentActivityApi } from '../src/integration/AgentActivityApi';
import { MarkdownStudioApiService } from '../src/integration/MarkdownStudioApiService';
import manifest from '../package.json';
const prefix = 'markdown-editor.agentActivity.';
function fixture() {
  const registry = new AgentActivityRegistry(); const commands = new Map<string, Function>();
  const adapter = new AgentActivityApi(registry, { registerCommand: (id: string, fn: Function) => {
    commands.set(id, fn); return { dispose: () => commands.delete(id) };
  } } as any);
  const call = (name: string, arg?: any) => commands.get(prefix + name)!(arg);
  return { registry, adapter, commands, call };
}
describe('activity API/JSON command parity', () => {
  it('shares registry with direct sessions and round-trips remote URIs', () => {
    const f = fixture(); const uri = vscode.Uri.parse('vscode-remote://ssh-remote+dev/notes/tasks.md');
    const direct = f.adapter.createSession({ id: 'direct', label: 'Direct' });
    direct.setActivity({ id: 'same', uri, state: 'review', label: 'Review' });
    const credentials = f.call('startSession', { id: 'json', label: 'JSON' });
    f.call('update', { ...credentials, activity: { id: 'same', uri: uri.toString(), state: 'working', label: 'Edit' } });
    expect(f.registry.getActivities(uri).map(a => a.producer.id)).toEqual(['direct', 'json']);
    f.call('clear', { ...credentials, id: 'same' });
    expect(f.registry.getActivities(uri)).toHaveLength(1);
    f.call('heartbeat', credentials); f.call('endSession', credentials);
    direct.dispose(); f.adapter.dispose(); f.registry.dispose(); expect(f.commands.size).toBe(0);
  });
  it('rejects invalid credentials, malformed JSON and late sessions', () => {
    vi.useFakeTimers(); const f = fixture();
    const c = f.call('startSession', { id: 'a', label: 'A' });
    expect(() => f.call('heartbeat', { ...c, token: 'wrong' })).toThrow(/session/i);
    expect(() => f.call('update', { ...c, activity: { id: '1', uri: '/relative.md', state: 'working', label: 'Work' } })).toThrow(/URI/);
    expect(() => f.call('update', { ...c, activity: null })).toThrow();
    vi.advanceTimersByTime(120001);
    expect(() => f.call('heartbeat', c)).toThrow(/session/i);
    f.adapter.dispose(); f.registry.dispose(); vi.useRealTimers();
  });
  it('exposes activity on API v1 and declares every cold activation command', () => {
    const f = fixture(); const e = new vscode.EventEmitter<any>();
    const service = new MarkdownStudioApiService({getActiveContext: () => undefined, onDidChangeActiveContext: e.event }, undefined, f.adapter);
    expect(service.api.apiVersion).toBe(1);
    expect(service.api.activity).toBe(f.adapter);
    for (const name of ['startSession', 'update', 'clear', 'heartbeat', 'endSession']) expect(manifest.activationEvents).toContain('onCommand:' + prefix + name);
    service.dispose(); f.adapter.dispose(); f.registry.dispose();
  });
});
