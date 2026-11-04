import * as vscode from 'vscode';
import { AgentActivityRegistry, type ActivitySnapshot } from './AgentActivityRegistry';

export function activityDescription(snapshot: ActivitySnapshot): string {
  const producers = [...new Set(snapshot.activities.map(a => a.producer.label))];
  return snapshot.state ? `Agent activity: ${snapshot.state} — ${producers.slice(0, 3).join(', ')}${producers.length > 3 ? ` (+${producers.length - 3})` : ''}` : '';
}
interface DecorationHost {
  getActiveUri(): vscode.Uri | undefined;
  onDidChangeActiveUri: vscode.Event<unknown>;
  createStatusBarItem(): vscode.StatusBarItem;
  registerFileDecorationProvider(provider: vscode.FileDecorationProvider): vscode.Disposable;
}
/** Stable string badges only. Settings and decoration competition belong to VS Code. */
export class AgentActivityDecorations implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChangeFileDecorations = this.emitter.event;
  private readonly status: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[];
  public constructor(private readonly registry: AgentActivityRegistry, private readonly host: DecorationHost) {
    this.status = host.createStatusBarItem(); this.status.name = 'Markdown Studio agent activity';
    this.disposables = [host.registerFileDecorationProvider(this), registry.onDidChange(uri => {
      this.emitter.fire(uri); this.refresh();
    }), host.onDidChangeActiveUri(() => this.refresh())];
    this.refresh();
  }
  public provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const snapshot = this.registry.getSnapshot(uri);
    if (!snapshot.state) return;
    return { badge: 'A', tooltip: activityDescription(snapshot), propagate: false };
  }
  private refresh(): void {
    const uri = this.host.getActiveUri(); const snapshot = uri && this.registry.getSnapshot(uri);
    if (!snapshot?.state) { this.status.hide(); return; }
    // Producer text cannot inject status-bar codicons.
    this.status.text = `${snapshot.state === 'working' ? '$(loading~spin)' : '$(info)'} Agent ${snapshot.state}`;
    this.status.tooltip = activityDescription(snapshot); this.status.show();
  }
  public dispose(): void { this.disposables.forEach(d => d.dispose()); this.status.dispose(); this.emitter.dispose(); }
}
