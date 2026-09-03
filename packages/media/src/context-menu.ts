import { vscodeLog } from "./webview-state";
import { getMarkdownClipboardText } from "./clipboard-selection";

/**
 * Custom VS Code-style context menu for the editor webview: selection
 * snapshotting, menu construction (with widget insertion and clipboard
 * actions), submenu enhancement, and keyboard navigation.
 *
 * Extracted from main.ts; behavior unchanged.
 */

let __lastContextMenuBuild = 0;
const __lastMousePos = { x: 200, y: 200 };
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

/**
 * Insert a widget directly into the editor without going through VS Code commands
 * This fixes the "no active editor" issue when using context menu
 */
function insertWidgetDirect(widgetType: string) {
  if (!window.vditor) {
    console.error('[Widget] No Vditor instance available');
    return;
  }

  // Widget templates - wigggle-ui inspired simple widgets
  const templates: Record<string, { config: Record<string, any>; data?: any }> = {
    // Time widgets
    clock: {
      config: { type: 'clock', title: 'Current Time', format: '12h', showSeconds: true, showDate: true }
    },
    calendar: {
      config: { type: 'calendar', title: 'Today', showYear: true }
    },
    'calendar-month': {
      config: { 
        type: 'calendar-month', 
        size: 'sm',
        showNavigation: true,
        showWeekdays: true,
        weekStartsOnMonday: false,
        locale: 'en-US'
      }
    },
    'calendar-events': {
      config: { 
        type: 'calendar-events',
        size: 'sm',
        showAddButton: true,
        showMiniCalendar: true,
        showEventCount: true,
        locale: 'en-US',
        eventChannel: 'calendar-events'
      },
      data: {
        selectedDate: new Date().toISOString(),
        events: [
          { id: '1', title: 'Team Meeting', time: '9:00 AM', color: 'blue', hasVideo: true },
          { id: '2', title: 'Project Review', time: '2:00 PM', color: 'green' },
          { id: '3', title: 'Client Call', time: '4:30 PM', color: 'yellow', hasVideo: true }
        ]
      }
    },
    timer: {
      config: { type: 'timer', title: 'Timer', initialMinutes: 5, showMinuteControls: true },
      data: {
        timeLeft: 300,
        isRunning: false
      }
    },
    alarm: {
      config: { type: 'alarm', title: 'Alarms', maxAlarms: 10, use24Hour: false },
      data: {
        alarms: [
          { id: 'default-1', time: '07:00', label: 'Morning', enabled: true },
          { id: 'default-2', time: '12:30', label: 'Lunch', enabled: false },
          { id: 'default-3', time: '17:30', label: 'End of day', enabled: false }
        ]
      }
    },
    // Single Alarm widget
    'single-alarm': {
      config: { type: 'single-alarm', title: 'Alarm', use24Hour: false },
      data: {
        hour: 9,
        minute: 0,
        meridiem: 'AM',
        enabled: false,
        triggered: false
      }
    },
    // Stopwatch widget
    stopwatch: {
      config: { type: 'stopwatch', title: 'Stopwatch', showAnalog: true, showLaps: true, maxLaps: 10 },
      data: {
        elapsedTime: 0,
        isRunning: false,
        laps: []
      }
    },
    // Info widgets
    weather: {
      config: { type: 'weather', title: 'Weather' },
      data: {
        temperature: 72,
        condition: 'sunny',
        location: 'San Francisco',
        humidity: 65,
        windSpeed: 12
      }
    },
    stock: {
      config: { type: 'stock', title: 'Stock' },
      data: {
        symbol: 'MSFT',
        company: 'Microsoft',
        price: 450.25,
        change: 5.50,
        changePercent: 1.24
      }
    },
    productivity: {
      config: { type: 'productivity', title: 'Tasks' },
      data: {
        tasks: [
          { id: '1', text: 'Review pull requests', completed: true },
          { id: '2', text: 'Update documentation', completed: false },
          { id: '3', text: 'Deploy to staging', completed: false }
        ]
      }
    },
    // Data widgets
    chart: {
      config: { type: 'chart', title: 'My Chart', chartType: 'bar' },
      data: {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
        datasets: [{ label: 'Sales', data: [12, 19, 3, 5, 2] }]
      }
    },
    table: {
      config: { type: 'table', title: 'My Table', enableSort: true, enableFilter: true, enablePagination: true },
      data: [
        { id: 1, name: 'Item 1', status: 'active', value: 100 },
        { id: 2, name: 'Item 2', status: 'pending', value: 200 },
        { id: 3, name: 'Item 3', status: 'completed', value: 150 }
      ]
    },
    form: {
      config: { type: 'form', title: 'My Form', submitLabel: 'Submit' },
      data: {
        fields: [
          { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Enter your name' },
          { name: 'email', label: 'Email', type: 'email', required: true, validation: { pattern: '^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$' } }
        ]
      }
    },
    // Button widget - action trigger
    button: {
      config: { 
        type: 'button', 
        title: 'Action Button', 
        label: 'Click Me',
        action: 'my-action',
        actionType: 'value',
        value: 'Hello',
        fullWidth: true,
        variant: 'default'
      },
      data: {
        executionCount: 0
      }
    },
    'macro-board': {
      config: {
        type: 'macro-board',
        title: 'Macro Board',
        size: 'md',
        rows: 3,
        columns: 3,
        buttons: [
          { id: 'commands', label: 'Commands', icon: 'bolt', command: 'workbench.action.showCommands', tone: 'danger' },
          { id: 'daily-note', label: 'Daily Note', icon: 'calendar', command: 'markdown-editor.openDailyNote' },
          { id: 'quick-open', label: 'Quick Open', icon: 'search', command: 'workbench.action.quickOpen' },
          { id: 'sidebar', label: 'Sidebar', icon: 'layers', command: 'workbench.action.toggleSidebarVisibility' },
          { id: 'graph', label: 'Graph View', icon: 'sparkles', command: 'markdown-editor.openGraphView', tone: 'success' },
          { id: 'notes', label: 'Open Note', icon: 'chat', command: 'markdown-editor.quickOpenNote' },
          { id: 'terminal', label: 'Terminal', icon: 'code', command: 'workbench.action.terminal.toggleTerminal' },
          { id: 'settings', label: 'Settings', icon: 'sliders', command: 'workbench.action.openSettings' },
          { id: 'save-all', label: 'Save All', icon: 'camera', command: 'workbench.action.files.saveAll' }
        ]
      },
      data: {
        executionCounts: {}
      }
    },
    'dev-commands': {
      config: {
        type: 'dev-commands',
        title: 'Dev Commands',
        gridSize: '4x4',
        commands: [
          { id: 'explorer', label: 'Explorer', icon: 'explorer', command: 'workbench.view.explorer' },
          { id: 'search', label: 'Search', icon: 'search', command: 'workbench.view.search' },
          { id: 'source-control', label: 'Source Control', icon: 'source-control', command: 'workbench.view.scm' },
          { id: 'extensions', label: 'Extensions', icon: 'extensions', command: 'workbench.view.extensions' },
          { id: 'problems', label: 'Problems', icon: 'problems', command: 'workbench.actions.view.problems' },
          { id: 'output', label: 'Output', icon: 'output', command: 'workbench.action.output.toggleOutput' },
          { id: 'git', label: 'Git', icon: 'git', command: 'git.openChange' },
          { id: 'terminal', label: 'Terminal', icon: 'terminal', command: 'workbench.action.terminal.toggleTerminal' },
          { id: 'run', label: 'Run', icon: 'run', command: 'workbench.action.debug.run' },
          { id: 'debug', label: 'Debug', icon: 'debug', command: 'workbench.action.debug.start' },
          { id: 'tasks', label: 'Tasks', icon: 'tasks', command: 'workbench.action.tasks.runTask' },
          { id: 'palette', label: 'Palette', icon: 'palette', command: 'workbench.action.showCommands' },
          { id: 'quick-open', label: 'Quick Open', icon: 'search', command: 'workbench.action.quickOpen' },
          { id: 'sidebar', label: 'Sidebar', icon: 'sidebar', command: 'workbench.action.toggleSidebarVisibility' },
          { id: 'theme', label: 'Theme', icon: 'theme', command: 'workbench.action.selectTheme' },
          { id: 'save-all', label: 'Save All', icon: 'save', command: 'workbench.action.files.saveAll' }
        ]
      },
      data: {
        executionCounts: {}
      }
    }
  };

  const template = templates[widgetType];
  if (!template) {
    console.error(`[Widget] Unknown widget type: ${widgetType}`);
    return;
  }

  // Generate widget block
  const configLines = Object.entries(template.config)
    .map(([key, value]) => {
      if (typeof value === 'object') {
        return `${key}: ${JSON.stringify(value)}`;
      }
      return `${key}: ${value}`;
    })
    .join('\n');

  const dataSection = template.data ? `\n---\ndata: ${JSON.stringify(template.data, null, 2)}` : '';
  const widgetBlock = `\n\`\`\`widget\n${configLines}${dataSection}\n\`\`\`\n\n`;

  window.vditor.insertValue(widgetBlock);
}

// Capture diagnostics from extension messages (hook into existing message handler later)
// We'll patch into window.addEventListener('message') switch further below to update state.lastDiagnostics

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
      click: () => vscode?.postMessage({ command: "triggerQuickFix" }),
      disabled: !diagAvailable,
    },
    {
      label: "Format Document",
      click: () => vscode?.postMessage({ command: "formatDocument" }),
    },
    {
      label: "Format Selection",
      click: () => vscode?.postMessage({ command: "formatSelection" }),
      disabled: !selection.hasSelection,
    },
    {
      label: "Show Problems",
      click: () => vscode?.postMessage({ command: "showProblems" }),
    }
  );
  items.push({ separator: true });
  // Navigation / search group
  items.push(
    { label: "Find", click: () => vscode?.postMessage({ command: "find" }) },
    {
      label: "Find & Replace",
      click: () => vscode?.postMessage({ command: "findAndReplace" }),
    }
  );
  items.push({ separator: true });
  // Insert submenu
  items.push({
    label: "Insert",
    submenu: [
      {
        label: "Link",
        click: () => vscode?.postMessage({ command: "insertLink" }),
      },
      {
        label: "Image",
        click: () => vscode?.postMessage({ command: "insertImage" }),
      },
      {
        label: "Table",
        click: () => vscode?.postMessage({ command: "insertTable" }),
      },
      { separator: true },
      {
        label: "Kanban Board",
        click: () =>
          vscode?.postMessage({
            command: "requestInsertRenderer",
            rendererType: "kanban-board",
          }),
      },
      {
        label: "Interactive Table",
        click: () =>
          vscode?.postMessage({
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
      {
        label: "📋 Dashboard",
        click: () => {
          const dashboardText = `\n\`\`\`dashboard
title: My Dashboard
columns: 3
widgets:
  - type: clock
    config:
      format: 12h
  - type: calendar
  - type: weather
    data:
      temperature: 72
      condition: sunny
\`\`\`\n`;
          if (window.vditor) {
            window.vditor.insertValue(dashboardText);
          }
        },
      },
      { separator: true },
      {
        label: "⏰ Clock Widget",
        click: () => insertWidgetDirect("clock"),
      },
      {
        label: "⏱️ Timer Widget",
        click: () => insertWidgetDirect("timer"),
      },
      {
        label: "🚨 Alarm Widget",
        click: () => insertWidgetDirect("alarm"),
      },
      {
        label: "🔔 Single Alarm Widget",
        click: () => insertWidgetDirect("single-alarm"),
      },
      {
        label: "⏱️ Stopwatch Widget",
        click: () => insertWidgetDirect("stopwatch"),
      },
      {
        label: "📅 Calendar Widget",
        click: () => insertWidgetDirect("calendar"),
      },
      {
        label: "📆 Calendar Month Widget",
        click: () => insertWidgetDirect("calendar-month"),
      },
      {
        label: "📅 Calendar Events Widget",
        click: () => insertWidgetDirect("calendar-events"),
      },
      {
        label: "🌤️ Weather Widget",
        click: () => insertWidgetDirect("weather"),
      },
      {
        label: "📈 Stock Widget",
        click: () => insertWidgetDirect("stock"),
      },
      {
        label: "✅ Tasks Widget",
        click: () => insertWidgetDirect("productivity"),
      },
      {
        label: "📊 Chart Widget",
        click: () => insertWidgetDirect("chart"),
      },
      {
        label: "📋 Table Widget",
        click: () => insertWidgetDirect("table"),
      },
      {
        label: "📝 Form Widget",
        click: () => insertWidgetDirect("form"),
      },
      {
        label: "🔘 Button Widget",
        click: () => insertWidgetDirect("button"),
      },
      {
        label: "🎛️ Macro Board Widget",
        click: () => insertWidgetDirect("macro-board"),
      },
      {
        label: "⌨️ Dev Commands Widget",
        click: () => insertWidgetDirect("dev-commands"),
      },
    ],
  });
  items.push({ separator: true });
  // Misc group
  items.push(
    {
      label: "Command Palette...",
      click: () => vscode?.postMessage({ command: "showCommandPalette" }),
    },
    {
      label: "Toggle Word Wrap",
      click: () => vscode?.postMessage({ command: "toggleWordWrap" }),
    }
  );
  return items;
}

// Enhance manual context menu to support submenus
export function enhanceManualMenuForSubmenus(menuRoot: HTMLElement) {
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
          : "var(--vscode-menu-foreground, #cccccc)";
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

// Flag to prevent duplicate paste operations (owned on window for
// cross-module access by vscode-integrator).
(window as any).isProgrammaticPaste = false;

// Robust clipboard handling utilities using modern Clipboard API
export async function performClipboardAction(kind: "cut" | "copy" | "paste") {
  try {
    if (kind === "paste") {
      // Set flag to prevent duplicate paste from event listener
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
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
              const range = sel.getRangeAt(0);
              if (!range.collapsed) {
                try {
                  range.deleteContents();
                  range.collapse(true);
                  sel.removeAllRanges();
                  sel.addRange(range);
                } catch (errDel) {
                  vscodeLog(`❌ Delete selection before paste failed: ${errDel}`);
                }
              }
            }

            if (typeof window.vditor.insertMD === "function") {
              window.vditor.insertMD(text);
              return; // SUCCESS - STOP HERE
            }

            window.vditor.insertValue(text);
            return; // SUCCESS - STOP HERE
          }
        }

        // Fallback: ask extension if Clipboard API failed
        vscode?.postMessage({ command: "clipboardReadRequest" });
      } finally {
        // Reset flag after a short delay to allow event to be suppressed
        setTimeout(() => {
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

      const clipboardText = getMarkdownClipboardText({
        fallbackText: text,
        fallbackRoot: window.vditor?.vditor?.ir?.element || document.body,
        selection: sel,
        vditor: window.vditor,
      });

      // Modern Clipboard API approach
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(clipboardText);

          // If cut, delete the selection
          if (kind === "cut") {
            const activeRange =
              range || (sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null);
            if (activeRange) {
              try {
                activeRange.deleteContents();
                if (sel) {
                  sel.removeAllRanges();
                  sel.addRange(activeRange);
                }
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
      vscode?.postMessage({ command: "clipboardWriteRequest", kind, text: clipboardText });
    }
  } catch (err) {
    vscodeLog(`❌ Clipboard action ${kind} failed: ${err}`);
    if (kind === "paste") {
      vscode?.postMessage({ command: "clipboardReadRequest" });
    } else {
      const sel = window.getSelection();
      const text = sel ? sel.toString() : "";
      vscode?.postMessage({ command: "clipboardWriteRequest", kind, text });
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

// Read-only warning tooltip functions
