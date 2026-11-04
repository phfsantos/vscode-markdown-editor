import { mapSourceSelection, type SelectionEndpoint, type WebviewToHostMessage } from '@markdown-editor/core';

interface SourceSnapshot { panelId: string; documentVersion: number; content: string }
interface Dependencies {
  scope?: Document;
  getMarkdown(): string;
  postMessage(message: Extract<WebviewToHostMessage, { command: 'editor-context' }>): void;
}
const excluded = '[contenteditable="false"], .renderer-container, .widget-container, .vditor-toolbar, .vditor-ir__marker, .vditor-ir__preview, .md-line-number, .diff-spacer, svg, button, input';

/** Publishes source context only; it never changes the DOM selection or focus. */
export class EditorContextController {
  private readonly scope: Document;
  private source?: SourceSnapshot;
  private frame?: number;
  private disposed = false;
  private pendingEdit = false;
  private last = '';
  private readonly observer: MutationObserver;
  private readonly schedule = () => {
    if (this.disposed || this.frame !== undefined) return;
    this.frame = this.scope.defaultView!.requestAnimationFrame(() => {
      this.frame = undefined;
      this.publish();
    });
  };
  private readonly input = (event: Event) => {
    const target = event.target;
    if (target instanceof Element && target.closest('.vditor-reset[contenteditable="true"]') && !target.closest(excluded)) {
      this.pendingEdit = true;
    }
    this.schedule();
  };

  constructor(private readonly dependencies: Dependencies) {
    this.scope = dependencies.scope ?? document;
    this.scope.addEventListener('selectionchange', this.schedule);
    this.scope.addEventListener('focusin', this.schedule);
    this.scope.addEventListener('input', this.input, true);
    this.observer = new MutationObserver(this.schedule);
    this.observer.observe(this.scope.body, { subtree: true, childList: true, characterData: true });
  }

  public setSource(source: SourceSnapshot): void {
    if (this.disposed || (this.source?.panelId === source.panelId && this.source.documentVersion > source.documentVersion)) return;
    this.source = { ...source };
    this.pendingEdit = false;
    this.schedule();
  }

  private publish(): void {
    const source = this.source;
    if (!source || this.disposed) return;
    const canonical = (text: string) => text.replace(/\r\n/g, '\n').replace(/\n$/, '');
    const selection = this.scope.getSelection();
    let result: ReturnType<typeof mapSourceSelection> = { selectionStatus: 'unavailable' };
    const focusOutsideSource = this.scope.activeElement?.closest(excluded);
    if (!focusOutsideSource && !this.pendingEdit && canonical(source.content) === canonical(this.dependencies.getMarkdown()) && selection?.rangeCount === 1) {
      const range = selection.getRangeAt(0);
      const start = this.endpoint(range.startContainer, range.startOffset);
      const end = this.endpoint(range.endContainer, range.endOffset);
      const root = range.startContainer.parentElement?.closest('.vditor-ir .vditor-reset, .vditor-wysiwyg .vditor-reset');
      if (start && end && root && root.contains(range.endContainer)) {
        const blocks = Array.from(root.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, pre'))
          .filter(block => !block.closest(excluded));
        const texts = blocks.map(block => this.blockText(block)?.text);
        if (texts.every((text): text is string => text !== undefined)) {
          result = mapSourceSelection(source.content, start, end, texts);
        }
      }
    }
    const message = { command: 'editor-context' as const, panelId: source.panelId, documentVersion: source.documentVersion, ...result };
    const serialized = JSON.stringify(message);
    if (serialized === this.last) return;
    this.last = serialized;
    this.dependencies.postMessage(message);
  }

  private endpoint(node: Node, offset: number): SelectionEndpoint | undefined {
    // Element boundaries and source-view widgets are conservatively unavailable.
    if (node.nodeType !== Node.TEXT_NODE || node.parentElement?.closest(excluded)) return;
    const root = node.parentElement?.closest('.vditor-ir .vditor-reset, .vditor-wysiwyg .vditor-reset');
    const block = node.parentElement?.closest('p, li, h1, h2, h3, h4, h5, h6, pre');
    if (!root || !block || !root.contains(block)) return;
    const projection = this.blockText(block, node, offset);
    return projection?.offset === undefined ? undefined : { text: projection.text, offset: projection.offset };
  }

  private blockText(block: Element, selectedNode?: Node, selectedNodeOffset = 0): { text: string; offset?: number } | undefined {
    const walker = this.scope.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let text = '';
    let offset: number | undefined;
    while (walker.nextNode()) {
      const current = walker.currentNode;
      if (current.parentElement?.closest(excluded)) continue;
      // Vditor inserts a separator after its checkbox input; it is not source text.
      if (current.previousSibling instanceof HTMLInputElement && current.previousSibling.type === 'checkbox'
        && /^\s*$/.test(current.textContent ?? '')) continue;
      // Nested blocks require their own projection; never concatenate list children.
      if (current.parentElement?.closest('p, li, h1, h2, h3, h4, h5, h6, pre') !== block) return;
      if (current === selectedNode) offset = text.length + selectedNodeOffset;
      text += current.textContent ?? '';
    }
    return { text, offset };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame !== undefined) this.scope.defaultView!.cancelAnimationFrame(this.frame);
    this.scope.removeEventListener('selectionchange', this.schedule);
    this.scope.removeEventListener('focusin', this.schedule);
    this.scope.removeEventListener('input', this.input, true);
    this.observer.disconnect();
  }
}
