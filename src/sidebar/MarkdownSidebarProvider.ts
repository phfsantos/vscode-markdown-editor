import * as vscode from 'vscode';
import * as path from 'path';
import { 
  RelationshipAnalyzer, 
  LinkGraphGenerator, 
  TemplateManager, 
  DefaultEditorChecker 
} from '../services';
import { TagManager } from '../services/TagManager';
import { EditorPanel } from '../app/EditorPanel';

function getMimeForExt(ext: string): string {
  if (!ext) return '';
  // Try runtime mime-types if available
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mime = require('mime-types');
    if (mime && typeof mime.lookup === 'function') {
      return mime.lookup(ext) || '';
    }
  } catch (e) {
    // ignore
  }

  // Fallback minimal map
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

/**
 * Provides the Obsidian-style sidebar webview for markdown tools
 */
export class MarkdownSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'markdown-sidebar';
  private _view?: vscode.WebviewView;
  private _activeDocument?: vscode.TextDocument;
  private _disposables: vscode.Disposable[] = [];
  private relationshipAnalyzer: RelationshipAnalyzer;
  private graphGenerator: LinkGraphGenerator;
  private templateManager: TemplateManager;
  private defaultEditorChecker: DefaultEditorChecker;
  private tagManager: TagManager;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {
    // Initialize services
    this.relationshipAnalyzer = RelationshipAnalyzer.getInstance();
    this.graphGenerator = LinkGraphGenerator.getInstance();
    this.templateManager = TemplateManager.getInstance();
    this.defaultEditorChecker = DefaultEditorChecker.getInstance();
  this.tagManager = TagManager.getInstance();

    // Load user templates
    this.templateManager.loadUserTemplates();
    
    // Track active editor changes
    vscode.window.onDidChangeActiveTextEditor(editor => {
      console.log('[Sidebar-Debug] Active editor changed:', {
        hasEditor: !!editor,
        languageId: editor?.document.languageId,
        fileName: editor?.document.fileName
      });
      
      if (editor?.document.languageId === 'markdown') {
        this._activeDocument = editor.document;
        console.log('[Sidebar-Debug] Set active document:', this._activeDocument.fileName);
        this._updateView();
      } else {
        // Editor closed or non-markdown file, clear active document
        this._activeDocument = undefined;
        console.log('[Sidebar-Debug] Cleared active document (non-markdown or no editor)');
        this._updateView();
      }
    });

    // Track visible text editors changes (for when switching between already-open tabs)
    vscode.window.onDidChangeVisibleTextEditors(editors => {
      console.log('[Sidebar-Debug] Visible editors changed:', editors.length);
      const markdownEditor = editors.find(e => e.document.languageId === 'markdown');
      if (markdownEditor) {
        this._activeDocument = markdownEditor.document;
        console.log('[Sidebar-Debug] Set active document from visible editors:', this._activeDocument.fileName);
        this._updateView();
      } else {
        // No markdown editors visible, clear active document
        this._activeDocument = undefined;
        console.log('[Sidebar-Debug] Cleared active document (no markdown editors visible)');
        this._updateView();
      }
    });

    // Track document changes
    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document === this._activeDocument) {
        console.log('[Sidebar-Debug] Active document content changed');
        this._updateView();
      }
    });

    // Listen to custom editor panel changes
    this._disposables.push(
      EditorPanel.onDidChangeActiveDocument((doc: vscode.TextDocument | undefined) => {
        console.log('[Sidebar-Debug] Custom editor changed, document:', doc ? {
          fileName: doc.fileName,
          languageId: doc.languageId
        } : 'none');
        
        if (doc?.languageId === 'markdown') {
          this._activeDocument = doc;
          console.log('[Sidebar-Debug] Set active document from custom editor:', this._activeDocument?.fileName);
          this._updateView();
        } else {
          // No document or non-markdown document
          this._activeDocument = undefined;
          console.log('[Sidebar-Debug] Cleared active document from custom editor');
          this._updateView();
        }
      })
    );

    // Initialize with current active editor if it's markdown
    const activeEditor = vscode.window.activeTextEditor;
    console.log('[Sidebar-Debug] Initial active editor:', {
      hasEditor: !!activeEditor,
      languageId: activeEditor?.document.languageId,
      fileName: activeEditor?.document.fileName
    });
    
    if (activeEditor?.document.languageId === 'markdown') {
      this._activeDocument = activeEditor.document;
      console.log('[Sidebar-Debug] Initial active document set:', this._activeDocument.fileName);
    } else {
      // No markdown editor active, check visible editors
      const markdownEditor = vscode.window.visibleTextEditors.find(e => e.document.languageId === 'markdown');
      if (markdownEditor) {
        this._activeDocument = markdownEditor.document;
        console.log('[Sidebar-Debug] Initial active document set from visible editors:', this._activeDocument.fileName);
      }
    }
  }

  /**
   * Open embed preview inline in the active editor's webview (vditor)
   */
  private async _openEmbedInEditor(resolvedPath: string | undefined, raw: string | undefined): Promise<void> {
    if (!this._activeDocument) {
      vscode.window.showInformationMessage('No active markdown document to preview embed in');
      return;
    }

    try {
      // Ensure the editor panel for the active document exists
      const editor = await EditorPanel.createOrShow(this._context, this._activeDocument.uri);

      if (editor && editor['_panel'] && editor['_panel'].webview) {
        // If we have a resolved path, try to read the file and attach inline data so the webview can render it
        let payload: any = { path: resolvedPath, raw };
        if (resolvedPath) {
          try {
            const uri = vscode.Uri.file(resolvedPath);
            const stat = await vscode.workspace.fs.stat(uri);
            payload.fileName = uri.path.split('/').slice(-1)[0];
            payload.size = stat.size;

            // Configurable size limits (bytes)
            const config = vscode.workspace.getConfiguration('markdown-editor');
            const defaultLimit = config.get<number>('previewEmbedSizeLimit', 5 * 1024 * 1024); // fallback 5 MB
            const imageLimit = config.get<number>('previewEmbedImageLimit', 8 * 1024 * 1024); // 8 MB default for images
            const textLimit = config.get<number>('previewEmbedTextLimit', 200 * 1024); // 200 KB default for text

            const ext = payload.fileName.split('.').pop()?.toLowerCase() || '';
            const mime = getMimeForExt(ext) || (ext ? `application/octet-stream` : '');
            payload.mimeType = mime;

            // Per-type decision for embedding
            const isImage = mime.startsWith('image/');
            const isText = mime.startsWith('text/') || mime === 'application/json' || mime === 'text/markdown';

            const effectiveLimit = isImage ? imageLimit : isText ? textLimit : defaultLimit;

            if (payload.size > effectiveLimit) {
              payload.note = `File too large to embed inline (${Math.round(payload.size / 1024)} KB).`;
            } else {
              const bytes = await vscode.workspace.fs.readFile(uri);
              if (isImage) {
                const base64 = Buffer.from(bytes).toString('base64');
                payload.dataUrl = `data:${mime};base64,${base64}`;
              } else if (isText) {
                payload.text = Buffer.from(bytes).toString('utf8');
              } else {
                const base64 = Buffer.from(bytes).toString('base64');
                payload.dataUrl = `data:${mime || 'application/octet-stream'};base64,${base64}`;
              }
            }
          } catch (err) {
            console.error('[Sidebar-Debug] Failed to read embed file:', err);
          }
        }

        editor['_panel'].webview.postMessage({
          command: 'openEmbedPreview',
          embed: payload
        });
      } else {
        // Fallback: open the file normally (if resolvedPath is a file)
        if (resolvedPath) {
          await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(resolvedPath));
        }
      }
    } catch (error) {
      console.error('[Sidebar-Debug] Failed to open embed in editor:', error);
      if (resolvedPath) {
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(resolvedPath));
      }
    }
  }

  /**
   * Called when the view is resolved and becomes visible
   */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void | Thenable<void> {
    console.log('[Sidebar-Debug] Resolving webview view');
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'sidebar-dist')
      ]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    console.log('[Sidebar-Debug] HTML set, setting up message handler');

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      console.log('[Sidebar-Debug] Received message from webview:', message.command);
      switch (message.command) {
        case 'openFile':
          await this._openFile(message.filePath);
          break;
        case 'createNote':
          await this._createNoteFromTemplate(message.template);
          break;
        case 'setDefaultEditor':
          await this._setAsDefaultEditor();
          break;
        case 'openGraphView':
          await this._openGraphView();
          break;
        case 'openEmbed':
          await this._openEmbedInEditor(message.path, message.raw);
          break;
        case 'buildEmbedForPreview':
          // The editor requested we build an embed payload for a given fullPath and send it back to the editor webview
          try {
            const fullPath = message.fullPath;
            // Build payload same as _openEmbedInEditor but send to the EditorPanel webview
            const editorPanel = await EditorPanel.createOrShow(this._context, this._activeDocument?.uri!);
            let payload: any = { path: fullPath };
            if (fullPath) {
              try {
                const uri = vscode.Uri.file(fullPath);
                const stat = await vscode.workspace.fs.stat(uri);
                payload.fileName = uri.path.split('/').slice(-1)[0];
                payload.size = stat.size;
                const ext = payload.fileName.split('.').pop()?.toLowerCase() || '';
                const mime = getMimeForExt(ext) || (ext ? `application/octet-stream` : '');
                payload.mimeType = mime;
                const config = vscode.workspace.getConfiguration('markdown-editor');
                const defaultLimit = config.get<number>('previewEmbedSizeLimit', 5 * 1024 * 1024);
                const imageLimit = config.get<number>('previewEmbedImageLimit', 8 * 1024 * 1024);
                const textLimit = config.get<number>('previewEmbedTextLimit', 200 * 1024);
                const isImage = mime.startsWith('image/');
                const isText = mime.startsWith('text/') || mime === 'application/json' || mime === 'text/markdown';
                const effectiveLimit = isImage ? imageLimit : isText ? textLimit : defaultLimit;
                if (payload.size > effectiveLimit) {
                  payload.note = `File too large to embed inline (${Math.round(payload.size / 1024)} KB).`;
                } else {
                  const bytes = await vscode.workspace.fs.readFile(uri);
                  if (isImage) {
                    const base64 = Buffer.from(bytes).toString('base64');
                    payload.dataUrl = `data:${mime};base64,${base64}`;
                  } else if (isText) {
                    payload.text = Buffer.from(bytes).toString('utf8');
                  } else {
                    const base64 = Buffer.from(bytes).toString('base64');
                    payload.dataUrl = `data:${mime || 'application/octet-stream'};base64,${base64}`;
                  }
                }
              } catch (err) {
                console.error('[Sidebar-Debug] Failed to build embed payload:', err);
              }
            }

            // Send directly to the EditorPanel webview (it will display via openEmbedPreview handler)
            if (editorPanel && editorPanel['_panel'] && editorPanel['_panel'].webview) {
              editorPanel['_panel'].webview.postMessage({ command: 'openEmbedPreview', embed: payload });
            }
          } catch (err) {
            console.error('[Sidebar-Debug] buildEmbedForPreview failed', err);
          }
          break;
        case 'refreshGraph':
          await this._updateView(message.depth, message.maxNodes);
          break;
        case 'refresh':
          this._updateView();
          break;
      }
    });

    // Initial update
    console.log('[Sidebar-Debug] Triggering initial update');
    this._updateView();
  }

  /**
   * Update the webview with current document data
   */
  private async _updateView(depth?: number, maxNodes?: number): Promise<void> {
    if (!this._view) {
      console.log('[Sidebar-Debug] No view available for update');
      return;
    }

    try {
      console.log('[Sidebar-Debug] Updating view...', { depth, maxNodes });
      const data = await this._gatherDocumentData(depth, maxNodes);
      console.log('[Sidebar-Debug] Gathered data:', {
        hasActiveDocument: data.hasActiveDocument,
        outgoingLinksCount: data.outgoingLinks?.length || 0,
        backlinksCount: data.backlinks?.length || 0,
        relatedFilesCount: data.relatedFiles?.length || 0
      });
      
      this._view.webview.postMessage({
        type: 'update',
        data
      });
    } catch (error) {
      console.error('[Sidebar-Debug] Error updating view:', error);
      // Send update anyway to reset loading state
      this._view.webview.postMessage({
        type: 'update',
        data: {
          hasActiveDocument: false,
          isDefaultEditor: this.defaultEditorChecker.isDefaultEditor()
        }
      });
    }
  }

  /**
   * Gather all data about the current document using services
   */
  private async _gatherDocumentData(depth: number = 1, maxNodes: number = 15): Promise<any> {
    if (!this._activeDocument) {
      return {
        hasActiveDocument: false,
        isDefaultEditor: this.defaultEditorChecker.isDefaultEditor()
      };
    }

    // Validate and clamp parameters
    depth = Math.max(1, Math.min(3, depth));
    maxNodes = Math.max(5, Math.min(50, maxNodes));

    const fileUri = this._activeDocument.uri;

    try {
      // Generate simplified graph data for webview
      const graphData = await this.graphGenerator.generateSimplifiedGraph(fileUri, depth, maxNodes);
      // Extract tags and embeds from current document
      const tags = this.extractTags(this._activeDocument.getText());
      let embeds = await this.extractEmbeds(this._activeDocument.getText());

      // Sanitize embed object fields in case editor DOM injected stray HTML into the raw values
      embeds = embeds.map((e: any) => {
        const clean = (s: string) => (s || '').toString().replace(/<[^>]+>/g, '').trim();
        return {
          raw: clean(e.raw),
          filename: clean(e.filename),
          resolved: clean(e.resolved),
        };
      });

      const globalTags = await this.tagManager.getAllTags();

      return {
        hasActiveDocument: true,
        currentFile: {
          path: fileUri.fsPath,
          name: path.basename(fileUri.fsPath),
          content: this._activeDocument.getText()
        },
        outgoingLinks: await this.relationshipAnalyzer.getOutgoingLinks(fileUri),
        backlinks: await this.relationshipAnalyzer.getBacklinks(fileUri),
        relatedFiles: await this.relationshipAnalyzer.getRelatedFiles(fileUri, 5),
  tags,
  tagCloud: this.buildTagCloud(tags),
  globalTags,
        embeds,
        graphData: graphData,
        isDefaultEditor: this.defaultEditorChecker.isDefaultEditor()
      };
    } catch (error) {
      console.error('[Sidebar-Debug] Error gathering graph data:', error);
      // Return data without graph if generation fails
      return {
        hasActiveDocument: true,
        currentFile: {
          path: fileUri.fsPath,
          name: path.basename(fileUri.fsPath),
          content: this._activeDocument.getText()
        },
        outgoingLinks: await this.relationshipAnalyzer.getOutgoingLinks(fileUri),
        backlinks: await this.relationshipAnalyzer.getBacklinks(fileUri),
        relatedFiles: await this.relationshipAnalyzer.getRelatedFiles(fileUri, 5),
        graphData: null,
        isDefaultEditor: this.defaultEditorChecker.isDefaultEditor()
      };
    }
  }

  /**
   * Extract tags (e.g. #tag) from content
   */
  private extractTags(content: string): string[] {
    const tagRegex = /(^|\s)#([a-zA-Z0-9_\-\/]+)\b/gm;
    const tags: string[] = [];
    let m;
    while ((m = tagRegex.exec(content)) !== null) {
      tags.push(m[2]);
    }
    return Array.from(new Set(tags));
  }

  /**
   * Build a simple tag cloud as an array of {tag, count}
   */
  private buildTagCloud(tags: string[]): { tag: string; count: number }[] {
    const counts: Record<string, number> = {};
    tags.forEach(t => counts[t] = (counts[t] || 0) + 1);
    return Object.keys(counts).map(tag => ({ tag, count: counts[tag] }));
  }

  /**
   * Extract embed references like ![[filename]] and resolve to file paths when possible
   */
  private async extractEmbeds(content: string): Promise<any[]> {
    const embedRegex = /!\[\[([^\]]+)\]\]/g;
    const embeds: any[] = [];
    let m;
    while ((m = embedRegex.exec(content)) !== null) {
      // Raw content inside ![[...]] may have been polluted by previous webview DOM serialization
      // (for example stray <button> HTML). Strip any HTML tags to avoid showing markup in the sidebar.
      const raw = (m[1] || '').replace(/<[^>]+>/g, '').trim();
      // strip heading/alias
      const pipeIndex = raw.indexOf('|');
      let filename = pipeIndex === -1 ? raw : raw.substring(0, pipeIndex);
      const hashIndex = filename.indexOf('#');
      if (hashIndex !== -1) filename = filename.substring(0, hashIndex);
      filename = filename.replace(/\.md$/, '').trim();

      const resolved = await this.relationshipAnalyzer.findFileByName(filename);
      embeds.push({ raw: m[1], filename, resolved });
    }
    return embeds;
  }

  /**
   * Find files that link to the current file (backlinks)
   */
  private async _findBacklinks(currentFilePath: string): Promise<any[]> {
    const backlinks: any[] = [];
    const currentFileName = path.basename(currentFilePath, '.md');
    
    // Search all markdown files in workspace
    const files = await vscode.workspace.findFiles('**/*.md');
    
    for (const file of files) {
      if (file.fsPath === currentFilePath) {
        continue; // Skip current file
      }
      
      const doc = await vscode.workspace.openTextDocument(file);
      const content = doc.getText();
      
      // Check for links to current file
      const hasLink = content.includes(`(${path.basename(currentFilePath)})`) ||
                     content.includes(`[[${currentFileName}]]`);
      
      if (hasLink) {
        backlinks.push({
          path: file.fsPath,
          name: path.basename(file.fsPath),
          relativePath: vscode.workspace.asRelativePath(file)
        });
      }
    }
    
    return backlinks;
  }

  /**
   * Find files related to the current file
   */
  private async _findRelatedFiles(currentFilePath: string): Promise<any[]> {
    const relatedFiles: any[] = [];
    const currentDir = path.dirname(currentFilePath);
    
    // Find files in same directory
    const pattern = new vscode.RelativePattern(currentDir, '*.md');
    const files = await vscode.workspace.findFiles(pattern);
    
    for (const file of files) {
      if (file.fsPath !== currentFilePath) {
        relatedFiles.push({
          path: file.fsPath,
          name: path.basename(file.fsPath),
          proximity: 'same-folder'
        });
      }
    }
    
    return relatedFiles.slice(0, 5); // Limit to 5 most relevant
  }

  /**
   * Set this extension as default editor
   */
  private async _setAsDefaultEditor(): Promise<void> {
    await this.defaultEditorChecker.setAsDefaultEditor();
    this._updateView();
  }

  /**
   * Open a file in the editor
   */
  private async _openFile(filePath: string): Promise<void> {
    const uri = vscode.Uri.file(filePath);
    
    // Open with the default editor for .md files (which should be our custom editor)
    // Use vscode.open command which respects the default editor setting
    await vscode.commands.executeCommand('vscode.open', uri);
  }

  /**
   * Create a new note from a template using TemplateManager
   */
  private async _createNoteFromTemplate(templateId: string): Promise<void> {
    const doc = await this.templateManager.createNoteFromTemplate(templateId);
    
    // First show the document to allow user to save it
    const editor = await vscode.window.showTextDocument(doc);
    
    // Prompt user to save the file
    const saved = await vscode.workspace.saveAs(doc.uri);
    
    if (saved) {
      // Close the text editor
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      
      // Open with default editor (which should be our custom editor)
      await vscode.commands.executeCommand('vscode.open', saved);
    }
  }

  /**
   * Open the graph view in a new editor
   */
  private async _openGraphView(): Promise<void> {
    // Use tracked _activeDocument if available, otherwise fallback to active editor
    let docUri: string | undefined = undefined;
    if (this._activeDocument) {
      docUri = this._activeDocument.uri.toString();
    } else {
      const activeEditor = vscode.window.activeTextEditor;
      const activeMarkdownDoc = activeEditor?.document.languageId === 'markdown'
        ? activeEditor.document
        : undefined;
      docUri = activeMarkdownDoc ? activeMarkdownDoc.uri.toString() : undefined;
    }
    vscode.commands.executeCommand('markdown-editor.openGraphView', docUri);
  }

  /**
   * Get HTML content for the webview
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'sidebar-dist', 'sidebar.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'sidebar-dist', 'sidebar.css')
    );
    const codiconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'sidebar-dist', 'codicon.css')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${codiconsUri}" rel="stylesheet">
  <link href="${styleUri}" rel="stylesheet">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
