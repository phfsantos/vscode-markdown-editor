import { afterEach, expect, test } from 'vitest';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import 'vditor/dist/js/i18n/en_US.js';
import 'vditor/dist/js/lute/lute.min.js';
import { AgentActivityController } from '../packages/media/src/agent-activity-controller';
import '../packages/media/src/agent-activity.css';
import { cleanContentForSave } from '../packages/media/src/utils';
import { parseHostToWebviewMessage } from '../packages/core/src/editorProtocol';
let editor: Vditor; let host: HTMLElement; let controller: AgentActivityController;
const content = '- [ ] Same\n- [ ] Same\n';
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
afterEach(() => { controller?.dispose(); editor?.destroy(); host?.remove(); });
async function mount(readOnly = false) {
  for (const id of ['vditorLuteScript', 'vditorIconScript']) if (!document.getElementById(id)) { const el = document.createElement('script'); el.id=id; document.head.append(el); }
  host = document.createElement('div'); document.body.append(host);
  await new Promise<void>(resolve => { editor = new Vditor(host, {after:resolve,cache:{enable:false},icon:'',i18n:window.VditorI18n,mode:'ir',toolbar:[],value:content,preview:{delay:0}}); });
  if (readOnly) editor.disabled();
  controller = new AgentActivityController({ getMarkdown: () => editor.getValue() });
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
  await mount(); report(); await frame();
  report({sequence:0,tasks:[]}); await frame(); expect(document.querySelectorAll('.md-agent-task-indicator')).toHaveLength(1);
  expect(parseHostToWebviewMessage({command:'agent-activity',tasks:[{line:-1}]}).kind).toBe('malformed');
  report({sequence:2,documentVersion:0,tasks:[]}); await frame(); expect(document.querySelectorAll('.md-agent-task-indicator')).toHaveLength(1);
  host.querySelector('.vditor-reset')!.dispatchEvent(new InputEvent('input',{bubbles:true})); await frame();
  expect(document.querySelectorAll('.md-agent-task-indicator')).toHaveLength(0);
  expect(editor.getValue()).toBe(content);
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
