import { afterEach, expect, test } from 'vitest';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import 'vditor/dist/js/i18n/en_US.js';
import 'vditor/dist/js/lute/lute.min.js';
import { createWebviewContentSync } from '../packages/media/src/content-sync';
import { EditorContextController } from '../packages/media/src/editor-context-controller';
let editor: Vditor | undefined;
let host: HTMLElement | undefined;
let controller: EditorContextController | undefined;
afterEach(() => { controller?.dispose(); editor?.destroy(); host?.remove(); window.getSelection()?.removeAllRanges(); });
async function mount(content = '- [ ] **Ship**') {
  for (const id of ['vditorLuteScript', 'vditorIconScript']) {
    if (!document.getElementById(id)) { const script = document.createElement('script'); script.id = id; document.head.append(script); }
  }
  host = document.createElement('div'); document.body.append(host);
  await new Promise<void>(resolve => { editor = new Vditor(host!, { after: resolve, cache: { enable: false }, icon: '', i18n: window.VditorI18n, mode: 'ir', toolbar: [], value: content, preview: { delay: 0 } }); });
  const messages: any[] = [];
  const sync = createWebviewContentSync(() => {}, content);
  controller = new EditorContextController({ scope: document, getMarkdown: () => sync.getContent(), postMessage: message => messages.push(message) });
  controller.setSource({ panelId: 'A', documentVersion: 1, content });
  return messages;
}
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
function select(node: Node, start: number, end: number) {
  const range = document.createRange(); range.setStart(node, start); range.setEnd(node, end);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}
test('real Vditor Ship maps to exact Markdown offsets without changing the document', async () => {
  const messages = await mount();
  const before = editor!.getValue();
  const node = host!.querySelector('strong')!.firstChild!;
  select(node, 0, 4); await frame();
  expect(messages.at(-1)).toMatchObject({ command: 'editor-context', panelId: 'A', documentVersion: 1, selectionStatus: 'exact', selection: { start: { line: 0, character: 8 }, end: { line: 0, character: 12 } } });
  expect(editor!.getValue()).toBe(before);
});
test('icons and pending edits are unavailable; disposal stops publication', async () => {
  const messages = await mount();
  const icon = document.createElement('span'); icon.className = 'renderer-container'; icon.textContent = 'Ship'; host!.append(icon);
  select(icon.firstChild!, 0, 4); await frame();
  expect(messages.at(-1)?.selectionStatus).toBe('unavailable');
  select(host!.querySelector('strong')!.firstChild!, 0, 4); await frame();
  host!.querySelector('.vditor-ir .vditor-reset')!.dispatchEvent(new Event('input', { bubbles: true })); await frame();
  expect(messages.at(-1)?.selectionStatus).toBe('unavailable');
  controller!.dispose(); const count = messages.length;
  select(icon.firstChild!, 0, 4); await frame(); expect(messages).toHaveLength(count);
});

test.each(['` foo `\n\nfoo', '# Foo #\n\nFoo'])('real renderer normalization is unavailable for %s', async content => {
  const messages = await mount(content);
  const block = host!.querySelector('code, h1')!;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let node: Node | undefined;
  while (walker.nextNode()) {
    if (walker.currentNode.textContent?.trim().toLowerCase() === 'foo' && !walker.currentNode.parentElement?.closest('.vditor-ir__marker')) node = walker.currentNode;
  }
  expect(node).toBeDefined();
  select(node!, 0, 3); await frame();
  expect(messages.at(-1)?.selectionStatus).toBe('unavailable');
});
test('toolbar focus invalidates the retained DOM selection', async () => {
  const messages = await mount();
  select(host!.querySelector('strong')!.firstChild!, 0, 4); await frame();
  expect(messages.at(-1)?.selectionStatus).toBe('exact');
  const button = document.createElement('button'); host!.querySelector('.vditor-toolbar')!.append(button);
  button.focus(); await frame();
  expect(messages.at(-1)?.selectionStatus).toBe('unavailable');
});

test('toolbar typing does not leave source selection permanently pending', async () => {
  const messages = await mount();
  const input = document.createElement('input'); host!.querySelector('.vditor-toolbar')!.append(input);
  input.focus(); input.value = 'find'; input.dispatchEvent(new Event('input', { bubbles: true })); await frame();
  host!.querySelector<HTMLElement>('.vditor-ir .vditor-reset')!.focus();
  select(host!.querySelector('strong')!.firstChild!, 0, 4); await frame();
  expect(messages.at(-1)?.selectionStatus).toBe('exact');
});
