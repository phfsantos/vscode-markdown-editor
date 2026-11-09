import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { resolveTaskAnchor, remapTaskAnchor, type SourceChange } from '@markdown-editor/core';

export interface TaskTarget {
  readonly documentVersion: number;
  readonly line: number;
  readonly expectedLineText: string;
}
export interface ActivityInput {
  readonly id: string;
  readonly uri: vscode.Uri;
  readonly state: 'working' | 'waiting' | 'review';
  readonly label: string;
  readonly task?: TaskTarget;
}
export interface AgentActivitySession extends vscode.Disposable {
  readonly sessionId: string;
  setActivity(activity: ActivityInput): void;
  clearActivity(id: string): void;
  heartbeat(): void;
}
export interface AgentActivityCapability {
  createSession(producer: { id: string; label: string }): AgentActivitySession;
}
export interface ReportedActivity extends ActivityInput {
  readonly sessionId: string;
  readonly producer: Readonly<{ id: string; label: string }>;
}
export interface ActivitySnapshot {
  readonly uri: vscode.Uri;
  readonly sequence: number;
  readonly state?: ActivityInput['state'];
  readonly activities: readonly ReportedActivity[];
}
interface SessionState {
  producer: Readonly<{ id: string; label: string }>;
  activities: Map<string, ReportedActivity>;
  expires: number;
}
export function validateText(value: unknown, name: string, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new Error(`Invalid ${name}: expected plain text of 1-${max} characters`);
  }
}
export function validateTask(value: TaskTarget): void {
  if (!value || !Number.isSafeInteger(value.documentVersion) || value.documentVersion < 1
    || !Number.isSafeInteger(value.line) || value.line < 0 || typeof value.expectedLineText !== 'string'
    || value.expectedLineText.length > 100_000 || /[\r\n]/.test(value.expectedLineText)) throw new Error('Invalid task target');
}

/** Ephemeral, activation-owned state. Producers own only their session's reports. */
export class AgentActivityRegistry implements AgentActivityCapability, vscode.Disposable {
  private readonly sessions = new Map<string, SessionState>();
  private readonly sequences = new Map<string, number>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.emitter.event;
  private readonly timer: ReturnType<typeof setInterval>;
  private disposed = false;
  private readonly documents = new Map<string, { text: string; version: number }>();

  public constructor(private readonly options: {
    now?: () => number;
    getDocument?: (uri: vscode.Uri) => { version: number; getText(): string } | undefined;
  } = {}) {
    this.timer = setInterval(() => this.sweep(), 1000);
    this.timer.unref?.();
  }
  private now(): number { return (this.options.now ?? Date.now)(); }
  public createSession(producer: { id: string; label: string }): AgentActivitySession {
    if (this.disposed) throw new Error('Activity registry closed');
    validateText(producer?.id, 'producer id', 128); validateText(producer?.label, 'producer label', 120);
    const sessionId = randomBytes(24).toString('hex');
    this.sessions.set(sessionId, { producer: Object.freeze({ id: producer.id, label: producer.label }), activities: new Map(), expires: this.now() + 120_000 });
    return Object.freeze({
      sessionId,
      setActivity: (input: ActivityInput) => this.set(sessionId, input),
      clearActivity: (id: string) => {
        validateText(id, 'activity id', 128);
        const state = this.live(sessionId, false);
        const previous = state?.activities.get(id);
        if (previous) { state!.activities.delete(id); this.changed(previous.uri); }
      },
      heartbeat: () => { this.live(sessionId)!.expires = this.now() + 120_000; },
      dispose: () => this.remove(sessionId),
    });
  }
  public isSessionLive(id: string): boolean { const session = this.sessions.get(id); return Boolean(session && session.expires > this.now()); }
  private live(id: string, required = true): SessionState | undefined {
    const state = this.sessions.get(id);
    if (state && state.expires <= this.now()) this.remove(id);
    const live = this.sessions.get(id);
    if (!live && required) throw new Error('Activity session expired or closed');
    return live;
  }
  private set(sessionId: string, input: ActivityInput): void {
    const session = this.live(sessionId)!;
    validateText(input?.id, 'activity id', 128); validateText(input?.label, 'activity label', 120);
    if (!(input.uri instanceof vscode.Uri) || !input.uri.scheme || !input.uri.path || input.uri.toString().length > 16384) throw new Error('Invalid activity URI');
    if (!['working', 'waiting', 'review'].includes(input.state)) throw new Error('Invalid activity state');
    if (!session.activities.has(input.id) && session.activities.size >= 1000) throw new Error('Maximum 1000 activities per session');
    let task: TaskTarget | undefined;
    if (input.task !== undefined) {
      validateTask(input.task);
      const document = this.options.getDocument?.(input.uri);
      if (!document) throw new Error('Task document is unavailable');
      const text = document.getText();
      if (!resolveTaskAnchor(text, document.version, input.task)) throw new Error('Stale or invalid task target');
      task = Object.freeze({ documentVersion: input.task.documentVersion, line: input.task.line, expectedLineText: input.task.expectedLineText });
      this.documents.set(input.uri.toString(), { text, version: document.version });
    }
    const next: ReportedActivity = Object.freeze({ id: input.id, uri: input.uri, state: input.state, label: input.label,
      sessionId, producer: session.producer, ...(task ? { task } : {}) });
    const previous = session.activities.get(input.id);
    session.expires = this.now() + 120_000;
    if (previous && JSON.stringify(previous) === JSON.stringify(next)) return;
    session.activities.set(input.id, next);
    if (previous && previous.uri.toString() !== next.uri.toString()) this.changed(previous.uri);
    this.changed(next.uri);
  }
  public getActivities(uri: vscode.Uri): readonly ReportedActivity[] {
    this.sweep();
    return Object.freeze([...this.sessions.values()].flatMap(s => [...s.activities.values()]).filter(a => a.uri.toString() === uri.toString()));
  }
  public getSnapshot(uri: vscode.Uri): ActivitySnapshot {
    const activities = this.getActivities(uri);
    const state = (['working', 'waiting', 'review'] as const).find(state => activities.some(a => a.state === state));
    return Object.freeze({ uri, sequence: this.sequences.get(uri.toString()) ?? 0, state, activities });
  }
  /** The workspace listener runs once per activation, before panel projections. */
  public documentChanged(uri: vscode.Uri, document: { version: number; getText(): string }, changes: readonly SourceChange[]): void {
    const before = this.documents.get(uri.toString());
    if (!before || !changes.length) return;
    const text = document.getText(); let changed = false;
    for (const session of this.sessions.values()) for (const [id, activity] of session.activities) {
      if (activity.uri.toString() !== uri.toString() || !activity.task) continue;
      const anchor = resolveTaskAnchor(before.text, before.version, activity.task);
      const next = anchor && remapTaskAnchor(before.text, text, document.version, anchor, changes);
      const { task: _task, ...fileActivity } = activity;
      session.activities.set(id, Object.freeze({ ...fileActivity, ...(next ? { task: Object.freeze({ documentVersion: document.version, line: next.line, expectedLineText: next.text }) } : {}) }));
      changed = true;
    }
    this.documents.set(uri.toString(), { text, version: document.version });
    if (changed) this.changed(uri);
  }
  public documentClosed(uri: vscode.Uri): void {
    // Reopened TextDocuments can reuse version 1; old anchors cannot cross that
    // lifetime boundary even if a duplicate task happens to occupy the same line.
    let changed = false;
    for (const session of this.sessions.values()) for (const [id, activity] of session.activities) {
      if (activity.uri.toString() !== uri.toString() || !activity.task) continue;
      const { task: _task, ...fileActivity } = activity;
      session.activities.set(id, Object.freeze(fileActivity)); changed = true;
    }
    this.documents.delete(uri.toString());
    if (changed) this.changed(uri);
  }
  public clearUri(uri: vscode.Uri): void {
    let changed = false;
    for (const s of this.sessions.values()) for (const [id, a] of s.activities) if (a.uri.toString() === uri.toString()) { s.activities.delete(id); changed = true; }
    this.documents.delete(uri.toString());
    if (changed) this.changed(uri);
  }
  private changed(uri: vscode.Uri): void {
    this.sequences.set(uri.toString(), (this.sequences.get(uri.toString()) ?? 0) + 1);
    if (![...this.sessions.values()].some(s => [...s.activities.values()].some(a => a.uri.toString() === uri.toString() && a.task))) this.documents.delete(uri.toString());
    this.emitter.fire(uri);
  }
  private remove(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    const uris = new Map([...session.activities.values()].map(a => [a.uri.toString(), a.uri]));
    uris.forEach(uri => this.changed(uri));
  }
  private sweep(): void {
    // Remove the whole expired batch before notifying synchronous projections.
    // A subscriber may read a snapshot from its change callback.
    const uris = new Map<string, vscode.Uri>();
    const now = this.now();
    for (const [id, session] of this.sessions) if (session.expires <= now) {
      this.sessions.delete(id);
      session.activities.forEach(activity => uris.set(activity.uri.toString(), activity.uri));
    }
    uris.forEach(uri => this.changed(uri));
  }
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true; clearInterval(this.timer);
    for (const id of this.sessions.keys()) this.remove(id);
    this.documents.clear(); this.sequences.clear(); this.emitter.dispose();
  }
}
