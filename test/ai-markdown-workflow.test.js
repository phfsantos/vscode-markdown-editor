const assert = require('assert');
require('ts-node/register/transpile-only');
const Module = require('module');
const fs = require('fs');
const path = require('path');

const originalLoad = Module._load;
const workflowServicePath = require.resolve('../src/services/AIMarkdownWorkflowService.ts');
const detectorPath = require.resolve('../src/services/AIMarkdownDetector.ts');
const inlineSuggestionServiceSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'InlineSuggestionService.ts'), 'utf8');
const inlineCompletionProviderSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'providers', 'MarkdownInlineCompletionProvider.ts'), 'utf8');

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
  delete require.cache[detectorPath];
  return require('../src/services/AIMarkdownDetector.ts');
}

function loadWorkflowService(options = {}) {
  const state = {
    config: options.config || {},
    clipboardWrites: [],
    executedCommands: [],
    warns: [],
    availableCommands: options.availableCommands || [],
    installedExtensions: options.installedExtensions || [],
    outgoingLinks: options.outgoingLinks || [],
    backlinks: options.backlinks || [],
    relatedFiles: options.relatedFiles || [],
    graphData: options.graphData || { nodes: [], edges: [] },
    executeCommandError: options.executeCommandError || null,
    relativePathBase: options.relativePathBase || '/workspace/',
  };

  const vscodeMock = {
    workspace: {
      getConfiguration() {
        return {
          get(key, defaultValue) {
            return Object.prototype.hasOwnProperty.call(state.config, key)
              ? state.config[key]
              : defaultValue;
          },
        };
      },
      asRelativePath(uri) {
        if (uri.fsPath.startsWith(state.relativePathBase)) {
          return uri.fsPath.slice(state.relativePathBase.length);
        }

        return uri.fsPath.replace(/^\/+/, '');
      },
    },
    env: {
      clipboard: {
        async writeText(value) {
          state.clipboardWrites.push(value);
        },
      },
    },
    commands: {
      async getCommands() {
        return state.availableCommands.slice();
      },
      async executeCommand(commandId) {
        state.executedCommands.push(commandId);
        if (state.executeCommandError) {
          throw state.executeCommandError;
        }
      },
    },
    extensions: {
      getExtension(id) {
        return state.installedExtensions.includes(id) ? { id } : undefined;
      },
    },
    window: {
      createOutputChannel() {
        return {
          appendLine() {},
          show() {},
          dispose() {},
        };
      },
    },
  };

  class MockRelationshipAnalyzer {
    static getInstance() {
      return {
        async getOutgoingLinks() {
          return state.outgoingLinks;
        },
        async getBacklinks() {
          return state.backlinks;
        },
        async getRelatedFiles() {
          return state.relatedFiles;
        },
      };
    }
  }

  class MockLinkGraphGenerator {
    static getInstance() {
      return {
        async generateSimplifiedGraph() {
          return state.graphData;
        },
      };
    }
  }

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'vscode') {
      return vscodeMock;
    }

    if (request === './RelationshipAnalyzer') {
      return { RelationshipAnalyzer: MockRelationshipAnalyzer };
    }

    if (request === './LinkGraphGenerator') {
      return { LinkGraphGenerator: MockLinkGraphGenerator };
    }

    if (request === '../utils/Logger') {
      return {
        logger: {
          warn(...args) {
            state.warns.push(args);
          },
          info() {},
          debug() {},
          error() {},
        },
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[workflowServicePath];
    const { AIMarkdownWorkflowService } = require('../src/services/AIMarkdownWorkflowService.ts');
    return {
      service: AIMarkdownWorkflowService.getInstance(),
      state,
    };
  } finally {
    Module._load = originalLoad;
  }
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

  console.log('✅ testRecognizesSupportedAiMarkdownFileNames passed');
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

  console.log('✅ testDescribeDocumentReportsReadyAvailability passed');
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

  console.log('✅ testDescribeDocumentReflectsAffordancesSetting passed');
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

  console.log('✅ testBuildContextPackageIncludesStructuredContext passed');
}

async function testCopyContextPackageWritesClipboard() {
  const { service, state } = loadWorkflowService();

  const contextPackage = await service.copyContextPackage(
    createDocument('/workspace/prompts/review.prompt.md')
  );

  assert.strictEqual(state.clipboardWrites.length, 1);
  assert.strictEqual(state.clipboardWrites[0], contextPackage.markdown);

  console.log('✅ testCopyContextPackageWritesClipboard passed');
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

  console.log('✅ testValidateDocumentAcceptsCompleteAgentTemplate passed');
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

  console.log('✅ testValidateDocumentReportsMissingPromptSections passed');
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

  console.log('✅ testTemplateSnippetAddsFrontmatterForAiMarkdownFiles passed');
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

  console.log('✅ testKeepsNormalMarkdownStable passed');
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

  console.log('✅ testOpenChatWorkflowFallsBackWhenAiIsDisabled passed');
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

  console.log('✅ testOpenChatWorkflowRespectsChatInteropSetting passed');
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

  console.log('✅ testOpenChatWorkflowUsesFirstAvailableChatCommand passed');
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

  console.log('✅ testOpenChatWorkflowHandlesExecutionFailure passed');
}

function testInlineSuggestionServiceUsesCopilotLmApi() {
  assert(inlineSuggestionServiceSource.includes("selectChatModels({ vendor: 'copilot' })"));
  assert(inlineSuggestionServiceSource.includes('LanguageModelChatMessage.User(prompt)'));
  assert(inlineSuggestionServiceSource.includes('Return only the immediate continuation text that should appear after the cursor.'));

  console.log('✅ testInlineSuggestionServiceUsesCopilotLmApi passed');
}

function testInlineCompletionProviderRegistersSupportedLanguages() {
  assert(inlineCompletionProviderSource.includes("'markdown'"));
  assert(inlineCompletionProviderSource.includes("'chatagent'"));
  assert(inlineCompletionProviderSource.includes("'skill'"));
  assert(inlineCompletionProviderSource.includes("'prompt'"));
  assert(inlineCompletionProviderSource.includes('new vscode.InlineCompletionItem('));

  console.log('✅ testInlineCompletionProviderRegistersSupportedLanguages passed');
}

async function run() {
  testRecognizesSupportedAiMarkdownFileNames();
  testDescribeDocumentReportsReadyAvailability();
  testDescribeDocumentReflectsAffordancesSetting();
  await testBuildContextPackageIncludesStructuredContext();
  await testCopyContextPackageWritesClipboard();
  testValidateDocumentAcceptsCompleteAgentTemplate();
  testValidateDocumentReportsMissingPromptSections();
  testTemplateSnippetAddsFrontmatterForAiMarkdownFiles();
  testKeepsNormalMarkdownStable();
  await testOpenChatWorkflowFallsBackWhenAiIsDisabled();
  await testOpenChatWorkflowRespectsChatInteropSetting();
  await testOpenChatWorkflowUsesFirstAvailableChatCommand();
  await testOpenChatWorkflowHandlesExecutionFailure();
  testInlineSuggestionServiceUsesCopilotLmApi();
  testInlineCompletionProviderRegistersSupportedLanguages();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
