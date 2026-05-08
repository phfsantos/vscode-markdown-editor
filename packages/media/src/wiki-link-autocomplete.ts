/**
 * Wiki-Link Autocomplete for Vditor Webview
 * Provides intelligent [[filename]] suggestions when typing in the webview editor
 */

// VS Code webview API
declare const vscode: any;

// Logging helper
function vscodeLog(message: string) {
  vscode.postMessage({ command: 'log', message });
}

interface WikiLinkSuggestion {
  value: string;
  html: string;
  score: number;
  filePath: string;
}

interface FileInfo {
  name: string;
  path: string;
  relativePath: string;
  mtime: number;
}

/**
 * WikiLinkAutocomplete integrates with Vditor's hint system
 * to provide intelligent file suggestions when user types [[
 */
export class WikiLinkAutocomplete {
  private workspaceFiles: FileInfo[] = [];
  private lastScan: number = 0;
  private readonly SCAN_INTERVAL = 60000; // 60 seconds
  private currentDocumentPath: string = '';
  private relatedFiles: Set<string> = new Set();

  /**
   * Get Vditor hint configurations for wiki-links and embeds
   * Returns array with two configs: one for [[ and one for ![[
   */
  getHintConfigs(): any[] {
    return [
      // Wiki-link trigger: [[
      {
        key: '[[',
        hint: (value: string) => {
          vscodeLog(`[WikiLinkAutocomplete] � Wiki-link hint triggered for: "${value}"`);
          return this.getWikiLinkSuggestions(value, false);
        },
      },
      // Embed trigger: ![ (autocomplete will add the missing [)
      {
        key: '![',
        hint: (value: string) => {
          vscodeLog(`[WikiLinkAutocomplete] 📎 Embed hint triggered for: "${value}"`);
          return this.getWikiLinkSuggestions(value, true);
        },
      },
    ];
  }

  /**
   * Initialize the autocomplete system
   */
  public async initialize(documentPath: string, vditor: any): Promise<void> {
    this.currentDocumentPath = documentPath;
    
    await this.refreshWorkspaceFiles();
    await this.refreshRelatedFiles();
  }

  /**
   * Update current document path
   */
  public updateDocumentPath(documentPath: string): void {
    this.currentDocumentPath = documentPath;
    this.refreshRelatedFiles();
  }
  
  /**
   * Get wiki-link suggestions for the search text
   */
  private getWikiLinkSuggestions(searchText: string, isEmbed: boolean = false): Array<{ value: string; html: string }> {
    const scored = this.scoreAndRankFiles(searchText.toLowerCase());
    return scored.slice(0, 20).map(s => ({
      value: isEmbed ? s.value.replace('[[', '![[') : s.value,  // Add missing [ and ! prefix for embeds
      html: s.html
    }));
  }

  /**
   * Refresh workspace files from extension
   */
  private async refreshWorkspaceFiles(): Promise<void> {
    return new Promise((resolve) => {
      // Request workspace files from extension
      const requestId = Date.now().toString();
      
      const handler = (event: MessageEvent) => {
        const msg = event.data;
        if (msg.command === 'wikilink-workspace-files' && msg.requestId === requestId) {
          window.removeEventListener('message', handler);
          this.workspaceFiles = msg.files || [];
          this.lastScan = Date.now();
          resolve();
        }
      };

      window.addEventListener('message', handler);
      
      (window as any).vscode.postMessage({
        command: 'requestWorkspaceFiles',
        requestId,
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve();
      }, 5000);
    });
  }

  /**
   * Refresh related files from extension
   */
  private async refreshRelatedFiles(): Promise<void> {
    return new Promise((resolve) => {
      const requestId = Date.now().toString();
      
      const handler = (event: MessageEvent) => {
        const msg = event.data;
        if (msg.command === 'wikilink-related-files' && msg.requestId === requestId) {
          window.removeEventListener('message', handler);
          this.relatedFiles = new Set(msg.files || []);
          resolve();
        }
      };

      window.addEventListener('message', handler);
      
      (window as any).vscode.postMessage({
        command: 'requestRelatedFiles',
        requestId,
        documentPath: this.currentDocumentPath,
      });

      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve();
      }, 5000);
    });
  }

  /**
   * Ensure workspace files are cached
   */
  private async ensureWorkspaceFilesCached(): Promise<void> {
    const now = Date.now();
    if (now - this.lastScan < this.SCAN_INTERVAL && this.workspaceFiles.length > 0) {
      return; // Cache is still valid
    }

    await this.refreshWorkspaceFiles();
  }

  /**
   * Score and rank files based on relevance
   */
  private scoreAndRankFiles(searchText: string): WikiLinkSuggestion[] {
    const scored: WikiLinkSuggestion[] = [];

    for (const file of this.workspaceFiles) {
      // Skip current file
      if (file.path === this.currentDocumentPath) {
        continue;
      }

      const fileName = file.name.toLowerCase();
      let score = 0;

      // Name similarity score (0-40 points)
      if (searchText) {
        if (fileName === searchText) {
          score += 40; // Exact match
        } else if (fileName.startsWith(searchText)) {
          score += 30; // Starts with
        } else if (fileName.includes(searchText)) {
          score += 20; // Contains
        } else {
          // Fuzzy match
          score += this.fuzzyMatchScore(searchText, fileName) * 10;
        }
      } else {
        score += 10; // Default score when no search text
      }

      // Proximity score (0-30 points)
      const proximity = this.calculateProximity(this.currentDocumentPath, file.path);
      score += proximity * 30;

      // Relationship score (0-20 points)
      if (this.relatedFiles.has(file.path)) {
        score += 20;
      }

      // Recency score (0-10 points)
      const recency = this.calculateRecency(file.mtime);
      score += recency * 10;

      const suggestion: WikiLinkSuggestion = {
        value: `[[${file.relativePath}]]`,
        html: this.createSuggestionHTML(file, score),
        score,
        filePath: file.path,
      };

      scored.push(suggestion);
    }

    // Sort by score (highest first)
    scored.sort((a, b) => b.score - a.score);

    return scored;
  }

  /**
   * Create HTML for autocomplete suggestion
   */
  private createSuggestionHTML(file: FileInfo, score: number): string {
    const scorePercent = Math.min(100, Math.round(score));
    const scoreColor = scorePercent > 70 ? '#4caf50' : scorePercent > 40 ? '#ff9800' : '#9e9e9e';
    
    return `
      <div style="display: flex; align-items: center; gap: 8px; padding: 4px 0;">
        <span style="flex: 1; font-weight: 500;">${this.escapeHtml(file.name)}</span>
        <span style="font-size: 0.85em; color: var(--vscode-descriptionForeground); opacity: 0.7;">
          ${this.escapeHtml(file.relativePath)}
        </span>
        <span style="
          font-size: 0.75em; 
          color: ${scoreColor}; 
          padding: 2px 6px; 
          border-radius: 3px; 
          background: var(--vscode-badge-background);
        ">
          ${scorePercent}%
        </span>
      </div>
    `;
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
    const dir1 = this.getDirectory(file1);
    const dir2 = this.getDirectory(file2);
    
    if (dir1 === dir2) {
      return 1; // Same directory
    }
    
    const parts1 = dir1.split(/[/\\]/);
    const parts2 = dir2.split(/[/\\]/);
    
    let commonDepth = 0;
    for (let i = 0; i < Math.min(parts1.length, parts2.length); i++) {
      if (parts1[i] === parts2[i]) {
        commonDepth++;
      } else {
        break;
      }
    }
    
    const maxDepth = Math.max(parts1.length, parts2.length);
    return maxDepth > 0 ? commonDepth / maxDepth : 0;
  }

  /**
   * Calculate recency score based on modification time (0-1)
   */
  private calculateRecency(mtime: number): number {
    const now = Date.now();
    const age = now - mtime;
    
    const hourMs = 3600000;
    const dayMs = 86400000;
    const weekMs = 604800000;
    
    if (age < hourMs) return 1;
    if (age < dayMs) return 0.5 + (0.5 * (1 - age / dayMs));
    if (age < weekMs) return 0.2 + (0.3 * (1 - age / weekMs));
    return 0.1;
  }

  /**
   * Get directory from file path
   */
  private getDirectory(filePath: string): string {
    const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    return lastSlash >= 0 ? filePath.substring(0, lastSlash) : '';
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Invalidate cache (called when files change)
   */
  public invalidateCache(): void {
    this.lastScan = 0;
  }
}
