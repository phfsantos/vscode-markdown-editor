import { merge } from "lodash";
import Vditor from "vditor";
import { format } from "date-fns";
// Import Predictionary v1.6.0 - ES6 module with proper exports
import Predictionary from "predictionary/src/index.mjs";
import { lang } from "./lang";
import { toolbar } from "./toolbar";
import words from "../assets/words.en.txt";
import {
  fileToBase64,
  getHTML,
  getValue,
} from "./utils";
import { generateVditorCustomRenders } from "./renderers";
import { DiagnosticVisualizer } from "./diagnostic-visualizer";
import { VSCodeWebviewIntegrator } from "./vscode-integrator";
import { CursorManager } from "./cursor-manager";
import { FindReplaceManager } from "./find-replace";
import { WikiLinkAutocomplete } from "./wiki-link-autocomplete";
import { WikiLinkHandler } from "./wiki-link-handler";
import { ImageURIConverter } from "./image-uri-converter";
import { fixTableIr } from "./fix-table-ir";
import { initializeLineNumbers } from "./line-number-renderer";
import { inlineSuggestionController } from "./inline-suggestion-ui";
import { state, vscodeLog } from "./webview-state";
import { showReadOnlyTooltip, setupReadOnlyWarnings } from "./read-only-ui";
import { performClipboardAction, enhanceManualMenuForSubmenus } from "./context-menu";
import {
  initializeWebviewContentSync,
  synchronizeVditorInput,
} from "./content-sync";

/**
 * Vditor initialization for the editor webview: builds the full Vditor
 * options (toolbar, IR mode, autocomplete, custom renders, upload, paste
 * handling), wires all feature managers into shared state, and owns the
 * hidden diff renderer used for baseline markdown rendering.
 *
 * Extracted from main.ts; behavior unchanged.
 */

// Instances used only during/after init
let cursorManager: CursorManager | null = null;
let wikiLinkAutocomplete: WikiLinkAutocomplete | null = null;
let imageURIConverter: ImageURIConverter | null = null;

let hiddenDiffRendererHost: HTMLDivElement | null = null;
let hiddenDiffRenderer: any = null;
let hiddenDiffRendererPromise: Promise<any> | null = null;
let hiddenDiffRendererFilename: string | null = null;

function ensureHiddenDiffRendererHost(): HTMLDivElement {
  if (hiddenDiffRendererHost) {
    return hiddenDiffRendererHost;
  }

  hiddenDiffRendererHost = document.createElement("div");
  hiddenDiffRendererHost.id = "hidden-diff-renderer";
  hiddenDiffRendererHost.setAttribute("aria-hidden", "true");
  hiddenDiffRendererHost.style.position = "fixed";
  hiddenDiffRendererHost.style.left = "-20000px";
  hiddenDiffRendererHost.style.top = "-20000px";
  hiddenDiffRendererHost.style.width = "1200px";
  hiddenDiffRendererHost.style.height = "1px";
  hiddenDiffRendererHost.style.opacity = "0";
  hiddenDiffRendererHost.style.pointerEvents = "none";
  hiddenDiffRendererHost.style.overflow = "hidden";
  document.body.appendChild(hiddenDiffRendererHost);

  return hiddenDiffRendererHost;
}

function resetHiddenDiffRenderer() {
  if (hiddenDiffRenderer?.destroy) {
    try {
      hiddenDiffRenderer.destroy();
    } catch (error) {
      console.warn("[hidden-diff-renderer] Failed to destroy hidden Vditor", error);
    }
  }

  hiddenDiffRenderer = null;
  hiddenDiffRendererPromise = null;
  hiddenDiffRendererFilename = null;

  if (hiddenDiffRendererHost) {
    hiddenDiffRendererHost.remove();
    hiddenDiffRendererHost = null;
  }
}

/**
 * Process wiki-links, image URIs, and line-number overlays after Vditor renders.
 * Called after: initial load, setValue (undo/redo), and any content refresh.
 */
export function processAfterRender() {
  if (state.wikiLinkHandler) {
    state.wikiLinkHandler.processWikiLinksInEditor();
  }

  if (imageURIConverter) {
    imageURIConverter.convertAllImages();
  }

  initializeLineNumbers();
  (window as any).__vditorLineNumbers?.refresh?.();

  // NOTE: Widget rendering is now handled by WidgetRenderer via Vditor's customRenders API
  // The old renderWidgets() function has been removed to prevent duplicate widget creation
  // See: packages/media/src/renderers/builtin/WidgetRenderer.ts
  // See: packages/media/src/renderers/init.ts

  // Note: We don't call addSimpleDiagnostics here because:
  // 1. It only adds simple pattern-based diagnostics (broken links, missing alt)
  // 2. Real VS Code diagnostics are handled by handleExternalChange()
  // 3. Calling both can cause timing conflicts
  // If you need to reapply diagnostics, use state.diagnosticVisualizer.handleExternalChange()
}

export function initVditor(msg) {
  inlineSuggestionController.initialize((window as any).vscode);
  const contentSync = initializeWebviewContentSync(
    (message) => vscode?.postMessage(message),
    msg.content || "",
    msg.generation ?? 0,
  );

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
          "widget",
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

  resetHiddenDiffRenderer();

  const ensureHiddenDiffRenderer = async (documentFilename: string) => {
    if (hiddenDiffRenderer && hiddenDiffRendererFilename === documentFilename) {
      return hiddenDiffRenderer;
    }

    if (
      hiddenDiffRendererPromise &&
      hiddenDiffRendererFilename === documentFilename
    ) {
      return hiddenDiffRendererPromise;
    }

    resetHiddenDiffRenderer();
    hiddenDiffRendererFilename = documentFilename;

    hiddenDiffRendererPromise = new Promise((resolve, reject) => {
      try {
        const host = ensureHiddenDiffRendererHost();
        // eslint-disable-next-line prefer-const -- captured by Vditor option callbacks below; keep `let` so a forward reference reads `undefined` rather than hitting the TDZ.
        let instance: any;

        instance = new Vditor(host, {
          width: "1200px",
          height: "1px",
          minHeight: 1,
          lang,
          value: "",
          mode: "ir",
          cache: { enable: false },
          toolbar: [],
          toolbarConfig: { pin: false, hide: true },
          tab: "\t",
          blur: undefined,
          focus: undefined,
          undoDelay: 0,
          counter: { enable: false },
          outline: { enable: false, position: "right" },
          preview: defaultOptions.preview,
          cdn: msg.cdnBaseUri || "",
          customRenders: generateVditorCustomRenders(
            documentFilename,
            window.vditor
          ),
          after() {
            hiddenDiffRenderer = instance;
            hiddenDiffRenderer.getHTML = () => getHTML(hiddenDiffRenderer.vditor);
            resolve(hiddenDiffRenderer);
          },
        });
      } catch (error) {
        hiddenDiffRendererPromise = null;
        reject(error);
      }
    });

    return hiddenDiffRendererPromise;
  };

  state.renderMarkdownToHtmlForDiff = async (
    markdown: string,
    documentFilename?: string
  ) => {
    const resolvedFilename =
      documentFilename ||
      (window as any).currentDocumentFilename ||
      msg.documentFilename ||
      "untitled";
    const renderer = await ensureHiddenDiffRenderer(resolvedFilename);

    renderer.setValue(markdown, true);
    await new Promise(resolve => setTimeout(resolve, 75));

    return getHTML(renderer.vditor);
  };

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
    tab: "\t",
    // Disable space trimming and formatting that causes cursor jumping
    blur: undefined, // Remove blur handlers that might trim content
    focus: undefined, // Remove focus handlers that might format content
    // Set read-only mode if specified
    undoDelay: state.isReadOnly ? 0 : 1000, // Disable undo in read-only mode
    // Enable Vditor's context menu and populate with VS Code commands
    contextmenu: (event: MouseEvent) => {
      // CRITICAL: Prevent browser's default context menu first!
      event.preventDefault();
      event.stopPropagation();

      // Guard: if integrator not ready, synthesize enriched fallback now instead of only basic trio
      if (!state.vscodeIntegrator) {
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
              vscode?.postMessage({ command: "formatDocument" });
            },
          },
          {
            label: "Show Problems",
            click: () => {
              vscode?.postMessage({ command: "showProblems" });
            },
          },
          {
            label: "Find",
            click: () => vscode?.postMessage({ command: "find" }),
          },
          {
            label: "Find && Replace",
            click: () => vscode?.postMessage({ command: "findAndReplace" }),
          },
          { separator: true },
          {
            label: "Insert Link",
            click: () => vscode?.postMessage({ command: "insertLink" }),
          },
          {
            label: "Insert Image",
            click: () => vscode?.postMessage({ command: "insertImage" }),
          },
          {
            label: "Insert Table",
            click: () => vscode?.postMessage({ command: "insertTable" }),
          },
          { separator: true },
          {
            label: "Command Palette...",
            click: () => vscode?.postMessage({ command: "showCommandPalette" }),
          },
          {
            label: "Toggle Word Wrap",
            click: () => vscode?.postMessage({ command: "toggleWordWrap" }),
          },
        ];
      }

      try {
        if (state.vscodeIntegrator) {
          const menuItems = state.vscodeIntegrator.createVditorContextMenu(event);

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
          // Return comprehensive menu directly without state.vscodeIntegrator
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
                vscode?.postMessage({ command: "formatDocument" });
              },
            },
            {
              label: "Show Problems",
              click: () => {
                vscode?.postMessage({ command: "showProblems" });
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
      if (state.isReadOnly) {
        setupReadOnlyWarnings();
      }

      // Enable table editing toolbar in IR mode
      fixTableIr();

      // Initialize wiki-link autocomplete with vditor instance
      if (wikiLinkAutocomplete && window.vditor) {
        const documentPath = (msg as any).documentPath || "untitled";
        wikiLinkAutocomplete.initialize(documentPath, window.vditor);
      }

      // Initialize wiki-link handler
      if (window.vditor) {
        state.wikiLinkHandler = new WikiLinkHandler(window.vditor);
        const documentPath = (msg as any).documentPath || "untitled";
        state.wikiLinkHandler.initialize(documentPath);
      }

      // Initialize image URI converter
      if (window.vditor) {
        imageURIConverter = new ImageURIConverter(window.vditor);
        const documentPath = (msg as any).documentPath || "untitled";
        imageURIConverter.initialize(documentPath);
      }

      initializeLineNumbers();

      // Process wiki-links and diagnostics after render completes
      processAfterRender();

      // Initialize tool selector for .agent.md files
      try {
        // initToolSelector();
      } catch (error) {
        vscodeLog(`❌ Failed to initialize tool selector: ${error}`);
      }

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
              (window.vditor as any).options.contextmenu(e);
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
        state.diagnosticVisualizer = new DiagnosticVisualizer(window.vditor);
        // Initialize the diagnostic update timestamp to prevent immediate updates
        (window as any).__lastDiagnosticUpdate = Date.now();
      } catch (error) {
        vscodeLog(`❌ Failed to initialize DiagnosticVisualizer: ${error}`);
      }

      // Initialize VS Code webview integrator
      try {
        state.vscodeIntegrator = new VSCodeWebviewIntegrator(window.vditor);

        // Add test function to window for manual debugging
        (window as any).testContextMenu = () => {
          if (state.vscodeIntegrator) {
            const testEvent = new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: 200,
              clientY: 200,
            });

            const menuItems =
              state.vscodeIntegrator.createVditorContextMenu(testEvent);

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
        if (state.vscodeIntegrator) {
          state.vscodeIntegrator.setCursorManager(cursorManager);
        }
      } catch (error) {
        vscodeLog(`❌ Failed to initialize CursorManager: ${error}`);
      }

      // Initialize find and replace manager
      try {
        state.findReplaceManager = new FindReplaceManager(window.vditor);
        state.findReplaceManager.initialize();

        // Make it globally accessible for toolbar buttons
        (window as any).findReplaceManager = state.findReplaceManager;
      } catch (error) {
        vscodeLog(`❌ FindReplaceManager initialization error: ${error}`);
      }

      // Apply simple diagnostics immediately after render
      setTimeout(() => {
        if (state.diagnosticVisualizer) {
          state.diagnosticVisualizer.addSimpleDiagnostics(true); // Force application
        }
      }, 50); // Very short delay - just enough for editor to be ready

      // Notify extension that Vditor has initialized/reloaded so sidebar can update
      try {
        vscode?.postMessage({
          command: "vditorReady",
        });
      } catch (error) {
        vscodeLog(`❌ Failed to send vditorReady message: ${error}`);
      }
    },
    input(value: string) {
      // Block input in read-only mode
      if (state.isReadOnly) {
        showReadOnlyTooltip("This editor is read-only");
        return;
      }

      // Custom renderer triggering
      // find instances where we have a element with class vditor-copy right before one of the custom blocks: language-kanban-board, language-table, language-playground
      const customRenderTriggers = document.querySelectorAll(".vditor-copy");
      const customRenderTargets: HTMLElement[] = [];
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
          customRenderTargets.push(next as HTMLElement);
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

          vscode?.postMessage({
            command: "cursorPosition",
            line: lines.length - 1,
            character: lines[lines.length - 1].length,
          });
        }
      }

      inlineSuggestionController.handleEditorInput({ content: value });
      synchronizeVditorInput(contentSync, value);

      // Refresh only custom-renderer nodes whose copy controls were regenerated.
      // Replacing the whole editor value here can serialize a partial IR DOM.
      if (customRenderTargets.length > 0) {
        const customRenders = generateVditorCustomRenders(
          (window as any).currentDocumentFilename || msg.documentFilename || "untitled",
          window.vditor,
        );
        for (const target of customRenderTargets) {
          const renderer = customRenders.find(({ language }) =>
            target.classList.contains(`language-${language}`),
          );
          void renderer?.render(target);
        }
      }

      transientUiTimer && clearTimeout(transientUiTimer);
      transientUiTimer = setTimeout(() => {
        // Initialize wiki-link handler if not already done and process links
        if (state.wikiLinkHandler && !(state.wikiLinkHandler as any).isSetup) {
          const vdt = window.vditor as any;
          const editorElement =
            vdt.vditor?.ir?.element || vdt.vditor?.wysiwyg?.element;
          if (editorElement) {
            (state.wikiLinkHandler as any).isSetup = true;
            (state.wikiLinkHandler as any).editorElement = editorElement;
          }
        }

        // Process wiki-links on every input (after setup check)
        if (state.wikiLinkHandler && (state.wikiLinkHandler as any).isSetup) {
          (state.wikiLinkHandler as any).handleInputForProcessing?.();
        }

        (window as any).__vditorLineNumbers?.refresh?.();
      }, 5000); // Even longer delay to ensure user has finished immediate edits
    },
    upload: {
      url: "/fuzzy", // 没有 url 参数粘贴图片无法上传 see: https://github.com/Vanessa219/vditor/blob/d7628a0a7cfe5d28b055469bf06fb0ba5cfaa1b2/src/ts/util/fixBrowserBehavior.ts#L1409
      async handler(files) {
        const fileInfos = await Promise.all(
          files.map(async (f) => {
            return {
              base64: await fileToBase64(f),
              name: `${format(new Date(), "yyyyMMdd_HHmmss")}_${
                f.name
              }`.replace(/[^\w-_.]+/, "_"),
            };
          })
        );
        vscode?.postMessage({
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

      inlineSuggestionController.handleExternalUpdate();

      // Reapply diagnostics and diffs after setValue completes
      // setValue is called during undo/redo operations and clears all DOM decorations
      // Use longer delay to ensure DOM is fully stable
      setTimeout(() => {
        // Notify diagnostic visualizer to reapply
        if (state.diagnosticVisualizer) {
          state.diagnosticVisualizer.handleExternalChange();
        }

        // Reprocess diffs and wiki-links
        processAfterRender();
      }, 50); // 50ms delay to ensure DOM is fully rendered
    };
  }

  // (Removed legacy ensureCustomContextMenu fallback - replaced by global capture interceptor above)
}
