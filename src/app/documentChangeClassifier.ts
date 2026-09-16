import * as vscode from "vscode";
import { logger } from "../utils/Logger";

/**
 * Timing/visibility state used to classify whether a document change came
 * from outside the webview (e.g. Copilot chat edits, formatters, git) or
 * from the user typing in the editor itself.
 */
export interface ChangeClassifierHost {
  readonly panelActive: boolean;
  readonly panelVisible: boolean;
  readonly lastWebviewEdit: number;
  readonly lastCursorPosition:
    | { line: number; character: number; timestamp: number }
    | null;
}

/**
 * Detect if a document change is from external source (quick fixes, spell checker, etc.)
 */
export function detectExternalChange(
host: ChangeClassifierHost,
e: vscode.TextDocumentChangeEvent
): boolean {
  // VS Code 1.44+ includes reason property for change events
  if (e.reason) {
    // Reason 1 = Redo, 2 = Undo, undefined = Normal edit
    return e.reason === 1 || e.reason === 2;
  }

  // Track recent webview edits to avoid false positives
  const now = Date.now();

  // ENHANCED: Increased time window for webview edit tracking to handle post-newline typing
  // This prevents cursor jumping after Enter key followed by typing
  if (host.lastWebviewEdit && now - host.lastWebviewEdit < 3000) {
    if (logger.debug) {
      logger.debug(
        `⏰ Recent webview edit detected (${ 
          now - host.lastWebviewEdit
        }ms ago) - not external`
      );
    }
    return false;
  }

  // ENHANCED: Increased time window for cursor position tracking to handle typing sequences
  if (
    host.lastCursorPosition &&
    now - host.lastCursorPosition.timestamp < 2000
  ) {
    if (logger.debug) {
      logger.debug(
        `⏰ Recent cursor update detected (${ 
          now - host.lastCursorPosition.timestamp
        }ms ago) - not external`
      );
    }
    return false;
  }

  // ENHANCED: Detailed logging for debugging cursor jumping issue
  for (const change of e.contentChanges) {
    if (logger.debug) {
      logger.debug(`🔍 CURSOR DEBUG - Change detected:`);
      logger.debug(
        `   • Text: "${change.text}" (length: ${change.text.length})`
      );
      logger.debug(
        `   • Range: ${change.range.start.line}:${change.range.start.character}-${change.range.end.line}:${change.range.end.character}`
      );
      logger.debug(
        `   • Range length: ${change.rangeLength}`
      );
      logger.debug(
        `   • Panel state: active=${host.panelActive}, visible=${host.panelVisible}`
      );
      logger.debug(
        `   • Last webview edit: ${
          host.lastWebviewEdit
            ? now - host.lastWebviewEdit + "ms ago"
            : "never"
        }`
      );
      logger.debug(
        `   • Last cursor update: ${
          host.lastCursorPosition
            ? now - host.lastCursorPosition.timestamp + "ms ago"
            : "never"
        }`
      );
    }
  }

  // Enhanced heuristics for detecting external changes
  for (const change of e.contentChanges) {
    const text = change.text.toLowerCase();
    const originalText = e.document.getText(change.range).toLowerCase();

    // ENHANCED: VS Code Quick Fix Signature Detection
    // Detect replacement patterns characteristic of VS Code quick fixes
    const isReplacementPattern =
      change.rangeLength > 0 &&
      change.text.length > 0 &&
      change.rangeLength !== change.text.length;

    const hasSignificantTimeGap =
      !host.lastWebviewEdit || now - host.lastWebviewEdit > 10000;

    if (isReplacementPattern && hasSignificantTimeGap) {
      // Check for markdown syntax patterns (markdownlint fixes)
      const hasMarkdownSyntax =
        change.text.match(
          /!\[.*?\]\(.*?\)|^\s*[-*+]|\[.*?\]\(.*?\)|^\s*#{1,6}\s|```/
        ) ||
        originalText.match(
          /!\[.*?\]\(.*?\)|^\s*[-*+]|\[.*?\]\(.*?\)|^\s*#{1,6}\s|```/
        );

      if (hasMarkdownSyntax) {
        if (logger.debug) {
          logger.debug(
            `✅ External change detected: Markdown syntax replacement (likely markdownlint fix)`
          );
        }
        return true;
      }

      // Check for focused single-line changes (typical of quick fixes)
      const isFocusedChange =
        change.range.start.line === change.range.end.line &&
        change.rangeLength < 100 && // Not a large block change
        change.text.length < 100;

      if (isFocusedChange) {
        if (logger.debug) {
          logger.debug(
            `✅ External change detected: Focused replacement pattern (likely quick fix)`
          );
        }
        return true;
      }
    }

    // High-confidence external change indicators
    if (
      text.includes("markdownlint-disable") ||
      text.includes("spellcheck") ||
      text.includes("quickfix") ||
      text.includes("markdownlint") ||
      originalText.includes("typo") ||
      (change.rangeLength > 0 &&
        change.text.length > 0 &&
        change.rangeLength !== change.text.length &&
        (text.match(/^[a-zA-Z\s\-']+$/) || text.match(/^[a-zA-Z]+$/)))
    ) {
      // Enhanced pattern for words with spaces and hyphens
      if (logger.debug) {
        logger.debug(
          `✅ External change detected: Quick fix/spell check pattern`
        );
      }
      return true;
    }

    // Multi-word replacements (likely spell corrections or quick fixes)
    const isMultiWordReplacement =
      change.rangeLength > 5 &&
      change.text.length > 5 &&
      change.text.trim().includes(" ") &&
      !host.panelActive;
    if (isMultiWordReplacement) {
      if (logger.debug) {
        logger.debug(
          `✅ External change detected: Multi-word replacement`
        );
      }
      return true;
    }

    // Document-wide changes (formatters, linters)
    if (
      change.rangeLength > 100 &&
      change.text.length > 100 &&
      change.range.start.line === 0 &&
      change.range.end.line > 10
    ) {
      if (logger.debug) {
        logger.debug(
          `✅ External change detected: Document-wide change`
        );
      }
      return true;
    }

    // Multi-line changes when panel is not focused (likely external tools)
    if (
      !host.panelActive &&
      !host.panelVisible &&
      change.range.end.line - change.range.start.line > 1
    ) {
      if (logger.debug) {
        logger.debug(
          `✅ External change detected: Multi-line change while panel inactive`
        );
      }
      return true;
    }

    // Enhanced word-level replacements (spell corrections)
    const isWordReplacement =
      change.rangeLength > 2 &&
      change.text.length > 2 &&
      change.text.match(/^[a-zA-Z'-]+$/) &&
      !change.text.includes("\n") &&
      change.rangeLength !== 1; // Not single character edits
    if (isWordReplacement && !host.panelActive) {
      if (logger.debug) {
        logger.debug(
          `✅ External change detected: Word replacement (spell check likely)`
        );
      }
      return true;
    }

    // ENHANCED: More sophisticated panel state and typing detection
    // Panel visibility alone is not sufficient to determine internal vs external changes
    // Quick fixes and spell corrections can happen while panel is visible

    // Only reject based on panel state if there are RECENT webview edits indicating active user typing
    const hasVeryRecentWebviewActivity =
      host.lastWebviewEdit && now - host.lastWebviewEdit < 1000; // Very recent activity
    const hasVeryRecentCursorActivity =
      host.lastCursorPosition &&
      now - host.lastCursorPosition.timestamp < 1000;

    if (
      (host.panelActive || host.panelVisible) &&
      (hasVeryRecentWebviewActivity || hasVeryRecentCursorActivity)
    ) {
      // Additional check: if it's a clear replacement pattern, still consider it external
      const isClearReplacement =
        change.rangeLength > 0 &&
        change.text.length > 0 &&
        Math.abs(change.rangeLength - change.text.length) > 2; // Significant difference

      if (
        isClearReplacement &&
        !hasVeryRecentWebviewActivity &&
        !hasVeryRecentCursorActivity
      ) {
        if (logger.debug) {
          logger.debug(
            `✅ Clear replacement pattern overrides panel visibility - treating as external`
          );
        }
        return true;
      }

      if (logger.debug) {
        logger.debug(
          `❌ Panel active/visible with recent activity - treating as internal change`
        );
      }
      return false;
    }

    // ENHANCED: Better detection of normal typing sequences
    // Single character changes are virtually always user typing when recent activity detected
    if (change.text.length <= 1 && change.rangeLength <= 1) {
      // Check for recent webview activity indicating active typing session
      const hasRecentWebviewActivity =
        host.lastWebviewEdit && now - host.lastWebviewEdit < 5000;
      const hasRecentCursorActivity =
        host.lastCursorPosition &&
        now - host.lastCursorPosition.timestamp < 5000;

      if (hasRecentWebviewActivity || hasRecentCursorActivity) {
        if (logger.debug) {
          logger.debug(
            `❌ Single character change with recent activity - treating as internal`
          );
        }
        return false;
      }

      // Only treat single chars as external if panel is completely inactive for extended period
      const hasExternalIndicators =
        !host.panelVisible && now - host.lastWebviewEdit > 10000; // Increased from 3000ms
      if (!hasExternalIndicators) {
        if (logger.debug) {
          logger.debug(
            `❌ Single character change without strong external indicators - treating as internal`
          );
        }
        return false;
      }
    }

    // ENHANCED: Better handling of small typing sequences (common after newlines)
    if (
      change.text.length <= 5 &&
      change.rangeLength <= 5 &&
      change.text.match(/^[a-zA-Z0-9\s.,!?'"()-]*$/) && // Normal typing characters
      !change.text.includes("markdownlint") &&
      !change.text.includes("spell")
    ) {
      const hasRecentActivity =
        (host.lastWebviewEdit && now - host.lastWebviewEdit < 8000) ||
        (host.lastCursorPosition &&
          now - host.lastCursorPosition.timestamp < 8000);

      if (hasRecentActivity) {
        if (logger.debug) {
          logger.debug(
            `❌ Small typing sequence with recent activity - treating as internal`
          );
        }
        return false;
      }
    }

    // Pure whitespace changes - be more permissive for external changes
    if (change.text.match(/^\s*$/) && change.rangeLength > 0) {
      // Could be external formatting
      if (!host.panelVisible && now - host.lastWebviewEdit > 2000) {
        if (logger.debug) {
          logger.debug(
            `✅ External change detected: Whitespace change while panel not visible`
          );
        }
        return true;
      }
    }
  }

  // ENHANCED: Default to internal change with detailed reasoning
  if (logger.debug) {
    logger.debug(
      `❌ EXTERNAL CHANGE DEBUG - Final decision: INTERNAL CHANGE`
    );
    logger.debug(
      `   • Reason: No clear external indicators found`
    );
    logger.debug(
      `   • Panel state: active=${host.panelActive}, visible=${host.panelVisible}`
    );
    logger.debug(
      `   • Recent webview activity: ${
        host.lastWebviewEdit
          ? now - host.lastWebviewEdit + "ms ago"
          : "never"
      }`
    );
    logger.debug(
      `   • Recent cursor activity: ${
        host.lastCursorPosition
          ? now - host.lastCursorPosition.timestamp + "ms ago"
          : "never"
      }`
    );
    logger.debug(
      `   • This should NOT trigger webview update`
    );
  }
  return false;
}
