import { beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
  scoped: {} as {
    globalValue?: Record<string, string>;
    workspaceValue?: Record<string, string>;
    workspaceFolderValue?: Record<string, string>;
  },
  effective: {} as Record<string, string>,
  update: vi.fn(async (..._args: unknown[]) => undefined),
  info: vi.fn(),
  error: vi.fn(),
  configResources: [] as unknown[],
}));

vi.mock('vscode', () => ({
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  workspace: {
    getConfiguration: (_section?: string, resource?: unknown) => {
      host.configResources.push(resource);
      return {
        get: (_key: string, fallback: unknown) => ({ ...host.effective }) ?? fallback,
        inspect: () => ({ key: 'workbench.editorAssociations', ...host.scoped }),
        update: host.update,
      };
    },
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  window: { showInformationMessage: host.info, showErrorMessage: host.error },
}));

vi.mock('../src/utils/Logger', () => ({ logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import * as vscode from 'vscode';
import { DefaultEditorChecker } from '../src/services/DefaultEditorChecker';

const TWO_PATTERNS = ['*.md', '*.markdown'];
const checker = () => DefaultEditorChecker.getInstance();

beforeEach(() => {
  host.scoped = {};
  host.effective = {};
  host.update.mockReset();
  host.update.mockResolvedValue(undefined);
  host.info.mockReset();
  host.configResources.length = 0;
});

describe('setAsDefaultEditor', () => {
  it('preserves unrelated associations in the target scope', async () => {
    host.scoped.globalValue = { '*.json': 'custom.jsonEditor', '*.svg': 'custom.svgEditor' };

    await checker().setAsDefaultEditor(vscode.ConfigurationTarget.Global, TWO_PATTERNS);

    expect(host.update).toHaveBeenCalledWith(
      'editorAssociations',
      {
        '*.json': 'custom.jsonEditor',
        '*.svg': 'custom.svgEditor',
        '*.md': 'markdown-editor',
        '*.markdown': 'markdown-editor',
      },
      vscode.ConfigurationTarget.Global,
    );
  });

  it('does not copy workspace overrides into global settings', async () => {
    host.scoped = {
      globalValue: { '*.json': 'global.jsonEditor' },
      workspaceValue: { '*.json': 'workspace.jsonEditor', '*.png': 'workspace.imageEditor' },
    };
    host.effective = { '*.json': 'workspace.jsonEditor', '*.png': 'workspace.imageEditor' };

    await checker().setAsDefaultEditor(vscode.ConfigurationTarget.Global, TWO_PATTERNS);

    expect(host.update.mock.calls[0][1]).toEqual({
      '*.json': 'global.jsonEditor',
      '*.md': 'markdown-editor',
      '*.markdown': 'markdown-editor',
    });
  });

  it('treats a missing scoped value as empty', async () => {
    host.effective = { '*.png': 'workspace.imageEditor' };

    await checker().setAsDefaultEditor(vscode.ConfigurationTarget.Global, TWO_PATTERNS);

    expect(host.update.mock.calls[0][1]).toEqual({ '*.md': 'markdown-editor', '*.markdown': 'markdown-editor' });
  });

  it('replaces a conflicting Markdown association only for the requested patterns', async () => {
    host.scoped.globalValue = { '*.md': 'other.editor', '*.mdown': 'other.editor' };

    await checker().setAsDefaultEditor(vscode.ConfigurationTarget.Global, TWO_PATTERNS);

    expect(host.update.mock.calls[0][1]).toEqual({
      '*.md': 'markdown-editor',
      '*.mdown': 'other.editor',
      '*.markdown': 'markdown-editor',
    });
  });

  it.each([
    [vscode.ConfigurationTarget.Workspace, 'workspaceValue'],
    [vscode.ConfigurationTarget.WorkspaceFolder, 'workspaceFolderValue'],
  ] as const)('merges the %s scope value', async (target, field) => {
    host.scoped = { globalValue: { '*.a': 'global' }, [field]: { '*.b': 'scoped' } };
    const resource = { fsPath: '/workspace/folder' } as unknown as vscode.Uri;

    await checker().setAsDefaultEditor(target, TWO_PATTERNS, resource);

    expect(host.update).toHaveBeenCalledWith(
      'editorAssociations',
      { '*.b': 'scoped', '*.md': 'markdown-editor', '*.markdown': 'markdown-editor' },
      target,
    );
  });

  it('rejects a workspace-folder write without a resource before updating', async () => {
    await expect(
      checker().setAsDefaultEditor(vscode.ConfigurationTarget.WorkspaceFolder, TWO_PATTERNS),
    ).rejects.toThrow(/resource/i);
    expect(host.update).not.toHaveBeenCalled();
  });

  it('does not claim success when the settings write fails', async () => {
    host.update.mockRejectedValueOnce(new Error('settings are read-only'));

    await expect(checker().setAsDefaultEditor()).rejects.toThrow('settings are read-only');
    expect(host.info).not.toHaveBeenCalled();
  });
});

describe('resetToDefault', () => {
  it('removes only associations owned by Markdown Studio in the target scope', async () => {
    host.scoped.globalValue = {
      '*.md': 'markdown-editor',
      '*.markdown': 'other.editor',
      '*.json': 'custom.jsonEditor',
    };
    host.effective = { '*.png': 'workspace.imageEditor' };

    await checker().resetToDefault(vscode.ConfigurationTarget.Global);

    expect(host.update).toHaveBeenCalledWith(
      'editorAssociations',
      { '*.markdown': 'other.editor', '*.json': 'custom.jsonEditor' },
      vscode.ConfigurationTarget.Global,
    );
  });

  it('rejects a workspace-folder reset without a resource', async () => {
    await expect(checker().resetToDefault(vscode.ConfigurationTarget.WorkspaceFolder)).rejects.toThrow(/resource/i);
    expect(host.update).not.toHaveBeenCalled();
  });
});
