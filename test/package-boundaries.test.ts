import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(testDirectory, '..');
const packagesDirectory = path.join(rootDirectory, 'packages');

const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cts', '.cjs'];

interface BoundaryViolation {
  sourcePath: string;
  targetPath: string;
}

function readWorkspacePackageNames(): Set<string> {
  const packageNames = new Set<string>();

  for (const entry of fs.readdirSync(packagesDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageJsonPath = path.join(packagesDirectory, entry.name, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      name?: unknown;
    };
    if (typeof packageJson.name === 'string') {
      packageNames.add(packageJson.name);
    }
  }

  return packageNames;
}

function isWorkspacePackageImport(specifier: string, packageNames: Set<string>): boolean {
  for (const packageName of packageNames) {
    if (specifier === packageName || specifier.startsWith(`${packageName}/`)) {
      return true;
    }
  }

  return false;
}

function listSourceFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(entryPath));
      continue;
    }

    if (sourceExtensions.includes(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function listPackageSourceFiles(): string[] {
  const sourceFiles: string[] = [];

  for (const entry of fs.readdirSync(packagesDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const sourceDirectory = path.join(packagesDirectory, entry.name, 'src');
    if (fs.existsSync(sourceDirectory)) {
      sourceFiles.push(...listSourceFiles(sourceDirectory));
    }
  }

  return sourceFiles.sort();
}

function moduleSpecifiers(sourcePath: string): string[] {
  const sourceText = fs.readFileSync(sourcePath, 'utf8');
  const extension = path.extname(sourcePath);
  const scriptKind = extension === '.tsx'
    ? ts.ScriptKind.TSX
    : extension === '.jsx'
      ? ts.ScriptKind.JSX
      : ['.js', '.mjs', '.cjs'].includes(extension)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const specifiers: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }

    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function existingFile(filePath: string): string | undefined {
  try {
    if (fs.statSync(filePath).isFile()) {
      return filePath;
    }
  } catch {
    // A candidate that does not exist is expected while trying extensions.
  }

  return undefined;
}

function resolveRelativeImport(sourcePath: string, specifier: string): string | undefined {
  const unresolvedPath = path.resolve(path.dirname(sourcePath), specifier);
  const unresolvedExtension = path.extname(unresolvedPath);
  const extensionlessPath = unresolvedExtension
    ? unresolvedPath.slice(0, -unresolvedExtension.length)
    : unresolvedPath;
  const candidates = [
    unresolvedPath,
    ...sourceExtensions.map((extension) => `${unresolvedPath}${extension}`),
    ...sourceExtensions.map((extension) => `${extensionlessPath}${extension}`),
    ...sourceExtensions.map((extension) => path.join(unresolvedPath, `index${extension}`)),
  ];

  for (const candidate of candidates) {
    const resolvedPath = existingFile(candidate);
    if (resolvedPath) {
      return path.normalize(resolvedPath);
    }
  }

  return undefined;
}

function findRootSourceBoundaryViolations(): BoundaryViolation[] {
  const packageNames = readWorkspacePackageNames();
  const rootSourceDirectory = path.join(rootDirectory, 'src');
  const violations: BoundaryViolation[] = [];

  for (const sourcePath of listPackageSourceFiles()) {
    for (const specifier of moduleSpecifiers(sourcePath)) {
      if (isWorkspacePackageImport(specifier, packageNames)) {
        // Declared workspace package imports are the supported package-to-
        // package boundary and must not be treated as filesystem paths.
        continue;
      }

      if (!specifier.startsWith('.')) {
        // Other bare imports are external dependencies and also cannot resolve
        // into this repository's root src directory.
        continue;
      }

      const targetPath = resolveRelativeImport(sourcePath, specifier);
      if (!targetPath) {
        continue;
      }

      const relativeTargetPath = path.relative(rootSourceDirectory, targetPath);
      if (
        relativeTargetPath === '' ||
        (!relativeTargetPath.startsWith('..') && !path.isAbsolute(relativeTargetPath))
      ) {
        violations.push({ sourcePath, targetPath });
      }
    }
  }

  return violations;
}

function displayPath(filePath: string): string {
  return path.relative(rootDirectory, filePath) || '.';
}

describe('package source boundaries', () => {
  test('does not import root application source through relative paths', () => {
    const violations = findRootSourceBoundaryViolations();
    const details = violations
      .map(({ sourcePath, targetPath }) => `${displayPath(sourcePath)} -> ${displayPath(targetPath)}`)
      .join('\n');

    expect(
      violations,
      [
        'Package source imports must not resolve into root src/.',
        details || '(no violations found)',
      ].join('\n'),
    ).toEqual([]);
  });
});
