import * as vscode from 'vscode';

/**
 * Simple tag manager that scans workspace markdown files for #tags
 */
export class TagManager {
  private static instance: TagManager;
  private tagMap: Map<string, Set<string>> = new Map(); // tag -> set of file paths
  private lastScan: number = 0;
  private readonly SCAN_TTL = 600_000; // 10 minutes for better performance

  private constructor() {
    // Invalidate on file changes
    vscode.workspace.onDidChangeTextDocument(() => this.invalidate());
    vscode.workspace.onDidCreateFiles(() => this.invalidate());
    vscode.workspace.onDidDeleteFiles(() => this.invalidate());
    vscode.workspace.onDidRenameFiles(() => this.invalidate());
  }

  public static getInstance(): TagManager {
    if (!TagManager.instance) {
      TagManager.instance = new TagManager();
    }
    return TagManager.instance;
  }

  public invalidate(): void {
    this.lastScan = 0;
  }

  public async ensureScanned(): Promise<void> {
    const now = Date.now();
    if (now - this.lastScan < this.SCAN_TTL && this.tagMap.size > 0) return;
    await this.scanWorkspace();
    this.lastScan = Date.now();
  }

  private async scanWorkspace(): Promise<void> {
    this.tagMap.clear();
    const files = await vscode.workspace.findFiles('**/*.{md,markdown}', '**/node_modules/**');
    for (const file of files) {
      try {
        const doc = await vscode.workspace.openTextDocument(file);
        const text = doc.getText();
        const tags = TagManager.extractTagsFromText(text);
        const seen = new Set<string>();
        for (const tag of tags) {
          if (seen.has(tag)) continue;
          seen.add(tag);
          if (!this.tagMap.has(tag)) this.tagMap.set(tag, new Set());
          this.tagMap.get(tag)?.add(file.fsPath);
        }
      } catch {
        // skip
      }
    }
  }

  /**
   * Pure helper to extract tags from text (exposed for testing)
   */
  public static extractTagsFromText(content: string): string[] {
    const tagRegex = /(^|\s)#([a-zA-Z0-9_/-]+)\b/gm;
    const tags: string[] = [];
    let m;
    while ((m = tagRegex.exec(content)) !== null) {
      tags.push(m[2]);
    }
    return Array.from(new Set(tags));
  }

  public async getAllTags(): Promise<{ tag: string; count: number }[]> {
    await this.ensureScanned();
    const out: { tag: string; count: number }[] = [];
    for (const [tag, set] of this.tagMap.entries()) {
      out.push({ tag, count: set.size });
    }
    out.sort((a, b) => b.count - a.count);
    return out;
  }

  public async getFilesForTag(tag: string): Promise<string[]> {
    await this.ensureScanned();
    return Array.from(this.tagMap.get(tag) || []);
  }
}
