import { t } from "./lang";
import { cleanContentForSave } from "./utils";

export const toolbar = [
  {
    hotkey: "⌘s",
    name: "save",
    tipPosition: "s",
    tip: t("save"),
    className: "save",
    icon: '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M810.667 938.667H213.333a128 128 0 01-128-128V213.333a128 128 0 01128-128h469.334a42.667 42.667 0 0130.293 12.374L926.293 311.04a42.667 42.667 0 0112.374 30.293v469.334a128 128 0 01-128 128zm-597.334-768a42.667 42.667 0 00-42.666 42.666v597.334a42.667 42.667 0 0042.666 42.666h597.334a42.667 42.667 0 0042.666-42.666v-451.84l-188.16-188.16z"/><path d="M725.333 938.667A42.667 42.667 0 01682.667 896V597.333H341.333V896A42.667 42.667 0 01256 896V554.667A42.667 42.667 0 01298.667 512h426.666A42.667 42.667 0 01768 554.667V896a42.667 42.667 0 01-42.667 42.667zM640 384H298.667A42.667 42.667 0 01256 341.333V128a42.667 42.667 0 0185.333 0v170.667H640A42.667 42.667 0 01640 384z"/></svg>',
    click() {
      vscode.postMessage({
        command: "save",
        content: vditor.getValue(),
      });
    },
  },
  "emoji",
  "headings",
  "bold",
  "italic",
  "strike",
  "link",
  "|",
  "list",
  "ordered-list",
  "check",
  "outdent",
  "indent",
  "|",
  "quote",
  "line",
  "code",
  "inline-code",
  "insert-before",
  "insert-after",
  "|",
  "upload",
  "table",
  "|",
  "undo",
  "redo",
  "|",
  {
    hotkey: "⌘f",
    name: "find",
    tipPosition: "s",
    tip: "Find (Ctrl+F)",
    className: "find",
    icon: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor"><path d="M10.25 2a8.25 8.25 0 0 1 6.34 13.53l5.69 5.69a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215l-5.69-5.69A8.25 8.25 0 1 1 10.25 2ZM3.5 10.25a6.75 6.75 0 1 0 13.5 0 6.75 6.75 0 0 0-13.5 0Z"></path></svg>',
    click() {
      // This will be handled by the FindReplaceManager
      if ((window as any).findReplaceManager) {
        (window as any).findReplaceManager.showFind();
      }
    },
  },
  {
    hotkey: "⌘h",
    name: "find-replace",
    tipPosition: "s",
    tip: "Find and Replace (Ctrl+H)",
    className: "find-replace",
    icon: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor"><path d="M11 2a9 9 0 0 1 6.364 15.364l4.136 4.136a.75.75 0 1 1-1.06 1.06l-4.136-4.136A9 9 0 1 1 11 2zm0 16.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z"/><path d="M8.25 9.25a.75.75 0 0 1 .75-.75h3.19l-.72-.72a.75.75 0 0 1 1.06-1.06l2 2a.75.75 0 0 1 0 1.06l-2 2a.75.75 0 1 1-1.06-1.06l.72-.72H9a.75.75 0 0 1-.75-.75z"/><path d="M13.75 12.75A.75.75 0 0 1 13 13.5H9.81l.72.72a.75.75 0 0 1-1.06 1.06l-2-2a.75.75 0 0 1 0-1.06l2-2a.75.75 0 0 1 1.06 1.06l-.72.72H13a.75.75 0 0 1 .75.75z"/></svg>',
    click() {
      // This will be handled by the FindReplaceManager
      if ((window as any).findReplaceManager) {
        (window as any).findReplaceManager.showFindReplace();
      }
    },
  },
  "|",
  // Removed "edit-mode" button - IR mode is locked for consistent editing experience
  {
    name: "more",
    tipPosition: "e",
    toolbar: [
      "both",
      "code-theme",
      // Removed "content-theme" button - content should use VS Code theme colors
      "outline",
      // Removed "preview" button - use VS Code's native markdown preview instead
      {
        name: "copy-markdown",
        icon: t("copyMarkdown"),
        async click() {
          try {
            await navigator.clipboard.writeText(vditor.getValue());
            vscode.postMessage({
              command: "info",
              content: "Copy Markdown successfully!",
            });
          } catch (error) {
            vscode.postMessage({
              command: "error",
              content: `Copy Markdown failed! ${error.message}`,
            });
          }
        },
      },
      {
        name: "copy-html",
        icon: t("copyHtml"),
        async click() {
          try {
            await navigator.clipboard.writeText(vditor.getHTML());
            vscode.postMessage({
              command: "info",
              content: "Copy HTML successfully!",
            });
          } catch (error) {
            vscode.postMessage({
              command: "error",
              content: `Copy HTML failed! ${error.message}`,
            });
          }
        },
      },
      // Removed "reset-config" button - config should be managed through VS Code settings
      // Removed "devtools" button - unnecessary for production use
      // Removed "info" button - redundant with VS Code's help system
      // Removed "help" button - use VS Code's built-in help instead
    ],
  },
].map((it: any) => {
  if (typeof it === "string") {
    it = { name: it };
  }
  it.tipPosition = it.tipPosition || "s";
  return it;
});
