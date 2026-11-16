import type * as vscode from "vscode";
import type {
  PendingEdit,
  PendingEditDocumentLike,
  PendingEditSource,
} from "./pendingEditSource";

/**
 * PRIVATE-SCHEME COMPATIBILITY GLUE. Fails closed.
 *
 * Claude Code shows a proposed edit (from its own Edit/Write tools) as a VS
 * Code diff and only writes the file when the user accepts. It exposes no API
 * for this. The shape below was read from the bundle of the installed
 * extension, anthropic.claude-code 2.1.323 (extension.js), and confirmed by
 * live handler-generated diff tabs in isolated VS Code 1.115.0:
 *
 * - It registers file system providers for `_claude_vscode_fs_left` and
 *   `_claude_vscode_fs_right`. Their `uriFor(path, query = "")` builds
 *   `Uri.from({ scheme, path, query })`, with the path converted to `/c:/...`
 *   form on Windows.
 * - It calls `workspace.openTextDocument(right)` and then
 *   `vscode.diff(left, right, "✻ [Claude Code] <file name>", ...)`. The left
 *   side is normally `Uri.file(<path>)` (the untouched file), or a
 *   `_claude_vscode_fs_left` copy when the file is dirty. The right side is
 *   `_claude_vscode_fs_right:<path>` holding the full proposed text.
 * - When the edit's text cannot be found, it falls back to showing only the
 *   edited fragment at a renamed path (`<name> (edited text only).<ext>`) with
 *   a query. That is not the whole proposed file, so it never matches here.
 *
 * Live captures confirm the right document is in `workspace.textDocuments`
 * while the proposal is open. Windows and remote (vscode-server) path forms
 * remain unverified. Its terminal/IDE-MCP integration registers
 * the same file-system provider under `_claude_fs_left` / `_claude_fs_right`;
 * the right scheme is accepted separately, with the same exact path and open
 * document checks. Both shapes have live URI captures in the compatibility matrix.
 *
 * Any mismatch (no `TabInputTextDiff` class, another scheme, another path,
 * the proposed document not open) reports no pending edit.
 */
export const CLAUDE_CODE_DIFF_RIGHT_SCHEME = "_claude_vscode_fs_right";
export const CLAUDE_CODE_TERMINAL_DIFF_RIGHT_SCHEME = "_claude_fs_right";

type UriLike = Pick<vscode.Uri, "scheme" | "path"> & { query?: string };

interface TextDiffInputLike {
  readonly original: UriLike;
  readonly modified: UriLike;
}

export interface ClaudeCodeDiffEnvironment<TDoc extends PendingEditDocumentLike> {
  readonly tabGroups: {
    readonly all: readonly { readonly tabs: readonly { readonly input: unknown }[] }[];
  };
  /** `vscode.TabInputTextDiff`; missing on hosts without the tab API, which then never report an edit. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly TabInputTextDiff: (abstract new (...args: any[]) => TextDiffInputLike) | undefined;
  textDocuments(): readonly TDoc[];
}

const sameUri = (a: UriLike, b: UriLike) =>
  a.scheme === b.scheme && a.path === b.path && (a.query ?? "") === (b.query ?? "");

export function createClaudeCodePendingEditSource<TDoc extends PendingEditDocumentLike>(
  environment: ClaudeCodeDiffEnvironment<TDoc>,
): PendingEditSource<TDoc> {
  const isProposalFor = (document: TDoc, uri: UriLike) =>
    (uri.scheme === CLAUDE_CODE_DIFF_RIGHT_SCHEME ||
      uri.scheme === CLAUDE_CODE_TERMINAL_DIFF_RIGHT_SCHEME) && uri.path === document.uri.path;

  return {
    id: "claude-code-diff",
    label: "Claude Code",
    isRelevantDocument(document, candidate) {
      return isProposalFor(document, candidate.uri);
    },
    findPendingEdit(document): PendingEdit<TDoc> | undefined {
      const TabInputTextDiff = environment.TabInputTextDiff;
      if (typeof TabInputTextDiff !== "function") return undefined;
      for (const group of environment.tabGroups.all) {
        for (const tab of group.tabs) {
          const input = tab.input;
          if (!(input instanceof TabInputTextDiff) || !isProposalFor(document, input.modified)) continue;
          const compareDocument = environment
            .textDocuments()
            .find((candidate) => sameUri(candidate.uri, input.modified));
          if (!compareDocument) continue;
          return {
            sourceId: "claude-code-diff",
            sourceLabel: "Claude Code",
            documentRole: "original",
            compareDocument,
          };
        }
      }
      return undefined;
    },
  };
}
