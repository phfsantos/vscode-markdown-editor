/**
 * Unit-level repros for the suspected diff-view issues in
 * docs/testing/diff-view-findings.md (S2, S3, S7, S8). Each started red against
 * the pre-overhaul code and is kept as a regression test.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { __reset, Uri } from "vscode";
import { parseHostToWebviewMessage } from "@markdown-editor/core";
import { DiffViewController, type DiffHost } from "../src/app/DiffViewController";
import { MarkdownDiffViewSupport } from "../src/diff/MarkdownDiffViewSupport";
import { parseHTMLToLines } from "../src/diff/HtmlLineParser";

type FakeHost = DiffHost & { messages: any[] };

function fakeHost(instanceId: string, uri: Uri, tab: object, coordinator: any): FakeHost {
  const host: any = {
    instanceId,
    uri,
    document: { uri, getText: () => "" },
    tab,
    viewColumn: 1,
    webviewReady: true,
    renderedReady: true,
    panelVisible: true,
    panelActive: true,
    messages: [],
    postMessage(message: unknown) { host.messages.push(message); },
    postInlineSuggestionEligibility() {},
    requestIRHtml: async () => `<p>${instanceId}</p>`,
    requestRenderedMarkdownHtml: async (markdown: string) => `<p>${markdown}</p>`,
  };
  host.diff = new DiffViewController(host, coordinator);
  return host;
}

const coordinator = {
  calculateDiffFromHTML: () => ({ changes: [{ type: "modified", side: "both", lineNumber: 0 }], leftHtmlLines: [], rightHtmlLines: [] }),
  handleScrollSync: () => {},
};

beforeEach(() => {
  __reset();
  DiffViewController.calculationInProgress.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

async function roleOf(host: FakeHost): Promise<string | undefined> {
  await vi.runAllTimersAsync();
  return host.messages.find((m) => m.type === "diff-view-detected" || m.command === "diff-view-detected")?.diffInfo?.role;
}

// S2: sides must not depend on the label or on which side VS Code resolves first.
for (const order of ["original-first", "modified-first"] as const) {
  test(`S2: a Git diff assigns original=left when ${order}`, async () => {
    const original = fakeHost("orig", Uri.parse("git:/w/diff.md"), {}, coordinator);
    const modified = fakeHost("mod", Uri.file("/w/diff.md"), {}, coordinator);
    const sides = order === "original-first" ? [original, modified] : [modified, original];
    for (const host of sides) host.diff.registerExplicitDiffPanel({ uri: host.uri.toString(), writable: host.uri.scheme === "file" });
    void original.diff.checkDiffViewContextReactive();
    expect(await roleOf(original)).toBe("left");
    expect(await roleOf(modified)).toBe("right");
  });
}

// S3: disposing one side deletes the whole pair, so a re-resolved side never pairs again.
test("S3: disposing one side keeps the other side registered for its re-created partner", async () => {
  const original = fakeHost("orig", Uri.parse("git:/w/diff.md"), {}, coordinator);
  const modified = fakeHost("mod", Uri.file("/w/diff.md"), {}, coordinator);
  modified.diff.registerExplicitDiffPanel({ uri: modified.uri.toString(), writable: true });
  original.diff.registerExplicitDiffPanel({ uri: original.uri.toString(), writable: false });
  original.diff.dispose();
  const reopened = fakeHost("orig-2", Uri.parse("git:/w/diff.md"), {}, coordinator);
  reopened.diff.registerExplicitDiffPanel({ uri: reopened.uri.toString(), writable: false });
  void reopened.diff.checkDiffViewContextReactive();
  await vi.runAllTimersAsync();
  expect(modified.messages.some((m) => (m.type ?? m.command) === "diff-view-detected")).toBe(true);
  for (const host of [modified, reopened]) host.diff.dispose();
});

// S8: diff messages bypass the typed host->webview protocol.
test("S8: diff-view-detected and diff-view-cleared are typed host protocol messages", () => {
  const detected = parseHostToWebviewMessage({
    command: "diff-view-detected",
    diffInfo: { role: "right", mode: "inline", otherUri: "file:///a.md", changes: [], stats: { added: 0, deleted: 0, modified: 0 }, version: 1 },
  });
  expect(detected.kind).toBe("message");
  expect(parseHostToWebviewMessage({ command: "diff-view-cleared" }).kind).toBe("message");
});

// S7: the LCS table is (m+1)x(n+1) and every change is JSON-logged. Wall-clock
// limits flake under a parallel suite, so the bound is relative to the
// unavoidable cost of parsing both sides (pre-fix: ~5.5x; fixed: ~1.1x).
test("S7: a 6000-line diff costs little more than parsing it", () => {
  vi.useRealTimers();
  const support = new MarkdownDiffViewSupport({} as any);
  const lines = Array.from({ length: 6000 }, (_, i) => `<p>Line ${i}</p>`);
  const changed = lines.map((line, i) => (i % 500 === 0 ? `<p>Changed ${i}</p>` : line));
  const left = lines.join("");
  const right = changed.join("");
  parseHTMLToLines(left); // warm the parser
  let started = performance.now();
  parseHTMLToLines(left);
  parseHTMLToLines(right);
  const parseOnly = performance.now() - started;
  started = performance.now();
  const result = support.calculateDiffFromHTML(left, right);
  const elapsed = performance.now() - started;
  expect(result.changes.filter((c) => c.type === "modified")).toHaveLength(12);
  expect(elapsed).toBeLessThan(parseOnly * 2.5 + 20);
});
