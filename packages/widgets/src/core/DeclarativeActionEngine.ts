import {
  isSafePropertyPath,
  type DeclarativeValue,
  type PropertyPath,
  type ValueExpression,
  type WidgetAction,
} from './types';

const DEFAULT_MAX_DEPTH = 32;
const DEFAULT_MAX_COLLECTION_SIZE = 100;

export interface DeclarativeActionEngineOptions {
  maxDepth?: number;
  maxCollectionSize?: number;
  capabilities?: Partial<DeclarativeActionCapabilities>;
}

export interface DeclarativeActionCapabilities {
  setData: (path: PropertyPath, value: unknown, context: unknown) => void;
  emit: (event: string, payload: unknown, context: unknown) => void;
  openUrl: (url: string, context: unknown) => void;
}

export type DeclarativeActionErrorCode =
  | 'invalid-expression'
  | 'invalid-action'
  | 'unsafe-property-path'
  | 'depth-limit'
  | 'collection-size-limit'
  | 'invalid-literal'
  | 'invalid-operands'
  | 'division-by-zero'
  | 'missing-capability'
  | 'invalid-url';

export class DeclarativeActionError extends Error {
  readonly code: DeclarativeActionErrorCode;

  constructor(code: DeclarativeActionErrorCode, message: string) {
    super(message);
    this.name = 'DeclarativeActionError';
    this.code = code;
  }
}

/**
 * Evaluates the closed widget expression/action model without compiling or
 * interpreting workspace-provided source code.
 */
export class DeclarativeActionEngine {
  private readonly maxDepth: number;
  private readonly maxCollectionSize: number;
  private readonly capabilities: Partial<DeclarativeActionCapabilities>;

  constructor(options: DeclarativeActionEngineOptions = {}) {
    this.maxDepth = this.requirePositiveLimit(options.maxDepth ?? DEFAULT_MAX_DEPTH, 'maxDepth');
    this.maxCollectionSize = this.requirePositiveLimit(
      options.maxCollectionSize ?? DEFAULT_MAX_COLLECTION_SIZE,
      'maxCollectionSize',
    );
    this.capabilities = options.capabilities ?? {};
  }

  evaluate(expression: ValueExpression, context: unknown = {}): unknown {
    return this.evaluateExpression(expression, context, 0);
  }

  execute(action: WidgetAction, context: unknown = {}): void {
    if (!this.isRecord(action) || typeof action.kind !== 'string') {
      throw new DeclarativeActionError(
        'invalid-action',
        'Legacy or unsupported widget actions are rejected; use a declarative action kind.',
      );
    }

    switch (action.kind) {
      case 'set-data': {
        this.assertSafePath(action.path, 'Action data path');
        const setData = this.capabilities.setData;
        if (!setData) {
          throw new DeclarativeActionError('missing-capability', 'The set-data capability is not available.');
        }
        setData(action.path, this.evaluate(action.value, context), context);
        return;
      }
      case 'emit': {
        const emit = this.capabilities.emit;
        if (!emit) {
          throw new DeclarativeActionError('missing-capability', 'The emit capability is not available.');
        }
        const event = this.requireEventName(action.event);
        emit(event, action.payload === undefined ? undefined : this.evaluate(action.payload, context), context);
        return;
      }
      case 'open-url': {
        const openUrl = this.capabilities.openUrl;
        if (!openUrl) {
          throw new DeclarativeActionError('missing-capability', 'The open-url capability is not available.');
        }
        const url = this.evaluate(action.url, context);
        if (typeof url !== 'string' || !this.isAllowedUrl(url)) {
          throw new DeclarativeActionError('invalid-url', 'The open-url action requires an http, https, or mailto URL.');
        }
        openUrl(url, context);
        return;
      }
      default:
        throw new DeclarativeActionError(
          'invalid-action',
          'Unsupported widget action kind; legacy executable actions are rejected.',
        );
    }
  }

  private evaluateExpression(expression: ValueExpression, context: unknown, depth: number): unknown {
    this.assertDepth(depth);
    if (!this.isRecord(expression) || typeof expression.kind !== 'string') {
      throw new DeclarativeActionError(
        'invalid-expression',
        'Legacy or unsupported widget expressions are rejected; use a declarative expression tree.',
      );
    }

    switch (expression.kind) {
      case 'literal':
        this.assertLiteral(expression.value, depth + 1, new WeakSet<object>());
        return expression.value;
      case 'get':
        this.assertSafePath(expression.path, 'Expression property path');
        return this.readPath(context, expression.path);
      case 'coalesce': {
        this.assertCollection(expression.values, 'Coalesce values');
        for (const value of expression.values) {
          const result = this.evaluateExpression(value, context, depth + 1);
          if (result !== null && result !== undefined) {
            return result;
          }
        }
        return undefined;
      }
      case 'concat': {
        this.assertCollection(expression.values, 'Concat values');
        const values = expression.values.map((value) => this.evaluateExpression(value, context, depth + 1));
        if (!values.every((value) => this.isConcatValue(value))) {
          throw new DeclarativeActionError('invalid-operands', 'Concat values must be strings or primitive values.');
        }
        return values.map((value) => String(value)).join('');
      }
      case 'arithmetic': {
        const left = this.evaluateExpression(expression.left, context, depth + 1);
        const right = this.evaluateExpression(expression.right, context, depth + 1);
        if (typeof left !== 'number' || typeof right !== 'number' || !Number.isFinite(left) || !Number.isFinite(right)) {
          throw new DeclarativeActionError('invalid-operands', 'Arithmetic operands must be finite numbers.');
        }
        if (expression.operator === 'divide' && right === 0) {
          throw new DeclarativeActionError('division-by-zero', 'Division by zero is not allowed.');
        }
        const result = {
          add: left + right,
          subtract: left - right,
          multiply: left * right,
          divide: left / right,
        }[expression.operator];
        if (!Number.isFinite(result)) {
          throw new DeclarativeActionError('invalid-operands', 'Arithmetic result must be finite.');
        }
        return result;
      }
      case 'comparison': {
        const left = this.evaluateExpression(expression.left, context, depth + 1);
        const right = this.evaluateExpression(expression.right, context, depth + 1);
        return this.compare(expression.operator, left, right);
      }
      default:
        throw new DeclarativeActionError(
          'invalid-expression',
          'Unsupported widget expression kind; legacy executable expressions are rejected.',
        );
    }
  }

  private compare(operator: string, left: unknown, right: unknown): boolean {
    if (operator === 'equals') {
      return Object.is(left, right);
    }
    if (operator === 'not-equals') {
      return !Object.is(left, right);
    }
    if ((typeof left !== 'number' && typeof left !== 'string') || typeof left !== typeof right) {
      throw new DeclarativeActionError('invalid-operands', 'Ordered comparisons require matching strings or numbers.');
    }

    switch (operator) {
      case 'less-than': return left < (right as typeof left);
      case 'less-than-or-equal': return left <= (right as typeof left);
      case 'greater-than': return left > (right as typeof left);
      case 'greater-than-or-equal': return left >= (right as typeof left);
      default:
        throw new DeclarativeActionError('invalid-expression', `Unsupported comparison operator: ${operator}`);
    }
  }

  private readPath(context: unknown, path: PropertyPath): unknown {
    let current: unknown = context;
    for (const key of path) {
      this.assertSafePath([key], 'Expression property path');
      if (!this.isRecord(current) && !Array.isArray(current)) {
        return undefined;
      }
      if (!Object.prototype.hasOwnProperty.call(current, key)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  }

  private assertSafePath(path: unknown, label: string): asserts path is PropertyPath {
    if (!isSafePropertyPath(path)) {
      throw new DeclarativeActionError('unsafe-property-path', `${label} contains an unsafe or invalid key.`);
    }
    this.assertCollection(path, label);
  }

  private assertLiteral(value: unknown, depth: number, seen: WeakSet<object>): asserts value is DeclarativeValue {
    this.assertDepth(depth);
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      return;
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value)) return;
      throw new DeclarativeActionError('invalid-literal', 'Literal numbers must be finite.');
    }
    if (typeof value !== 'object') {
      throw new DeclarativeActionError('invalid-literal', 'Literal values must be JSON-shaped data.');
    }
    if (seen.has(value)) {
      throw new DeclarativeActionError('invalid-literal', 'Cyclic literal values are not allowed.');
    }
    seen.add(value);
    if (Array.isArray(value)) {
      this.assertCollection(value, 'Literal array');
      value.forEach((item) => this.assertLiteral(item, depth + 1, seen));
    } else {
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        throw new DeclarativeActionError('invalid-literal', 'Literal objects must be plain data objects.');
      }
      const keys = Object.keys(value);
      this.assertCollection(keys, 'Literal object');
      for (const key of keys) {
        if (!isSafePropertyPath([key])) {
          throw new DeclarativeActionError('unsafe-property-path', 'Literal object contains an unsafe key.');
        }
        this.assertLiteral((value as Record<string, unknown>)[key], depth + 1, seen);
      }
    }
    seen.delete(value);
  }

  private assertCollection(value: unknown, label: string): asserts value is readonly unknown[] {
    if (!Array.isArray(value)) {
      throw new DeclarativeActionError('invalid-expression', `${label} must be an array.`);
    }
    if (value.length > this.maxCollectionSize) {
      throw new DeclarativeActionError('collection-size-limit', `${label} exceeds the collection size limit.`);
    }
  }

  private assertDepth(depth: number): void {
    if (depth > this.maxDepth) {
      throw new DeclarativeActionError('depth-limit', 'Declarative expression depth limit exceeded.');
    }
  }

  private requirePositiveLimit(value: number, name: string): number {
    if (!Number.isInteger(value) || value < 1 || value > 1000) {
      throw new DeclarativeActionError('invalid-expression', `${name} must be an integer between 1 and 1000.`);
    }
    return value;
  }

  private requireEventName(event: unknown): string {
    if (typeof event !== 'string' || event.length === 0 || event.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(event)) {
      throw new DeclarativeActionError('invalid-action', 'Event names must be non-empty safe identifiers.');
    }
    return event;
  }

  private isAllowedUrl(url: string): boolean {
    try {
      const protocol = new URL(url).protocol;
      return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:';
    } catch {
      return false;
    }
  }

  private isConcatValue(value: unknown): value is string | number | boolean {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  }

  private isRecord(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null;
  }
}
