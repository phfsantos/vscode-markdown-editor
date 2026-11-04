import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import * as module from '../src/runtime/EditorContextRegistry';

function fixture() {
  const tabs = new vscode.EventEmitter<void>();
  const groups = new vscode.EventEmitter<void>();
  const changes = new vscode.EventEmitter<{ document: vscode.TextDocument }>();
  const tabGroups = { activeTabGroup: { activeTab: undefined as any, viewColumn: 1 }, onDidChangeTabs: tabs.event, onDidChangeTabGroups: groups.event };
  const registry = new module.EditorContextRegistry({ tabGroups, onDidChangeTextDocument: changes.event } as any);
  const panels = new Map<string, any>();
  const registrations = new Map<string, vscode.Disposable>();
  function open(id: string, uri = 'vscode-remote://ssh-remote+dev/notes/tasks.md', initiallyActive = false) {
    const panel = { active: initiallyActive, viewColumn: 1, onDidChangeViewState: new vscode.EventEmitter<void>(), onDidDispose: new vscode.EventEmitter<void>() };
    const doc = { uri: vscode.Uri.parse(uri), version: 1, languageId: 'markdown', getText: () => '- [ ] **Ship**', lineCount: 1, lineAt: () => ({ text: '- [ ] **Ship**' }) } as any;
    panels.set(id, { panel, doc });
    registrations.set(id, registry.registerPanel(id, doc, { get active() { return panel.active; }, viewColumn: 1, onDidChangeViewState: panel.onDidChangeViewState.event, onDidDispose: panel.onDidDispose.event } as any));
    return doc;
  }
  function activate(id: string) {
    for (const [key, entry] of panels) entry.panel.active = key === id;
    const entry = panels.get(id);
    tabGroups.activeTabGroup.activeTab = { input: new vscode.TabInputCustom(entry.doc.uri, 'markdown-editor') };
    tabs.fire();
    entry.panel.onDidChangeViewState.fire();
  }
  return { registry, open, activate, panels, changes, tabs, tabGroups, close: (id: string) => registrations.get(id)!.dispose() };
}

describe('panel context registry', () => {
  it('keeps B active when inactive A for the same URI closes', () => {
    const f = fixture(); f.open('A'); f.open('B'); f.activate('B'); f.close('A');
    expect(f.registry.getActiveContext()?.panelId).toBe('B');
    expect(f.registry.getActiveContext()?.uri.toString()).toBe('vscode-remote://ssh-remote+dev/notes/tasks.md');
  });
});

describe('tab reconciliation', () => {
  it('clears for unrelated custom tabs and final close', () => {
    const f = fixture(); f.open('A'); f.activate('A');
    f.tabGroups.activeTabGroup.activeTab.input.viewType = 'other'; f.tabs.fire();
    expect(f.registry.getActiveContext()).toBeUndefined();
    f.activate('A'); f.close('A'); f.close('A');
    expect(f.registry.getActiveContext()).toBeUndefined();
  });
  it('does not publish an inactive restored panel or stale view-state event', () => {
    const f = fixture(); f.open('A'); f.open('B', 'file:///B.md'); f.activate('B');
    f.panels.get('A').panel.onDidChangeViewState.fire();
    expect(f.registry.getActiveContext()?.panelId).toBe('B');
    f.registry.dispose(); f.registry.dispose(); f.activate('A');
    expect(f.registry.getActiveContext()).toBeUndefined();
  });
  it('keeps context when focus moves to sidebar without changing the active tab', () => {
    const f = fixture(); f.open('A'); f.activate('A'); f.tabs.fire();
    expect(f.registry.getActiveContext()?.panelId).toBe('A');
  });
  it('emits panel switches for the same URI and isolates snapshots', () => {
    const f = fixture(); f.open('A'); f.open('B'); f.activate('A');
    const received: any[] = []; f.registry.onDidChangeActiveContext(c => received.push(c));
    f.activate('B');
    expect(received.at(-1)?.panelId).toBe('B');
    const snapshot = f.registry.getActiveContext()!;
    (snapshot as any).panelId = 'corrupt';
    expect(f.registry.getActiveContext()?.panelId).toBe('B');
  });
});

describe('revision-validated selection', () => {
  const range = { start: { line: 0, character: 8 }, end: { line: 0, character: 12 } };
  it('accepts current source bounds and clears on document changes', () => {
    const f = fixture(); const doc = f.open('A'); f.activate('A');
    f.registry.updateSelection('A', 1, 'exact', range);
    expect(f.registry.getActiveContext()?.selectionStatus).toBe('exact');
    doc.version++; f.changes.fire({ document: doc });
    expect(f.registry.getActiveContext()?.selectionStatus).toBe('unavailable');
    f.registry.updateSelection('A', 1, 'exact', range);
    expect(f.registry.getActiveContext()?.selectionStatus).toBe('unavailable');
  });
  it('rejects inactive panels and invalid source bounds', () => {
    const f = fixture(); f.open('A'); f.open('B'); f.activate('B');
    f.registry.updateSelection('A', 1, 'exact', range);
    expect(f.registry.getActiveContext()?.selectionStatus).toBe('unavailable');
    for (const invalid of [ { start: { line: -1, character: 0 }, end: range.end }, { start: range.start, end: { line: 0, character: 50 } } ]) {
      f.registry.updateSelection('B', 1, 'exact', invalid);
      expect(f.registry.getActiveContext()?.selectionStatus).toBe('unavailable');
    }
    f.close('B'); f.registry.updateSelection('B', 1, 'exact', range);
    expect(f.registry.getActiveContext()).toBeUndefined();
  });
});

describe('context preservation', () => {
  it('keeps selection through dirty-only document events', () => {
    const f = fixture(); const doc = f.open('A'); f.activate('A');
    f.registry.updateSelection('A', 1, 'exact', { start: { line: 0, character: 8 }, end: { line: 0, character: 12 } });
    f.changes.fire({ document: doc });
    expect(f.registry.getActiveContext()?.selectionStatus).toBe('exact');
  });
  it('keeps tab identity while panel focus leaves the editor', () => {
    const f = fixture(); f.open('A'); f.activate('A');
    f.panels.get('A').panel.active = false;
    f.panels.get('A').panel.onDidChangeViewState.fire();
    expect(f.registry.getActiveContext()?.panelId).toBe('A');
    f.tabGroups.activeTabGroup.activeTab = undefined;
    f.tabs.fire();
    expect(f.registry.getActiveContext()).toBeUndefined();
  });
});

describe('disposed host handles', () => {
  it('clears when tab events precede panel disposal notification', () => {
    const f = fixture(); f.open('A'); f.activate('A');
    Object.defineProperty(f.panels.get('A').panel, 'active', { get() { throw new Error('Webview is disposed'); } });
    expect(() => f.tabs.fire()).not.toThrow();
    expect(f.registry.getActiveContext()).toBeUndefined();
  });
});

it('reconciles an already restored active tab when its panel registers', () => {
  const f = fixture();
  const uri = 'vscode-remote://ssh-remote+restored/notes/tasks.md';
  f.tabGroups.activeTabGroup.activeTab = { input: new vscode.TabInputCustom(vscode.Uri.parse(uri), 'markdown-editor') };
  f.open('restored', uri, true);
  expect(f.registry.getActiveContext()?.panelId).toBe('restored');
  expect(f.registry.getActiveContext()?.uri.toString()).toBe(uri);
});
