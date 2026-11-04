import * as vscode from 'vscode';
import { AgentActivityRegistry, type AgentActivityCapability } from './AgentActivityRegistry';
import type { MarkdownStudioApiV1, MarkdownStudioContext } from './MarkdownStudioApi';

interface ContextSource {
  getActiveContext(): MarkdownStudioContext | undefined;
  readonly onDidChangeActiveContext: vscode.Event<MarkdownStudioContext | undefined>;
}

function clone(context: MarkdownStudioContext | undefined): MarkdownStudioContext | undefined {
  if (!context) return;
  const range = context.selection;
  return { ...context, ...(range ? { selection: new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character) } : {}) };
}

/** Activation-owned facade; future capabilities can extend the same API object. */
export class MarkdownStudioApiService implements vscode.Disposable {
  public readonly api: MarkdownStudioApiV1;
  private readonly emitter = new vscode.EventEmitter<MarkdownStudioContext | undefined>();
  private readonly disposables: vscode.Disposable[];
  private disposed = false;
  private readonly ownedActivity?: AgentActivityRegistry;

  public constructor(source: ContextSource, commands: Pick<typeof vscode.commands, 'registerCommand'> = vscode.commands, activity?: AgentActivityCapability) {
    if (!activity) this.ownedActivity = new AgentActivityRegistry();
    this.api = {
      activity: activity ?? this.ownedActivity!,
      apiVersion: 1,
      getActiveContext: () => this.disposed ? undefined : clone(source.getActiveContext()),
      onDidChangeActiveContext: (listener, thisArgs, disposables) => this.emitter.event(value => listener.call(thisArgs, clone(value)), undefined, disposables),
    };
    this.disposables = [
      source.onDidChangeActiveContext(value => this.emitter.fire(clone(value))),
      commands.registerCommand('markdown-editor.getActiveContext', (options?: { uriFormat?: 'object' | 'string' }) => {
        const value = this.api.getActiveContext();
        if (!value) return undefined;
        const range = value.selection;
        return { panelId: value.panelId, uri: options?.uriFormat === 'object' ? value.uri : value.uri.toString(), documentVersion: value.documentVersion,
          selectionStatus: value.selectionStatus, ...(range ? { selection: {
            start: { line: range.start.line, character: range.start.character },
            end: { line: range.end.line, character: range.end.character },
          } } : {}) };
      }),
    ];
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposables.forEach(disposable => disposable.dispose());
    this.ownedActivity?.dispose();
    this.emitter.dispose();
  }
}
