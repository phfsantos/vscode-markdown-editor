/**
 * Link Resolver Service
 * Resolves wiki-link filenames to actual file paths and handles navigation
 */

import * as vscode from 'vscode';
import * as path from 'path';

export class LinkResolver {
  private static instance: LinkResolver;
  private fileCache: Map<string, vscode.Uri[]> = new Map();
  private lastCacheScan: number = 0;
  private readonly CACHE_TTL = 60000; // 60 seconds

  private constructor() {}

  public static getInstance(): LinkResolver {
    if (!LinkResolver.instance) {
      LinkResolver.instance = new LinkResolver();
    }
    return LinkResolver.instance;
  }

  /**
   * Resolve a wiki-link filename to a file URI
   */
  public async resolveWikiLink(
    filename: string,
    currentDocumentUri: vscode.Uri
  ): Promise<vscode.Uri | null> {
    // Ensure cache is fresh
    await this.ensureFileCache();

    // Try exact match first (with or without .md extension)
    const exactMatch = await this.findExactMatch(filename);
    if (exactMatch) {
      return exactMatch;
    }

    // Try fuzzy match
    const fuzzyMatch = await this.findFuzzyMatch(filename);
    if (fuzzyMatch) {
      return fuzzyMatch;
    }

    // Try in same directory as current document
    const sameDirectoryMatch = await this.findInSameDirectory(filename, currentDocumentUri);
    if (sameDirectoryMatch) {
      return sameDirectoryMatch;
    }

    return null;
  }

  /**
   * Find exact filename match
   */
  private async findExactMatch(filename: string): Promise<vscode.Uri | null> {
    const filenameWithExt = filename.endsWith('.md') ? filename : `${filename}.md`;
    const filenameLower = filenameWithExt.toLowerCase();

    // Check cache
    for (const [name, uris] of this.fileCache.entries()) {
      if (name.toLowerCase() === filenameLower) {
        return uris[0]; // Return first match
      }
    }

    return null;
  }

  /**
   * Find fuzzy filename match
   */
  private async findFuzzyMatch(filename: string): Promise<vscode.Uri | null> {
    const filenameLower = filename.toLowerCase();
    const matches: { uri: vscode.Uri; score: number }[] = [];

    // Score each cached file
    for (const [name, uris] of this.fileCache.entries()) {
      const nameLower = name.toLowerCase();
      
      if (nameLower.includes(filenameLower)) {
        const score = this.calculateMatchScore(filenameLower, nameLower);
        matches.push({ uri: uris[0], score });
      }
    }

    // Sort by score (highest first) and return best match
    if (matches.length > 0) {
      matches.sort((a, b) => b.score - a.score);
      return matches[0].uri;
    }

    return null;
  }

  /**
   * Find file in same directory as current document
   */
  private async findInSameDirectory(
    filename: string,
    currentDocumentUri: vscode.Uri
  ): Promise<vscode.Uri | null> {
    const currentDir = path.dirname(currentDocumentUri.fsPath);
    const filenameWithExt = filename.endsWith('.md') ? filename : `${filename}.md`;
    const targetPath = path.join(currentDir, filenameWithExt);
    const targetUri = vscode.Uri.file(targetPath);

    // Check if file exists
    try {
      await vscode.workspace.fs.stat(targetUri);
      return targetUri;
    } catch {
      return null;
    }
  }

  /**
   * Calculate match score for fuzzy matching
   */
  private calculateMatchScore(search: string, target: string): number {
    let score = 0;

    // Exact match
    if (target === search) return 100;

    // Starts with
    if (target.startsWith(search)) score += 50;

    // Word boundary match
    const words = target.split(/[\s-_]/);
    if (words.some(w => w.startsWith(search))) score += 30;

    // Contains
    if (target.includes(search)) score += 20;

    // Character proximity
    let searchIndex = 0;
    for (let i = 0; i < target.length && searchIndex < search.length; i++) {
      if (target[i] === search[searchIndex]) {
        score += 1;
        searchIndex++;
      }
    }

    return score;
  }

  /**
   * Navigate to a wiki-link target
   */
  public async navigateToWikiLink(
    filename: string | undefined,
    heading: string | undefined,
    currentDocumentUri: vscode.Uri
  ): Promise<void> {
    // Same-file heading navigation
    if (!filename && heading) {
      await this.navigateToHeadingInCurrentFile(heading, currentDocumentUri);
      return;
    }

    // Navigate to file
    if (filename) {
      const targetUri = await this.resolveWikiLink(filename, currentDocumentUri);
      
      if (targetUri) {
        // For markdown files, open with custom editor
        if (targetUri.fsPath.toLowerCase().endsWith('.md')) {
          // Import EditorPanel dynamically to avoid circular dependencies
          const { EditorPanel } = await import('../app/EditorPanel');
          const context = (global as any).extensionContext;
          
          if (context) {
            const panel = await EditorPanel.createOrShow(context, targetUri);
            
            // Navigate to heading if specified
            if (heading && panel) {
              // Wait a bit for the editor to fully initialize before scrolling
              setTimeout(() => {
                panel.navigateToHeading(heading);
              }, 2000);
            }
          } else {
            console.error('[LinkResolver] Extension context not available');
            // Fallback to default editor
            const document = await vscode.workspace.openTextDocument(targetUri);
            const editor = await vscode.window.showTextDocument(document);
            
            if (heading) {
              await this.navigateToHeading(heading, editor);
            }
          }
        } else {
          // For non-markdown files, use default editor
          const document = await vscode.workspace.openTextDocument(targetUri);
          await vscode.window.showTextDocument(document);
        }
      } else {
        vscode.window.showWarningMessage(`Wiki-link target not found: ${filename}`);
      }
    }
  }

  /**
   * Navigate to heading in current file
   */
  private async navigateToHeadingInCurrentFile(
    heading: string,
    currentDocumentUri: vscode.Uri
  ): Promise<void> {
    const document = await vscode.workspace.openTextDocument(currentDocumentUri);
    const editor = await vscode.window.showTextDocument(document);
    await this.navigateToHeading(heading, editor);
  }

  /**
   * Navigate to a heading in the active editor
   */
  private async navigateToHeading(
    heading: string,
    editor: vscode.TextEditor
  ): Promise<void> {
    const document = editor.document;
    const headingAnchor = this.headingToAnchor(heading);

    // Search for the heading in the document
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      const lineText = line.text;

      // Check if line is a heading
      const headingMatch = lineText.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const headingText = headingMatch[2].trim();
        const lineAnchor = this.headingToAnchor(headingText);

        if (lineAnchor === headingAnchor) {
          // Found the heading - scroll to it
          const range = new vscode.Range(i, 0, i, 0);
          editor.selection = new vscode.Selection(range.start, range.end);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
          return;
        }
      }
    }

    vscode.window.showWarningMessage(`Heading not found: ${heading}`);
  }

  /**
   * Convert heading to anchor ID (GitHub-style)
   */
  private headingToAnchor(heading: string): string {
    return heading
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-')      // Spaces to hyphens
      .replace(/-+/g, '-')       // Collapse multiple hyphens
      .replace(/^-|-$/g, '');    // Trim hyphens
  }

  /**
   * Get relative path between two files
   */
  public getRelativePath(from: vscode.Uri, to: vscode.Uri): string {
    const fromDir = path.dirname(from.fsPath);
    const toPath = to.fsPath;
    
    let relativePath = path.relative(fromDir, toPath);
    
    // Convert backslashes to forward slashes
    relativePath = relativePath.replace(/\\/g, '/');
    
    // Add ./ prefix if not already present
    if (!relativePath.startsWith('.')) {
      relativePath = './' + relativePath;
    }

    return relativePath;
  }

  /**
   * Update all wiki-links in a document when a file is renamed
   */
  public async updateLinksForRenamedFile(
    oldUri: vscode.Uri,
    newUri: vscode.Uri
  ): Promise<void> {
    const oldFilename = path.basename(oldUri.fsPath, '.md');
    const newFilename = path.basename(newUri.fsPath, '.md');

    // Find all markdown files in workspace
    const files = await vscode.workspace.findFiles('**/*.md', '**/node_modules/**');

    // Update each file that might contain links to the renamed file
    for (const fileUri of files) {
      const document = await vscode.workspace.openTextDocument(fileUri);
      const text = document.getText();

      // Check if document contains wiki-link to old filename
      const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
      let hasChanges = false;
      let updatedText = text;

      let match: RegExpExecArray | null;
      while ((match = wikiLinkRegex.exec(text)) !== null) {
        const linkContent = match[1];
        
        // Parse the link
        const [filePart, aliasPart] = linkContent.split('|');
        const [filename, heading] = filePart.split('#');

        if (filename.trim() === oldFilename) {
          // Build updated link
          let newLink = `[[${newFilename}`;
          if (heading) newLink += `#${heading}`;
          if (aliasPart) newLink += `|${aliasPart}`;
          newLink += ']]';

          updatedText = updatedText.replace(match[0], newLink);
          hasChanges = true;
        }
      }

      // Save changes if any
      if (hasChanges) {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(text.length)
        );
        edit.replace(fileUri, fullRange, updatedText);
        await vscode.workspace.applyEdit(edit);
        
        console.log(`[LinkResolver] Updated wiki-links in: ${fileUri.fsPath}`);
      }
    }
  }

  /**
   * Ensure file cache is populated and fresh
   */
  private async ensureFileCache(): Promise<void> {
    const now = Date.now();
    
    if (now - this.lastCacheScan < this.CACHE_TTL && this.fileCache.size > 0) {
      return; // Cache is still valid
    }

    // Scan workspace for markdown files
    const files = await vscode.workspace.findFiles('**/*.md', '**/node_modules/**');
    
    this.fileCache.clear();
    
    for (const uri of files) {
      const filename = path.basename(uri.fsPath);
      
      if (!this.fileCache.has(filename)) {
        this.fileCache.set(filename, []);
      }
      
      this.fileCache.get(filename)!.push(uri);
    }

    this.lastCacheScan = now;
    console.log(`[LinkResolver] Cached ${this.fileCache.size} markdown files`);
  }

  /**
   * Invalidate cache (called when files change)
   */
  public invalidateCache(): void {
    this.lastCacheScan = 0;
  }
}
