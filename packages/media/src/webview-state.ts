import type { DiagnosticVisualizer } from "./diagnostic-visualizer";
import type { VSCodeWebviewIntegrator } from "./vscode-integrator";
import type { FindReplaceManager } from "./find-replace";
import type { WikiLinkHandler } from "./wiki-link-handler";

/**
 * Mutable state shared between the webview's feature modules (vditor init,
 * message handling, context menu). Everything created during initVditor and
 * consumed by the message handler lives here; state used by a single module
 * stays local to that module.
 */
export const state = {
  diagnosticVisualizer: null as DiagnosticVisualizer | null,
  vscodeIntegrator: null as VSCodeWebviewIntegrator | null,
  findReplaceManager: null as FindReplaceManager | null,
  wikiLinkHandler: null as WikiLinkHandler | null,
  renderMarkdownToHtmlForDiff: null as
    | ((markdown: string, documentFilename?: string) => Promise<string>)
    | null,
  isReadOnly: false,
  lastDiagnostics: [] as any[],
};

/** Mirror webview logs to the extension host for debugging. */
export function vscodeLog(message: string) {
  vscode?.postMessage({
    command: "log",
    message: message,
  });
}
