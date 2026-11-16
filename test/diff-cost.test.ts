import { expect, test } from "vitest";
import { LCS_CELL_LIMIT, MarkdownDiffViewSupport, myersChanges } from "../src/diff/MarkdownDiffViewSupport";
import { parseHTMLToLines } from "../src/diff/HtmlLineParser";

/** Deterministic PRNG so failures reproduce. */
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

function apply(left: string[], changes: ReturnType<typeof myersChanges>): string[] {
  const deleted = new Set(changes.filter((c) => c.type === "deleted").map((c) => c.lineNumber));
  const added = changes.filter((c) => c.type === "added").sort((a, b) => a.lineNumber - b.lineNumber);
  const kept = left.filter((_, i) => !deleted.has(i));
  const out: string[] = [];
  let k = 0;
  for (let j = 0; k < kept.length || out.length < kept.length + added.length; j++) {
    const add = added.find((c) => c.lineNumber === j);
    out.push(add ? add.content : kept[k++]);
  }
  return out;
}

function lcsLength(a: string[], b: string[]): number {
  const row = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : Math.max(row[j], row[j - 1]);
      diagonal = above;
    }
  }
  return row[b.length];
}

test("Myers yields a minimal edit script that rebuilds the right side", () => {
  const random = rng(7);
  for (let round = 0; round < 300; round++) {
    const alphabet = "abcde".slice(0, 2 + Math.floor(random() * 4));
    const make = () => Array.from({ length: Math.floor(random() * 14) }, () => alphabet[Math.floor(random() * alphabet.length)]);
    const left = make();
    const right = make();
    const changes = myersChanges(left, right);
    expect(apply(left, changes)).toEqual(right);
    const lcs = lcsLength(left, right);
    expect(changes.filter((c) => c.type === "deleted")).toHaveLength(left.length - lcs);
    expect(changes.filter((c) => c.type === "added")).toHaveLength(right.length - lcs);
  }
});

test("documents past the LCS cell limit diff in bounded time and keep alignment", () => {
  const support = new MarkdownDiffViewSupport({} as any);
  const lines = Array.from({ length: 2000 }, (_, i) => `<p>Line ${i}</p>`);
  expect(lines.length * lines.length).toBeGreaterThan(LCS_CELL_LIMIT);
  const right = [...lines.slice(0, 10), "<p>Inserted</p>", ...lines.slice(10, 1500), ...lines.slice(1501)];
  parseHTMLToLines(lines.join(""));
  let started = performance.now();
  parseHTMLToLines(lines.join(""));
  parseHTMLToLines(right.join(""));
  const parseOnly = performance.now() - started;
  started = performance.now();
  const result = support.calculateDiffFromHTML(lines.join(""), right.join(""));
  // Relative to parsing, so a loaded machine cannot flake it; an O(n*m) table would be ~4x.
  expect(performance.now() - started).toBeLessThan(parseOnly * 2.5 + 20);
  expect(result.changes.filter((c) => c.type === "added").map((c) => c.content)).toEqual(["<p>Inserted</p>"]);
  expect(result.changes.filter((c) => c.type === "deleted").map((c) => c.content)).toEqual(["<p>Line 1500</p>"]);
});
