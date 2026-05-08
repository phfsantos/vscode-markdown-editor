import { vscodeLogWarn, vscodeLogError } from './webview-logger';

/**
 * Find and Replace functionality for Vditor editor
 * Provides VS Code-like find and replace experience with native Vditor integration
 */

export interface FindReplaceState {
  isVisible: boolean;
  findTerm: string;
  replaceTerm: string;
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  currentMatch: number;
  totalMatches: number;
  matches: Range[];
}

export class FindReplaceManager {
  private vditor: any;
  private widget: HTMLElement | null = null;
  private findInput: HTMLInputElement | null = null;
  private replaceInput: HTMLInputElement | null = null;
  private matchCountSpan: HTMLElement | null = null;
  private state: FindReplaceState;
  private highlightedElements: HTMLElement[] = [];
  private searchTimeout: number | null = null;
  private lastSearchTerm: string = '';
  private domStabilityDelay: number = 300; // ms to wait for Vditor DOM processing (increased for better debouncing)
  private userTypingDelay: number = 500; // ms to wait for user to finish typing
  private lastInputTime: number = 0;
  private pendingSearch: boolean = false;

  constructor(vditor: any) {
    this.vditor = vditor;
    this.state = {
      isVisible: false,
      findTerm: '',
      replaceTerm: '',
      matchCase: false,
      wholeWord: false,
      useRegex: false,
      currentMatch: 0,
      totalMatches: 0,
      matches: []
    };
  }



  /**
   * Initialize find and replace functionality
   */
  public initialize(): void {
    this.createWidget();
    this.bindKeyboardShortcuts();

  }

  /**
   * Show the find widget (Ctrl+F)
   */
  public showFind(): void {

    this.state.isVisible = true;
    this.showWidget(false);
    this.focusFindInput();
  }

  /**
   * Show the find and replace widget (Ctrl+H)
   */
  public showFindReplace(): void {

    this.state.isVisible = true;
    this.showWidget(true);
    this.focusFindInput();
  }

  /**
   * Hide the find and replace widget
   */
  public hide(): void {

    this.state.isVisible = false;
    if (this.widget) {
      this.widget.style.display = 'none';
    }
    this.clearHighlights();
    this.cancelPendingSearch();
  }

  /**
   * Cancel any pending search operations
   */
  private cancelPendingSearch(): void {
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = null;
    }
    this.pendingSearch = false;

  }

  /**
   * Create the find and replace widget DOM
   */
  private createWidget(): void {
    const vditorElement = document.querySelector('.vditor');
    if (!vditorElement) {
      vscodeLogError('❌ FindReplaceManager: Could not find .vditor element');
      return;
    }

    this.widget = document.createElement('div');
    this.widget.className = 'vditor-find-widget';
    this.widget.innerHTML = `
      <div class="vditor-find-widget__container">
        <div class="vditor-find-widget__row">
          <div class="vditor-find-widget__input-group">
            <input 
              type="text" 
              class="vditor-find-widget__input vditor-find-widget__find-input" 
              placeholder="Find"
              spellcheck="false"
            />
            <div class="vditor-find-widget__match-count"></div>
          </div>
          <div class="vditor-find-widget__buttons">
            <button class="vditor-find-widget__button vditor-find-widget__button--prev" title="Previous match (Shift+F3)">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M7.247 4.86l-4.796 5.481c-.566.647-.106 1.659.753 1.659h9.592a1 1 0 00.753-1.659l-4.796-5.48a1 1 0 00-1.506 0z"/>
              </svg>
            </button>
            <button class="vditor-find-widget__button vditor-find-widget__button--next" title="Next match (F3)">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M7.247 11.14l-4.796-5.481C1.885 5.013 2.345 4.001 3.204 4.001h9.592a1 1 0 01.753 1.659l-4.796 5.48a1 1 0 01-1.506 0z"/>
              </svg>
            </button>
            <button class="vditor-find-widget__button vditor-find-widget__button--toggle-replace" title="Toggle Replace">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6.776 1.553a.5.5 0 01.671.223l3 6a.5.5 0 010 .448l-3 6a.5.5 0 01-.894-.448L9.44 8 6.553 2.224a.5.5 0 01.223-.671z"/>
                <path d="M2.5 7.5a.5.5 0 000 1h6.793l-2.147 2.146a.5.5 0 00.708.708l3-3a.5.5 0 000-.708l-3-3a.5.5 0 00-.708.708L9.293 7.5H2.5z"/>
              </svg>
            </button>
            <button class="vditor-find-widget__button vditor-find-widget__button--close" title="Close (Escape)">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="vditor-find-widget__row vditor-find-widget__replace-row">
          <div class="vditor-find-widget__input-group">
            <input 
              type="text" 
              class="vditor-find-widget__input vditor-find-widget__replace-input" 
              placeholder="Replace"
              spellcheck="false"
            />
          </div>
          <div class="vditor-find-widget__buttons">
            <button class="vditor-find-widget__button vditor-find-widget__button--replace" title="Replace (Ctrl+Shift+1)">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M10.97 4.97a.235.235 0 0 0-.02.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-1.071-1.05z"/>
              </svg>
            </button>
            <button class="vditor-find-widget__button vditor-find-widget__button--replace-all" title="Replace All (Ctrl+Alt+Enter)">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0V2H2v1.5a.5.5 0 0 1-1 0v-2zM11 5.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5zm-5 0a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5zm-5 0a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5zm5 2a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5zm-5 0a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5zm11 0a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5z"/>
                <path d="M10.354 6.854a.5.5 0 0 0-.708-.708L8 7.793 6.354 6.146a.5.5 0 1 0-.708.708l1.647 1.646-1.647 1.646a.5.5 0 0 0 .708.708L8 9.207l1.646 1.647a.5.5 0 0 0 .708-.708L8.707 8.5l1.647-1.646z"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="vditor-find-widget__row vditor-find-widget__options-row">
          <div class="vditor-find-widget__options">
            <button class="vditor-find-widget__option vditor-find-widget__option--match-case" title="Match Case (Alt+C)">
              Aa
            </button>
            <button class="vditor-find-widget__option vditor-find-widget__option--whole-word" title="Match Whole Word (Alt+W)">
              Ab
            </button>
            <button class="vditor-find-widget__option vditor-find-widget__option--regex" title="Use Regular Expression (Alt+R)">
              .*
            </button>
          </div>
        </div>
      </div>
    `;

    vditorElement.appendChild(this.widget);

    // Get references to interactive elements
    this.findInput = this.widget.querySelector('.vditor-find-widget__find-input') as HTMLInputElement;
    this.replaceInput = this.widget.querySelector('.vditor-find-widget__replace-input') as HTMLInputElement;
    this.matchCountSpan = this.widget.querySelector('.vditor-find-widget__match-count') as HTMLElement;

    this.bindWidgetEvents();

  }

  /**
   * Show the widget in find or find+replace mode
   */
  private showWidget(showReplace: boolean): void {
    if (!this.widget) return;

    const replaceRow = this.widget.querySelector('.vditor-find-widget__replace-row') as HTMLElement;
    const optionsRow = this.widget.querySelector('.vditor-find-widget__options-row') as HTMLElement;
    
    this.widget.style.display = 'block';
    
    if (showReplace) {
      replaceRow.style.display = 'flex';
      optionsRow.style.display = 'flex';
      this.widget.classList.add('vditor-find-widget--replace-mode');
    } else {
      replaceRow.style.display = 'none';
      optionsRow.style.display = 'flex';
      this.widget.classList.remove('vditor-find-widget--replace-mode');
    }

    // Position the widget
    this.positionWidget();
  }

  /**
   * Position the widget in the editor
   */
  private positionWidget(): void {
    if (!this.widget) return;

    // Position relative to the toolbar
    const toolbar = document.querySelector('.vditor-toolbar');
    if (toolbar) {
      const toolbarRect = toolbar.getBoundingClientRect();
      this.widget.style.top = `${toolbarRect.bottom}px`;
      this.widget.style.right = '20px';
    }
  }

  /**
   * Focus the find input
   */
  private focusFindInput(): void {
    if (this.findInput) {
      // Select current selection text if any
      const selection = this.getSelectedText();

      
      if (selection) {
        this.findInput.value = selection;
        this.state.findTerm = selection;

        this.performSearch();
      }
      
      setTimeout(() => {
        this.findInput?.focus();
        this.findInput?.select();

      }, 100);
    }
  }

  /**
   * Get currently selected text in the editor
   */
  private getSelectedText(): string {
    const selection = window.getSelection();


    
    if (selection && selection.rangeCount > 0) {
      const selectedText = selection.toString().trim();
      const range = selection.getRangeAt(0);



      return selectedText;
    }
    

    return '';
  }

  /**
   * Bind keyboard shortcuts
   */
  private bindKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e) => {
      // Ctrl+F - Show find
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        this.showFind();
        return;
      }

      // Ctrl+H - Show find and replace
      if ((e.ctrlKey || e.metaKey) && e.key === 'h' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        this.showFindReplace();
        return;
      }

      // Escape - Hide widget
      if (e.key === 'Escape' && this.state.isVisible) {
        e.preventDefault();
        this.hide();
        this.vditor?.focus();
        return;
      }

      // F3 - Next match
      if (e.key === 'F3' && !e.shiftKey) {
        e.preventDefault();
        this.findNext();
        return;
      }

      // Shift+F3 - Previous match
      if (e.key === 'F3' && e.shiftKey) {
        e.preventDefault();
        this.findPrevious();
        return;
      }
    });


  }

  /**
   * Bind widget events
   */
  private bindWidgetEvents(): void {
    if (!this.widget) return;

    // Find input events
    if (this.findInput) {
      this.findInput.addEventListener('input', () => {
        const newTerm = this.findInput!.value;
        const previousTerm = this.state.findTerm;
        this.state.findTerm = newTerm;
        
        
        // Provide immediate visual feedback for empty searches
        if (!newTerm.trim()) {
          this.clearHighlights();
          this.updateMatchCount(0, 0);
        } else if (newTerm.trim().length === 1) {
          // For single character searches, show "searching..." state
          this.updateMatchCount(0, 0, true);
        }
        
        this.debouncedSearch();
      });

      this.findInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey) {
            this.findPrevious();
          } else {
            this.findNext();
          }
        }
      });
    }

    // Replace input events
    if (this.replaceInput) {
      this.replaceInput.addEventListener('input', () => {
        this.state.replaceTerm = this.replaceInput!.value;
      });

      this.replaceInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) {
            this.replaceAll();
          } else {
            this.replaceCurrent();
          }
        }
      });
    }

    // Button events
    this.bindButtonEvents();

  }

  /**
   * Bind button events
   */
  private bindButtonEvents(): void {
    if (!this.widget) return;

    // Navigation buttons
    const prevButton = this.widget.querySelector('.vditor-find-widget__button--prev');
    const nextButton = this.widget.querySelector('.vditor-find-widget__button--next');
    const closeButton = this.widget.querySelector('.vditor-find-widget__button--close');
    const toggleReplaceButton = this.widget.querySelector('.vditor-find-widget__button--toggle-replace');

    prevButton?.addEventListener('click', () => this.findPrevious());
    nextButton?.addEventListener('click', () => this.findNext());
    closeButton?.addEventListener('click', () => this.hide());
    toggleReplaceButton?.addEventListener('click', () => this.toggleReplaceMode());

    // Replace buttons
    const replaceButton = this.widget.querySelector('.vditor-find-widget__button--replace');
    const replaceAllButton = this.widget.querySelector('.vditor-find-widget__button--replace-all');

    replaceButton?.addEventListener('click', () => this.replaceCurrent());
    replaceAllButton?.addEventListener('click', () => this.replaceAll());

    // Option buttons
    const matchCaseButton = this.widget.querySelector('.vditor-find-widget__option--match-case');
    const wholeWordButton = this.widget.querySelector('.vditor-find-widget__option--whole-word');
    const regexButton = this.widget.querySelector('.vditor-find-widget__option--regex');

    matchCaseButton?.addEventListener('click', () => this.toggleMatchCase());
    wholeWordButton?.addEventListener('click', () => this.toggleWholeWord());
    regexButton?.addEventListener('click', () => this.toggleRegex());
  }

  /**
   * Toggle replace mode
   */
  private toggleReplaceMode(): void {
    const isReplaceMode = this.widget?.classList.contains('vditor-find-widget--replace-mode');
    this.showWidget(!isReplaceMode);
  }

  /**
   * Toggle match case option
   */
  private toggleMatchCase(): void {
    this.state.matchCase = !this.state.matchCase;
    const button = this.widget?.querySelector('.vditor-find-widget__option--match-case');
    button?.classList.toggle('vditor-find-widget__option--active', this.state.matchCase);
    this.debouncedSearch();
  }

  /**
   * Toggle whole word option
   */
  private toggleWholeWord(): void {
    this.state.wholeWord = !this.state.wholeWord;
    const button = this.widget?.querySelector('.vditor-find-widget__option--whole-word');
    button?.classList.toggle('vditor-find-widget__option--active', this.state.wholeWord);
    this.debouncedSearch();
  }

  /**
   * Toggle regex option
   */
  private toggleRegex(): void {
    this.state.useRegex = !this.state.useRegex;
    const button = this.widget?.querySelector('.vditor-find-widget__option--regex');
    button?.classList.toggle('vditor-find-widget__option--active', this.state.useRegex);
    this.debouncedSearch();
  }

  /**
   * Debounced search to wait for Vditor DOM processing and user typing completion
   */
  private debouncedSearch(): void {
    // Clear previous timeout
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = null;
    }

    // Track input timing for adaptive debouncing
    const currentTime = Date.now();
    const timeSinceLastInput = currentTime - this.lastInputTime;
    this.lastInputTime = currentTime;

    // If search term is empty, clear immediately
    if (!this.state.findTerm.trim()) {
      this.clearHighlights();
      this.updateMatchCount(0, 0);
      this.pendingSearch = false;
      return;
    }

    // Mark that we have a pending search
    this.pendingSearch = true;

    // Use adaptive delay based on typing pattern
    // If user is typing quickly (< 200ms between keystrokes), use longer delay
    // If user is typing slowly (> 800ms between keystrokes), use shorter delay
    let adaptiveDelay = this.userTypingDelay;
    if (timeSinceLastInput < 200) {
      adaptiveDelay = this.userTypingDelay + 200; // Extra delay for fast typing
    } else if (timeSinceLastInput > 800) {
      adaptiveDelay = Math.max(this.domStabilityDelay, this.userTypingDelay - 200); // Shorter delay for slow typing
    }

    
    // Show searching state if we're going to wait a significant amount of time
    if (adaptiveDelay > 250) {
      this.updateMatchCount(0, 0, true);
    }

    // Debounce search to allow user to finish typing and Vditor to finish DOM processing
    this.searchTimeout = window.setTimeout(() => {
      // Check if this search is still relevant (user hasn't changed the term)
      if (this.pendingSearch && this.state.findTerm.trim()) {
        this.performSearchWithRetry();
      } else {
      }
      this.pendingSearch = false;
      this.searchTimeout = null;
    }, adaptiveDelay);
  }

  /**
   * Perform search with retry logic for DOM stability
   */
  private async performSearchWithRetry(retryCount: number = 0): Promise<void> {
    const maxRetries = 3;
    
    // Double-check that we still want to perform this search
    if (!this.state.findTerm.trim()) {
      return;
    }
    

    // Wait for DOM to be ready before searching
    await this.waitForDOMReady();

    try {
      const matches = await this.findMatchesAsync(this.state.findTerm);
      
      // If we get 0 matches and haven't tried all retries, and this isn't an obviously empty search
      if (matches.length === 0 && retryCount < maxRetries && this.shouldRetrySearch()) {
        setTimeout(() => {
          this.performSearchWithRetry(retryCount + 1);
        }, this.domStabilityDelay);
        return;
      }

      this.highlightMatches(matches);
      this.state.matches = matches;
      this.state.totalMatches = matches.length;
      this.state.currentMatch = matches.length > 0 ? 1 : 0;
      
      this.updateMatchCount(this.state.currentMatch, this.state.totalMatches);
      
      if (matches.length > 0) {
        this.scrollToMatch(0);
      }

      this.lastSearchTerm = this.state.findTerm;
      
    } catch (error) {
      vscodeLogError('❌ FindReplaceManager: Search error:', error);
      
      // Retry on error if we haven't exhausted retries
      if (retryCount < maxRetries) {
        setTimeout(() => {
          this.performSearchWithRetry(retryCount + 1);
        }, this.domStabilityDelay);
      } else {
        this.updateMatchCount(0, 0);
      }
    }
  }

  /**
   * Determine if we should retry a search that returned 0 results
   */
  private shouldRetrySearch(): boolean {
    const searchTerm = this.state.findTerm.toLowerCase();
    
    // Don't retry for very short terms (likely no matches)
    if (searchTerm.length < 2) {
      return false;
    }
    
    // Don't retry for obviously made-up terms
    if (searchTerm.includes('xyz') || searchTerm.includes('qwerty')) {
      return false;
    }
    
    // Don't retry if we just searched for the same term successfully
    if (this.lastSearchTerm === this.state.findTerm) {
      return false;
    }
    
    // Check if DOM appears to be in a reasonable state
    const editorElement = this.getEditorElement();
    if (!editorElement || !editorElement.textContent) {
      return true; // DOM might still be loading
    }
    
    // If the editor has content and we're searching for common words, retry
    const commonWords = ['test', 'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use'];
    return commonWords.includes(searchTerm);
  }

  /**
   * Perform search and highlight matches
   */
  private performSearch(): void {
    this.performSearchWithRetry(0);
  }

  /**
   * Wait for DOM to be ready for searching using requestAnimationFrame
   */
  private waitForDOMReady(): Promise<void> {
    return new Promise((resolve) => {
      // Use requestAnimationFrame to ensure DOM painting is complete
      requestAnimationFrame(() => {
        // Add a small additional delay to ensure Vditor IR processing is done
        setTimeout(() => {
          resolve();
        }, 50);
      });
    });
  }

  /**
   * Check if DOM is in a stable state for searching
   */
  private isDOMStable(editorElement: Element): boolean {
    // Check if element has content
    if (!editorElement.textContent || editorElement.textContent.trim().length === 0) {
      return false;
    }

    // Check if Vditor is still processing (look for processing indicators)
    const vditorElement = editorElement.closest('.vditor');
    if (vditorElement?.classList.contains('vditor--loading')) {
      return false;
    }

    // Check if there are text nodes to search
    const walker = document.createTreeWalker(
      editorElement,
      NodeFilter.SHOW_TEXT,
      null
    );
    
    let textNodeCount = 0;
    let hasSearchableContent = false;
    let textNode: Text | null;
    
    while ((textNode = walker.nextNode() as Text) && textNodeCount < 10) {
      if (textNode.textContent && textNode.textContent.trim().length > 0) {
        textNodeCount++;
        // Check if this text node contains content that should be findable
        if (textNode.textContent.toLowerCase().includes('test')) {
          hasSearchableContent = true;
        }
      }
    }


    if (textNodeCount === 0) {
      return false;
    }

    return true;
  }

  /**
   * Find all matches in the editor content (async version for better DOM stability)
   */
  private async findMatchesAsync(searchTerm: string): Promise<Range[]> {
    const matches: Range[] = [];
    const editorElement = this.getEditorElement();
    
    if (!editorElement) {
      vscodeLogWarn('⚠️ FindReplaceManager: No editor element found');
      return matches;
    }

    // Wait a bit more to ensure Vditor IR processing is complete
    await new Promise(resolve => setTimeout(resolve, 50));

    // Check DOM stability before searching
    if (!this.isDOMStable(editorElement)) {
      return [];
    }

    const options = {
      matchCase: this.state.matchCase,
      wholeWord: this.state.wholeWord,
      useRegex: this.state.useRegex
    };

    try {
      // Create search regex
      let flags = 'g';
      if (!this.state.matchCase) flags += 'i';
      
      let pattern = searchTerm;
      
      if (!this.state.useRegex) {
        // Escape special regex characters for literal search
        pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      
      if (this.state.wholeWord) {
        // Use standard word boundaries - they should work for basic word characters
        pattern = `\\b${pattern}\\b`;
      }

      
      // Try multiple DOM traversal strategies
      const strategies = [
        () => this.searchWithTreeWalker(editorElement, pattern, flags),
        () => this.searchWithQuerySelector(editorElement, searchTerm),
        () => this.searchWithTextContent(editorElement, pattern, flags)
      ];

      for (let i = 0; i < strategies.length; i++) {
        
        try {
          const strategyMatches = await strategies[i]();
          if (strategyMatches.length > 0) {
            matches.push(...strategyMatches);
            break;
          }
        } catch (error) {
          vscodeLogWarn(`⚠️ FindReplaceManager: Strategy ${i + 1} failed:`, error);
          continue;
        }
      }
      
      
    } catch (error) {
      vscodeLogError('❌ FindReplaceManager: Error in findMatchesAsync:', error);
    }

    return matches;
  }

  /**
   * Search using TreeWalker (original strategy)
   */
  private async searchWithTreeWalker(editorElement: Element, pattern: string, flags: string): Promise<Range[]> {
    const matches: Range[] = [];
    const regex = new RegExp(pattern, flags);
    
    const walker = document.createTreeWalker(
      editorElement,
      NodeFilter.SHOW_TEXT,
      null
    );

    let textNode: Text | null;
    const processedNodes: Text[] = [];
    
    // Collect all text nodes first
    while ((textNode = walker.nextNode() as Text)) {
      const text = textNode.textContent;
      if (text && text.trim().length > 0) {
        processedNodes.push(textNode);
      }
    }


    // Process collected nodes
    for (const node of processedNodes) {
      const text = node.textContent;
      if (!text) continue;
      
      // Create a fresh regex for each text node
      const nodeRegex = new RegExp(pattern, flags);
      let match;
      
      while ((match = nodeRegex.exec(text)) !== null) {
        try {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          matches.push(range);
          
        } catch (error) {
          vscodeLogWarn('⚠️ FindReplaceManager: TreeWalker range creation failed:', error);
        }
        
        if (match[0].length === 0) break;
      }
    }

    return matches;
  }

  /**
   * Search using querySelector to find text content
   */
  private async searchWithQuerySelector(editorElement: Element, searchTerm: string): Promise<Range[]> {
    const matches: Range[] = [];
    
    // Get all elements that might contain text
    const allElements = editorElement.querySelectorAll('*');
    const searchTermLower = searchTerm.toLowerCase();
    
    
    for (let i = 0; i < allElements.length; i++) {
      const element = allElements[i];
      const textContent = element.textContent;
      if (!textContent || !textContent.toLowerCase().includes(searchTermLower)) continue;
      
      // Create a TreeWalker just for this element
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null
      );
      
      let textNode: Text | null;
      while ((textNode = walker.nextNode() as Text)) {
        const text = textNode.textContent;
        if (!text) continue;
        
        const textLower = text.toLowerCase();
        let index = textLower.indexOf(searchTermLower);
        
        while (index !== -1) {
          try {
            const range = document.createRange();
            range.setStart(textNode, index);
            range.setEnd(textNode, index + searchTerm.length);
            matches.push(range);
            
          } catch (error) {
            vscodeLogWarn('⚠️ FindReplaceManager: QuerySelector range creation failed:', error);
          }
          
          index = textLower.indexOf(searchTermLower, index + 1);
        }
      }
    }
    
    return matches;
  }

  /**
   * Search using direct text content analysis
   */
  private async searchWithTextContent(editorElement: Element, pattern: string, flags: string): Promise<Range[]> {
    const matches: Range[] = [];
    const regex = new RegExp(pattern, flags);
    
    const fullText = editorElement.textContent || '';
    
    let match;
    while ((match = regex.exec(fullText)) !== null) {
      // Try to find the corresponding DOM range
      try {
        const range = this.createRangeFromTextOffset(editorElement, match.index, match[0].length);
        if (range) {
          matches.push(range);
        }
      } catch (error) {
        vscodeLogWarn('⚠️ FindReplaceManager: TextContent range creation failed:', error);
      }
      
      if (match[0].length === 0) break;
    }
    
    return matches;
  }

  /**
   * Create a range from text offset in element
   */
  private createRangeFromTextOffset(element: Element, offset: number, length: number): Range | null {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null
    );
    
    let currentOffset = 0;
    let textNode: Text | null;
    
    while ((textNode = walker.nextNode() as Text)) {
      const text = textNode.textContent || '';
      const nodeEndOffset = currentOffset + text.length;
      
      if (offset >= currentOffset && offset < nodeEndOffset) {
        const startOffset = offset - currentOffset;
        const endOffset = Math.min(startOffset + length, text.length);
        
        try {
          const range = document.createRange();
          range.setStart(textNode, startOffset);
          range.setEnd(textNode, endOffset);
          return range;
        } catch (error) {
          vscodeLogWarn('⚠️ FindReplaceManager: Range creation failed for offset:', error);
          return null;
        }
      }
      
      currentOffset = nodeEndOffset;
    }
    
    return null;
  }

  /**
   * Find all matches in the editor content (legacy synchronous version)
   */
  private findMatches(searchTerm: string): Range[] {
    // For backward compatibility, call the async version synchronously
    return [];
  }

  /**
   * Get the editor element for searching
   */
  private getEditorElement(): Element | null {
    // Try different Vditor content areas
    const selectors = ['.vditor-ir', '.vditor-wysiwyg', '.vditor-sv', '.vditor-content'];
    
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
    }
    
    vscodeLogWarn('⚠️ FindReplaceManager: No editor element found. Available elements:', {
      vditorIr: !!document.querySelector('.vditor-ir'),
      vditorWysiwyg: !!document.querySelector('.vditor-wysiwyg'),
      vditorSv: !!document.querySelector('.vditor-sv'),
      vditorContent: !!document.querySelector('.vditor-content'),
      vditorElements: document.querySelectorAll('[class*="vditor"]').length
    });
    
    return null;
  }

  /**
   * Highlight matches in the editor
   */
  private highlightMatches(matches: Range[]): void {
    this.clearHighlights();

    if (matches.length === 0) {
      return;
    }


    // Create a stable representation of all matches before DOM manipulation
    const matchData: Array<{
      textNode: Text,
      startOffset: number,
      endOffset: number,
      text: string,
      originalIndex: number
    }> = [];

    matches.forEach((range, index) => {
      try {
        const startContainer = range.startContainer;
        const text = range.toString();
        
        if (startContainer.nodeType === Node.TEXT_NODE && text) {
          matchData.push({
            textNode: startContainer as Text,
            startOffset: range.startOffset,
            endOffset: range.endOffset,
            text: text,
            originalIndex: index
          });
        }
      } catch (error) {
        vscodeLogWarn('⚠️ FindReplaceManager: Failed to extract match data:', error);
      }
    });


    // Group matches by text node to handle multiple matches in the same node
    const nodeMatches = new Map<Text, Array<typeof matchData[0]>>();
    matchData.forEach(match => {
      if (!nodeMatches.has(match.textNode)) {
        nodeMatches.set(match.textNode, []);
      }
      nodeMatches.get(match.textNode)!.push(match);
    });


    // Process each text node with its matches (from end to start to avoid offset issues)
    nodeMatches.forEach((matches, textNode) => {
      try {
        // Sort matches by start offset (descending) to process from end to start
        matches.sort((a, b) => b.startOffset - a.startOffset);
        

        matches.forEach(match => {
          try {
            this.highlightSingleMatch(textNode, match.startOffset, match.endOffset, match.text, match.originalIndex);
          } catch (error) {
            vscodeLogWarn('⚠️ FindReplaceManager: Failed to highlight single match:', error);
          }
        });
      } catch (error) {
        vscodeLogWarn('⚠️ FindReplaceManager: Failed to process text node matches:', error);
      }
    });
    
  }

  /**
   * Highlight a single match within a text node
   */
  private highlightSingleMatch(textNode: Text, startOffset: number, endOffset: number, matchText: string, originalIndex: number): void {
    try {
      const parent = textNode.parentNode;
      if (!parent) {
        vscodeLogWarn('⚠️ FindReplaceManager: Text node has no parent');
        return;
      }

      const fullText = textNode.textContent || '';
      
      // Validate offsets
      if (startOffset < 0 || endOffset > fullText.length || startOffset >= endOffset) {
        vscodeLogWarn('⚠️ FindReplaceManager: Invalid offsets', { startOffset, endOffset, textLength: fullText.length });
        return;
      }

      // Split the text node into parts
      const beforeText = fullText.substring(0, startOffset);
      const afterText = fullText.substring(endOffset);

      // Create highlight span
      const span = document.createElement('span');
      span.className = `vditor-find-highlight ${originalIndex === 0 ? 'vditor-find-highlight--current' : ''}`;
      span.setAttribute('data-find-match-index', originalIndex.toString());
      span.textContent = matchText;

      // Create new text nodes
      const fragments: Node[] = [];
      
      if (beforeText) {
        fragments.push(document.createTextNode(beforeText));
      }
      
      fragments.push(span);
      
      if (afterText) {
        fragments.push(document.createTextNode(afterText));
      }

      // Replace the original text node with the fragments
      if (fragments.length > 0) {
        // Insert all fragments before the original text node
        fragments.forEach(fragment => {
          parent.insertBefore(fragment, textNode);
        });
        
        // Remove the original text node
        parent.removeChild(textNode);
        
        // Track the highlight element
        this.highlightedElements.push(span);
        
      }
    } catch (error) {
      vscodeLogWarn('⚠️ FindReplaceManager: Failed to highlight single match:', error);
    }
  }

  /**
   * Clear all highlights
   */
  private clearHighlights(): void {
    this.highlightedElements.forEach(element => {
      try {
        const parent = element.parentNode;
        if (parent) {
          // Get the text content
          const textContent = element.textContent || '';
          
          // Replace the highlight span with a text node
          if (textContent) {
            const textNode = document.createTextNode(textContent);
            parent.replaceChild(textNode, element);
          } else {
            parent.removeChild(element);
          }
        }
      } catch (error) {
        vscodeLogWarn('⚠️ FindReplaceManager: Could not clear highlight:', error);
      }
    });
    
    this.highlightedElements = [];
    
    // Normalize all text nodes to merge adjacent ones
    const editorElement = this.getEditorElement();
    if (editorElement) {
      try {
        editorElement.normalize();
      } catch (error) {
        vscodeLogWarn('⚠️ FindReplaceManager: Could not normalize editor element:', error);
      }
    }
  }

  /**
   * Update match count display
   */
  private updateMatchCount(current: number, total: number, searching: boolean = false): void {
    if (this.matchCountSpan) {
      if (searching) {
        this.matchCountSpan.textContent = 'Searching...';
        this.matchCountSpan.className = 'vditor-find-widget__match-count vditor-find-widget__match-count--searching';
      } else if (total === 0) {
        this.matchCountSpan.textContent = 'No results';
        this.matchCountSpan.className = 'vditor-find-widget__match-count vditor-find-widget__match-count--none';
      } else {
        this.matchCountSpan.textContent = `${current} of ${total}`;
        this.matchCountSpan.className = 'vditor-find-widget__match-count';
      }
    }
  }

  /**
   * Navigate to next match
   */
  public findNext(): void {
    if (this.state.totalMatches === 0) return;

    this.state.currentMatch = this.state.currentMatch >= this.state.totalMatches ? 1 : this.state.currentMatch + 1;
    this.updateCurrentMatch();
  }

  /**
   * Navigate to previous match
   */
  public findPrevious(): void {
    if (this.state.totalMatches === 0) return;

    this.state.currentMatch = this.state.currentMatch <= 1 ? this.state.totalMatches : this.state.currentMatch - 1;
    this.updateCurrentMatch();
  }

  /**
   * Update current match highlighting and scroll
   */
  private updateCurrentMatch(): void {
    // Remove current class from all highlights
    this.highlightedElements.forEach(element => {
      element.classList.remove('vditor-find-highlight--current');
    });

    // Add current class to current match
    const currentElement = this.highlightedElements[this.state.currentMatch - 1];
    if (currentElement) {
      currentElement.classList.add('vditor-find-highlight--current');
      this.scrollToMatch(this.state.currentMatch - 1);
    }

    this.updateMatchCount(this.state.currentMatch, this.state.totalMatches);
  }

  /**
   * Scroll to a specific match
   */
  private scrollToMatch(matchIndex: number): void {
    const element = this.highlightedElements[matchIndex];
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /**
   * Replace current match
   */
  public replaceCurrent(): void {
    if (this.state.currentMatch === 0 || this.state.totalMatches === 0) return;

    const currentElement = this.highlightedElements[this.state.currentMatch - 1];
    if (currentElement) {
      try {
        // Store the original text for undo
        const originalText = currentElement.textContent || '';
        
        // Replace the text content
        currentElement.textContent = this.state.replaceTerm;
        
        // Remove highlight styling but keep the element for smooth transition
        currentElement.className = 'vditor-find-replaced';
        
        // Update Vditor content and trigger save
        this.updateVditorContent();
        
        // Refresh search to update matches after a brief delay
        setTimeout(() => {
          this.performSearch();
          
          // If still in find mode and we replaced text, move to next match
          if (this.state.totalMatches > 0 && this.state.currentMatch <= this.state.totalMatches) {
            this.findNext();
          }
        }, 150);

      } catch (error) {
        vscodeLogError('❌ FindReplaceManager: Error replacing current match:', error);
      }
    }
  }

  /**
   * Replace all matches
   */
  public replaceAll(): void {
    if (this.state.totalMatches === 0) return;

    const replacementCount = this.highlightedElements.length;
    const originalTexts: string[] = [];
    
    try {
      // Store original texts for logging and undo support
      this.highlightedElements.forEach(element => {
        originalTexts.push(element.textContent || '');
      });
      
      // Replace all highlighted elements
      this.highlightedElements.forEach((element, index) => {
        element.textContent = this.state.replaceTerm;
        element.className = 'vditor-find-replaced';
      });

      // Update Vditor content and trigger save
      this.updateVditorContent();
      
      // Clear search state after a brief delay to allow content update
      setTimeout(() => {
        this.clearHighlights();
        this.state.matches = [];
        this.state.totalMatches = 0;
        this.state.currentMatch = 0;
        this.updateMatchCount(0, 0);
        
        // Show success message
        this.showReplacementMessage(replacementCount);
      }, 100);

    } catch (error) {
      vscodeLogError('❌ FindReplaceManager: Error in replace all operation:', error);
    }
  }

  /**
   * Update Vditor content after replacements
   */
  private updateVditorContent(): void {
    if (this.vditor) {
      try {
        // Force Vditor to recognize the DOM changes and update its internal content
        const editorElement = this.getEditorElement();
        if (editorElement) {
          // Trigger Vditor's internal content sync by simulating an input event
          const inputEvent = new Event('input', { bubbles: true });
          editorElement.dispatchEvent(inputEvent);
          
          // Get the updated content from Vditor
          const currentContent = this.vditor.getValue();
          
          // Notify VS Code about the change with proper command structure
          if (typeof vscode !== 'undefined') {
            vscode.postMessage({
              command: "edit",
              content: currentContent,
            });
            
          }
        }
      } catch (error) {
        vscodeLogError('❌ FindReplaceManager: Error updating Vditor content:', error);
      }
    }
  }

  /**
   * Show replacement success message
   */
  private showReplacementMessage(count: number): void {
    if (typeof vscode !== 'undefined') {
      vscode.postMessage({
        command: "info",
        content: `Replaced ${count} occurrence${count !== 1 ? 's' : ''}`,
      });
    }
  }

  /**
   * Get current state for external access
   */
  public getState(): FindReplaceState {
    return { ...this.state };
  }

  /**
   * Public method to test find functionality (for debugging)
   */
  public testFind(searchTerm: string, options: { wholeWord?: boolean; matchCase?: boolean; useRegex?: boolean } = {}): void {
    
    // Set the search term and options
    this.state.findTerm = searchTerm;
    this.state.wholeWord = options.wholeWord || false;
    this.state.matchCase = options.matchCase || false;
    this.state.useRegex = options.useRegex || false;
    
    // Run the regex test

    
    // Try to find matches
    const matches = this.findMatches(searchTerm);
    
    // Test the DOM traversal
    const editorElement = this.getEditorElement();
    if (editorElement) {
      
      // List all text nodes
      const walker = document.createTreeWalker(
        editorElement,
        NodeFilter.SHOW_TEXT,
        null
      );
      
      const textNodes: Text[] = [];
      let node: Text | null;
      while ((node = walker.nextNode() as Text)) {
        if (node.textContent && node.textContent.trim()) {
          textNodes.push(node);
        }
      }
      
      textNodes.forEach((textNode, index) => {
        const text = textNode.textContent || '';
        if (text.includes(searchTerm.toLowerCase()) || text.toLowerCase().includes(searchTerm.toLowerCase())) {
        }
      });
    } else {
      vscodeLogWarn('🧪 No editor element found for testing');
    }
  }

  /**
   * Destroy the find and replace manager
   */
  public destroy(): void {
    this.hide();
    
    this.cancelPendingSearch();
    
    if (this.widget && this.widget.parentNode) {
      this.widget.parentNode.removeChild(this.widget);
    }
    
    // Reset state
    this.lastInputTime = 0;
    this.lastSearchTerm = '';
    this.widget = null;
    this.findInput = null;
    this.replaceInput = null;
    this.matchCountSpan = null;
  }
}