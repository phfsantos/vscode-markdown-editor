/** Owns diagnostic spans, hover tooltips and quick-fix UI. */
export class DiagnosticDecorations {

  // Aggregate diagnostics per source range for combined tooltip & quick fix
  private tokenDiagnostics: Map<string, any[]> = new Map();

  clearTokens(): void { this.tokenDiagnostics.clear(); }


  /**
   * Apply diagnostic styling to text without creating duplicate elements
   * This method finds and styles the problematic text but does NOT wrap it to avoid duplicates
   */
  public wrapTextWithDiagnostic(
    textNode: Text,
    startOffset: number,
    endOffset: number,
    diagnostic: any
  ): boolean {
    try {
      const text = textNode.textContent || "";
      if (
        startOffset >= text.length ||
        endOffset > text.length ||
        startOffset >= endOffset
      ) {
        return false;
      }

      const diagnosticText = text.substring(startOffset, endOffset);
      const tokenKey = JSON.stringify([diagnostic.range, diagnostic.lineText]);
      const list = diagnostic.tokenDiagnostics || [diagnostic];
      this.tokenDiagnostics.set(tokenKey, list);

      // Create a styled span that replaces the text node with proper diagnostic styling
      const beforeText = text.substring(0, startOffset);
      const afterText = text.substring(endOffset);
      const severityClass = this.getSeverityClass(diagnostic.severity);

      // Create the diagnostic span with all the styling from the original wrapped text approach
      const diagnosticSpan = document.createElement("span");
      diagnosticSpan.className = `vscode-diagnostic-span ${severityClass}`;
      diagnosticSpan.textContent = diagnosticText;
      diagnosticSpan.setAttribute(
        "data-diagnostic-severity",
        diagnostic.severity.toString()
      );

      if (diagnosticText.length === 1) {
        diagnosticSpan.setAttribute("data-single-char", "true");
      }

      // Build combined tooltip content from aggregated diagnostics
      const combinedMessages = this.tokenDiagnostics.get(tokenKey) || [];
      const combinedText = combinedMessages
        .map((d) => `${d.message}${d.source ? ` (${d.source})` : ""}`)
        .join("\n");
      diagnosticSpan.setAttribute("data-diagnostic-message", combinedText);
      diagnosticSpan.setAttribute(
        "data-diagnostic-source",
        combinedMessages
          .map((d) => d.source)
          .filter(Boolean)
          .join(", ")
      );

      // Add enhanced hoverable tooltip with the styling from wrapped text
      this.addHoverableTooltip(diagnosticSpan, {
        message: combinedText,
        source: combinedMessages
          .map((d) => d.source)
          .filter(Boolean)
          .join(", "),
      });

      // Add quick fix lightbulb integrated into the same element
      for (const report of combinedMessages) {
        this.addIntegratedQuickFixLightbulb(diagnosticSpan, report);
      }

      // Replace the text node with our styled span
      // Duplicate prevention is handled by appliedDiagnostics with character range tracking
      const fragment = document.createDocumentFragment();
      if (beforeText) fragment.appendChild(document.createTextNode(beforeText));
      fragment.appendChild(diagnosticSpan);
      if (afterText) fragment.appendChild(document.createTextNode(afterText));
      const parent = textNode.parentNode;
      if (parent) {
        parent.replaceChild(fragment, textNode);
        return true;
      } else {
        // vscodeLogError(`❌ No parent node found for text node containing: "${diagnosticText}"`);
        return false;
      }
    } catch (error) {
      // vscodeLogError(`❌ Error styling text with diagnostic: ${error}`);
      return false;
    }
  }

  /**
   * Add hoverable tooltip to diagnostic element that allows text selection and copying
   */
  private addHoverableTooltip(element: HTMLElement, diagnostic: any): void {
    let tooltip: HTMLElement | null = null;
    let hoverTimeout: NodeJS.Timeout | null = null;
    let isTooltipHovered = false;

    const showTooltip = () => {
      if (tooltip) return; // Already showing

      tooltip = document.createElement("div");
      tooltip.className = "vscode-diagnostic-tooltip-hoverable";
      tooltip.setAttribute("data-diagnostic-ui", "true"); // Mark as UI element

      // Create tooltip content with better styling
      const messageContent = document.createElement("div");
      messageContent.className = "vscode-diagnostic-tooltip-content";
      messageContent.textContent = diagnostic.message;

      const sourceContent = document.createElement("div");
      sourceContent.className = "vscode-diagnostic-tooltip-source";
      sourceContent.textContent = diagnostic.source || "Diagnostic";

      tooltip.appendChild(sourceContent);
      tooltip.appendChild(messageContent);

      // Position tooltip
      document.body.appendChild(tooltip);

      const rect = element.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();

      // Position below the element with some margin
      let top = rect.bottom + 8;
      let left = rect.left;

      // Adjust if tooltip would go off screen
      if (left + tooltipRect.width > window.innerWidth) {
        left = window.innerWidth - tooltipRect.width - 10;
      }
      if (top + tooltipRect.height > window.innerHeight) {
        top = rect.top - tooltipRect.height - 8;
      }

      tooltip.style.position = "fixed";
      tooltip.style.top = `${top}px`;
      tooltip.style.left = `${left}px`;
      tooltip.style.zIndex = "10000";
      tooltip.style.userSelect = "text"; // Allow text selection

      // Add event listeners to keep tooltip open when hovering over it
      tooltip.addEventListener("mouseenter", () => {
        isTooltipHovered = true;
      });

      tooltip.addEventListener("mouseleave", () => {
        isTooltipHovered = false;
        setTimeout(hideTooltip, 100); // Small delay to allow moving between element and tooltip
      });
    };

    const hideTooltip = () => {
      if (hoverTimeout) {
        clearTimeout(hoverTimeout);
        hoverTimeout = null;
      }

      if (tooltip && !isTooltipHovered) {
        tooltip.remove();
        tooltip = null;
      }
    };

    // Show tooltip on hover with delay
    element.addEventListener("mouseenter", () => {
      hoverTimeout = setTimeout(showTooltip, 300); // 300ms delay
    });

    // Hide tooltip when leaving element (with delay to allow moving to tooltip)
    element.addEventListener("mouseleave", () => {
      if (hoverTimeout) {
        clearTimeout(hoverTimeout);
        hoverTimeout = null;
      }
      setTimeout(() => {
        if (!isTooltipHovered) {
          hideTooltip();
        }
      }, 100);
    });
  }

  /**
   * Get CSS class for diagnostic severity
   */
  private getSeverityClass(severity: number): string {
    switch (severity) {
      case 1:
        return "vscode-diagnostic-error";
      case 2:
        return "vscode-diagnostic-warning";
      case 3:
        return "vscode-diagnostic-info";
      case 4:
        return "vscode-diagnostic-hint";
      default:
        return "vscode-diagnostic-info";
    }
  }

  /**
   * Add quick fix lightbulb as a completely separate overlay (never touches document content)
   */
  /**
   * Add integrated quick fix lightbulb directly to the diagnostic span (no separate overlay)
   */
  private addIntegratedQuickFixLightbulb(
    element: HTMLElement,
    diagnostic: any
  ): void {
    // Only add lightbulb for diagnostics that likely have quick fixes
    const hasQuickFix = this.diagnosticHasQuickFix(diagnostic);
    if (!hasQuickFix) {
      return;
    }

    // Don't add multiple lightbulbs to the same element
    if (element.getAttribute("data-has-lightbulb") === "true") {
      return;
    }

    // Add lightbulb styling directly to the span
    element.setAttribute("data-has-lightbulb", "true");

    // Lightbulb CSS is already defined in main.css - no need to add dynamic styles

    // Add click handler to the entire element
    element.addEventListener("click", (e) => {
      // Only trigger if clicking near the lightbulb area (right side of element)
      const rect = element.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const elementWidth = rect.width;

      // If clicking in the rightmost 25% of the element (where lightbulb appears), trigger quick fix
      if (clickX > elementWidth * 0.75) {
        e.preventDefault();
        e.stopPropagation();
        this.triggerQuickFix(diagnostic);
      }
    });
  }

  /**
   * Clean up integrated lightbulb styling (replaces old overlay cleanup)
   */
  public cleanupLightbulbOverlays(): void {
    // Remove integrated lightbulb attributes from all elements
    const elementsWithLightbulbs = document.querySelectorAll(
      '[data-has-lightbulb="true"]'
    );

    elementsWithLightbulbs.forEach((element) => {
      const htmlElement = element as HTMLElement;
      htmlElement.removeAttribute("data-has-lightbulb");
      htmlElement.style.removeProperty("--lightbulb-display");
    });
  }

  /**
   * Check if diagnostic likely has quick fixes available
   */
  private diagnosticHasQuickFix(diagnostic: any): boolean {
    const source = diagnostic.source?.toLowerCase() || "";
    const message = diagnostic.message?.toLowerCase() || "";

    // Common sources that typically have quick fixes
    const quickFixSources = [
      "markdownlint",
      "eslint",
      "tslint",
      "pylint",
      "spell",
      "cspell",
    ];

    // Common message patterns that suggest quick fixes
    const quickFixPatterns = [
      "should be",
      "expected",
      "missing",
      "incorrect",
      "invalid",
      "unknown word",
      "misspelled",
      "fix available",
    ];

    return (
      quickFixSources.some((s) => source.includes(s)) ||
      quickFixPatterns.some((p) => message.includes(p))
    );
  }

  /**
   * Open VS Code problems panel for user to choose what to fix
   */
  private triggerQuickFix(diagnostic: any): void {
    // Simply open the problems panel for the user to choose what to fix
    if ((window as any).vscode) {
      (window as any).vscode.postMessage({
        command: "openProblemsPanel",
      });
    }
  }
}
