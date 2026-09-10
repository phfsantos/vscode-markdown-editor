import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { openContextMenu } from '../packages/media/src/context-menu-controller';
import '../packages/media/src/main.css';

let menu: ReturnType<typeof openContextMenu>;
afterEach(() => { menu?.dispose(); document.body.replaceChildren(); });
const root = () => document.getElementById('manual-context-menu')!;
it('constrains a tall menu and lets the last action execute', async () => {
  await page.viewport(320, 240);
  const click = vi.fn();
  menu = openContextMenu(318,238,Array.from({length:80},(_,i)=>({label:`Action ${i}`,click})));
  const rect = root().getBoundingClientRect();
  expect(rect.left).toBeGreaterThanOrEqual(10);
  expect(rect.right).toBeLessThanOrEqual(310);
  expect(rect.bottom).toBeLessThanOrEqual(230);
  expect(root().scrollHeight).toBeGreaterThan(root().clientHeight);
  const last = root().lastElementChild as HTMLElement;
  root().scrollTop = root().scrollHeight;
  last.click();
  expect(click).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role=menu]')).toBeNull();
});
const key = (key: string) => document.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
it('navigates the active submenu and disposes the whole tree', () => {
  const click = vi.fn();
  menu = openContextMenu(20,20,[{label:'Insert',submenu:[{label:'First'},{label:'Disabled',disabled:true},{label:'Second',click}]}]);
  key('ArrowRight'); key('ArrowDown'); key('Enter');
  expect(click).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role=menu]')).toBeNull();
});
it('scrolls keyboard focus into view and restores focus on escape', () => {
  const editor = document.createElement('textarea'); document.body.append(editor); editor.focus();
  menu = openContextMenu(10,10,Array.from({length:80},(_,i)=>({label:`Action ${i}`})));
  key('End');
  expect(document.activeElement?.textContent).toBe('Action 79');
  expect(root().scrollTop).toBeGreaterThan(0);
  key('Escape'); expect(document.activeElement).toBe(editor);
});
it('closes and reopens submenus without orphan panels', () => {
  menu = openContextMenu(20,20,[{label:'Insert',submenu:[{label:'Child'}]}]);
  key('ArrowRight'); expect(document.querySelectorAll('[role=menu]')).toHaveLength(2);
  key('Escape'); expect(document.activeElement?.textContent).toContain('Insert');
  key('ArrowRight'); expect(document.querySelectorAll('[role=menu]')).toHaveLength(2);
  menu.dispose(); expect(document.querySelectorAll('[role=menu]')).toHaveLength(0);
});

const panels = () => Array.from(document.querySelectorAll<HTMLElement>('[role=menu]'));
const withinViewport = (panel: HTMLElement) => {
  const rect = panel.getBoundingClientRect();
  expect(rect.left).toBeGreaterThanOrEqual(9.5);
  expect(rect.top).toBeGreaterThanOrEqual(9.5);
  expect(rect.right).toBeLessThanOrEqual(innerWidth - 9.5);
  expect(rect.bottom).toBeLessThanOrEqual(innerHeight - 9.5);
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
};

it.each([[320,240], [800,600], [1280,800], [180,160]])('keeps long labels inside all corners at %ix%i', async (width,height) => {
  await page.viewport(width,height);
  for (const [x,y] of [[0,0],[width,0],[0,height],[width,height]]) {
    menu = openContextMenu(x,y,[{label:'Unbroken'.repeat(60),submenu:[{label:'Child'.repeat(80)}]}]);
    withinViewport(root());
    key('ArrowRight');
    panels().forEach(withinViewport);
    expect(panels()[1].parentElement).toBe(document.body);
  }
});

it.each([[20,'right'],[780,'left']] as const)('opens a submenu toward available space from %i', async (x,side) => {
  await page.viewport(800,600);
  menu = openContextMenu(x,20,[{label:'Insert',submenu:[{label:'Child'}]}]);
  key('ArrowRight');
  const [parent,child] = panels();
  const parentRect = parent.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
  if (side === 'right') expect(childRect.left).toBeGreaterThan(parentRect.right);
  else expect(childRect.right).toBeLessThan(parentRect.left);
  expect(parent.querySelector('[aria-expanded=true]')?.textContent).toContain(side === 'right' ? '▶' : '◀');
});

it('scrolls a tall child independently and activates its final command', async () => {
  await page.viewport(320,240);
  const click = vi.fn();
  menu = openContextMenu(310,230,[{label:'Insert',submenu:Array.from({length:80},(_,i)=>({label:`Child ${i}`,click}))}]);
  key('ArrowRight'); key('End');
  const [parent,child] = panels();
  withinViewport(child);
  expect(child.scrollTop).toBeGreaterThan(0);
  expect(parent.scrollTop).toBe(0);
  expect(document.activeElement?.textContent).toBe('Child 79');
  key(' ');
  expect(click).toHaveBeenCalledTimes(1);
  expect(panels()).toHaveLength(0);
});

it('reflows an open tree when shrinking and restores natural height when growing', async () => {
  await page.viewport(800,600);
  menu = openContextMenu(780,580,[{label:'Insert',submenu:Array.from({length:12},(_,i)=>({label:`Child ${i}`}))}]);
  key('ArrowRight');
  const naturalHeight = panels()[1].getBoundingClientRect().height;
  await page.viewport(320,240);
  await expect.poll(() => panels().every(p => p.getBoundingClientRect().right <= 310 && p.getBoundingClientRect().bottom <= 230)).toBe(true);
  panels().forEach(withinViewport);
  expect(panels()[1].getBoundingClientRect().height).toBeLessThan(naturalHeight);
  await page.viewport(800,600);
  await expect.poll(() => panels()[1].getBoundingClientRect().height).toBe(naturalHeight);
});

it.each(['right','left'])('retains the submenu across hover gaps in both travel directions (%s opening)', async side => {
  await page.viewport(800,600);
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  try {
    menu = openContextMenu(side === 'right' ? 20 : 780,20,[{label:'Insert',submenu:[{label:'Child'}]}]);
    const parentRow = root().querySelector<HTMLElement>('[role=menuitem]')!;
    parentRow.dispatchEvent(new MouseEvent('mouseenter'));
    const child = panels()[1];
    parentRow.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(100);
    child.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(200);
    expect(panels()).toHaveLength(2);
    child.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(100);
    parentRow.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(200);
    expect(panels()[1]).toBe(child);
    parentRow.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(181);
    expect(panels()).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});

it('closes a child when scrolling its anchor out of view', async () => {
  await page.viewport(320,240);
  menu = openContextMenu(10,10,[{label:'Insert',submenu:[{label:'Child'}]},...Array.from({length:80},(_,i)=>({label:`Action ${i}`}))]);
  root().querySelector('[role=menuitem]')!.dispatchEvent(new MouseEvent('mouseenter'));
  expect(panels()).toHaveLength(2);
  root().scrollTop = root().scrollHeight;
  root().dispatchEvent(new Event('scroll'));
  await expect.poll(() => panels().length).toBe(1);
  expect(root().querySelector('[aria-haspopup]')?.getAttribute('aria-expanded')).toBe('false');
});

it('replaces sibling submenus without leaving the old panel', () => {
  menu = openContextMenu(20,20,[{label:'First',submenu:[{label:'One'}]},{label:'Second',submenu:[{label:'Two'}]}]);
  const rows = root().querySelectorAll('[role=menuitem]');
  rows[0].dispatchEvent(new MouseEvent('mouseenter'));
  const oldChild = panels()[1];
  rows[1].dispatchEvent(new MouseEvent('mouseenter'));
  expect(panels()).toHaveLength(2);
  expect(oldChild.isConnected).toBe(false);
  expect(panels()[1].textContent).toBe('Two');
});

it.each(['click','pointerdown','blur','scroll'])('dismisses every panel on outside %s', event => {
  const destination = document.createElement('button'); document.body.append(destination);
  menu = openContextMenu(20,20,[{label:'Insert',submenu:[{label:'Child'}]}]);
  key('ArrowRight'); destination.focus();
  if (event === 'blur') window.dispatchEvent(new Event('blur'));
  else destination.dispatchEvent(new Event(event,{bubbles:true}));
  expect(panels()).toHaveLength(0);
  expect(document.activeElement).toBe(destination);
});

it('repeated roots leave one keyboard handler and invoke a leaf once', () => {
  const click = vi.fn();
  for (let i=0;i<20;i++) {
    menu = openContextMenu(20,20,[{label:'First'},{label:'Second',click}]);
  }
  expect(panels()).toHaveLength(1);
  key('ArrowDown');
  expect(document.activeElement?.textContent).toBe('Second');
  key('Enter');
  expect(click).toHaveBeenCalledTimes(1);
  key('Enter');
  expect(click).toHaveBeenCalledTimes(1);
});

it.each([{items:[]},{items:[{label:'Disabled',disabled:true}]}, {items:[{separator:true}]}])('handles menus without enabled actions', ({items}) => {
  menu = openContextMenu(20,20,items as Parameters<typeof openContextMenu>[2]);
  for (const input of ['ArrowDown','ArrowUp','Home','End','ArrowRight','Enter',' ']) key(input);
  expect(document.activeElement).toBe(root());
  expect(panels()).toHaveLength(1);
  key('Escape');
  expect(panels()).toHaveLength(0);
});

it('moves keyboard focus to the hovered action before activation', () => {
  const click = vi.fn();
  menu = openContextMenu(20,20,[{label:'First'},{label:'Second',click}]);
  const second = root().querySelectorAll('[role=menuitem]')[1];
  second.dispatchEvent(new MouseEvent('mouseenter'));
  expect(document.activeElement).toBe(second);
  key('Enter');
  expect(click).toHaveBeenCalledTimes(1);
});

it('continues keyboard navigation in a hovered child panel', () => {
  menu = openContextMenu(20,20,[{label:'Insert',submenu:[{label:'One'},{label:'Two'}]},{label:'Other'}]);
  root().querySelector('[role=menuitem]')!.dispatchEvent(new MouseEvent('mouseenter'));
  panels()[1].querySelector('[role=menuitem]')!.dispatchEvent(new MouseEvent('mouseenter'));
  key('ArrowDown');
  expect(panels()).toHaveLength(2);
  expect(document.activeElement?.textContent).toBe('Two');
});

it('does not undo user scrolling when the focused child anchor disappears', async () => {
  await page.viewport(320,240);
  menu = openContextMenu(10,10,[{label:'Insert',submenu:[{label:'Child'}]},...Array.from({length:80},(_,i)=>({label:`Action ${i}`}))]);
  key('ArrowRight');
  root().scrollTop = root().scrollHeight;
  const scrolledPosition = root().scrollTop;
  root().dispatchEvent(new Event('scroll'));
  await expect.poll(() => panels().length).toBe(1);
  expect(root().scrollTop).toBe(scrolledPosition);
  expect(root().contains(document.activeElement)).toBe(true);
});

it('invokes the shared menu from editor right-click and keyboard with one navigation step', async () => {
  await page.viewport(320,240);
  await import('../packages/media/src/context-menu');
  const editor = document.createElement('div');
  editor.className = 'vditor-reset'; editor.contentEditable = 'true';
  editor.textContent = 'Selected editor text'; document.body.append(editor); editor.focus();
  const selection = window.getSelection()!;
  const range = document.createRange(); range.selectNodeContents(editor);
  selection.removeAllRanges(); selection.addRange(range);
  vi.stubGlobal('createManualContextMenu',(x:number,y:number,items:Parameters<typeof openContextMenu>[2]) => { menu = openContextMenu(x,y,items); });
  try {
    editor.dispatchEvent(new MouseEvent('contextmenu',{clientX:318,clientY:238,bubbles:true,cancelable:true}));
    expect(panels()).toHaveLength(1);
    withinViewport(root());
    expect(selection.toString()).toBe('Selected editor text');
    expect(document.activeElement?.textContent).toBe('Cut');
    key('ArrowDown'); expect(document.activeElement?.textContent).toBe('Copy');
    key('Escape'); expect(document.activeElement).toBe(editor);
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true}));
    expect(panels()).toHaveLength(1);
    withinViewport(root());
    key('ArrowDown'); expect(document.activeElement?.textContent).toBe('Copy');
  } finally { vi.unstubAllGlobals(); selection.removeAllRanges(); }
});

it('uses the same constrained renderer for the integrator delayed fallback', async () => {
  await page.viewport(320,240);
  const {VSCodeWebviewIntegrator} = await import('../packages/media/src/vscode-integrator');
  // No editor DOM is required for this public menu factory; avoid binding unrelated editor listeners.
  const integrator = new VSCodeWebviewIntegrator({});
  const target = document.createElement('div'); document.body.append(target);
  const event = new MouseEvent('contextmenu',{clientX:318,clientY:238});
  target.dispatchEvent(event);
  integrator.createVditorContextMenu(event);
  await expect.poll(() => panels().length).toBe(1);
  withinViewport(root());
  key('Escape');
  expect(panels()).toHaveLength(0);
});

it('restores the original invoker when replacing a focused menu tree', () => {
  const editor = document.createElement('textarea'); document.body.append(editor); editor.focus();
  menu = openContextMenu(20,20,[{label:'First'}]);
  menu = openContextMenu(30,30,[{label:'Replacement'}]);
  key('Escape');
  expect(document.activeElement).toBe(editor);
});

it.each(['Cut','Copy'])('%s writes the editor selection exactly once after menu focus moves', async action => {
  await import('../packages/media/src/context-menu');
  const editor = document.createElement('div');
  editor.className = 'vditor-reset'; editor.contentEditable = 'true';
  editor.textContent = 'Copy this text'; document.body.append(editor); editor.focus();
  const selection = window.getSelection()!;
  const range = document.createRange(); range.selectNodeContents(editor);
  selection.removeAllRanges(); selection.addRange(range);
  const writeText = vi.spyOn(navigator.clipboard,'writeText').mockResolvedValue();
  vi.stubGlobal('vscode',{postMessage:vi.fn()});
  vi.stubGlobal('createManualContextMenu',(x:number,y:number,items:Parameters<typeof openContextMenu>[2]) => { menu = openContextMenu(x,y,items); });
  try {
    key('ContextMenu');
    if (action === 'Copy') key('ArrowDown');
    expect(document.activeElement?.textContent).toBe(action);
    key('Enter');
    await expect.poll(() => writeText.mock.calls.length).toBe(1);
    expect(writeText).toHaveBeenCalledWith('Copy this text');
    await expect.poll(() => editor.textContent).toBe(action === 'Cut' ? '' : 'Copy this text');
    expect(panels()).toHaveLength(0);
  } finally { writeText.mockRestore(); vi.unstubAllGlobals(); selection.removeAllRanges(); }
});

it('dispatches Format Document once through the real action builder', async () => {
  await import('../packages/media/src/context-menu');
  const postMessage = vi.fn();
  vi.stubGlobal('vscode',{postMessage});
  vi.stubGlobal('createManualContextMenu',(x:number,y:number,items:Parameters<typeof openContextMenu>[2]) => { menu = openContextMenu(x,y,items); });
  try {
    key('ContextMenu');
    const row = Array.from(root().querySelectorAll<HTMLElement>('[role=menuitem]')).find(row => row.textContent === 'Format Document')!;
    row.click();
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({command:'formatDocument'});
    expect(panels()).toHaveLength(0);
  } finally { vi.unstubAllGlobals(); }
});

it('inserts a clock widget from the real Insert submenu once', async () => {
  await import('../packages/media/src/context-menu');
  const insertValue = vi.fn();
  vi.stubGlobal('vditor',{insertValue});
  vi.stubGlobal('createManualContextMenu',(x:number,y:number,items:Parameters<typeof openContextMenu>[2]) => { menu = openContextMenu(x,y,items); });
  try {
    key('ContextMenu');
    // A real pointer click scrolls the off-screen parent into view first.
    await page.getByRole('menuitem', { name: 'Insert', exact: true }).click();
    const clock = Array.from(panels()[1].querySelectorAll<HTMLElement>('[role=menuitem]')).find(row => row.textContent === '⏰ Clock Widget')!;
    clock.click();
    expect(insertValue).toHaveBeenCalledTimes(1);
    expect(insertValue.mock.calls[0][0]).toContain('```widget\ntype: clock');
    expect(panels()).toHaveLength(0);
  } finally { vi.unstubAllGlobals(); }
});

it('dismisses on Tab without cancelling native focus traversal', () => {
  const editor = document.createElement('textarea'); document.body.append(editor); editor.focus();
  menu = openContextMenu(20,20,[{label:'Action'}]);
  const event = new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});
  document.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(panels()).toHaveLength(0);
  expect(document.activeElement).toBe(editor);
});

it('renders focused actions using the active theme selection and focus colors', () => {
  menu = openContextMenu(20,20,[{label:'Action'}]);
  root().style.setProperty('--vscode-menu-selectionBackground','rgb(12, 34, 56)');
  root().style.setProperty('--vscode-menu-selectionForeground','rgb(210, 220, 230)');
  root().style.setProperty('--vscode-focusBorder','rgb(100, 110, 120)');
  const style = getComputedStyle(document.activeElement!);
  expect(style.backgroundColor).toBe('rgb(12, 34, 56)');
  expect(style.color).toBe('rgb(210, 220, 230)');
  expect(style.outlineColor).toBe('rgb(100, 110, 120)');
  expect(style.outlineStyle).toBe('solid');
  expect(style.outlineWidth).toBe('1px');
});
