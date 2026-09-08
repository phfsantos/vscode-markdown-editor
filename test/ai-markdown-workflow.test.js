import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { test, vi } from 'vitest';

// 'vscode' resolves to test/mocks/vscode.ts via the vitest alias.
import { __reset } from 'vscode';
import * as detector from '../src/services/AIMarkdownDetector';
import { AIMarkdownWorkflowService } from '../src/services/AIMarkdownWorkflowService';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inlineSuggestionServiceSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'InlineSuggestionService.ts'), 'utf8');
const inlineCompletionProviderSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'providers', 'MarkdownInlineCompletionProvider.ts'), 'utf8');

// Mutable per-test state consumed lazily by the vi.mock factories below and
// by the shared vscode mock (clipboard, commands, extensions, config).
let currentState;

vi.mock('../src/services/RelationshipAnalyzer', () => ({
  RelationshipAnalyzer: class MockRelationshipAnalyzer {
    static getInstance() {
      return {
        async getOutgoingLinks() {
          return currentState.outgoingLinks;
        },
        async getBacklinks() {
          return currentState.backlinks;
        },
        async getRelatedFiles() {
          return currentState.relatedFiles;
        },
      };
    }
  },
}));

vi.mock('../src/services/LinkGraphGenerator', () => ({
  LinkGraphGenerator: class MockLinkGraphGenerator {
    static getInstance() {
      return {
        async generateSimplifiedGraph() {
          return currentState.graphData;
        },
      };
    }
  },
}));

vi.mock('../src/utils/Logger', () => ({
  logger: {
    warn(...args) {
      currentState.warns.push(args);
    },
    info() {},
    debug() {},
    error() {},
  },
}));

function createDocument(filePath, text = '') {
  return {
    fileName: filePath,
    uri: { fsPath: filePath },
    getText() {
      return text;
    },
  };
}

function loadDetector() {
  return detector;
}

function loadWorkflowService(options = {}) {
  const state = __reset({
    config: options.config || {},
    availableCommands: options.availableCommands || [],
    installedExtensions: options.installedExtensions || [],
    executeCommandError: options.executeCommandError || null,
    relativePathBase: options.relativePathBase || '/workspace/',
  });

  Object.assign(state, {
    outgoingLinks: options.outgoingLinks || [],
    backlinks: options.backlinks || [],
    relatedFiles: options.relatedFiles || [],
    graphData: options.graphData || { nodes: [], edges: [] },
  });

  currentState = state;

  return {
    service: AIMarkdownWorkflowService.getInstance(),
    state,
  };
}

function testRecognizesSupportedAiMarkdownFileNames() {
  const {
    classifyAIMarkdownFileName,
    isAIMarkdownFileName,
  } = loadDetector();

  assert.strictEqual(classifyAIMarkdownFileName('/workspace/agents/QA.agent.md').kind, 'agent');
  assert.strictEqual(classifyAIMarkdownFileName('/workspace/prompts/review.prompt.md').kind, 'prompt');
  assert.strictEqual(classifyAIMarkdownFileName('/workspace/skills/SKILL.md').kind, 'skill');
  assert.strictEqual(classifyAIMarkdownFileName('/workspace/skills/custom.skill.md').kind, 'none');
  assert.strictEqual(isAIMarkdownFileName('/workspace/notes/README.md'), false);
}

function testDescribeDocumentReportsReadyAvailability() {
  const { service } = loadWorkflowService({
    config: {
      'ai.enable': true,
      'ai.enableAffordances': true,
      'ai.enableChatInterop': true,
      'ai.provider': 'copilotChat',
    },
    installedExtensions: ['GitHub.copilot-chat'],
  });

  const descriptor = service.describeDocument(
    createDocument('/workspace/agents/QA.agent.md'),
    { hasPendingChatEdits: true }
  );

  assert.strictEqual(descriptor.kind, 'agent');
  assert.strictEqual(descriptor.isAIMarkdown, true);
  assert.strictEqual(descriptor.relativePath, 'agents/QA.agent.md');
  assert.strictEqual(descriptor.hasPendingChatEdits, true);
  assert.strictEqual(descriptor.availability.status, 'ready');
  assert.match(descriptor.availability.detail, /manual paste/i);
}

function testDescribeDocumentReflectsAffordancesSetting() {
  const { service } = loadWorkflowService({
    config: {
      'ai.enable': true,
      'ai.enableAffordances': false,
      'ai.enableChatInterop': true,
      'ai.provider': 'copilotChat',
    },
    installedExtensions: ['GitHub.copilot-chat'],
  });

  const descriptor = service.describeDocument(createDocument('/workspace/prompts/review.prompt.md'));

  assert.strictEqual(descriptor.isAIMarkdown, true);
  assert.strictEqual(descriptor.availability.enabled, true);
  assert.strictEqual(descriptor.availability.affordancesEnabled, false);
  assert.strictEqual(descriptor.availability.status, 'ready');
}

async function testBuildContextPackageIncludesStructuredContext() {
  const { service } = loadWorkflowService({
    config: {
      'ai.maxContextItems': 1,
      'ai.maxContextChars': 8000,
    },
    installedExtensions: ['GitHub.copilot-chat'],
    outgoingLinks: [
      { text: 'Spec', url: 'spec.md', type: 'markdown', resolved: '/workspace/spec.md', line: 3 },
      { text: 'Ignored', url: 'ignored.md', type: 'markdown', resolved: '/workspace/ignored.md', line: 9 },
    ],
    backlinks: [
      { name: 'Overview', path: '/workspace/overview.md', relativePath: 'overview.md', lineNumber: 7, context: 'Links here' },
      { name: 'Ignored', path: '/workspace/ignored.md', relativePath: 'ignored.md', lineNumber: 2, context: 'Ignore me' },
    ],
    relatedFiles: [
      { name: 'Roadmap', path: '/workspace/roadmap.md', relativePath: 'roadmap.md', score: 0.91 },
      { name: 'Ignored', path: '/workspace/ignored.md', relativePath: 'ignored.md', score: 0.5 },
    ],
    graphData: {
      nodes: [
        { id: 'focus', label: 'review.prompt.md', isFocus: true },
        { id: 'spec', label: 'spec.md', isFocus: false },
        { id: 'ignored', label: 'ignored.md', isFocus: false },
      ],
      edges: [
        { source: 'focus', target: 'spec', type: 'link' },
        { source: 'focus', target: 'ignored', type: 'link' },
      ],
    },
  });

  const contextPackage = await service.buildContextPackage(
    createDocument('/workspace/prompts/review.prompt.md'),
    { hasPendingChatEdits: true }
  );

  const json = JSON.parse(contextPackage.json);
  assert.match(contextPackage.markdown, /AI Markdown Context Package/);
  assert.match(contextPackage.markdown, /Pending chat edits are currently detected/);
  assert.match(contextPackage.markdown, /Backlinks/);
  assert.match(contextPackage.markdown, /Overview/);
  assert.doesNotMatch(contextPackage.markdown, /Ignored \(ignored\.md\)/);
  assert.strictEqual(json.file.type, 'prompt');
  assert.strictEqual(json.backlinks.length, 1);
  assert.strictEqual(json.outgoingLinks.length, 1);
  assert.strictEqual(json.relatedFiles.length, 1);
}

async function testCopyContextPackageWritesClipboard() {
  const { service, state } = loadWorkflowService();

  const contextPackage = await service.copyContextPackage(
    createDocument('/workspace/prompts/review.prompt.md')
  );

  assert.strictEqual(state.clipboardWrites.length, 1);
  assert.strictEqual(state.clipboardWrites[0], contextPackage.markdown);
}

function testValidateDocumentAcceptsCompleteAgentTemplate() {
  const { service } = loadWorkflowService();
  const text = [
    '## Identity',
    '## Scope',
    '## Tool Permissions',
    '## Process',
    '## Acceptance Criteria',
    '## Escalation Rules',
  ].join('\n\n');

  const result = service.validateDocument(createDocument('/workspace/agents/QA.agent.md', text));

  assert.strictEqual(result.isAIMarkdown, true);
  assert.strictEqual(result.isValid, true);
  assert.deepStrictEqual(result.missingSections, []);
  assert.ok(result.presentSections.includes('Identity'));
}

function testValidateDocumentReportsMissingPromptSections() {
  const { service } = loadWorkflowService();
  const text = [
    '# Review Prompt',
    '## Intent',
    '## Inputs',
  ].join('\n\n');

  const result = service.validateDocument(createDocument('/workspace/prompts/review.prompt.md', text));

  assert.strictEqual(result.isAIMarkdown, true);
  assert.strictEqual(result.isValid, false);
  assert.ok(result.presentSections.includes('Intent'));
  assert.ok(result.missingSections.includes('Variables'));
  assert.ok(result.missingSections.includes('Constraints'));
  assert.ok(result.missingSections.includes('Expected Output'));
}

function testTemplateSnippetAddsFrontmatterForAiMarkdownFiles() {
  const { service } = loadWorkflowService();
  const document = createDocument('/workspace/prompts/review.prompt.md', '# Review Prompt');

  const snippet = service.getTemplateSnippet(document);

  assert.match(snippet, /^---/);
  assert.match(snippet, /kind: prompt/);
  assert.match(snippet, /title: New Prompt/);
  assert.match(snippet, /status: draft/);
  assert.match(snippet, /## Intent/);
}

function testKeepsNormalMarkdownStable() {
  const { service } = loadWorkflowService();
  const document = createDocument('/workspace/notes/meeting-notes.md', '# Meeting Notes\n\nRegular markdown content.');

  const descriptor = service.describeDocument(document);
  const validation = service.validateDocument(document);
  const snippet = service.getTemplateSnippet(document);

  assert.strictEqual(descriptor.kind, 'none');
  assert.strictEqual(descriptor.isAIMarkdown, false);
  assert.strictEqual(validation.isAIMarkdown, false);
  assert.strictEqual(validation.isValid, true);
  assert.match(snippet, /## Intent/);
  assert.doesNotMatch(snippet, /^---/);
  assert.doesNotMatch(snippet, /## Identity/);
}

async function testOpenChatWorkflowFallsBackWhenAiIsDisabled() {
  const { service, state } = loadWorkflowService({
    config: {
      'ai.enable': false,
      'ai.provider': 'copilotChat',
    },
    installedExtensions: ['GitHub.copilot-chat'],
    availableCommands: ['workbench.action.chat.open'],
  });

  const result = await service.openChatWorkflow(createDocument('/workspace/agents/QA.agent.md'));

  assert.strictEqual(result.copiedToClipboard, true);
  assert.strictEqual(result.openedChat, false);
  assert.match(result.message, /disabled/i);
  assert.strictEqual(state.executedCommands.length, 0);
  assert.strictEqual(state.clipboardWrites.length, 1);
}

async function testOpenChatWorkflowRespectsChatInteropSetting() {
  const { service, state } = loadWorkflowService({
    config: {
      'ai.enable': true,
      'ai.enableChatInterop': false,
      'ai.provider': 'copilotChat',
    },
    installedExtensions: ['GitHub.copilot-chat'],
    availableCommands: ['workbench.action.chat.open'],
  });

  const result = await service.openChatWorkflow(createDocument('/workspace/prompts/review.prompt.md'));

  assert.strictEqual(result.copiedToClipboard, true);
  assert.strictEqual(result.openedChat, false);
  assert.match(result.message, /disabled in settings/i);
  assert.strictEqual(state.executedCommands.length, 0);
}

async function testOpenChatWorkflowUsesFirstAvailableChatCommand() {
  const { service, state } = loadWorkflowService({
    config: {
      'ai.enable': true,
      'ai.enableChatInterop': true,
      'ai.provider': 'copilotChat',
    },
    installedExtensions: ['GitHub.copilot-chat'],
    availableCommands: ['workbench.action.chat.newChat', 'workbench.action.chat.open'],
  });

  const result = await service.openChatWorkflow(createDocument('/workspace/agents/QA.agent.md'));

  assert.strictEqual(result.copiedToClipboard, true);
  assert.strictEqual(result.openedChat, true);
  assert.strictEqual(result.commandId, 'workbench.action.chat.open');
  assert.deepStrictEqual(state.executedCommands, ['workbench.action.chat.open']);
}

async function testOpenChatWorkflowHandlesExecutionFailure() {
  const { service, state } = loadWorkflowService({
    config: {
      'ai.enable': true,
      'ai.enableChatInterop': true,
      'ai.provider': 'copilotChat',
    },
    installedExtensions: ['GitHub.copilot-chat'],
    availableCommands: ['workbench.action.chat.open'],
    executeCommandError: new Error('boom'),
  });

  const result = await service.openChatWorkflow(createDocument('/workspace/skills/SKILL.md'));

  assert.strictEqual(result.copiedToClipboard, true);
  assert.strictEqual(result.openedChat, false);
  assert.match(result.message, /opening chat failed/i);
  assert.strictEqual(state.executedCommands.length, 1);
  assert.strictEqual(state.warns.length, 1);
}

function testInlineSuggestionServiceUsesCopilotLmApi() {
  assert(inlineSuggestionServiceSource.includes("selectChatModels({ vendor: 'copilot' })"));
  assert(inlineSuggestionServiceSource.includes('LanguageModelChatMessage.User(prompt)'));
  assert(inlineSuggestionServiceSource.includes('Return only the immediate continuation text that should appear after the cursor.'));
}

function testInlineCompletionProviderRegistersSupportedLanguages() {
  assert(inlineCompletionProviderSource.includes("'markdown'"));
  assert(inlineCompletionProviderSource.includes("'chatagent'"));
  assert(inlineCompletionProviderSource.includes("'skill'"));
  assert(inlineCompletionProviderSource.includes("'prompt'"));
  assert(inlineCompletionProviderSource.includes('new vscode.InlineCompletionItem('));
}

test('recognizes supported AI markdown file names', testRecognizesSupportedAiMarkdownFileNames);
test('prompt taxonomy stays consistent across documentation, detection, templates, and validation', () => {
  const expected = ['Intent', 'Inputs', 'Variables', 'Constraints', 'Expected Output'];
  const plan = fs.readFileSync(path.join(__dirname, '..', 'plans', 'done', 'ai-markdown-support-plan.md'), 'utf8');
  const promptSection = plan.split('#### `.prompt.md`')[1].split('#### `SKILL.md`')[0];
  const documentedLabels = [...promptSection.split('Expected sections:')[1].matchAll(/^- (.+)$/gm)]
    .map((match) => match[1]);
  assert.deepStrictEqual(documentedLabels, expected);

  const document = createDocument('/workspace/prompts/review.prompt.md');
  const { service } = loadWorkflowService();
  assert.deepStrictEqual(detector.classifyAIMarkdownFileName(document.fileName).suggestedSections, expected);
  const snippet = service.getTemplateSnippet(document);
  assert.deepStrictEqual([...snippet.matchAll(/^## (.+)$/gm)].map((match) => match[1]), expected);
  const validation = service.validateDocument(createDocument(document.fileName, snippet));
  assert.strictEqual(validation.isValid, true);
  assert.deepStrictEqual(validation.presentSections, expected);
  assert.deepStrictEqual(validation.missingSections, []);
});
test('describeDocument reports ready availability', testDescribeDocumentReportsReadyAvailability);
test('describeDocument reflects affordances setting', testDescribeDocumentReflectsAffordancesSetting);
test('buildContextPackage includes structured context', testBuildContextPackageIncludesStructuredContext);
test('copyContextPackage writes clipboard', testCopyContextPackageWritesClipboard);
test('validateDocument accepts complete agent template', testValidateDocumentAcceptsCompleteAgentTemplate);
test('validateDocument reports missing prompt sections', testValidateDocumentReportsMissingPromptSections);
test('template snippet adds frontmatter for AI markdown files', testTemplateSnippetAddsFrontmatterForAiMarkdownFiles);
test('keeps normal markdown stable', testKeepsNormalMarkdownStable);
test('openChatWorkflow falls back when AI is disabled', testOpenChatWorkflowFallsBackWhenAiIsDisabled);
test('openChatWorkflow respects chat interop setting', testOpenChatWorkflowRespectsChatInteropSetting);
test('openChatWorkflow uses first available chat command', testOpenChatWorkflowUsesFirstAvailableChatCommand);
test('openChatWorkflow handles execution failure', testOpenChatWorkflowHandlesExecutionFailure);
test('InlineSuggestionService uses Copilot LM API', testInlineSuggestionServiceUsesCopilotLmApi);
test('inline completion provider registers supported languages', testInlineCompletionProviderRegistersSupportedLanguages);
