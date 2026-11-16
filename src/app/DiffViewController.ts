import * as vscode from "vscode";
import { logger } from "../utils/Logger";
import { createChatEditingPendingEditSource } from "./chatEditingDiff";
import type { PendingEditSource } from "./pendingEditSource";
import { calculateRoleSpecificDiffStats } from "../diff/roleSpecificStats";
import type { DiffCoordinator } from "../contracts/ports";
import type { WebviewMessageRoutes } from "./webviewMessageRouter";
import type { DiffChangeProjection, DiffInfoProjection, DiffScrollAnchor } from "@markdown-editor/core";
import { DiffSessionRegistry, type DiffSideFacts } from "../diff/DiffSessionRegistry";

/** How long both sides of a diff may take to render before the panes show an error state. */
export const DIFF_RENDER_TIMEOUT_MS = 5000;

/** Next version stamp for a diff projection; webviews skip a re-send with an unchanged version. */
let diffVersion = 0;
const nextDiffVersion = () => ++diffVersion;

/** Keep only the declared change fields so the typed protocol accepts the payload. */
function toChangeProjections(changes: ReadonlyArray<Record<string, any>>): DiffChangeProjection[] {
  return changes.map((change) => ({
    type: change.type,
    lineNumber: change.lineNumber,
    content: change.content ?? "",
    ...(typeof change.oldContent === "string" ? { oldContent: change.oldContent } : {}),
    side: change.side,
    ...(Number.isSafeInteger(change.leftLine) ? { leftLine: change.leftLine } : {}),
    ...(Number.isSafeInteger(change.rightLine) ? { rightLine: change.rightLine } : {}),
  }));
}

/**
 * The slice of an editor panel the diff controller needs. EditorPanel
 * implements this; tests provide lightweight fakes.
 */
export interface DiffHost {
  readonly instanceId: string;
  readonly uri: vscode.Uri;
  readonly document: vscode.TextDocument;
  /** Editor column the panel lives in; both sides of one diff share it. */
  readonly viewColumn: number | undefined;
  readonly webviewReady: boolean;
  /** Vditor has rendered the document (the webview's vditorReady): the diff handshake. */
  readonly renderedReady: boolean;
  readonly panelVisible: boolean;
  readonly panelActive: boolean;
  readonly diff: DiffViewController;
  postMessage(message: unknown): void;
  postInlineSuggestionEligibility(): void;
  requestIRHtml(): Promise<string | null>;
  requestRenderedMarkdownHtml(markdown: string): Promise<string | null>;
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
  /** Pairs the two editors of each diff tab and decides their sides (ADR 0001). */
  static readonly sessions = new DiffSessionRegistry<DiffHost>();
  /** session id -> in-flight diff calculation, to dedupe concurrent triggers */
  static readonly calculationInProgress = new Map<string, Promise<void>>();

  isDiffView = false;
  otherDiffUri: vscode.Uri | undefined;
  diffRole: "left" | "right" | undefined;
  diffApplied = false;
  singleViewDiffApplied = false;
  lastDiffCheckVisible = false;
  pendingChatBaselineDocument: vscode.TextDocument | undefined;
  private updateDebounceTimeout: NodeJS.Timeout | undefined;
  private renderTimeout: NodeJS.Timeout | undefined;

  constructor(
    private readonly host: DiffHost,
    private readonly diffCoordinator?: DiffCoordinator,
    /** Drives the single-view diff; the textDocuments list is read on every refresh. */
    private readonly chatEditingSource: PendingEditSource = createChatEditingPendingEditSource(
      () => vscode.workspace.textDocuments,
    ),
  ) {}

  /** Join this panel's diff session. Sides follow document writability, never the tab label. */
  registerExplicitDiffPanel(facts: DiffSideFacts): void {
    this.isDiffView = true;
    DiffViewController.sessions.join(this.host, this.host.viewColumn ?? 0, facts);
    this.armRenderTimeout();
  }

  /** Clear timers and leave the diff session (only this side). */
  dispose(): void {
    if (this.updateDebounceTimeout) clearTimeout(this.updateDebounceTimeout);
    this.updateDebounceTimeout = undefined;
    this.clearRenderTimeout();
    DiffViewController.sessions.leave(this.host);
  }

  /**
   * This side became the active editor. For two writable files that decides
   * the sides (VS Code focuses the modified side on open); if it changed them
   * after a diff was drawn, both sides are recalculated.
   */
  onActivated(): void {
    if (!this.isDiffView || !DiffViewController.sessions.noteActivated(this.host)) return;
    const partner = DiffViewController.sessions.partnerOf(this.host);
    for (const side of partner ? [this.host, partner] : [this.host]) side.diff.diffApplied = false;
    void this.checkDiffViewContextReactive();
  }

  /** The webview rendered its document: if the partner has too, the diff can be calculated now. */
  onRendered(): void {
    if (!this.isDiffView) return;
    const partner = DiffViewController.sessions.partnerOf(this.host);
    void this.checkDiffViewContextReactive();
    if (partner && !partner.diff.diffApplied) void partner.diff.checkDiffViewContextReactive();
  }

  /**
   * Apply (or clear) the side-by-side diff for this panel. Runs on the rendered
   * handshake, on visibility changes and on webview reloads; the calculation is
   * shared by both sides of a session and starts only once both have rendered.
   */
  public async checkDiffViewContextReactive(): Promise<void> {
    if (this.diffApplied && this.host.panelVisible) return;

    const sessions = DiffViewController.sessions;
    const partner = this.isDiffView ? sessions.partnerOf(this.host) : undefined;
    const role = sessions.roleOf(this.host);
    if (!partner || !role) {
      if (this.diffApplied) {
        this.host.postMessage({ command: "diff-view-cleared" });
        this.diffApplied = false;
      }
      this.host.postInlineSuggestionEligibility();
      return;
    }

    this.otherDiffUri = partner.uri;
    this.diffRole = role;
    this.host.postInlineSuggestionEligibility();

    if (!this.diffCoordinator) {
      logger.debug(`[${this.host.instanceId}] No diff coordinator; side-by-side diff unavailable`);
      return;
    }
    if (!this.host.renderedReady || !partner.renderedReady) {
      this.armRenderTimeout();
      return;
    }
    const [left, right] = role === "left" ? [this.host, partner] : [partner, this.host];
    if (left.diff.diffApplied && right.diff.diffApplied) return;
    await this.runSessionCalculation(left, right);
  }

  private async runSessionCalculation(left: DiffHost, right: DiffHost): Promise<void> {
    const sessionId = DiffViewController.sessions.sessionOf(this.host)!.id;
    const existing = DiffViewController.calculationInProgress.get(sessionId);
    if (existing) {
      await existing;
      return;
    }
    const calculation = this.calculateAndApplyDiff(left, right, this.diffCoordinator!);
    DiffViewController.calculationInProgress.set(sessionId, calculation);
    try {
      await calculation;
    } finally {
      DiffViewController.calculationInProgress.delete(sessionId);
    }
  }

  /**
   * Both sides must render within DIFF_RENDER_TIMEOUT_MS of joining, or both
   * panes say why there is no diff. A side that never found a partner was not a
   * diff at all (diff detection matched a diff tab of the same file in the
   * column): it quietly becomes a plain editor instead of showing an error.
   */
  private armRenderTimeout(): void {
    if (this.renderTimeout) return;
    this.renderTimeout = setTimeout(() => {
      this.renderTimeout = undefined;
      if (this.diffApplied) return;
      const partner = DiffViewController.sessions.partnerOf(this.host);
      if (!partner) {
        DiffViewController.sessions.leave(this.host);
        this.isDiffView = false;
        this.otherDiffUri = undefined;
        this.diffRole = undefined;
        this.host.postInlineSuggestionEligibility();
        logger.debug(`[${this.host.instanceId}] No diff partner joined; treating the editor as a plain editor`);
        return;
      }
      const reason = "Diff unavailable: an editor did not finish rendering";
      for (const side of [this.host, partner]) {
        if (!side.diff.diffApplied) side.postMessage({ command: "diff-view-failed", message: reason });
      }
      logger.warn(`[${this.host.instanceId}] ${reason}`);
    }, DIFF_RENDER_TIMEOUT_MS);
  }

  private clearRenderTimeout(): void {
    if (this.renderTimeout) clearTimeout(this.renderTimeout);
    this.renderTimeout = undefined;
  }

  /**
   * Calculate the HTML diff once and send each side its projection. Called only
   * after both sides rendered, so there is nothing to wait for.
   */
  private async calculateAndApplyDiff(
    leftPanel: DiffHost,
    rightPanel: DiffHost,
    diffSupport: DiffCoordinator
  ): Promise<void> {
    const [leftHtml, rightHtml] = await Promise.all([
      leftPanel.requestIRHtml(),
      rightPanel.requestIRHtml(),
    ]);

    if (!leftHtml || !rightHtml) {
      const message = "Diff unavailable: an editor did not return its rendered content";
      logger.error(`[${this.host.instanceId}] ${message}`);
      leftPanel.postMessage({ command: "diff-view-failed", message });
      rightPanel.postMessage({ command: "diff-view-failed", message });
      return;
    }

    const diffResult = diffSupport.calculateDiffFromHTML(leftHtml, rightHtml);
    const allChanges = diffResult.changes;
    const leftStats = calculateRoleSpecificDiffStats(allChanges, "left");
    const rightStats = calculateRoleSpecificDiffStats(allChanges, "right");
    const changes = toChangeProjections(allChanges as any);
    const project = (role: "left" | "right", self: DiffHost, other: DiffHost): DiffInfoProjection => ({
      role,
      mode: "side-by-side",
      otherUri: other.uri.toString(),
      instanceId: self.instanceId,
      changes,
      stats: role === "left" ? leftStats : rightStats,
      version: nextDiffVersion(),
    });
    for (const [role, self, other] of [["left", leftPanel, rightPanel], ["right", rightPanel, leftPanel]] as const) {
      self.diff.clearRenderTimeout();
      self.diff.isDiffView = true;
      self.diff.diffRole = role;
      self.diff.otherDiffUri = other.uri;
      self.postMessage({ command: "diff-view-detected", diffInfo: project(role, self, other) });
      self.diff.diffApplied = true;
      self.postInlineSuggestionEligibility();
    }
  }

  public isRelevantChatEditingDocument(document: vscode.TextDocument): boolean {
    return this.chatEditingSource.isRelevantDocument(this.host.document, document);
  }

  public refreshPendingChatEditState(): void {
    this.pendingChatBaselineDocument =
      this.chatEditingSource.findPendingEdit(this.host.document)?.compareDocument;
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
      this.host.postMessage({ command: "diff-view-cleared" });
      this.singleViewDiffApplied = false;
      return;
    }

    const diffSupport = this.diffCoordinator;
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
    const changes = diffResult.changes;

    if (changes.length === 0) {
      logger.debug(
        `[${this.host.instanceId}] Pending chat diff cleared - rendered baseline matches current document`
      );
      if (this.singleViewDiffApplied) {
        this.host.postMessage({ command: "diff-view-cleared" });
      }
      this.singleViewDiffApplied = false;
      return;
    }

    const rightStats = calculateRoleSpecificDiffStats(changes, "right");

    logger.debug(
      `[${this.host.instanceId}] Applying pending chat single-view diff with ${changes.length} aligned changes`
    );

    this.host.postMessage({
      command: "diff-view-detected",
      diffInfo: {
        role: "right",
        mode: "inline",
        otherUri: this.pendingChatBaselineDocument.uri.toString(),
        instanceId: this.host.instanceId,
        changes: toChangeProjections(changes as any),
        stats: rightStats,
        version: nextDiffVersion(),
      } satisfies DiffInfoProjection,
    });

    this.singleViewDiffApplied = true;
  }

  /**
   * Update diff visualization for this instance when document changes
   * This is called when the document content changes and this editor is in diff view
   * OPTIMIZED: Only uses HTML-based diff, calculates once, and sends to both panels
   * DEBOUNCED: Waits 500ms after typing stops to prevent constant recalculation
   */
  public async updateDiffVisualization(): Promise<void> {
    if (!this.isDiffView || !this.otherDiffUri || !this.diffCoordinator) return;
    if (this.updateDebounceTimeout) clearTimeout(this.updateDebounceTimeout);
    // Debounced: recalculating on every keystroke would repaint both panes constantly.
    this.updateDebounceTimeout = setTimeout(async () => {
      this.updateDebounceTimeout = undefined;
      const partner = DiffViewController.sessions.partnerOf(this.host);
      const role = DiffViewController.sessions.roleOf(this.host);
      if (!partner || !role) return;
      const [left, right] = role === "left" ? [this.host, partner] : [partner, this.host];
      if (!left.renderedReady || !right.renderedReady) return;
      left.diff.diffApplied = false;
      right.diff.diffApplied = false;
      await this.runSessionCalculation(left, right);
    }, 500);
  }

  /** Diff-view commands owned by this controller. */
  routes(): WebviewMessageRoutes {
    return {
      "diff-scroll-sync": (message) => this.handleScrollSync(message.anchor),
    };
  }

  /**
   * Relay this pane's scroll anchor to its session partner (ADR 0001 §4). The
   * partner is known from the session, so there is no URI lookup to retry; a
   * pane without a partner has nobody to follow it.
   */
  handleScrollSync(anchor: DiffScrollAnchor): void {
    const partner = DiffViewController.sessions.partnerOf(this.host);
    if (!partner?.diff.diffApplied) return;
    partner.postMessage({ command: "diff-scroll-sync", anchor });
  }
}
