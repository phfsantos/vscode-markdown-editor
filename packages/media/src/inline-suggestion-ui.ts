interface InlineSuggestionMessageTarget {
  postMessage(message: any): void;
}

interface InlineSuggestionRequestPayload {
  content: string;
  manual?: boolean;
}

interface InlineSuggestionResponse {
  requestId?: string;
  suggestion?: string;
}

interface InlineSuggestionEligibility {
  enabled: boolean;
}

class InlineSuggestionController {
  private target: InlineSuggestionMessageTarget | null = null;
  private styleElement: HTMLStyleElement | null = null;
  private markerElement: HTMLSpanElement | null = null;
  private enabled = false;
  private suggestionText = "";
  private requestCounter = 0;
  private activeRequestId: string | null = null;
  private pendingTimer: number | undefined;
  private initialized = false;

  public initialize(target: InlineSuggestionMessageTarget): void {
    this.target = target;
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.ensureStyle();
    document.addEventListener("keydown", this.handleKeyDown, true);
    document.addEventListener("selectionchange", this.handleSelectionChange);
  }

  public updateEligibility(state: InlineSuggestionEligibility): void {
    this.enabled = Boolean(state.enabled);
    if (!this.enabled) {
      this.clearSuggestion();
    }
  }

  public handleEditorInput(payload: InlineSuggestionRequestPayload): void {
    if (!this.enabled) {
      return;
    }

    if (this.pendingTimer) {
      window.clearTimeout(this.pendingTimer);
    }

    this.pendingTimer = window.setTimeout(() => {
      const context = this.getCursorContext();
      if (!context || !this.target) {
        this.clearSuggestion();
        return;
      }

      this.activeRequestId = `inline-suggestion-${++this.requestCounter}`;
      this.target.postMessage({
        command: 'requestInlineSuggestion',
        requestId: this.activeRequestId,
        content: payload.content,
        beforeCursor: context.beforeCursor,
        afterCursor: context.afterCursor,
        manual: payload.manual || false,
      });
    }, 350);
  }

  public handleExternalUpdate(): void {
    this.clearSuggestion();
  }

  public handleSuggestionResponse(message: InlineSuggestionResponse): void {
    if (!message.requestId || message.requestId !== this.activeRequestId) {
      return;
    }

    const suggestion = String(message.suggestion || "");
    if (!suggestion) {
      this.clearSuggestion();
      return;
    }

    this.suggestionText = suggestion;
    this.renderSuggestion();
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (!this.suggestionText) {
      return;
    }

    if (event.key === 'Tab' &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.acceptSuggestion();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.clearSuggestion();
      return;
    }

    if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      if (event.key === this.suggestionText[0]) {
        this.suggestionText = this.suggestionText.slice(1);
        window.requestAnimationFrame(() => this.renderSuggestion());
      } else {
        this.clearSuggestion();
      }
      return;
    }

    if (["Backspace", "Delete", "Enter"].includes(event.key)) {
      this.clearSuggestion();
    }
  };

  private handleSelectionChange = () => {
    if (!this.suggestionText) {
      return;
    }

    if (!this.markerElement || !this.markerElement.isConnected) {
      this.renderSuggestion();
      return;
    }

    if (!this.isSelectionAtMarker()) {
      this.clearSuggestion();
    }
  };

  private acceptSuggestion(): void {
    if (!this.suggestionText || !(window as any).vditor) {
      return;
    }

    this.removeMarker();
    (window as any).vditor.insertValue(this.suggestionText);
    (window as any).__vditorLineNumbers?.refresh?.();
    this.clearSuggestion();
  }

  private clearSuggestion(): void {
    this.suggestionText = "";
    this.activeRequestId = null;
    if (this.pendingTimer) {
      window.clearTimeout(this.pendingTimer);
      this.pendingTimer = undefined;
    }
    this.removeMarker();
  }

  private renderSuggestion(): void {
    if (!this.suggestionText) {
      this.clearSuggestion();
      return;
    }

    const range = this.getCaretRange();
    if (!range) {
      this.clearSuggestion();
      return;
    }

    const marker = this.ensureMarker(range);
    if (!marker) {
      this.clearSuggestion();
      return;
    }

    marker.setAttribute("data-inline-suggestion", this.suggestionText);
  }

  private ensureStyle(): void {
    if (this.styleElement) {
      return;
    }

    this.styleElement = document.createElement("style");
    this.styleElement.textContent = `
      .markdown-editor-inline-suggestion-marker {
        display: inline;
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
        white-space: pre;
      }

      .markdown-editor-inline-suggestion-marker::after {
        content: attr(data-inline-suggestion);
        color: var(--vscode-editorGhostText-foreground, rgba(128, 128, 128, 0.85));
        font-family: inherit;
        font-size: inherit;
        line-height: inherit;
      }
    `;
    document.head.appendChild(this.styleElement);
  }

  private ensureMarker(range: Range): HTMLSpanElement | null {
    if (this.markerElement?.isConnected) {
      if (this.isSelectionAtMarker()) {
        return this.markerElement;
      }

      this.removeMarker();
    }

    const marker = document.createElement("span");
    marker.className = "markdown-editor-inline-suggestion-marker";
    marker.setAttribute("data-inline-suggestion-marker", "true");
    marker.setAttribute("data-inline-suggestion", "");
    marker.setAttribute("contenteditable", "false");
    marker.setAttribute("aria-hidden", "true");
    range.insertNode(marker);

    const selection = window.getSelection();
    if (selection) {
      const caretRange = document.createRange();
      caretRange.setStartBefore(marker);
      caretRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(caretRange);
    }

    this.markerElement = marker;
    return marker;
  }

  private removeMarker(): void {
    if (!this.markerElement) {
      return;
    }

    this.markerElement.remove();
    this.markerElement = null;
  }

  private getCaretRange(): Range | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    return range;
  }

  private isSelectionAtMarker(): boolean {
    const selection = window.getSelection();
    const marker = this.markerElement;
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed || !marker || !marker.isConnected) {
      return false;
    }

    const range = selection.getRangeAt(0);
    const markerRange = document.createRange();
    markerRange.setStartBefore(marker);
    markerRange.collapse(true);
    return (
      range.startContainer === markerRange.startContainer &&
      range.startOffset === markerRange.startOffset
    );
  }

  private getCursorContext(): {
    beforeCursor: string;
    afterCursor: string;
  } | null {
    const selection = window.getSelection();
    const root = document.querySelector(
      ".vditor-ir .vditor-reset, .vditor-wysiwyg .vditor-reset, .vditor-sv .vditor-reset",
    );
    if (!selection || selection.rangeCount === 0 || !root) {
      return null;
    }

    let beforeCursor = "";
    let afterCursor = "";

    const range = selection.getRangeAt(0);
    const beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(root);
    beforeRange.setEnd(range.startContainer, range.startOffset);

    beforeCursor += beforeRange.toString();

    const afterRange = range.cloneRange();
    afterRange.selectNodeContents(root);
    // Ensure endContainer is a Text node before accessing wholeText
    if (afterRange.endContainer.nodeType === Node.TEXT_NODE) {
      const textNode = afterRange.endContainer as Text;
      const textContent = textNode.wholeText || "";
      const nodeOffset =
        textContent.indexOf(afterRange.endContainer.textContent || "") +
        afterRange.endOffset;
      afterCursor += textContent.slice(nodeOffset);
    } else {
      const textNode = beforeRange.endContainer as Text;
      const textContent = textNode.wholeText || "";
      const nodeOffset =
        textContent.indexOf(beforeRange.endContainer.textContent || "") +
        beforeRange.endOffset;
      afterCursor += textContent.slice(nodeOffset);
    }

    return {
      beforeCursor,
      afterCursor,
    };
  }
}

export const inlineSuggestionController = new InlineSuggestionController();
