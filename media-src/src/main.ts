import "./preload";

import {
  fileToBase64,
  fixCut,
  fixDarkTheme,
  fixLinkClick,
  fixPanelHover,
  handleToolbarClick,
  saveVditorOptions,
} from "./utils";

import { merge } from "lodash";
import Vditor from "vditor";
import { format, set } from "date-fns";
import "vditor/dist/index.css";
import { t, lang } from "./lang";
import { toolbar } from "./toolbar";
import { fixTableIr } from "./fix-table-ir";
import words from "./words.en.txt";
import "./main.css";
import "./vscode-integration.css";
import { DiagnosticVisualizer } from "./diagnostic-visualizer";
import { VSCodeWebviewIntegrator } from "./vscode-integrator";
import { CursorManager } from "./cursor-manager";
import { FindReplaceManager } from "./find-replace";

// Global instances
let diagnosticVisualizer: DiagnosticVisualizer | null = null;
let vscodeIntegrator: VSCodeWebviewIntegrator | null = null;
let cursorManager: CursorManager | null = null;
let findReplaceManager: FindReplaceManager | null = null;

// Coordination flag to avoid duplicate custom menu builds
(window as any).__vditorHandledContextMenu = false;
let __lastContextMenuBuild = 0;
const __lastMousePos = { x: 200, y: 200 };
const __lastDiagnostics: any[] = [];
// Robust selection tracking for copy/cut when immediate selection lookup fails
let __lastSelectionText = '';
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

document.addEventListener('selectionchange', () => snapshotSelection());
document.addEventListener('mouseup', () => snapshotSelection());
document.addEventListener('keyup', (e) => {
  if (e.key === 'Shift' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
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
  if (Array.from(target.classList).some(c => c.startsWith('vscode-diagnostic-'))) return true;
  if (target.getAttribute('data-diagnostic-source')) return true;
  // walk up a little
  let el: HTMLElement | null = target;
  let depth = 0;
  while (el && depth < 5) {
  if (Array.from(el.classList).some(c => c.startsWith('vscode-diagnostic-')) || el.getAttribute('data-diagnostic-source')) {
      return true;
    }
    el = el.parentElement;
    depth++;
  }
  return false;
}

function buildVSCodeContextMenu(event?: MouseEvent) {
  const selection = getSelectionInfo();
  const diagAvailable = event ? hasDiagnosticAtEventTarget(event.target as HTMLElement) : false;

  const items: any[] = [];
  // Clipboard / selection group
  items.push(
    { label: 'Cut', click: () => performClipboardAction('cut'), disabled: !selection.hasSelection },
    { label: 'Copy', click: () => performClipboardAction('copy'), disabled: !selection.hasSelection },
    { label: 'Paste', click: () => performClipboardAction('paste') },
    { label: 'Select All', click: () => document.execCommand('selectAll') },
  );
  items.push({ separator: true });
  // Editing / diagnostics group
  items.push(
    { label: 'Quick Fix...', click: () => vscode.postMessage({ command: 'triggerQuickFix' }), disabled: !diagAvailable },
    { label: 'Format Document', click: () => vscode.postMessage({ command: 'formatDocument' }) },
    { label: 'Format Selection', click: () => vscode.postMessage({ command: 'formatSelection' }), disabled: !selection.hasSelection },
    { label: 'Show Problems', click: () => vscode.postMessage({ command: 'showProblems' }) },
  );
  items.push({ separator: true });
  // Navigation / search group
  items.push(
    { label: 'Find', click: () => vscode.postMessage({ command: 'find' }) },
    { label: 'Find && Replace', click: () => vscode.postMessage({ command: 'findAndReplace' }) },
  );
  items.push({ separator: true });
  // Insert submenu
  items.push({
    label: 'Insert',
    submenu: [
      { label: 'Link', click: () => vscode.postMessage({ command: 'insertLink' }) },
      { label: 'Image', click: () => vscode.postMessage({ command: 'insertImage' }) },
      { label: 'Table', click: () => vscode.postMessage({ command: 'insertTable' }) },
    ]
  });
  items.push({ separator: true });
  // Misc group
  items.push(
    { label: 'Command Palette...', click: () => vscode.postMessage({ command: 'showCommandPalette' }) },
    { label: 'Toggle Word Wrap', click: () => vscode.postMessage({ command: 'toggleWordWrap' }) },
  );
  return items;
}

// Enhance manual context menu to support submenus
function enhanceManualMenuForSubmenus(menuRoot: HTMLElement) {
  const parents = menuRoot.querySelectorAll('[data-has-submenu="true"]');
  parents.forEach(parentEl => {
    const p = parentEl as HTMLElement;
    const submenuData = (p as any)._submenuItems as any[];
    if (!Array.isArray(submenuData) || submenuData.length === 0) return;
    let submenuEl: HTMLElement | null = null;
    let closeTimer: number | null = null;

    const open = () => {
      if (submenuEl) return; // already open
      const rect = p.getBoundingClientRect();
      submenuEl = document.createElement('div');
      submenuEl.className = 'vscode-submenu';
      submenuEl.style.position = 'fixed';
      submenuEl.style.left = rect.right + 4 + 'px';
      submenuEl.style.top = rect.top + 'px';
      submenuEl.style.background = 'var(--vscode-menu-background, #1e1e1e)';
      submenuEl.style.border = '1px solid var(--vscode-menu-border, #454545)';
      submenuEl.style.borderRadius = '3px';
      submenuEl.style.padding = '4px 0';
      submenuEl.style.minWidth = '150px';
      submenuEl.style.boxShadow = '0 2px 8px rgba(0,0,0,.5)';
      submenuEl.style.zIndex = '10001';

      submenuData.forEach(sub => {
        if (sub.separator) {
          const sep = document.createElement('div');
          sep.style.height = '1px';
          sep.style.backgroundColor = 'var(--vscode-menu-separatorBackground, #454545)';
          sep.style.margin = '4px 8px';
          submenuEl!.appendChild(sep);
          return;
        }
        const el = document.createElement('div');
        el.textContent = sub.label;
        el.style.padding = '6px 12px';
        el.style.cursor = sub.disabled ? 'default' : 'pointer';
        el.style.color = sub.disabled ? 'var(--vscode-disabledForeground, #666)' : 'var(--vscode-menu-foreground, #ccc)';
        el.style.fontSize = '13px';
        if (sub.disabled) {
          el.style.opacity = '0.5';
          el.style.pointerEvents = 'none';
        }
        el.addEventListener('mouseenter', () => {
          el.style.backgroundColor = 'var(--vscode-menu-selectionBackground, #094771)';
        });
        el.addEventListener('mouseleave', () => {
          el.style.backgroundColor = 'transparent';
        });
        el.addEventListener('click', () => {
          if (sub.click && !sub.disabled) sub.click();
          const root = document.getElementById('manual-context-menu');
          if (root) root.remove();
          submenuEl && submenuEl.remove();
        });
        submenuEl!.appendChild(el);
      });

      submenuEl.addEventListener('mouseleave', () => {
        close();
      });

      document.body.appendChild(submenuEl);
    };

    const scheduleClose = () => {
      if (closeTimer) window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(() => {
        if (!submenuEl) return;
        // If mouse entered submenu cancel
        if (submenuEl.matches(':hover') || p.matches(':hover')) return;
        close();
      }, 180);
    };

    const close = () => {
      if (submenuEl) {
        submenuEl.remove();
        submenuEl = null;
      }
    };

    p.addEventListener('mouseenter', () => {
      if (closeTimer) window.clearTimeout(closeTimer);
      open();
    });
    p.addEventListener('mouseleave', scheduleClose);
  });
}

// Robust clipboard handling utilities
async function performClipboardAction(kind: 'cut' | 'copy' | 'paste') {
  try {
    if (kind === 'paste') {
      // Try Vditor's paste handling first
      if (window.vditor && typeof window.vditor.insertValue === 'function') {
        // For paste, we need to get clipboard content
        if (navigator.clipboard && navigator.clipboard.readText) {
          const text = await navigator.clipboard.readText();
          if (text) {
            window.vditor.insertValue(text);
            return;
          }
        }
      }
      // Try execCommand
      const success = document.execCommand('paste');
      if (success) {
        return;
      }
      // Fallback: ask extension
      vscode.postMessage({ command: 'clipboardReadRequest' });
    } else {
      // Unified robust selection capture
      const { text, range } = getRobustSelectionSnapshot();
      const sel = window.getSelection();

      // Preferred path: modern API
      if (text && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          if (kind === 'cut' && (range || (sel && sel.rangeCount > 0))) {
            const activeRange = range || sel.getRangeAt(0);
            try {
              if (!document.execCommand('insertText', false, '')) {
                activeRange.deleteContents();
              }
            } catch (errDel) {
              try { activeRange.deleteContents(); } catch (errDel2) { console.warn('🔧 Cut delete fallback failed', errDel2); }
            }
            // Trigger Vditor content change
            window.vditor?.vditor?.ir?.element?.dispatchEvent(new InputEvent('input', { bubbles: true }));
          }
          return;
        } catch (err) {
          console.warn('🔧 navigator.clipboard writeText failed, will fallback', err);
        }
      }

      // Try execCommand next
      const execOk = document.execCommand(kind);
      if (execOk) {
        // Some environments lie about success for copy; validate by reading back if possible
        if (kind === 'copy' && navigator.clipboard?.readText && text) {
          try {
            const probe = await navigator.clipboard.readText();
            if (!probe || probe !== text) {
              await navigator.clipboard.writeText(text);
            }
          } catch {
            // Ignore clipboard probe errors
          }
        }
        if (kind === 'cut' && (range || (sel && sel.rangeCount > 0))) {
          const activeRange = range || sel.getRangeAt(0);
            if (!document.execCommand('insertText', false, '')) {
              try { activeRange.deleteContents(); } catch (errDel3) { console.warn('🔧 ExecCommand cut fallback failed', errDel3); }
            }
            window.vditor?.vditor?.ir?.element?.dispatchEvent(new InputEvent('input', { bubbles: true }));
        }
        return;
      }

      // Fallback: extension messaging
      vscode.postMessage({ command: 'clipboardWriteRequest', kind, text });
    }
  } catch (err) {
    console.warn(`🔧 Clipboard action ${kind} failed:`, err);
    if (kind === 'paste') {
      vscode.postMessage({ command: 'clipboardReadRequest' });
    } else {
      const sel = window.getSelection();
      const text = sel ? sel.toString() : '';
      vscode.postMessage({ command: 'clipboardWriteRequest', kind, text });
    }
  }
}

// Keyboard navigation for manual context menu
function attachMenuKeyboardNavigation(root: HTMLElement) {
  const actionable = Array.from(root.querySelectorAll('#manual-context-menu > div'))
    .map(el => el as HTMLElement)
    .filter(el => !el.dataset.separator && el.style.cursor !== 'default');
  let index = 0;
  function setActive(i: number) {
    actionable.forEach(el => (el as HTMLElement).style.outline = 'none');
    const el = actionable[i] as HTMLElement;
    if (!el) return;
    index = i;
    el.focus({ preventScroll: true });
    el.style.outline = '1px solid var(--vscode-focusBorder,#007acc)';
  }
  actionable.forEach(el => {
    el.setAttribute('tabindex', '-1');
  });
  setActive(0);
  const keyHandler = (e: KeyboardEvent) => {
    if (!document.getElementById('manual-context-menu')) {
      document.removeEventListener('keydown', keyHandler, true);
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        index = (index + 1) % actionable.length; setActive(index); e.preventDefault(); break;
      case 'ArrowUp':
        index = (index - 1 + actionable.length) % actionable.length; setActive(index); e.preventDefault(); break;
      case 'Enter': {
        (actionable[index] as HTMLElement)?.click(); e.preventDefault(); break; }
      case 'Escape': {
        const menu = document.getElementById('manual-context-menu');
        if (menu) menu.remove(); e.preventDefault(); break; }
      case 'ArrowRight': {
        const el = actionable[index] as any;
        if (el && el._submenuItems) {
          // Trigger hover to construct submenu
          el.dispatchEvent(new Event('mouseenter'));
        }
        break; }
      case 'ArrowLeft': {
        // Close any open submenu by clicking outside (simulate Escape)
        const sub = document.querySelector('.vscode-submenu');
        if (sub) sub.remove();
        break; }
    }
  };
  document.addEventListener('keydown', keyHandler, true);
}

// Universal capture-phase interceptor to guarantee custom VS Code context menu
document.addEventListener('contextmenu', (e: MouseEvent) => {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  // Editor region heuristics
  const inEditor = !!(
    target.closest('.vditor-ir') ||
    target.closest('.vditor-wysiwyg') ||
    target.closest('.vditor-sv') ||
    target.closest('.vditor-reset') ||
    target.closest('[data-block]') ||
    target.classList.contains('vscode-lightbulb-overlay')
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
    const root = document.getElementById('manual-context-menu');
    if (root) {
      enhanceManualMenuForSubmenus(root);
      try { attachMenuKeyboardNavigation(root); } catch (err) { console.warn('🔧 Keyboard nav attach (mouse) failed', err); }
    }
  }
}, { capture: true });

// Keyboard invocation: Shift+F10 or ContextMenu key
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
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
    const fakeEvent: any = { clientX: x, clientY: y, target: document.elementFromPoint(x, y) };
    const items = buildVSCodeContextMenu(fakeEvent as MouseEvent);
    if ((window as any).createManualContextMenu) {
      (window as any).createManualContextMenu(x, y, items);
      const root = document.getElementById('manual-context-menu');
      if (root) {
        enhanceManualMenuForSubmenus(root);
        try { attachMenuKeyboardNavigation(root); } catch (err) { console.warn('🔧 Keyboard nav attach (keyboard) failed', err); }
      }
    }
    e.preventDefault();
    e.stopPropagation();
  }
});

/**
 * Setup comprehensive debugging for space/enter key issues
 */
function setupDebugLogging(): void {
  const editor = document.querySelector(
    ".vditor-ir .vditor-reset"
  ) as HTMLElement;
  if (!editor) {
    vscodeLog("❌ Could not find editor element for debug logging");
    return;
  }

  // Log all input events to understand the sequence
  editor.addEventListener(
    "beforeinput",
    (e: InputEvent) => {
      vscodeLog(
        `🔍 BEFOREINPUT: type=${e.inputType}, data="${e.data}", isComposing=${e.isComposing}`
      );
    },
    true
  );

  editor.addEventListener("input", (e: InputEvent) => {
    vscodeLog(
      `🔍 INPUT: type=${e.inputType}, data="${e.data}", isComposing=${e.isComposing}`
    );
  });

  editor.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      vscodeLog(
        `🔍 KEYDOWN: key="${e.key}", ctrlKey=${e.ctrlKey}, shiftKey=${e.shiftKey}, altKey=${e.altKey}`
      );

      // Log cursor position before the key event
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        vscodeLog(
          `🔍 CURSOR BEFORE: container=${range.startContainer.nodeName}, offset=${range.startOffset}`
        );
      }
    }
  });

  editor.addEventListener("keyup", (e: KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      vscodeLog(`🔍 KEYUP: key="${e.key}"`);

      // Log cursor position after the key event
      setTimeout(() => {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          vscodeLog(
            `🔍 CURSOR AFTER: container=${range.startContainer.nodeName}, offset=${range.startOffset}`
          );
        }
      }, 10);
    }
  });

  // Log DOM mutations to detect when Vditor is changing the DOM
  const mutationObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "childList") {
        if (mutation.addedNodes.length > 0) {
          vscodeLog(
            `🔍 DOM MUTATION: Added ${mutation.addedNodes.length} nodes`
          );
        }
        if (mutation.removedNodes.length > 0) {
          vscodeLog(
            `🔍 DOM MUTATION: Removed ${mutation.removedNodes.length} nodes`
          );
        }
      }
      if (mutation.type === "characterData") {
        vscodeLog(`🔍 DOM MUTATION: Text content changed`);
      }
    });
  });

  mutationObserver.observe(editor, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  vscodeLog(
    "✅ Debug logging setup complete - monitoring space/enter key behavior"
  );
}

/**
 * Setup format prevention to stop Vditor from interfering with typing
 * TEMPORARILY DISABLED for debugging - we'll re-enable after identifying root cause
 */
function setupFormatPrevention(): void {
  vscodeLog(
    "⚠️ Format prevention DISABLED for debugging - testing vanilla Vditor behavior"
  );

  // TODO: Re-enable after we identify the root cause
  // For now, let Vditor handle space and enter keys naturally
  // so we can see if the flicker is caused by our intervention or by Vditor itself
}

// VS Code logging function
function vscodeLog(message: string) {
  vscode.postMessage({
    command: "log",
    message: message,
  });
}

// Test logging immediately when script loads
vscodeLog("Main.ts: Webview script loaded and vscodeLog function initialized");
vscodeLog("Main.ts: Starting VS Code integration improvements...");

function initVditor(msg) {
  const predictionary =
    (window as any).Predictionary && (window as any).Predictionary.instance();
  const dictionaryKey = "en_US";
  predictionary.parseWords(words, {
    elementSeparator: "\n",
    rankSeparator: " ",
    wordPosition: 2,
    rankPosition: 0,
    addToDictionary: dictionaryKey,
  });
  predictionary.useDictionaries([dictionaryKey]);
  let inputTimer;
  let defaultOptions: any = {
    hint: {
      extend: [
        {
          key: "{{",
          hint: (word) => {
            return predictionary
              .predict(word || "a", { maxPredictions: 5 })
              .map((w) => ({ html: w, value: w }));
          },
        },
      ],
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
    },
    // Disable auto-formatting features that cause cursor issues
    counter: {
      enable: false, // Disable character counter that might interfere
    },
    outline: {
      enable: false, // Disable outline that might cause DOM changes
    },
    // Disable formatting behaviors
    hint: {
      parse: false, // Disable hint parsing that could trigger reformatting
    },
  });
  if (window.vditor) {
    vditor.destroy();
    window.vditor = null;
  }
  window.vditor = new Vditor("app", {
    width: "100%",
    height: "100%",
    minHeight: "100%",
    lang,
    value: msg.content,
    mode: "ir",
    cache: { enable: false },
    toolbar,
    toolbarConfig: { pin: true },
    // Disable automatic formatting that causes cursor issues
    options: {
      fixTermTypo: false, // Disable automatic typo fixes that move cursor
      tab: "\t", // Use tab instead of spaces for better cursor control
    },
    // Disable space trimming and formatting that causes cursor jumping
    blur: undefined, // Remove blur handlers that might trim content
    focus: undefined, // Remove focus handlers that might format content
    // Enable Vditor's context menu and populate with VS Code commands
    contextmenu: (event: MouseEvent) => {
      // CRITICAL: Prevent browser's default context menu first!
      event.preventDefault();
      event.stopPropagation();
      

      vscodeLog(`🎯 MAIN.TS: ✅ VDITOR CONTEXTMENU CALLBACK TRIGGERED! Prevented default browser menu.`);

      // Guard: if integrator not ready, synthesize enriched fallback now instead of only basic trio
      if (!vscodeIntegrator) {
        return [
          { label: "Cut", click: () => document.execCommand('cut') },
          { label: "Copy", click: () => document.execCommand('copy') },
          { label: "Paste", click: () => document.execCommand('paste') },
          { separator: true },
          { label: "Select All", click: () => document.execCommand('selectAll') },
          { separator: true },
          { label: "Format Document", click: () => vscode.postMessage({ command: 'formatDocument' }) },
          { label: "Show Problems", click: () => vscode.postMessage({ command: 'showProblems' }) },
          { label: "Find", click: () => vscode.postMessage({ command: 'find' }) },
          { label: "Find && Replace", click: () => vscode.postMessage({ command: 'findAndReplace' }) },
          { separator: true },
          { label: "Insert Link", click: () => vscode.postMessage({ command: 'insertLink' }) },
          { label: "Insert Image", click: () => vscode.postMessage({ command: 'insertImage' }) },
          { label: "Insert Table", click: () => vscode.postMessage({ command: 'insertTable' }) },
          { separator: true },
          { label: "Command Palette...", click: () => vscode.postMessage({ command: 'showCommandPalette' }) },
          { label: "Toggle Word Wrap", click: () => vscode.postMessage({ command: 'toggleWordWrap' }) },
        ];
      }


      try {
        if (vscodeIntegrator) {

          const menuItems = vscodeIntegrator.createVditorContextMenu(event);
          vscodeLog(
            `🎯 MAIN.TS: ✅ Returning ${menuItems.length} menu items to Vditor`
          );
          return menuItems;
        } else {
          vscodeLog(`❌ MAIN.TS: vscodeIntegrator not yet initialized - providing immediate basic menu`);

          // Return comprehensive menu directly without vscodeIntegrator
          return [
            { label: "Cut", click: () => {
              document.execCommand('cut');
            }},
            { label: "Copy", click: () => {
              document.execCommand('copy');
            }},
            { label: "Paste", click: () => {
              document.execCommand('paste');
            }},
            { separator: true },
            { label: "Select All", click: () => {
              document.execCommand('selectAll');
            }},
            { separator: true },
            { label: "Format Document", click: () => {
              vscode.postMessage({ command: 'formatDocument' });
            }},
            { label: "Show Problems", click: () => {
              vscode.postMessage({ command: 'showProblems' });
            }}
          ];
        }
      } catch (error) {
        console.error(
          `❌ MAIN.TS: Critical error in contextmenu callback:`,
          error
        );
        vscodeLog(
          `❌ MAIN.TS: Critical error in contextmenu callback: ${error}`
        );

        // Return basic menu as error fallback
        return [
          { label: "Cut", click: () => document.execCommand('cut') },
          { label: "Copy", click: () => document.execCommand('copy') },
          { label: "Paste", click: () => document.execCommand('paste') },
        ];
      }
    },
    // Removed menu: [] to enable context menu system (toolbar visibility controlled via CSS)
    // Disable content reformatting that causes cursor jumps
    hint: {
      parse: false, // Disable hint parsing
      delay: 0, // Disable hint delays
    },
    // Disable automatic content processing
    link: {
      isValidDomain: () => false, // Disable link validation that might reformat content
    },
    ...defaultOptions,
    after() {
      vscodeLog(
        `🔍 VDITOR AFTER CALLBACK: Editor initialized in mode: ${
          window.vditor?.getCurrentMode() || "unknown"
        }`
      );
      vscodeLog(`🔍 VDITOR CONFIG: Vditor instance created with IR mode`);

      fixDarkTheme();

      // Add a simple global context menu event listener to debug the event flow

      
      document.addEventListener('contextmenu', (e) => {



        
        // Check if this is in the editor area
        const isEditorEvent = e.target && (
          (e.target as Element).closest('.vditor-ir') ||
          (e.target as Element).closest('.vditor-wysiwyg') ||
          (e.target as Element).closest('.vditor-sv')
        );
        

        
        // DO NOT PREVENT DEFAULT - let Vditor handle it
        
        // If this is an editor event, let's also manually test Vditor's callback
        if (isEditorEvent && window.vditor && (window.vditor as any).options?.contextmenu) {

          try {
            const result = (window.vditor as any).options.contextmenu(e);

          } catch (error) {
            console.error(`❌ GLOBAL DEBUG: Manual callback error:`, error);
          }
        }
      }, false); // Use bubbling phase, not capture

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
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.style.backgroundColor = "var(--vscode-menu-background, #1e1e1e)";
        menu.style.border = "1px solid var(--vscode-menu-border, #454545)";
        menu.style.borderRadius = "3px";
        menu.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.5)";
        menu.style.zIndex = "10000";
        menu.style.minWidth = "150px";
        menu.style.padding = "4px 0";

        let actionableIndex = 0;
        const actionableElements: { el: HTMLElement; item: any }[] = [];
        menuItems.forEach((item) => {
          if (item.separator) {
            const separator = document.createElement('div');
            separator.style.height = '1px';
            separator.style.backgroundColor = 'var(--vscode-menu-separatorBackground, #454545)';
            separator.style.margin = '4px 8px';
            menu.appendChild(separator);
            return;
          }
          const hasSubmenu = Array.isArray(item.submenu) && item.submenu.length > 0;
          const menuItem = document.createElement('div');
          menuItem.setAttribute('data-has-submenu', hasSubmenu ? 'true' : 'false');
          menuItem.textContent = `${item.icon || ''} ${item.label}${hasSubmenu ? ' ▶' : ''}`;
          menuItem.style.padding = '6px 12px';
          menuItem.style.cursor = item.disabled ? 'default' : 'pointer';
          menuItem.style.color = item.disabled ? 'var(--vscode-disabledForeground, #666)' : 'var(--vscode-menu-foreground, #cccccc)';
          menuItem.style.fontSize = '13px';
          if (!item.disabled) {
            menuItem.dataset.actionableIndex = String(actionableIndex++);
            actionableElements.push({ el: menuItem, item });
          }
          if (item.disabled) {
            menuItem.style.opacity = '0.5';
            menuItem.style.pointerEvents = 'none';
          }
          menuItem.addEventListener('mouseenter', () => {
            menuItem.style.backgroundColor = 'var(--vscode-menu-selectionBackground, #094771)';
            if (!item.disabled) currentKeyboardIndex = actionableElements.findIndex(a => a.el === menuItem);
          });
          menuItem.addEventListener('mouseleave', () => {
            menuItem.style.backgroundColor = 'transparent';
          });
          menuItem.addEventListener('click', () => {
            if (hasSubmenu) return; // don't close root when opening submenu

            if (item.click) item.click();
            menu.remove();
          });
          if (hasSubmenu) {
            (menuItem as any)._submenuItems = item.submenu;
          }
          menu.appendChild(menuItem);
        });

        // Add to document
        document.body.appendChild(menu);

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
        actionableElements.forEach(({ el }) => el.setAttribute('tabindex', '-1'));
        function focusIndex(i: number) {
          if (i < 0 || i >= actionableElements.length) return;
            currentKeyboardIndex = i;
            actionableElements.forEach(({ el }) => el.style.outline = 'none');
            const target = actionableElements[i].el;
            target.focus({ preventScroll: true });
            target.style.outline = '1px solid var(--vscode-focusBorder,#007acc)';
        }
        focusIndex(0);

        const keyHandler = (e: KeyboardEvent) => {
          const openMenu = document.getElementById('manual-context-menu');
          if (!openMenu) { document.removeEventListener('keydown', keyHandler, true); return; }
          switch (e.key) {
            case 'ArrowDown':
              focusIndex((currentKeyboardIndex + 1) % actionableElements.length); e.preventDefault(); break;
            case 'ArrowUp':
              focusIndex((currentKeyboardIndex - 1 + actionableElements.length) % actionableElements.length); e.preventDefault(); break;
            case 'Enter': {
              const entry = actionableElements[currentKeyboardIndex];
              if (entry) { entry.el.click(); e.preventDefault(); }
              break; }
            case 'Escape':
              menu.remove(); e.preventDefault(); break;
            case 'ArrowRight': {
              const entry = actionableElements[currentKeyboardIndex];
              if (entry && (entry.el as any)._submenuItems) {
                entry.el.dispatchEvent(new Event('mouseenter'));
                // Focus first submenu item after creation (submenu builder adds it)
                setTimeout(() => {
                  const sub = document.querySelector('.vscode-submenu');
                  if (sub) {
                    const first = sub.querySelector('div:not([style*="height"])') as HTMLElement;
                    first?.focus();
                  }
                }, 0);
              }
              e.preventDefault();
              break; }
            case 'ArrowLeft': {
              const sub = document.querySelector('.vscode-submenu');
              if (sub) { sub.remove(); e.preventDefault(); }
              break; }
          }
        };
        document.addEventListener('keydown', keyHandler, true);


      };

      // Re-enable components now that space/enter fix is working
      vscodeLog(
        "✅ Re-enabling DiagnosticVisualizer, VSCodeIntegrator, and CursorManager"
      );

      // Initialize diagnostic visualizer
      try {
        diagnosticVisualizer = new DiagnosticVisualizer(window.vditor);
        // Initialize the diagnostic update timestamp to prevent immediate updates
        (window as any).__lastDiagnosticUpdate = Date.now();
        vscodeLog("✅ DiagnosticVisualizer initialized successfully");
      } catch (error) {
        vscodeLog(`❌ Failed to initialize DiagnosticVisualizer: ${error}`);
      }

      // Initialize VS Code webview integrator
      try {
        vscodeIntegrator = new VSCodeWebviewIntegrator(window.vditor);
        vscodeLog("✅ VSCodeWebviewIntegrator initialized successfully");

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
        vscodeLog("✅ CursorManager initialized successfully");

        // Connect cursor manager to VSCode integrator for coordinated paste handling
        if (vscodeIntegrator) {
          vscodeIntegrator.setCursorManager(cursorManager);
          vscodeLog("✅ CursorManager connected to VSCodeIntegrator");
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
        
        vscodeLog("✅ FindReplaceManager initialized successfully");

      } catch (error) {
        vscodeLog(`❌ Failed to initialize FindReplaceManager: ${error}`);
        console.error('❌ FindReplaceManager initialization error:', error);
      }

      // Setup comprehensive debugging to identify root cause of space/enter flicker
      setupDebugLogging();

      // Override Vditor's input processing to prevent formatting (currently disabled)
      setupFormatPrevention();

      // Apply simple diagnostics immediately
      setTimeout(() => {
        if (diagnosticVisualizer) {
          diagnosticVisualizer.addSimpleDiagnostics();
        }
      }, 500); // Small delay to ensure editor is fully rendered

      vscodeLog(
        "🔍 VDITOR SETUP: Ready to test vanilla behavior with space and enter keys"
      );
    },
    input() {
      const timestamp = Date.now();
      vscodeLog(`🔍 CURSOR DEBUG - Vditor input callback triggered at ${timestamp}`);

      inputTimer && clearTimeout(inputTimer);
      inputTimer = setTimeout(() => {
        vscodeLog(
          `🔍 CURSOR DEBUG - Processing content update after delay (${Date.now() - timestamp}ms elapsed)`
        );

        // ENHANCED: Send cursor position with more detailed tracking
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
            
            const cursorInfo = {
              line: lines.length - 1,
              character: lines[lines.length - 1].length,
              containerType: range.startContainer.nodeName,
              offset: range.startOffset
            };

            vscodeLog(`🔍 CURSOR DEBUG - Sending cursor position: line ${cursorInfo.line}, char ${cursorInfo.character}`);
            vscode.postMessage({
              command: "cursorPosition",
              line: cursorInfo.line,
              character: cursorInfo.character,
            });
          }
        }

        // Clean up ALL transient UI elements before getting content to prevent them from being saved
        if (diagnosticVisualizer) {
          diagnosticVisualizer.cleanupTransientUI();
          // CRITICAL: Verify diagnostic state after cleanup to detect if elements were accidentally removed
          setTimeout(() => {
            if (diagnosticVisualizer) {
              const stillExist = diagnosticVisualizer.verifyDiagnosticElementsAfterCleanup();
              if (!stillExist) {
                vscodeLog(`🚨 INPUT CALLBACK: Diagnostic elements missing after cleanup - triggering reapplication`);
                diagnosticVisualizer.addSimpleDiagnostics();
              }
            }
          }, 50); // Small delay to check after cleanup completes
        }

        // Extra aggressive cleanup: remove any lightbulb characters from the editor DOM
        const editor =
          document.querySelector(".vditor-ir .vditor-reset") ||
          document.querySelector(".vditor-wysiwyg .vditor-reset") ||
          document.querySelector(".vditor-sv .vditor-reset");

        if (editor) {
          const walker = document.createTreeWalker(
            editor,
            NodeFilter.SHOW_TEXT,
            null
          );

          let textNode;
          const textNodesToFix = [];
          while ((textNode = walker.nextNode()) !== null) {
            if (textNode.textContent && textNode.textContent.includes("💡")) {
              textNodesToFix.push(textNode);
            }
          }

          textNodesToFix.forEach((node) => {
            const cleanText = node.textContent.replace(/💡/g, "");
            if (cleanText !== node.textContent) {
              vscodeLog(
                `🔧 Removed lightbulb from text node: "${node.textContent}" -> "${cleanText}"`
              );

              node.textContent = cleanText;
            }
          });
        }

        // Extra safety: wait a moment for cleanup to complete, then get content
        setTimeout(() => {
          // Before getting content, do a final check for any lightbulbs in the editor DOM
          const editor =
            document.querySelector(".vditor-ir .vditor-reset") ||
            document.querySelector(".vditor-wysiwyg .vditor-reset") ||
            document.querySelector(".vditor-sv .vditor-reset");

          if (editor) {
            const editorLightbulbs = editor.querySelectorAll(
              ".vscode-quickfix-lightbulb"
            );
            const editorElementsWithLightbulb = Array.from(
              editor.querySelectorAll("*")
            ).filter((el) => el.textContent && el.textContent.includes("💡"));

            if (editorLightbulbs.length > 0) {
              vscodeLog(
                `🚨 Found ${editorLightbulbs.length} lightbulbs still in editor DOM before getValue()!`
              );
              console.error(
                `🚨 Found ${editorLightbulbs.length} lightbulbs still in editor DOM before getValue()!`
              );
              editorLightbulbs.forEach((lb) => lb.remove());
            }

            if (editorElementsWithLightbulb.length > 0) {
              vscodeLog(
                `� Found ${editorElementsWithLightbulb.length} elements with lightbulb text in editor DOM!`
              );
              console.error(
                `🚨 Found ${editorElementsWithLightbulb.length} elements with lightbulb text in editor DOM!`
              );
              editorElementsWithLightbulb.forEach((el) => {
                vscodeLog(
                  `Element: ${el.tagName}.${el.className}, text: "${el.textContent}"`
                );
                console.error(
                  `Element: ${el.tagName}.${el.className}, text: "${el.textContent}"`
                );
              });
            }
          }

          const content = vditor.getValue();
          vscodeLog(`�🔍 VDITOR CONTENT LENGTH: ${content.length} characters`);

          // Check if content contains any lightbulb characters or diagnostic UI elements
          if (content.includes("💡")) {
            vscodeLog(`🚨 LIGHTBULB FOUND IN CONTENT! This should not happen.`);
            console.error(
              `🚨 LIGHTBULB FOUND IN CONTENT! This should not happen. Our fix may need adjustment.`
            );
            const lightbulbIndex = content.indexOf("💡");
            const snippet = content.substring(
              Math.max(0, lightbulbIndex - 100),
              lightbulbIndex + 100
            );
            vscodeLog(`Content snippet around lightbulb: ${snippet}`);
            console.error(`Content snippet around lightbulb: ${snippet}`);

            // Show more context - full lines around the lightbulb
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes("💡")) {
                vscodeLog(`Lightbulb found on line ${i}: "${lines[i]}"`);
                console.error(`Lightbulb found on line ${i}: "${lines[i]}"`);
                if (i > 0) vscodeLog(`Previous line: "${lines[i - 1]}"`);
                if (i < lines.length - 1)
                  vscodeLog(`Next line: "${lines[i + 1]}"`);
              }
            }
          }
          if (content.includes("data-diagnostic-ui")) {
            vscodeLog(
              `🚨 DIAGNOSTIC UI ATTRIBUTES FOUND IN CONTENT! This should not happen.`
            );
            console.error(
              `🚨 DIAGNOSTIC UI ATTRIBUTES FOUND IN CONTENT! This should not happen.`
            );
          }

          vscodeLog(`🔍 CURSOR DEBUG - Sending edit message to VS Code (content length: ${content.length})`);
          vscode.postMessage({ command: "edit", content: content });
        }, 10); // Small delay to ensure cleanup completes

        // Update diagnostics with careful timing to avoid interfering with typing
        // MUCH REDUCED FREQUENCY: Only update diagnostics after significant pauses
        const now = Date.now();
        const timeSinceLastDiagnosticUpdate = now - (window as any).__lastDiagnosticUpdate || 0;
        
        // Only update diagnostics every 5 seconds to give users plenty of time to type
        if (timeSinceLastDiagnosticUpdate > 5000) {
          setTimeout(() => {
            if (diagnosticVisualizer) {
              vscodeLog(`🔍 INPUT CALLBACK: Updating simple diagnostics (${timeSinceLastDiagnosticUpdate}ms since last update)`);
              diagnosticVisualizer.addSimpleDiagnostics();
              (window as any).__lastDiagnosticUpdate = Date.now();
            }
          }, 1000); // Even longer delay to ensure user has finished immediate edits
        } else {
          vscodeLog(`🔍 INPUT CALLBACK: Skipping diagnostic update (only ${timeSinceLastDiagnosticUpdate}ms since last update)`);
        }
      }, 200); // ENHANCED: Increased delay to prevent cursor jumping after newlines
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
    customRenders: [
      {
        language: "kanban-board",
        render: (code) => {
          return new Promise((resolve) => {
            const element = code.querySelector(
              "code.language-kanban-board"
            ) as HTMLElement;
            const ir__node = code.closest(".vditor-ir__node") as HTMLElement;
            const wysiwyg__node = code.closest(
              ".vditor-wysiwyg__block"
            ) as HTMLElement;
            const node = ir__node || wysiwyg__node;

            // Make sure the kanban-board is rendered only once
            if (element) {
              element.outerHTML = `<kanban-board class="language-kanban-board" data='${encodeURIComponent(
                element.textContent
              )}'></kanban-board>`;
            }

            if (node) {
              // Stop the event propagation for the kanban-board to function as intended
              const letItFocus = (e) => {
                e.stopPropagation();
              };
              code.addEventListener("click", letItFocus);
              code.addEventListener("mousedown", letItFocus);
              code.addEventListener("mouseup", letItFocus);
              code.addEventListener("mousemove", letItFocus);
              code.addEventListener("keydown", letItFocus);
              code.addEventListener("keypress", letItFocus);
              code.addEventListener("keyup", letItFocus);
              code.addEventListener("beforeinput", letItFocus);
              code.addEventListener("focus", letItFocus);
              code.addEventListener("focusin", letItFocus);
              code.addEventListener("input", letItFocus);

              const kanbanBoard = code.querySelector("kanban-board");
              // Should save to the vscode
              kanbanBoard.addEventListener("kanban-save", (e: CustomEvent) => {
                const content = JSON.stringify(e.detail);
                if (
                  node &&
                  node.checkVisibility({
                    checkOpacity: true,
                    checkVisibilityCSS: true,
                  }) &&
                  kanbanBoard
                ) {
                  const irElement = node.querySelector(
                    ".vditor-ir__marker--pre code.language-kanban-board"
                  ) as HTMLElement;
                  if (
                    content &&
                    irElement &&
                    content !== irElement.textContent
                  ) {
                    irElement.textContent = content;
                    irElement.innerHTML = content;
                    irElement.dispatchEvent(
                      new InputEvent("input", {
                        data: content,
                        bubbles: true,
                        cancelable: true,
                        composed: true,
                        inputType: "insertText",
                      })
                    );
                  }
                  const wysiwygElement = node.querySelector(
                    ".vditor-wysiwyg__pre code.language-kanban-board"
                  ) as HTMLElement;
                  if (
                    content &&
                    wysiwygElement &&
                    content !== wysiwygElement.textContent
                  ) {
                    wysiwygElement.textContent = content;
                    wysiwygElement.innerHTML = content;
                    wysiwygElement.dispatchEvent(
                      new InputEvent("input", {
                        data: content,
                        bubbles: true,
                        cancelable: true,
                        composed: true,
                        inputType: "insertText",
                      })
                    );
                  }
                }
              });
            } else {
              // Disable the kanban-board if it's in preview mode
              const kanbanBoard = code.querySelector("kanban-board");
              kanbanBoard.setAttribute(
                "style",
                "pointer-events: none; cursor: not-allowed; user-select: none;"
              );
            }

            resolve(true);
          });
        },
      },
    ],
  });

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
          console.error(error);
          initVditor({ content: msg.content });
          saveVditorOptions();
        }
        vscodeLog("initVditor");
      } else {
        vditor.setValue(msg.content);
        vscodeLog("setValue");
        
        // Notify diagnostic visualizer about external change
        if (diagnosticVisualizer) {
          diagnosticVisualizer.handleExternalChange();
        }
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
      // Handle diagnostics updates from VS Code
      vscodeLog(
        "Main.ts: Received diagnostics message from VS Code extension: " +
          JSON.stringify({
            diagnosticCount: msg.diagnostics?.length || 0,
            documentLines: msg.documentLines || 0,
            documentTextLength: msg.documentText?.length || 0,
          })
      );

      if (Array.isArray(msg.diagnostics)) {
        // Shallow copy for safe reference
        (Array as any).isArray && (__lastDiagnostics.length = 0);
        msg.diagnostics.forEach(d => __lastDiagnostics.push(d));
      }

      // Log each diagnostic for debugging
      if (msg.diagnostics) {
        msg.diagnostics.forEach((diag, index) => {
          vscodeLog(
            `Main.ts: Diagnostic ${index}: ` +
              JSON.stringify({
                message: diag.message,
                source: diag.source,
                severity: diag.severity,
                line: diag.range?.start?.line,
                lineText: diag.lineText,
              })
          );
        });
      }

      if (diagnosticVisualizer) {
        // Pass additional document context to the visualizer
        diagnosticVisualizer.updateDiagnostics(msg.diagnostics, {
          documentText: msg.documentText,
          documentLines: msg.documentLines,
        });
      } else {
        console.warn(
          "Main.ts: DiagnosticVisualizer not initialized when diagnostics received"
        );
      }
      break;
    }
    case "contextMenuActions": {
      // Handle context menu actions response from VS Code
      vscodeLog(
        `Main.ts: Received context menu actions: ${JSON.stringify(
          msg.actions?.length || 0
        )} actions`
      );

      if (vscodeIntegrator) {
        vscodeIntegrator.handleContextMenuActions(msg.actions || []);
      }
      break;
    }
    case "insertLink": {
      // Handle insert link command from VS Code
      vscodeLog(`Main.ts: Insert Link command received`);
      if (window.vditor) {
        // Use Vditor's toolbar functionality to insert link
        const linkText = '[Link Text](https://example.com)';
        window.vditor.insertValue(linkText);
      }
      break;
    }
    case "insertImage": {
      // Handle insert image command from VS Code
      vscodeLog(`Main.ts: Insert Image command received`);
      if (window.vditor) {
        // Use Vditor's toolbar functionality to insert image
        const imageText = '![Alt Text](image.png)';
        window.vditor.insertValue(imageText);
      }
      break;
    }
    case "showFind": {
      // Handle show find widget command from VS Code
      vscodeLog(`Main.ts: Show Find command received`);
      if (findReplaceManager) {
        findReplaceManager.showFind();
      } else {
        console.warn('FindReplaceManager not initialized');
      }
      break;
    }
    case "showFindReplace": {
      // Handle show find and replace widget command from VS Code
      vscodeLog(`Main.ts: Show Find and Replace command received`);
      if (findReplaceManager) {
        findReplaceManager.showFindReplace();
      } else {
        console.warn('FindReplaceManager not initialized');
      }
      break;
    }
    case "insertTable": {
      // Handle insert table command from VS Code
      vscodeLog(`Main.ts: Insert Table command received`);
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
    default:
      break;
  }
});

fixLinkClick();
fixCut();

vscode.postMessage({ command: "ready" });
