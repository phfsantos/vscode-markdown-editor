import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { __reset } from './mocks/vscode';
import { toWidgetActionMessage } from '../packages/media/src/widget-action-message';
import { createWebviewMessageRouter } from '../src/app/webviewMessageRouter';
import { EditorMessageHandlers, type HandlerHost } from '../src/app/EditorMessageHandlers';
import type { WidgetCommandPolicyPorts } from '../src/app/widgetCommandPolicy';

function handlerHost(): HandlerHost {
  return {
    document: {} as vscode.TextDocument,
    uri: vscode.Uri.file('/workspace/notes.md') as unknown as vscode.Uri,
    context: {} as vscode.ExtensionContext,
    config: vscode.workspace.getConfiguration('markdown-editor') as unknown as vscode.WorkspaceConfiguration,
    lastCursorPosition: null,
    postMessage: vi.fn(),
  };
}

function policy(overrides: Partial<WidgetCommandPolicyPorts> = {}): WidgetCommandPolicyPorts {
  return {
    isWorkspaceTrusted: () => true,
    allowedCommands: () => [],
    confirm: vi.fn(async () => undefined),
    allowAlways: vi.fn(async () => undefined),
    ...overrides,
  };
}

function buttonCommand(command: string, args: unknown[] = []) {
  return toWidgetActionMessage({
    actionType: 'vscode-command',
    action: 'run',
    data: { command, args },
    widgetId: 'button-1',
    timestamp: '2026-10-26T00:00:00.000Z',
  });
}

describe('widget vscode-command actions over the typed protocol', () => {
  let executeCommand: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __reset();
    executeCommand = vi.spyOn(vscode.commands, 'executeCommand');
  });

  afterEach(() => {
    executeCommand.mockRestore();
  });

  function route(ports: WidgetCommandPolicyPorts) {
    const reject = vi.fn();
    const handle = createWebviewMessageRouter({
      routeGroups: [new EditorMessageHandlers(handlerHost(), ports).routes()],
      reject,
    });
    return { handle, reject };
  }

  it('runs the button command with its args after the webview bridge builds the message', async () => {
    const { handle, reject } = route(policy({ confirm: vi.fn(async () => 'run' as const) }));

    const outcome = await handle(buttonCommand('workbench.action.openSettings', ['editor.fontSize']));

    expect(reject).not.toHaveBeenCalled();
    expect(outcome).toBe('handled');
    expect(executeCommand).toHaveBeenCalledWith('workbench.action.openSettings', 'editor.fontSize');
  });

  it('does not run a command the user declines', async () => {
    const { handle } = route(policy());

    await handle(buttonCommand('workbench.action.terminal.sendSequence', [{ text: 'echo pwned\n' }]));

    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('does not run any widget command in an untrusted workspace', async () => {
    const ports = policy({ isWorkspaceTrusted: () => false, allowedCommands: () => ['workbench.action.openSettings'] });
    const { handle } = route(ports);

    await handle(buttonCommand('workbench.action.openSettings'));

    expect(executeCommand).not.toHaveBeenCalled();
    expect(ports.confirm).not.toHaveBeenCalled();
  });
});
