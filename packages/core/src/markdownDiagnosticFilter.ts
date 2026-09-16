export interface MarkdownPosition {
    line: number;
    character: number;
}

export interface MarkdownRange {
    start: MarkdownPosition;
    end: MarkdownPosition;
}

export interface DiagnosticWithRange {
    range: MarkdownRange;
}

export interface FencedCodeBlockRange {
    startLine: number;
    endLine: number;
}

interface OpenFence {
    character: '`' | '~';
    length: number;
    startLine: number;
}

export function getFencedCodeBlockRanges(markdown: string): FencedCodeBlockRange[] {
    const lines = markdown.split(/\r?\n/);
    const ranges: FencedCodeBlockRange[] = [];
    let openFence: OpenFence | undefined;

    lines.forEach((line, lineIndex) => {
        if (!openFence) {
            const openingMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
            if (!openingMatch) {
                return;
            }

            openFence = {
                character: openingMatch[1][0] as OpenFence['character'],
                length: openingMatch[1].length,
                startLine: lineIndex,
            };
            return;
        }

        const closingMatch = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
        if (
            closingMatch &&
            closingMatch[1][0] === openFence.character &&
            closingMatch[1].length >= openFence.length
        ) {
            ranges.push({ startLine: openFence.startLine, endLine: lineIndex });
            openFence = undefined;
        }
    });

    if (openFence) {
        ranges.push({ startLine: openFence.startLine, endLine: lines.length - 1 });
    }

    return ranges;
}

export function filterDiagnosticsOutsideFencedCodeBlocks<T extends DiagnosticWithRange>(
    diagnostics: readonly T[],
    markdown: string,
): T[] {
    const fencedRanges = getFencedCodeBlockRanges(markdown);
    if (fencedRanges.length === 0) {
        return [...diagnostics];
    }

    return diagnostics.filter((diagnostic) => {
        const { start, end } = diagnostic.range;
        const isZeroLength = start.line === end.line && start.character === end.character;
        const lastTouchedLine = !isZeroLength && end.line > start.line && end.character === 0
            ? end.line - 1
            : end.line;

        return !fencedRanges.some(
            (fence) => start.line <= fence.endLine && lastTouchedLine >= fence.startLine,
        );
    });
}
