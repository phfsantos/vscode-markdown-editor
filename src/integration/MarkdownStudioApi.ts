import type * as vscode from 'vscode';
import type { AgentActivityCapability } from './AgentActivityRegistry';
export type { ActivityInput, TaskTarget, AgentActivitySession, AgentActivityCapability } from './AgentActivityRegistry';

/** Source coordinates are zero-based UTF-16 positions in the shared document. */
export interface MarkdownStudioContext {
  readonly panelId: string;
  readonly uri: vscode.Uri;
  readonly documentVersion: number;
  readonly selection?: vscode.Range;
  readonly selectionStatus: 'exact' | 'unavailable';
}

export interface MarkdownStudioApiV1 {
  readonly apiVersion: 1;
  readonly activity: AgentActivityCapability;
  getActiveContext(): MarkdownStudioContext | undefined;
  readonly onDidChangeActiveContext: vscode.Event<MarkdownStudioContext | undefined>;
}
