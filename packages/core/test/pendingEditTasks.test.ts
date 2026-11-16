import { describe, expect, it } from 'vitest';
import { findChangedTasks } from '../src/taskAnchorMapping';

const lines = (...values: string[]) => values.join('\n');

describe('tasks changed by a pending edit', () => {
  it('reports only the checkbox lines of the open document that the other version lacks', () => {
    const baseline = lines('# Plan', '', '- [ ] One', '- [ ] Two', '- [ ] Three', '', 'Prose');
    const proposed = lines('# Plan', '', '- [ ] One', '- [x] Two', '- [ ] Three', '', 'Prose changed');

    expect(findChangedTasks(proposed, baseline).map(task => task.text)).toEqual(['- [x] Two']);
    // The same edit seen from the side that still holds the original text.
    expect(findChangedTasks(baseline, proposed).map(task => task.text)).toEqual(['- [ ] Two']);
  });

  it('keeps unchanged duplicate tasks unmarked and marks an inserted one by position', () => {
    const baseline = lines('- [ ] Same', '- [ ] Same');
    const proposed = lines('- [ ] Same', '- [ ] Same', '- [ ] Same');

    expect(findChangedTasks(proposed, baseline).map(task => task.line)).toEqual([2]);
  });

  it('reports nothing when only prose changed or the versions are identical', () => {
    expect(findChangedTasks(lines('- [ ] A', 'x'), lines('- [ ] A', 'y'))).toEqual([]);
    expect(findChangedTasks('- [ ] A\n', '- [ ] A\n')).toEqual([]);
  });

  it('treats CRLF and LF versions of the same text as unchanged', () => {
    expect(findChangedTasks('- [ ] A\r\n- [ ] B\r\n', '- [ ] A\n- [ ] B\n')).toEqual([]);
  });

  it('fails closed when the open document cannot be parsed into tasks', () => {
    expect(findChangedTasks('> quote\n- [x] A', '- [ ] A')).toEqual([]);
  });

  it('fails closed when the changed region is too large to align', () => {
    const big = (mark: string) => Array.from({ length: 3000 }, (_, i) => `- [${mark}] Task ${i}`).join('\n');
    expect(findChangedTasks(big('x'), big(' '))).toEqual([]);
  });
});
