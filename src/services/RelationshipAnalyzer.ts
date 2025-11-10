import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Link information with resolution details
 */
export interface Link {
  text: string;
  url: string;
  type: 'markdown' | 'wiki';
  resolved: string | null;
  line?: number;
}

/**
 * Backlink information from another file
 */
export interface Backlink {
  path: string;
  name: string;
  relativePath: string;
  lineNumber?: number;
  context?: string;
}

/**
 * Related file with ranking score
 */
export interface RelatedFile {
  path: string;
  name: string;
  relativePath: string;
  score: number;
  proximity: number;
  backlinkCount: number;
  contentSimilarity: number;
  recentScore: number;
}

/**
 * Cache entry for relationship data
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Cache status information
 */
export interface CacheStatus {
  isBuilding: boolean;
  cacheSize: number;
  buildProgress: { current: number; total: number; operation: string } | null;
  ttl: number;
}

/**
 * Advanced file relationship analyzer with caching and ranking
 */
export class RelationshipAnalyzer {
  private static instance: RelationshipAnalyzer;
  private cache: Map<string, CacheEntry<any>> = new Map();
  private readonly CACHE_TTL = 600000; // 10 minute cache for better performance
  private fileAccessHistory: Map<string, number> = new Map();
  private isBuilding: boolean = false;
  private buildProgress: { current: number; total: number; operation: string } | null = null;
  private onStatusChange: ((status: CacheStatus) => void) | null = null;

  private constructor() {
    // Track file access for recency scoring
    vscode.workspace.onDidOpenTextDocument(doc => {
      if (doc.languageId === 'markdown') {
        this.fileAccessHistory.set(doc.uri.fsPath, Date.now());
      }
    });
    
    // Invalidate cache for changed files
    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.languageId === 'markdown') {
        this.invalidateCacheForFile(e.document.uri.fsPath);
      }
    });
    
    // Invalidate cache for deleted/renamed files
    vscode.workspace.onDidDeleteFiles(e => {
      e.files.forEach(uri => {
        if (uri.fsPath.endsWith('.md')) {
          this.invalidateCacheForFile(uri.fsPath);
        }
      });
    });
    
    vscode.workspace.onDidRenameFiles(e => {
      e.files.forEach(file => {
        if (file.oldUri.fsPath.endsWith('.md') || file.newUri.fsPath.endsWith('.md')) {
          this.invalidateCacheForFile(file.oldUri.fsPath);
          this.invalidateCacheForFile(file.newUri.fsPath);
        }
      });
    });
  }
  
  /**
   * Invalidate cache entries for a specific file
   */
  private invalidateCacheForFile(filePath: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.includes(filePath)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.cache.delete(key));
    if (keysToDelete.length > 0) {
      this.notifyStatusChange();
    }
  }

  public static getInstance(): RelationshipAnalyzer {
    if (!RelationshipAnalyzer.instance) {
      RelationshipAnalyzer.instance = new RelationshipAnalyzer();
    }
    return RelationshipAnalyzer.instance;
  }

  /**
   * Register callback for cache status changes
   */
  public onCacheStatusChange(callback: (status: CacheStatus) => void): void {
    this.onStatusChange = callback;
  }

  /**
   * Get current cache status
   */
  public getCacheStatus(): CacheStatus {
    return {
      isBuilding: this.isBuilding,
      cacheSize: this.cache.size,
      buildProgress: this.buildProgress,
      ttl: this.CACHE_TTL
    };
  }

  /**
   * Rebuild entire cache for workspace
   */
  public async rebuildCache(): Promise<void> {
    if (this.isBuilding) {
      vscode.window.showInformationMessage('Cache rebuild already in progress');
      return;
    }

    this.isBuilding = true;
    this.notifyStatusChange();

    try {
      // Clear existing cache
      this.cache.clear();

      // Find all markdown files
      const files = await vscode.workspace.findFiles('**/*.md', '**/node_modules/**');
      const total = files.length;

      vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Rebuilding relationship cache',
        cancellable: false
      }, async (progress) => {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          this.buildProgress = {
            current: i + 1,
            total,
            operation: `Processing ${path.basename(file.fsPath)}`
          };
          this.notifyStatusChange();

          progress.report({
            message: `${i + 1}/${total} - ${path.basename(file.fsPath)}`,
            increment: (100 / total)
          });

          // Pre-populate cache for each file
          try {
            await this.getOutgoingLinks(file);
            await this.getBacklinks(file);
          } catch (error) {
            // Skip files that error
          }
        }
      });

      vscode.window.showInformationMessage(`Cache rebuilt: ${this.cache.size} entries`);
    } finally {
      this.isBuilding = false;
      this.buildProgress = null;
      this.notifyStatusChange();
    }
  }

  /**
   * Notify status change listeners
   */
  private notifyStatusChange(): void {
    if (this.onStatusChange) {
      this.onStatusChange(this.getCacheStatus());
    }
  }

  /**
   * Get outgoing links from a markdown file
   */
  public async getOutgoingLinks(fileUri: vscode.Uri): Promise<Link[]> {
    const cacheKey = `outgoing:${fileUri.fsPath}`;
    const cached = this.getFromCache<Link[]>(cacheKey);
    if (cached) return cached;

    const doc = await vscode.workspace.openTextDocument(fileUri);
    const content = doc.getText();
    const links: Link[] = [];

    // Standard markdown links [text](url)
    const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;

    while ((match = mdLinkRegex.exec(content)) !== null) {
      const [, text, url] = match;
      const lineNumber = doc.positionAt(match.index).line;

      // Only include local markdown files
      if (url.endsWith('.md') && !url.startsWith('http')) {
        links.push({
          text,
          url,
          type: 'markdown',
          resolved: this.resolveLink(url, fileUri.fsPath),
          line: lineNumber
        });
      }
    }

    // Wiki-style links [[filename]]
    const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;

    while ((match = wikiLinkRegex.exec(content)) !== null) {
      const linkText = match[1];
      const lineNumber = doc.positionAt(match.index).line;
      
      // Parse wiki link: can have heading (#) and/or alias (|)
      // Format: [[filename#heading|alias]] or any combination
      let filename = linkText;
      let alias = linkText;
      
      // Extract alias if present (comes after |)
      const pipeIndex = linkText.indexOf('|');
      if (pipeIndex !== -1) {
        filename = linkText.substring(0, pipeIndex);
        alias = linkText.substring(pipeIndex + 1);
      }
      
      // Remove heading if present (comes after #)
      const hashIndex = filename.indexOf('#');
      if (hashIndex !== -1) {
        filename = filename.substring(0, hashIndex);
      }
      
      // Remove .md extension if present in filename for searching
      // findFileByName will add it back
      filename = filename.replace(/\.md$/, '').trim();

      links.push({
        text: alias.trim(),
        url: filename,
        type: 'wiki',
        resolved: await this.findFileByName(filename),
        line: lineNumber
      });
    }

    this.setInCache(cacheKey, links);
    return links;
  }

  /**
   * Find backlinks to a file
   */
  public async getBacklinks(fileUri: vscode.Uri): Promise<Backlink[]> {
    const cacheKey = `backlinks:${fileUri.fsPath}`;
    const cached = this.getFromCache<Backlink[]>(cacheKey);
    if (cached) return cached;

    const backlinks: Backlink[] = [];
    const fileName = path.basename(fileUri.fsPath, '.md');
    const fullFileName = path.basename(fileUri.fsPath);
    const files = await vscode.workspace.findFiles('**/*.md');

    for (const file of files) {
      if (file.fsPath === fileUri.fsPath) continue;

      const doc = await vscode.workspace.openTextDocument(file);
      const content = doc.getText();

      // Create regex patterns for both markdown and wiki links
      // Markdown links: [text](path/to/filename.md) - match any path ending with our filename
      const mdLinkRegex = new RegExp(`\\[([^\\]]+)\\]\\(([^)]*${this.escapeRegex(fullFileName)})\\)`, 'g');
      
      // Wiki links: Match both [[filename]] and [[filename.md]] with optional heading/alias
      // Pattern: [[filename]] or [[filename.md]] with optional #heading and/or |alias
      const escapedFileName = this.escapeRegex(fileName);
      const wikiLinkRegex = new RegExp(
        `\\[\\[${escapedFileName}(?:\\.md)?(?:[#|][^\\]]*)?\\]\\]`,
        'g'
      );

      let match;
      const foundLinks = new Map<number, string>(); // line number -> context

      // Find all markdown link matches
      while ((match = mdLinkRegex.exec(content)) !== null) {
        const lineNumber = doc.positionAt(match.index).line;
        const lineText = doc.lineAt(lineNumber).text;
        foundLinks.set(lineNumber, lineText.trim());
      }

      // Find all wiki link matches
      while ((match = wikiLinkRegex.exec(content)) !== null) {
        const lineNumber = doc.positionAt(match.index).line;
        const lineText = doc.lineAt(lineNumber).text;
        foundLinks.set(lineNumber, lineText.trim());
      }

      // Add backlinks for each unique line where a link was found
      for (const [lineNumber, context] of foundLinks) {
        backlinks.push({
          path: file.fsPath,
          name: path.basename(file.fsPath),
          relativePath: vscode.workspace.asRelativePath(file),
          lineNumber: lineNumber + 1, // Convert to 1-based line number
          context
        });
      }
    }

    this.setInCache(cacheKey, backlinks);
    return backlinks;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Get related files with advanced ranking
   */
  public async getRelatedFiles(fileUri: vscode.Uri, limit: number = 10): Promise<RelatedFile[]> {
    const cacheKey = `related:${fileUri.fsPath}:${limit}`;
    const cached = this.getFromCache<RelatedFile[]>(cacheKey);
    if (cached) return cached;

    const allFiles = await vscode.workspace.findFiles('**/*.md');
    const relatedFiles: RelatedFile[] = [];
    const currentDoc = await vscode.workspace.openTextDocument(fileUri);

    // Get outgoing links and backlinks for scoring
    const outgoingLinks = await this.getOutgoingLinks(fileUri);
    const backlinks = await this.getBacklinks(fileUri);
    const backlinkPaths = new Set(backlinks.map(b => b.path));

    for (const file of allFiles) {
      if (file.fsPath === fileUri.fsPath) continue;

      // Calculate individual scores
      const proximity = await this.calculateProximity(fileUri, file);
      const backlinkCount = backlinkPaths.has(file.fsPath) ? 1 : 0;
      const contentSimilarity = await this.calculateContentSimilarity(currentDoc, file);
      const recentScore = this.calculateRecencyScore(file.fsPath);

      // Weighted scoring: proximity(40%) + backlinks(30%) + recent(20%) + similarity(10%)
      const score = 
        (proximity * 0.4) +
        (backlinkCount * 0.3) +
        (recentScore * 0.2) +
        (contentSimilarity * 0.1);

      if (score > 0.1) { // Minimum relevance threshold
        relatedFiles.push({
          path: file.fsPath,
          name: path.basename(file.fsPath),
          relativePath: vscode.workspace.asRelativePath(file),
          score,
          proximity,
          backlinkCount,
          contentSimilarity,
          recentScore
        });
      }
    }

    // Sort by score and limit results
    const sorted = relatedFiles
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    this.setInCache(cacheKey, sorted);
    return sorted;
  }

  /**
   * Calculate proximity score (0-1) based on directory distance
   */
  public async calculateProximity(file1: vscode.Uri, file2: vscode.Uri): Promise<number> {
    const dir1 = path.dirname(file1.fsPath);
    const dir2 = path.dirname(file2.fsPath);

    // Same directory = highest score
    if (dir1 === dir2) return 1.0;

    // Calculate path distance
    const rel = path.relative(dir1, dir2);
    const depth = rel.split(path.sep).length;

    // Score decreases with distance: 0.8 for parent/child, 0.6 for siblings, etc.
    if (depth === 1) return 0.8;
    if (depth === 2) return 0.6;
    if (depth === 3) return 0.4;
    return 0.2;
  }

  /**
   * Calculate content similarity based on shared words/headings
   */
  private async calculateContentSimilarity(doc1: vscode.TextDocument, file2: vscode.Uri): Promise<number> {
    const doc2 = await vscode.workspace.openTextDocument(file2);
    
    const words1 = this.extractSignificantWords(doc1.getText());
    const words2 = this.extractSignificantWords(doc2.getText());

    // Calculate Jaccard similarity
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Extract significant words (headings, code, bold text)
   */
  private extractSignificantWords(content: string): Set<string> {
    const words = new Set<string>();

    // Extract headings
    const headingRegex = /^#+\s+(.+)$/gm;
    let match;
    while ((match = headingRegex.exec(content)) !== null) {
      match[1].toLowerCase().split(/\s+/).forEach(w => {
        if (w.length > 3) words.add(w);
      });
    }

    // Extract bold/italic text
    const emphasisRegex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
    while ((match = emphasisRegex.exec(content)) !== null) {
      const text = match[1] || match[2];
      text.toLowerCase().split(/\s+/).forEach(w => {
        if (w.length > 3) words.add(w);
      });
    }

    // Extract code blocks
    const codeRegex = /`(.+?)`/g;
    while ((match = codeRegex.exec(content)) !== null) {
      match[1].toLowerCase().split(/\s+/).forEach(w => {
        if (w.length > 3) words.add(w);
      });
    }

    return words;
  }

  /**
   * Calculate recency score based on last access time
   */
  private calculateRecencyScore(filePath: string): number {
    const lastAccess = this.fileAccessHistory.get(filePath);
    if (!lastAccess) return 0;

    const now = Date.now();
    const age = now - lastAccess;
    const oneHour = 3600000;

    // Score decreases exponentially with age
    if (age < oneHour) return 1.0;
    if (age < oneHour * 24) return 0.5;
    if (age < oneHour * 24 * 7) return 0.2;
    return 0.1;
  }

  /**
   * Resolve a relative link to absolute path
   */
  private resolveLink(url: string, currentFilePath: string): string {
    const currentDir = path.dirname(currentFilePath);
    return path.resolve(currentDir, url);
  }

  /**
   * Find a file by name (for wiki-links)
   * Made public so other services (e.g. sidebar/embed handling) can reuse it
   */
  public async findFileByName(filename: string): Promise<string | null> {
    const searchName = filename.endsWith('.md') ? filename : `${filename}.md`;
    const files = await vscode.workspace.findFiles(`**/${searchName}`);
    return files.length > 0 ? files[0].fsPath : null;
  }

  /**
   * Get from cache if not expired
   */
  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < this.CACHE_TTL) {
      return entry.data as T;
    }
    this.cache.delete(key);
    return null;
  }

  /**
   * Set in cache with timestamp
   */
  private setInCache<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Clear cache (for testing or when files change)
   */
  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * Dispose and cleanup
   */
  public dispose(): void {
    this.cache.clear();
    this.fileAccessHistory.clear();
  }
}
