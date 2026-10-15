import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, test, vi } from 'vitest';

// Synchronization ownership rules for webview code that can only run inside a
// fully booted Vditor (covered end to end by vditor-synchronization.browser).
// These are syntax-tree rules about who may create revisions, not text matches.

// Whole-tree syntax scans are slow under coverage instrumentation.
vi.setConfig({ testTimeout: 30_000 });

const mediaSource = path.resolve(__dirname, '..', 'packages', 'media', 'src');

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(ts|js)$/.test(entry.name) ? [entryPath] : [];
  });
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

function visitAll(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => visitAll(child, visit));
}

function calledName(node: ts.CallExpression): string | undefined {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

function callsIn(node: ts.Node): string[] {
  const names: string[] = [];
  visitAll(node, (child) => {
    if (ts.isCallExpression(child)) {
      const name = calledName(child);
      if (name) names.push(name);
    }
  });
  return names;
}

function relative(file: string): string {
  return path.relative(mediaSource, file);
}

describe('webview synchronization ownership', () => {
  test('only the content synchronizer creates edit revisions', () => {
    const producers: string[] = [];
    for (const file of sourceFiles(mediaSource)) {
      visitAll(parse(file), (node) => {
        if (
          ts.isPropertyAssignment(node) &&
          node.name.getText() === 'command' &&
          ts.isStringLiteralLike(node.initializer) &&
          node.initializer.text === 'edit'
        ) {
          producers.push(relative(file));
        }
      });
    }

    expect(producers).toEqual(['content-sync.ts']);
  });

  test('no module promotes a live DOM serialization to the canonical revision', () => {
    const promotions: string[] = [];
    for (const file of sourceFiles(mediaSource)) {
      visitAll(parse(file), (node) => {
        if (
          ts.isCallExpression(node) &&
          calledName(node) === 'acceptProgrammaticUpdate' &&
          node.arguments.some((argument) => callsIn(argument).includes('getValue'))
        ) {
          promotions.push(`${relative(file)}: ${node.getText()}`);
        }
      });
    }

    expect(promotions).toEqual([]);
  });

  test('the Vditor input callback synchronizes the callback markdown without reserializing', () => {
    const source = parse(path.join(mediaSource, 'init-vditor.ts'));
    const inputCallbacks: ts.MethodDeclaration[] = [];
    visitAll(source, (node) => {
      if (ts.isMethodDeclaration(node) && node.name.getText() === 'input') inputCallbacks.push(node);
    });

    expect(inputCallbacks).toHaveLength(1);
    const calls = callsIn(inputCallbacks[0]);
    expect(calls).toContain('synchronizeVditorInput');
    expect(calls).not.toContain('getValue');
    expect(calls).not.toContain('setValue');
  });

  test('find and replace re-enters the input callback instead of reading the DOM', () => {
    const source = parse(path.join(mediaSource, 'find-replace.ts'));
    const updaters: ts.MethodDeclaration[] = [];
    visitAll(source, (node) => {
      if (ts.isMethodDeclaration(node) && node.name.getText() === 'updateVditorContent') updaters.push(node);
    });

    expect(updaters).toHaveLength(1);
    const calls = callsIn(updaters[0]);
    expect(calls).toContain('dispatchEvent');
    expect(calls).not.toContain('getValue');
    expect(calls).not.toContain('acceptProgrammaticUpdate');
  });
});
