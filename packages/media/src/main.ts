import "./preload";

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

// Track when we just received setValue from external change (undo/redo)
let justReceivedExternalChange = false;

// Initialize diff visualizer - must be called to set up message listeners
diffVisualizer.initialize();

// Coordination flag to avoid duplicate custom menu builds
(window as any).__vditorHandledContextMenu = false;

// Initialize widget system early
initializeWidgetSystem();

// Initialize renderer system
initializeRendererSystem();


window.addEventListener("message", (e) => {
  const msg = e.data;

  // Forward VS Code integration messages to integrator
  if (
    state.vscodeIntegrator &&
    (msg.command === "contextMenuActions" ||
      msg.command === "clipboardWriteResult" ||
      msg.command === "clipboardReadResult")
  ) {
    state.vscodeIntegrator.handleVSCodeMessage(msg);
    return;
  }

  switch (msg.command) {
    case "update": {
      // Store document filename for renderer system
      if (msg.documentFilename) {
        (window as any).currentDocumentFilename = msg.documentFilename;
      }

      // Store readOnly state
      if (msg.isReadOnly !== undefined) {
        state.isReadOnly = msg.isReadOnly;
      }

      if (msg.type === "init") {
        if (msg.options && msg.options.useVscodeThemeColor) {
          document.body.setAttribute("data-use-vscode-theme-color", "1");
        } else {
          document.body.setAttribute("data-use-vscode-theme-color", "0");
        }
        try {
          initVditor(msg);
        } catch (error) {
          // reset options when error
          initVditor({ content: msg.content });
          saveVditorOptions();
        }
      } else {
        // Mark that we just received an external change (undo/redo/external edit)
        justReceivedExternalChange = true;
        
        vditor.setValue(msg.content);

        // Notify diagnostic visualizer about external change
        if (state.diagnosticVisualizer) {
          state.diagnosticVisualizer.handleExternalChange();
        }

        // Re-process wiki-links and diagnostics after setValue
        // setValue is called on undo/redo/external changes
        processAfterRender();
        inlineSuggestionController.handleExternalUpdate();
        
        // Clear flag after 500ms (diagnostics should arrive within this window)
        setTimeout(() => {
          justReceivedExternalChange = false;
        }, 500);
      }
      break;
    }
    case "uploaded": {
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
      break;
    }
    case "diagnostics": {
      if (Array.isArray(msg.diagnostics)) {
        // Shallow copy for safe reference
        (Array as any).isArray && (state.lastDiagnostics.length = 0);
        msg.diagnostics.forEach((d) => state.lastDiagnostics.push(d));
      }

      if (state.diagnosticVisualizer) {
        // Pass additional document context to the visualizer
        // Force apply if we just received an external change (undo/redo)
        const shouldForceApply = justReceivedExternalChange;
        
        state.diagnosticVisualizer.updateDiagnostics(
          msg.diagnostics, 
          {
            documentText: msg.documentText,
            documentLines: msg.documentLines,
          },
          shouldForceApply // forceApply=true when from undo/redo
        );
      }
      break;
    }
    case "contextMenuActions": {
      // Handle context menu actions response from VS Code
      if (state.vscodeIntegrator) {
        state.vscodeIntegrator.handleContextMenuActions(msg.actions || []);
      }
      break;
    }
    case "insertLink": {
      // Handle insert link command from VS Code
      if (window.vditor) {
        // Use Vditor's toolbar functionality to insert link
        const linkText = "[Link Text](https://example.com)";
        window.vditor.insertValue(linkText);
      }
      break;
    }
    case "insertImage": {
      // Handle insert image command from VS Code
      if (window.vditor) {
        // Use Vditor's toolbar functionality to insert image
        const imageText = "![Alt Text](image.png)";
        window.vditor.insertValue(imageText);
      }
      break;
    }
    case "showFind": {
      // Handle show find widget command from VS Code
      if (state.findReplaceManager) {
        state.findReplaceManager.showFind();
      }
      break;
    }
    case "showFindReplace": {
      // Handle show find and replace widget command from VS Code
      if (state.findReplaceManager) {
        state.findReplaceManager.showFindReplace();
      }
      break;
    }
    case "insertTable": {
      // Handle insert table command from VS Code
      if (window.vditor) {
        // Use Vditor's toolbar functionality to insert table
        const tableText = `
| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Row 1    | Data     | Data     |
| Row 2    | Data     | Data     |
`;
        window.vditor.insertValue(tableText);
      }
      break;
    }
    case "insertKanbanBoard": {
      // Handle insert kanban board command from VS Code
      if (window.vditor) {
        // Request a new kanban board with file creation
        vscode?.postMessage({
          command: "requestInsertRenderer",
          rendererType: "kanban-board",
        });
      }
      break;
    }
    case "insertInteractiveTable": {
      // Handle insert interactive table command from VS Code
      if (window.vditor) {
        // Request a new interactive table with file creation
        vscode?.postMessage({
          command: "requestInsertRenderer",
          rendererType: "table",
        });
      }
      break;
    }
    case "insertPlayground": {
      // Handle insert playground command from VS Code
      if (window.vditor) {
        // Playground doesn't use external files, insert directly
        const playgroundText = `\n\`\`\`playground\nconsole.log('Hello, World!');\n\`\`\`\n`;
        window.vditor.insertValue(playgroundText);
      }
      break;
    }
    case "insertWidget": {
      // Handle insert widget command from VS Code
      if (window.vditor && msg.widgetBlock) {
        window.vditor.insertValue(msg.widgetBlock);
      }
      break;
    }
    case "nativeToolSelectorResult": {
      applySelectedTools(msg.selectedTools ?? []);
      break;
    }
    case "inlineSuggestionEligibility": {
      inlineSuggestionController.updateEligibility(msg);
      break;
    }
    case "inlineSuggestionResult": {
      inlineSuggestionController.handleSuggestionResponse(msg);
      break;
    }
    case "calendar-events": {
      // Forward calendar events from extension to widgets
      // Widgets listen for this via window custom events
      console.log('📅 [main.ts] Received calendar-events:', msg.events?.length || 0, 'events for', msg.provider);
      const calendarEventsEvent = new CustomEvent('calendar-events', {
        detail: {
          requestId: msg.requestId,
          provider: msg.provider,
          date: msg.date,
          events: msg.events,
        },
        bubbles: true,
      });
      window.dispatchEvent(calendarEventsEvent);
      break;
    }
    case "calendar-loading": {
      // Forward calendar loading state to widgets
      const calendarLoadingEvent = new CustomEvent('calendar-loading', {
        detail: {
          requestId: msg.requestId,
          provider: msg.provider,
          date: msg.date,
          loading: msg.loading,
        },
        bubbles: true,
      });
      window.dispatchEvent(calendarLoadingEvent);
      break;
    }
    case "calendar-error": {
      // Forward calendar error to widgets
      console.log('📅 [main.ts] Received calendar-error:', msg.error, 'for', msg.provider);
      const calendarErrorEvent = new CustomEvent('calendar-error', {
        detail: {
          requestId: msg.requestId,
          provider: msg.provider,
          date: msg.date,
          error: msg.error,
        },
        bubbles: true,
      });
      window.dispatchEvent(calendarErrorEvent);
      break;
    }
    case "calendar-auth-result": {
      // Forward calendar auth result to widgets
      console.log('📅 [main.ts] Received calendar-auth-result:', msg.success ? 'SUCCESS' : 'FAILED', 'for', msg.provider);
      const calendarAuthResultEvent = new CustomEvent('calendar-auth-result', {
        detail: {
          requestId: msg.requestId,
          provider: msg.provider,
          success: msg.success,
          error: msg.error,
        },
        bubbles: true,
      });
      window.dispatchEvent(calendarAuthResultEvent);
      break;
    }
    case "calendar-signout-result": {
      // Forward calendar sign out result to widgets
      const calendarSignOutResultEvent = new CustomEvent('calendar-signout-result', {
        detail: {
          requestId: msg.requestId,
          provider: msg.provider,
          success: msg.success,
          error: msg.error,
        },
        bubbles: true,
      });
      window.dispatchEvent(calendarSignOutResultEvent);
      break;
    }
    case "navigateToHeading": {
      // Handle navigate to heading command from VS Code
      if (state.wikiLinkHandler && msg.heading) {
        // Use the WikiLinkHandler's scrollToHeading method
        (state.wikiLinkHandler as any).scrollToHeading(msg.heading);
      }
      break;
    }
    case "insertRendererCodeBlock": {
      // Handle insert renderer code block from extension
      if (window.vditor && msg.codeBlock) {
        window.vditor.insertValue(msg.codeBlock);
      }
      break;
    }
    case "openEmbedPreview": {
      try {
        const embed = msg.embed || {};
        // Create or reuse preview overlay
        let overlay = document.getElementById(
          "vscode-embed-preview-overlay"
        ) as HTMLDivElement | null;
        if (!overlay) {
          overlay = document.createElement("div");
          overlay.id = "vscode-embed-preview-overlay";
          document.body.appendChild(overlay);
        }
        overlay.innerHTML = "";

        // Create header with title and icon buttons
        const header = document.createElement("div");
        header.className = "embed-header";

        const title = document.createElement("div");
        title.className = "embed-title";
        title.textContent =
          embed.fileName ||
          (embed.path ? embed.path.split("/").slice(-1)[0] : "Embed Preview");

        const actions = document.createElement("div");
        actions.className = "embed-actions";

        // Open file icon button (if path available)
        if (embed.path) {
          const openBtn = document.createElement("button");
          openBtn.className = "icon-btn codicon codicon-link-external";
          openBtn.setAttribute("data-tooltip", "Open File");
          openBtn.setAttribute("aria-label", "Open File");
          openBtn.addEventListener("click", () => {
            try {
              vscode?.postMessage({ command: "openFile", path: embed.path });
            } catch (err) {
              vscodeLog(`❌ open button postMessage failed: ${err}`);
            }
          });
          actions.appendChild(openBtn);
        }

        // Download icon button (if dataUrl available)
        if (embed.dataUrl) {
          const downloadBtn = document.createElement("a");
          downloadBtn.className = "icon-btn";
          downloadBtn.setAttribute("data-tooltip", "Download");
          downloadBtn.setAttribute("aria-label", "Download");
          downloadBtn.textContent = "⬇";
          downloadBtn.href = embed.dataUrl;
          downloadBtn.download = embed.fileName || "download";
          downloadBtn.style.textDecoration = "none";
          actions.appendChild(downloadBtn);
        }

        // Close icon button
        const closeBtn = document.createElement("button");
        closeBtn.className = "icon-btn codicon codicon-close";
        closeBtn.setAttribute("data-tooltip", "Close");
        closeBtn.setAttribute("aria-label", "Close");
        closeBtn.addEventListener("click", () => {
          overlay && overlay.remove();
        });
        actions.appendChild(closeBtn);

        header.appendChild(title);
        header.appendChild(actions);
        overlay.appendChild(header);

        // Create scrollable content area
        const content = document.createElement("div");
        content.className = "embed-content";

        // Add content based on type
        if (embed.dataUrl && (embed.mimeType || "").startsWith("image/")) {
          const img = document.createElement("img");
          img.src = embed.dataUrl;
          img.style.maxWidth = "100%";
          img.style.height = "auto";
          content.appendChild(img);
        } else if (embed.text) {
          const pre = document.createElement("pre");
          pre.textContent = embed.text.substring(0, 20000); // limit
          content.appendChild(pre);
        } else if (embed.dataUrl) {
          const link = document.createElement("a");
          link.href = embed.dataUrl;
          link.textContent = embed.fileName || "Download";
          link.target = "_blank";
          content.appendChild(link);
        } else if (embed.path) {
          const info = document.createElement("div");
          info.textContent = `Path: ${embed.path}`;
          content.appendChild(info);
        } else {
          const info = document.createElement("div");
          info.textContent = "No preview available for this embed";
          content.appendChild(info);
        }

        // If the extension chose not to embed the file (too large), show the note
        if (embed.note) {
          const note = document.createElement("div");
          note.style.marginTop = "8px";
          note.style.fontSize = "12px";
          note.style.opacity = "0.9";
          note.textContent = embed.note;
          content.appendChild(note);
        }

        overlay.appendChild(content);
      } catch (err) {
        vscodeLog(`❌ openEmbedPreview handler failed: ${err}`);
      }
      break;
    }
    case "requestIRHtml": {
      // Handle request for clean IR HTML content for diff calculation
      // Log the request for debugging
      if ((window as any).markdownEditorLog) {
        (window as any).markdownEditorLog(
          `[WEBVIEW] Received requestIRHtml with requestId: ${msg.requestId}`
        );
      }

      try {
          vscode?.postMessage({
            command: "irHtmlResponse",
            html: vditor.getHTML(), // still use vditor.getHTML() to ensure consistency
            requestId: msg.requestId,
          });
      } catch (error) {
        if ((window as any).markdownEditorLog) {
          (window as any).markdownEditorLog(
            `[WEBVIEW] Error processing requestIRHtml: ${error}`
          );
        }

        vscode?.postMessage({
          command: "irHtmlResponse",
          html: null,
          requestId: msg.requestId,
          error: String(error),
        });
      }
      break;
    }
    case "requestRenderedMarkdownHtml": {
      (async () => {
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
          if ((window as any).markdownEditorLog) {
            (window as any).markdownEditorLog(
              `[WEBVIEW] Error processing requestRenderedMarkdownHtml: ${error}`
            );
          }

          vscode?.postMessage({
            command: "renderedMarkdownHtmlResponse",
            html: null,
            requestId: msg.requestId,
            error: String(error),
          });
        }
      })();
      break;
    }
    case "renderer-update-code-block": {
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
            const rawContent = vditor.getValue();
            vscode?.postMessage({ command: "edit", content: rawContent });

            // Force Vditor to re-render the updated code block
            // This ensures the renderer re-initializes with the correct board ID and file
            setTimeout(() => {
              window.vditor.setValue(rawContent);
            }, 100);
          }
          break;
        }
      }
      break;
    }
    default:
      break;
  }
});

// Calendar widget event listeners - forward widget requests to extension
window.addEventListener('calendar-request', ((event: CustomEvent) => {
  // Widget is requesting calendar events
  const { provider, date, requestId } = event.detail || {};
  vscode?.postMessage({
    command: 'calendar-request',
    provider: provider || 'all',
    date: date || new Date().toISOString().split('T')[0],
    requestId,
  });
}) as EventListener);

window.addEventListener('calendar-auth', ((event: CustomEvent) => {
  // Widget is requesting calendar authentication
  const { provider, requestId } = event.detail || {};
  vscode?.postMessage({
    command: 'calendar-auth',
    provider: provider || 'outlook', // Default to Outlook as it's better supported
    requestId,
  });
}) as EventListener);

window.addEventListener('calendar-signout', ((event: CustomEvent) => {
  // Widget is requesting to sign out from a calendar provider
  const { provider, requestId } = event.detail || {};
  vscode?.postMessage({
    command: 'calendar-signout',
    provider,
    requestId,
  });
}) as EventListener);

window.addEventListener('calendar-event-action', ((event: CustomEvent) => {
  // Widget is performing an action on a calendar event (join, open, etc.)
  const { action, eventData } = event.detail || {};
  
  // Handle video meeting actions
  if (action === 'join' && eventData?.link) {
    // Open meeting link in browser
    vscode?.postMessage({
      command: 'open-link',
      href: eventData.link,
    });
  }
}) as EventListener);

// when window is loaded
window.addEventListener('load', () => {
  vscode?.postMessage({ command: "ready" });
  fixLinkClick();
  fixCut();
});
