import "./preload";

import {
  fileToBase64,
  fixCut,
  fixDarkTheme,
  fixLinkClick,
  fixPanelHover,
  handleToolbarClick,
  saveVditorOptions,
  cleanContentForSave,
  getHTML,
  getValue,
} from "./utils";

import { merge } from "lodash";
import Vditor from "vditor";
import { format, set } from "date-fns";
// Import Predictionary v1.6.0 - ES6 module with proper exports
import Predictionary from "predictionary/src/index.mjs";
import "vditor/dist/index.css";
// Note: Vditor i18n and icons are loaded as separate <script> tags in the HTML
// before main.js to ensure they execute first and set window.VditorI18n and insert SVG icons
import { t, lang } from "./lang";
import { toolbar } from "./toolbar";
import { fixTableIr } from "./fix-table-ir";
import words from "./words.en.txt";

// Renderer System
import {
  initializeRendererSystem,
  generateVditorCustomRenders,
} from "./renderers";
import "./main.css";
import "./vscode-integration.css";
import { DiagnosticVisualizer } from "./diagnostic-visualizer";
import { VSCodeWebviewIntegrator } from "./vscode-integrator";
import { diffVisualizer } from "./diff-visualizer";
import { CursorManager } from "./cursor-manager";
import { FindReplaceManager } from "./find-replace";
import { WikiLinkAutocomplete } from "./wiki-link-autocomplete";
import { WikiLinkHandler } from "./wiki-link-handler";
import { ImageURIConverter } from "./image-uri-converter";

// Global instances
let diagnosticVisualizer: DiagnosticVisualizer | null = null;
let vscodeIntegrator: VSCodeWebviewIntegrator | null = null;
let cursorManager: CursorManager | null = null;
let findReplaceManager: FindReplaceManager | null = null;
let wikiLinkAutocomplete: WikiLinkAutocomplete | null = null;
let wikiLinkHandler: WikiLinkHandler | null = null;
let imageURIConverter: ImageURIConverter | null = null;
let cachedCleanHtml: string | null = null; // Cache clean HTML before decorations

// Track when we just received setValue from external change (undo/redo)
let justReceivedExternalChange = false;

// Read-only state
let isReadOnly = false;

/**
 * Cache the clean IR HTML before any decorations are applied
 * This is called after Vditor renders but before diagnostics/diff
 */
function cacheCleanIRHtml(): void {
  cachedCleanHtml = vditor.getHTML();
  if ((window as any).markdownEditorLog) {
    (window as any).markdownEditorLog(
      `[CACHE] Cached clean HTML (${cachedCleanHtml.length} chars)`
    );
  }
}
/**
 * Process wiki-links and diagnostics after Vditor renders/re-renders content
 * Called after: initial load, setValue (undo/redo), and any content refresh
 */
function processAfterRender() {
  // CRITICAL: Cache clean HTML BEFORE applying any decorations
  // This gives us a baseline for diff calculation without needing to clear decorations
  cacheCleanIRHtml();

  // Re-process wiki-links to restore IR structure
  if (wikiLinkHandler) {
    wikiLinkHandler.processWikiLinksInEditor();
  }

  // Re-convert image URIs for webview compatibility
  if (imageURIConverter) {
    imageURIConverter.convertAllImages();
  }

  // Note: We don't call addSimpleDiagnostics here because:
  // 1. It only adds simple pattern-based diagnostics (broken links, missing alt)
  // 2. Real VS Code diagnostics are handled by handleExternalChange()
  // 3. Calling both can cause timing conflicts
  // If you need to reapply diagnostics, use diagnosticVisualizer.handleExternalChange()
}

// Initialize diff visualizer - must be called to set up message listeners
diffVisualizer.initialize();

// Coordination flag to avoid duplicate custom menu builds
(window as any).__vditorHandledContextMenu = false;
let __lastContextMenuBuild = 0;
const __lastMousePos = { x: 200, y: 200 };
const __lastDiagnostics: any[] = [];
// Robust selection tracking for copy/cut when immediate selection lookup fails
let __lastSelectionText = "";
let __lastSelectionRange: Range | null = null;

function snapshotSelection() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const text = sel.toString();
  if (text && text.length > 0) {
    __lastSelectionText = text;
    try {
      __lastSelectionRange = sel.getRangeAt(0).cloneRange();
    } catch {
      __lastSelectionRange = null;
    }
  }
}

document.addEventListener("selectionchange", () => snapshotSelection());
document.addEventListener("mouseup", () => snapshotSelection());
document.addEventListener("keyup", (e) => {
  if (
    e.key === "Shift" ||
    e.key === "ArrowLeft" ||
    e.key === "ArrowRight" ||
    e.key === "ArrowUp" ||
    e.key === "ArrowDown"
  ) {
    snapshotSelection();
  }
});

function getRobustSelectionSnapshot(): { text: string; range: Range | null } {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const text = sel.toString();
    if (text) {
      return { text, range: sel.getRangeAt(0) };
    }
  }
  return { text: __lastSelectionText, range: __lastSelectionRange };
}

// Capture diagnostics from extension messages (hook into existing message handler later)
// We'll patch into window.addEventListener('message') switch further below to update __lastDiagnostics

function getSelectionInfo() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return { hasSelection: false, textLength: 0 };
  }
  const text = sel.toString();
  return { hasSelection: !!text && text.length > 0, textLength: text.length };
}

function hasDiagnosticAtEventTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (
    Array.from(target.classList).some((c) => c.startsWith("vscode-diagnostic-"))
  )
    return true;
  if (target.getAttribute("data-diagnostic-source")) return true;
  // walk up a little
  let el: HTMLElement | null = target;
  let depth = 0;
  while (el && depth < 5) {
    if (
      Array.from(el.classList).some((c) =>
        c.startsWith("vscode-diagnostic-")
      ) ||
      el.getAttribute("data-diagnostic-source")
    ) {
      return true;
    }
    el = el.parentElement;
    depth++;
  }
  return false;
}

function buildVSCodeContextMenu(event?: MouseEvent) {
  const selection = getSelectionInfo();
  const diagAvailable = event
    ? hasDiagnosticAtEventTarget(event.target as HTMLElement)
    : false;

  const items: any[] = [];
  // Clipboard / selection group
  items.push(
    {
      label: "Cut",
      click: () => performClipboardAction("cut"),
      disabled: !selection.hasSelection,
    },
    {
      label: "Copy",
      click: () => performClipboardAction("copy"),
      disabled: !selection.hasSelection,
    },
    { label: "Paste", click: () => performClipboardAction("paste") },
    {
      label: "Select All",
      click: () => {
        // Modern Selection API instead of deprecated execCommand
        const sel = window.getSelection();
        const editor =
          document.querySelector(".vditor-ir .vditor-reset") ||
          document.querySelector(".vditor-wysiwyg .vditor-reset") ||
          document.querySelector(".vditor-sv .vditor-reset");
        if (sel && editor) {
          const range = document.createRange();
          range.selectNodeContents(editor);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      },
    }
  );
  items.push({ separator: true });
  // Editing / diagnostics group
  items.push(
    {
      label: "Quick Fix...",
      click: () => vscode.postMessage({ command: "triggerQuickFix" }),
      disabled: !diagAvailable,
    },
    {
      label: "Format Document",
      click: () => vscode.postMessage({ command: "formatDocument" }),
    },
    {
      label: "Format Selection",
      click: () => vscode.postMessage({ command: "formatSelection" }),
      disabled: !selection.hasSelection,
    },
    {
      label: "Show Problems",
      click: () => vscode.postMessage({ command: "showProblems" }),
    }
  );
  items.push({ separator: true });
  // Navigation / search group
  items.push(
    { label: "Find", click: () => vscode.postMessage({ command: "find" }) },
    {
      label: "Find & Replace",
      click: () => vscode.postMessage({ command: "findAndReplace" }),
    }
  );
  items.push({ separator: true });
  // Insert submenu
  items.push({
    label: "Insert",
    submenu: [
      {
        label: "Link",
        click: () => vscode.postMessage({ command: "insertLink" }),
      },
      {
        label: "Image",
        click: () => vscode.postMessage({ command: "insertImage" }),
      },
      {
        label: "Table",
        click: () => vscode.postMessage({ command: "insertTable" }),
      },
      { separator: true },
      {
        label: "Kanban Board",
        click: () =>
          vscode.postMessage({
            command: "requestInsertRenderer",
            rendererType: "kanban-board",
          }),
      },
      {
        label: "Interactive Table",
        click: () =>
          vscode.postMessage({
            command: "requestInsertRenderer",
            rendererType: "table",
          }),
      },
      {
        label: "Code Playground",
        click: () => {
          // Playground doesn't need extension - handle directly in webview
          const playgroundText = `\n\`\`\`playground\nconsole.log('Hello, World!');\n\`\`\`\n`;
          if (window.vditor) {
            window.vditor.insertValue(playgroundText);
          }
        },
      },
    ],
  });
  items.push({ separator: true });
  // Misc group
  items.push(
    {
      label: "Command Palette...",
      click: () => vscode.postMessage({ command: "showCommandPalette" }),
    },
    {
      label: "Toggle Word Wrap",
      click: () => vscode.postMessage({ command: "toggleWordWrap" }),
    }
  );
  return items;
}

// Enhance manual context menu to support submenus
function enhanceManualMenuForSubmenus(menuRoot: HTMLElement) {
  const parents = menuRoot.querySelectorAll('[data-has-submenu="true"]');
  parents.forEach((parentEl) => {
    const p = parentEl as HTMLElement;
    const submenuData = (p as any)._submenuItems as any[];
    if (!Array.isArray(submenuData) || submenuData.length === 0) return;
    let submenuEl: HTMLElement | null = null;
    let closeTimer: number | null = null;

    const open = () => {
      if (submenuEl) return; // already open
      const rect = p.getBoundingClientRect();
      submenuEl = document.createElement("div");
      submenuEl.className = "vscode-submenu";
      submenuEl.style.position = "fixed";
      submenuEl.style.background = "var(--vscode-menu-background, #1e1e1e)";
      submenuEl.style.border = "1px solid var(--vscode-menu-border, #454545)";
      submenuEl.style.borderRadius = "3px";
      submenuEl.style.padding = "4px 0";
      submenuEl.style.minWidth = "150px";
      submenuEl.style.boxShadow = "0 2px 8px rgba(0,0,0,.5)";
      submenuEl.style.zIndex = "10001";

      // Initially position off-screen to measure dimensions
      submenuEl.style.left = "-9999px";
      submenuEl.style.top = "-9999px";
      submenuEl.style.visibility = "hidden";

      submenuData.forEach((sub) => {
        if (sub.separator) {
          const sep = document.createElement("div");
          sep.style.height = "1px";
          sep.style.backgroundColor =
            "var(--vscode-menu-separatorBackground, #454545)";
          sep.style.margin = "4px 8px";
          submenuEl!.appendChild(sep);
          return;
        }
        const el = document.createElement("div");
        el.textContent = sub.label;
        el.style.padding = "6px 12px";
        el.style.cursor = sub.disabled ? "default" : "pointer";
        el.style.color = sub.disabled
          ? "var(--vscode-disabledForeground, #666)"
          : "var(--vscode-menu-foreground, #ccc)";
        el.style.fontSize = "13px";
        if (sub.disabled) {
          el.style.opacity = "0.5";
          el.style.pointerEvents = "none";
        }
        el.addEventListener("mouseenter", () => {
          el.style.backgroundColor =
            "var(--vscode-menu-selectionBackground, #094771)";
        });
        el.addEventListener("mouseleave", () => {
          el.style.backgroundColor = "transparent";
        });
        el.addEventListener("click", () => {
          if (sub.click && !sub.disabled) sub.click();
          const root = document.getElementById("manual-context-menu");
          if (root) root.remove();
          submenuEl && submenuEl.remove();
        });
        submenuEl!.appendChild(el);
      });

      submenuEl.addEventListener("mouseleave", () => {
        close();
      });

      document.body.appendChild(submenuEl);

      // Get actual submenu dimensions after rendering
      const submenuRect = submenuEl.getBoundingClientRect();
      const submenuWidth = submenuRect.width;
      const submenuHeight = submenuRect.height;

      // Get viewport dimensions
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Calculate initial position (to the right of parent menu item)
      let finalX = rect.right + 4;
      let finalY = rect.top;

      // Check if submenu would overflow right edge
      if (finalX + submenuWidth > viewportWidth) {
        // Position to the left of parent menu item instead
        finalX = rect.left - submenuWidth - 4;

        // If still overflowing left, constrain to viewport
        if (finalX < 10) {
          finalX = 10;
        }
      }

      // Check bottom boundary
      if (finalY + submenuHeight > viewportHeight) {
        finalY = viewportHeight - submenuHeight - 10;
      }

      // Check top boundary
      if (finalY < 10) {
        finalY = 10;
      }

      // Apply final position and make visible
      submenuEl.style.left = `${finalX}px`;
      submenuEl.style.top = `${finalY}px`;
      submenuEl.style.visibility = "visible";
    };

    const scheduleClose = () => {
      if (closeTimer) window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(() => {
        if (!submenuEl) return;
        // If mouse entered submenu cancel
        if (submenuEl.matches(":hover") || p.matches(":hover")) return;
        close();
      }, 180);
    };

    const close = () => {
      if (submenuEl) {
        submenuEl.remove();
        submenuEl = null;
      }
    };

    p.addEventListener("mouseenter", () => {
      if (closeTimer) window.clearTimeout(closeTimer);
      open();
    });
    p.addEventListener("mouseleave", scheduleClose);
  });
}

// Flag to prevent duplicate paste operations
let isProgrammaticPaste = false;
// Expose to window for vscode-integrator access
(window as any).isProgrammaticPaste = false;

// Robust clipboard handling utilities using modern Clipboard API
async function performClipboardAction(kind: "cut" | "copy" | "paste") {
  try {
    if (kind === "paste") {
      // Set flag to prevent duplicate paste from event listener
      isProgrammaticPaste = true;
      (window as any).isProgrammaticPaste = true;

      try {
        // Modern Clipboard API approach
        if (navigator.clipboard && navigator.clipboard.readText) {
          const text = await navigator.clipboard.readText();

          if (
            text &&
            window.vditor &&
            typeof window.vditor.insertValue === "function"
          ) {
            window.vditor.insertValue(text);
            return; // SUCCESS - STOP HERE
          }
        }

        // Fallback: ask extension if Clipboard API failed
        vscode.postMessage({ command: "clipboardReadRequest" });
      } finally {
        // Reset flag after a short delay to allow event to be suppressed
        setTimeout(() => {
          isProgrammaticPaste = false;
          (window as any).isProgrammaticPaste = false;
        }, 100);
      }
    } else if (kind === "copy" || kind === "cut") {
      // Unified robust selection capture
      const { text, range } = getRobustSelectionSnapshot();
      const sel = window.getSelection();

      if (!text) {
        return;
      }

      // Modern Clipboard API approach
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(text);

          // If cut, delete the selection
          if (kind === "cut") {
            const activeRange =
              range || (sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null);
            if (activeRange) {
              try {
                activeRange.deleteContents();
                // Trigger Vditor content change
                window.vditor?.vditor?.ir?.element?.dispatchEvent(
                  new InputEvent("input", { bubbles: true })
                );
              } catch (errDel) {
                vscodeLog(`❌ Cut delete failed: ${errDel}`);
              }
            }
          }
          return;
        } catch (err) {
          vscodeLog(`❌ Clipboard API ${kind} failed: ${err}`);
        }
      }

      // Fallback: extension messaging
      vscode.postMessage({ command: "clipboardWriteRequest", kind, text });
    }
  } catch (err) {
    vscodeLog(`❌ Clipboard action ${kind} failed: ${err}`);
    if (kind === "paste") {
      vscode.postMessage({ command: "clipboardReadRequest" });
    } else {
      const sel = window.getSelection();
      const text = sel ? sel.toString() : "";
      vscode.postMessage({ command: "clipboardWriteRequest", kind, text });
    }
  }
}

// Keyboard navigation for manual context menu
function attachMenuKeyboardNavigation(root: HTMLElement) {
  const actionable = Array.from(
    root.querySelectorAll("#manual-context-menu > div")
  )
    .map((el) => el as HTMLElement)
    .filter((el) => !el.dataset.separator && el.style.cursor !== "default");
  let index = 0;
  function setActive(i: number) {
    actionable.forEach((el) => ((el as HTMLElement).style.outline = "none"));
    const el = actionable[i] as HTMLElement;
    if (!el) return;
    index = i;
    el.focus({ preventScroll: true });
    el.style.outline = "1px solid var(--vscode-focusBorder,#007acc)";
  }
  actionable.forEach((el) => {
    el.setAttribute("tabindex", "-1");
  });
  setActive(0);
  const keyHandler = (e: KeyboardEvent) => {
    if (!document.getElementById("manual-context-menu")) {
      document.removeEventListener("keydown", keyHandler, true);
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        index = (index + 1) % actionable.length;
        setActive(index);
        e.preventDefault();
        break;
      case "ArrowUp":
        index = (index - 1 + actionable.length) % actionable.length;
        setActive(index);
        e.preventDefault();
        break;
      case "Enter": {
        (actionable[index] as HTMLElement)?.click();
        e.preventDefault();
        break;
      }
      case "Escape": {
        const menu = document.getElementById("manual-context-menu");
        if (menu) menu.remove();
        e.preventDefault();
        break;
      }
      case "ArrowRight": {
        const el = actionable[index] as any;
        if (el && el._submenuItems) {
          // Trigger hover to construct submenu
          el.dispatchEvent(new Event("mouseenter"));
        }
        break;
      }
      case "ArrowLeft": {
        // Close any open submenu by clicking outside (simulate Escape)
        const sub = document.querySelector(".vscode-submenu");
        if (sub) sub.remove();
        break;
      }
    }
  };
  document.addEventListener("keydown", keyHandler, true);
}

// Universal capture-phase interceptor to guarantee custom VS Code context menu
document.addEventListener(
  "contextmenu",
  (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // Editor region heuristics
    const inEditor = !!(
      target.closest(".vditor-ir") ||
      target.closest(".vditor-wysiwyg") ||
      target.closest(".vditor-sv") ||
      target.closest(".vditor-reset") ||
      target.closest("[data-block]") ||
      target.classList.contains("vscode-lightbulb-overlay")
    );
    if (!inEditor) return;

    // If Vditor callback will run (after init) we let it handle first; we only override if it fails.
    // We still prevent native menu immediately to avoid the basic browser menu flash.
    e.preventDefault();
    e.stopPropagation();
    __lastMousePos.x = e.clientX;
    __lastMousePos.y = e.clientY;

    // If Vditor handler already produced menu this turn, skip.
    if ((window as any).__vditorHandledContextMenu) {
      (window as any).__vditorHandledContextMenu = false; // reset for next event
      return;
    }

    // Build items using integrator if ready; else enriched fallback.
    const items = buildVSCodeContextMenu(e);

    // Debounce rapid duplicate builds
    const now = Date.now();
    if (now - __lastContextMenuBuild < 50) return;
    __lastContextMenuBuild = now;

    // Render manual menu
    if ((window as any).createManualContextMenu) {
      (window as any).createManualContextMenu(e.clientX, e.clientY, items);
      const root = document.getElementById("manual-context-menu");
      if (root) {
        enhanceManualMenuForSubmenus(root);
        try {
          attachMenuKeyboardNavigation(root);
        } catch (err) {
          vscodeLog(`❌ Keyboard nav attach (mouse) failed: ${err}`);
        }
      }
    }
  },
  { capture: true }
);

// Keyboard invocation: Shift+F10 or ContextMenu key
document.addEventListener("keydown", (e: KeyboardEvent) => {
  if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
    const sel = window.getSelection();
    let x = __lastMousePos.x;
    let y = __lastMousePos.y;
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect && rect.left && rect.top) {
        x = rect.left + rect.width / 2;
        y = rect.top + rect.height;
      }
    }
    const fakeEvent: any = {
      clientX: x,
      clientY: y,
      target: document.elementFromPoint(x, y),
    };
    const items = buildVSCodeContextMenu(fakeEvent as MouseEvent);
    if ((window as any).createManualContextMenu) {
      (window as any).createManualContextMenu(x, y, items);
      const root = document.getElementById("manual-context-menu");
      if (root) {
        enhanceManualMenuForSubmenus(root);
        try {
          attachMenuKeyboardNavigation(root);
        } catch (err) {
          vscodeLog(`❌ Keyboard nav attach (keyboard) failed: ${err}`);
        }
      }
    }
    e.preventDefault();
    e.stopPropagation();
  }
});

// VS Code logging function
function vscodeLog(message: string) {
  vscode.postMessage({
    command: "log",
    message: message,
  });
}

// Read-only warning tooltip functions
let readOnlyTooltipTimeout: number | null = null;
let readOnlyTooltip: HTMLElement | null = null;

function showReadOnlyTooltip(message: string = "This editor is read-only") {
  // Remove existing tooltip
  if (readOnlyTooltip) {
    readOnlyTooltip.remove();
    readOnlyTooltip = null;
  }

  // Clear existing timeout
  if (readOnlyTooltipTimeout) {
    clearTimeout(readOnlyTooltipTimeout);
    readOnlyTooltipTimeout = null;
  }

  // Create tooltip
  const tooltip = document.createElement("div");
  tooltip.className = "vscode-readonly-tooltip";
  tooltip.textContent = message;
  tooltip.style.position = "fixed";
  tooltip.style.top = "50%";
  tooltip.style.left = "50%";
  tooltip.style.transform = "translate(-50%, -50%)";
  tooltip.style.background = "var(--vscode-notifications-background, #2b2b2b)";
  tooltip.style.color = "var(--vscode-notifications-foreground, #cccccc)";
  tooltip.style.border =
    "1px solid var(--vscode-notifications-border, #454545)";
  tooltip.style.borderRadius = "3px";
  tooltip.style.padding = "8px 12px";
  tooltip.style.boxShadow = "0 2px 8px rgba(0,0,0,0.5)";
  tooltip.style.zIndex = "100000";
  tooltip.style.fontSize = "13px";
  tooltip.style.fontFamily = "var(--vscode-font-family)";
  tooltip.style.pointerEvents = "none";
  tooltip.style.opacity = "0";
  tooltip.style.transition = "opacity 0.2s";

  document.body.appendChild(tooltip);
  readOnlyTooltip = tooltip;

  // Fade in
  requestAnimationFrame(() => {
    if (tooltip && tooltip.parentElement) {
      tooltip.style.opacity = "1";
    }
  });

  // Auto-hide after 2 seconds
  readOnlyTooltipTimeout = window.setTimeout(() => {
    if (tooltip && tooltip.parentElement) {
      tooltip.style.opacity = "0";
      setTimeout(() => {
        if (tooltip && tooltip.parentElement) {
          tooltip.remove();
        }
        if (readOnlyTooltip === tooltip) {
          readOnlyTooltip = null;
        }
      }, 200);
    }
    readOnlyTooltipTimeout = null;
  }, 2000);
}

function setupReadOnlyWarnings() {
  if (!window.vditor) return;

  const editorElement =
    document.querySelector(".vditor-ir .vditor-reset") ||
    document.querySelector(".vditor-wysiwyg .vditor-reset") ||
    document.querySelector(".vditor-sv .vditor-reset");

  if (!editorElement) return;

  // Block keyboard input (except copy shortcuts)
  editorElement.addEventListener(
    "keydown",
    (e: Event) => {
      const keyEvent = e as KeyboardEvent;

      // Allow copy shortcuts: Ctrl+C, Cmd+C
      if ((keyEvent.ctrlKey || keyEvent.metaKey) && keyEvent.key === "c") {
        return; // Allow copy
      }

      // Allow selection shortcuts: Ctrl+A, Cmd+A, arrow keys, shift
      if ((keyEvent.ctrlKey || keyEvent.metaKey) && keyEvent.key === "a") {
        return; // Allow select all
      }

      if (
        [
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Shift",
          "Control",
          "Meta",
          "Alt",
        ].includes(keyEvent.key)
      ) {
        return; // Allow navigation and modifier keys
      }

      // Block all other keys
      e.preventDefault();
      e.stopPropagation();
      showReadOnlyTooltip(
        "This editor is read-only. You can copy but not modify content."
      );
    },
    { capture: true }
  );

  // Block mouse clicks that would modify content
  editorElement.addEventListener(
    "mousedown",
    (e: Event) => {
      const target = e.target as HTMLElement;

      // Allow clicks for selection
      if (e instanceof MouseEvent && e.detail === 1) {
        // Single click is OK for cursor placement/selection start
        return;
      }

      // Show tooltip on double/triple clicks (which might be attempting to edit)
      if (e instanceof MouseEvent && e.detail > 1) {
        showReadOnlyTooltip(
          "This editor is read-only. You can copy but not modify content."
        );
      }
    },
    { capture: true }
  );

  // Block paste operations
  editorElement.addEventListener(
    "paste",
    (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      showReadOnlyTooltip("This editor is read-only. Paste is disabled.");
    },
    { capture: true }
  );

  // Block cut operations
  editorElement.addEventListener(
    "cut",
    (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      showReadOnlyTooltip("This editor is read-only. Cut is disabled.");
    },
    { capture: true }
  );

  // Block drop operations
  editorElement.addEventListener(
    "drop",
    (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      showReadOnlyTooltip("This editor is read-only. Drop is disabled.");
    },
    { capture: true }
  );

  // Block drag start operations
  editorElement.addEventListener(
    "dragstart",
    (e: Event) => {
      const dragEvent = e as DragEvent;
      // Allow drag for copy purposes if there's a selection
      const selection = window.getSelection();
      if (selection && selection.toString()) {
        return; // Allow dragging selected text for copy
      }
    },
    { capture: true }
  );

  // Make content non-editable via attribute
  editorElement.setAttribute("contenteditable", "false");

  // Apply read-only visual styling
  const style = document.createElement("style");
  style.textContent = `
    .vditor-ir .vditor-reset[contenteditable="false"],
    .vditor-wysiwyg .vditor-reset[contenteditable="false"],
    .vditor-sv .vditor-reset[contenteditable="false"] {
      cursor: default !important;
      user-select: text !important;
      -webkit-user-select: text !important;
    }
  `;
  document.head.appendChild(style);
}

// Initialize renderer system
initializeRendererSystem();

function initVditor(msg) {
  // Initialize Predictionary for autocomplete hints (v1.6.0 ES6 module)
  let predictionary = null;
  try {
    predictionary = Predictionary.instance();
    const dictionaryKey = "en_US";

    // Configure with word list
    predictionary.parseWords(words, {
      elementSeparator: "\n",
      rankSeparator: " ",
      wordPosition: 2,
      rankPosition: 0,
      addToDictionary: dictionaryKey,
    });
    predictionary.useDictionaries([dictionaryKey]);
  } catch (error) {
    predictionary = null;
  }

  // Initialize WikiLink autocomplete handler
  let transientUiTimer: number | undefined | NodeJS.Timeout;

  // Initialize wiki-link autocomplete BEFORE building hint configuration
  if (!wikiLinkAutocomplete) {
    wikiLinkAutocomplete = new WikiLinkAutocomplete();
  }

  // Build hint configuration for both predictionary and wiki-links
  const hintExtensions = [];

  // Add predictionary hints if available
  if (predictionary) {
    hintExtensions.push({
      key: "{{",
      hint: (word) => {
        return predictionary
          .predict(word || "a", { maxPredictions: 5 })
          .map((w) => ({ html: w, value: w }));
      },
    });
  }

  // Add wiki-link hints if autocomplete is available
  if (wikiLinkAutocomplete) {
    const wikiHintConfigs = wikiLinkAutocomplete.getHintConfigs();
    if (wikiHintConfigs && wikiHintConfigs.length > 0) {
      hintExtensions.push(...wikiHintConfigs);
    }
  }

  let defaultOptions: any = {
    hint: {
      extend: hintExtensions,
    },
  };
  if (msg.theme === "dark") {
    // vditor.setTheme('dark', 'dark')
    defaultOptions = merge(defaultOptions, {
      theme: "dark",
      preview: {
        theme: {
          current: "dark",
        },
      },
    });
  }

  defaultOptions = merge(defaultOptions, msg.options, {
    typewriterMode: false, // Disable typewriter mode to prevent cursor jumping
    // Use cdnBaseUri which already points to media/dist directory
    // Vditor will append paths like /js/icons/ant.js to this base
    cdn: msg.cdnBaseUri || "",
    preview: {
      math: {
        inlineDigit: true,
      },
      markdown: {
        mark: true,
        fixTermTypo: false, // Disable automatic typo fixing
        linkify: false, // Disable automatic link detection
        autoSpace: false, // Disable automatic space correction
        paragraphBeginningSpace: false, // Disable space insertion at paragraph beginning
      },
      hljs: {
        // Extend default Vditor languages with our custom renderers
        // Default includes: mermaid, echarts, mindmap, plantuml, abc, graphviz, flowchart, etc.
        langs: [
          // Vditor's default custom renderers
          "mermaid",
          "echarts",
          "mindmap",
          "plantuml",
          "abc",
          "graphviz",
          "flowchart",
          "apache",
          "js",
          "ts",
          "html",
          "markmap",
          // Common programming languages
          "properties",
          "bash",
          "c",
          "csharp",
          "cpp",
          "css",
          "coffeescript",
          "diff",
          "go",
          "xml",
          "http",
          "json",
          "java",
          "javascript",
          "kotlin",
          "less",
          "lua",
          "makefile",
          "markdown",
          "nginx",
          "objectivec",
          "php",
          "php-template",
          "perl",
          "plaintext",
          "python",
          "python-repl",
          "r",
          "ruby",
          "rust",
          "scss",
          "sql",
          "shell",
          "swift",
          "ini",
          "typescript",
          "vbnet",
          "yaml",
          "ada",
          "clojure",
          "dart",
          "erb",
          "fortran",
          "gradle",
          "haskell",
          "julia",
          "julia-repl",
          "lisp",
          "matlab",
          "pgsql",
          "powershell",
          "sql_more",
          "stata",
          "cmake",
          "mathematica",
          "solidity",
          "yul",
          // Our custom renderers
          "kanban-board",
          "table",
          "playground",
        ],
      },
    },
    // Disable auto-formatting features that cause cursor issues
    counter: {
      enable: false, // Disable character counter that might interfere
    },
    outline: {
      enable: false, // Disable outline that might cause DOM changes
    },
    // Hint configuration removed from defaultOptions - set in Vditor constructor below
  });

  if (window.vditor) {
    vditor.destroy();
    window.vditor = null;
  }

  window.vditor = new Vditor("app", {
    width: "100vw",
    height: "100vh",
    minHeight: "100vh",
    lang,
    value: msg.content,
    mode: "ir", // Locked to Instant Rendering mode for consistent experience
    cache: { enable: false },
    toolbar,
    toolbarConfig: { pin: true, hide: false },
    // Disable automatic formatting that causes cursor issues
    options: {
      fixTermTypo: false, // Disable automatic typo fixes that move cursor
      tab: "\t", // Use tab instead of spaces for better cursor control
    },
    // Disable space trimming and formatting that causes cursor jumping
    blur: undefined, // Remove blur handlers that might trim content
    focus: undefined, // Remove focus handlers that might format content
    // Set read-only mode if specified
    undoDelay: isReadOnly ? 0 : 1000, // Disable undo in read-only mode
    // Enable Vditor's context menu and populate with VS Code commands
    contextmenu: (event: MouseEvent) => {
      // CRITICAL: Prevent browser's default context menu first!
      event.preventDefault();
      event.stopPropagation();

      // Guard: if integrator not ready, synthesize enriched fallback now instead of only basic trio
      if (!vscodeIntegrator) {
        return [
          { label: "Cut", click: () => performClipboardAction("cut") },
          { label: "Copy", click: () => performClipboardAction("copy") },
          { label: "Paste", click: () => performClipboardAction("paste") },
          { separator: true },
          {
            label: "Select All",
            click: () => {
              const sel = window.getSelection();
              const editor =
                document.querySelector(".vditor-ir .vditor-reset") ||
                document.querySelector(".vditor-wysiwyg .vditor-reset") ||
                document.querySelector(".vditor-sv .vditor-reset");
              if (sel && editor) {
                const range = document.createRange();
                range.selectNodeContents(editor);
                sel.removeAllRanges();
                sel.addRange(range);
              }
            },
          },
          { separator: true },
          {
            label: "Format Document",
            click: () => vscode.postMessage({ command: "formatDocument" }),
          },
          {
            label: "Show Problems",
            click: () => vscode.postMessage({ command: "showProblems" }),
          },
          {
            label: "Find",
            click: () => vscode.postMessage({ command: "find" }),
          },
          {
            label: "Find && Replace",
            click: () => vscode.postMessage({ command: "findAndReplace" }),
          },
          { separator: true },
          {
            label: "Insert Link",
            click: () => vscode.postMessage({ command: "insertLink" }),
          },
          {
            label: "Insert Image",
            click: () => vscode.postMessage({ command: "insertImage" }),
          },
          {
            label: "Insert Table",
            click: () => vscode.postMessage({ command: "insertTable" }),
          },
          { separator: true },
          {
            label: "Command Palette...",
            click: () => vscode.postMessage({ command: "showCommandPalette" }),
          },
          {
            label: "Toggle Word Wrap",
            click: () => vscode.postMessage({ command: "toggleWordWrap" }),
          },
        ];
      }

      try {
        if (vscodeIntegrator) {
          const menuItems = vscodeIntegrator.createVditorContextMenu(event);

          // Fix menu positioning after Vditor renders it
          setTimeout(() => {
            const menus = document.querySelectorAll(
              ".vditor-menu, .vditor-contextmenu, .vditor-context-menu"
            );
            menus.forEach((menu: Element) => {
              const menuEl = menu as HTMLElement;
              if (menuEl && menuEl.style.display !== "none") {
                const rect = menuEl.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                const viewportWidth = window.innerWidth;

                // Adjust if overflowing bottom
                if (rect.bottom > viewportHeight) {
                  menuEl.style.top = `${Math.max(
                    0,
                    viewportHeight - rect.height - 10
                  )}px`;
                }

                // Adjust if overflowing right
                if (rect.right > viewportWidth) {
                  menuEl.style.left = `${Math.max(
                    0,
                    viewportWidth - rect.width - 10
                  )}px`;
                }

                // Adjust if overflowing top
                if (rect.top < 0) {
                  menuEl.style.top = "10px";
                }

                // Adjust if overflowing left
                if (rect.left < 0) {
                  menuEl.style.left = "10px";
                }
              }
            });
          }, 10);

          return menuItems;
        } else {
          // Return comprehensive menu directly without vscodeIntegrator
          return [
            { label: "Cut", click: () => performClipboardAction("cut") },
            { label: "Copy", click: () => performClipboardAction("copy") },
            { label: "Paste", click: () => performClipboardAction("paste") },
            { separator: true },
            {
              label: "Select All",
              click: () => {
                const sel = window.getSelection();
                const editor =
                  document.querySelector(".vditor-ir .vditor-reset") ||
                  document.querySelector(".vditor-wysiwyg .vditor-reset") ||
                  document.querySelector(".vditor-sv .vditor-reset");
                if (sel && editor) {
                  const range = document.createRange();
                  range.selectNodeContents(editor);
                  sel.removeAllRanges();
                  sel.addRange(range);
                }
              },
            },
            { separator: true },
            {
              label: "Format Document",
              click: () => {
                vscode.postMessage({ command: "formatDocument" });
              },
            },
            {
              label: "Show Problems",
              click: () => {
                vscode.postMessage({ command: "showProblems" });
              },
            },
          ];
        }
      } catch (error) {
        return [
          { label: "Cut", click: () => document.execCommand("cut") },
          { label: "Copy", click: () => document.execCommand("copy") },
          { label: "Paste", click: () => document.execCommand("paste") },
        ];
      }
    },
    // Removed menu: [] to enable context menu system (toolbar visibility controlled via CSS)
    // Disable automatic content processing
    link: {
      isValidDomain: () => false, // Disable link validation that might reformat content
    },
    ...defaultOptions,
    after() {
      // Set up read-only warning tooltips if in read-only mode
      if (isReadOnly) {
        setupReadOnlyWarnings();
      }
      // fixDarkTheme(); // Removed - content-theme button no longer exists in toolbar

      // Initialize wiki-link autocomplete with vditor instance
      if (wikiLinkAutocomplete && window.vditor) {
        const documentPath = (msg as any).documentPath || "untitled";
        wikiLinkAutocomplete.initialize(documentPath, window.vditor);
      }

      // Initialize wiki-link handler
      if (window.vditor) {
        wikiLinkHandler = new WikiLinkHandler(window.vditor);
        const documentPath = (msg as any).documentPath || "untitled";
        wikiLinkHandler.initialize(documentPath);
      }

      // Initialize image URI converter
      if (window.vditor) {
        imageURIConverter = new ImageURIConverter(window.vditor);
        const documentPath = (msg as any).documentPath || "untitled";
        imageURIConverter.initialize(documentPath);
      }

      // Process wiki-links and diagnostics after render completes
      processAfterRender();

      // Set keyboard focus on editor when it's ready so user can start typing immediately
      setTimeout(() => {
        try {
          // Get the editor element (IR, WYSIWYG, or source mode)
          const editorElement =
            document.querySelector(".vditor-ir .vditor-reset") ||
            document.querySelector(".vditor-wysiwyg .vditor-reset") ||
            document.querySelector(".vditor-sv .vditor-reset");

          if (editorElement) {
            // Focus the editor element
            (editorElement as HTMLElement).focus({ preventScroll: true });

            // Set cursor at the beginning of the document
            const selection = window.getSelection();
            if (selection) {
              const range = document.createRange();
              // Find first text node or element to place cursor
              const firstNode = editorElement.childNodes[0] || editorElement;
              range.setStart(firstNode, 0);
              range.collapse(true);
              selection.removeAllRanges();
              selection.addRange(range);
            }
          }
        } catch (error) {
          vscodeLog(`❌ Failed to focus editor: ${error}`);
        }
      }, 100); // Small delay to ensure DOM is fully ready

      // Add a simple global context menu event listener to debug the event flow

      document.addEventListener(
        "contextmenu",
        (e) => {
          // Check if this is in the editor area
          const isEditorEvent =
            e.target &&
            ((e.target as Element).closest(".vditor-ir") ||
              (e.target as Element).closest(".vditor-wysiwyg") ||
              (e.target as Element).closest(".vditor-sv"));
          // DO NOT PREVENT DEFAULT - let Vditor handle it

          // If this is an editor event, let's also manually test Vditor's callback
          if (
            isEditorEvent &&
            window.vditor &&
            (window.vditor as any).options?.contextmenu
          ) {
            try {
              const result = (window.vditor as any).options.contextmenu(e);
            } catch (error) {
              vscodeLog(`❌ Error in Vditor contextmenu callback: ${error}`);
            }
          }
        },
        false
      ); // Use bubbling phase, not capture

      // COMPLETELY DISABLED global listener to avoid interference with Vditor
      // Global context menu listener removed to avoid interference with Vditor
      // Manual context menu creation function (fallback if Vditor doesn't work)
      (window as any).createManualContextMenu = (
        x: number,
        y: number,
        menuItems: any[]
      ) => {
        // Remove any existing manual context menu
        const existingMenu = document.getElementById("manual-context-menu");
        if (existingMenu) existingMenu.remove();

        // Create context menu element
        const menu = document.createElement("div");
        menu.id = "manual-context-menu";
        menu.style.position = "fixed";
        menu.style.backgroundColor = "var(--vscode-menu-background, #1e1e1e)";
        menu.style.border = "1px solid var(--vscode-menu-border, #454545)";
        menu.style.borderRadius = "3px";
        menu.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.5)";
        menu.style.zIndex = "10000";
        menu.style.minWidth = "150px";
        menu.style.padding = "4px 0";

        // Initially position off-screen to measure dimensions
        menu.style.left = "-9999px";
        menu.style.top = "-9999px";
        menu.style.visibility = "hidden";

        let actionableIndex = 0;
        const actionableElements: { el: HTMLElement; item: any }[] = [];
        menuItems.forEach((item) => {
          if (item.separator) {
            const separator = document.createElement("div");
            separator.style.height = "1px";
            separator.style.backgroundColor =
              "var(--vscode-menu-separatorBackground, #454545)";
            separator.style.margin = "4px 8px";
            menu.appendChild(separator);
            return;
          }
          const hasSubmenu =
            Array.isArray(item.submenu) && item.submenu.length > 0;
          const menuItem = document.createElement("div");
          menuItem.setAttribute(
            "data-has-submenu",
            hasSubmenu ? "true" : "false"
          );
          menuItem.textContent = `${item.icon || ""} ${item.label}${
            hasSubmenu ? " ▶" : ""
          }`;
          menuItem.style.padding = "6px 12px";
          menuItem.style.cursor = item.disabled ? "default" : "pointer";
          menuItem.style.color = item.disabled
            ? "var(--vscode-disabledForeground, #666)"
            : "var(--vscode-menu-foreground, #cccccc)";
          menuItem.style.fontSize = "13px";
          if (!item.disabled) {
            menuItem.dataset.actionableIndex = String(actionableIndex++);
            actionableElements.push({ el: menuItem, item });
          }
          if (item.disabled) {
            menuItem.style.opacity = "0.5";
            menuItem.style.pointerEvents = "none";
          }
          menuItem.addEventListener("mouseenter", () => {
            menuItem.style.backgroundColor =
              "var(--vscode-menu-selectionBackground, #094771)";
            if (!item.disabled)
              currentKeyboardIndex = actionableElements.findIndex(
                (a) => a.el === menuItem
              );
          });
          menuItem.addEventListener("mouseleave", () => {
            menuItem.style.backgroundColor = "transparent";
          });
          menuItem.addEventListener("click", () => {
            if (hasSubmenu) return; // don't close root when opening submenu

            if (item.click) item.click();
            menu.remove();
          });
          if (hasSubmenu) {
            (menuItem as any)._submenuItems = item.submenu;
          }
          menu.appendChild(menuItem);
        });

        // Add to document first so we can measure dimensions
        document.body.appendChild(menu);

        // Get actual menu dimensions after rendering
        const menuRect = menu.getBoundingClientRect();
        const menuWidth = menuRect.width;
        const menuHeight = menuRect.height;

        // Get viewport dimensions (window dimensions, not scrollable container)
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Calculate safe position ensuring menu stays within viewport
        let finalX = x;
        let finalY = y;

        // Check right boundary
        if (finalX + menuWidth > viewportWidth) {
          finalX = viewportWidth - menuWidth - 10; // 10px padding from edge
        }

        // Check bottom boundary
        if (finalY + menuHeight > viewportHeight) {
          finalY = viewportHeight - menuHeight - 10; // 10px padding from edge
        }

        // Check left boundary (in case adjusted position went negative)
        if (finalX < 10) {
          finalX = 10;
        }

        // Check top boundary (in case adjusted position went negative)
        if (finalY < 10) {
          finalY = 10;
        }

        // Apply final position and make visible
        menu.style.left = `${finalX}px`;
        menu.style.top = `${finalY}px`;
        menu.style.visibility = "visible";

        // Remove on click outside
        const removeMenu = (e: Event) => {
          if (!menu.contains(e.target as Node)) {
            menu.remove();
            document.removeEventListener("click", removeMenu);
          }
        };

        setTimeout(() => {
          document.addEventListener("click", removeMenu);
        }, 100);

        // Setup submenus
        enhanceManualMenuForSubmenus(menu);

        // Keyboard navigation for this menu instance
        let currentKeyboardIndex = 0;
        actionableElements.forEach(({ el }) =>
          el.setAttribute("tabindex", "-1")
        );
        function focusIndex(i: number) {
          if (i < 0 || i >= actionableElements.length) return;
          currentKeyboardIndex = i;
          actionableElements.forEach(({ el }) => (el.style.outline = "none"));
          const target = actionableElements[i].el;
          target.focus({ preventScroll: true });
          target.style.outline = "1px solid var(--vscode-focusBorder,#007acc)";
        }
        focusIndex(0);

        const keyHandler = (e: KeyboardEvent) => {
          const openMenu = document.getElementById("manual-context-menu");
          if (!openMenu) {
            document.removeEventListener("keydown", keyHandler, true);
            return;
          }
          switch (e.key) {
            case "ArrowDown":
              focusIndex(
                (currentKeyboardIndex + 1) % actionableElements.length
              );
              e.preventDefault();
              break;
            case "ArrowUp":
              focusIndex(
                (currentKeyboardIndex - 1 + actionableElements.length) %
                  actionableElements.length
              );
              e.preventDefault();
              break;
            case "Enter": {
              const entry = actionableElements[currentKeyboardIndex];
              if (entry) {
                entry.el.click();
                e.preventDefault();
              }
              break;
            }
            case "Escape":
              menu.remove();
              e.preventDefault();
              break;
            case "ArrowRight": {
              const entry = actionableElements[currentKeyboardIndex];
              if (entry && (entry.el as any)._submenuItems) {
                entry.el.dispatchEvent(new Event("mouseenter"));
                // Focus first submenu item after creation (submenu builder adds it)
                setTimeout(() => {
                  const sub = document.querySelector(".vscode-submenu");
                  if (sub) {
                    const first = sub.querySelector(
                      'div:not([style*="height"])'
                    ) as HTMLElement;
                    first?.focus();
                  }
                }, 0);
              }
              e.preventDefault();
              break;
            }
            case "ArrowLeft": {
              const sub = document.querySelector(".vscode-submenu");
              if (sub) {
                sub.remove();
                e.preventDefault();
              }
              break;
            }
          }
        };
        document.addEventListener("keydown", keyHandler, true);
      };

      // Re-enable components now that space/enter fix is working
      // Initialize diagnostic visualizer
      try {
        diagnosticVisualizer = new DiagnosticVisualizer(window.vditor);
        // Initialize the diagnostic update timestamp to prevent immediate updates
        (window as any).__lastDiagnosticUpdate = Date.now();
      } catch (error) {
        vscodeLog(`❌ Failed to initialize DiagnosticVisualizer: ${error}`);
      }

      // Initialize VS Code webview integrator
      try {
        vscodeIntegrator = new VSCodeWebviewIntegrator(window.vditor);

        // Add test function to window for manual debugging
        (window as any).testContextMenu = () => {
          if (vscodeIntegrator) {
            const testEvent = new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: 200,
              clientY: 200,
            });

            const menuItems =
              vscodeIntegrator.createVditorContextMenu(testEvent);

            return menuItems;
          }
          return [];
        };
      } catch (error) {
        vscodeLog(`❌ Failed to initialize VSCodeWebviewIntegrator: ${error}`);
      }

      // Initialize cursor manager to prevent jumping
      try {
        cursorManager = new CursorManager(window.vditor);

        // Connect cursor manager to VSCode integrator for coordinated paste handling
        if (vscodeIntegrator) {
          vscodeIntegrator.setCursorManager(cursorManager);
        }
      } catch (error) {
        vscodeLog(`❌ Failed to initialize CursorManager: ${error}`);
      }

      // Initialize find and replace manager
      try {
        findReplaceManager = new FindReplaceManager(window.vditor);
        findReplaceManager.initialize();

        // Make it globally accessible for toolbar buttons
        (window as any).findReplaceManager = findReplaceManager;
      } catch (error) {
        vscodeLog(`❌ FindReplaceManager initialization error: ${error}`);
      }

      // Apply simple diagnostics immediately after render
      setTimeout(() => {
        if (diagnosticVisualizer) {
          diagnosticVisualizer.addSimpleDiagnostics(true); // Force application
        }
      }, 50); // Very short delay - just enough for editor to be ready

      // Notify extension that Vditor has initialized/reloaded so sidebar can update
      try {
        vscode.postMessage({
          command: "vditorReady",
        });
      } catch (error) {
        vscodeLog(`❌ Failed to send vditorReady message: ${error}`);
      }
    },
    input(value: string) {
      // Block input in read-only mode
      if (isReadOnly) {
        showReadOnlyTooltip("This editor is read-only");
        return;
      }

      // Custom renderer triggering
      // find instances where we have a element with class vditor-copy right before one of the custom blocks: language-kanban-board, language-table, language-playground
      const customRenderTriggers = document.querySelectorAll(".vditor-copy");
      let shouldResetValue = false;
      customRenderTriggers.forEach((trigger) => {
        const next = trigger.nextElementSibling;
        if (
          next &&
          (next.classList.contains("language-kanban-board") ||
            next.classList.contains("language-table") ||
            next.classList.contains("language-playground"))
        ) {
          // remove the .vditor-copy element to prevent re-triggering
          trigger.remove();
          shouldResetValue = true;
        }
      });

      // Send cursor position with more detailed tracking
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const editor = document.querySelector(
          ".vditor-ir .vditor-reset"
        ) as HTMLElement;
        if (editor) {
          // Calculate approximate line and character position
          const textContent = editor.textContent || "";
          const beforeCursor = textContent.substring(0, range.startOffset);
          const lines = beforeCursor.split("\n");

          vscode.postMessage({
            command: "cursorPosition",
            line: lines.length - 1,
            character: lines[lines.length - 1].length,
          });
        }
      }

      // Get content and clean it from diagnostic/diff decorations
      // Using string manipulation instead of DOM cleanup prevents text jumping
      const rawContent = vditor.getValue();

      // Cache cleaned IR HTML
      cacheCleanIRHtml();

      // Send cleaned content to VS Code
      vscode.postMessage({ command: "edit", content: rawContent });

      // Re-set the editor content to trigger re-rendering of custom blocks
      if (shouldResetValue) {
        vditor.setValue(rawContent);
      }

      transientUiTimer && clearTimeout(transientUiTimer);
      transientUiTimer = setTimeout(() => {
        // Initialize wiki-link handler if not already done and process links
        if (wikiLinkHandler && !(wikiLinkHandler as any).isSetup) {
          const vdt = window.vditor as any;
          const editorElement =
            vdt.vditor?.ir?.element || vdt.vditor?.wysiwyg?.element;
          if (editorElement) {
            (wikiLinkHandler as any).isSetup = true;
            (wikiLinkHandler as any).editorElement = editorElement;
          }
        }

        // Process wiki-links on every input (after setup check)
        if (wikiLinkHandler && (wikiLinkHandler as any).isSetup) {
          (wikiLinkHandler as any).handleInputForProcessing?.();
        }
      }, 5000); // Even longer delay to ensure user has finished immediate edits
    },
    upload: {
      url: "/fuzzy", // 没有 url 参数粘贴图片无法上传 see: https://github.com/Vanessa219/vditor/blob/d7628a0a7cfe5d28b055469bf06fb0ba5cfaa1b2/src/ts/util/fixBrowserBehavior.ts#L1409
      async handler(files) {
        const fileInfos = await Promise.all(
          files.map(async (f) => {
            const d = new Date();
            return {
              base64: await fileToBase64(f),
              name: `${format(new Date(), "yyyyMMdd_HHmmss")}_${
                f.name
              }`.replace(/[^\w-_.]+/, "_"),
            };
          })
        );
        vscode.postMessage({
          command: "upload",
          files: fileInfos,
        });
      },
    },
    // Use dynamic renderer system with actual document filename
    customRenders: generateVditorCustomRenders(
      (window as any).currentDocumentFilename ||
        msg.documentFilename ||
        "untitled",
      window.vditor
    ),
  });

  if (window.vditor) {
    // Lets overwrite getValue and getHTML to always return cleaned content
    window.vditor.getValue = () => getValue(window.vditor.vditor);
    window.vditor.getHTML = () => getHTML(window.vditor.vditor);
    // Override setValue to preserve diagnostics and diffs through undo/redo
    const originalSetValue = window.vditor.setValue.bind(window.vditor);
    window.vditor.setValue = function (markdown: string, clearStack?: boolean) {
      // Call original setValue
      originalSetValue(markdown, clearStack);

      // Reapply diagnostics and diffs after setValue completes
      // setValue is called during undo/redo operations and clears all DOM decorations
      // Use longer delay to ensure DOM is fully stable
      setTimeout(() => {
        // Notify diagnostic visualizer to reapply
        if (diagnosticVisualizer) {
          diagnosticVisualizer.handleExternalChange();
        }

        // Reprocess diffs and wiki-links
        processAfterRender();
      }, 50); // 50ms delay to ensure DOM is fully rendered
    };
  }

  // (Removed legacy ensureCustomContextMenu fallback - replaced by global capture interceptor above)
}

window.addEventListener("message", (e) => {
  const msg = e.data;

  // Forward VS Code integration messages to integrator
  if (
    vscodeIntegrator &&
    (msg.command === "contextMenuActions" ||
      msg.command === "clipboardWriteResult" ||
      msg.command === "clipboardReadResult")
  ) {
    vscodeIntegrator.handleVSCodeMessage(msg);
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
        isReadOnly = msg.isReadOnly;
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
        vscodeLog('🔄 External change detected, setting justReceivedExternalChange=true');
        
        vditor.setValue(msg.content);

        // Notify diagnostic visualizer about external change
        if (diagnosticVisualizer) {
          diagnosticVisualizer.handleExternalChange();
        }

        // Re-process wiki-links and diagnostics after setValue
        // setValue is called on undo/redo/external changes
        processAfterRender();
        
        // Clear flag after 500ms (diagnostics should arrive within this window)
        setTimeout(() => {
          vscodeLog('🔄 Clearing justReceivedExternalChange flag');
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
        (Array as any).isArray && (__lastDiagnostics.length = 0);
        msg.diagnostics.forEach((d) => __lastDiagnostics.push(d));
      }

      if (diagnosticVisualizer) {
        // Pass additional document context to the visualizer
        // Force apply if we just received an external change (undo/redo)
        const shouldForceApply = justReceivedExternalChange;
        vscodeLog(`📊 Received ${msg.diagnostics.length} diagnostics, forceApply=${shouldForceApply}`);
        
        diagnosticVisualizer.updateDiagnostics(
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
      if (vscodeIntegrator) {
        vscodeIntegrator.handleContextMenuActions(msg.actions || []);
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
      if (findReplaceManager) {
        findReplaceManager.showFind();
      }
      break;
    }
    case "showFindReplace": {
      // Handle show find and replace widget command from VS Code
      if (findReplaceManager) {
        findReplaceManager.showFindReplace();
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
        vscode.postMessage({
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
        vscode.postMessage({
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
    case "navigateToHeading": {
      // Handle navigate to heading command from VS Code
      if (wikiLinkHandler && msg.heading) {
        // Use the WikiLinkHandler's scrollToHeading method
        (wikiLinkHandler as any).scrollToHeading(msg.heading);
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
              vscode.postMessage({ command: "openFile", path: embed.path });
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
        // BETTER SOLUTION: Use cached clean HTML if available
        // This avoids clearing and reapplying decorations
        if (cachedCleanHtml) {
          if ((window as any).markdownEditorLog) {
            (window as any).markdownEditorLog(
              `[WEBVIEW] Using cached HTML (${cachedCleanHtml.length} chars) for requestId: ${msg.requestId}`
            );
          }

          vscode.postMessage({
            command: "irHtmlResponse",
            html: cachedCleanHtml,
            requestId: msg.requestId,
          });
        } else {
          // Fallback: Get current HTML (may have decorations, but better than nothing)
          const irElement = document.querySelector(
            ".vditor-ir pre.vditor-reset"
          );

          if ((window as any).markdownEditorLog) {
            (window as any).markdownEditorLog(
              `[WEBVIEW] IR element found: ${!!irElement}, no cache available`
            );
          }

          if (irElement) {
            const cleanHtml = irElement.innerHTML;

            if ((window as any).markdownEditorLog) {
              (window as any).markdownEditorLog(
                `[WEBVIEW] Sending current HTML (${cleanHtml.length} chars) for requestId: ${msg.requestId}`
              );
            }

            vscode.postMessage({
              command: "irHtmlResponse",
              html: cleanHtml,
              requestId: msg.requestId,
            });
          } else {
            if ((window as any).markdownEditorLog) {
              (window as any).markdownEditorLog(
                `[WEBVIEW] IR element not found, sending error for requestId: ${msg.requestId}`
              );
            }

            vscode.postMessage({
              command: "irHtmlResponse",
              html: null,
              requestId: msg.requestId,
              error: "IR element not found",
            });
          }
        }
      } catch (error) {
        if ((window as any).markdownEditorLog) {
          (window as any).markdownEditorLog(
            `[WEBVIEW] Error processing requestIRHtml: ${error}`
          );
        }

        vscode.postMessage({
          command: "irHtmlResponse",
          html: null,
          requestId: msg.requestId,
          error: String(error),
        });
      }
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
          /<!--\s*(?:board|table):\s*([^-\s]+)\s*-->/
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
            vscode.postMessage({ command: "edit", content: rawContent });

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

fixLinkClick();
fixCut();

vscode.postMessage({ command: "ready" });
