/**
 * Typed message contracts between the extension host and the editor webview.
 *
 * Each direction is declared once as a schema table. The TypeScript message
 * unions are derived from the tables and the parsers validate against the same
 * tables, so a command cannot be typed one way and checked another.
 *
 * Parsers accept `unknown` and return one of three outcomes:
 * - `message`: a known command whose payload matches its contract. Only
 *   declared fields are copied, so handlers never see undeclared input.
 * - `malformed`: a known command whose payload violates its contract. Callers
 *   must reject it explicitly rather than guess.
 * - `unknown`: not an object, no string command, or a command this contract
 *   does not own (for example renderer persistence, which has its own parser).
 */

import type { SourceNavigationTarget } from './sourcePositionMapping';

type FieldKind =
  | 'navigationTarget'
  | 'string'
  | 'number'
  | 'boolean'
  | 'unknown'
  | 'array'
  | 'stringArray'
  | 'record'
  | 'position'
  | 'uploadFiles'
  | 'requestId';

interface FieldTypes {
  navigationTarget: SourceNavigationTarget;
  string: string;
  number: number;
  boolean: boolean;
  unknown: unknown;
  array: unknown[];
  stringArray: string[];
  record: Record<string, unknown>;
  position: { line?: number; character?: number };
  uploadFiles: Array<{ name: string; base64: string }>;
  requestId: string | number;
}

interface KindField<K extends FieldKind, O extends boolean> {
  readonly kind: K;
  readonly optional: O;
}

interface LiteralField<V extends string, O extends boolean> {
  readonly kind: 'literal';
  readonly values: readonly V[];
  readonly optional: O;
}

type FieldSpec = KindField<FieldKind, boolean> | LiteralField<string, boolean>;
type Schema = Readonly<Record<string, FieldSpec>>;

const required = <K extends FieldKind>(kind: K): KindField<K, false> => ({ kind, optional: false });
const optional = <K extends FieldKind>(kind: K): KindField<K, true> => ({ kind, optional: true });
const oneOf = <V extends string>(...values: V[]): LiteralField<V, false> => ({
  kind: 'literal',
  values,
  optional: false,
});
const optionalOneOf = <V extends string>(...values: V[]): LiteralField<V, true> => ({
  kind: 'literal',
  values,
  optional: true,
});

type FieldValue<F> = F extends LiteralField<infer V, boolean>
  ? V
  : F extends KindField<infer K, boolean>
    ? FieldTypes[K]
    : never;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type Payload<S extends Schema> = {
  [K in keyof S as S[K]['optional'] extends true ? never : K]: FieldValue<S[K]>;
} & {
  [K in keyof S as S[K]['optional'] extends true ? K : never]?: FieldValue<S[K]>;
};

type MessageUnion<T extends Record<string, Schema>> = {
  [C in keyof T & string]: Simplify<{ command: C } & Payload<T[C]>>;
}[keyof T & string];

const empty = {} as const;

const documentRevision = {
  content: required('string'),
  generation: required('number'),
  revision: required('number'),
} as const;

const optionalRequestId = { requestId: optional('string') } as const;

// Calendar widgets correlate requests with numeric counters.
const calendarAccount = { provider: oneOf('google', 'outlook'), requestId: optional('requestId') } as const;

const webviewToHostSchemas = {
  // Lifecycle and document synchronization.
  ready: empty,
  vditorReady: empty,
  edit: documentRevision,
  save: documentRevision,
  'save-options': { options: optional('unknown') },
  'reset-config': empty,
  upload: { files: required('uploadFiles') },
  'diff-scroll-sync': { scrollPercentage: required('number') },

  // Diagnostics and notifications.
  info: { content: required('string') },
  error: { content: required('string') },
  log: { message: optional('unknown') },
  'widget-notification': {
    type: optional('string'),
    message: optional('string'),
    detail: optional('string'),
    title: optional('string'),
  },
  // vscode-command actions carry the command id and args in `data.command` / `data.args`.
  'widget-action': {
    actionType: optionalOneOf('value', 'data', 'vscode-command', 'widget-action'),
    action: optional('unknown'),
    value: optional('unknown'),
    targetWidget: optional('string'),
    // Widget ids come from user-authored widget config and are only echoed back.
    widgetId: optional('unknown'),
    data: optional('unknown'),
  },

  // AI workflows.
  requestInlineSuggestion: {
    requestId: required('string'),
    content: optional('string'),
    beforeCursor: optional('string'),
    afterCursor: optional('string'),
    manual: optional('boolean'),
  },
  requestAddToChat: empty,
  requestAiAction: { action: required('string') },
  openNativeToolSelector: { selectedTools: optional('stringArray') },

  // Native editor commands.
  requestContextMenu: { position: optional('position') },
  requestQuickFix: { actionTitle: optional('string'), position: optional('position') },
  triggerQuickFix: { line: optional('number'), character: optional('number') },
  cursorPosition: { line: optional('number'), character: optional('number') },
  clipboardWrite: { text: optional('string'), requestId: optional('string') },
  clipboardRead: optionalRequestId,
  clipboardWriteRequest: { text: optional('string'), requestId: optional('string') },
  clipboardReadRequest: optionalRequestId,
  selectAll: empty,
  formatDocument: empty,
  formatSelection: empty,
  showProblems: empty,
  openProblemsPanel: empty,
  find: empty,
  findAndReplace: empty,
  insertLink: empty,
  insertImage: empty,
  insertTable: empty,
  showCommandPalette: empty,
  toggleWordWrap: empty,
  openWithTextEditor: empty,
  shareMarkdown: { content: optional('string') },
  shareHtml: { content: optional('string') },
  insertChartWidget: empty,
  insertTableWidget: empty,
  insertKanbanWidget: empty,
  insertFormWidget: empty,
  insertMapWidget: empty,

  // Links, embeds, and workspace lookups.
  'open-link': { href: optional('unknown') },
  requestEmbed: { filename: required('string') },
  requestWorkspaceFiles: optionalRequestId,
  requestRelatedFiles: { documentPath: required('string'), requestId: optional('string') },
  resolveWikiLink: { filename: required('string'), requestId: optional('string') },
  navigateToWikiLink: { filename: required('string'), heading: optional('string') },
  openFile: {
    filename: optional('string'),
    heading: optional('string'),
    filePath: optional('string'),
    path: optional('string'),
  },

  // Calendar widgets.
  'calendar-auth': calendarAccount,
  'calendar-request': {
    provider: oneOf('google', 'outlook', 'all'),
    date: required('string'),
    requestId: optional('requestId'),
  },
  'calendar-signout': calendarAccount,

  // Replies to host requests; consumed by per-request listeners.
  irHtmlResponse: { requestId: required('string'), html: optional('unknown'), error: optional('string') },
  renderedMarkdownHtmlResponse: {
    requestId: required('string'),
    html: optional('unknown'),
    error: optional('string'),
  },
} as const;

const calendarReply = {
  requestId: optional('requestId'),
  provider: optional('string'),
  date: optional('string'),
} as const;

const calendarResult = {
  requestId: optional('requestId'),
  provider: optional('string'),
  success: optional('boolean'),
  error: optional('unknown'),
} as const;

const hostToWebviewSchemas = {
  update: {
    content: required('string'),
    type: optionalOneOf('init', 'update'),
    generation: optional('number'),
    documentFilename: optional('string'),
    documentPath: optional('string'),
    cdnBaseUri: optional('string'),
    theme: optionalOneOf('dark', 'light'),
    options: optional('unknown'),
    isReadOnly: optional('boolean'),
    isDiffView: optional('boolean'),
    diffData: optional('unknown'),
    aiMarkdown: optional('unknown'),
    chatAnchor: optional('unknown'),
    inlineSuggestion: optional('unknown'),
  },
  revealSourcePosition: { target: required('navigationTarget') },
  uploaded: { files: required('stringArray') },
  diagnostics: {
    diagnostics: required('array'),
    documentText: optional('string'),
    documentLines: optional('number'),
  },
  contextMenuActions: { actions: optional('array') },
  clipboardWriteResult: {
    requestId: optional('string'),
    success: optional('boolean'),
    error: optional('string'),
  },
  clipboardReadResult: {
    requestId: optional('string'),
    success: optional('boolean'),
    text: optional('string'),
    error: optional('string'),
  },
  insertLink: empty,
  insertImage: empty,
  insertTable: empty,
  showFind: empty,
  showFindReplace: empty,
  insertKanbanBoard: empty,
  insertInteractiveTable: empty,
  insertPlayground: empty,
  insertWidget: { widgetBlock: optional('string') },
  insertRendererCodeBlock: { codeBlock: optional('string') },
  'renderer-update-code-block': {
    rendererId: optional('string'),
    boardId: optional('string'),
    filename: optional('string'),
  },
  navigateToHeading: { heading: optional('string') },
  openEmbedPreview: { embed: optional('record') },
  requestIRHtml: { requestId: required('string') },
  requestRenderedMarkdownHtml: {
    requestId: required('string'),
    markdown: optional('string'),
    documentFilename: optional('string'),
  },
  nativeToolSelectorResult: { selectedTools: optional('stringArray') },
  inlineSuggestionEligibility: { enabled: required('boolean'), languageId: optional('string') },
  inlineSuggestionResult: { requestId: required('string'), suggestion: optional('string') },
  insertTextAtCursor: { text: required('string') },
  aiMarkdownActionResult: {
    message: required('string'),
    level: optionalOneOf('info', 'warning', 'error'),
  },
  'calendar-events': { ...calendarReply, events: optional('unknown') },
  'calendar-loading': { ...calendarReply, loading: optional('boolean') },
  'calendar-error': { ...calendarReply, error: optional('unknown') },
  'calendar-auth-result': calendarResult,
  'calendar-signout-result': calendarResult,
  messageRejected: { rejectedCommand: required('string'), issues: required('stringArray') },
} as const;

export type WebviewToHostMessage = MessageUnion<typeof webviewToHostSchemas>;
export type WebviewToHostCommand = WebviewToHostMessage['command'];
export type HostToWebviewMessage = MessageUnion<typeof hostToWebviewSchemas>;
export type HostToWebviewCommand = HostToWebviewMessage['command'];

/** Narrow a message union to the variant for one command. */
export type MessageOf<M extends { command: string }, C extends M['command']> = Extract<M, { command: C }>;

export type ProtocolParseResult<M> =
  | { kind: 'message'; message: M }
  | { kind: 'malformed'; command: string; issues: string[] }
  | { kind: 'unknown'; command: string | undefined };

export interface MessageRejection {
  command: 'messageRejected';
  rejectedCommand: string;
  issues: string[];
}

export const WEBVIEW_TO_HOST_COMMANDS = Object.keys(webviewToHostSchemas) as WebviewToHostCommand[];
export const HOST_TO_WEBVIEW_COMMANDS = Object.keys(hostToWebviewSchemas) as HostToWebviewCommand[];

export function parseWebviewToHostMessage(value: unknown): ProtocolParseResult<WebviewToHostMessage> {
  return parseWith(webviewToHostSchemas, value) as ProtocolParseResult<WebviewToHostMessage>;
}

export function parseHostToWebviewMessage(value: unknown): ProtocolParseResult<HostToWebviewMessage> {
  return parseWith(hostToWebviewSchemas, value) as ProtocolParseResult<HostToWebviewMessage>;
}

export function createMessageRejection(rejectedCommand: string, issues: string[]): MessageRejection {
  return { command: 'messageRejected', rejectedCommand, issues };
}

function parseWith(
  schemas: Readonly<Record<string, Schema>>,
  value: unknown,
): ProtocolParseResult<{ command: string }> {
  if (!isRecord(value) || typeof value.command !== 'string') {
    return { kind: 'unknown', command: undefined };
  }

  const command = value.command;
  if (!Object.prototype.hasOwnProperty.call(schemas, command)) {
    return { kind: 'unknown', command };
  }

  const schema = schemas[command];
  const message: Record<string, unknown> = { command };
  const issues: string[] = [];
  for (const [field, spec] of Object.entries(schema)) {
    const fieldValue = value[field];
    if (fieldValue === undefined) {
      if (!spec.optional) issues.push(`${field} is required`);
      continue;
    }
    const issue = validateField(spec, fieldValue);
    if (issue) {
      issues.push(`${field} ${issue}`);
      continue;
    }
    message[field] = fieldValue;
  }

  return issues.length > 0
    ? { kind: 'malformed', command, issues }
    : { kind: 'message', message: message as { command: string } };
}

function validateField(spec: FieldSpec, value: unknown): string | undefined {
  if (spec.kind === 'literal') {
    return typeof value === 'string' && (spec.values as readonly string[]).includes(value)
      ? undefined
      : `must be one of ${spec.values.join(', ')}`;
  }

  switch (spec.kind) {
    case 'string':
      return typeof value === 'string' ? undefined : 'must be a string';
    case 'number':
      return isFiniteNumber(value) ? undefined : 'must be a finite number';
    case 'boolean':
      return typeof value === 'boolean' ? undefined : 'must be a boolean';
    case 'requestId':
      return typeof value === 'string' || isFiniteNumber(value) ? undefined : 'must be a string or finite number';
    case 'unknown':
      return undefined;
    case 'array':
      return Array.isArray(value) ? undefined : 'must be an array';
    case 'stringArray':
      return Array.isArray(value) && value.every((item) => typeof item === 'string')
        ? undefined
        : 'must be an array of strings';
    case 'record':
      return isRecord(value) ? undefined : 'must be an object';
    case 'position':
      return isRecord(value) &&
        (value.line === undefined || isFiniteNumber(value.line)) &&
        (value.character === undefined || isFiniteNumber(value.character))
        ? undefined
        : 'must be an object with numeric line and character';
    case 'navigationTarget':
      return isNavigationTarget(value)
        ? undefined
        : 'must be a source navigation target with a numeric position';
    case 'uploadFiles':
      return Array.isArray(value) &&
        value.every((file) => isRecord(file) && typeof file.name === 'string' && typeof file.base64 === 'string')
        ? undefined
        : 'must be an array of { name, base64 } strings';
  }
}

const navigationOrigins = ['command', 'markdown-link', 'uri-handler'];

function isNavigationTarget(value: unknown): value is SourceNavigationTarget {
  return (
    isRecord(value) &&
    isRecord(value.position) &&
    isFiniteNumber(value.position.line) &&
    isFiniteNumber(value.position.character) &&
    value.reveal === 'center' &&
    typeof value.highlight === 'boolean' &&
    typeof value.origin === 'string' &&
    navigationOrigins.includes(value.origin)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
