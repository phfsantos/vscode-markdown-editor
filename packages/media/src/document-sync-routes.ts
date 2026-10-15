import type { HostMessage, HostMessageRoutes } from "./host-message-router";
import type { WebviewContentSync } from "./content-sync";

/** How long after an accepted external update diagnostics are force-applied. */
export const EXTERNAL_CHANGE_DIAGNOSTIC_WINDOW_MS = 500;

export interface DocumentSyncRouteDependencies {
  getContentSync(): WebviewContentSync;
  /** Record per-update document state (filename, read-only flag). */
  recordDocumentState(message: HostMessage<"update">): void;
  /** First render of the editor for an `update` of type `init`. */
  initializeEditor(message: HostMessage<"update">): void;
  /** Replace the rendered document after the host accepted an external change. */
  replaceEditorContent(content: string): void;
  /** Re-run render-dependent work (wiki-links, line numbers, suggestions). */
  afterExternalUpdate(): void;
  applyDiagnostics(message: HostMessage<"diagnostics">, forceApply: boolean): void;
  setTimeout(callback: () => void, delayMs: number): unknown;
}

/**
 * Host `update` and `diagnostics` routes. External updates pass through the
 * content synchronizer's generation check before they touch the editor, and
 * only an accepted update arms the diagnostic force-apply window.
 */
export function createDocumentSyncRoutes(dependencies: DocumentSyncRouteDependencies): HostMessageRoutes {
  let justReceivedExternalChange = false;

  return {
    update: (message) => {
      dependencies.recordDocumentState(message);
      if (message.type === "init") {
        dependencies.initializeEditor(message);
        return;
      }

      const contentSync = dependencies.getContentSync();
      const accepted = contentSync.acceptExternalUpdate(
        message.content,
        message.generation ?? contentSync.getGeneration() + 1,
      );
      if (!accepted) {
        return;
      }

      // Diagnostics for an undo/redo/external edit should arrive within this window.
      justReceivedExternalChange = true;
      dependencies.replaceEditorContent(message.content);
      dependencies.afterExternalUpdate();
      dependencies.setTimeout(() => {
        justReceivedExternalChange = false;
      }, EXTERNAL_CHANGE_DIAGNOSTIC_WINDOW_MS);
    },
    diagnostics: (message) => {
      dependencies.applyDiagnostics(message, justReceivedExternalChange);
    },
  };
}
