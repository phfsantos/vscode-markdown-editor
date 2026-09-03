import * as vscode from "vscode";
import { logger } from "../utils/Logger";
import { classifyAIMarkdownFileName } from "../services/AIMarkdownDetector";
import { AIMarkdownWorkflowService } from "../services";
import { InlineSuggestionService } from "../services/InlineSuggestionService";

/**
 * The slice of an editor panel the AI handlers need. EditorPanel implements
 * this; the diff-view flag and pending-chat baseline come from its
 * DiffViewController.
 */
export interface AiHost {
  readonly document: vscode.TextDocument;
  readonly uri: vscode.Uri;
  readonly config: vscode.WorkspaceConfiguration;
  readonly readOnly: boolean;
  readonly isDiffView: boolean;
  readonly pendingChatBaselineDocument: vscode.TextDocument | undefined;
  postMessage(message: unknown): void;
}

/**
 * Webview message handlers for the AI markdown features: inline suggestion
 * requests, add-to-chat, the native language-model tool selector, and the
 * AI markdown context/template/validate/chat actions.
 *
 * Extracted from EditorPanel.
 */
export class AiMessageHandler {
  private readonly inlineSuggestionService = InlineSuggestionService.getInstance();

  constructor(private readonly host: AiHost) {}

  public getInlineSuggestionLanguageId(): string {
    const languageId = this.host.document.languageId;
    if (["markdown", "chatagent", "skill", "prompt"].includes(languageId)) {
      return languageId;
    }

    return "markdown";
  }

  public isAIMarkdownDocument(): boolean {
    return classifyAIMarkdownFileName(this.host.document.fileName || this.host.uri.fsPath).isAIMarkdown;
  }

  public isInlineSuggestionSettingEnabled(): boolean {
    return this.host.config.get<boolean>("ai.enableInlineSuggestions", false);
  }

  public canShowInlineSuggestions(): boolean {
    return this.isInlineSuggestionSettingEnabled() && !this.host.readOnly && !this.host.isDiffView;
  }

  public canShowAddToChatButton(): boolean {
    return !this.host.isDiffView && !this.isAIMarkdownDocument();
  }

  public postInlineSuggestionEligibility(): void {
    this.host.postMessage({
      command: "inlineSuggestionEligibility",
      enabled: this.canShowInlineSuggestions(),
      languageId: this.getInlineSuggestionLanguageId(),
    });
  }

  public async handleNativeToolSelector(selectedTools: string[]): Promise<void> {
    const allTools = vscode.lm?.tools ?? [];
    if (allTools.length === 0) {
      vscode.window.showInformationMessage('No language model tools are currently available.');
      return;
    }

    // ── Tree node model ─────────────────────────────────────────────────────────
    type TreeNode = {
      id: string;          // unique node id
      label: string;       // text shown in the QuickPick
      description?: string;
      isLeaf: boolean;
      children: TreeNode[];
      leafToolName?: string; // only for leaves: the actual tool name to store
    };

    // Built-in categories displayed at level 2 under "Built-In"
    const BUILTIN_CATEGORIES = new Set([
      'agent', 'browser', 'vscode', 'web', 'read', 'execute', 'edit', 'search',
    ]);

    // ── Extension matchers (used to classify tools by name prefix) ─────────────
    const extensions = vscode.extensions.all
      .map((ext) => {
        const [publisher, shortName] = ext.id.split('.');
        return {
          id: ext.id,
          publisher: (publisher ?? '').toLowerCase(),
          shortName: (shortName ?? '').toLowerCase(),
        };
      })
      .filter((e) => e.shortName);

    // ── Top-level groups ───────────────────────────────────────────────────────
    const builtInRoot: TreeNode = { id: 'root:builtin', label: 'Built-In', isLeaf: false, children: [] };
    const builtInCategoryNodes = new Map<string, TreeNode>();
    const extensionRoots = new Map<string, TreeNode>();
    const mcpRoots = new Map<string, TreeNode>();

    const getBuiltInCategory = (cat: string): TreeNode => {
      let node = builtInCategoryNodes.get(cat);
      if (!node) {
        node = { id: `builtin:${cat}`, label: cat, isLeaf: false, children: [] };
        builtInCategoryNodes.set(cat, node);
        builtInRoot.children.push(node);
      }
      return node;
    };

    const getExtensionGroup = (extId: string): TreeNode => {
      let node = extensionRoots.get(extId);
      if (!node) {
        node = { id: `ext:${extId}`, label: extId, isLeaf: false, children: [] };
        extensionRoots.set(extId, node);
      }
      return node;
    };

    const getMcpGroup = (server: string): TreeNode => {
      let node = mcpRoots.get(server);
      if (!node) {
        node = { id: `mcp:${server}`, label: server, isLeaf: false, children: [] };
        mcpRoots.set(server, node);
      }
      return node;
    };

    // Without the `mcpServerDefinitions` proposed API we can't ask VS Code which
    // server owns which tool, so we recover the server name from `mcp_<server>_<tool>`
    // by finding the longest prefix shared by 2+ MCP tools. This correctly groups
    // multi-segment server names (e.g. `github_mcp_server`) that the naive
    // "second segment" rule would collapse into just `github`.
    const mcpToolNamesLower = allTools
      .map((t) => t.name.toLowerCase())
      .filter((n) => n.startsWith('mcp_'));

    const detectMcpServer = (toolName: string): string => {
      const stripped = toolName.toLowerCase().slice('mcp_'.length);
      const parts = stripped.split('_');
      if (parts.length === 0) return 'mcp';
      for (let i = parts.length - 1; i >= 1; i--) {
        const candidate = parts.slice(0, i).join('_');
        const prefix = `mcp_${candidate}_`;
        const matches = mcpToolNamesLower.filter((n) => n.startsWith(prefix)).length;
        if (matches >= 2) return candidate;
      }
      return parts[0] || 'mcp';
    };

    // ── Classify every tool ────────────────────────────────────────────────────
    for (const tool of allTools) {
      const lower = tool.name.toLowerCase();
      const tags = (tool.tags ?? []).map((t) => t.toLowerCase());

      // 1. MCP tools — name starts with mcp_<server>_…
      if (lower.startsWith('mcp_')) {
        const server = detectMcpServer(tool.name);
        getMcpGroup(server).children.push({
          id: tool.name, label: tool.name, description: tool.description,
          isLeaf: true, children: [], leafToolName: tool.name,
        });
        continue;
      }

      // 2. Extension tools — name starts with an installed extension's short name
      const extMatch = extensions.find((ext) =>
        lower.startsWith(ext.shortName + '_') ||
        lower.startsWith(ext.shortName + '-') ||
        lower.startsWith(ext.shortName + '.')
      );
      if (extMatch) {
        getExtensionGroup(extMatch.id).children.push({
          id: tool.name, label: tool.name, description: tool.description,
          isLeaf: true, children: [], leafToolName: tool.name,
        });
        continue;
      }

      // 3. Everything else is Built-In
      const category = [...BUILTIN_CATEGORIES].find((c) => tags.includes(c));
      if (category) {
        const catNode = getBuiltInCategory(category);
        // A tool whose name == its category (e.g. tool "browser" tagged "browser")
        // acts as the category header — use its description, don't add as child.
        if (lower === category) {
          catNode.description = tool.description;
        } else {
          catNode.children.push({
            id: tool.name, label: tool.name, description: tool.description,
            isLeaf: true, children: [], leafToolName: tool.name,
          });
        }
      } else {
        // No recognised category tag — sits directly under Built-In (e.g. 'todo')
        builtInRoot.children.push({
          id: tool.name, label: tool.name, description: tool.description,
          isLeaf: true, children: [], leafToolName: tool.name,
        });
      }
    }

    // Sort children alphabetically at every level
    const sortChildren = (n: TreeNode) => {
      n.children.sort((a, b) => a.label.localeCompare(b.label));
      for (const c of n.children) sortChildren(c);
    };

    const rootGroups: TreeNode[] = [];
    if (builtInRoot.children.length > 0) rootGroups.push(builtInRoot);
    for (const r of extensionRoots.values()) rootGroups.push(r);
    for (const r of mcpRoots.values()) rootGroups.push(r);
    for (const r of rootGroups) sortChildren(r);

    // Index all nodes by id for fast lookup
    const nodesById = new Map<string, TreeNode>();
    const indexNode = (n: TreeNode) => {
      nodesById.set(n.id, n);
      for (const c of n.children) indexNode(c);
    };
    for (const r of rootGroups) indexNode(r);

    const collectLeafs = (n: TreeNode): string[] => {
      if (n.isLeaf) return [n.leafToolName!];
      const out: string[] = [];
      for (const c of n.children) out.push(...collectLeafs(c));
      return out;
    };

    // ── Hydrate selection from frontmatter ─────────────────────────────────────
    // Stored entries may reference a group label (e.g. "browser") or a leaf
    // tool name. Expand any group label to its leaves; preserve unknown values.
    const selectedLeafs = new Set<string>();
    const unknownStored: string[] = [];
    for (const stored of selectedTools) {
      const node = [...nodesById.values()].find((n) => n.label === stored);
      if (node) {
        for (const l of collectLeafs(node)) selectedLeafs.add(l);
      } else {
        unknownStored.push(stored);
      }
    }

    // ── Expand/collapse state ──────────────────────────────────────────────────
    const manualExpanded = new Set<string>();
    // Default: Built-In expanded if anything inside it is selected
    if (builtInRoot.children.some((c) => collectLeafs(c).some((l) => selectedLeafs.has(l)))) {
      manualExpanded.add(builtInRoot.id);
    }
    let searching = false;
    const isExpanded = (id: string) => searching || manualExpanded.has(id);

    // ── Selection state per node ───────────────────────────────────────────────
    const getNodeState = (n: TreeNode): 'all' | 'some' | 'none' => {
      if (n.isLeaf) return selectedLeafs.has(n.leafToolName!) ? 'all' : 'none';
      const leafs = collectLeafs(n);
      if (leafs.length === 0) return 'none';
      const sel = leafs.filter((l) => selectedLeafs.has(l)).length;
      if (sel === 0) return 'none';
      if (sel === leafs.length) return 'all';
      return 'some';
    };

    // ── Flatten the tree into QuickPick items ─────────────────────────────────
    type PickItem = vscode.QuickPickItem & { nodeId: string; isGroup: boolean };

    const buildItems = (): PickItem[] => {
      const items: PickItem[] = [];
      const addNode = (n: TreeNode, level: number) => {
        const indent = '  '.repeat(level);
        const state = getNodeState(n);
        const expanded = isExpanded(n.id);

        let description = n.description ?? '';
        // Workaround for QuickPick's lack of native indeterminate checkboxes:
        // surface partial selection as "(N/M)" in the description.
        if (!n.isLeaf && state === 'some') {
          const leafs = collectLeafs(n);
          const sel = leafs.filter((l) => selectedLeafs.has(l)).length;
          const partial = `(${sel}/${leafs.length})`;
          description = description ? `${partial}  ${description}` : partial;
        }

        const item: PickItem = {
          label: indent + n.label,
          description,
          nodeId: n.id,
          isGroup: !n.isLeaf,
        };
        // Partial-selection visual hint next to label (closest we can get to
        // an indeterminate checkbox in QuickPick).
        if (!n.isLeaf && state === 'some') {
          item.iconPath = new vscode.ThemeIcon('dash');
        }
        if (!n.isLeaf) {
          item.buttons = [{
            iconPath: new vscode.ThemeIcon(expanded ? 'chevron-down' : 'chevron-right'),
            tooltip: expanded ? 'Collapse' : 'Expand',
          }];
        }
        items.push(item);

        if (!n.isLeaf && expanded) {
          for (const c of n.children) addNode(c, level + 1);
        }
      };
      for (const r of rootGroups) addNode(r, 0);
      return items;
    };

    // ── QuickPick setup ───────────────────────────────────────────────────────
    const qp = vscode.window.createQuickPick<PickItem>();
    qp.title = 'Configure Agent Tools';
    qp.placeholder = 'Search tools…';
    qp.canSelectMany = true;
    qp.matchOnDescription = true;

    let updating = false;
    let lastSelectedNodeIds = new Set<string>();

    const refreshSelection = () => {
      updating = true;
      const newSel = qp.items.filter((item) => {
        const n = nodesById.get(item.nodeId);
        return n ? getNodeState(n) === 'all' : false;
      });
      qp.selectedItems = newSel;
      lastSelectedNodeIds = new Set(newSel.map((i) => i.nodeId));
      updating = false;
    };

    const rebuild = () => {
      updating = true;
      qp.items = buildItems();
      refreshSelection();
      updating = false;
    };

    qp.onDidTriggerItemButton(({ item }) => {
      if (!item.isGroup) return;
      if (manualExpanded.has(item.nodeId)) manualExpanded.delete(item.nodeId);
      else manualExpanded.add(item.nodeId);
      rebuild();
    });

    // Auto-expand all groups while the user is searching so leaves are visible.
    qp.onDidChangeValue((value) => {
      const wasSearching = searching;
      searching = !!value;
      if (wasSearching !== searching) rebuild();
    });

    // Cascading selection: toggling a node toggles every leaf below it.
    qp.onDidChangeSelection((items) => {
      if (updating) return;
      const newIds = new Set(items.map((i) => i.nodeId));
      for (const id of newIds) {
        if (!lastSelectedNodeIds.has(id)) {
          const n = nodesById.get(id);
          if (n) for (const l of collectLeafs(n)) selectedLeafs.add(l);
        }
      }
      for (const id of lastSelectedNodeIds) {
        if (!newIds.has(id)) {
          const n = nodesById.get(id);
          if (n) for (const l of collectLeafs(n)) selectedLeafs.delete(l);
        }
      }
      refreshSelection();
    });

    rebuild();

    // ── Compact selection for storage ─────────────────────────────────────────
    // If every leaf under a group is selected, store the group label instead of
    // every leaf — matches the existing frontmatter convention (e.g. "browser"
    // for all browser tools).
    const compactSelection = (): string[] => {
      const out: string[] = [];
      const consumed = new Set<string>();

      const emitGroupOrLeaves = (n: TreeNode) => {
        if (n.isLeaf) {
          if (selectedLeafs.has(n.leafToolName!) && !consumed.has(n.leafToolName!)) {
            out.push(n.leafToolName!);
            consumed.add(n.leafToolName!);
          }
          return;
        }
        const leafs = collectLeafs(n);
        if (leafs.length > 0 && leafs.every((l) => selectedLeafs.has(l))) {
          out.push(n.label);
          for (const l of leafs) consumed.add(l);
        } else {
          for (const c of n.children) emitGroupOrLeaves(c);
        }
      };

      // Built-In: emit each category (or direct tool) individually.
      // Don't collapse to "Built-In" since the frontmatter convention is
      // category-level (browser, edit, …), not source-level.
      for (const child of builtInRoot.children) emitGroupOrLeaves(child);

      // Extensions & MCP: collapse to the group label when everything inside
      // is selected, else emit individual leaves.
      for (const grp of [...extensionRoots.values(), ...mcpRoots.values()]) {
        emitGroupOrLeaves(grp);
      }

      // Preserve names we didn't recognise so the user doesn't lose them.
      for (const u of unknownStored) {
        if (!consumed.has(u)) out.push(u);
      }
      return out;
    };

    const result = await new Promise<string[] | null>((resolve) => {
      let settled = false;
      qp.onDidAccept(() => {
        settled = true;
        resolve(compactSelection());
        qp.hide();
      });
      qp.onDidHide(() => {
        if (!settled) resolve(null);
        qp.dispose();
      });
      qp.show();
    });

    if (result !== null) {
      this.host.postMessage({ command: 'nativeToolSelectorResult', selectedTools: result });
    }
  }

  public async handleInlineSuggestionRequest(message: any): Promise<void> {
    const requestId = String(message?.requestId || "");
    if (!requestId) {
      return;
    }

    if (!this.canShowInlineSuggestions()) {
      this.host.postMessage({
        command: "inlineSuggestionResult",
        requestId,
        suggestion: "",
      });
      return;
    }

    const content = typeof message?.content === "string"
      ? message.content
      : this.host.document.getText();
    const beforeCursor = typeof message?.beforeCursor === "string"
      ? message.beforeCursor
      : content;
    const afterCursor = typeof message?.afterCursor === "string"
      ? message.afterCursor
      : "";

    const source = new vscode.CancellationTokenSource();
    try {
      const suggestion = await this.inlineSuggestionService.getSuggestion(
        {
          document: this.host.document,
          content,
          beforeCursor,
          afterCursor,
          languageId: this.getInlineSuggestionLanguageId(),
          manual: Boolean(message?.manual),
        },
        source.token
      );

      this.host.postMessage({
        command: "inlineSuggestionResult",
        requestId,
        suggestion: suggestion || "",
      });
    } catch (error) {
      logger.warn("Inline suggestion request failed", error);
      this.host.postMessage({
        command: "inlineSuggestionResult",
        requestId,
        suggestion: "",
      });
    } finally {
      source.dispose();
    }
  }

  public async handleAddToChatRequest(): Promise<void> {
    if (!this.canShowAddToChatButton()) {
      return;
    }

    try {
      const availableCommands = await vscode.commands.getCommands(true);
      if (!availableCommands.includes("chat.inlineResourceAnchor.addFileToChat")) {
        return;
      }

      await vscode.commands.executeCommand(
        "chat.inlineResourceAnchor.addFileToChat",
        this.host.uri,
        true
      );
    } catch (error) {
      logger.warn("Failed to add resource to chat", error);
    }
  }

  public async handleAIMarkdownAction(message: any): Promise<void> {
    if (this.host.isDiffView) {
      this.host.postMessage({
        command: "aiMarkdownActionResult",
        message: "AI tools are unavailable in diff view.",
        level: "warning",
      });
      return;
    }

    const aiWorkflowService = AIMarkdownWorkflowService.getInstance();
    const action = String(message?.action || "");

    try {
      switch (action) {
        case "copyContext": {
          await aiWorkflowService.copyContextPackage(this.host.document, {
            hasPendingChatEdits: Boolean(this.host.pendingChatBaselineDocument),
          });
          this.host.postMessage({
            command: "aiMarkdownActionResult",
            message: "AI context copied to the clipboard.",
            level: "info",
          });
          return;
        }
        case "insertContext": {
          const contextPackage = await aiWorkflowService.buildContextPackage(this.host.document, {
            hasPendingChatEdits: Boolean(this.host.pendingChatBaselineDocument),
          });
          this.host.postMessage({
            command: "insertTextAtCursor",
            text: contextPackage.markdown,
          });
          this.host.postMessage({
            command: "aiMarkdownActionResult",
            message: "Structured AI context inserted at the cursor.",
            level: "info",
          });
          return;
        }
        case "insertTemplate": {
          this.host.postMessage({
            command: "insertTextAtCursor",
            text: aiWorkflowService.getTemplateSnippet(this.host.document),
          });
          this.host.postMessage({
            command: "aiMarkdownActionResult",
            message: "AI markdown template inserted.",
            level: "info",
          });
          return;
        }
        case "openChat": {
          const result = await aiWorkflowService.openChatWorkflow(this.host.document, {
            hasPendingChatEdits: Boolean(this.host.pendingChatBaselineDocument),
          });
          this.host.postMessage({
            command: "aiMarkdownActionResult",
            message: result.message,
            level: result.openedChat ? "info" : "warning",
          });
          return;
        }
        case "openGraph": {
          await vscode.commands.executeCommand("markdown-editor.openGraphView", {
            docUri: this.host.document.uri.toString(),
            depth: 1,
            maxNodes: 24,
            showDirectLinksOnly: false,
          });
          this.host.postMessage({
            command: "aiMarkdownActionResult",
            message: "Graph view opened for the current markdown file.",
            level: "info",
          });
          return;
        }
        case "validate": {
          const validation = aiWorkflowService.validateDocument(this.host.document);
          if (!validation.isAIMarkdown) {
            this.host.postMessage({
              command: "aiMarkdownActionResult",
              message: "This file is not classified as AI markdown by filename.",
              level: "warning",
            });
            return;
          }

          this.host.postMessage({
            command: "aiMarkdownActionResult",
            message: validation.isValid
              ? "AI markdown validation passed."
              : `Missing sections: ${validation.missingSections.join(", ")}`,
            level: validation.isValid ? "info" : "warning",
          });
          return;
        }
        default: {
          this.host.postMessage({
            command: "aiMarkdownActionResult",
            message: `Unsupported AI markdown action: ${action}`,
            level: "warning",
          });
          return;
        }
      }
    } catch (error) {
      logger.error("[EditorPanel] AI markdown action failed", error);
      this.host.postMessage({
        command: "aiMarkdownActionResult",
        message: `AI markdown action failed: ${error instanceof Error ? error.message : String(error)}`,
        level: "error",
      });
    }
  }
}
