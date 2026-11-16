export {
  filterDiagnosticsOutsideFencedCodeBlocks,
  getFencedCodeBlockRanges,
} from './markdownDiagnosticFilter';
export type {
  DiagnosticWithRange,
  FencedCodeBlockRange,
  MarkdownPosition,
  MarkdownRange,
} from './markdownDiagnosticFilter';
export {
  createRenderedLineRules,
  normalizeRenderedLineText,
} from './renderedLineRules';
export type { RenderedLineAdapter } from './renderedLineRules';
export {
  mapSourcePosition,
  normalizeSourcePosition,
} from './sourcePositionMapping';
export type {
  RenderedPositionMatch,
  SourceNavigationTarget,
  SourcePosition,
  SourcePositionConfidence,
  SourcePositionReason,
} from './sourcePositionMapping';
export {
  HOST_TO_WEBVIEW_COMMANDS,
  WEBVIEW_TO_HOST_COMMANDS,
  createMessageRejection,
  parseHostToWebviewMessage,
  parseWebviewToHostMessage,
} from './editorProtocol';
export type {
  HostToWebviewCommand,
  HostToWebviewMessage,
  MessageOf,
  MessageRejection,
  PendingEditProjection,
  ProtocolParseResult,
  WebviewToHostCommand,
  WebviewToHostMessage,
} from './editorProtocol';

export * from './sourceSelectionMapping';

export { findChangedTasks, parseTaskItems, resolveTaskAnchor, remapTaskAnchor } from './taskAnchorMapping';
export type { TaskAnchor, ParsedTask, SourceChange } from './taskAnchorMapping';
