import * as vscode from 'vscode';
import type { ActiveDocumentEvents } from '../contracts/ports';
import type { EditorContextRegistry } from './EditorContextRegistry';

/** Legacy internal projection. Public custom-editor context lives in the registry. */
export class ActiveDocumentContext implements ActiveDocumentEvents {
  private readonly emitter = new vscode.EventEmitter<vscode.TextDocument | undefined>();
  private readonly disposables: vscode.Disposable[] = [];
  private current?: vscode.TextDocument;
  public readonly onDidChangeActiveDocument = this.emitter.event;

  public constructor(private readonly registry: EditorContextRegistry) {
    this.disposables.push(
      registry.onDidChangeActiveContext(() => this.refresh()),
      vscode.window.tabGroups.onDidChangeTabs(() => this.refresh()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => this.refresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
    );
    this.refresh();
  }

  public get activeDocument(): vscode.TextDocument | undefined { return this.current; }

  /** Compatibility entry point; callers cannot override the active tab. */
  public setActiveDocument(_document: vscode.TextDocument | undefined): void { this.refresh(); }

  private refresh(): void {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const document = this.registry.activeDocument ?? (input instanceof vscode.TabInputText
      ? vscode.workspace.textDocuments.find(doc => doc.languageId === 'markdown' && doc.uri.toString() === input.uri.toString())
      : undefined);
    if (this.current === document) return;
    this.current = document;
    this.emitter.fire(document);
  }

  public dispose(): void {
    this.disposables.forEach(disposable => disposable.dispose());
    this.emitter.dispose();
  }
}
