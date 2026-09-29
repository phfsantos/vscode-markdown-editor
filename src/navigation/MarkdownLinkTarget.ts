import * as path from 'path';
import * as vscode from 'vscode';
import type { SourceNavigationTarget, SourcePosition } from '@markdown-editor/core';

export interface ParsedSourceNavigation {
  uri: vscode.Uri;
  target: SourceNavigationTarget;
}

const POSITION_FRAGMENT = /^L([1-9]\d*)(?:C([1-9]\d*))?$/i;

export function parsePositionFragment(fragment: string): SourcePosition | null {
  const match = POSITION_FRAGMENT.exec(fragment.replace(/^#/, ''));
  if (!match) return null;
  const line = parsePositiveInteger(match[1]);
  const character = match[2] ? parsePositiveInteger(match[2]) : 1;
  if (line === null || character === null) return null;
  return {
    line: line - 1,
    character: character - 1,
  };
}

export function parseMarkdownPositionLink(href: string, baseUri: vscode.Uri): ParsedSourceNavigation | null {
  let parsed: vscode.Uri;
  try {
    parsed = vscode.Uri.parse(href);
  } catch {
    return null;
  }
  const position = parsePositionFragment(parsed.fragment);
  if (!position) return null;

  const uri = resolveLinkUri(parsed, baseUri).with({ fragment: '' });
  if (!isMarkdownUri(uri)) return null;
  return {
    uri,
    target: { position, reveal: 'center', highlight: true, origin: 'markdown-link' },
  };
}

export function parseExtensionNavigationUri(uri: vscode.Uri): ParsedSourceNavigation | null {
  if (uri.scheme !== 'vscode' || uri.authority !== 'phfsantos.markdown-editor' || uri.path !== '/open') {
    return null;
  }
  const query = new URLSearchParams(uri.query);
  const encodedUri = query.get('uri');
  const line = parsePositiveInteger(query.get('line'));
  const characterValue = query.get('character');
  const character = characterValue === null ? 1 : parsePositiveInteger(characterValue);
  if (!encodedUri || line === null || character === null) return null;

  try {
    const targetUri = vscode.Uri.parse(encodedUri).with({ fragment: '' });
    if (!isMarkdownUri(targetUri)) return null;
    return {
      uri: targetUri,
      target: {
        position: { line: line - 1, character: character - 1 },
        reveal: 'center',
        highlight: true,
        origin: 'uri-handler',
      },
    };
  } catch {
    return null;
  }
}

export function canonicalDocumentKey(uri: vscode.Uri): string {
  return uri.with({ fragment: '' }).toString(true);
}

export function isMarkdownUri(uri: vscode.Uri): boolean {
  return /\.(?:md|markdown)$/i.test(uri.path);
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function resolveLinkUri(parsed: vscode.Uri, baseUri: vscode.Uri): vscode.Uri {
  if (parsed.scheme) return parsed;
  const resolvedPath = parsed.path.startsWith('/')
    ? path.posix.normalize(parsed.path)
    : path.posix.resolve(path.posix.dirname(baseUri.path), parsed.path);
  return baseUri.with({ path: resolvedPath, query: parsed.query, fragment: parsed.fragment });
}
