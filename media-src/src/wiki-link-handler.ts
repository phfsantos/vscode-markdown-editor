/**
 * Wiki-Link Handler - Efficient link format handling and resolution
 * Supports: [[filename]], [[filename|alias]], [[filename#heading]], [[#heading]]
 */

// VS Code webview API
declare const vscode: any;

// Logging helper
function vscodeLog(message: string) {
  vscode.postMessage({ command: 'log', message });
}

interface WikiLink {
  full: string;           // Full match: [[filename#heading|alias]]
  filename?: string;      // filename or empty for same-file
  heading?: string;       // heading anchor
  alias?: string;         // display text
  isSameFile: boolean;    // [[#heading]] format
}

/**
 * WikiLinkHandler manages wiki-link format detection, parsing, and resolution
 * Integrates with Vditor's input processing and rendering
 */
export class WikiLinkHandler {
  private vditor: any;
  private currentDocumentPath: string = '';
  public isSetup: boolean = false;
  public editorElement: HTMLElement | null = null;
  
  // Wiki-link patterns
  private readonly WIKI_LINK_REGEX = /\[\[([^\]]+)\]\]/g;
  private readonly ALIAS_SPLIT = '|';
  private readonly HEADING_SPLIT = '#';
  
  // Debouncing
  private processingTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 300;

  constructor(vditor: any) {
    this.vditor = vditor;
  }

  /**
   * Initialize link handling
   */
  public initialize(documentPath: string): void {
    this.currentDocumentPath = documentPath;
    vscodeLog(`[WikiLinkHandler] 📎 Initialized for: ${documentPath}`);
    
    // Try immediate setup
    const editorElement = (this.vditor as any).vditor?.ir?.element || (this.vditor as any).vditor?.wysiwyg?.element;
    if (editorElement) {
      this.editorElement = editorElement;
      this.attachEventListeners(editorElement);
      this.isSetup = true;
      vscodeLog('[WikiLinkHandler] ✅ Event listeners attached immediately');
      
      // Process existing wiki-links
      this.processWikiLinksInEditor();
    } else {
      vscodeLog('[WikiLinkHandler] ⏳ Waiting for first input event...');
    }
    
    vscodeLog('[WikiLinkHandler] 🔗 Initialized wiki-link handler');
  }

	/**
   * Handle input event for processing wiki-links
   * Called from main.ts input callback which already has 200ms debounce
   * No additional debouncing needed here
   */
  public handleInputForProcessing(): void {
    vscodeLog('[WikiLinkHandler] 📥 handleInputForProcessing called from main.ts');
    
    // Attach event listeners if not done yet
    if (!this.isSetup && this.editorElement) {
      vscodeLog('[WikiLinkHandler] 🔧 Attaching event listeners...');
      this.attachEventListeners(this.editorElement);
      this.isSetup = true;
      vscodeLog('[WikiLinkHandler] ✅ Event listeners attached via input callback');
    }
    
    // Process immediately - main.ts already debounced the input
    vscodeLog('[WikiLinkHandler] 🔍 Starting wiki-link processing (called from debounced main.ts input)');
    this.processWikiLinksInEditor();
  }

  /**
   * Update current document path
   */
  public updateDocumentPath(documentPath: string): void {
    this.currentDocumentPath = documentPath;
  }

  /**
   * Attach event listeners to editor element
   */
  private attachEventListeners(editorElement: HTMLElement): void {
    editorElement.addEventListener('input', this.handleEditorInput.bind(this));
    // Note: Click handlers are now attached directly to preview spans in createVditorIRWikiLink
  }

  /**
   * Parse wiki-link text into components
   */
  public parseWikiLink(linkText: string): WikiLink {
    // Remove [[ and ]] brackets
    const content = linkText.replace(/^\[\[|\]\]$/g, '');
    
    // Check for same-file heading link: [[#heading]]
    if (content.startsWith(this.HEADING_SPLIT)) {
      return {
        full: linkText,
        heading: content.substring(1),
        isSameFile: true
      };
    }

    // Split by alias separator |
    const [pathPart, alias] = content.split(this.ALIAS_SPLIT).map(s => s.trim());
    
    // Split by heading separator #
    const [filename, heading] = pathPart.split(this.HEADING_SPLIT).map(s => s.trim());

    return {
      full: linkText,
      filename: filename || undefined,
      heading: heading || undefined,
      alias: alias || undefined,
      isSameFile: false
    };
  }

  /**
   * Convert wiki-link to markdown link
   */
  public wikiLinkToMarkdown(wikiLink: string): string {
    const parsed = this.parseWikiLink(wikiLink);
    
    // Same-file heading link
    if (parsed.isSameFile && parsed.heading) {
      const displayText = parsed.alias || parsed.heading;
      return `[${displayText}](#${this.headingToAnchor(parsed.heading)})`;
    }

    // Build the URL
    let url = '';
    
    if (parsed.filename) {
      // Resolve relative path
      url = this.resolveRelativePath(parsed.filename);
      
      // Add heading anchor if present
      if (parsed.heading) {
        url += `#${this.headingToAnchor(parsed.heading)}`;
      }
    }

    // Build display text
    const displayText = parsed.alias || parsed.filename || parsed.heading || 'link';

    return `[${displayText}](${url})`;
  }

  /**
   * Convert heading to anchor ID (GitHub-style)
   */
  private headingToAnchor(heading: string): string {
    return heading
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-')      // Spaces to hyphens
      .replace(/-+/g, '-')       // Collapse multiple hyphens
      .replace(/^-|-$/g, '');    // Trim hyphens
  }

  /**
   * Resolve relative path for a filename
   */
  private resolveRelativePath(filename: string): string {
    // If already a path with extension, return as-is
    if (filename.includes('/') || filename.includes('\\')) {
      return filename;
    }

    // Request resolution from extension host
    this.requestPathResolution(filename);
    
    // For now, return with .md extension
    // The actual resolution will update the link asynchronously
    return `./${filename.endsWith('.md') ? filename : filename + '.md'}`;
  }

  /**
   * Request path resolution from extension host
   */
  private requestPathResolution(filename: string): void {
    vscode.postMessage({
      command: 'resolveWikiLink',
      filename,
      currentDocument: this.currentDocumentPath
    });
  }

  /**
   * Handle editor input to process wiki-links
   * NOTE: This is called from the attached event listener (e.g., clicks)
   * Implements debouncing since direct editor events aren't debounced
   */
  private handleEditorInput(event: Event): void {
    // Cancel any pending processing
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
      vscodeLog('[WikiLinkHandler] 🔄 Cancelled pending wiki-link processing (new editor event)');
    }
    
    // Schedule new processing
    vscodeLog('[WikiLinkHandler] ⌨️ Editor event, scheduling wiki-link processing in 300ms...');
    this.processingTimeout = setTimeout(() => {
      this.processingTimeout = null;
      this.processWikiLinksInEditor();
    }, this.DEBOUNCE_MS);
  }

  /**
   * Process wiki-links in the editor
   * Public so it can be called from main.ts after render/setValue
   */
  public processWikiLinksInEditor(): void {
    const editorElement = (this.vditor as any).vditor?.ir?.element || (this.vditor as any).vditor?.wysiwyg?.element;
    if (!editorElement) {
      vscodeLog('[WikiLinkHandler] ⚠️ No editor element in processWikiLinksInEditor');
      return;
    }

    vscodeLog('[WikiLinkHandler] 🔍 Processing wiki-links in editor...');

    // Find all wiki-link text nodes
    const walker = document.createTreeWalker(
      editorElement,
      NodeFilter.SHOW_TEXT,
      null
    );

    const wikiLinkNodes: { node: Text; matches: RegExpMatchArray[] }[] = [];
    let node: Text | null;
    let textNodeCount = 0;

    while ((node = walker.nextNode() as Text)) {
      textNodeCount++;
      const text = node.textContent || '';
      const matches = Array.from(text.matchAll(this.WIKI_LINK_REGEX));
      
      if (matches.length > 0) {
        vscodeLog(`[WikiLinkHandler] 📝 Found ${matches.length} wiki-link(s) in text node: "${text}"`);
        wikiLinkNodes.push({ node, matches });
      }
    }

    vscodeLog(`[WikiLinkHandler] 📊 Scanned ${textNodeCount} text nodes, found ${wikiLinkNodes.length} with wiki-links`);

    // Enhance wiki-links with click handlers and styling
    wikiLinkNodes.forEach(({ node, matches }) => {
      this.enhanceWikiLinkNode(node, matches);
    });
    
    if (wikiLinkNodes.length > 0) {
      vscodeLog('[WikiLinkHandler] ✅ Enhanced all wiki-links');
    }
  }

  /**
   * Enhance a text node containing wiki-links
   * Creates proper Vditor IR structure for preview/edit modes
   */
  private enhanceWikiLinkNode(textNode: Text, matches: RegExpMatchArray[]): void {
    const parent = textNode.parentElement;
    if (!parent) return;

    // Create a document fragment to build the new content
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    const text = textNode.textContent || '';

    matches.forEach(match => {
      const wikiLink = match[0];
      const matchIndex = match.index || 0;

      // Add text before the wiki-link
      if (matchIndex > lastIndex) {
        fragment.appendChild(
          document.createTextNode(text.substring(lastIndex, matchIndex))
        );
      }

      // Create Vditor IR structure for wiki-link
      const irNode = this.createVditorIRWikiLink(wikiLink);
      fragment.appendChild(irNode);

      lastIndex = matchIndex + wikiLink.length;
    });

    // Add remaining text
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
    }

    // Replace the text node with the enhanced fragment
    parent.replaceChild(fragment, textNode);
  }

  /**
   * Create Vditor IR structure for wiki-link
   * Structure: <span class="vditor-ir__node" data-type="wiki-link">
   *              <span class="vditor-ir__marker">[[</span>
   *              <span contenteditable="true">link-content</span>
   *              <span class="vditor-ir__preview">display text</span>
   *              <span class="vditor-ir__marker">]]</span>
   *            </span>
   * 
   * Vditor handles edit mode via vditor-ir__node--expand class automatically
   * CSS shows/hides markers based on this class
   */
  private createVditorIRWikiLink(wikiLink: string): HTMLElement {
    const parsed = this.parseWikiLink(wikiLink);
    
    // Determine display text (alias or filename or heading)
    const displayText = parsed.alias || parsed.filename || parsed.heading || 'link';
    
    // Get the content inside [[ ]] for editing
    const linkContent = wikiLink.slice(2, -2); // Remove [[ and ]]

    // Container node
    const container = document.createElement('span');
    container.className = 'vditor-ir__node';
    container.setAttribute('data-type', 'wiki-link');
    container.dataset.wikiLink = wikiLink;
    container.dataset.filename = parsed.filename || '';
    container.dataset.heading = parsed.heading || '';
    container.dataset.alias = parsed.alias || '';

    // Opening marker [[ (hidden by CSS until vditor-ir__node--expand)
    const openMarker = document.createElement('span');
    openMarker.className = 'vditor-ir__marker vditor-ir__marker--pre';
    openMarker.textContent = '[[';
    
    // Combined preview/edit element - shows display text by default, editable content when expanded
    const preview = document.createElement('span');
    preview.className = 'vditor-ir__preview';
    preview.contentEditable = 'true';
    preview.textContent = displayText;
    preview.setAttribute('role', 'link'); // For accessibility
    preview.setAttribute('tabindex', '0'); // Make it focusable
    preview.dataset.linkContent = linkContent; // Store raw content for editing
    
    // Add click handler for navigation
    preview.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.navigateToWikiLink(wikiLink);
    });
    
    // Add keyboard handler for accessibility
    preview.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        this.navigateToWikiLink(wikiLink);
      }
    });
    
    // Listen for content changes when editing to update metadata
    preview.addEventListener('input', () => {
      const newContent = preview.textContent || '';
      const newWikiLink = `[[${newContent}]]`;
      container.dataset.wikiLink = newWikiLink;
      
      // Parse and update metadata
      const parsed = this.parseWikiLink(newWikiLink);
      container.dataset.filename = parsed.filename || '';
      container.dataset.heading = parsed.heading || '';
      container.dataset.alias = parsed.alias || '';
      
      // Update display text when returning to preview mode
      const newDisplayText = parsed.alias || parsed.filename || parsed.heading || 'link';
      preview.dataset.linkContent = newContent;
      preview.setAttribute('data-display-text', newDisplayText);
    });
    
    // Closing marker ]] (hidden by CSS until vditor-ir__node--expand)
    const closeMarker = document.createElement('span');
    closeMarker.className = 'vditor-ir__marker vditor-ir__marker--post';
    closeMarker.textContent = ']]';

    // Assemble IR structure - Vditor will handle expand/collapse
    container.appendChild(openMarker);
    container.appendChild(preview);
    container.appendChild(closeMarker);

    return container;
  }

  /**
   * Navigate to wiki-link target
   */
  private navigateToWikiLink(wikiLink: string): void {
    const parsed = this.parseWikiLink(wikiLink);
    
    vscodeLog(`[WikiLinkHandler] 🔗 Navigating to: ${JSON.stringify(parsed)}`);
    
    // Same-file heading navigation
    if (parsed.isSameFile && parsed.heading) {
      this.scrollToHeading(parsed.heading);
      return;
    }

    // Request navigation from extension host
    vscode.postMessage({
      command: 'navigateToWikiLink',
      filename: parsed.filename,
      heading: parsed.heading,
      currentDocument: this.currentDocumentPath
    });
  }

  /**
   * Scroll to heading in current document
   */
  private scrollToHeading(heading: string): void {
    const anchor = this.headingToAnchor(heading);
    const editorElement = this.vditor.ir?.element || this.vditor.wysiwyg?.element;
    
    if (editorElement) {
      // Find heading element
      const headingElement = editorElement.querySelector(
        `h1, h2, h3, h4, h5, h6`
      ) as HTMLElement | null;

      // Find matching heading by text content
      const headings = Array.from(editorElement.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      const targetHeading = headings.find(h => {
        const headingText = (h as HTMLElement).textContent || '';
        return this.headingToAnchor(headingText) === anchor;
      }) as HTMLElement | undefined;

      if (targetHeading) {
        targetHeading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        vscodeLog(`[WikiLinkHandler] ✅ Scrolled to heading: ${heading}`);
      } else {
        vscodeLog(`[WikiLinkHandler] ⚠️ Heading not found: ${heading}`);
      }
    }
  }

  /**
   * Convert all wiki-links in document to markdown links
   */
  public convertAllWikiLinksToMarkdown(): string {
    const content = this.vditor.getValue();
    
    return content.replace(this.WIKI_LINK_REGEX, (match: string) => {
      return this.wikiLinkToMarkdown(match);
    });
  }

  /**
   * Get all wiki-links in current document
   */
  public getAllWikiLinks(): WikiLink[] {
    const content = this.vditor.getValue();
    const matches = Array.from(content.matchAll(this.WIKI_LINK_REGEX));
    
    return matches.map(match => this.parseWikiLink(match[0]));
  }

  /**
   * Update wiki-links when file is renamed
   */
  public updateLinksForRenamedFile(oldPath: string, newPath: string): void {
    const content = this.vditor.getValue();
    const oldFilename = this.getFilenameFromPath(oldPath);
    const newFilename = this.getFilenameFromPath(newPath);

    const updatedContent = content.replace(
      this.WIKI_LINK_REGEX,
      (match: string) => {
        const parsed = this.parseWikiLink(match);
        
        if (parsed.filename === oldFilename) {
          // Rebuild wiki-link with new filename
          let newLink = `[[${newFilename}`;
          if (parsed.heading) newLink += `#${parsed.heading}`;
          if (parsed.alias) newLink += `|${parsed.alias}`;
          newLink += ']]';
          
          return newLink;
        }
        
        return match;
      }
    );

    if (updatedContent !== content) {
      this.vditor.setValue(updatedContent);
      vscodeLog(`[WikiLinkHandler] 🔄 Updated links for renamed file: ${oldFilename} → ${newFilename}`);
    }
  }

  /**
   * Extract filename from path
   */
  private getFilenameFromPath(path: string): string {
    const parts = path.split(/[/\\]/);
    const filename = parts[parts.length - 1];
    return filename.replace(/\.md$/i, '');
  }

  /**
   * Cleanup
   */
  public destroy(): void {
    clearTimeout((this as any)._inputTimeout);
    vscodeLog('[WikiLinkHandler] 🗑️ Destroyed');
  }
}
