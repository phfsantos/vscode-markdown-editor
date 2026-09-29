import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  canonicalDocumentKey,
  parseExtensionNavigationUri,
  parseMarkdownPositionLink,
  parsePositionFragment,
} from '../src/navigation/MarkdownLinkTarget';
import {
  MarkdownEditorNavigation,
  SourcePositionDelivery,
} from '../src/navigation/MarkdownEditorNavigation';

describe('Markdown position link parsing', () => {
  test('accepts canonical line fragments and converts one-based values exactly once', () => {
    expect(parsePositionFragment('#L12')).toEqual({ line: 11, character: 0 });
    expect(parsePositionFragment('l12c5')).toEqual({ line: 11, character: 4 });
  });

  test('leaves ordinary headings and malformed position fragments untouched', () => {
    for (const fragment of [
      '#install',
      '#L0',
      '#L1C0',
      '#L-1',
      '#L1C2extra',
      '#L9007199254740992',
      '#L1C9007199254740992',
    ]) {
      expect(parsePositionFragment(fragment)).toBeNull();
    }
  });

  test('resolves a relative Markdown position link and strips navigation metadata from its URI', () => {
    const base = vscode.Uri.file('/workspace/docs/current.md');
    const parsed = parseMarkdownPositionLink('../other.markdown#L3C2', base);

    expect(parsed?.uri.fsPath).toBe('/workspace/other.markdown');
    expect(parsed?.uri.fragment).toBe('');
    expect(parsed?.target).toMatchObject({
      position: { line: 2, character: 1 },
      origin: 'markdown-link',
    });
    expect(canonicalDocumentKey(parsed!.uri)).toBe(canonicalDocumentKey(vscode.Uri.file('/workspace/other.markdown')));
  });

  test('parses only the extension-owned deep-link contract', () => {
    const targetUri = vscode.Uri.file('/workspace/note.md').toString();
    const parsed = parseExtensionNavigationUri(vscode.Uri.parse(
      `vscode://phfsantos.markdown-editor/open?uri=${encodeURIComponent(targetUri)}&line=8&character=3`,
    ));

    expect(parsed?.uri.fsPath).toBe('/workspace/note.md');
    expect(parsed?.target).toMatchObject({ position: { line: 7, character: 2 }, origin: 'uri-handler' });
    expect(parseExtensionNavigationUri(vscode.Uri.parse('vscode://wrong.extension/open?line=2'))).toBeNull();
    expect(parseExtensionNavigationUri(vscode.Uri.parse('vscode://phfsantos.markdown-editor/open?uri=x&line=0'))).toBeNull();
  });
});

describe('source-position delivery', () => {
  test('keeps only the latest request until the webview is ready and consumes it once', () => {
    const post = vi.fn();
    const delivery = new SourcePositionDelivery(post);
    const first = { position: { line: 0, character: 0 }, reveal: 'center' as const, highlight: true, origin: 'command' as const };
    const latest = { ...first, position: { line: 4, character: 2 } };

    delivery.reveal(first);
    delivery.reveal(latest);
    expect(post).not.toHaveBeenCalled();
    delivery.markReady();
    delivery.markReady();

    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith({ command: 'revealSourcePosition', target: latest });
  });

  test('posts immediately when ready and ignores requests after disposal', () => {
    const post = vi.fn();
    const delivery = new SourcePositionDelivery(post);
    const target = { position: { line: 1, character: 0 }, reveal: 'center' as const, highlight: true, origin: 'command' as const };
    delivery.markReady();
    delivery.reveal(target);
    delivery.dispose();
    delivery.reveal({ ...target, position: { line: 9, character: 0 } });
    expect(post).toHaveBeenCalledOnce();
  });
});

describe('MarkdownEditorNavigation', () => {
  let openEditor: ReturnType<typeof vi.fn>;
  let stat: ReturnType<typeof vi.fn>;
  let showError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openEditor = vi.fn(async () => undefined);
    stat = vi.fn(async () => ({ type: 1 }));
    showError = vi.fn();
  });

  test('reveals an existing panel without opening a duplicate', async () => {
    const navigation = new MarkdownEditorNavigation({ openEditor, stat, showError });
    const uri = vscode.Uri.file('/workspace/note.md');
    const panel = { uri, reveal: vi.fn(), revealSourcePosition: vi.fn() };
    navigation.registerPanel(panel);

    await navigation.openEditor(vscode.Uri.parse(`${uri.toString()}#L4C2`));

    expect(panel.reveal).toHaveBeenCalledOnce();
    expect(panel.revealSourcePosition).toHaveBeenCalledWith(expect.objectContaining({ position: { line: 3, character: 1 } }));
    expect(openEditor).not.toHaveBeenCalled();
  });

  test('queues the latest target without opening a duplicate panel while the first open is pending', async () => {
    let finishOpen: (() => void) | undefined;
    openEditor = vi.fn(() => new Promise<undefined>(resolve => {
      finishOpen = () => resolve(undefined);
    }));
    const navigation = new MarkdownEditorNavigation({ openEditor, stat, showError });
    const uri = vscode.Uri.file('/workspace/note.md');

    const first = navigation.openEditor(vscode.Uri.parse(`${uri.toString()}#L2`));
    const latest = navigation.openEditor(vscode.Uri.parse(`${uri.toString()}#L7C3`));
    await vi.waitFor(() => expect(openEditor).toHaveBeenCalled());

    expect(openEditor).toHaveBeenCalledOnce();
    finishOpen?.();
    await Promise.all([first, latest]);

    expect(navigation.consumePendingTarget(uri)).toMatchObject({ position: { line: 6, character: 2 } });
    expect(navigation.consumePendingTarget(uri)).toBeUndefined();
  });

  test('rejects unsupported, non-Markdown, and missing resources without opening or creating files', async () => {
    const navigation = new MarkdownEditorNavigation({ openEditor, stat, showError });
    await navigation.openEditor(vscode.Uri.parse('https://example.com/note.md#L2'));
    await navigation.openEditor(vscode.Uri.parse('file:///workspace/note.txt#L2'));
    stat.mockRejectedValueOnce(new Error('missing'));
    await navigation.openEditor(vscode.Uri.parse('file:///workspace/missing.md#L2'));

    expect(openEditor).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledTimes(3);
  });

  test('rejects directory targets even when their name ends in Markdown', async () => {
    stat.mockResolvedValueOnce({ type: 2 });
    const navigation = new MarkdownEditorNavigation({ openEditor, stat, showError });

    await navigation.openEditor(vscode.Uri.parse('file:///workspace/folder.md#L2'));

    expect(openEditor).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledOnce();
  });

  test('clears a failed opening request so a later panel cannot consume a stale target', async () => {
    openEditor.mockResolvedValueOnce(undefined);
    const navigation = new MarkdownEditorNavigation({ openEditor, stat, showError });
    const uri = vscode.Uri.file('/workspace/note.md');

    await navigation.openEditor(vscode.Uri.parse(`${uri.toString()}#L9`));

    expect(openEditor).toHaveBeenCalledWith(uri, expect.objectContaining({ mustExist: true }));
    expect(navigation.consumePendingTarget(uri)).toBeUndefined();
  });
});
