import "./preload";
import { AgentActivityController } from "./agent-activity-controller";
import "./agent-activity.css";
import { EditorContextController } from "./editor-context-controller";

import { fixCut, fixLinkClick, saveVditorOptions } from "./utils";

import "vditor/dist/index.css";
// Note: Vditor i18n and icons are loaded as separate <script> tags in the HTML
// before main.js to ensure they execute first and set window.VditorI18n and insert SVG icons

// Renderer System
import { initializeRendererSystem } from "./renderers";
import "./main.css";
import "./vscode-integration.css";
import { diffVisualizer } from "./diff-visualizer";
import { initializeWidgetSystem } from "./widget-integration";
import { inlineSuggestionController } from "./inline-suggestion-ui";
import { applySelectedTools } from "./tool-selector";
import { state, vscodeLog } from "./webview-state";
import { initVditor, processAfterRender } from "./init-vditor";
import { dispatchVditorInput, getWebviewContentSync } from "./content-sync";
import { SourcePositionNavigationController } from "./source-position-navigation";
import { showEmbedPreview } from "./embed-preview";
import { createDocumentSyncRoutes } from "./document-sync-routes";
import { installCalendarBridge } from "./calendar-bridge";
import { aiMarkdownRoutes, syncAiMarkdownFromUpdate } from "./ai-markdown-bridge";
import {
  createHostMessageRouter,
  type HostMessage,
  type HostMessageRoutes,
} from "./host-message-router";

const agentActivity = new AgentActivityController({
  getMarkdown: () => window.vditor?.getValue() ?? '',
  renderSource: source => {
    const lute = (window.vditor as any)?.vditor?.lute;
    return lute ? lute.VditorIRDOM2Md(lute.Md2VditorIRDOM(source)) : source;
  },
});
window.addEventListener('beforeunload', () => agentActivity.dispose(), { once: true });

const editorContext = new EditorContextController({
  getMarkdown: () => {
    try { return getWebviewContentSync().getContent(); } catch { return ''; }
  },
  postMessage: message => vscode?.postMessage(message),
});
window.addEventListener('beforeunload', () => editorContext.dispose(), { once: true });

const sourcePositionNavigation = new SourcePositionNavigationController({
  getMarkdown: () => (window as any).vditor?.getValue?.() ?? "",
});

// Initialize diff visualizer - must be called to set up message listeners
diffVisualizer.initialize();

// Coordination flag to avoid duplicate custom menu builds
(window as any).__vditorHandledContextMenu = false;

// Initialize widget system early
initializeWidgetSystem();

// Initialize renderer system
initializeRendererSystem();


// ---- Host message routes ------------------------------------------------
// Each group owns the host commands for one webview feature. The router parses
// every message against the shared protocol before any group sees it.

const documentRoutes: HostMessageRoutes = {
  'agent-activity': message => agentActivity.receive(message),
  'editor-context-source': message => { editorContext.setSource(message); agentActivity.setSource(message); },
  ...createDocumentSyncRoutes({
    getContentSync: getWebviewContentSync,
    recordDocumentState: (msg) => {
      agentActivity.setGeneration(msg.generation);
      syncAiMarkdownFromUpdate(msg);
      // Store document filename for renderer system
      if (msg.documentFilename) {
        (window as any).currentDocumentFilename = msg.documentFilename;
      }
      // Store readOnly state
      if (msg.isReadOnly !== undefined) {
        state.isReadOnly = msg.isReadOnly;
      }
    },
    initializeEditor: (msg) => {
      if (isRecord(msg.options) && msg.options.useVscodeThemeColor) {
        document.body.setAttribute("data-use-vscode-theme-color", "1");
      } else {
        document.body.setAttribute("data-use-vscode-theme-color", "0");
      }
      try {
        initVditor(msg);
      } catch (error) {
        // reset options when error
        initVditor({
          content: msg.content,
          generation: msg.generation,
          documentFilename: msg.documentFilename,
          cdnBaseUri: msg.cdnBaseUri,
        });
        saveVditorOptions();
      }
    },
    replaceEditorContent: (content) => vditor.setValue(content),
    afterExternalUpdate: () => {
      // Notify diagnostic visualizer about external change
      state.diagnosticVisualizer?.handleExternalChange();
      // Re-process wiki-links and diagnostics after setValue
      processAfterRender();
      inlineSuggestionController.handleExternalUpdate();
    },
    applyDiagnostics: (msg, forceApply) => {
      state.lastDiagnostics.length = 0;
      msg.diagnostics.forEach((d) => state.lastDiagnostics.push(d));
      // Force apply right after an external change (undo/redo)
      state.diagnosticVisualizer?.updateDiagnostics(
        msg.diagnostics,
        { documentText: msg.documentText, documentLines: msg.documentLines },
        forceApply,
      );
    },
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  }),
  revealSourcePosition: (msg) => {
    void sourcePositionNavigation.reveal(msg.target).then((result) => {
      vscodeLog(`[source-position] ${result.status}${result.match ? ` line=${result.match.renderedLine} confidence=${result.match.confidence}` : ""}`);
    });
  },
  uploaded: (msg) => {
    msg.files.forEach((f) => {
      if (f.endsWith(".wav")) {
        vditor.insertValue(
          `\n\n<audio controls="controls" src="${f}"></audio>\n\n`
        );
      } else {
        const i = new Image();
        i.src = f;
        i.onload = () => {
          vditor.insertValue(`\n\n![](${f})\n\n`);
        };
        i.onerror = () => {
          vditor.insertValue(`\n\n[${f.split("/").slice(-1)[0]}](${f})\n\n`);
        };
      }
    });
  },
  messageRejected: (msg) => {
    vscodeLog(`⚠️ Host rejected "${msg.rejectedCommand}": ${msg.issues.join("; ")}`);
  },
};

// Native VS Code integration replies are owned by the integrator.
const forwardToIntegrator = (msg: HostMessage<"contextMenuActions" | "clipboardWriteResult" | "clipboardReadResult">) => {
  state.vscodeIntegrator?.handleVSCodeMessage(msg);
};
const vscodeIntegrationRoutes: HostMessageRoutes = {
  contextMenuActions: forwardToIntegrator,
  clipboardWriteResult: forwardToIntegrator,
  clipboardReadResult: forwardToIntegrator,
};

const insertValue = (text: string) => {
  if (window.vditor) {
    window.vditor.insertValue(text);
  }
};
const requestRendererInsertion = (rendererType: "kanban-board" | "table") => {
  if (window.vditor) {
    // Request a new renderer with file creation
    vscode?.postMessage({ command: "requestInsertRenderer", rendererType });
  }
};

const editorCommandRoutes: HostMessageRoutes = {
  insertLink: () => insertValue("[Link Text](https://example.com)"),
  insertImage: () => insertValue("![Alt Text](image.png)"),
  insertTable: () => insertValue(`
| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Row 1    | Data     | Data     |
| Row 2    | Data     | Data     |
`),
  // Playground doesn't use external files, insert directly
  insertPlayground: () => insertValue(`\n\`\`\`playground\nconsole.log('Hello, World!');\n\`\`\`\n`),
  insertKanbanBoard: () => requestRendererInsertion("kanban-board"),
  insertInteractiveTable: () => requestRendererInsertion("table"),
  insertWidget: (msg) => {
    if (msg.widgetBlock) insertValue(msg.widgetBlock);
  },
  insertRendererCodeBlock: (msg) => {
    if (msg.codeBlock) insertValue(msg.codeBlock);
  },
  showFind: () => state.findReplaceManager?.showFind(),
  showFindReplace: () => state.findReplaceManager?.showFindReplace(),
  navigateToHeading: (msg) => {
    if (state.wikiLinkHandler && msg.heading) {
      (state.wikiLinkHandler as any).scrollToHeading(msg.heading);
    }
  },
  openEmbedPreview: (msg) => showEmbedPreview(msg.embed ?? {}),
};

const aiRoutes: HostMessageRoutes = {
  nativeToolSelectorResult: (msg) => applySelectedTools(msg.selectedTools ?? []),
};

// Calendar replies are re-dispatched as window events that widgets listen for.
const forwardCalendarEvent = (msg: HostMessage<"calendar-events" | "calendar-loading" | "calendar-error" | "calendar-auth-result" | "calendar-signout-result">) => {
  const { command, ...detail } = msg;
  window.dispatchEvent(new CustomEvent(command, { detail, bubbles: true }));
};
const calendarRoutes: HostMessageRoutes = {
  "calendar-events": forwardCalendarEvent,
  "calendar-loading": forwardCalendarEvent,
  "calendar-error": forwardCalendarEvent,
  "calendar-auth-result": forwardCalendarEvent,
  "calendar-signout-result": forwardCalendarEvent,
};

const diffHtmlRoutes: HostMessageRoutes = {
  requestIRHtml: (msg) => {
    // Handle request for clean IR HTML content for diff calculation
    (window as any).markdownEditorLog?.(
      `[WEBVIEW] Received requestIRHtml with requestId: ${msg.requestId}`
    );
    try {
      vscode?.postMessage({
        command: "irHtmlResponse",
        html: vditor.getHTML(), // still use vditor.getHTML() to ensure consistency
        requestId: msg.requestId,
      });
    } catch (error) {
      (window as any).markdownEditorLog?.(
        `[WEBVIEW] Error processing requestIRHtml: ${error}`
      );
      vscode?.postMessage({
        command: "irHtmlResponse",
        html: null,
        requestId: msg.requestId,
        error: String(error),
      });
    }
  },
  requestRenderedMarkdownHtml: (msg) => {
    void (async () => {
      try {
        if (!state.renderMarkdownToHtmlForDiff) {
          throw new Error("Hidden diff renderer is not initialized");
        }

        const html = await state.renderMarkdownToHtmlForDiff(
          msg.markdown || "",
          msg.documentFilename
        );

        vscode?.postMessage({
          command: "renderedMarkdownHtmlResponse",
          html,
          requestId: msg.requestId,
        });
      } catch (error) {
        (window as any).markdownEditorLog?.(
          `[WEBVIEW] Error processing requestRenderedMarkdownHtml: ${error}`
        );
        vscode?.postMessage({
          command: "renderedMarkdownHtmlResponse",
          html: null,
          requestId: msg.requestId,
          error: String(error),
        });
      }
    })();
  },
};

const rendererRoutes: HostMessageRoutes = {
  "renderer-update-code-block": (msg) => {
    // Handle code block update when switching renderer types or invalid data is detected
    // Find the code block with the board ID
    const language =
      msg.rendererId === "kanban-board" ? "kanban-board" : "table";
    const codeBlocks = Array.from(
      document.querySelectorAll(`code.language-${language}`)
    );

    for (const codeBlock of codeBlocks) {
      const content = codeBlock.textContent || "";

      // Check if this is the code block we need to update
      const boardMatch = content.match(
        /<!--\s*(?:board|table):\s*([^\-\s]+)\s*-->/
      );
      if (boardMatch && boardMatch[1] === msg.boardId) {
        // Update the board ID comment (in case it's using wrong renderer name)
        const correctComment =
          msg.rendererId === "kanban-board"
            ? `<!-- board: ${msg.boardId} -->`
            : `<!-- table: ${msg.boardId} -->`;

        // Build the new content with correct file reference and board comment
        const fileComment = `<!-- file: assets/${msg.filename} -->\n`;
        let newContent = content;

        // Update or add file comment
        if (content.includes("<!-- file:")) {
          // Replace existing file comment
          newContent = content.replace(
            /<!--\s*file:\s*[^>]+-->/i,
            fileComment.trim()
          );
        } else {
          // Add file comment at the beginning
          newContent = fileComment + content;
        }

        // Ensure correct board/table comment exists
        if (!newContent.includes(correctComment)) {
          // Replace old comment with correct one
          newContent = newContent.replace(
            /<!--\s*(?:board|table):\s*[^>]+-->/,
            correctComment
          );
        }

        (codeBlock as HTMLElement).textContent = newContent;

        // CRITICAL: Sync the updated content back to VS Code AND trigger re-render
        if (window.vditor) {
          dispatchVditorInput(vditor);
          processAfterRender();
        }
        break;
      }
    }
  },
};

const routeHostMessage = createHostMessageRouter({
  routeGroups: [
    documentRoutes,
    vscodeIntegrationRoutes,
    editorCommandRoutes,
    aiRoutes,
    aiMarkdownRoutes,
    calendarRoutes,
    diffHtmlRoutes,
    rendererRoutes,
  ],
  reportMalformed: (command, issues) => {
    vscodeLog(`⚠️ Ignored malformed host message "${command}": ${issues.join("; ")}`);
  },
});

window.addEventListener("message", (e) => {
  routeHostMessage(e.data);
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

installCalendarBridge(window, (message) => vscode?.postMessage(message));

// when window is loaded
window.addEventListener('load', () => {
  vscode?.postMessage({ command: "ready" });
  fixLinkClick();
  fixCut();
});
