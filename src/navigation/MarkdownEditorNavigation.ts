import * as vscode from 'vscode';
import type { SourceNavigationTarget } from '@markdown-editor/core';
import type {
  EditorOpenOptions,
  EditorPanelHandle,
  EditorSourceNavigationPanel,
} from '../runtime/ports';
import {
  canonicalDocumentKey,
  isMarkdownUri,
  parseExtensionNavigationUri,
  parsePositionFragment,
} from './MarkdownLinkTarget';

export interface MarkdownEditorNavigationDependencies {
  openEditor(
    documentOrUri: vscode.Uri | vscode.TextDocument,
    options?: EditorOpenOptions,
  ): Promise<EditorPanelHandle | undefined>;
  stat(uri: vscode.Uri): Promise<unknown>;
  showError(message: string): void;
}

export class SourcePositionDelivery implements vscode.Disposable {
  private ready = false;
  private disposed = false;
  private pending?: SourceNavigationTarget;

  constructor(private readonly postMessage: (message: unknown) => void) {}

  public reveal(target: SourceNavigationTarget): void {
    if (this.disposed) return;
    if (!this.ready) {
      this.pending = target;
      return;
    }
    this.postMessage({ command: 'revealSourcePosition', target });
  }

  public markReady(): void {
    if (this.disposed) return;
    this.ready = true;
    if (!this.pending) return;
    const target = this.pending;
    this.pending = undefined;
    this.postMessage({ command: 'revealSourcePosition', target });
  }

  public dispose(): void {
    this.disposed = true;
    this.pending = undefined;
  }
}

export class MarkdownEditorNavigation implements vscode.Disposable {
  private readonly pendingTargets = new Map<string, SourceNavigationTarget>();
  private readonly panels = new Map<string, Set<EditorSourceNavigationPanel>>();
  private readonly openingDocuments = new Map<string, Promise<EditorPanelHandle | undefined>>();
  private disposed = false;

  constructor(private readonly dependencies: MarkdownEditorNavigationDependencies) {}

  public async openEditor(
    documentOrUri: vscode.Uri | vscode.TextDocument,
    options: EditorOpenOptions = {},
  ): Promise<EditorPanelHandle | undefined> {
    if (this.disposed) return undefined;
    const uri = documentOrUri instanceof vscode.Uri ? documentOrUri : documentOrUri.uri;
    const fragmentPosition = parsePositionFragment(uri.fragment);
    const target = options.navigationTarget ?? (fragmentPosition ? {
      position: fragmentPosition,
      reveal: 'center' as const,
      highlight: true,
      origin: 'command' as const,
    } : undefined);
    const canonicalUri = fragmentPosition ? uri.with({ fragment: '' }) : uri;

    if (!target) return this.dependencies.openEditor(documentOrUri, options);
    if (!await this.validateTarget(canonicalUri)) return undefined;

    const key = canonicalDocumentKey(canonicalUri);
    const existing = this.panels.get(key)?.values().next().value as EditorSourceNavigationPanel | undefined;
    if (existing) {
      existing.reveal();
      existing.revealSourcePosition(target);
      return existing;
    }

    this.pendingTargets.set(key, target);
    const existingOpen = this.openingDocuments.get(key);
    if (existingOpen) return existingOpen;

    const opening = this.dependencies.openEditor(canonicalUri, {
      ...options,
      navigationTarget: target,
      mustExist: true,
    });
    this.openingDocuments.set(key, opening);
    try {
      const opened = await opening;
      if (!opened && this.pendingTargets.get(key) === target) this.pendingTargets.delete(key);
      return opened;
    } catch {
      if (this.pendingTargets.get(key) === target) this.pendingTargets.delete(key);
      this.dependencies.showError(`Could not open Markdown target: ${canonicalUri.toString(true)}`);
      return undefined;
    } finally {
      if (this.openingDocuments.get(key) === opening) this.openingDocuments.delete(key);
    }
  }

  public async handleUri(uri: vscode.Uri): Promise<void> {
    const parsed = parseExtensionNavigationUri(uri);
    if (!parsed) {
      this.dependencies.showError('Invalid Markdown Editor navigation link.');
      return;
    }
    await this.openEditor(parsed.uri, { navigationTarget: parsed.target });
  }

  public async previewEmbed(document: vscode.TextDocument, payload: unknown): Promise<boolean> {
    const editor = await this.openEditor(document);
    if (!editor) return false;
    editor.postMessage({ command: 'openEmbedPreview', embed: payload });
    return true;
  }

  public registerPanel(panel: EditorSourceNavigationPanel): vscode.Disposable {
    const key = canonicalDocumentKey(panel.uri);
    const registered = this.panels.get(key) ?? new Set<EditorSourceNavigationPanel>();
    registered.add(panel);
    this.panels.set(key, registered);
    return {
      dispose: () => {
        registered.delete(panel);
        if (registered.size === 0) this.panels.delete(key);
      },
    };
  }

  public consumePendingTarget(uri: vscode.Uri): SourceNavigationTarget | undefined {
    const key = canonicalDocumentKey(uri);
    const target = this.pendingTargets.get(key);
    this.pendingTargets.delete(key);
    return target;
  }

  public dispose(): void {
    this.disposed = true;
    this.pendingTargets.clear();
    this.panels.clear();
    this.openingDocuments.clear();
  }

  private async validateTarget(uri: vscode.Uri): Promise<boolean> {
    if (!['file', 'vscode-remote'].includes(uri.scheme) || !isMarkdownUri(uri)) {
      this.dependencies.showError('Source navigation supports existing Markdown files only.');
      return false;
    }
    try {
      const stat = await this.dependencies.stat(uri) as { type?: number };
      if (typeof stat.type === 'number' && (stat.type & vscode.FileType.File) === 0) {
        this.dependencies.showError(`Markdown target is not a file: ${uri.toString(true)}`);
        return false;
      }
      return true;
    } catch {
      this.dependencies.showError(`Markdown target does not exist: ${uri.toString(true)}`);
      return false;
    }
  }
}
