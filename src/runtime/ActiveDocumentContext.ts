import * as vscode from 'vscode';
import type { ActiveDocumentEvents } from './ports';

export class ActiveDocumentContext implements ActiveDocumentEvents {
  private readonly emitter = new vscode.EventEmitter<vscode.TextDocument | undefined>();
  private readonly disposables: vscode.Disposable[] = [];
  private _activeDocument: vscode.TextDocument | undefined;

  public readonly onDidChangeActiveDocument = this.emitter.event;

  public constructor() {
    this._activeDocument = this.findInitialDocument();

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor?.document.languageId === 'markdown') {
          this.setActiveDocument(editor.document);
          return;
        }

        if (editor && this.isSystemView(editor.document)) {
          return;
        }

        if (editor && this.hasFileExtension(editor.document.uri)) {
          this.setActiveDocument(undefined);
        }
      }),
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        const markdownEditor = editors.find(
          (editor) => editor.document.languageId === 'markdown' && !this.isSystemView(editor.document),
        );

        if (markdownEditor) {
          this.setActiveDocument(markdownEditor.document);
          return;
        }

        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && this.hasFileExtension(activeEditor.document.uri)) {
          this.setActiveDocument(undefined);
        }
      }),
    );
  }

  public get activeDocument(): vscode.TextDocument | undefined {
    return this._activeDocument;
  }

  public setActiveDocument(document: vscode.TextDocument | undefined): void {
    const currentUri = this._activeDocument?.uri.toString();
    const nextUri = document?.uri.toString();
    if (currentUri === nextUri) {
      return;
    }

    this._activeDocument = document;
    this.emitter.fire(document);
  }

  public dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.emitter.dispose();
  }

  private findInitialDocument(): vscode.TextDocument | undefined {
    if (vscode.window.activeTextEditor?.document.languageId === 'markdown') {
      return vscode.window.activeTextEditor.document;
    }

    return vscode.window.visibleTextEditors.find(
      (editor) => editor.document.languageId === 'markdown' && !this.isSystemView(editor.document),
    )?.document;
  }

  private hasFileExtension(uri: vscode.Uri): boolean {
    const targetPath = uri.path;
    return targetPath.includes('.') && targetPath.lastIndexOf('.') > targetPath.lastIndexOf('/');
  }

  private isSystemView(document: vscode.TextDocument): boolean {
    const uri = document.uri.toString();
    const fileName = document.fileName;

    if (uri.includes('extension-output-') || fileName.includes('extension-output-')) {
      return true;
    }

    if (['output', 'debug', 'vscode-terminal', 'git', 'extension'].includes(document.uri.scheme)) {
      return true;
    }

    const systemLanguageIds = [
      'Log',
      'log',
      'plaintext',
      'scminput',
      'search-result',
      'interactive',
      'vscode-interactive-input',
    ];

    return (
      document.languageId.includes('.output') ||
      document.languageId.includes('frontmatter.project.output') ||
      systemLanguageIds.includes(document.languageId)
    );
  }
}
