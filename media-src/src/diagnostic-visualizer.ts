/**
 * Handles VS Code diagnostic visualization in Vditor editor
 */
export class DiagnosticVisualizer {
    private diagnostics: any[] = [];
    private vditor: any;
    private updateTimer: NodeJS.Timeout | null = null;
    private lastContent: string = '';

    constructor(vditorInstance: any) {
        this.vditor = vditorInstance;
    }

    // VS Code logging function
    private vscodeLog(message: string): void {
        (window as any).vscode?.postMessage({
            command: "log",
            message: message
        });
    }

    /**
     * Update diagnostic visualizations in the editor (private implementation)
     */
    private applyDiagnosticsToEditor(diagnostics: any[]): void {
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
            this.clearDiagnosticStyles();
            this.diagnostics = diagnostics;
            this.applyDiagnosticStyles();
        });
    }

    /**
     * Schedule diagnostic update with debouncing to prevent flickering
     */
    private scheduleUpdate(): void {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }
        
        this.updateTimer = setTimeout(() => {
            this.clearDiagnosticStyles();
            this.applyDiagnosticStyles();
            this.updateTimer = null;
        }, 150); // Reduced debounce time
    }

    /**
     * Clear all diagnostic styles from the editor
     */
    private clearDiagnosticStyles(): void {
        // Try to find the active editor element (same logic as applyDiagnosticStyles)
        let editor = document.querySelector('.vditor-ir .vditor-reset'); // IR mode
        if (!editor) {
            editor = document.querySelector('.vditor-wysiwyg .vditor-reset'); // WYSIWYG mode
        }
        if (!editor) {
            editor = document.querySelector('.vditor-sv .vditor-reset'); // Source mode
        }
        if (!editor) {
            console.warn('DiagnosticVisualizer: Could not find Vditor editor element for cleanup');
            return;
        }

        // Remove all diagnostic classes and data attributes
        const elements = editor.querySelectorAll('[class*="vscode-diagnostic-"]');
        elements.forEach(el => {
            el.className = el.className.replace(/\bvscode-diagnostic-\w+\b/g, '').trim();
            el.removeAttribute('data-diagnostic-message');
        });

        this.vscodeLog(`DiagnosticVisualizer: Cleared diagnostic styles from ${elements.length} elements`);
    }

    /**
     * Apply diagnostic styles to matching text in the editor
     */
    private applyDiagnosticStyles(): void {
        if (this.diagnostics.length === 0) {
            this.vscodeLog('DiagnosticVisualizer: No diagnostics to apply');
            return;
        }

        // Try to find the active editor element
        let editor = document.querySelector('.vditor-ir .vditor-reset'); // IR mode
        if (!editor) {
            editor = document.querySelector('.vditor-wysiwyg .vditor-reset'); // WYSIWYG mode
        }
        if (!editor) {
            editor = document.querySelector('.vditor-sv .vditor-reset'); // Source mode
        }
        if (!editor) {
            console.warn('DiagnosticVisualizer: Could not find Vditor editor element');
            return;
        }

        this.vscodeLog(`DiagnosticVisualizer: Applying ${this.diagnostics.length} diagnostics to editor`);
        
        let successCount = 0;
        const failedDiagnostics: any[] = [];

        // Process each diagnostic and track results
        this.diagnostics.forEach((diagnostic, index) => {
            this.vscodeLog(`\n=== Processing Diagnostic ${index + 1}/${this.diagnostics.length} ===`);
            this.vscodeLog(`Message: ${diagnostic.message}`);
            this.vscodeLog(`Source: ${diagnostic.source}`);
            console.log(`Line: ${diagnostic.range?.start?.line}`);
            console.log(`Line Text: "${diagnostic.lineText}"`);
            
            const success = this.applyDiagnosticByContentMatch(editor as HTMLElement, diagnostic);
            
            if (success) {
                successCount++;
                this.vscodeLog(`✅ Diagnostic ${index + 1} applied successfully`);
            } else {
                failedDiagnostics.push({
                    index: index + 1,
                    message: diagnostic.message,
                    source: diagnostic.source,
                    line: diagnostic.range?.start?.line
                });
                console.error(`❌ Diagnostic ${index + 1} failed to apply`);
            }
        });

        // Summary logging
        console.log(`\n=== DIAGNOSTIC APPLICATION SUMMARY ===`);
        console.log(`Total diagnostics: ${this.diagnostics.length}`);
        console.log(`Successfully applied: ${successCount}`);
        console.log(`Failed to apply: ${failedDiagnostics.length}`);
        
        if (failedDiagnostics.length > 0) {
            console.log(`Failed diagnostics:`, failedDiagnostics);
        }
    }

    /**
     * Apply diagnostic by finding matching content in the DOM
     */
    private applyDiagnosticByContentMatch(editor: HTMLElement, diagnostic: any): boolean {
        const message = diagnostic.message || '';
        const matchedText = diagnostic.matchedText || '';
        const source = diagnostic.source || '';
        
        console.log(`Applying diagnostic: ${message}, source: ${source}, matchedText: "${matchedText}"`);
        
        // Try specialized matching for specific diagnostic types first
        let handled = false;
        
        // For broken links, search by the URL in href attributes
        if (message.includes('Potentially broken link:')) {
            handled = this.handleBrokenLinkDiagnostic(editor, diagnostic, message);
        }
        
        // For images missing alt text, search for img tags without alt
        else if (message.includes('Image missing alt text')) {
            handled = this.handleImageAltDiagnostic(editor, diagnostic);
        }
        
        // For MD012: Multiple consecutive blank lines
        else if (message.includes('Multiple consecutive blank lines') || (source === 'markdownlint' && message.includes('MD012'))) {
            handled = this.handleMD012Diagnostic(editor, diagnostic);
        }
        
        // For any other diagnostic (including external ones like markdownlint), use generic matching
        if (!handled) {
            console.log(`Using generic diagnostic matching for: ${message}`);
            handled = this.handleGenericDiagnostic(editor, diagnostic);
        }
        
        if (!handled) {
            console.warn(`Could not match diagnostic: ${message}`);
        }
        
        return handled;
    }

    /**
     * Handle broken link diagnostics specifically
     */
    private handleBrokenLinkDiagnostic(editor: HTMLElement, diagnostic: any, message: string): boolean {
        const urlMatch = message.match(/Potentially broken link: (.+)/);
        const brokenUrl = urlMatch ? urlMatch[1] : '';
        
        if (brokenUrl) {
            console.log(`Searching for broken URL: "${brokenUrl}"`);
            const links = editor.querySelectorAll('a');
            console.log(`Found ${links.length} links in DOM`);
            
            let found = false;
            links.forEach((link, index) => {
                const href = link.getAttribute('href') || '';
                console.log(`Link ${index}: href="${href}"`);
                
                // Try multiple matching strategies
                const isExactMatch = href === brokenUrl;
                const isPartialMatch = href.includes(brokenUrl) || brokenUrl.includes(href);
                const isNormalizedMatch = this.normalizeUrl(href) === this.normalizeUrl(brokenUrl);
                
                if (isExactMatch || isPartialMatch || isNormalizedMatch) {
                    console.log(`Found matching broken link (exact: ${isExactMatch}, partial: ${isPartialMatch}, normalized: ${isNormalizedMatch}):`, link);
                    this.applyDiagnosticStyleToElement(link as HTMLElement, diagnostic);
                    found = true;
                }
            });
            
            if (found) return true;
            
            // Also try searching in raw text for markdown that hasn't been fully rendered
            console.log('Link not found in DOM, searching in text content...');
            const textFound = this.findExactTextMatch(editor, brokenUrl, diagnostic);
            if (textFound) return true;
        }
        
        return false;
    }

    /**
     * Handle image alt text diagnostics specifically
     */
    private handleImageAltDiagnostic(editor: HTMLElement, diagnostic: any): boolean {
        console.log('Searching for images missing alt text');
        const images = editor.querySelectorAll('img');
        console.log(`Found ${images.length} images in DOM`);
        
        let found = false;
        images.forEach((img, index) => {
            const alt = img.getAttribute('alt') || '';
            console.log(`Image ${index}: alt="${alt}"`);
            if (!alt.trim()) {
                console.log(`Found image without alt text:`, img);
                this.applyDiagnosticStyleToElement(img as HTMLElement, diagnostic);
                found = true;
            }
        });
        
        return found;
    }

    /**
     * Handle MD012 diagnostics - Multiple consecutive blank lines
     */
    private handleMD012Diagnostic(editor: HTMLElement, diagnostic: any): boolean {
        this.vscodeLog('DiagnosticVisualizer: Handling MD012 - Multiple consecutive blank lines');
        
        const lineNumber = diagnostic.range?.start?.line;
        if (lineNumber === undefined) {
            this.vscodeLog('MD012: No line number provided');
            return false;
        }
        
        this.vscodeLog(`MD012: Looking for multiple blank lines around line ${lineNumber}`);
        
        // For MD012, we need to find the area where multiple blank lines occur
        // This is tricky in WYSIWYG mode because blank lines may not have direct DOM representation
        
        // Strategy 1: Look for paragraph elements that might represent the blank lines
        const allElements = editor.querySelectorAll('p, div, br');
        const targetElements: HTMLElement[] = [];
        
        // Find consecutive empty paragraph elements or areas with multiple br tags
        let consecutiveEmptyCount = 0;
        let lastEmptyElement: HTMLElement | null = null;
        
        allElements.forEach((element) => {
            const el = element as HTMLElement;
            const isEmpty = this.isEmptyElement(el);
            
            if (isEmpty) {
                consecutiveEmptyCount++;
                if (consecutiveEmptyCount >= 2) {
                    // Found multiple consecutive empty elements
                    if (lastEmptyElement) {
                        targetElements.push(lastEmptyElement);
                    }
                    targetElements.push(el);
                }
                lastEmptyElement = el;
            } else {
                consecutiveEmptyCount = 0;
                lastEmptyElement = null;
            }
        });
        
        // If we found target elements, apply the diagnostic style
        if (targetElements.length > 0) {
            this.vscodeLog(`MD012: Found ${targetElements.length} elements representing multiple blank lines`);
            targetElements.forEach((element) => {
                this.applyDiagnosticStyleToElement(element, diagnostic);
            });
            return true;
        }
        
        // Strategy 2: If no specific elements found, look for areas with high br density
        const brElements = editor.querySelectorAll('br');
        let consecutiveBrs: HTMLElement[] = [];
        
        for (let i = 0; i < brElements.length - 1; i++) {
            const br1 = brElements[i] as HTMLElement;
            const br2 = brElements[i + 1] as HTMLElement;
            
            // Check if br elements are close to each other (indicating consecutive blank lines)
            if (this.areElementsConsecutive(br1, br2)) {
                if (consecutiveBrs.length === 0) {
                    consecutiveBrs.push(br1);
                }
                consecutiveBrs.push(br2);
            } else {
                if (consecutiveBrs.length >= 2) {
                    // Found multiple consecutive br elements
                    consecutiveBrs.forEach((br) => {
                        this.applyDiagnosticStyleToElement(br, diagnostic);
                    });
                    this.vscodeLog(`MD012: Applied diagnostic to ${consecutiveBrs.length} consecutive br elements`);
                    return true;
                }
                consecutiveBrs = [];
            }
        }
        
        // Check the last group
        if (consecutiveBrs.length >= 2) {
            consecutiveBrs.forEach((br) => {
                this.applyDiagnosticStyleToElement(br, diagnostic);
            });
            this.vscodeLog(`MD012: Applied diagnostic to ${consecutiveBrs.length} consecutive br elements (final group)`);
            return true;
        }
        
        // Strategy 3: Fallback - apply to a nearby element using line mapping
        this.vscodeLog('MD012: Using fallback line mapping approach');
        return this.findElementByLineMapping(editor, diagnostic);
    }
    
    /**
     * Check if an element is considered empty (for MD012 detection)
     */
    private isEmptyElement(element: HTMLElement): boolean {
        const tagName = element.tagName.toLowerCase();
        
        // br elements are always considered empty
        if (tagName === 'br') return true;
        
        // For p and div elements, check if they're empty or only contain whitespace/br
        if (tagName === 'p' || tagName === 'div') {
            const text = element.textContent?.trim() || '';
            if (text === '') {
                // Element is empty or only contains br elements
                const brCount = element.querySelectorAll('br').length;
                const childCount = element.children.length;
                return childCount === 0 || childCount === brCount;
            }
        }
        
        return false;
    }
    
    /**
     * Check if two elements are consecutive in the DOM (for MD012 detection)
     */
    private areElementsConsecutive(el1: HTMLElement, el2: HTMLElement): boolean {
        // Simple check - see if el2 is the next sibling or very close
        let sibling = el1.nextSibling;
        let stepsToFind = 0;
        const maxSteps = 3; // Allow for some whitespace/text nodes in between
        
        while (sibling && stepsToFind < maxSteps) {
            if (sibling === el2) return true;
            sibling = sibling.nextSibling;
            stepsToFind++;
        }
        
        return false;
    }

    /**
     * Handle generic diagnostics from external sources (like markdownlint)
     */
    private handleGenericDiagnostic(editor: HTMLElement, diagnostic: any): boolean {
        const message = diagnostic.message || '';
        const range = diagnostic.range;
        const source = diagnostic.source || 'unknown';
        const lineText = diagnostic.lineText || '';
        
        console.log('DiagnosticVisualizer: Handling generic diagnostic:', {
            message,
            source,
            range,
            lineText,
            severity: diagnostic.severity
        });
        
        // Strategy 1: Try precise line mapping using document structure
        if (range && typeof range.start?.line === 'number') {
            console.log(`Trying to find element for line ${range.start.line} with text: "${lineText}"`);
            
            const found = this.findElementByLineMapping(editor, diagnostic);
            if (found) {
                console.log(`Successfully mapped diagnostic to element via line mapping`);
                return true;
            }
        }
        
        // Strategy 2: Search for specific text patterns in the line
        if (lineText && lineText.trim()) {
            console.log(`Searching for line text: "${lineText.trim()}"`);
            const found = this.findElementByTextContent(editor, lineText.trim(), diagnostic);
            if (found) {
                console.log(`Successfully found element by text content`);
                return true;
            }
        }
        
        // Strategy 3: Handle specific diagnostic patterns
        if (this.handleSpecificPatterns(editor, diagnostic)) {
            console.log(`Successfully handled via specific pattern matching`);
            return true;
        }
        
        // Strategy 4: Apply to editor root as fallback
        console.log('No specific element found, applying diagnostic to editor root as fallback');
        this.applyDiagnosticStyleToElement(editor, diagnostic);
        return true;
    }

    /**
     * Map VS Code line numbers to DOM elements more precisely
     */
    private findElementByLineMapping(editor: HTMLElement, diagnostic: any): boolean {
        const lineNumber = diagnostic.range.start.line;
        const lineText = diagnostic.lineText || '';
        
        console.log(`Mapping line ${lineNumber} to DOM element, line text: "${lineText}"`);
        
        // Get all block-level elements that could correspond to markdown lines
        const blockElements = this.getBlockElements(editor);
        
        console.log(`Found ${blockElements.length} block elements in editor`);
        
        // Try direct line-to-element mapping
        if (lineNumber < blockElements.length) {
            const targetElement = blockElements[lineNumber];
            
            // Verify this element contains similar content to the diagnostic line
            if (this.elementsMatch(targetElement, lineText, diagnostic)) {
                console.log(`Direct line mapping successful for line ${lineNumber}:`, targetElement);
                this.applyDiagnosticStyleToElement(targetElement, diagnostic);
                return true;
            }
        }
        
        // Try to find element by content matching if direct mapping fails
        for (let i = 0; i < blockElements.length; i++) {
            if (this.elementsMatch(blockElements[i], lineText, diagnostic)) {
                console.log(`Content matching successful at index ${i} for line ${lineNumber}:`, blockElements[i]);
                this.applyDiagnosticStyleToElement(blockElements[i], diagnostic);
                return true;
            }
        }
        
        return false;
    }

    /**
     * Get all block-level elements that correspond to markdown lines
     */
    private getBlockElements(editor: HTMLElement): HTMLElement[] {
        const blockSelectors = [
            'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
            'div', 'blockquote', 'pre', 'ul', 'ol', 'li',
            'table', 'tr', 'td', 'th'
        ];
        
        const elements: HTMLElement[] = [];
        
        // Get direct children first (most likely to match lines)
        Array.from(editor.children).forEach(child => {
            if (child instanceof HTMLElement) {
                elements.push(child);
            }
        });
        
        // If we don't have enough elements, get nested block elements
        if (elements.length === 0) {
            blockSelectors.forEach(selector => {
                const found = editor.querySelectorAll(selector);
                found.forEach(el => {
                    if (el instanceof HTMLElement && !elements.includes(el)) {
                        elements.push(el);
                    }
                });
            });
        }
        
        console.log(`Block elements found:`, elements.map((el, i) => ({
            index: i,
            tagName: el.tagName,
            textContent: el.textContent?.substring(0, 50) + '...',
            className: el.className
        })));
        
        return elements;
    }

    /**
     * Check if an element matches the diagnostic line content
     */
    private elementsMatch(element: HTMLElement, lineText: string, diagnostic: any): boolean {
        if (!lineText.trim()) return false;
        
        const elementText = element.textContent || '';
        const elementTextTrimmed = elementText.trim();
        const lineTextTrimmed = lineText.trim();
        
        console.log(`Comparing element text: "${elementTextTrimmed.substring(0, 50)}..." with line text: "${lineTextTrimmed}"`);
        
        // Direct match
        if (elementTextTrimmed === lineTextTrimmed) {
            console.log('Exact text match found');
            return true;
        }
        
        // Element contains the line text
        if (elementTextTrimmed.includes(lineTextTrimmed)) {
            console.log('Element contains line text');
            return true;
        }
        
        // Line text contains element text (for short elements)
        if (lineTextTrimmed.includes(elementTextTrimmed) && elementTextTrimmed.length > 3) {
            console.log('Line text contains element text');
            return true;
        }
        
        // For markdownlint MD041 (first line should be heading), match first non-empty element
        if (diagnostic.message?.includes('First line') && diagnostic.message?.includes('heading')) {
            // Check if this is the first significant element
            const parent = element.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children);
                const significantElements = siblings.filter(el => el.textContent?.trim().length > 0);
                if (significantElements[0] === element) {
                    console.log('First significant element match for MD041');
                    return true;
                }
            }
        }
        
        return false;
    }

    /**
     * Find element by searching text content
     */
    private findElementByTextContent(editor: HTMLElement, searchText: string, diagnostic: any): boolean {
        console.log(`Searching for text content: "${searchText}"`);
        
        const walker = document.createTreeWalker(
            editor,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    return node instanceof HTMLElement && 
                           node.textContent?.trim().includes(searchText.trim()) ? 
                           NodeFilter.FILTER_ACCEPT : 
                           NodeFilter.FILTER_SKIP;
                }
            }
        );

        let node;
        let found = false;
        while ((node = walker.nextNode()) !== null) {
            if (node instanceof HTMLElement) {
                console.log(`Found matching element:`, {
                    tagName: node.tagName,
                    textContent: node.textContent?.substring(0, 50) + '...',
                    matches: searchText
                });
                
                this.applyDiagnosticStyleToElement(node, diagnostic);
                found = true;
                break; // Apply to first match only
            }
        }
        
        return found;
    }

    /**
     * Handle specific diagnostic patterns
     */
    private handleSpecificPatterns(editor: HTMLElement, diagnostic: any): boolean {
        const message = diagnostic.message || '';
        
        // MD041: First line should be heading
        if (message.includes('MD041') || (message.includes('First line') && message.includes('heading'))) {
            console.log('Handling MD041 diagnostic - first line should be heading');
            const firstChild = editor.firstElementChild;
            if (firstChild instanceof HTMLElement) {
                this.applyDiagnosticStyleToElement(firstChild, diagnostic);
                return true;
            }
        }
        
        // MD047: Files should end with newline
        if (message.includes('MD047') || message.includes('newline')) {
            console.log('Handling MD047 diagnostic - missing trailing newline');
            const lastChild = editor.lastElementChild;
            if (lastChild instanceof HTMLElement) {
                this.applyDiagnosticStyleToElement(lastChild, diagnostic);
                return true;
            }
        }
        
        // Extract quoted text or code from message
        const patterns = this.extractPatternsFromMessage(message);
        for (const pattern of patterns) {
            const found = this.findElementByTextContent(editor, pattern, diagnostic);
            if (found) return true;
        }
        
        return false;
    }

    /**
     * Extract searchable patterns from diagnostic messages
     */
    private extractPatternsFromMessage(message: string): string[] {
        const patterns: string[] = [];
        
        // Extract quoted text
        const quotedText = message.match(/'([^']*)'/g);
        if (quotedText) {
            patterns.push(...quotedText.map(q => q.slice(1, -1))); // Remove quotes
        }
        
        // Extract text in backticks
        const backtickText = message.match(/`([^`]*)`/g);
        if (backtickText) {
            patterns.push(...backtickText.map(b => b.slice(1, -1))); // Remove backticks
        }
        
        return patterns;
    }

    /**
     * Find exact text matches in the DOM
     */
    private findExactTextMatch(editor: HTMLElement, searchText: string, diagnostic: any): boolean {
        console.log(`Searching for exact text: "${searchText}"`);
        
        const walker = document.createTreeWalker(
            editor,
            NodeFilter.SHOW_TEXT,
            null
        );

        let node;
        let found = false;
        while ((node = walker.nextNode()) !== null) {
            const text = node.textContent || '';
            if (text.includes(searchText)) {
                console.log(`Found text "${searchText}" in node:`, node);
                const parent = node.parentElement;
                if (parent) {
                    console.log(`Applying diagnostic to parent element:`, parent);
                    this.applyDiagnosticStyleToElement(parent, diagnostic);
                    found = true;
                    // Don't return here - we might want to highlight multiple matches
                }
            }
        }
        
        if (!found) {
            console.warn(`Text "${searchText}" not found in DOM`);
        }
        
        return found;
    }

    /**
     * Apply diagnostic style to a specific element
     */
    private applyDiagnosticStyleToElement(element: HTMLElement, diagnostic: any): void {
        const severity = this.getDiagnosticSeverityString(diagnostic.severity);
        const cssClass = `vscode-diagnostic-${severity}`;
        
        // Apply the diagnostic CSS class
        element.classList.add(cssClass);
        
        // Add diagnostic message as data attribute for CSS content
        const message = diagnostic.message || 'Diagnostic issue';
        element.setAttribute('data-diagnostic-message', message);
        
        console.log(`Applied ${cssClass} to element with message: "${message}"`);
    }

    /**
     * Convert VS Code diagnostic severity to string
     */
    private getDiagnosticSeverityString(severity: number): string {
        switch (severity) {
            case 1: return 'error';
            case 2: return 'warning';
            case 3: return 'information';
            case 4: return 'hint';
            default: return 'information';
        }
    }

    /**
     * Normalize URL for better matching
     */
    private normalizeUrl(url: string): string {
        return url?.trim().toLowerCase() || '';
    }

    /**
     * Update diagnostic visualizations from external source (VS Code extension)
     */
    public updateDiagnostics(diagnostics: any[], context?: { documentText?: string; documentLines?: number }): void {
        console.log(`DiagnosticVisualizer: Received ${diagnostics.length} diagnostics from VS Code extension with context:`, {
            diagnosticCount: diagnostics.length,
            hasDocumentText: !!context?.documentText,
            documentLines: context?.documentLines
        });
        
        // Log all diagnostics for debugging
        diagnostics.forEach((diag, index) => {
            console.log(`DiagnosticVisualizer: Processing diagnostic ${index}:`, {
                message: diag.message,
                source: diag.source,
                severity: diag.severity,
                line: diag.range?.start?.line,
                lineText: diag.lineText,
                code: diag.code
            });
        });
        
        this.diagnostics = diagnostics;
        this.scheduleUpdate();
    }

    /**
     * Update diagnostic visualizations from external source
     */
    public updateFromExtension(diagnostics: any[]): void {
        console.log(`DiagnosticVisualizer: Received ${diagnostics.length} diagnostics from extension:`, diagnostics);
        this.scheduleUpdate();
    }

    /**
     * Simple pattern matching for broken links and images without alt text
     */
    public addSimpleDiagnostics(): void {
        const content = this.vditor?.getValue() || '';
        console.log(`DiagnosticVisualizer: Checking content for simple diagnostics, length: ${content.length}`);
        
        // Only update if content changed to prevent unnecessary updates
        if (content === this.lastContent) {
            console.log('Content unchanged, skipping diagnostic update');
            return;
        }
        this.lastContent = content;
        
        const lines = content.split('\n');
        const simpleDiagnostics: any[] = [];

        lines.forEach((line, index) => {
            // Check for broken links (simple heuristic)
            const linkRegex = /\[([^\]]*)\]\(([^)]*)\)/g;
            let linkMatch;
            while ((linkMatch = linkRegex.exec(line)) !== null) {
                const url = linkMatch[2] || '';
                const fullMatch = linkMatch[0]; // Store the full markdown link text
                console.log(`Found link: "${fullMatch}" with URL: "${url}"`);
                
                if (url && !this.isValidUrl(url)) {
                    console.log(`Adding diagnostic for broken link: ${url}`);
                    simpleDiagnostics.push({
                        message: `Potentially broken link: ${url}`,
                        severity: 2, // Warning
                        matchedText: fullMatch, // Add the full markdown text for matching
                        range: {
                            start: { line: index, character: linkMatch.index },
                            end: { line: index, character: linkMatch.index + linkMatch[0].length }
                        }
                    });
                }
            }

            // Check for images without alt text
            const imageRegex = /!\[([^\]]*)\]\(([^)]*)\)/g;
            let imageMatch;
            while ((imageMatch = imageRegex.exec(line)) !== null) {
                const altText = imageMatch[1] || '';
                const fullMatch = imageMatch[0]; // Store the full markdown image text
                console.log(`Found image: "${fullMatch}" with alt: "${altText}"`);
                
                if (!altText.trim()) {
                    console.log(`Adding diagnostic for image missing alt text`);
                    simpleDiagnostics.push({
                        message: 'Image missing alt text for accessibility',
                        severity: 3, // Information
                        matchedText: fullMatch, // Add the full markdown text for matching
                        range: {
                            start: { line: index, character: imageMatch.index },
                            end: { line: index, character: imageMatch.index + imageMatch[0].length }
                        }
                    });
                }
            }
        });

        console.log(`DiagnosticVisualizer: Generated ${simpleDiagnostics.length} simple diagnostics:`, simpleDiagnostics);
        this.applyDiagnosticsToEditor(simpleDiagnostics);
    }

    /**
     * Simple URL validation
     */
    private isValidUrl(url: string): boolean {
        if (!url || url.trim() === '') {
            console.log(`URL "${url}" is invalid (empty)`);
            return false;
        }
        
        // Allow relative paths and anchors
        if (url.startsWith('#') || url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) {
            console.log(`URL "${url}" is considered valid (relative/anchor)`);
            return true;
        }
        
        // Check for common file extensions that might exist
        const commonExtensions = ['.md', '.txt', '.html', '.htm', '.pdf', '.doc', '.docx'];
        if (commonExtensions.some(ext => url.toLowerCase().includes(ext))) {
            // Only mark as valid if it looks like a real relative path
            if (!url.includes('://')) {
                console.log(`URL "${url}" might be broken (file extension without protocol)`);
                return false;
            }
        }
        
        // Basic URL format check
        try {
            new URL(url);
            console.log(`URL "${url}" is considered valid (valid URL format)`);
            return true;
        } catch {
            console.log(`URL "${url}" is invalid (malformed URL)`);
            return false;
        }
    }
}