import { getRenderedLineElements, type DomLikeElement } from "./diff-line-dom-mapper";

/** Matches trusted diagnostics to rendered anchors and owns overlap/range tracking. */
export class DiagnosticMatcher {

  // Track applied diagnostics by element and character range to prevent overlaps
  private appliedDiagnostics: Map<
    HTMLElement,
    Array<{
      startChar: number;
      endChar: number;
      lineNumber: number;
      diagnosticId: string;
    }>
  > = new Map();
  // Track elements by line number for efficient range checking
  private elementsByLine: Map<number, HTMLElement[]> = new Map();

  constructor(
    private readonly wrapTextWithDiagnostic: (node: Text, start: number, end: number, diagnostic: any) => boolean,
    private readonly onSkippedDiagnostics: () => void,
  ) {}

  get appliedElementCount(): number { return this.appliedDiagnostics.size; }

  clearTracking(): void {
    this.appliedDiagnostics.clear();
    this.elementsByLine.clear();
  }

  /**
   * Efficient single-pass diagnostic application
   * Sorts diagnostics by line number and matches them during a single DOM traversal
   * Now with cursor-aware element exclusion
   */
  public apply(
    editor: HTMLElement,
    diagnostics: any[],
    cursorElement?: Element | null
  ): void {
    const sortedDiagnostics = this.prepareSortedDiagnostics(diagnostics);
    if (sortedDiagnostics.length === 0) {
      return;
    }

    // PRIMARY: route each diagnostic to its source line's rendered element using
    // the same line→DOM mapping that drives the line-number gutter and diff view.
    // This prevents same-word collisions: 10 spelling errors on 10 lines all land
    // on their own line instead of stacking on the first occurrence found by text search.
    const lineToElement = this.buildLineAnchorMap(editor, cursorElement);
    const unmatched = this.applyDiagnosticsByLineAnchor(
      lineToElement,
      sortedDiagnostics
    );

    if (unmatched.length === 0) {
      return;
    }

    // FALLBACK: when a diagnostic's source line has no rendered anchor (e.g. inside
    // a code block or a multi-source-line paragraph), fall through to content-based
    // matching across all block elements.
    const blockElements = this.getMarkdownBlockElements(editor);
    const safeElements = cursorElement
      ? blockElements.filter(
          (item) =>
            item.element !== cursorElement &&
            !isDescendantOf(item.element, cursorElement) &&
            !isDescendantOf(cursorElement, item.element)
        )
      : blockElements;

    if (cursorElement && safeElements.length < blockElements.length) {
      this.onSkippedDiagnostics();
    }

    this.matchDiagnosticsToElements(safeElements, unmatched);
  }

  /**
   * Build an authoritative source-line → rendered-element map using the same
   * traversal as the line-number renderer and diff visualizer. Cursor element
   * is excluded so typing isn't disrupted.
   */
  private buildLineAnchorMap(
    editor: HTMLElement,
    cursorElement?: Element | null
  ): Map<number, HTMLElement> {
    const map = new Map<number, HTMLElement>();
    let lineElements: HTMLElement[];
    try {
      lineElements = getRenderedLineElements(
        editor as unknown as DomLikeElement
      ) as HTMLElement[];
    } catch {
      return map;
    }

    lineElements.forEach((element, index) => {
      if (
        cursorElement &&
        (element === cursorElement ||
          isDescendantOf(element, cursorElement) ||
          isDescendantOf(cursorElement, element))
      ) {
        this.onSkippedDiagnostics();
        return;
      }
      map.set(index, element);
    });

    return map;
  }

  /**
   * Apply diagnostics by direct line-anchor lookup. Returns diagnostics that
   * could not be routed (line index missing from the map) so the caller can
   * fall back to fuzzy matching.
   */
  private applyDiagnosticsByLineAnchor(
    lineToElement: Map<number, HTMLElement>,
    sortedDiagnostics: Array<{
      diagnostic: any;
      lineNumber: number;
      lineText: string;
    }>
  ): Array<{ diagnostic: any; lineNumber: number; lineText: string }> {
    const unmatched: Array<{
      diagnostic: any;
      lineNumber: number;
      lineText: string;
    }> = [];

    for (const entry of sortedDiagnostics) {
      const { diagnostic, lineNumber, lineText } = entry;
      const targetElement = lineToElement.get(lineNumber);

      if (!targetElement) {
        unmatched.push(entry);
        continue;
      }

      const range = diagnostic.range;
      const startChar = range?.start?.character ?? 0;
      const endChar = range?.end?.character ?? startChar + 1;
      const targetText = lineText.substring(startChar, endChar);

      if (!targetText.trim()) {
        continue;
      }

      if (
        this.isDiagnosticAlreadyApplied(
          diagnostic,
          lineNumber,
          startChar,
          endChar
        )
      ) {
        continue;
      }

      if (
        this.hasOverlappingDiagnostic(
          targetElement,
          startChar,
          endChar,
          lineNumber,
          diagnostic
        )
      ) {
        continue;
      }

      const matchResult = {
        matched: true,
        confidence: 1000,
        matchType: "line-anchor-match",
        targetText,
        charRange: { start: startChar, end: endChar },
      };

      const applied = this.applyDiagnosticToMatchedElement(
        targetElement,
        diagnostic,
        matchResult
      );

      // If the target text isn't present in the resolved element (e.g. rendered
      // markdown stripped a marker), fall back to fuzzy matching for this one.
      if (!applied) {
        unmatched.push(entry);
      }
    }

    return unmatched;
  }

  /**
   * Check if diagnostic is high confidence (specific patterns we trust)
   */
  private isHighConfidenceDiagnostic(diagnostic: any): boolean {
    const message = diagnostic.message?.toLowerCase() || "";
    const source = diagnostic.source || "";
    const range = diagnostic.range;

    // High-confidence diagnostic sources
    const trustedSources = [
      "markdownlint",
      "markdown-link-check",
      "textlint",
      "remark-lint",
      "cspell", // Spelling checker
      "spell-checker", // Alternative spelling checker
      "spell", // Generic spell checker
      "grammar", // Grammar checkers
      "languagetool", // Language tool
    ];

    // Check if source is trusted
    const isTrustedSource = trustedSources.some((pattern) =>
      source.toLowerCase().includes(pattern.toLowerCase())
    );

    if (!isTrustedSource) {
      return false;
    }

    // Additional validation for diagnostics with valid range information
    if (range && range.start && range.end) {
      const hasValidRange =
        typeof range.start.line === "number" &&
        typeof range.start.character === "number" &&
        typeof range.end.line === "number" &&
        typeof range.end.character === "number";

      if (!hasValidRange) {
        return false;
      }
    }

    // Spelling/grammar errors - high confidence with range info
    if (
      source.toLowerCase().includes("spell") ||
      source.toLowerCase().includes("cspell")
    ) {
      const hasSpellingPatterns =
        message.includes("misspelled") ||
        message.includes("unknown word") ||
        message.includes("not found") ||
        message.includes("spelling");

      if (hasSpellingPatterns && range) {
        return true;
      }
    }

    // Markdownlint diagnostics - high confidence
    if (source.toLowerCase().includes("markdownlint")) {
      return true;
    }

    // Grammar and style checkers
    if (
      source.toLowerCase().includes("grammar") ||
      source.toLowerCase().includes("languagetool")
    ) {
      return true;
    }

    // Link and reference checkers
    if (
      source.toLowerCase().includes("link-check") ||
      message.includes("broken") ||
      message.includes("missing")
    ) {
      return true;
    }

    // Default: If we have a trusted source but didn't match specific patterns, still allow it
    return true;
  }

  /**
   * Prepare and sort diagnostics by line number for efficient processing
   */
  private prepareSortedDiagnostics(diagnostics: any[]): Array<{
    diagnostic: any;
    lineNumber: number;
    lineText: string;
  }> {
    const validDiagnostics: Array<{
      diagnostic: any;
      lineNumber: number;
      lineText: string;
    }> = [];

    // Group exact source tokens before overlap suppression; keep the first
    // diagnostic as the matching/severity representative.
    const groups = new Map<string, any>();
    const seen = new Set<string>();

    for (const diagnostic of diagnostics) {
      // Only include diagnostics with valid line information
      const lineNumber = diagnostic.range?.start?.line;
      const lineText = diagnostic.lineText || "";

      if (lineNumber !== undefined && lineText.trim()) {
        // Filter to only high-confidence diagnostics to avoid false positives
        if (this.isHighConfidenceDiagnostic(diagnostic)) {
          const tokenKey = JSON.stringify([diagnostic.range.start, diagnostic.range.end, lineText]);
          const key = JSON.stringify([tokenKey, diagnostic.source, diagnostic.message, diagnostic.code]);
          if (seen.has(key)) continue;
          seen.add(key);
          const group = groups.get(tokenKey);
          if (group) {
            group.tokenDiagnostics.push(diagnostic);
          } else {
            const grouped = { ...diagnostic, tokenDiagnostics: [diagnostic] };
            groups.set(tokenKey, grouped);
            validDiagnostics.push({
              diagnostic: grouped,
              lineNumber,
              lineText: lineText.trim(),
            });
          }
        }
      }
    }

    // Sort by line number for efficient processing
    validDiagnostics.sort((a, b) => a.lineNumber - b.lineNumber);

    return validDiagnostics;
  }

  /**
   * Approximate content-search candidates for diagnostic fallback only.
   * This may contain parent and child blocks; never use it as a diff line map.
   * Diff targeting uses getRenderedLineElements and shared renderedLineRules.
   */
  private getMarkdownBlockElements(
    editor: HTMLElement
  ): Array<{ element: HTMLElement; index: number }> {
    const blockElements: Array<{ element: HTMLElement; index: number }> = [];

    // Selectors for block elements that typically represent markdown lines
    const blockSelectors = [
      "p", // Paragraphs
      "h1, h2, h3, h4, h5, h6", // Headings
      "li", // List items
      "blockquote", // Block quotes
      "pre", // Code blocks
      "div.vditor-ir__node", // Vditor IR nodes
      "div.vditor-ir__marker", // Vditor IR markers
    ];

    let index = 0;
    for (const selector of blockSelectors) {
      const elements = Array.from(editor.querySelectorAll(selector));
      for (const element of elements) {
        const htmlElement = element as HTMLElement;
        const text = htmlElement.textContent || "";

        // Only include elements with meaningful text content
        if (text.trim().length > 0) {
          blockElements.push({
            element: htmlElement,
            index: index++,
          });
        }
      }
    }

    // Sort by DOM position to maintain document order
    blockElements.sort((a, b) => {
      const position = a.element.compareDocumentPosition(b.element);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
        return -1; // a comes before b
      } else if (position & Node.DOCUMENT_POSITION_PRECEDING) {
        return 1; // a comes after b
      }
      return 0; // same position
    });

    // Update indices after sorting
    blockElements.forEach((item, idx) => {
      item.index = idx;
    });

    return blockElements;
  }

  /**
   * Check if target text appears as a complete word (not part of another word)
   */
  private isCompleteWord(
    text: string,
    targetText: string,
    startIndex: number
  ): boolean {
    const beforeChar = startIndex > 0 ? text[startIndex - 1] : " ";
    const afterIndex = startIndex + targetText.length;
    const afterChar = afterIndex < text.length ? text[afterIndex] : " ";

    // Word boundary characters (whitespace, punctuation)
    const wordBoundary = /[\s\W]/;

    return wordBoundary.test(beforeChar) && wordBoundary.test(afterChar);
  }

  /**
   * Check if element text closely matches the expected line text
   */
  private isExactLineMatch(elementText: string, lineText: string): boolean {
    const cleanElement = elementText.trim().replace(/\s+/g, " ");
    const cleanLine = lineText.trim().replace(/\s+/g, " ");
    return cleanElement === cleanLine;
  }

  /**
   * Match diagnostics to DOM elements using content-based matching
   */
  private matchDiagnosticsToElements(
    blockElements: Array<{ element: HTMLElement; index: number }>,
    sortedDiagnostics: Array<{
      diagnostic: any;
      lineNumber: number;
      lineText: string;
    }>
  ): void {

    // Strategy: For each diagnostic, find the element that contains its target text
    for (const { diagnostic, lineNumber, lineText } of sortedDiagnostics) {
      const range = diagnostic.range;
      const startChar = range?.start?.character || 0;
      const endChar = range?.end?.character || startChar + 1;
      const targetText = lineText.substring(startChar, endChar);

      if (!targetText.trim()) {
        continue;
      }

      // Validate that the target text actually appears in the line at the expected position
      if (lineText.substring(startChar, endChar) !== targetText) {
        continue;
      }

      // CRITICAL: Check if this exact diagnostic has already been applied anywhere
      // This replaces the old wrappedKeys check and prevents duplicate application
      if (
        this.isDiagnosticAlreadyApplied(
          diagnostic,
          lineNumber,
          startChar,
          endChar
        )
      ) {
        continue;
      }

      let bestMatch: {
        element: HTMLElement;
        index: number;
        confidence: number;
        matchType: string;
      } | null = null;

      // Find elements that contain the target text with word boundary validation
      for (let i = 0; i < blockElements.length; i++) {
        const { element, index } = blockElements[i];
        const elementText = element.textContent || "";

        // Check if element contains the target text
        const targetIndex = elementText.indexOf(targetText);
        if (targetIndex === -1) {
          continue;
        }

        // CRITICAL: Validate word boundaries to prevent partial matches
        if (!this.isCompleteWord(elementText, targetText, targetIndex)) {
          continue;
        }

        // Check if this element already has a diagnostic applied for overlapping ranges
        // Only check for overlaps on the SAME element - different elements can have same char ranges
        if (
          this.hasOverlappingDiagnostic(
            element,
            startChar,
            endChar,
            lineNumber,
            diagnostic
          )
        ) {
          continue;
        }

        let confidence = 0;
        let matchType = "";

        // PRIORITY 1: Exact line text match (highest priority)
        if (this.isExactLineMatch(elementText, lineText)) {
          confidence = 1000; // Very high base score
          matchType = "exact-line-match";
        }
        // PRIORITY 2: Perfect line match (trimmed comparison)
        else if (elementText.trim() === lineText.trim()) {
          confidence = 900; // Very high base score
          matchType = "perfect-line-match";
        }
        // PRIORITY 3: Line contained in element (for multi-line elements)
        else if (elementText.includes(lineText.trim())) {
          confidence = 500; // High base score
          matchType = "line-contained";
        }
        // PRIORITY 4: Target text found with word boundaries (minimum requirement)
        else {
          confidence = 250; // Higher base score to account for proximity penalties
          matchType = "target-text-found";
        }

        // Position-based scoring with line number preference
        const positionDifference = Math.abs(lineNumber - index);

        // More balanced proximity scoring - less harsh penalties
        let proximityBonus = 0;
        if (positionDifference === 0) {
          proximityBonus = 300; // Perfect line number match
        } else if (positionDifference <= 1) {
          proximityBonus = 100; // Very close (±1 line)
        } else if (positionDifference <= 3) {
          proximityBonus = 50; // Reasonably close (±3 lines)
        } else if (positionDifference <= 5) {
          proximityBonus = 20; // Moderately close (±5 lines)
        } else if (positionDifference <= 10) {
          proximityBonus = 0; // Neutral for medium distance
        } else {
          // Gentle penalty for being very far from expected line
          proximityBonus = -Math.min(30, (positionDifference - 10) * 2);
        }

        // BONUS: Extra points for exact line number alignment
        if (index === lineNumber) {
          proximityBonus += 50; // Bonus for exact line number match
        }

        // ADDITIONAL: Character position bonus for multiple occurrences of same word
        // If the same word appears multiple times in the element, prefer the occurrence
        // that's closest to the expected character position within the line
        const expectedCharPos = startChar;
        const targetOccurrences = [];
        let searchPos = 0;
        while (
          (searchPos = elementText.indexOf(targetText, searchPos)) !== -1
        ) {
          targetOccurrences.push(searchPos);
          searchPos += targetText.length;
        }

        let charPositionBonus = 0;
        if (targetOccurrences.length > 1) {
          // Find the occurrence closest to the expected character position
          const bestOccurrence = targetOccurrences.reduce((best, current) => {
            const currentDiff = Math.abs(current - expectedCharPos);
            const bestDiff = Math.abs(best - expectedCharPos);
            return currentDiff < bestDiff ? current : best;
          });

          const charPosDiff = Math.abs(bestOccurrence - expectedCharPos);
          if (charPosDiff <= 5) {
            charPositionBonus = 100; // Very close character position
          } else if (charPosDiff <= 20) {
            charPositionBonus = 25; // Reasonably close
          }
        }

        confidence += proximityBonus + charPositionBonus;

        // Prefer matches with better match types, then higher confidence
        if (
          !bestMatch ||
          confidence > bestMatch.confidence ||
          (confidence === bestMatch.confidence &&
            matchType === "exact-line-match")
        ) {
          bestMatch = { element, index, confidence, matchType };
        }
      }

      // Apply diagnostic if we found a good match - prioritize exact line matches
      // For target-text-found matches, be more lenient since word boundaries are now validated
      const isStrictMatch =
        bestMatch?.matchType === "exact-line-match" ||
        bestMatch?.matchType === "perfect-line-match";
      const isLineContained = bestMatch?.matchType === "line-contained";
      const isReasonableProximity = bestMatch
        ? Math.abs(lineNumber - bestMatch.index) <= 15
        : false;

      // More lenient acceptance criteria since we now have word boundary validation
      if (
        bestMatch &&
        (isStrictMatch ||
          isLineContained ||
          (bestMatch.confidence >= 100 && isReasonableProximity))
      ) {
        const matchResult = {
          matched: true,
          confidence: bestMatch.confidence,
          matchType: bestMatch.matchType,
          targetText: targetText,
          charRange: { start: startChar, end: endChar },
        };

        this.applyDiagnosticToMatchedElement(
          bestMatch.element,
          diagnostic,
          matchResult
        );
      } else {
        // FALLBACK: If we have a word-boundary validated match but it's just below threshold, be more lenient
        if (bestMatch && bestMatch.confidence >= 80) {
          const matchResult = {
            matched: true,
            confidence: bestMatch.confidence,
            matchType: bestMatch.matchType,
            targetText: targetText,
            charRange: { start: startChar, end: endChar },
          };

          this.applyDiagnosticToMatchedElement(
            bestMatch.element,
            diagnostic,
            matchResult
          );
        }
      }
    }
  }

  /**
   * Apply diagnostic styling to a matched element using precise character ranges
   */
  private applyDiagnosticToMatchedElement(
    element: HTMLElement,
    diagnostic: any,
    matchResult: {
      matched: boolean;
      confidence: number;
      matchType: string;
      targetText?: string;
      charRange?: { start: number; end: number };
    }
  ): boolean {
    const range = diagnostic.range;
    const lineText = diagnostic.lineText || "";
    const lineNumber = range?.start?.line;

    if (!range || !lineText.trim()) {
      return false;
    }

    const startChar = range.start?.character || 0;
    const endChar = range.end?.character || startChar + 1;
    const targetText =
      matchResult.targetText || lineText.substring(startChar, endChar).trim();

    if (!targetText) {
      // vscodeLogError(`❌ Cannot apply diagnostic: no target text identified`);
      return false;
    }

    // CRITICAL FIX: Record BEFORE wrapping to prevent within-cycle duplicates
    // During TreeWalker traversal, multiple text nodes with same content would be wrapped
    // before appliedDiagnostics map gets populated. Recording first prevents this.
    this.recordAppliedDiagnostic(
      element,
      startChar,
      endChar,
      lineNumber,
      diagnostic
    );

    // Try to find and wrap the specific target text within the element
    const applied = this.findAndWrapPreciseTextInElement(
      element,
      targetText,
      diagnostic,
      startChar,
      endChar
    );

    if (!applied) {
      // Cleanup: Remove the record since wrapping failed
      this.removeAppliedDiagnostic(
        element,
        startChar,
        endChar,
        lineNumber,
        diagnostic
      );
      // vscodeLogError(`❌ Failed to apply diagnostic: could not locate target text "${targetText}"`);
    }

    return applied;
  }

  /**
   * Find and wrap precise text within an element using character position awareness
   */
  private findAndWrapPreciseTextInElement(
    element: HTMLElement,
    targetText: string,
    diagnostic: any,
    originalStartChar: number,
    originalEndChar: number
  ): boolean {
    const elementText = element.textContent || "";

    // Strategy 1: Direct search for target text
    let targetIndex = elementText.indexOf(targetText);

    // Strategy 2: If multiple occurrences, try to find the right one based on character position
    if (targetIndex !== -1) {
      const allOccurrences: number[] = [];
      let searchIndex = 0;

      // Find all occurrences of the target text
      while (
        (searchIndex = elementText.indexOf(targetText, searchIndex)) !== -1
      ) {
        allOccurrences.push(searchIndex);
        searchIndex += targetText.length;
      }

      if (allOccurrences.length > 1) {
        // Multiple occurrences - try to find the best match based on character position
        targetIndex = this.selectBestOccurrenceByPosition(
          allOccurrences,
          originalStartChar,
          elementText,
          targetText
        );
      }
    }

    // Strategy 3: Case-insensitive search if exact search failed
    if (targetIndex === -1) {
      const lowerElementText = elementText.toLowerCase();
      const lowerTargetText = targetText.toLowerCase();
      targetIndex = lowerElementText.indexOf(lowerTargetText);

      if (targetIndex !== -1) {
        // Update targetText to match the actual case in the element
        targetText = elementText.substring(
          targetIndex,
          targetIndex + targetText.length
        );
      }
    }

    if (targetIndex === -1) {
      // vscodeLogError(`❌ Target text "${targetText}" not found in element text`);
      // Fallback: apply styling to entire element
      // this.addDiagnosticStylingToElement(element, diagnostic);
      return false;
    }

    // Find the text node containing the target text and wrap it
    return this.wrapTextAtPositionInElement(
      element,
      targetIndex,
      targetText.length,
      diagnostic
    );
  }

  /**
   * Select the best occurrence of target text when multiple matches exist
   */
  private selectBestOccurrenceByPosition(
    occurrences: number[],
    originalCharPosition: number,
    elementText: string,
    targetText: string
  ): number {
    // Strategy: Find the occurrence closest to the expected character position
    let bestIndex = occurrences[0];
    let bestDistance = Math.abs(occurrences[0] - originalCharPosition);

    for (const occurrence of occurrences) {
      const distance = Math.abs(occurrence - originalCharPosition);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = occurrence;
      }
    }

    // Additional context-based filtering for common cases
    if (bestDistance > 10 && occurrences.length > 1) {
      // If the best match is still far, try context-based selection
      bestIndex = this.selectOccurrenceByContext(
        occurrences,
        originalCharPosition,
        elementText,
        targetText
      );
    }

    return bestIndex;
  }

  /**
   * Select occurrence based on surrounding context (for cases like "i" vs "I")
   */
  private selectOccurrenceByContext(
    occurrences: number[],
    originalCharPosition: number,
    elementText: string,
    targetText: string
  ): number {
    // For single character matches (like "i"), prefer occurrences that match case and context
    if (targetText.length === 1) {
      const char = targetText;

      for (const occurrence of occurrences) {
        const beforeChar = occurrence > 0 ? elementText[occurrence - 1] : " ";

        // For lowercase letters, prefer occurrences that are mid-word (not at sentence start)
        if (char === char.toLowerCase() && char !== char.toUpperCase()) {
          if (
            beforeChar !== " " &&
            beforeChar !== "." &&
            beforeChar !== "!" &&
            beforeChar !== "?"
          ) {
            return occurrence;
          }
        }

        // For uppercase letters, prefer occurrences at word/sentence start
        if (char === char.toUpperCase() && char !== char.toLowerCase()) {
          if (
            beforeChar === " " ||
            beforeChar === "." ||
            beforeChar === "!" ||
            beforeChar === "?" ||
            occurrence === 0
          ) {
            return occurrence;
          }
        }
      }
    }

    // Fallback: return closest to original position
    return occurrences.reduce((best, current) =>
      Math.abs(current - originalCharPosition) <
      Math.abs(best - originalCharPosition)
        ? current
        : best
    );
  }

  /**
   * Wrap text at a specific position within an element
   */
  private wrapTextAtPositionInElement(
    element: HTMLElement,
    position: number,
    length: number,
    diagnostic: any
  ): boolean {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null
    );

    let currentPosition = 0;
    let textNode: Text | null;

    while ((textNode = walker.nextNode() as Text)) {
      const content = textNode.textContent || "";
      const nodeEnd = currentPosition + content.length;

      // Check if the target position is within this text node
      if (position >= currentPosition && position < nodeEnd) {
        const relativeStart = position - currentPosition;
        const relativeEnd = Math.min(relativeStart + length, content.length);

        return this.wrapTextWithDiagnostic(
          textNode,
          relativeStart,
          relativeEnd,
          diagnostic
        );
      }

      currentPosition = nodeEnd;
    }

    return false;
  }

  /**
   * Check if a diagnostic would overlap with already applied diagnostics on the same element
   */
  private hasOverlappingDiagnostic(
    element: HTMLElement,
    startChar: number,
    endChar: number,
    lineNumber: number | undefined,
    diagnostic: any
  ): boolean {
    if (!this.appliedDiagnostics.has(element)) {
      return false;
    }

    const diagnosticId = this.generateDiagnosticId(diagnostic);
    const appliedList = this.appliedDiagnostics.get(element)!;

    for (const applied of appliedList) {
      // Skip if it's the same diagnostic
      if (applied.diagnosticId === diagnosticId) {
        continue;
      }

      // Check for character range overlap
      const hasCharOverlap =
        startChar < applied.endChar && endChar > applied.startChar;

      // Check for line number conflict (different line numbers shouldn't share same element range)
      const hasDifferentLine =
        lineNumber !== undefined &&
        applied.lineNumber !== undefined &&
        lineNumber !== applied.lineNumber;

      if (hasCharOverlap) {
        return true;
      }

      if (hasDifferentLine && hasCharOverlap) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a specific diagnostic has already been applied to any element
   * This replaces the old wrappedKeys check for duplicate prevention across all elements
   */
  private isDiagnosticAlreadyApplied(
    diagnostic: any,
    lineNumber: number | undefined,
    startChar: number,
    endChar: number
  ): boolean {
    const diagnosticId = this.generateDiagnosticId(diagnostic);

    // Check all applied diagnostics across all elements
    for (const appliedList of this.appliedDiagnostics.values()) {
      for (const applied of appliedList) {
        // Check if this is the exact same diagnostic (same ID, line, and char range)
        if (
          applied.diagnosticId === diagnosticId &&
          applied.lineNumber === (lineNumber || -1) &&
          applied.startChar === startChar &&
          applied.endChar === endChar
        ) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Generate a unique ID for a diagnostic for tracking purposes
   */
  private generateDiagnosticId(diagnostic: any): string {
    const range = diagnostic.range;
    const startLine = range?.start?.line || 0;
    const startChar = range?.start?.character || 0;
    const endLine = range?.end?.line || 0;
    const endChar = range?.end?.character || 0;
    const message = diagnostic.message || "";
    const code = diagnostic.code || "";

    return `${startLine}:${startChar}-${endLine}:${endChar}|${message}|${code}`;
  }

  /**
   * Record that a diagnostic has been applied to an element at specific character range
   */
  private recordAppliedDiagnostic(
    element: HTMLElement,
    startChar: number,
    endChar: number,
    lineNumber: number | undefined,
    diagnostic: any
  ): void {
    const diagnosticId = this.generateDiagnosticId(diagnostic);

    if (!this.appliedDiagnostics.has(element)) {
      this.appliedDiagnostics.set(element, []);
    }

    this.appliedDiagnostics.get(element)!.push({
      startChar,
      endChar,
      lineNumber: lineNumber || -1,
      diagnosticId,
    });

    // Also track element by line number for efficient lookups
    if (lineNumber !== undefined) {
      if (!this.elementsByLine.has(lineNumber)) {
        this.elementsByLine.set(lineNumber, []);
      }
      if (!this.elementsByLine.get(lineNumber)!.includes(element)) {
        this.elementsByLine.get(lineNumber)!.push(element);
      }
    }
  }

  /**
   * Remove a diagnostic record from an element (cleanup after failed wrapping)
   */
  private removeAppliedDiagnostic(
    element: HTMLElement,
    startChar: number,
    endChar: number,
    lineNumber: number | undefined,
    diagnostic: any
  ): void {
    const diagnosticId = this.generateDiagnosticId(diagnostic);

    if (!this.appliedDiagnostics.has(element)) {
      return;
    }

    // Filter out the matching diagnostic record
    const appliedList = this.appliedDiagnostics.get(element)!;
    const filtered = appliedList.filter(
      (applied) =>
        !(
          applied.diagnosticId === diagnosticId &&
          applied.startChar === startChar &&
          applied.endChar === endChar
        )
    );

    if (filtered.length === 0) {
      // No more diagnostics on this element, remove it completely
      this.appliedDiagnostics.delete(element);

      // Also remove from elementsByLine if applicable
      if (lineNumber !== undefined && this.elementsByLine.has(lineNumber)) {
        const lineElements = this.elementsByLine.get(lineNumber)!;
        const elementIndex = lineElements.indexOf(element);
        if (elementIndex !== -1) {
          lineElements.splice(elementIndex, 1);
        }
        if (lineElements.length === 0) {
          this.elementsByLine.delete(lineNumber);
        }
      }
    } else {
      // Update with filtered list
      this.appliedDiagnostics.set(element, filtered);
    }
  }

  /**
   * Remove diagnostic styling from a specific span element and clean up tracking data
   * CENTRALIZED method to ensure appliedDiagnostics is always synchronized with DOM
   *
   * IMPORTANT: appliedDiagnostics is keyed by the PARENT element (where the span was inserted),
   * not by the span itself. This matches how we record diagnostics in recordAppliedDiagnostic().
   */
  public removeDiagnosticStylingFromElement(span: HTMLElement): void {
    // Get the parent element - this is where the diagnostic is tracked
    const parentElement = span.parentElement;

    // Remove diagnostic classes and attributes only
    span.className = span.className
      .replace(/\bvscode-diagnostic-\w+\b/g, "")
      .trim();
    span.removeAttribute("data-diagnostic-message");
    span.removeAttribute("data-diagnostic-source");
    span.removeAttribute("data-diagnostic-severity");
    span.removeAttribute("data-diagnostic-ui");
    span.removeAttribute("data-single-char");
    span.removeAttribute("data-has-lightbulb");

    if (!span.className.trim()) {
      // If no classes remain, remove class attribute entirely
      span.removeAttribute("class");
    }

    // CRITICAL: Remove from appliedDiagnostics tracking using PARENT element as key
    // The diagnostic was recorded on the parent element, not on the span itself
    if (parentElement && this.appliedDiagnostics.has(parentElement)) {
      this.appliedDiagnostics.delete(parentElement);
    }

    // Remove parent element from elementsByLine map
    if (parentElement) {
      this.elementsByLine.forEach((elements, lineNumber) => {
        const index = elements.indexOf(parentElement);
        if (index > -1) {
          elements.splice(index, 1);
          if (elements.length === 0) {
            this.elementsByLine.delete(lineNumber);
          }
        }
      });
    }

    // Only unwrap if span is completely empty of useful classes/attributes
    if (!span.hasAttributes()) {
      const parent = span.parentNode;
      if (parent) {
        // Create document fragment to safely move children
        const fragment = document.createDocumentFragment();

        // Move ALL child nodes (including text nodes, elements, etc.)
        while (span.firstChild) {
          fragment.appendChild(span.firstChild);
        }

        // Insert fragment before span, then remove span
        parent.insertBefore(fragment, span);
        parent.removeChild(span);
      }
    }
  }
}

  /**
   * Check if one element is a descendant of another
   */
export function isDescendantOf(descendant: Node, ancestor: Node): boolean {
    let current: Node | null = descendant.parentNode;
    while (current) {
      if (current === ancestor) {
        return true;
      }
      current = current.parentNode;
    }
    return false;
  }
