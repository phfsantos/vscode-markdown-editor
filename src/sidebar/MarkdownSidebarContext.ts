import * as vscode from 'vscode';
import {
  DefaultEditorChecker,
  LinkGraphGenerator,
  RelationshipAnalyzer,
  TemplateManager
} from '../services';
import {
  Backlink,
  CacheStatus,
  Link,
  RelatedFile
} from '../services/RelationshipAnalyzer';
import { TagManager } from '../services/TagManager';
import { EditorPanel } from '../app/EditorPanel';

export interface GraphRequestOptions {
  depth: number;
  maxNodes: number;
}

export interface SidebarGraphData {
  nodes: Array<{ id: string; label: string; path?: string; isFocus?: boolean }>;
  edges: Array<{ source: string; target: string; type: string }>;
}

export interface SidebarTemplateItem {
  id: string;
  name: string;
  description: string;
  category: 'builtin' | 'user';
}

export interface SidebarEmbedItem {
  raw: string;
  filename: string;
  resolved: string | null;
}

function getMimeForExt(ext: string): string {
  if (!ext) {
    return '';
  }

  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    bmp: 'image/bmp',
    md: 'text/markdown',
    markdown: 'text/markdown',
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    yaml: 'text/yaml',
    yml: 'text/yaml',
    html: 'text/html',
    htm: 'text/html',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    webm: 'video/webm',
    pdf: 'application/pdf',
    zip: 'application/zip'
  };

  return map[ext] || '';
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const byte1 = bytes[index];
    const byte2 = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const byte3 = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const chunk = (byte1 << 16) | (byte2 << 8) | byte3;

    output += alphabet[(chunk >> 18) & 63];
    output += alphabet[(chunk >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(chunk >> 6) & 63] : '=';
    output += index + 2 < bytes.length ? alphabet[chunk & 63] : '=';
  }

  return output;
}

function basename(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

export class MarkdownSidebarContext implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly cacheStatusEmitter = new vscode.EventEmitter<CacheStatus>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly relationshipAnalyzer = RelationshipAnalyzer.getInstance();
  private readonly graphGenerator = LinkGraphGenerator.getInstance();
  private readonly templateManager = TemplateManager.getInstance();
  private readonly defaultEditorChecker = DefaultEditorChecker.getInstance();
  private readonly tagManager = TagManager.getInstance();
  /**
   * Canonical active Markdown document for sidebar consumers and dependent views.
   * Text-editor, visible-editor, and custom-editor events all converge here so
   * consumers do not need to reconcile those host-specific sources themselves.
   */
  private activeDocument?: vscode.TextDocument;

  private static currentInstance: MarkdownSidebarContext | undefined;
  private static readonly activeDocumentEmitter = new vscode.EventEmitter<
    vscode.TextDocument | undefined
  >();

  public static readonly onDidChangeActiveDocument =
    MarkdownSidebarContext.activeDocumentEmitter.event;

  public readonly onDidChange = this.changeEmitter.event;
  public readonly onDidChangeCacheStatus = this.cacheStatusEmitter.event;

  constructor(private readonly extensionContext: vscode.ExtensionContext) {
    void this.templateManager.loadUserTemplates();

    this.relationshipAnalyzer.onCacheStatusChange((status) => {
      this.cacheStatusEmitter.fire(status);
      this.changeEmitter.fire();
    });

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
          (editor) => editor.document.languageId === 'markdown' && !this.isSystemView(editor.document)
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
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (this.activeDocument && event.document.uri.toString() === this.activeDocument.uri.toString()) {
          this.changeEmitter.fire();
        }
      }),
      EditorPanel.onDidChangeActiveDocument((document: vscode.TextDocument | undefined) => {
        if (document?.languageId === 'markdown') {
          this.setActiveDocument(document);
          return;
        }

        this.setActiveDocument(undefined);
      })
    );

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor?.document.languageId === 'markdown') {
      this.activeDocument = activeEditor.document;
    } else {
      const visibleMarkdownEditor = vscode.window.visibleTextEditors.find(
        (editor) => editor.document.languageId === 'markdown'
      );
      this.activeDocument = visibleMarkdownEditor?.document;
    }

    MarkdownSidebarContext.currentInstance = this;
    MarkdownSidebarContext.activeDocumentEmitter.fire(this.activeDocument);
  }

  public static getCurrentActiveDocument(): vscode.TextDocument | undefined {
    return MarkdownSidebarContext.currentInstance?.activeDocument;
  }

  public getActiveDocument(): vscode.TextDocument | undefined {
    return this.activeDocument;
  }

  public refresh(): void {
    this.changeEmitter.fire();
  }

  public isDefaultEditor(): boolean {
    return this.defaultEditorChecker.isDefaultEditor();
  }

  public getCacheStatus(): CacheStatus {
    return this.relationshipAnalyzer.getCacheStatus();
  }

  public getTemplates(): SidebarTemplateItem[] {
    return this.templateManager.getAllTemplates().map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category
    }));
  }

  public async getDocumentTags(): Promise<string[]> {
    if (!this.activeDocument) {
      return [];
    }

    return TagManager.extractTagsFromText(this.activeDocument.getText());
  }

  public async getWorkspaceTags(): Promise<{ tag: string; count: number }[]> {
    return this.tagManager.getAllTags();
  }

  public async getEmbeds(): Promise<SidebarEmbedItem[]> {
    if (!this.activeDocument) {
      return [];
    }

    return this.extractEmbeds(this.activeDocument.getText());
  }

  public async getOutgoingLinks(): Promise<Link[]> {
    if (!this.activeDocument) {
      return [];
    }

    return this.relationshipAnalyzer.getOutgoingLinks(this.activeDocument.uri);
  }

  public async getBacklinks(): Promise<Backlink[]> {
    if (!this.activeDocument) {
      return [];
    }

    return this.relationshipAnalyzer.getBacklinks(this.activeDocument.uri);
  }

  public async getRelatedFiles(): Promise<RelatedFile[]> {
    if (!this.activeDocument) {
      return [];
    }

    return this.relationshipAnalyzer.getRelatedFiles(this.activeDocument.uri, 5);
  }

  public async getGraphData(options: GraphRequestOptions): Promise<SidebarGraphData | null> {
    if (!this.activeDocument) {
      return null;
    }

    return this.graphGenerator.generateSimplifiedGraph(
      this.activeDocument.uri,
      Math.max(1, Math.min(3, options.depth)),
      Math.max(5, Math.min(50, options.maxNodes))
    );
  }

  public async createNoteFromTemplate(templateId: string): Promise<void> {
    const document = await this.templateManager.createNoteFromTemplate(templateId);
    await vscode.window.showTextDocument(document);
    const savedUri = await vscode.workspace.saveAs(document.uri);

    if (savedUri) {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await vscode.commands.executeCommand('vscode.open', savedUri);
    }
  }

  public async previewEmbed(embed?: SidebarEmbedItem | { resolved?: string | null; raw?: string }): Promise<void> {
    const resolvedPath = embed?.resolved || undefined;
    const raw = embed?.raw || undefined;
    await this.openEmbedInEditor(resolvedPath, raw);
  }

  public async rebuildCache(): Promise<void> {
    await this.relationshipAnalyzer.rebuildCache();
    this.changeEmitter.fire();
  }

  public dispose(): void {
    if (MarkdownSidebarContext.currentInstance === this) {
      MarkdownSidebarContext.currentInstance = undefined;
      MarkdownSidebarContext.activeDocumentEmitter.fire(undefined);
    }

    this.changeEmitter.dispose();
    this.cacheStatusEmitter.dispose();
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  private setActiveDocument(document?: vscode.TextDocument): void {
    const currentUri = this.activeDocument?.uri.toString();
    const nextUri = document?.uri.toString();
    if (currentUri === nextUri) {
      return;
    }

    this.activeDocument = document;
    MarkdownSidebarContext.activeDocumentEmitter.fire(document);
    this.changeEmitter.fire();
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

    const scheme = document.uri.scheme;
    if (['output', 'debug', 'vscode-terminal', 'git', 'extension'].includes(scheme)) {
      return true;
    }

    const systemLanguageIds = [
      'Log',
      'log',
      'plaintext',
      'scminput',
      'search-result',
      'interactive',
      'vscode-interactive-input'
    ];

    return (
      document.languageId.includes('.output') ||
      document.languageId.includes('frontmatter.project.output') ||
      systemLanguageIds.includes(document.languageId)
    );
  }

  private async extractEmbeds(content: string): Promise<SidebarEmbedItem[]> {
    const embedRegex = /!\[\[([^\]]+)\]\]/g;
    const embeds: SidebarEmbedItem[] = [];
    let match: RegExpExecArray | null;

    while ((match = embedRegex.exec(content)) !== null) {
      const raw = (match[1] || '').replace(/<[^>]+>/g, '').trim();
      const pipeIndex = raw.indexOf('|');
      let filename = pipeIndex === -1 ? raw : raw.substring(0, pipeIndex);
      const hashIndex = filename.indexOf('#');

      if (hashIndex !== -1) {
        filename = filename.substring(0, hashIndex);
      }

      filename = filename.replace(/\.md$/, '').trim();
      const resolved = await this.relationshipAnalyzer.findFileByName(filename);
      embeds.push({ raw: match[1], filename, resolved });
    }

    return embeds;
  }

  private async openEmbedInEditor(resolvedPath?: string, raw?: string): Promise<void> {
    if (!this.activeDocument) {
      vscode.window.showInformationMessage('No active markdown document to preview embed in');
      return;
    }

    try {
      const editor = await EditorPanel.createOrShow(this.extensionContext, this.activeDocument.uri);
      if (editor && editor['_panel'] && editor['_panel'].webview) {
        const payload = await this.buildEmbedPayload(resolvedPath, raw);
        editor['_panel'].webview.postMessage({
          command: 'openEmbedPreview',
          embed: payload
        });
        return;
      }
    } catch {
      // fall back to regular open below
    }

    if (resolvedPath) {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(resolvedPath));
    }
  }

  private async buildEmbedPayload(resolvedPath?: string, raw?: string): Promise<any> {
    const payload: any = { path: resolvedPath, raw };
    if (!resolvedPath) {
      return payload;
    }

    try {
      const uri = vscode.Uri.file(resolvedPath);
      const stat = await vscode.workspace.fs.stat(uri);
      payload.fileName = basename(uri.fsPath);
      payload.size = stat.size;

      const config = vscode.workspace.getConfiguration('markdown-editor');
      const defaultLimit = config.get<number>('previewEmbedSizeLimit', 5 * 1024 * 1024);
      const imageLimit = config.get<number>('previewEmbedImageLimit', 8 * 1024 * 1024);
      const textLimit = config.get<number>('previewEmbedTextLimit', 200 * 1024);
      const ext = payload.fileName.split('.').pop()?.toLowerCase() || '';
      const mime = getMimeForExt(ext) || (ext ? 'application/octet-stream' : '');

      payload.mimeType = mime;

      const isImage = mime.startsWith('image/');
      const isText = mime.startsWith('text/') || mime === 'application/json' || mime === 'text/markdown';
      const effectiveLimit = isImage ? imageLimit : isText ? textLimit : defaultLimit;
      if (payload.size > effectiveLimit) {
        payload.note = `File too large to embed inline (${Math.round(payload.size / 1024)} KB).`;
        return payload;
      }

      const bytes = await vscode.workspace.fs.readFile(uri);
      if (isImage) {
        payload.dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
      } else if (isText) {
        const document = await vscode.workspace.openTextDocument(uri);
        payload.text = document.getText();
      } else {
        payload.dataUrl = `data:${mime || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
      }
    } catch {
      return payload;
    }

    return payload;
  }
}
