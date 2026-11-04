import * as vscode from 'vscode';
import { isSourceRange, type SourceRange } from '@markdown-editor/core';
import type { MarkdownStudioContext } from '../integration/MarkdownStudioApi';

interface Host {
  tabGroups: Pick<typeof vscode.window.tabGroups, 'activeTabGroup' | 'onDidChangeTabs' | 'onDidChangeTabGroups'>;
  onDidChangeTextDocument: typeof vscode.workspace.onDidChangeTextDocument;
}
interface Entry {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  listeners: vscode.Disposable[];
  selection?: vscode.Range;
  selectionVersion?: number;
}

/** The active tab is authoritative; panel state disambiguates duplicate resources. */
export class EditorContextRegistry implements vscode.Disposable {
  private readonly panels = new Map<string, Entry>();
  private readonly emitter = new vscode.EventEmitter<MarkdownStudioContext | undefined>();
  public readonly onDidChangeActiveContext = this.emitter.event;
  private readonly listeners: vscode.Disposable[] = [];
  private active?: MarkdownStudioContext;
  private activeTab?: vscode.Tab;
  private disposed = false;

  public constructor(private readonly host: Host = {
    tabGroups: vscode.window.tabGroups,
    onDidChangeTextDocument: vscode.workspace.onDidChangeTextDocument,
  }) {
    this.listeners.push(
      host.tabGroups.onDidChangeTabs(() => this.reconcile()),
      host.tabGroups.onDidChangeTabGroups(() => this.reconcile()),
      host.onDidChangeTextDocument(event => {
        for (const entry of this.panels.values()) {
          if (entry.document.uri.toString() === event.document.uri.toString()
            && entry.selectionVersion !== event.document.version) {
            entry.selection = undefined;
            entry.selectionVersion = undefined;
          }
        }
        this.reconcile();
      }),
    );
  }

  public registerPanel(panelId: string, document: vscode.TextDocument, panel: vscode.WebviewPanel): vscode.Disposable {
    if (this.disposed) return { dispose() {} };
    if (this.panels.has(panelId)) throw new Error(`Duplicate panel id: ${panelId}`);
    const entry: Entry = { document, panel, listeners: [] };
    this.panels.set(panelId, entry);
    const registration = { dispose: () => {
      if (this.panels.get(panelId) !== entry) return;
      this.panels.delete(panelId);
      entry.listeners.forEach(listener => listener.dispose());
      this.reconcile();
    } };
    entry.listeners.push(panel.onDidChangeViewState(() => this.reconcile()), panel.onDidDispose(registration.dispose));
    this.reconcile();
    return registration;
  }

  public invalidateSelection(panelId: string): void {
    const entry = this.panels.get(panelId);
    if (!entry) return;
    entry.selection = undefined;
    entry.selectionVersion = undefined;
    this.reconcile();
  }

  public updateSelection(panelId: string, documentVersion: number, status: 'exact' | 'unavailable', range?: SourceRange): void {
    this.reconcile();
    const entry = this.panels.get(panelId);
    if (!entry || this.active?.panelId !== panelId || !this.panelState(entry)?.active) return;
    entry.selection = undefined;
    entry.selectionVersion = undefined;
    if (status === 'exact' && documentVersion === entry.document.version && isSourceRange(range)) {
      const valid = [range.start, range.end].every(position => position.line < entry.document.lineCount
        && position.character <= entry.document.lineAt(position.line).text.length);
      if (valid) {
        entry.selection = new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character);
        entry.selectionVersion = documentVersion;
      }
    }
    this.reconcile();
  }

  public getActiveContext(): MarkdownStudioContext | undefined {
    this.reconcile();
    return this.active && this.snapshot(this.active);
  }

  public get activeDocument(): vscode.TextDocument | undefined {
    this.reconcile();
    return this.active && this.panels.get(this.active.panelId)?.document;
  }

  public reconcile(): void {
    if (this.disposed) return;
    const group = this.host.tabGroups.activeTabGroup;
    const input = group.activeTab?.input;
    let next: MarkdownStudioContext | undefined;
    if (input instanceof vscode.TabInputCustom && input.viewType === 'markdown-editor') {
      const states = new Map([...this.panels.values()].map(entry => [entry, this.panelState(entry)]));
      const candidates = [...this.panels.entries()].filter(([, entry]) =>
        entry.document.uri.toString() === input.uri.toString() && states.get(entry)?.viewColumn === group.viewColumn);
      const activePanels = candidates.filter(([, entry]) => states.get(entry)?.active);
      // Never guess between duplicate panels during out-of-order transitions.
      const retained = this.activeTab === group.activeTab
        ? candidates.find(([panelId]) => panelId === this.active?.panelId) : undefined;
      const match = activePanels.length === 1 ? activePanels[0]
        : activePanels.length === 0 ? retained : undefined;
      if (match) {
        const [panelId, entry] = match;
        const selection = entry.selectionVersion === entry.document.version ? entry.selection : undefined;
        next = { panelId, uri: entry.document.uri, documentVersion: entry.document.version,
          selectionStatus: selection ? 'exact' : 'unavailable', ...(selection ? { selection } : {}) };
      }
    }
    this.activeTab = group.activeTab;
    if (JSON.stringify(this.active) !== JSON.stringify(next)) {
      this.active = next;
      this.emitter.fire(next && this.snapshot(next));
    }
  }

  private panelState(entry: Entry): { active: boolean; viewColumn: vscode.ViewColumn | undefined } | undefined {
    // Host tab notifications can precede onDidDispose; VS Code getters then throw.
    try { return { active: entry.panel.active, viewColumn: entry.panel.viewColumn }; }
    catch { return undefined; }
  }

  private snapshot(context: MarkdownStudioContext): MarkdownStudioContext {
    const selection = context.selection;
    return { ...context, ...(selection ? { selection: new vscode.Range(selection.start.line, selection.start.character, selection.end.line, selection.end.character) } : {}) };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.forEach(listener => listener.dispose());
    for (const entry of this.panels.values()) entry.listeners.forEach(listener => listener.dispose());
    this.panels.clear();
    this.active = undefined;
    this.emitter.fire(undefined);
    this.emitter.dispose();
  }
}
