import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { __reset } from './mocks/vscode';

// ---- Webview side: the AI bridge reacts to host messages ------------------

const ui = vi.hoisted(() => ({
  updateAIMarkdownUI: vi.fn(),
  handleAIMarkdownActionResult: vi.fn(),
  updateChatAnchorUI: vi.fn(),
  inline: {
    initialize: vi.fn(),
    updateEligibility: vi.fn(),
    handleExternalUpdate: vi.fn(),
    handleSuggestionResponse: vi.fn(),
  },
}));

vi.mock('../packages/media/src/ai-markdown-ui', () => ({
  updateAIMarkdownUI: ui.updateAIMarkdownUI,
  handleAIMarkdownActionResult: ui.handleAIMarkdownActionResult,
}));
vi.mock('../packages/media/src/chat-anchor-ui', () => ({ updateChatAnchorUI: ui.updateChatAnchorUI }));
vi.mock('../packages/media/src/inline-suggestion-ui', () => ({ inlineSuggestionController: ui.inline }));

vi.mock('vscode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mocks/vscode')>();
  return {
    ...actual,
    InlineCompletionList: class { constructor(public items: unknown[]) {} },
    InlineCompletionItem: class { constructor(public insertText: string, public range?: unknown) {} },
    Range: class { constructor(public start: unknown, public end: unknown) {} },
    InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
    get lm() { return languageModels.api; },
    commands: {
      ...actual.commands,
      executeCommand: vi.fn(async (command: string, ...args: unknown[]) => {
        executed.push({ command, args });
      }),
    },
  };
});
const executed: Array<{ command: string; args: unknown[] }> = [];
const languageModels = vi.hoisted(() => ({ api: undefined as unknown }));

const webviewTarget = { postMessage: vi.fn() };
const vditor = { insertValue: vi.fn() };

let routeHostMessage: (raw: unknown) => string;

function postFromHost(data: unknown): void {
  routeHostMessage(data);
}

function postToWindow(data: unknown): void {
  const event = new Event('message');
  Object.defineProperty(event, 'data', { value: data });
  (globalThis as unknown as { window: EventTarget }).window.dispatchEvent(event);
}

beforeAll(async () => {
  const window = Object.assign(new EventTarget(), { vscode: webviewTarget, vditor });
  vi.stubGlobal('window', window);
  const { aiMarkdownRoutes, syncAiMarkdownFromUpdate } = await import('../packages/media/src/ai-markdown-bridge');
  const { createHostMessageRouter } = await import('../packages/media/src/host-message-router');
  // Mirrors main.ts: `update` belongs to the document routes, which hand it to the AI bridge.
  routeHostMessage = createHostMessageRouter({
    routeGroups: [{ update: syncAiMarkdownFromUpdate }, aiMarkdownRoutes],
    reportMalformed: vi.fn(),
  });
});

describe('AI markdown webview bridge', () => {
  beforeEach(() => vi.clearAllMocks());

  const aiMarkdown = { isAIMarkdown: true, availability: { affordancesEnabled: true } };

  it('installs no window message listener of its own', () => {
    postToWindow({ command: 'inlineSuggestionEligibility', enabled: false });
    postToWindow({ command: 'insertTextAtCursor', text: '## Context' });
    postToWindow({ command: 'update', content: '', aiMarkdown });

    expect(ui.inline.updateEligibility).not.toHaveBeenCalled();
    expect(vditor.insertValue).not.toHaveBeenCalled();
    expect(ui.updateAIMarkdownUI).not.toHaveBeenCalled();
  });

  it('shows AI tools, chat anchor, and eligibility from an editor update', () => {
    const chatAnchor = { visible: true, relativePath: 'notes.md' };
    const inlineSuggestion = { enabled: true, languageId: 'markdown' };

    postFromHost({ command: 'update', content: '', aiMarkdown, chatAnchor, inlineSuggestion });

    expect(ui.inline.initialize).toHaveBeenCalledWith(webviewTarget);
    expect(ui.updateAIMarkdownUI).toHaveBeenCalledWith(aiMarkdown, webviewTarget);
    expect(ui.updateChatAnchorUI).toHaveBeenCalledWith(chatAnchor, webviewTarget);
    expect(ui.inline.updateEligibility).toHaveBeenCalledWith(inlineSuggestion);
    expect(ui.inline.handleExternalUpdate).toHaveBeenCalled();
  });

  it('hides AI tools in a diff view', () => {
    postFromHost({ command: 'update', content: '', aiMarkdown, isDiffView: true });

    expect(ui.updateAIMarkdownUI).toHaveBeenCalledWith(undefined, webviewTarget);
  });

  it('inserts host-provided text at the cursor', () => {
    postFromHost({ command: 'insertTextAtCursor', text: '## Context' });

    expect(vditor.insertValue).toHaveBeenCalledWith('## Context');
  });

  it('ignores empty insertions', () => {
    postFromHost({ command: 'insertTextAtCursor', text: '' });

    expect(vditor.insertValue).not.toHaveBeenCalled();
  });

  it('shows AI action results and suggestion responses', () => {
    const result = { command: 'aiMarkdownActionResult', message: 'done', level: 'info' };
    const suggestion = { command: 'inlineSuggestionResult', requestId: 'r1', suggestion: 'text' };

    postFromHost(result);
    postFromHost(suggestion);

    expect(ui.handleAIMarkdownActionResult).toHaveBeenCalledWith(result);
    expect(ui.inline.handleSuggestionResponse).toHaveBeenCalledWith(suggestion);
  });

  it('clears a visible suggestion when the host disables eligibility', () => {
    postFromHost({ command: 'inlineSuggestionEligibility', enabled: false });

    expect(ui.inline.updateEligibility).toHaveBeenCalledWith({ command: 'inlineSuggestionEligibility', enabled: false });
    expect(ui.inline.handleExternalUpdate).toHaveBeenCalled();
  });
});

// ---- Host side: AI routes behind the webview message router ---------------

import { AiMessageHandler, type AiHost } from '../src/app/AiMessageHandler';
import { createWebviewMessageRouter } from '../src/app/webviewMessageRouter';
import {
  INLINE_SUGGESTION_LANGUAGE_IDS,
  MarkdownInlineCompletionProvider,
} from '../src/providers/MarkdownInlineCompletionProvider';

function aiHost(overrides: Partial<AiHost> = {}) {
  const posted: Array<Record<string, unknown>> = [];
  const document = {
    uri: vscode.Uri.file('/workspace/notes.md'),
    fileName: '/workspace/notes.md',
    languageId: 'markdown',
    getText: () => '# Notes',
  } as unknown as vscode.TextDocument;
  const host: AiHost = {
    document,
    uri: document.uri,
    config: vscode.workspace.getConfiguration('markdown-editor'),
    readOnly: false,
    isDiffView: false,
    pendingChatBaselineDocument: undefined,
    postMessage: (message) => posted.push(message as Record<string, unknown>),
    ...overrides,
  };
  return { host, posted };
}

function aiWorkflow() {
  return {
    copyContextPackage: vi.fn(async () => undefined),
    buildContextPackage: vi.fn(async () => ({ markdown: '## Context' })),
    getTemplateSnippet: vi.fn(() => '## Role'),
    openChatWorkflow: vi.fn(async () => ({ openedChat: true, message: 'Chat opened.' })),
    validateDocument: vi.fn(() => ({ isAIMarkdown: true, isValid: false, missingSections: ['Role'] })),
  };
}

function aiRouter(hostOverrides: Partial<AiHost> = {}, workflow = aiWorkflow()) {
  const { host, posted } = aiHost(hostOverrides);
  const handler = new AiMessageHandler(host, workflow as never);
  const rejected: unknown[] = [];
  const route = createWebviewMessageRouter({ routeGroups: [handler.routes()], reject: (r) => rejected.push(r) });
  return { route, posted, handler, workflow, rejected };
}

describe('AI routes', () => {
  beforeEach(() => {
    __reset();
    executed.length = 0;
  });

  it.each([
    ['copyContext', 'AI context copied to the clipboard.'],
    ['insertTemplate', 'AI markdown template inserted.'],
    ['openChat', 'Chat opened.'],
    ['openGraph', 'Graph view opened for the current markdown file.'],
    ['validate', 'Missing sections: Role'],
  ])('reports the outcome of %s', async (action, message) => {
    const { route, posted } = aiRouter();

    await route({ command: 'requestAiAction', action });

    expect(posted.at(-1)).toMatchObject({ command: 'aiMarkdownActionResult', message });
  });

  it('inserts generated context through the webview', async () => {
    const { route, posted } = aiRouter();

    await route({ command: 'requestAiAction', action: 'insertContext' });

    expect(posted).toEqual([
      { command: 'insertTextAtCursor', text: '## Context' },
      { command: 'aiMarkdownActionResult', message: 'Structured AI context inserted at the cursor.', level: 'info' },
    ]);
  });

  it('opens the graph view for the current document', async () => {
    const { route } = aiRouter();

    await route({ command: 'requestAiAction', action: 'openGraph' });

    expect(executed.at(-1)?.command).toBe('markdown-editor.openGraphView');
    expect(executed.at(-1)?.args[0]).toMatchObject({ docUri: 'file:///workspace/notes.md', depth: 1 });
  });

  it('reports unsupported actions without side effects', async () => {
    const { route, posted, workflow } = aiRouter();

    await route({ command: 'requestAiAction', action: 'launchRockets' });

    expect(posted).toEqual([
      { command: 'aiMarkdownActionResult', message: 'Unsupported AI markdown action: launchRockets', level: 'warning' },
    ]);
    expect(workflow.copyContextPackage).not.toHaveBeenCalled();
  });

  it('reports workflow failures as errors', async () => {
    const workflow = aiWorkflow();
    workflow.buildContextPackage.mockRejectedValueOnce(new Error('index unavailable'));
    const { route, posted } = aiRouter({}, workflow);

    await route({ command: 'requestAiAction', action: 'insertContext' });

    expect(posted).toEqual([
      { command: 'aiMarkdownActionResult', message: 'AI markdown action failed: index unavailable', level: 'error' },
    ]);
  });

  it('refuses AI actions in a diff view', async () => {
    const { route, posted, workflow } = aiRouter({ isDiffView: true });

    await route({ command: 'requestAiAction', action: 'copyContext' });

    expect(posted).toEqual([
      { command: 'aiMarkdownActionResult', message: 'AI tools are unavailable in diff view.', level: 'warning' },
    ]);
    expect(workflow.copyContextPackage).not.toHaveBeenCalled();
  });

  it('rejects an AI action without an action name', async () => {
    const { route, posted, rejected } = aiRouter();

    await route({ command: 'requestAiAction' });

    expect(posted).toEqual([]);
    expect(rejected).toEqual([{ command: 'messageRejected', rejectedCommand: 'requestAiAction', issues: ['action is required'] }]);
  });

  it('answers suggestion requests with an empty suggestion while the setting is off', async () => {
    const { route, posted } = aiRouter();

    await route({ command: 'requestInlineSuggestion', requestId: 'r1', beforeCursor: '# No' });

    expect(posted).toEqual([{ command: 'inlineSuggestionResult', requestId: 'r1', suggestion: '' }]);
  });
});

describe('AI affordance eligibility', () => {
  beforeEach(() => __reset());

  it('offers add-to-chat for ordinary markdown outside diff views', () => {
    expect(aiRouter().handler.canShowAddToChatButton()).toBe(true);
    expect(aiRouter({ isDiffView: true }).handler.canShowAddToChatButton()).toBe(false);
  });

  it('does not offer add-to-chat for AI markdown files', () => {
    const document = { uri: vscode.Uri.file('/workspace/helper.agent.md'), fileName: '/workspace/helper.agent.md' };

    expect(aiRouter({ document: document as never, uri: document.uri }).handler.canShowAddToChatButton()).toBe(false);
  });

  it('enables inline suggestions only when opted in and editable outside diff views', () => {
    expect(aiRouter().handler.canShowInlineSuggestions()).toBe(false);

    __reset({ config: { 'ai.enableInlineSuggestions': true } });
    expect(aiRouter().handler.canShowInlineSuggestions()).toBe(true);
    expect(aiRouter({ readOnly: true }).handler.canShowInlineSuggestions()).toBe(false);
    expect(aiRouter({ isDiffView: true }).handler.canShowInlineSuggestions()).toBe(false);
  });
});

describe('native inline completion provider', () => {
  beforeEach(() => __reset());

  const document = (languageId: string) => ({
    uri: vscode.Uri.file('/workspace/notes.md'),
    languageId,
    getText: () => '# Notes',
    offsetAt: () => 7,
  }) as unknown as vscode.TextDocument;

  it('covers every editor language', () => {
    expect([...INLINE_SUGGESTION_LANGUAGE_IDS]).toEqual(['markdown', 'chatagent', 'skill', 'prompt']);
  });

  it('offers nothing until the user opts in', async () => {
    const provider = new MarkdownInlineCompletionProvider();

    const result = await provider.provideInlineCompletionItems(document('markdown'), {} as never, {} as never, {} as never);

    expect(result).toEqual({ items: [] });
  });

  it('offers nothing for unsupported languages even when opted in', async () => {
    __reset({ config: { 'ai.enableInlineSuggestions': true } });
    const provider = new MarkdownInlineCompletionProvider();

    const result = await provider.provideInlineCompletionItems(document('typescript'), {} as never, {} as never, {} as never);

    expect(result).toEqual({ items: [] });
  });
});

// ---- Copilot language-model path ------------------------------------------

import { InlineSuggestionService } from '../src/services/InlineSuggestionService';

function copilotModel(reply: string[]) {
  const requests: unknown[][] = [];
  const model = {
    id: 'gpt-4o',
    sendRequest: vi.fn(async (messages: unknown[]) => {
      requests.push(messages);
      return { text: (async function* () { yield* reply; })() };
    }),
  };
  const selectChatModels = vi.fn(async () => [model]);
  languageModels.api = { selectChatModels };
  return { selectChatModels, model, requests };
}

const notCancelled = { isCancellationRequested: false } as vscode.CancellationToken;

function suggestionRequest(overrides: Record<string, unknown> = {}) {
  return {
    document: {} as vscode.TextDocument,
    content: 'Hello wor',
    beforeCursor: 'Hello wor',
    afterCursor: '',
    languageId: 'markdown',
    manual: false,
    ...overrides,
  };
}

describe('inline suggestions through the Copilot language model API', () => {
  beforeEach(() => {
    __reset();
    languageModels.api = undefined;
  });

  it('asks a Copilot model for a bare continuation of the text before the cursor', async () => {
    const { selectChatModels, requests } = copilotModel(['ld']);

    const suggestion = await InlineSuggestionService.getInstance().getSuggestion(suggestionRequest(), notCancelled);

    expect(suggestion).toBe('ld');
    expect(selectChatModels).toHaveBeenCalledWith({ vendor: 'copilot' });
    const [message] = requests[0] as Array<{ role: string; content: string }>;
    expect(message.role).toBe('user');
    expect(message.content).toContain('Return only the immediate continuation text that should appear after the cursor.');
    expect(message.content).toContain('Text before cursor:\nHello wor');
  });

  it('strips fences and labels and drops text that repeats the suffix', async () => {
    copilotModel(['```\nSuggestion: ld!', '```']);

    const suggestion = await InlineSuggestionService.getInstance().getSuggestion(
      suggestionRequest({ afterCursor: '!' }),
      notCancelled,
    );

    expect(suggestion).toBe('ld');
  });

  it('suggests nothing on hosts without the language model API', async () => {
    const suggestion = await InlineSuggestionService.getInstance().getSuggestion(suggestionRequest(), notCancelled);

    expect(suggestion).toBeUndefined();
  });

  it('surfaces the model continuation as a native inline completion once opted in', async () => {
    __reset({ config: { 'ai.enableInlineSuggestions': true } });
    copilotModel(['ld']);
    const document = {
      uri: vscode.Uri.file('/workspace/notes.md'),
      languageId: 'skill',
      getText: () => 'Hello wor',
      offsetAt: () => 9,
    } as unknown as vscode.TextDocument;

    const result = await new MarkdownInlineCompletionProvider().provideInlineCompletionItems(
      document,
      { line: 0, character: 9 } as vscode.Position,
      {} as never,
      notCancelled,
    );

    expect((result as unknown as { items: Array<{ insertText: string }> }).items.map((item) => item.insertText)).toEqual(['ld']);
  });
});
