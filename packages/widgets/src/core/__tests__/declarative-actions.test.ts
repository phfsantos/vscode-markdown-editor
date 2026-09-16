import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DeclarativeActionEngine } from '../DeclarativeActionEngine';
import { DataProvider } from '../DataProvider';
import { WidgetBus } from '../WidgetBus';
import type { ValueExpression, WidgetAction } from '../types';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const widgetsSourceRoot = resolve(repositoryRoot, 'packages/widgets/src');

interface DeclarativeActionEngineOptions {
  maxDepth?: number;
  maxCollectionSize?: number;
}

interface DeclarativeActionEngineApi {
  evaluate(expression: ValueExpression, context?: unknown): unknown;
  execute(action: WidgetAction, context?: unknown): unknown;
}

async function createEngine(
  options?: DeclarativeActionEngineOptions,
): Promise<DeclarativeActionEngineApi> {
  const module = await import('../DeclarativeActionEngine');
  const Engine = module.DeclarativeActionEngine as new (
    options?: DeclarativeActionEngineOptions,
  ) => DeclarativeActionEngineApi;

  return new Engine(options);
}

function collectProductionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__' || entry.name === 'test') {
      return [];
    }

    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectProductionSources(entryPath);
    }

    return /\.(?:ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

describe('DeclarativeActionEngine security boundary', () => {
  it('rejects a legacy JavaScript script string without executing it', async () => {
    const engine = await createEngine();
    const probe = { executed: false };

    expect(() =>
      engine.execute(
        'probe.executed = true' as unknown as WidgetAction,
        { probe },
      ),
    ).toThrow(/declarative|legacy|unsupported|invalid/i);
    expect(probe.executed).toBe(false);
  });

  it('rejects a legacy JavaScript action configuration without executing it', async () => {
    const engine = await createEngine();
    const probe = { executed: false };
    const legacyAction = {
      id: 'legacy-action',
      label: 'Legacy action',
      action: 'probe.executed = true',
    };

    expect(() =>
      engine.execute(legacyAction as unknown as WidgetAction, { probe }),
    ).toThrow(/declarative|legacy|unsupported|invalid/i);
    expect(probe.executed).toBe(false);
  });

  it('rejects a legacy JavaScript transform string without executing it', async () => {
    const engine = await createEngine();
    const probe = { executed: false };

    expect(() =>
      engine.evaluate(
        'probe.executed = true' as unknown as ValueExpression,
        { probe },
      ),
    ).toThrow(/declarative|legacy|unsupported|invalid/i);
    expect(probe.executed).toBe(false);
  });

  it.each(['__proto__', 'constructor', 'prototype'])
    ('rejects unsafe property path key %s', async (unsafeKey) => {
      const engine = await createEngine();
      const expression = {
        kind: 'get',
        path: [unsafeKey],
      } as unknown as ValueExpression;

      expect(() => engine.evaluate(expression, {})).toThrow(
        /property|path|prototype|unsafe|forbidden/i,
      );
    });

  it('rejects an expression that exceeds the configured depth limit', async () => {
    const engine = await createEngine({ maxDepth: 8 });
    let expression: ValueExpression = { kind: 'literal', value: 'leaf' } as ValueExpression;

    for (let index = 0; index < 16; index += 1) {
      expression = {
        kind: 'coalesce',
        values: [expression],
      } as unknown as ValueExpression;
    }

    expect(() => engine.evaluate(expression, {})).toThrow(/depth|limit/i);
  });

  it('rejects an expression that exceeds the configured collection-size limit', async () => {
    const engine = await createEngine({ maxCollectionSize: 4 });
    const expression = {
      kind: 'concat',
      values: Array.from({ length: 8 }, (_, index) => ({
        kind: 'literal',
        value: String(index),
      })),
    } as unknown as ValueExpression;

    expect(() => engine.evaluate(expression, {})).toThrow(/collection|size|limit/i);
  });
});

describe('widget security source regressions', () => {
  it('contains no dynamic evaluation in widget production sources', () => {
    const dynamicEvaluationPattern = /\b(?:eval|Function)\s*\(/;
    const violations = collectProductionSources(widgetsSourceRoot)
      .filter((sourcePath) => dynamicEvaluationPattern.test(readFileSync(sourcePath, 'utf8')))
      .map((sourcePath) => sourcePath.replace(`${repositoryRoot}/`, ''));

    expect(violations).toEqual([]);
  });

  it('does not allow unsafe-eval in the editor webview CSP', () => {
    const webviewHtml = readFileSync(resolve(repositoryRoot, 'src/app/webviewHtml.ts'), 'utf8');

    expect(webviewHtml).not.toContain('unsafe-eval');
  });
});

describe('declarative caller integrations', () => {
  it('routes actions only through injected capabilities', () => {
    const calls: string[] = [];
    const actionEngine = new DeclarativeActionEngine({
      capabilities: {
        setData: (path: readonly string[], value: unknown) => calls.push(`set:${path.join('.')}:${String(value)}`),
        emit: (event: string, payload: unknown) => calls.push(`emit:${event}:${String(payload)}`),
        openUrl: (url: string) => calls.push(`url:${url}`),
      },
    });

    actionEngine.execute({
      id: 'set',
      label: 'Set',
      kind: 'set-data',
      path: ['status'],
      value: { kind: 'literal', value: 'ready' },
    });
    actionEngine.execute({
      id: 'emit',
      label: 'Emit',
      kind: 'emit',
      event: 'ready',
      payload: { kind: 'literal', value: true },
    });
    actionEngine.execute({
      id: 'url',
      label: 'Open',
      kind: 'open-url',
      url: { kind: 'literal', value: 'https://example.com' },
    });

    expect(calls).toEqual(['set:status:ready', 'emit:ready:true', 'url:https://example.com']);
  });

  it('applies a declarative static data transform', async () => {
    const provider = DataProvider.getInstance();
    provider.clearCache();

    const result = await provider.fetchData({
      type: 'static',
      config: {
        data: { results: ['one', 'two'] },
        transform: { kind: 'get', path: ['results'] },
      },
    });

    expect(result).toEqual(['one', 'two']);
  });

  it('rejects a legacy data transform before it can execute', async () => {
    const provider = DataProvider.getInstance();
    provider.clearCache();
    const probe = { executed: false };

    await expect(provider.fetchData({
      type: 'static',
      config: {
        data: probe,
        transform: 'probe.executed = true' as unknown as ValueExpression,
      },
    })).rejects.toThrow(/declarative|legacy|unsupported|invalid/i);
    expect(probe.executed).toBe(false);
  });

  it('applies a declarative widget connection transform', () => {
    const bus = WidgetBus.getInstance();
    bus.clear();
    const updateProperty = vi.fn();
    const target = {
      getConfig: () => ({ id: 'target', type: 'test', size: 'md' as const }),
      updateProperty,
    };

    bus.registerWidget(target as never);
    bus.createConnection({
      id: 'connection',
      sourceWidget: 'source',
      sourceEvent: 'updated',
      targetProperty: 'target',
      transform: { kind: 'get', path: ['value'] },
      enabled: true,
    });

    bus.publish('source', 'updated', { value: 42 });

    expect(updateProperty).toHaveBeenCalledWith('target', 42);
  });

  it('surfaces a legacy connection transform without updating the target', () => {
    const bus = WidgetBus.getInstance();
    bus.clear();
    const updateProperty = vi.fn();
    const showError = vi.fn();
    const target = {
      getConfig: () => ({ id: 'target', type: 'test', size: 'md' as const }),
      updateProperty,
      showError,
    };

    bus.registerWidget(target as never);
    bus.createConnection({
      id: 'legacy-connection',
      sourceWidget: 'source',
      sourceEvent: 'updated',
      targetProperty: 'target',
      transform: 'payload.value' as unknown as ValueExpression,
      enabled: true,
    });

    bus.publish('source', 'updated', { value: 42 });

    expect(updateProperty).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(expect.stringMatching(/declarative|legacy|unsupported|invalid/i));
  });
});

describe('BaseWidget action boundary', () => {
  it('does not retain the executable script entry point', () => {
    const baseWidgetSource = readFileSync(resolve(widgetsSourceRoot, 'core/BaseWidget.ts'), 'utf8');

    expect(baseWidgetSource).not.toContain('ScriptExecutor');
    expect(baseWidgetSource).not.toContain('executeScript');
  });
});
