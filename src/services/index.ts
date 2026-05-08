/**
 * Service layer for Obsidian-style markdown features
 */

export { RelationshipAnalyzer, Link, Backlink, RelatedFile } from './RelationshipAnalyzer';
export { LinkGraphGenerator, GraphNode, GraphEdge, GraphData } from './LinkGraphGenerator';
export { TemplateManager, Template, TemplateContext } from './TemplateManager';
export { DefaultEditorChecker, EditorAssociation } from './DefaultEditorChecker';
export { LinkResolver } from './LinkResolver';
export {
  classifyAIMarkdownFileName,
  isAIMarkdownFileName,
} from './AIMarkdownDetector';
export type {
  AIMarkdownFileKind,
  AIMarkdownClassification,
} from './AIMarkdownDetector';
export {
  AIMarkdownWorkflowService,
} from './AIMarkdownWorkflowService';
export type {
  AIMarkdownAvailability,
  AIMarkdownAvailabilityStatus,
  AIMarkdownDescriptor,
  AIMarkdownContextPackage,
  AIMarkdownValidationResult,
  AIMarkdownOpenChatResult,
  AIMarkdownProvider,
} from './AIMarkdownWorkflowService';

// Calendar integration
export { 
  CalendarService, 
  OutlookCalendarProvider, 
  GoogleCalendarProvider,
  EventCache,
  GOOGLE_CALENDAR_AUTH_PROVIDER_ID,
} from './calendar';
export type { 
  CalendarEvent, 
  CalendarProvider, 
  AuthState, 
  CachedEvents 
} from './calendar';
