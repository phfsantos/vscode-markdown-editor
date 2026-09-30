import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { describe, expect, test, vi } from 'vitest';
import { ExtensionUriHandler } from '../src/navigation/ExtensionUriHandler';

describe('extension URI handling', () => {
  test('registers only one URI handler during activation', () => {
    const extensionSource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'extension.ts'),
      'utf8',
    );
    const oauthSource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'services', 'calendar', 'OAuthCallbackHandler.ts'),
      'utf8',
    );

    const registrations = `${extensionSource}\n${oauthSource}`.match(/registerUriHandler\s*\(/g) ?? [];

    expect(registrations).toHaveLength(1);
  });

  test('routes OAuth callbacks to the calendar handler', async () => {
    const oauthHandler = { handleUri: vi.fn() };
    const markdownHandler = { handleUri: vi.fn() };
    const handler = new ExtensionUriHandler(oauthHandler, markdownHandler);
    const uri = vscode.Uri.parse(
      'vscode://phfsantos.markdown-editor/oauth/callback?code=abc&state=123',
    );

    await handler.handleUri(uri);

    expect(oauthHandler.handleUri).toHaveBeenCalledWith(uri);
    expect(markdownHandler.handleUri).not.toHaveBeenCalled();
  });

  test('routes other extension URIs to Markdown navigation', async () => {
    const oauthHandler = { handleUri: vi.fn() };
    const markdownHandler = { handleUri: vi.fn() };
    const handler = new ExtensionUriHandler(oauthHandler, markdownHandler);
    const uri = vscode.Uri.parse(
      'vscode://phfsantos.markdown-editor/open?uri=file%3A%2F%2F%2Fnote.md&line=2',
    );

    await handler.handleUri(uri);

    expect(markdownHandler.handleUri).toHaveBeenCalledWith(uri);
    expect(oauthHandler.handleUri).not.toHaveBeenCalled();
  });
});
