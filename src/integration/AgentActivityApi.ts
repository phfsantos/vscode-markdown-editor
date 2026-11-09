import * as vscode from 'vscode';
import { randomBytes, timingSafeEqual } from 'crypto';
import { AgentActivityRegistry, type AgentActivityCapability, type AgentActivitySession, type ActivityInput } from './AgentActivityRegistry';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected activity command object');
  return value as Record<string, unknown>;
}
/** Tokens scope command sessions; extension-host code is not a security boundary. */
export class AgentActivityApi implements AgentActivityCapability, vscode.Disposable {
  private readonly sessions = new Map<string, { token: string; session: AgentActivitySession }>();
  private readonly disposables: vscode.Disposable[];
  private disposed = false;
  public constructor(private readonly registry: AgentActivityRegistry, commands: Pick<typeof vscode.commands, 'registerCommand'> = vscode.commands) {
    const register = (name: string, callback: (value: unknown) => unknown) => commands.registerCommand(`markdown-editor.agentActivity.${name}`, callback);
    this.disposables = [
      register('startSession', value => {
        const session = this.createSession(object(value) as unknown as { id: string; label: string });
        const token = randomBytes(32).toString('hex'); this.sessions.set(session.sessionId, { token, session });
        return { sessionId: session.sessionId, token };
      }),
      register('update', value => {
        const args = object(value); const session = this.authorize(args); const activity = object(args.activity);
        // Real URI arguments are translated/revived by VS Code command RPC.
        // Strings retain exact receiving-host identity for JSON compatibility.
        let uri: vscode.Uri;
        if (activity.uri instanceof vscode.Uri) uri = activity.uri;
        else {
          if (typeof activity.uri !== 'string' || activity.uri.length > 16384 || !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(activity.uri)) throw new Error('Invalid serialized activity URI');
          uri = vscode.Uri.parse(activity.uri, true);
        }
        session.setActivity({ ...activity, uri } as unknown as ActivityInput);
      }),
      register('clear', value => { const args = object(value); this.authorize(args).clearActivity(args.id as string); }),
      register('heartbeat', value => this.authorize(object(value)).heartbeat()),
      register('endSession', value => { const args = object(value); this.authorize(args).dispose(); this.sessions.delete(args.sessionId as string); }),
      registry.onDidChange(() => this.prune()),
    ];
  }
  private prune(): void { for (const id of this.sessions.keys()) if (!this.registry.isSessionLive(id)) this.sessions.delete(id); }
  private authorize(args: Record<string, unknown>): AgentActivitySession {
    this.prune();
    const entry = typeof args.sessionId === 'string' ? this.sessions.get(args.sessionId) : undefined;
    if (this.disposed || !entry || typeof args.token !== 'string' || args.token.length !== entry.token.length
      || !timingSafeEqual(Buffer.from(args.token), Buffer.from(entry.token))) throw new Error('Unknown, expired or unauthorized activity session');
    return entry.session;
  }
  public createSession(producer: { id: string; label: string }): AgentActivitySession {
    if (this.disposed) throw new Error('Activity API closed');
    return this.registry.createSession(producer);
  }
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposables.forEach(d => d.dispose());
    for (const entry of this.sessions.values()) entry.session.dispose();
    this.sessions.clear();
  }
}
