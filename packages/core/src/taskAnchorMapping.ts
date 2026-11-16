export interface TaskTarget { documentVersion: number; line: number; expectedLineText: string }
export interface ParsedTask { line: number; start: number; end: number; text: string; checked: boolean; ordinal: number }
export interface TaskAnchor extends ParsedTask { documentVersion: number }
export interface SourceChange { rangeOffset: number; rangeLength: number; text: string }

/** Conservative block parser with source offsets. Unsupported containers fail closed.
 * Fences, HTML blocks and indented code never produce task nodes. List indentation
 * is tracked so nested task items are distinguished from indented code.
 */
export function parseTaskItems(source: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  const lines = source.split(/\r\n|\n|\r/);
  let offset = 0;
  let fence: { marker: string; length: number } | undefined;
  const containers: number[] = [];
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line]; const start = offset;
    offset += text.length + (source.slice(offset + text.length).startsWith('\r\n') ? 2 : 1);
    const indent = /^ */.exec(text)![0].length;
    const stripped = text.slice(indent);
    const marker = /^(`{3,}|~{3,})(.*)$/.exec(stripped);
    if (fence) {
      if (marker && marker[1][0] === fence.marker && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      continue;
    }
    // These containers require a richer parser. Reject the entire projection so
    // an omitted rendered checkbox cannot shift a later task's ordinal.
    if (/^\s*>|^\s*\t/.test(text) || /^</.test(stripped)) return [];
    while (containers.length && indent < containers[containers.length - 1]) containers.pop();
    const base = containers[containers.length - 1] ?? 0;
    if (indent - base >= 4) continue;
    if (marker && !(marker[1][0] === '`' && marker[2].includes('`'))) { fence = { marker: marker[1][0], length: marker[1].length }; continue; }
    const list = /^(?:[-+*]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(stripped);
    if (!list) { if (text.trim() && indent === 0) containers.length = 0; continue; }
    // A fence may start on the same line as one or more list markers.
    let body = list[2];
    while (/^(?:[-+*]|\d{1,9}[.)])[ \t]+/.test(body)) body = body.replace(/^(?:[-+*]|\d{1,9}[.)])[ \t]+/, '');
    if (body.startsWith('<') || body.startsWith('>') || /\t/.test(list[1])) return [];
    const listFence = /^(`{3,}|~{3,})(.*)$/.exec(body);
    if (listFence && !(listFence[1][0] === '`' && listFence[2].includes('`'))) {
      fence = { marker: listFence[1][0], length: listFence[1].length }; continue;
    }
    const prefixLength = list[0].length - list[2].length;
    containers.push(indent + prefixLength);
    const checkbox = /^\[([ xX])\](?:[ \t]+|$)/.exec(list[2]);
    if (checkbox) tasks.push({ line, start, end: start + text.length, text, checked: checkbox[1] !== ' ', ordinal: tasks.length });
  }
  return tasks;
}
export function resolveTaskAnchor(source: string, version: number, target: TaskTarget): TaskAnchor | undefined {
  if (target.documentVersion !== version || !Number.isSafeInteger(target.line) || target.line < 0) return;
  const node = parseTaskItems(source).find(task => task.line === target.line && task.text === target.expectedLineText);
  return node ? { ...node, documentVersion: version } : undefined;
}
export function remapTaskAnchor(before: string, after: string, version: number, anchor: TaskAnchor, changes: readonly SourceChange[]): TaskAnchor | undefined {
  const ordered = [...changes].sort((a, b) => a.rangeOffset - b.rangeOffset);
  let previousEnd = -1; let delta = 0;
  for (const change of ordered) {
    const { rangeOffset: start, rangeLength: length, text } = change;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start + length > before.length || start <= previousEnd) return;
    previousEnd = start + length;
    if (start === 0 && length === before.length) return;
    // Insertion at the line start is safe only when it adds complete preceding lines.
    if (start === anchor.start && length === 0 && /(?:\r\n|\n|\r)$/.test(text)) { delta += text.length; continue; }
    if (start <= anchor.end && start + length >= anchor.start) return;
    if (start < anchor.start) delta += text.length - length;
  }
  // Verify that the batch describes the actual next document, not a guessed edit.
  let reconstructed = before;
  for (const c of [...ordered].reverse()) reconstructed = reconstructed.slice(0,c.rangeOffset) + c.text + reconstructed.slice(c.rangeOffset + c.rangeLength);
  if (reconstructed !== after) return;
  const node = parseTaskItems(after).find(node => node.start === anchor.start + delta && node.text === anchor.text);
  return node ? { ...node, documentVersion: version } : undefined;
}

/** Changed regions larger than this many line pairs are not aligned; they report no tasks. */
const MAX_ALIGNED_LINE_PAIRS = 1_000_000;

/**
 * Tasks of `source` whose line has no unchanged counterpart in `other`, by a
 * longest-common-subsequence line alignment. Used to mark the checkboxes a
 * pending edit touches: `other` is the version the open document is reviewed
 * against. Fails closed (returns no tasks) when `source` has no parseable task
 * projection or the changed region is too large to align.
 */
export function findChangedTasks(source: string, other: string): ParsedTask[] {
  const tasks = parseTaskItems(source);
  if (tasks.length === 0) return [];
  const a = source.split(/\r\n|\n|\r/); const b = other.split(/\r\n|\n|\r/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length; let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const n = endA - start; const m = endB - start;
  if (n * m > MAX_ALIGNED_LINE_PAIRS) return [];
  // lengths[i * (m + 1) + j]: LCS length of a[start+i..endA) and b[start+j..endB).
  const width = m + 1; const lengths = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    lengths[i * width + j] = a[start + i] === b[start + j]
      ? lengths[(i + 1) * width + j + 1] + 1
      : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
  }
  const changed = new Set<number>();
  let i = 0; let j = 0;
  while (i < n) {
    if (j < m && a[start + i] === b[start + j]) { i++; j++; }
    else if (j < m && lengths[i * width + j + 1] >= lengths[(i + 1) * width + j]) j++;
    else { changed.add(start + i); i++; }
  }
  return tasks.filter(task => changed.has(task.line));
}
