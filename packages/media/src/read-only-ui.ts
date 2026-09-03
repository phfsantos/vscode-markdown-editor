
/**
 * Read-only mode UI: transient tooltip and interaction guards (typing,
 * paste, cut, drop) shown when the editor is opened read-only.
 *
 * Extracted from main.ts; behavior unchanged.
 */

let readOnlyTooltipTimeout: number | null = null;
let readOnlyTooltip: HTMLElement | null = null;

export function showReadOnlyTooltip(message: string = "This editor is read-only") {
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

export function setupReadOnlyWarnings() {
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
