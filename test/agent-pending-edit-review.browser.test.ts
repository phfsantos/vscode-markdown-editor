import { afterEach, expect, test } from 'vitest';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import 'vditor/dist/js/i18n/en_US.js';
import 'vditor/dist/js/lute/lute.min.js';
import { AgentActivityController } from '../packages/media/src/agent-activity-controller';
import '../packages/media/src/agent-activity.css';

/**
 * Pending (not yet kept) agent edits shown as per-task 'review' markers, on a
 * real Vditor IR editor. The host sends the open document's text plus the
 * version it is reviewed against; the controller marks only the checkboxes
 * whose source line differs.
 */
let editor: Vditor; let host: HTMLElement; let controller: AgentActivityController;
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
/** The checkboxes that carry an indicator: the controller styles them through a generated rule, adding no node. */
const taskState = (input: Element) => getComputedStyle(input).getPropertyValue('--md-agent-task-state').trim();
const taskLine = (input: Element) => getComputedStyle(input).getPropertyValue('--md-agent-task-line').trim();
const markers = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).filter(input => taskState(input));
const status = () => document.querySelector('.md-agent-activity-status')?.textContent ?? '';
afterEach(() => { controller?.dispose(); editor?.destroy(); host?.remove(); });

async function mount(content: string) {
  for (const id of ['vditorLuteScript', 'vditorIconScript']) if (!document.getElementById(id)) { const el = document.createElement('script'); el.id = id; document.head.append(el); }
  host = document.createElement('div'); document.body.append(host);
  await new Promise<void>(resolve => { editor = new Vditor(host, { after: resolve, cache: { enable: false }, icon: '', i18n: window.VditorI18n, mode: 'ir', toolbar: [], value: content, preview: { delay: 0 } }); });
  controller = new AgentActivityController({ getMarkdown: () => editor.getValue(), renderSource: source => { const lute = (editor as any).vditor.lute; return lute.VditorIRDOM2Md(lute.Md2VditorIRDOM(source)); } });
  controller.setSource({ panelId: 'A', documentVersion: 1, content }); controller.setGeneration(1);
}
function pending(content: string, edits: Array<{ sourceLabel: string; compareContent: string }>, extra = {}) {
  controller.receive({ command: 'pending-edits', panelId: 'A', documentVersion: 1, generation: 1, content, edits, ...extra });
}

const baseline = '- [ ] One\n- [ ] Two\n- [ ] Three\n';
const edited = '- [ ] One\n- [x] Two\n- [ ] Three\n';

test('marks only the checkbox a Copilot pending edit changed, labelled by source', async () => {
  await mount(edited);
  pending(edited, [{ sourceLabel: 'Copilot', compareContent: baseline }]); await frame();

  expect(markers()).toHaveLength(1);
  expect(taskState(markers()[0])).toBe('review');
  expect(taskLine(markers()[0])).toBe('1');
  const checkbox = host.querySelectorAll('input[type="checkbox"]')[1];
  expect(markers()[0]).toBe(checkbox);
  expect(status()).toContain('Copilot review on task 2');
});

test('marks the checkbox a Claude Code proposal would change while the document holds the original', async () => {
  await mount(baseline);
  pending(baseline, [{ sourceLabel: 'Claude Code', compareContent: edited }]); await frame();

  expect(markers().map(taskLine)).toEqual(['1']);
  expect(status()).toContain('Claude Code review on task 2');
});

test('clears the markers once the pending state resolves', async () => {
  await mount(edited);
  pending(edited, [{ sourceLabel: 'Copilot', compareContent: baseline }]); await frame();
  expect(markers()).toHaveLength(1);

  pending(edited, []); await frame();

  expect(markers()).toHaveLength(0);
  expect(status()).not.toContain('review');
});

test('shows no markers when the document text and the rendered checkboxes disagree', async () => {
  // A quoted task renders a checkbox the conservative source parser refuses,
  // so the ordered checkbox projection cannot be trusted.
  const quoted = '> - [ ] Quoted\n\n- [x] Two\n';
  await mount(quoted);
  expect(host.querySelectorAll('input[type="checkbox"]').length).toBe(2);

  pending(quoted, [{ sourceLabel: 'Copilot', compareContent: '> - [ ] Quoted\n\n- [ ] Two\n' }]); await frame();

  expect(markers()).toHaveLength(0);
});

test('shows no markers when the rendered editor no longer matches the reported document text', async () => {
  await mount(edited);
  editor.setValue('- [ ] One\n- [x] Two\n- [ ] Three\n- [ ] Four\n'); await frame();

  pending(edited, [{ sourceLabel: 'Copilot', compareContent: baseline }]); await frame();

  expect(markers()).toHaveLength(0);
});

test('ignores pending edits for another document version or panel', async () => {
  await mount(edited);
  pending(edited, [{ sourceLabel: 'Copilot', compareContent: baseline }], { documentVersion: 0 });
  pending(edited, [{ sourceLabel: 'Copilot', compareContent: baseline }], { panelId: 'B' }); await frame();

  expect(markers()).toHaveLength(0);
});

test('an agent working on the same task outranks its pending review', async () => {
  await mount(edited);
  pending(edited, [{ sourceLabel: 'Copilot', compareContent: baseline }]);
  controller.receive({ command: 'agent-activity', panelId: 'A', documentVersion: 1, generation: 1, sequence: 1, content: edited,
    summary: 'ProjectMind working', tasks: [{ line: 1, expectedLineText: '- [x] Two', state: 'working', producerLabel: 'ProjectMind' }] });
  await frame();

  expect(markers().map(taskState)).toEqual(['working']);
  expect(status()).toContain('ProjectMind working on task 2');
  expect(status()).toContain('Copilot review on task 2');
});
