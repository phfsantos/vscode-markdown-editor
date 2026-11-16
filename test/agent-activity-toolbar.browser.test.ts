import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import 'vditor/dist/js/i18n/en_US.js';
import 'vditor/dist/js/lute/lute.min.js';
import '../packages/media/src/main.css';
import '../packages/media/src/agent-activity.css';
import { AgentActivityController } from '../packages/media/src/agent-activity-controller';
import { updateChatAnchorUI } from '../packages/media/src/chat-anchor-ui';
let host: HTMLElement; let editor: Vditor; let controller: AgentActivityController;
const content = '- [ ] Task\n';
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
afterEach(() => { controller?.dispose(); editor?.destroy(); host?.remove(); updateChatAnchorUI(undefined, {postMessage() {}}); });
async function mount() {
  for (const id of ['vditorLuteScript', 'vditorIconScript']) if (!document.getElementById(id)) { const el = document.createElement('script'); el.id=id; document.head.append(el); }
  document.body.dataset.useVscodeThemeColor = '1';
  host = document.createElement('div'); document.body.append(host);
  await new Promise<void>(resolve => { editor = new Vditor(host, {after:resolve,cache:{enable:false},icon:'',i18n:window.VditorI18n,mode:'ir',toolbarConfig:{pin:true,hide:false},toolbar:['headings','bold','italic','strike','link','|','list','ordered-list','check','outdent','indent','|','quote','line','code','inline-code','insert-before','insert-after','|','table','undo','redo'],value:content,preview:{delay:0}}); });
  controller = new AgentActivityController({getMarkdown: () => editor.getValue()});
  controller.setSource({panelId:'A',documentVersion:1,content}); controller.setGeneration(1);
}
function report(extra = {}) {
  controller.receive({command:'agent-activity',panelId:'A',documentVersion:1,generation:1,sequence:1,content,summary:'Agent activity: working — ProjectMind',tasks:[],...extra});
}
test('activity reserves toolbar space without covering Add to Chat at any editor width', async () => {
  await mount();
  let requested = false;
  updateChatAnchorUI({visible:true, relativePath:'plan.md'}, {postMessage(message) { requested = message.command === 'requestAddToChat'; }});
  const summary = 'Agent activity: working — ProjectMind ' + 'Long producer name '.repeat(20);
  report({summary}); await frame();
  const header = document.querySelector<HTMLElement>('.md-agent-activity-header')!;
  const toolbar = host.querySelector<HTMLElement>('.vditor-toolbar')!;
  for (const width of [320, 768, 1280]) {
    await page.viewport(width, 720); await frame();
    const status = header.getBoundingClientRect();
    const chat = document.querySelector('.markdown-editor-chat-anchor-button')!.getBoundingClientRect();
    await page.screenshot({path:`./../.extest/activity-toolbar/agent-status-${width}.png`});
    expect(status.bottom <= chat.top || status.top >= chat.bottom || status.right <= chat.left || status.left >= chat.right).toBe(true);
    expect(toolbar.contains(header)).toBe(true);
    expect(status.width).toBeGreaterThan(0);
    expect(status.right).toBeLessThanOrEqual(toolbar.getBoundingClientRect().right);
    expect(status.bottom).toBeLessThanOrEqual(toolbar.getBoundingClientRect().bottom);
    expect(header.title).toBe(summary);
    expect(getComputedStyle(header).textOverflow).toBe('ellipsis');
  }
  document.querySelector<HTMLButtonElement>('.markdown-editor-chat-anchor-button')!.click();
  expect(requested).toBe(true);
  report({sequence:2, summary:'', tasks:[]}); await frame();
  expect(header.hidden).toBe(true);
  expect(header.getBoundingClientRect().height).toBe(0);
});

test('activity attaches after toolbar initialization and survives toolbar replacement', async () => {
  await mount();
  const toolbar = host.querySelector<HTMLElement>('.vditor-toolbar')!;
  toolbar.remove(); report(); await frame();
  const header = document.querySelector<HTMLElement>('.md-agent-activity-header')!;
  expect(header.hidden).toBe(true);
  host.prepend(toolbar); await frame();
  expect(header.hidden).toBe(false);
  expect(toolbar.contains(header)).toBe(true);
  const replacement = toolbar.cloneNode(false) as HTMLElement;
  toolbar.replaceWith(replacement); await frame();
  expect(replacement.contains(header)).toBe(true);
  expect(header.hidden).toBe(false);
  expect(document.querySelectorAll('.md-agent-activity-header')).toHaveLength(1);
  expect(document.querySelector('[role="status"]')?.textContent).toContain('working');
  controller.setGeneration(2); await frame();
  expect(header.hidden).toBe(true);
});

test('activity uses theme foreground and leaves toolbar controls keyboard accessible', async () => {
  await mount(); report(); await frame();
  const header = document.querySelector<HTMLElement>('.md-agent-activity-header')!;
  for (const [theme, foreground, background] of [['light','#333333','#ffffff'], ['dark','#cccccc','#1e1e1e']]) {
    document.documentElement.style.setProperty('--vscode-editor-foreground', foreground);
    document.documentElement.style.setProperty('--vscode-editor-background', background);
    await frame();
    expect(getComputedStyle(header).color).toBe(theme === 'light' ? 'rgb(51, 51, 51)' : 'rgb(204, 204, 204)');
    expect(getComputedStyle(host.querySelector('.vditor-toolbar')!).backgroundColor).toBe(theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(30, 30, 30)');
    await page.screenshot({path:`./../.extest/activity-toolbar/agent-status-${theme}.png`});
  }
  const button = host.querySelector<HTMLButtonElement>('.vditor-toolbar button')!;
  button.focus();
  expect(document.activeElement).toBe(button);
  expect(header.tabIndex).toBe(-1);
  document.documentElement.style.removeProperty('--vscode-editor-foreground');
  document.documentElement.style.removeProperty('--vscode-editor-background');
});

test('activity ignores the hidden diff renderer toolbar', async () => {
  await mount();
  const hiddenRenderer = document.createElement('div');
  hiddenRenderer.className = 'vditor-toolbar vditor-toolbar--hide';
  document.body.prepend(hiddenRenderer);
  try {
    report(); await frame();
    expect(host.querySelector('.vditor-toolbar .md-agent-activity-header')).not.toBeNull();
    expect(hiddenRenderer.querySelector('.md-agent-activity-header')).toBeNull();
  } finally { hiddenRenderer.remove(); }
});
