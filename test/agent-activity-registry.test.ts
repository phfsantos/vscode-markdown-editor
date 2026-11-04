import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AgentActivityRegistry } from '../src/integration/AgentActivityRegistry';
const uri = vscode.Uri.parse('vscode-remote://ssh-remote+dev/notes/tasks.md');
afterEach(() => vi.useRealTimers());
describe('producer activity registry', () => {
  it('isolates producer ownership and returns immutable snapshots', () => {
    const r = new AgentActivityRegistry();
    const a = r.createSession({ id: 'a', label: 'Agent A' });
    const b = r.createSession({ id: 'b', label: 'Agent B' });
    a.setActivity({ id: '1', uri, state: 'review', label: 'Review' });
    b.setActivity({ id: '1', uri, state: 'working', label: 'Editing' });
    expect(r.getSnapshot(uri).state).toBe('working');
    expect(() => { (r.getActivities(uri)[0] as any).label = 'bad'; }).toThrow();
    a.dispose(); a.dispose(); a.clearActivity('1');
    expect(r.getActivities(uri).map(x => x.producer.id)).toEqual(['b']);
    b.clearActivity('1'); b.clearActivity('1');
    expect(r.getSnapshot(uri).state).toBeUndefined(); r.dispose();
  });
  it('expires leases, renews on heartbeat/update, and rejects late updates', () => {
    vi.useFakeTimers(); const r = new AgentActivityRegistry();
    const a = r.createSession({ id: 'a', label: 'A' });
    a.setActivity({ id: '1', uri, state: 'working', label: 'Working' });
    vi.advanceTimersByTime(100_000); a.heartbeat();
    vi.advanceTimersByTime(100_000); expect(r.getActivities(uri)).toHaveLength(1);
    a.setActivity({ id: '1', uri, state: 'waiting', label: 'Waiting' });
    vi.advanceTimersByTime(120_001); expect(r.getActivities(uri)).toHaveLength(0);
    expect(() => a.heartbeat()).toThrow(/expired|closed/);
    expect(() => a.setActivity({ id: '1', uri, state: 'working', label: 'late' })).toThrow();
    r.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it('emits targeted changes only and clears all sessions on disposal', () => {
    const r = new AgentActivityRegistry(); const changed: string[] = [];
    r.onDidChange(uri => changed.push(uri.toString()));
    const a = r.createSession({ id: 'a', label: 'A' });
    const input = { id: '1', uri, state: 'working' as const, label: 'Work' };
    a.setActivity(input); a.setActivity(input); a.heartbeat();
    expect(changed).toEqual([uri.toString()]);
    r.dispose(); expect(changed).toEqual([uri.toString(), uri.toString()]);
    expect(r.getActivities(uri)).toHaveLength(0);
    expect(() => r.createSession({ id: 'b', label: 'B' })).toThrow();
  });
  it('validates external inputs and enforces session limits', () => {
    const r = new AgentActivityRegistry();
    expect(() => r.createSession({ id: '', label: 'A' })).toThrow();
    const a = r.createSession({ id: 'a', label: 'A' });
    const input = { id: '1', uri, state: 'working' as const, label: 'Work' };
    for (const bad of [{ id: 'x'.repeat(129) }, { label: 'x'.repeat(121) }, { state: 'done' }, { uri: 'file:///x' }, { task: { line: -1 } }]) {
      expect(() => a.setActivity({ ...input, ...bad } as any)).toThrow();
    }
    for (let i = 0; i < 1000; i++) a.setActivity({ ...input, id: String(i) });
    expect(() => a.setActivity({ ...input, id: 'overflow' })).toThrow(/1000/);
    a.setActivity(input); r.dispose();
  });
});
it('validates live documents and retains file activity after task invalidation', () => {
  let document = { version: 1, getText: () => '- [ ] Same\n- [ ] Same\n' };
  const r = new AgentActivityRegistry({ getDocument: () => document });
  const session = r.createSession({id:'a',label:'A'});
  const input = {id:'task',uri,state:'working' as const,label:'Work',task:{documentVersion:1,line:1,expectedLineText:'- [ ] Same'}};
  session.setActivity(input);
  expect(() => session.setActivity({...input,task:{...input.task,documentVersion:0}})).toThrow();
  document = {version:2,getText:()=>'Intro\n- [ ] Same\n- [ ] Same\n'};
  r.documentChanged(uri, document, [{rangeOffset:0,rangeLength:0,text:'Intro\n'}]);
  expect(r.getActivities(uri)[0].task).toMatchObject({line:2,documentVersion:2});
  document = {version:3,getText:()=>'Intro\n- [ ] Same\n- [x] Same\n'};
  r.documentChanged(uri,document,[{rangeOffset:19,rangeLength:1,text:'x'}]);
  expect(r.getActivities(uri)[0].task).toBeUndefined();
  expect(r.getSnapshot(uri).state).toBe('working');
  r.clearUri(uri); expect(r.getActivities(uri)).toHaveLength(0); r.dispose();
});
