import { afterEach, expect, test } from 'vitest';
import { userEvent, cdp, page } from 'vitest/browser';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import 'vditor/dist/js/i18n/en_US.js';
import 'vditor/dist/js/lute/lute.min.js';
import { AgentActivityController } from '../packages/media/src/agent-activity-controller';
import '../packages/media/src/agent-activity.css';
let cleanContentForSave: (text: string) => string;
import { parseHostToWebviewMessage } from '../packages/core/src/editorProtocol';
let editor: Vditor; let host: HTMLElement; let controller: AgentActivityController;
const content = '- [ ] Same\n- [ ] Same\n';
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
afterEach(() => { controller?.dispose(); editor?.destroy(); host?.remove(); window.getSelection()?.removeAllRanges(); });
async function mount(readOnly = false) {
  // utils bootstraps a production-only jQuery confirmation plugin, unrelated to save.
  (window as any).require = () => () => {};
  ({ cleanContentForSave } = await import('../packages/media/src/utils'));

  for (const id of ['vditorLuteScript', 'vditorIconScript']) if (!document.getElementById(id)) { const el = document.createElement('script'); el.id=id; document.head.append(el); }
  host = document.createElement('div'); document.body.append(host);
  await new Promise<void>(resolve => { editor = new Vditor(host, {after:resolve,cache:{enable:false},icon:'',i18n:window.VditorI18n,mode:'ir',toolbar:[],value:content,preview:{delay:0}}); });
  if (readOnly) editor.disabled();
  controller = new AgentActivityController({ getMarkdown: () => editor.getValue(), renderSource: source => { const lute = (editor as any).vditor.lute; return lute.VditorIRDOM2Md(lute.Md2VditorIRDOM(source)); } });
  controller.setSource({panelId:'A',documentVersion:1,content}); controller.setGeneration(1);
}
function report(extra = {}) {
  controller.receive({command:'agent-activity',panelId:'A',documentVersion:1,generation:1,sequence:1,content,
    summary:'Agent A working',tasks:[{line:1,expectedLineText:'- [ ] Same',state:'working',producerLabel:'Agent A'}],...extra});
}
test('only the second duplicate task spins, outside editable DOM with source/selection preserved', async () => {
  await mount(); const before = editor.getValue();
  const li = host.querySelectorAll('li')[0]; const range = document.createRange(); range.selectNodeContents(li);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); const selected = selection.toString();
  report(); await frame();
  const indicators = document.querySelectorAll<HTMLElement>('.md-agent-task-indicator'); expect(indicators).toHaveLength(1);
  const input = host.querySelectorAll('input[type="checkbox"]')[1];
  expect(indicators[0].getBoundingClientRect().top).toBeCloseTo(input.getBoundingClientRect().top - 2,0);
  expect(indicators[0].closest('.vditor-reset')).toBeNull();
  expect(getComputedStyle(indicators[0]).pointerEvents).toBe('none');
  expect(document.querySelector('.md-agent-activity-status')?.textContent).toContain('Agent A working on task');
  expect(editor.getValue()).toBe(before); expect(selection.toString()).toBe(selected);
  expect(cleanContentForSave(before)).toBe(before);
  expect(selection.getRangeAt(0).cloneContents().textContent).not.toContain('Agent A');
});
test('coalesces producers, survives rerender, clears invalidated tasks and accepts read-only views', async () => {
  await mount(true); report({tasks:[{line:1,expectedLineText:'- [ ] Same',state:'review',producerLabel:'B'},{line:1,expectedLineText:'- [ ] Same',state:'working',producerLabel:'A'}]}); await frame();
  expect(document.querySelectorAll('.md-agent-task-indicator')).toHaveLength(1);
  expect(document.querySelector('.md-agent-task-indicator')?.getAttribute('data-state')).toBe('working');
  editor.setValue(content); await frame(); expect(document.querySelectorAll('.md-agent-task-indicator')).toHaveLength(1);
  report({sequence:2,tasks:[]}); await frame(); expect(document.querySelectorAll('.md-agent-task-indicator')).toHaveLength(0);
  expect(document.querySelector('.md-agent-activity-header')?.textContent).toContain('working');
});
test('rejects stale/malformed messages and hides projection during unsynchronized edits', async () => {
  await mount(); const before = editor.getValue(); report(); await frame();
  report({sequence:0,tasks:[]}); await frame(); expect(document.querySelectorAll('.md-agent-task-indicator')).toHaveLength(1);
  expect(parseHostToWebviewMessage({command:'agent-activity',tasks:[{line:-1}]}).kind).toBe('malformed');
  report({sequence:2,documentVersion:0,tasks:[]}); await frame(); expect(document.querySelectorAll('.md-agent-task-indicator')).toHaveLength(1);
  const root = host.querySelector<HTMLElement>('.vditor-ir .vditor-reset')!;
  root.focus(); const caret = document.createRange(); caret.selectNodeContents(root.querySelector('li')!); caret.collapse(false); window.getSelection()?.addRange(caret);
  root.dispatchEvent(new InputEvent('input',{bubbles:true})); await frame();
  expect(document.querySelectorAll('.md-agent-task-indicator')).toHaveLength(0);
  expect(editor.getValue()).toBe(before);
});
test('does not intercept checkbox click and does not serialize activity on save/copy', async () => {
  await mount(); report(); await frame();
  const root = host.querySelector<HTMLElement>('.vditor-reset')!;
  expect(root.innerHTML).not.toContain('md-agent');
  const checkbox = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]; checkbox.click(); await frame();
  expect(checkbox.checked).toBe(true);
  expect(document.querySelectorAll('.md-agent-task-indicator')).toHaveLength(0);
  expect(editor.getValue()).not.toContain('Agent A');
  expect(cleanContentForSave('<span data-agent-activity="true" class="md-agent-task-indicator">Transient</span>Text')).toBe('Text');
});

test('keyboard checkbox toggle and undo remain functional across activity updates', async () => {
  await mount(); const internal = (editor as any).vditor;
  const before = editor.getValue(); report(); await frame();
  const root = host.querySelector<HTMLElement>('.vditor-ir .vditor-reset')!;
  root.focus(); const range = document.createRange(); range.selectNodeContents(root.querySelectorAll('li')[1]); range.collapse(false);
  window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
  const modifier = /Mac/.test(navigator.platform) ? 'Meta' : 'Control';
  await userEvent.keyboard(`{${modifier}>}{Shift>}j{/Shift}{/${modifier}}`);
  await expect.poll(() => editor.getValue()).toContain('[X]');
  expect(document.querySelectorAll('.md-agent-task-indicator')).toHaveLength(0);
  editor.setValue(content, true); await frame();
  internal.undo.addToUndoStack(internal);
  editor.setValue(content + '\nExtra\n'); await frame();
  internal.undo.addToUndoStack(internal);
  report({sequence:2}); await frame();
  report({sequence:3,tasks:[]}); await frame();
  internal.undo.undo(internal); await frame();
  expect(editor.getValue()).toBe(before);
});
test('working animation honors reduced motion and static states survive viewport resizing', async () => {
  await mount(); report(); await frame();
  const session = cdp();
  try {
    await session.send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    expect(getComputedStyle(document.querySelector('.md-agent-task-indicator')!).animationName).toBe('none');
    for (const width of [360,768,1280]) {
      await page.viewport(width,720); await frame();
      expect(document.querySelectorAll('.md-agent-task-indicator')).toHaveLength(1);
    }
    report({sequence:2,tasks:[{line:1,expectedLineText:'- [ ] Same',state:'waiting',producerLabel:'A'}]}); await frame();
    expect(getComputedStyle(document.querySelector('.md-agent-task-indicator')!).animationName).toBe('none');
  } finally {
    await session.send('Emulation.setEmulatedMedia', {features:[]});
  }
});
