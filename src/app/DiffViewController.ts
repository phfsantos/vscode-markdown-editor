import * as vscode from "vscode";
import * as NodePath from "path";
import { logger } from "../utils/Logger";
import { findChatEditingStateForDocument } from "./chatEditingDiff";
import { calculateRoleSpecificDiffStats } from "../diff/roleSpecificStats";

/**
 * The slice of an editor panel the diff controller needs. EditorPanel
 * implements this; tests provide lightweight fakes.
 */
export interface DiffHost {
  readonly instanceId: string;
  readonly uri: vscode.Uri;
  readonly document: vscode.TextDocument;
  readonly tab: vscode.Tab | undefined;
  readonly webviewReady: boolean;
  readonly panelVisible: boolean;
  readonly panelActive: boolean;
  readonly diff: DiffViewController;
  postMessage(message: unknown): void;
  postInlineSuggestionEligibility(): void;
  requestIRHtml(): Promise<string | null>;
  requestRenderedMarkdownHtml(markdown: string): Promise<string | null>;
}

interface DiffPanelPair {
  left?: DiffHost;
  right?: DiffHost;
}

/**
 * Owns all diff-view state and orchestration for one editor panel: reactive
 * two-panel diff detection/application, pending chat-edit single-view diffs,
 * and debounced re-calculation on document changes.
 *
 * Extracted from EditorPanel. The mutable flags (isDiffView, diffApplied, …)
 * moved WITH the logic so no diff state lives outside this class.
 */
export class DiffViewController {
  /** tab -> panels registered as the left/right side of an explicit diff view */
  static readonly panelTracking = new Map<vscode.Tab, DiffPanelPair>();
  /** tab -> in-flight diff calculation, to dedupe concurrent triggers */
  static readonly calculationInProgress = new Map<vscode.Tab, Promise<void>>();

  isDiffView = false;
  otherDiffUri: vscode.Uri | undefined;
  diffRole: "left" | "right" | undefined;
  diffApplied = false;
  singleViewDiffApplied = false;
  lastDiffCheckVisible = false;
  pendingChatBaselineDocument: vscode.TextDocument | undefined;
  private updateDebounceTimeout: NodeJS.Timeout | undefined;

  constructor(private readonly host: DiffHost) {}

  /**
   * Register this panel as one side of an explicit diff tab (label "a ↔ b").
   * Mirrors the original EditorPanel constructor logic verbatim.
   */
  registerExplicitDiffPanel(showModifications: boolean): void {
    const tab = this.host.tab;
    if (!tab?.label) {
      return;
    }

    this.isDiffView = true;

    const labelArray = tab.label.split("↔");
    const fileName = NodePath.basename(this.host.uri.fsPath);
    const isLeft = labelArray[0].includes(fileName);
    const isRight = labelArray[1]?.includes(fileName) || true;
    const tracking = DiffViewController.panelTracking.get(tab) || {};
    if (
      (!isLeft && isRight && !tracking.right && !showModifications) ||
      (!isLeft &&
        isRight &&
        tracking.left &&
        !tracking.right &&
        !showModifications) ||
      (isLeft &&
        isRight &&
        !tracking.left &&
        !tracking.right &&
        !showModifications)
    ) {
      DiffViewController.panelTracking.set(tab, {
        ...tracking,
        right: this.host,
      });
    } else {
      DiffViewController.panelTracking.set(tab, {
        ...tracking,
        left: this.host,
      });
    }
  }

  /** Clear timers and tab tracking when the owning panel is disposed. */
  dispose(): void {
    if (this.updateDebounceTimeout) {
      clearTimeout(this.updateDebounceTimeout);
      this.updateDebounceTimeout = undefined;
    }
    if (this.host.tab) {
      DiffViewController.panelTracking.delete(this.host.tab);
    }
  }

  /**
   * Reactively check if this editor is part of a diff view and send diff information to webview
   * Called multiple times: on setTimeout delay, on webview ready, and on viewState changes
   * This reactive approach works around the fact that tabGroups is not populated at creation time
   *
   * OPTIMIZED: Only uses HTML-based diff. Calculates diff once and sends to both panels when both are ready.
   */
  public async checkDiffViewContextReactive(): Promise<void> {
    const fileName = NodePath.basename(this.host.uri.fsPath);
    logger.debug(
      `[${this.host.instanceId}] 🔍 DIFF-DEBUG: checkDiffViewContextReactive() for "${fileName}"`
    );
    logger.debug(
      `[${this.host.instanceId}]   State: diffApplied=${this.diffApplied}, visible=${this.host.panelVisible}, active=${this.host.panelActive}`
    );

    // OPTIMIZATION: If diff already applied to THIS webview instance, don't re-apply
    if (this.diffApplied && this.host.panelVisible) {
      logger.debug(
        `[${this.host.instanceId}]   ⏭️  Diff already applied to this instance AND panel still visible, skipping`
      );
      return;
    }

    if (!this.host.tab) {
      logger.debug(
        `[${this.host.instanceId}]   ⏭️  Not a diff view missing tab info, skipping`
      );
      return;
    }

    // REACTIVE DETECTION: Check tabGroups NOW (should be populated by this point)
    const isInDiffContext = this.isDiffView;
    const diffPanels = DiffViewController.panelTracking.get(this.host.tab);
    const diffContext = {
      role:
        diffPanels?.left?.instanceId === this.host.instanceId
          ? ("left" as const)
          : ("right" as const),
      otherUri:
        diffPanels?.left?.instanceId === this.host.instanceId
          ? diffPanels?.right?.uri
          : diffPanels?.left?.uri,
    };

    if (isInDiffContext && diffContext?.otherUri) {
      logger.debug(
        `[${this.host.instanceId}] ✅ Detected diff view! Updating instance state...`
      );

      // Update instance state dynamically since we started with false
      this.isDiffView = true;
      this.otherDiffUri = diffContext.otherUri;
      this.diffRole = diffContext.role;
      this.host.postInlineSuggestionEligibility();

      const diffSupport = (global as any).markdownDiffViewSupport;
      if (!diffSupport) {
        logger.debug(
          `[${this.host.instanceId}]   ❌ No diffSupport available for diff calculation`
        );
        return;
      }

      // Get the left and right panels for HTML extraction
      const leftPanel = diffPanels?.left;
      const rightPanel = diffPanels?.right;

      if (!leftPanel || !rightPanel) {
        logger.warn(`[${this.host.instanceId}] Cannot calculate HTML diff: missing panel(s)`);
        return;
      }

      // Check if both panels already have diff applied
      if (leftPanel.diff.diffApplied && rightPanel.diff.diffApplied) {
        logger.debug(`[${this.host.instanceId}]   ⏭️  Both panels already have diff applied, skipping`);
        return;
      }

      // Check if a diff calculation is already in progress for this tab
      const existingCalculation = DiffViewController.calculationInProgress.get(this.host.tab);
      if (existingCalculation) {
        logger.debug(`[${this.host.instanceId}]   ⏳ Diff calculation already in progress, waiting...`);
        await existingCalculation;
        return;
      }

      // Start a new diff calculation and track it
      const calculationPromise = this.calculateAndApplyDiff(leftPanel, rightPanel, diffSupport);
      DiffViewController.calculationInProgress.set(this.host.tab, calculationPromise);

      try {
        await calculationPromise;
      } finally {
        // Clean up the tracking entry
        DiffViewController.calculationInProgress.delete(this.host.tab);
      }
    } else {
      logger.debug(
        `[${this.host.instanceId}]   ℹ️  Not in diff view (isDiffView=${
          this.isDiffView
        }, otherDiffUri=${this.otherDiffUri?.toString() || "undefined"})`
      );
      // If we're NOT in a diff view but diff was previously applied, we need to clear it
      if (this.diffApplied) {
        logger.debug(
          `[${this.host.instanceId}]   🧹 Diff was applied but no longer in diff view, sending clear message`
        );
        this.host.postMessage({
          type: "diff-view-cleared",
        });
        this.diffApplied = false;
      }
      this.host.postInlineSuggestionEligibility();
    }
  }

  /**
   * Calculate HTML-based diff and send to both panels simultaneously
   * This method is called once per diff view and updates both panels
   */
  private async calculateAndApplyDiff(
    leftPanel: DiffHost,
    rightPanel: DiffHost,
    diffSupport: any
  ): Promise<void> {
    const fileName = NodePath.basename(this.host.uri.fsPath);

    // Wait for BOTH webviews to be ready before proceeding
    logger.debug(`[${this.host.instanceId}]   Waiting for both panels to be ready...`);
    await this.waitForBothPanelsReady(leftPanel, rightPanel);

    // Wait additional time for Vditor to fully render content
    logger.debug(`[${this.host.instanceId}]   Waiting 1s for Vditor to fully render content...`);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Request IR HTML content from BOTH panels in parallel
    logger.debug(`[${this.host.instanceId}]   Requesting IR HTML from both panels (left: ${leftPanel.instanceId}, right: ${rightPanel.instanceId})...`);
    const [leftHtml, rightHtml] = await Promise.all([
      leftPanel.requestIRHtml(),
      rightPanel.requestIRHtml()
    ]);

    logger.debug(`[${this.host.instanceId}]   HTML received - left: ${leftHtml ? leftHtml.length + ' chars' : 'null'}, right: ${rightHtml ? rightHtml.length + ' chars' : 'null'}`);

    // STRICT: Only use HTML-based diff, no fallback
    if (!leftHtml || !rightHtml) {
      logger.error(`[${this.host.instanceId}] ❌ Failed to get HTML content from panels. Cannot calculate diff without HTML.`);
      return;
    }

    // Calculate diff using HTML content ONCE
    logger.debug(`[${this.host.instanceId}]   Calculating HTML-based diff...`);
    const diffResult = await diffSupport.calculateDiffFromHTML(leftHtml, rightHtml);
    logger.debug(
      `[${this.host.instanceId}]   HTML diff calculated: ${diffResult.changes.length} changes`
    );

    // Extract HTML lines for spacer rendering
    const leftHtmlLines = (diffResult as any).leftHtmlLines || [];
    const rightHtmlLines = (diffResult as any).rightHtmlLines || [];
    const allChanges = diffResult.changes;

    // Calculate role-specific stats for both panels
    const leftStats = calculateRoleSpecificDiffStats(allChanges, "left");
    const rightStats = calculateRoleSpecificDiffStats(allChanges, "right");

    logger.debug(`[${this.host.instanceId}]   Sending diff-view-detected to BOTH panels simultaneously`);

    // Send to LEFT panel
    leftPanel.postMessage({
      type: "diff-view-detected",
      diffInfo: {
        role: "left",
        otherUri: rightPanel.uri.toString(),
        instanceId: leftPanel.instanceId,
        changes: allChanges,
        stats: leftStats,
        htmlLines: rightHtmlLines, // Left panel gets right's HTML for spacers
        isHtmlBased: true,
      },
    });
    leftPanel.diff.diffApplied = true;
    leftPanel.postInlineSuggestionEligibility();

    // Send to RIGHT panel
    rightPanel.postMessage({
      type: "diff-view-detected",
      diffInfo: {
        role: "right",
        otherUri: leftPanel.uri.toString(),
        instanceId: rightPanel.instanceId,
        changes: allChanges,
        stats: rightStats,
        htmlLines: leftHtmlLines, // Right panel gets left's HTML for spacers
        isHtmlBased: true,
      },
    });
    rightPanel.diff.diffApplied = true;
    rightPanel.postInlineSuggestionEligibility();

    logger.debug(
      `[${this.host.instanceId}]   ✅ Diff applied to both panels for "${fileName}"`
    );
  }

  public isRelevantChatEditingDocument(document: vscode.TextDocument): boolean {
    const currentPath =
      this.host.document.uri.scheme === "file" && this.host.document.uri.fsPath
        ? this.host.document.uri.fsPath
        : this.host.document.uri.path;
    const candidatePath =
      document.uri.scheme === "file" && document.uri.fsPath
        ? document.uri.fsPath
        : document.uri.path;

    if (candidatePath !== currentPath) {
      return false;
    }

    return document.uri.scheme.startsWith("chat-editing-");
  }

  public refreshPendingChatEditState(): void {
    const chatEditingState = findChatEditingStateForDocument(
      this.host.document,
      vscode.workspace.textDocuments
    );

    this.pendingChatBaselineDocument = chatEditingState?.hasPendingEdits
      ? chatEditingState.baselineDocument
      : undefined;
  }

  public async applyPendingChatDiffVisualization(): Promise<void> {
    if (this.isDiffView) {
      return;
    }

    this.refreshPendingChatEditState();

    if (!this.host.webviewReady) {
      return;
    }

    if (!this.pendingChatBaselineDocument) {
      this.host.postMessage({
        type: "diff-view-cleared",
      });
      this.singleViewDiffApplied = false;
      return;
    }

    const diffSupport = (global as any).markdownDiffViewSupport;
    if (!diffSupport?.calculateDiffFromHTML) {
      logger.debug(
        `[${this.host.instanceId}] Pending chat diff skipped - diff support unavailable`
      );
      return;
    }

    const [baselineHtml, currentHtml] = await Promise.all([
      this.host.requestRenderedMarkdownHtml(
        this.pendingChatBaselineDocument.getText()
      ),
      this.host.requestIRHtml(),
    ]);

    if (baselineHtml == null || currentHtml == null) {
      logger.warn(
        `[${this.host.instanceId}] Pending chat diff skipped - unable to render HTML for comparison`
      );
      return;
    }

    const diffResult = diffSupport.calculateDiffFromHTML(
      baselineHtml,
      currentHtml
    );
    const leftHtmlLines = (diffResult as any).leftHtmlLines || [];
    const changes = diffResult.changes;

    if (changes.length === 0) {
      logger.debug(
        `[${this.host.instanceId}] Pending chat diff cleared - rendered baseline matches current document`
      );
      if (this.singleViewDiffApplied) {
        this.host.postMessage({
          type: "diff-view-cleared",
        });
      }
      this.singleViewDiffApplied = false;
      return;
    }

    const rightStats = calculateRoleSpecificDiffStats(changes, "right");

    logger.debug(
      `[${this.host.instanceId}] Applying pending chat single-view diff with ${changes.length} aligned changes`
    );

    this.host.postMessage({
      type: "diff-view-detected",
      diffInfo: {
        role: "right",
        otherUri: this.pendingChatBaselineDocument.uri.toString(),
        instanceId: this.host.instanceId,
        changes,
        stats: rightStats,
        htmlLines: leftHtmlLines,
        isHtmlBased: true,
      },
    });

    this.singleViewDiffApplied = true;
  }

  /**
   * Wait for both panels to have their webviews ready
   * Returns when both panels signal they are ready
   */
  private async waitForBothPanelsReady(
    leftPanel: DiffHost,
    rightPanel: DiffHost
  ): Promise<void> {
    const maxAttempts = 30; // 3 seconds max wait
    let attempts = 0;

    while ((!leftPanel.webviewReady || !rightPanel.webviewReady) && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    if (!leftPanel.webviewReady || !rightPanel.webviewReady) {
      logger.warn(`[${this.host.instanceId}] ⚠️  Timeout waiting for both panels to be ready (left: ${leftPanel.webviewReady}, right: ${rightPanel.webviewReady})`);
    } else {
      logger.debug(`[${this.host.instanceId}]   ✅ Both panels are ready`);
    }
  }

  /**
   * Update diff visualization for this instance when document changes
   * This is called when the document content changes and this editor is in diff view
   * OPTIMIZED: Only uses HTML-based diff, calculates once, and sends to both panels
   * DEBOUNCED: Waits 500ms after typing stops to prevent constant recalculation
   */
  public async updateDiffVisualization(): Promise<void> {
    if (!this.isDiffView || !this.otherDiffUri) {
      logger.debug(
        `[${this.host.instanceId}] ⚠️  updateDiffVisualization called but not in diff view`
      );
      return;
    }

    const diffSupport = (global as any).markdownDiffViewSupport;
    if (!diffSupport || !this.host.tab) {
      logger.debug(
        `[${this.host.instanceId}] ❌ No diffSupport available for diff update`
      );
      return;
    }

    // DEBOUNCING: Cancel any pending diff update and schedule a new one
    // This prevents constant recalculation while user is typing
    if (this.updateDebounceTimeout) {
      clearTimeout(this.updateDebounceTimeout);
    }

    this.updateDebounceTimeout = setTimeout(async () => {
      logger.debug(
        `[${this.host.instanceId}] 🔄 Updating diff visualization after document change`
      );

      const diffPanels = DiffViewController.panelTracking.get(this.host.tab!);
      const leftPanel = diffPanels?.left;
      const rightPanel = diffPanels?.right;

      if (!leftPanel || !rightPanel) {
        logger.warn(`[${this.host.instanceId}] Cannot update HTML diff: missing panel(s)`);
        return;
      }

      // Reset both panels' diff applied flags
      leftPanel.diff.diffApplied = false;
      rightPanel.diff.diffApplied = false;
      leftPanel.postInlineSuggestionEligibility();
      rightPanel.postInlineSuggestionEligibility();

      // Check if a diff calculation is already in progress for this tab
      const existingCalculation = DiffViewController.calculationInProgress.get(this.host.tab!);
      if (existingCalculation) {
        logger.debug(`[${this.host.instanceId}]   ⏳ Diff update already in progress, waiting...`);
        await existingCalculation;
        return;
      }

      // Start a new diff calculation and track it
      const calculationPromise = this.calculateAndApplyDiff(leftPanel, rightPanel, diffSupport);
      DiffViewController.calculationInProgress.set(this.host.tab!, calculationPromise);

      try {
        await calculationPromise;
      } finally {
        // Clean up the tracking entry
        DiffViewController.calculationInProgress.delete(this.host.tab!);
      }

      logger.debug(`[${this.host.instanceId}]   ✅ Diff update completed`);
    }, 500); // Wait 500ms after last change before updating diff
  }
}
