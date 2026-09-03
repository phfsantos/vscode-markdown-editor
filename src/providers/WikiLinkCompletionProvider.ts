import * as vscode from 'vscode';
import * as path from 'path';
import { RelationshipAnalyzer } from '../services/RelationshipAnalyzer';

/**
 * Completion item for wiki-links
 */
interface WikiLinkCompletion extends vscode.CompletionItem {
  filePath: string;
  score: number;
}

/**
 * Provides autocomplete for wiki-links ([[filename]])
 * Triggers on [[ and provides intelligent file suggestions
 */
export class WikiLinkCompletionProvider implements vscode.CompletionItemProvider {
  private static instance: WikiLinkCompletionProvider;
  private relationshipAnalyzer: RelationshipAnalyzer;
  private workspaceFiles: Map<string, vscode.Uri> = new Map();
  private lastScan: number = 0;
  private readonly SCAN_INTERVAL = 60000; // Re-scan every 60 seconds

  private constructor() {
    this.relationshipAnalyzer = RelationshipAnalyzer.getInstance();
    
    // Watch for file changes
    vscode.workspace.onDidCreateFiles(() => this.invalidateCache());
    vscode.workspace.onDidDeleteFiles(() => this.invalidateCache());
    vscode.workspace.onDidRenameFiles(() => this.invalidateCache());
  }

  public static getInstance(): WikiLinkCompletionProvider {
    if (!WikiLinkCompletionProvider.instance) {
      WikiLinkCompletionProvider.instance = new WikiLinkCompletionProvider();
    }
    return WikiLinkCompletionProvider.instance;
  }

  /**
   * Provide completion items for wiki-links
   */
  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[]> {
    // Check if we're in a wiki-link context [[
    const lineText = document.lineAt(position).text;
    const textBeforeCursor = lineText.substring(0, position.character);
    
    // Look for [[ trigger
    const wikiLinkMatch = textBeforeCursor.match(/\[\[([^\]]*?)$/);
    if (!wikiLinkMatch) {
      return [];
    }

    const searchText = wikiLinkMatch[1].toLowerCase();
    
    // Ensure workspace files are cached
    await this.ensureWorkspaceFilesCached();

    // Get all markdown files
    const allFiles = Array.from(this.workspaceFiles.values());
    
    // Score and rank files
    const scoredFiles = await this.scoreFiles(document.uri, allFiles, searchText);
    
    // Convert to completion items
    const completionItems = scoredFiles.map(item => this.createCompletionItem(item, document.uri));
    
    return completionItems;
  }

  /**
   * Score files based on relevance to current document
   */
  private async scoreFiles(
    currentFile: vscode.Uri,
    allFiles: vscode.Uri[],
    searchText: string
  ): Promise<WikiLinkCompletion[]> {
    const scored: WikiLinkCompletion[] = [];

    // Get related files for context-aware ranking
    const relatedFiles = await this.relationshipAnalyzer.getRelatedFiles(currentFile);
    const relatedPaths = new Set(relatedFiles.map(f => f.path));

    for (const file of allFiles) {
      // Skip current file
      if (file.fsPath === currentFile.fsPath) {
        continue;
      }

      const fileName = path.basename(file.fsPath, '.md');
      const fileNameLower = fileName.toLowerCase();
      
      // Calculate base score
      let score = 0;

      // Name similarity score (0-40 points)
      if (searchText) {
        if (fileNameLower === searchText) {
          score += 40; // Exact match
        } else if (fileNameLower.startsWith(searchText)) {
          score += 30; // Starts with
        } else if (fileNameLower.includes(searchText)) {
          score += 20; // Contains
        } else {
          // Fuzzy match score
          score += this.fuzzyMatchScore(searchText, fileNameLower) * 10;
        }
      } else {
        score += 10; // Default score when no search text
      }

      // Proximity score (0-30 points)
      const proximity = this.calculateProximity(currentFile.fsPath, file.fsPath);
      score += proximity * 30;

      // Relationship score (0-20 points)
      if (relatedPaths.has(file.fsPath)) {
        score += 20;
      }

      // Recency score (0-10 points)
      const recency = await this.calculateRecency(file);
      score += recency * 10;

      const item: WikiLinkCompletion = {
        label: fileName,
        kind: vscode.CompletionItemKind.File,
        detail: vscode.workspace.asRelativePath(file),
        filePath: file.fsPath,
        score: score,
        sortText: this.generateSortText(score, fileName)
      };

      scored.push(item);
    }

    // Sort by score (highest first)
    scored.sort((a, b) => b.score - a.score);

    // Return top 20 suggestions
    return scored.slice(0, 20);
  }

  /**
   * Create a completion item with wiki-link format
   */
  private createCompletionItem(
    item: WikiLinkCompletion,
    currentFile: vscode.Uri
  ): vscode.CompletionItem {
    const completionItem = new vscode.CompletionItem(
      item.label,
      vscode.CompletionItemKind.File
    );

    // Insert text is the filename (or relative path if needed)
    const linkText = path.basename(item.filePath, '.md');
    completionItem.insertText = `${linkText}]]`;
    
    // Documentation shows the relative path
    completionItem.detail = item.detail;
    completionItem.documentation = new vscode.MarkdownString(
      `Insert wiki-link to: \`${vscode.workspace.asRelativePath(item.filePath)}\``
    );

    // Sort text ensures proper ordering
    completionItem.sortText = item.sortText;

    // Filter text for better matching
    completionItem.filterText = linkText;

    return completionItem;
  }

  /**
   * Calculate fuzzy match score (0-1)
   */
  private fuzzyMatchScore(search: string, target: string): number {
    if (!search) return 0;
    
    let score = 0;
    let searchIndex = 0;
    
    for (let i = 0; i < target.length && searchIndex < search.length; i++) {
      if (target[i] === search[searchIndex]) {
        score += 1;
        searchIndex++;
      }
    }
    
    return searchIndex === search.length ? score / search.length : 0;
  }

  /**
   * Calculate directory proximity (0-1, higher is closer)
   */
  private calculateProximity(file1: string, file2: string): number {
    const dir1 = path.dirname(file1);
    const dir2 = path.dirname(file2);
    
    if (dir1 === dir2) {
      return 1; // Same directory
    }
    
    const parts1 = dir1.split(path.sep);
    const parts2 = dir2.split(path.sep);
    
    let commonDepth = 0;
    for (let i = 0; i < Math.min(parts1.length, parts2.length); i++) {
      if (parts1[i] === parts2[i]) {
        commonDepth++;
      } else {
        break;
      }
    }
    
    const maxDepth = Math.max(parts1.length, parts2.length);
    return commonDepth / maxDepth;
  }

  /**
   * Calculate recency score based on file modification time (0-1)
   */
  private async calculateRecency(file: vscode.Uri): Promise<number> {
    try {
      const stat = await vscode.workspace.fs.stat(file);
      const now = Date.now();
      const age = now - stat.mtime;
      
      // Files modified in last hour: 1.0
      // Files modified in last day: 0.5
      // Files modified in last week: 0.2
      // Older files: approaches 0
      const hourMs = 3600000;
      const dayMs = 86400000;
      const weekMs = 604800000;
      
      if (age < hourMs) return 1;
      if (age < dayMs) return 0.5 + (0.5 * (1 - age / dayMs));
      if (age < weekMs) return 0.2 + (0.3 * (1 - age / weekMs));
      return 0.1;
    } catch {
      return 0;
    }
  }

  /**
   * Generate sort text for proper ordering
   */
  private generateSortText(score: number, label: string): string {
    // Pad score to 5 digits (higher scores sort first)
    const paddedScore = String(10000 - Math.floor(score)).padStart(5, '0');
    return `${paddedScore}_${label}`;
  }

  /**
   * Get relative path between two files
   */
  private getRelativePath(from: string, to: string): string {
    const fromDir = path.dirname(from);
    let relativePath = path.relative(fromDir, to);
    
    // Convert to forward slashes for consistency
    relativePath = relativePath.replace(/\\/g, '/');
    
    // Remove .md extension
    if (relativePath.endsWith('.md')) {
      relativePath = relativePath.slice(0, -3);
    }
    
    return relativePath;
  }

  /**
   * Ensure workspace files are cached
   */
  private async ensureWorkspaceFilesCached(): Promise<void> {
    const now = Date.now();
    if (now - this.lastScan < this.SCAN_INTERVAL && this.workspaceFiles.size > 0) {
      return; // Cache is still valid
    }

    this.workspaceFiles.clear();
    
    // Find all markdown files in workspace
    const files = await vscode.workspace.findFiles(
      '**/*.{md,markdown}',
      '**/node_modules/**'
    );

    for (const file of files) {
      const fileName = path.basename(file.fsPath, '.md');
      this.workspaceFiles.set(fileName, file);
    }

    this.lastScan = now;
  }

  /**
   * Invalidate cache when files change
   */
  private invalidateCache(): void {
    this.lastScan = 0;
  }
}
