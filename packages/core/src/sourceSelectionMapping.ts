import type { SourcePosition } from './sourcePositionMapping';

export interface SourceRange { start: SourcePosition; end: SourcePosition }
export interface SelectionEndpoint { text: string; offset: number }
export type SourceSelection = { selectionStatus: 'exact'; selection: SourceRange } | { selectionStatus: 'unavailable' };
interface Projection { text: string; columns: number[] }

/** An intentionally conservative inverse projection. No nearest-match fallback. */
export function mapSourceSelection(source: string, start: SelectionEndpoint, end: SelectionEndpoint, renderedBlocks?: readonly string[]): SourceSelection {
  const lines = source.split(/\r\n|\n|\r/);
  const projections: Array<{ line: number; projection: Projection }> = [];
  let fence: string | undefined;
  let unsupported = false;
  lines.forEach((line, index) => {
    const marker = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker && !fence) {
      if (marker[1] || (marker[2][0] === '`' && marker[3].includes('`'))) unsupported = true;
      fence = marker[2];
      return;
    }
    if (marker && fence && marker[2][0] === fence[0] && marker[2].length >= fence.length && !marker[3].trim()) {
      fence = undefined;
      return;
    }
    const projection = fence
      ? { text: line, columns: Array.from({ length: line.length }, (_, column) => column) }
      : projectLine(line);
    if (projection) projections.push({ line: index, projection });
    else if (line.trim()) unsupported = true;
  });
  if (unsupported) return { selectionStatus: 'unavailable' };
  // Production callers verify the whole rendered projection in document order.
  // This catches renderer normalization and block-context rules beyond our subset.
  if (renderedBlocks && (renderedBlocks.length !== projections.length
    || renderedBlocks.some((text, index) => text !== projections[index].projection.text))) {
    return { selectionStatus: 'unavailable' };
  }
  function locate(endpoint: SelectionEndpoint, side: 'start' | 'end'): SourcePosition | undefined {
    if (!endpoint.text || !Number.isSafeInteger(endpoint.offset) || endpoint.offset < 0 || endpoint.offset > endpoint.text.length) return;
    const matches = projections.filter(({ projection }) => projection.text === endpoint.text);
    if (matches.length !== 1) return;
    const { line, projection } = matches[0];
    const offset = endpoint.offset;
    // A caret between hidden delimiters has two possible source positions.
    if (start.text === end.text && start.offset === end.offset && offset > 0 && offset < projection.columns.length
      && projection.columns[offset] !== projection.columns[offset - 1] + 1) return;
    const character = side === 'end' && offset > 0 ? projection.columns[offset - 1] + 1
      : offset === projection.columns.length ? projection.columns[offset - 1] + 1 : projection.columns[offset];
    return character === undefined ? undefined : { line, character };
  }
  const a = locate(start, 'start');
  const b = locate(end, 'end');
  if (!a || !b || a.line > b.line || (a.line === b.line && a.character > b.character)) return { selectionStatus: 'unavailable' };
  return { selectionStatus: 'exact', selection: { start: a, end: b } };
}

function projectLine(line: string): Projection | undefined {
  // Tables, HTML, images, escapes/entities and custom syntax need a richer renderer projection.
  if (/[<>|\\&!\t]/.test(line) || /^ {4}/.test(line)) return;
  const quote = /^(?: {0,3}> ?)+/.exec(line)?.[0].length ?? 0;
  const list = /^(?: {0,3})(?:[-+*]|\d{1,9}[.)]) (?:\[[ xX]\] +)?/.exec(line.slice(quote))?.[0].length ?? 0;
  const heading = /^ {0,3}#{1,6} /.exec(line.slice(quote + list))?.[0].length ?? 0;
  const prefix = quote + list + heading;
  const text = line.slice(prefix);
  if (text.trim() !== text || /[#$]/.test(text)) return;
  const result: Projection = { text: '', columns: [] };
  function append(value: string, column: number) {
    result.text += value;
    for (let index = 0; index < value.length; index++) result.columns.push(column + index);
  }
  function inline(value: string, base: number): boolean {
    for (let i = 0; i < value.length;) {
      const rest = value.slice(i);
      const link = /^\[([^\[\]\n]+)\]\([^()\n]+\)/.exec(rest);
      if (link) { if (!inline(link[1], base + i + 1)) return false; i += link[0].length; continue; }
      const code = /^(`+)([^`]+)\1/.exec(rest);
      if (code) { if (code[2].trim() !== code[2]) return false; append(code[2], base + i + code[1].length); i += code[0].length; continue; }
      const emphasis = /^(\*\*|__|~~|\*|_)([^*_~\n]+)\1/.exec(rest);
      if (emphasis) {
        const before = i === 0 || /\s/.test(value[i - 1]);
        const afterIndex = i + emphasis[0].length;
        const after = afterIndex === value.length || /\s/.test(value[afterIndex]);
        if (!before || !after || emphasis[2].trim() !== emphasis[2]) return false;
        if (!inline(emphasis[2], base + i + emphasis[1].length)) return false;
        i = afterIndex;
        continue;
      }
      if (/[\[\]`*_~]/.test(value[i])) return false;
      append(value[i], base + i); i++;
    }
    return true;
  }
  return inline(text, prefix) && result.text.length ? result : undefined;
}

export function isSourceRange(value: unknown): value is SourceRange {
  if (!value || typeof value !== 'object') return false;
  const { start, end } = value as SourceRange;
  const valid = (position: SourcePosition) => position && Number.isSafeInteger(position.line) && position.line >= 0
    && Number.isSafeInteger(position.character) && position.character >= 0;
  return Boolean(valid(start) && valid(end) && (start.line < end.line || (start.line === end.line && start.character <= end.character)));
}
