import { beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
  order: [] as string[],
  setAsDefaultEditor: vi.fn(),
  showErrorMessage: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('vscode', () => ({
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  window: { showErrorMessage: host.showErrorMessage },
}));
vi.mock('../src/utils/Logger', () => ({ logger: { error: host.loggerError } }));
vi.mock('../src/services/DefaultEditorChecker', () => ({
  DefaultEditorChecker: { getInstance: () => ({ setAsDefaultEditor: host.setAsDefaultEditor }) },
}));

import { setMarkdownStudioAsDefaultEditor } from '../src/commands/setAsDefaultEditorCommand';

beforeEach(() => {
  host.order.length = 0;
  host.setAsDefaultEditor.mockReset();
  host.showErrorMessage.mockReset();
  host.loggerError.mockReset();
});

describe('markdown-editor.setAsDefaultEditor handler', () => {
  it('delegates a global two-pattern write to the checker and refreshes afterward', async () => {
    host.setAsDefaultEditor.mockImplementation(async () => { host.order.push('write'); });
    const refresh = vi.fn(() => { host.order.push('refresh'); });

    await setMarkdownStudioAsDefaultEditor(refresh);

    expect(host.setAsDefaultEditor).toHaveBeenCalledWith(1, ['*.md', '*.markdown']);
    expect(host.order).toEqual(['write', 'refresh']);
  });

  it('reports a failed write without refreshing', async () => {
    host.setAsDefaultEditor.mockRejectedValue(new Error('settings are read-only'));
    const refresh = vi.fn();

    await setMarkdownStudioAsDefaultEditor(refresh);

    expect(refresh).not.toHaveBeenCalled();
    expect(host.loggerError).toHaveBeenCalled();
    expect(host.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('settings are read-only'),
    );
  });
});
