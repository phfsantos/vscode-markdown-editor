import { normalizeRenderedLineText } from './renderedLineRules';

export interface SourcePosition {
  line: number;
  character: number;
}

export interface SourceNavigationTarget {
  position: SourcePosition;
  reveal: 'center';
  highlight: boolean;
  origin: 'command' | 'markdown-link' | 'uri-handler';
}

export type SourcePositionConfidence = 'exact' | 'context' | 'nearest';
export type SourcePositionReason =
  | 'visible-character'
  | 'hidden-syntax'
  | 'next-visible-line'
  | 'previous-visible-line';

export interface RenderedPositionMatch {
  renderedLine: number;
  renderedCharacter: number;
  confidence: SourcePositionConfidence;
  reason: SourcePositionReason;
  sourcePosition: SourcePosition;
}

interface LineProjection {
  visibleText: string;
  sourceToVisible: number[];
  hiddenCharacters: Set<number>;
  fenceGroup?: number;
  fenceBoundary?: 'open' | 'close';
}

interface VisibleAlignment {
  renderedLine: number;
  renderedStart: number;
  normalizedEnd: number;
  confidence: 'exact' | 'context';
}

export function normalizeSourcePosition(markdown: string, position: SourcePosition): SourcePosition {
  const lines = splitSourceLines(markdown);
  const line = clampInteger(position.line, 0, lines.length - 1);
  const character = clampInteger(position.character, 0, lines[line].length);
  return { line, character };
}

export function mapSourcePosition(
  markdown: string,
  renderedLineTexts: readonly string[],
  requestedPosition: SourcePosition,
): RenderedPositionMatch | null {
  if (renderedLineTexts.length === 0) {
    return null;
  }

  const sourceLines = splitSourceLines(markdown);
  const position = normalizeSourcePosition(markdown, requestedPosition);
  const projections = buildLineProjections(sourceLines);
  const alignments = alignVisibleLines(projections, renderedLineTexts);
  const direct = alignments[position.line];

  if (direct) {
    const projection = projections[position.line];
    const sourceCharacter = position.character;
    const projectedCharacter = projection.sourceToVisible[sourceCharacter] ?? projection.visibleText.length;
    const hidden = sourceCharacter < sourceLines[position.line].length
      && projection.hiddenCharacters.has(sourceCharacter);
    return {
      renderedLine: direct.renderedLine,
      renderedCharacter: clampInteger(
        direct.renderedStart + projectedCharacter,
        0,
        renderedLineTexts[direct.renderedLine].length,
      ),
      confidence: hidden ? 'nearest' : direct.confidence,
      reason: hidden ? 'hidden-syntax' : 'visible-character',
      sourcePosition: position,
    };
  }

  const fenceOwner = findFenceOwner(position.line, projections, alignments);
  if (fenceOwner) {
    const renderedText = renderedLineTexts[fenceOwner.renderedLine];
    return {
      renderedLine: fenceOwner.renderedLine,
      renderedCharacter: projections[position.line].fenceBoundary === 'close' ? renderedText.length : 0,
      confidence: 'nearest',
      reason: 'hidden-syntax',
      sourcePosition: position,
    };
  }

  for (let line = position.line + 1; line < alignments.length; line += 1) {
    const match = alignments[line];
    if (match) {
      return {
        renderedLine: match.renderedLine,
        renderedCharacter: match.renderedStart,
        confidence: 'nearest',
        reason: 'next-visible-line',
        sourcePosition: position,
      };
    }
  }

  for (let line = position.line - 1; line >= 0; line -= 1) {
    const match = alignments[line];
    if (match) {
      return {
        renderedLine: match.renderedLine,
        renderedCharacter: renderedLineTexts[match.renderedLine].length,
        confidence: 'nearest',
        reason: 'previous-visible-line',
        sourcePosition: position,
      };
    }
  }

  return null;
}

function splitSourceLines(markdown: string): string[] {
  return markdown.split(/\r\n|\n|\r/);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  const integer = Number.isFinite(value) ? Math.trunc(value) : minimum;
  return Math.min(maximum, Math.max(minimum, integer));
}

function buildLineProjections(lines: readonly string[]): LineProjection[] {
  const projections: LineProjection[] = [];
  let inFrontmatter = lines[0]?.trim() === '---';
  let fenceGroup: number | undefined;
  let nextFenceGroup = 0;

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (inFrontmatter) {
      projections.push(emptyProjection());
      if (lineIndex > 0 && (trimmed === '---' || trimmed === '...')) {
        inFrontmatter = false;
      }
      return;
    }

    if (/^\s*(```|~~~)/.test(line)) {
      if (fenceGroup === undefined) {
        fenceGroup = nextFenceGroup++;
        projections.push({ ...emptyProjection(), fenceGroup, fenceBoundary: 'open' });
      } else {
        projections.push({ ...emptyProjection(), fenceGroup, fenceBoundary: 'close' });
        fenceGroup = undefined;
      }
      return;
    }

    if (trimmed.length === 0 || isTableDelimiter(trimmed)) {
      projections.push(emptyProjection());
      return;
    }

    const projection = projectVisibleLine(line);
    if (fenceGroup !== undefined) {
      projection.fenceGroup = fenceGroup;
    }
    projections.push(projection);
  });

  return projections;
}

function emptyProjection(): LineProjection {
  return { visibleText: '', sourceToVisible: [0], hiddenCharacters: new Set<number>() };
}

function isTableDelimiter(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(line);
}

function projectVisibleLine(source: string): LineProjection {
  const hidden = new Set<number>();
  const prefix = source.match(/^\s{0,3}(?:#{1,6}\s+|(?:[-+*]|\d+[.)])\s+|(?:>\s*)+)/)?.[0] ?? '';
  for (let index = 0; index < prefix.length; index += 1) hidden.add(index);

  const isTableRow = source.includes('|');
  if (isTableRow) {
    markTableSyntax(source, hidden);
  }

  markInlineSyntax(source, hidden);

  const sourceToVisible = new Array<number>(source.length + 1).fill(0);
  let visible = '';
  let pendingSpace = false;
  for (let index = 0; index < source.length; index += 1) {
    if (hidden.has(index)) {
      sourceToVisible[index] = visible.length;
      continue;
    }

    const character = source[index];
    if (/\s/.test(character)) {
      sourceToVisible[index] = visible.length;
      pendingSpace = visible.length > 0;
      continue;
    }
    if (pendingSpace && visible.length > 0) visible += ' ';
    pendingSpace = false;
    sourceToVisible[index] = visible.length;
    visible += character;
  }
  sourceToVisible[source.length] = visible.length;

  const leadingWhitespace = visible.length - visible.trimStart().length;
  if (leadingWhitespace > 0) {
    visible = visible.trimStart();
    for (let index = 0; index < sourceToVisible.length; index += 1) {
      sourceToVisible[index] = Math.max(0, sourceToVisible[index] - leadingWhitespace);
    }
  }
  visible = visible.trimEnd();
  for (let index = 0; index < sourceToVisible.length; index += 1) {
    sourceToVisible[index] = Math.min(visible.length, sourceToVisible[index]);
  }

  return { visibleText: visible, sourceToVisible, hiddenCharacters: hidden };
}

function markTableSyntax(source: string, hidden: Set<number>): void {
  const boundaries = [-1];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '|') {
      hidden.add(index);
      boundaries.push(index);
    }
  }
  boundaries.push(source.length);

  for (let boundary = 0; boundary < boundaries.length - 1; boundary += 1) {
    const start = boundaries[boundary] + 1;
    const end = boundaries[boundary + 1];
    let contentStart = start;
    let contentEnd = end;
    while (contentStart < contentEnd && /\s/.test(source[contentStart])) hidden.add(contentStart++);
    while (contentEnd > contentStart && /\s/.test(source[contentEnd - 1])) hidden.add(--contentEnd);
  }
}

function markInlineSyntax(source: string, hidden: Set<number>): void {
  for (let index = 0; index < source.length; index += 1) {
    if ('*_~`'.includes(source[index])) hidden.add(index);
  }

  const link = /!?\[([^\]]*)\]\([^)]*\)/g;
  let match: RegExpExecArray | null;
  while ((match = link.exec(source))) {
    const labelStart = match.index + (match[0].startsWith('!') ? 2 : 1);
    const labelEnd = labelStart + match[1].length;
    for (let index = match.index; index < match.index + match[0].length; index += 1) {
      if (index < labelStart || index >= labelEnd) hidden.add(index);
    }
  }
}

function alignVisibleLines(
  projections: readonly LineProjection[],
  renderedLineTexts: readonly string[],
): Array<VisibleAlignment | undefined> {
  const rendered = renderedLineTexts.map(text => ({ raw: text, normalized: normalizeRenderedLineText(text) }));
  const alignments: Array<VisibleAlignment | undefined> = new Array(projections.length);
  let minimumRenderedLine = 0;
  let minimumNormalizedCharacter = 0;
  let minimumRawCharacter = 0;

  projections.forEach((projection, sourceLine) => {
    const needle = normalizeRenderedLineText(projection.visibleText);
    if (!needle) return;

    let best: VisibleAlignment | undefined;
    for (let renderedLine = minimumRenderedLine; renderedLine < rendered.length; renderedLine += 1) {
      const candidate = rendered[renderedLine];
      const sameRenderedLine = renderedLine === minimumRenderedLine;
      const normalizedSearchStart = sameRenderedLine ? minimumNormalizedCharacter : 0;
      const rawSearchStart = sameRenderedLine ? minimumRawCharacter : 0;
      const exact = normalizedSearchStart === 0 && candidate.normalized === needle;
      const normalizedStart = candidate.normalized.indexOf(needle, normalizedSearchStart);
      if (!exact && normalizedStart < 0) continue;

      const rawStart = candidate.raw.indexOf(projection.visibleText, rawSearchStart);
      best = {
        renderedLine,
        renderedStart: rawStart >= 0 ? rawStart : Math.max(0, normalizedStart),
        normalizedEnd: normalizedStart + needle.length,
        confidence: exact ? 'exact' : 'context',
      };
      break;
    }

    if (best) {
      alignments[sourceLine] = best;
      minimumRenderedLine = best.renderedLine;
      minimumNormalizedCharacter = best.normalizedEnd;
      minimumRawCharacter = best.renderedStart + projection.visibleText.length;
    }
  });

  return alignments;
}

function findFenceOwner(
  sourceLine: number,
  projections: readonly LineProjection[],
  alignments: readonly (VisibleAlignment | undefined)[],
): VisibleAlignment | undefined {
  const group = projections[sourceLine].fenceGroup;
  if (group === undefined || !projections[sourceLine].fenceBoundary) return undefined;
  if (projections[sourceLine].fenceBoundary === 'open') {
    for (let line = sourceLine + 1; line < projections.length && projections[line].fenceGroup === group; line += 1) {
      if (alignments[line]) return alignments[line];
    }
  } else {
    for (let line = sourceLine - 1; line >= 0 && projections[line].fenceGroup === group; line -= 1) {
      if (alignments[line]) return alignments[line];
    }
  }
  return undefined;
}
