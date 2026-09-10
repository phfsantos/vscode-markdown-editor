import { afterEach, expect, test } from 'vitest';
import { getSelectedLineNumber, initializeLineNumbers } from '../packages/media/src/line-number-renderer';

const frames = async (count: number) => {
  for (let i = 0; i < count; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
};

afterEach(async () => {
  document.querySelector('.vditor-ir')?.remove();
  await frames(2);
});

test('gutter settles after rendering instead of rebuilding on every animation frame', async () => {
  const host = document.createElement('div');
  host.className = 'vditor-ir';
  host.innerHTML = `<div class="vditor-reset">${'<p>Typing content</p>'.repeat(200)}</div>`;
  document.body.append(host);
  initializeLineNumbers();
  await frames(5);
  const root = host.firstElementChild!;
  const gutter = root.querySelector('[data-vditor-line-number-gutter]');
  expect(gutter).not.toBeNull();
  await frames(5);
  expect(root.querySelector('[data-vditor-line-number-gutter]')).toBe(gutter);
});

test('every table cell selects its row number at the row height', async () => {
  const host = document.createElement('div');
  host.className = 'vditor-ir';
  host.innerHTML = '<div class="vditor-reset"><h3>Servers</h3><table style="border-spacing:0"><thead><tr><th>Node</th><th>User</th><th>IP</th><th>SSH</th></tr></thead><tbody><tr><td>Pi</td><td>ordep</td><td>192.168.1.1</td><td><p>ssh</p></td></tr></tbody></table><p>After</p></div>';
  document.body.append(host);
  initializeLineNumbers();
  await frames(5);
  const root = host.firstElementChild as HTMLElement;
  expect(root.querySelectorAll('[data-vditor-line-number]')).toHaveLength(4);
  const rows = root.querySelectorAll('tr');
  for (const [index, row] of [...rows].entries()) {
    for (const cell of row.cells) {
      const range = document.createRange();
      range.selectNodeContents(cell);
      range.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      expect(getSelectedLineNumber(selection, root)).toBe(index + 1);
    }
    const number = root.querySelector(`[data-vditor-line-number][data-source-line="${index + 1}"]`)!;
    expect(Math.abs(number.getBoundingClientRect().top - row.getBoundingClientRect().top)).toBeLessThan(2);
  }
});

test('typing in one block preserves unaffected gutter buttons', async () => {
  const host = document.createElement('div');
  host.className = 'vditor-ir';
  host.innerHTML = `<div class="vditor-reset">${'<p>Typing content</p>'.repeat(1000)}</div>`;
  document.body.append(host);
  initializeLineNumbers();
  await frames(5);
  const root = host.firstElementChild!;
  const buttons = [...root.querySelectorAll('[data-vditor-line-number]')];
  // Vditor replaces the edited block while normalizing each input event.
  root.querySelector('p')!.outerHTML = '<p>Typing content!</p>';
  await frames(2);
  expect([...root.querySelectorAll('[data-vditor-line-number]')].every((button, i) => button === buttons[i])).toBe(true);
});

test('reused numbers navigate to the current blocks after insertion and deletion', async () => {
  const host = document.createElement('div');
  host.className = 'vditor-ir';
  host.innerHTML = '<div class="vditor-reset" contenteditable="true"><p>First</p><p>Last</p></div>';
  document.body.append(host);
  initializeLineNumbers();
  await frames(5);
  const root = host.firstElementChild as HTMLElement;
  root.querySelector('p')!.insertAdjacentHTML('afterend', '<p>Middle</p>');
  await frames(3);
  const middleButton = root.querySelector<HTMLButtonElement>('[data-vditor-line-number][data-source-line="1"]')!;
  middleButton.click();
  expect(window.getSelection()!.anchorNode).toBe(root.querySelectorAll('p')[1]);
  root.querySelectorAll('p')[1].remove();
  await frames(3);
  expect(root.querySelectorAll('[data-vditor-line-number]')).toHaveLength(2);
  middleButton.click();
  expect(window.getSelection()!.anchorNode).toBe(root.querySelectorAll('p')[1]);
  expect(root.querySelectorAll('p')[1].textContent).toBe('Last');
});

test('numbers retain navigation after the editor replaces its DOM with a clone', async () => {
  const host = document.createElement('div');
  host.className = 'vditor-ir';
  host.innerHTML = '<div class="vditor-reset" contenteditable="true"><p>First</p><p>Last</p></div>';
  document.body.append(host);
  initializeLineNumbers();
  await frames(5);
  const root = host.firstElementChild as HTMLElement;
  root.innerHTML = root.innerHTML;
  await frames(3);
  window.getSelection()!.removeAllRanges();
  root.querySelector<HTMLButtonElement>('[data-vditor-line-number][data-source-line="1"]')!.click();
  expect(window.getSelection()!.anchorNode).toBe(root.querySelectorAll('p')[1]);
});
