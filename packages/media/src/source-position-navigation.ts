import {
  mapSourcePosition,
  type RenderedPositionMatch,
  type SourceNavigationTarget,
} from '@markdown-editor/core';
import { resolveTextOffset } from './cursor-bookmark';
import { getRenderedLineElements, type DomLikeElement } from './diff-line-dom-mapper';
import { findLineNumberRoot } from './line-number-renderer';

export type SourcePositionRevealResult =
  | { status: 'revealed'; match: RenderedPositionMatch }
  | { status: 'not-found' | 'superseded'; match: null };

export interface SourcePositionNavigationDependencies {
  scope?: Document;
  getMarkdown: () => string;
  requestFrame?: () => Promise<void>;
  matchMedia?: (query: string) => MediaQueryList;
  maxReadyFrames?: number;
}

export class SourcePositionNavigationController {
  private readonly scope: Document;
  private readonly requestFrame: () => Promise<void>;
  private readonly matchMedia: (query: string) => MediaQueryList;
  private readonly maxReadyFrames: number;
  private activeAnimation: Animation | null = null;
  private revealGeneration = 0;

  constructor(private readonly dependencies: SourcePositionNavigationDependencies) {
    this.scope = dependencies.scope ?? document;
    this.requestFrame = dependencies.requestFrame ?? waitForAnimationFrame;
    this.matchMedia = dependencies.matchMedia ?? (query => window.matchMedia(query));
    this.maxReadyFrames = dependencies.maxReadyFrames ?? 8;
  }

  public async reveal(target: SourceNavigationTarget): Promise<SourcePositionRevealResult> {
    const generation = ++this.revealGeneration;
    const ready = await this.findReadyEditor();
    if (generation !== this.revealGeneration) return { status: 'superseded', match: null };
    if (!ready) return { status: 'not-found', match: null };

    const { root, renderedLines } = ready;
    const match = mapSourcePosition(
      this.dependencies.getMarkdown(),
      renderedLines.map(element => element.textContent ?? ''),
      target.position,
    );
    if (!match) return { status: 'not-found', match: null };

    const line = renderedLines[match.renderedLine];
    if (!line) return { status: 'not-found', match: null };

    root.focus({ preventScroll: true });
    this.placeCollapsedCaret(line, match.renderedCharacter);

    const reducedMotion = this.matchMedia('(prefers-reduced-motion: reduce)').matches;
    line.scrollIntoView({ block: target.reveal, behavior: reducedMotion ? 'auto' : 'smooth' });

    this.activeAnimation?.cancel();
    this.activeAnimation = null;
    if (target.highlight && !reducedMotion && typeof line.animate === 'function') {
      this.activeAnimation = line.animate(
        [
          { backgroundColor: 'var(--vscode-editor-findMatchHighlightBackground, rgba(234, 92, 0, 0.25))' },
          { backgroundColor: 'transparent' },
        ],
        { duration: 900, easing: 'ease-out' },
      );
    }

    return { status: 'revealed', match };
  }

  private async findReadyEditor(): Promise<{ root: HTMLElement; renderedLines: HTMLElement[] } | null> {
    for (let frame = 0; frame <= this.maxReadyFrames; frame += 1) {
      const root = findLineNumberRoot(this.scope) as HTMLElement | null;
      const renderedLines = root
        ? getRenderedLineElements(root as unknown as DomLikeElement) as HTMLElement[]
        : [];
      if (root && renderedLines.length > 0) {
        (window as any).__vditorLineNumbers?.refresh?.();
        return { root, renderedLines };
      }
      if (frame < this.maxReadyFrames) await this.requestFrame();
    }
    return null;
  }

  private placeCollapsedCaret(line: HTMLElement, requestedOffset: number): void {
    const selection = this.scope.getSelection();
    if (!selection) return;
    const caret = resolveTextOffset(line, requestedOffset);
    const range = this.scope.createRange();
    range.setStart(caret.node, caret.offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise(resolve => window.requestAnimationFrame(() => resolve()));
}
