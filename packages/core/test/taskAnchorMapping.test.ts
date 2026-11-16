import { describe, expect, it } from 'vitest';
import { parseTaskItems, resolveTaskAnchor, remapTaskAnchor } from '../src/taskAnchorMapping';
describe('source task anchors', () => {
  it('parses source positions, nested markers, checked tasks and duplicate labels', () => {
    const source = '- [ ] Same\r\n  * [x] Same\r\n+ [ ] 😀\r\n';
    const tasks = parseTaskItems(source);
    expect(tasks.map(t => [t.line, t.checked, t.ordinal])).toEqual([[0,false,0],[1,true,1],[2,false,2]]);
    expect(resolveTaskAnchor(source, 1, {documentVersion:1,line:1,expectedLineText:'  * [x] Same'})?.line).toBe(1);
    expect(resolveTaskAnchor(source, 2, {documentVersion:1,line:1,expectedLineText:'  * [x] Same'})).toBeUndefined();
  });
  it('excludes fences, nested fences, HTML and indented code', () => {
    const source = '```md\n- [ ] code\n```\n- parent\n  ~~~\n  - [ ] code\n  ~~~\n\n    - [ ] code\n\n- [ ] Real';
    expect(parseTaskItems(source).map(t => t.text)).toEqual(['- [ ] Real']);
  });
  it('remaps only through disjoint original-coordinate changes', () => {
    const source = '- [ ] Same\n- [ ] Same\n';
    const anchor = resolveTaskAnchor(source, 1, { documentVersion:1,line:1,expectedLineText:'- [ ] Same' })!;
    const next = 'Intro\n' + source;
    expect(remapTaskAnchor(source,next,2,anchor,[{rangeOffset:0,rangeLength:0,text:'Intro\n'}])?.line).toBe(2);
    expect(remapTaskAnchor(source,source.replace(/Same/g,'Done'),2,anchor,[{rangeOffset:0,rangeLength:source.length,text:source.replace(/Same/g,'Done')}])).toBeUndefined();
    expect(remapTaskAnchor(source,'- [ ] Same\n',2,anchor,[{rangeOffset:11,rangeLength:11,text:''}])).toBeUndefined();
    expect(remapTaskAnchor(source,source.replaceAll('[ ]','[x]'),2,anchor,[{rangeOffset:13,rangeLength:3,text:'[x]'}])).toBeUndefined();
  });
  it('invalidates adjacent structural changes and ambiguous change batches', () => {
    const source = '- [ ] Task\n'; const a = resolveTaskAnchor(source,1,{documentVersion:1,line:0,expectedLineText:'- [ ] Task'})!;
    expect(remapTaskAnchor(source,'```\n'+source,2,a,[{rangeOffset:0,rangeLength:0,text:'```\n'}])).toBeUndefined();
    expect(remapTaskAnchor(source,source,2,a,[{rangeOffset:0,rangeLength:2,text:'- '},{rangeOffset:1,rangeLength:2,text:' ['}])).toBeUndefined();
  });
});
it('does not accept tasks inside a fence opened on a list marker', () => {
  const source = '- ```md\n  - [ ] code\n  ```\n\n- [ ] Real';
  expect(parseTaskItems(source).map(t => t.text)).toEqual(['- [ ] Real']);
});
it('fails closed for unsupported quote/HTML containers rather than shifting task ordinals', () => {
  expect(parseTaskItems('> - [ ] quoted\n- [ ] real')).toEqual([]);
  expect(parseTaskItems('<div>\n\n- [ ] not markdown\n</div>\n\n- [ ] real')).toEqual([]);
});

/**
 * A ProjectMind plan `.md` as `renderPlanMarkdown` (ProjectMind
 * src/plans/planMarkdown.ts) writes it, with the metadata line rendered as a
 * plain paragraph instead of the `> ...` blockquote that fails this parser
 * closed. Mirrors the real constructs: spec task bullets with inline code,
 * numbered substeps, an "added during execution" step, a pending change whose
 * fenced diff contains checkbox-shaped and quote-shaped lines, and checked
 * criteria. Steps and criteria are the only checkboxes the plan renders here.
 */
const projectMindPlan = [
  '# Live plan-step progress in Markdown Studio',
  '',
  'Created: 2026-11-13 · Priority: **HIGH** · Owner role: `manager` · Category: `feature` · Feature: **architecture-review** (branch) · Branch: `architecture-review` · Status: active · ID: `plan-live-plan-step-progress`',
  '',
  '## Problem / Context',
  '',
  'Agents tick steps with `projectmind_updatePlanStatus`, but nothing reports which step is in progress.',
  '',
  '- **Copilot:** only the host\'s own edit tools enter the working set.',
  '- **Codex:** there is no pending state; review is a diff after the write.',
  '',
  '## Goal',
  '',
  'Show which step is running &amp; keep the `.md` a read-only projection.',
  '',
  '## Decisions',
  '',
  '- Checkbox ticks stay direct writes, never pending.',
  '',
  '## Tasks',
  '',
  '### Task 1: Parser fixture',
  '',
  '- Owner: `qa`',
  '- Engineering skill: `test-generation`',
  '- Modify: `packages/core/test/taskAnchorMapping.test.ts`',
  '',
  'Substeps:',
  '',
  '1. Render a plan with steps, a fenced diff and criteria',
  '2. Assert every step and criterion parses',
  '',
  'Validation:',
  '',
  '- `yarn vitest run packages/core/test/taskAnchorMapping.test.ts`',
  '',
  '## Dependency order',
  '',
  '1. Task 1',
  '',
  '## Sibling plans',
  '',
  'This plan is one of 2 linked parts, one per project. Each part is updated and completed in its own project; see `projectmind_listPlans` with `project: "all"` for every part\'s status.',
  '',
  '- `ProjectMind` — `plan-live-plan-step-progress-in-markdown-projectmind`',
  '',
  '## Related plans',
  '',
  '- `plan-editor-picker-duplicate-label` — 61/100 — same feature architecture-review; shared terms any, can',
  '',
  '## Steps',
  '',
  '- [x] [qa · test-generation] Add a ProjectMind plan .md fixture',
  '- [ ] [code · refactor] Extract the chat-editing detection behind a PendingEditSource',
  '- [ ] [code · tdd] Add a Claude Code PendingEditSource _(added during execution)_',
  '',
  '## Pending change (awaiting user approval)',
  '',
  'Requested 2026-11-13 (`chg-1`). Approve or reject it from the notification or the command **ProjectMind: Review Pending Plan Change**; until then the steps and criteria above stand as authored.',
  '',
  '**Reason**: The live sample cannot be captured headless.',
  '',
  '**Proposed steps**:',
  '',
  '````diff',
  '  [qa · test-generation] Add a ProjectMind plan .md fixture',
  '- [ ] old shaped like a task',
  '+ [x] new shaped like a task',
  '> quote-shaped diff text',
  '```',
  '````',
  '',
  '## Acceptance criteria',
  '',
  '- [x] The fixture parses every step and criterion',
  '- [ ] yarn lint and yarn test pass',
  '',
  '## Files',
  '',
  '- `packages/core/src/taskAnchorMapping.ts`',
  '',
  '## Notes',
  '',
  'Sources: https://github.com/microsoft/vscode/issues/279040',
  '',
].join('\n');

describe('ProjectMind plan markdown', () => {
  it('parses every step and criterion of a generated plan without the meta blockquote', () => {
    // Checkbox lines under `## Steps` and `## Acceptance criteria` only: the
    // fenced diff holds checkbox-shaped lines that must NOT become tasks.
    let section = '';
    const expected = projectMindPlan.split('\n').flatMap((text, line) => {
      if (text.startsWith('## ')) section = text;
      return /^## (Steps|Acceptance criteria)$/.test(section) && /^- \[[ x]\] /.test(text) ? [{ line, text }] : [];
    });
    expect(expected).toHaveLength(5);
    expect(parseTaskItems(projectMindPlan).map(({ line, text, checked }) => ({ line, text, checked })))
      .toEqual(expected.map(e => ({ ...e, checked: e.text.startsWith('- [x]') })));
  });
  it('resolves an anchor for each step line by line number and text', () => {
    const steps = projectMindPlan.split('\n').flatMap((text, line) => /^- \[[ x]\] \[(qa|code) /.test(text) ? [{ line, text }] : []);
    expect(steps).toHaveLength(3);
    for (const step of steps) {
      expect(resolveTaskAnchor(projectMindPlan, 7, { documentVersion: 7, line: step.line, expectedLineText: step.text })?.line).toBe(step.line);
    }
  });
  it('still fails closed when the plan keeps its `> meta` blockquote', () => {
    const quoted = projectMindPlan.replace(/^Created: /m, '> Created: ');
    expect(parseTaskItems(quoted)).toEqual([]);
  });
  it('fails closed when raw free text in a plan starts a line with `<`', () => {
    // Problem, notes and work-summary text are written unescaped; 6 of 442
    // real plans had such a line (leaked `</invoke>` markup) on 2026-11-13.
    const leaked = projectMindPlan.replace('## Notes\n\n', '## Notes\n\n</invoke>\n');
    expect(parseTaskItems(leaked)).toEqual([]);
  });
});
