import { placeMenu } from './context-menu-placement';

export type ContextMenuItem = { separator: true } | {
  separator?: false; label: string; icon?: string; disabled?: boolean;
  click?: () => void; submenu?: ContextMenuItem[];
};
type Action = Exclude<ContextMenuItem, { separator: true }>;
interface Row { el: HTMLElement; item: Action; indicator?: HTMLElement }
interface Panel { el: HTMLElement; rows: Row[]; index: number; parent?: Row }
let activeMenu: { dispose(): void; invoker: HTMLElement | null; containsFocus(): boolean } | undefined;
let nextId = 0;

/** Owns a complete menu tree; child panels stay outside parent scroll containers. */
export function openContextMenu(x: number, y: number, items: ContextMenuItem[]) {
  const invoker = activeMenu?.containsFocus()
    ? activeMenu.invoker : document.activeElement as HTMLElement | null;
  activeMenu?.dispose();
  const panels: Panel[] = [];
  const listeners = new AbortController();
  let closeTimer = 0;
  let frame = 0;
  let disposed = false;
  const viewport = () => {
    const v = window.visualViewport;
    return { left: v?.offsetLeft ?? 0, top: v?.offsetTop ?? 0,
      width: v?.width ?? innerWidth, height: v?.height ?? innerHeight };
  };
  function cancelClose() { window.clearTimeout(closeTimer); closeTimer = 0; }
  function closeFrom(depth: number) {
    cancelClose();
    for (const panel of panels.splice(depth).reverse()) {
      panel.parent?.el.setAttribute('aria-expanded', 'false');
      panel.parent?.el.removeAttribute('aria-controls');
      if (panel.parent?.indicator) panel.parent.indicator.textContent = '▶';
      panel.el.remove();
    }
  }
  const handle = { invoker, containsFocus: () => panels.some(panel => panel.el.contains(document.activeElement)), dispose() {
    if (disposed) return;
    disposed = true;
    closeFrom(0);
    listeners.abort();
    cancelAnimationFrame(frame);
    if (activeMenu === handle) activeMenu = undefined;
  } };
  function focus(panel: Panel, index: number) {
    if (!panel.rows.length) { panel.el.focus({ preventScroll: true }); return; }
    panel.index = (index + panel.rows.length) % panel.rows.length;
    const row = panel.rows[panel.index].el;
    row.focus({ preventScroll: true });
    const box = panel.el.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    if (rect.top < box.top + panel.el.clientTop) panel.el.scrollTop += rect.top - box.top - panel.el.clientTop;
    else if (rect.bottom > box.top + panel.el.clientTop + panel.el.clientHeight)
      panel.el.scrollTop += rect.bottom - box.top - panel.el.clientTop - panel.el.clientHeight;
  }
  function layout() {
    const bounds = viewport();
    const inset = Math.min(10, bounds.width / 4, bounds.height / 4);
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];
      const anchor = panel.parent?.el.getBoundingClientRect() ?? {left:x,right:x,top:y,bottom:y};
      if (i > 0) {
        const parentBox = panels[i-1].el.getBoundingClientRect();
        if (anchor.bottom <= parentBox.top + panels[i-1].el.clientTop || anchor.top >= parentBox.top + panels[i-1].el.clientHeight) {
          const hadFocus = panels.slice(i).some(p => p.el.contains(document.activeElement));
          closeFrom(i);
          if (hadFocus) panels[i-1].el.focus({ preventScroll: true });
          break;
        }
      }
      panel.el.style.setProperty('--menu-available-width', `${bounds.width - inset * 2}px`);
      panel.el.style.maxWidth = `${bounds.width - inset * 2}px`;
      panel.el.style.maxHeight = `${bounds.height - inset * 2}px`;
      const pos = placeMenu({anchor, size:panel.el.getBoundingClientRect(), viewport:bounds, kind:i ? 'submenu' : 'root'});
      panel.el.style.left = `${pos.left}px`;
      panel.el.style.top = `${pos.top}px`;
      panel.el.dataset.side = pos.side;
      panel.el.style.visibility = 'visible';
      if (panel.parent?.indicator) panel.parent.indicator.textContent = pos.side === 'left' ? '◀' : '▶';
    }
  }
  function scheduleLayout() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (!disposed) layout(); });
  }
  function openChild(panel: Panel, row: Row, keyboard: boolean) {
    cancelClose();
    const depth = panels.indexOf(panel) + 1;
    if (panels[depth]?.parent !== row) {
      closeFrom(depth);
      if (!row.item.submenu?.length) return;
      const child = createPanel(row.item.submenu, row);
      row.el.setAttribute('aria-expanded', 'true');
      row.el.setAttribute('aria-controls', child.el.id);
      layout();
    }
    if (keyboard && panels[depth]) focus(panels[depth], 0);
  }
  function activate(panel: Panel, row: Row) {
    if (row.item.submenu?.length) openChild(panel, row, true);
    else { handle.dispose(); invoker?.focus({preventScroll:true}); row.item.click?.(); }
  }
  function scheduleClose(depth: number) {
    cancelClose();
    closeTimer = window.setTimeout(() => {
      const parent = panels[depth]?.parent;
      const hadFocus = panels.slice(depth).some(p => p.el.contains(document.activeElement));
      closeFrom(depth);
      if (hadFocus && parent) parent.el.focus({preventScroll:true});
    }, 180);
  }
  function createPanel(entries: ContextMenuItem[], parent?: Row): Panel {
    const el = document.createElement('div');
    el.id = parent ? `editor-submenu-${++nextId}` : 'manual-context-menu';
    el.className = `editor-context-menu${parent ? ' vscode-submenu' : ''}`;
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', parent?.item.label ?? 'Editor actions');
    el.tabIndex = -1;
    el.style.visibility = 'hidden';
    el.style.zIndex = String(10000 + panels.length);
    const panel: Panel = {el, rows:[], index:0, parent};
    panels.push(panel);
    entries.forEach(item => {
      const element = document.createElement('div');
      el.appendChild(element);
      if (!('label' in item)) { element.setAttribute('role', 'separator'); return; }
      element.setAttribute('role', 'menuitem');
      element.setAttribute('aria-disabled', String(!!item.disabled));
      element.tabIndex = -1;
      const label = document.createElement('span');
      label.className = 'editor-context-menu-label';
      label.textContent = `${item.icon ? item.icon + ' ' : ''}${item.label}`;
      element.appendChild(label);
      const row: Row = {el:element, item};
      if (item.submenu?.length) {
        element.setAttribute('aria-haspopup', 'menu');
        element.setAttribute('aria-expanded', 'false');
        row.indicator = document.createElement('span');
        row.indicator.className = 'editor-context-menu-indicator';
        row.indicator.setAttribute('aria-hidden','true');
        row.indicator.textContent = '▶';
        element.appendChild(row.indicator);
      }
      if (item.disabled) return;
      panel.rows.push(row);
      element.addEventListener('mouseenter', () => {
        focus(panel, panel.rows.indexOf(row));
        openChild(panel, row, false);
      });
      element.addEventListener('mouseleave', () => scheduleClose(panels.indexOf(panel) + 1));
      element.addEventListener('click', () => activate(panel, row));
    });
    // Keep the editor selection intact until an action deliberately changes it.
    el.addEventListener('mousedown', e => { if ((e.target as HTMLElement).closest('[role=menuitem]')) e.preventDefault(); });
    el.addEventListener('mouseenter', cancelClose);
    el.addEventListener('mouseleave', () => { if (parent) scheduleClose(panels.indexOf(panel)); });
    document.body.appendChild(el);
    return panel;
  }
  function keydown(e: KeyboardEvent) {
    const panel = panels.find(p => p.el.contains(document.activeElement)) ?? panels[panels.length-1];
    if (!panel) return;
    const depth = panels.indexOf(panel);
    switch (e.key) {
      case 'ArrowDown': closeFrom(depth+1); focus(panel,panel.index+1); break;
      case 'ArrowUp': closeFrom(depth+1); focus(panel,panel.index-1); break;
      case 'Home': closeFrom(depth+1); focus(panel,0); break;
      case 'End': closeFrom(depth+1); focus(panel,panel.rows.length-1); break;
      case 'ArrowRight': if (panel.rows[panel.index]) openChild(panel,panel.rows[panel.index],true); break;
      case 'Enter': case ' ': if (panel.rows[panel.index]) activate(panel,panel.rows[panel.index]); break;
      case 'ArrowLeft': if (depth) { closeFrom(depth); focus(panels[depth-1],panels[depth-1].index); } break;
      case 'Escape': {
        if (panels.length > 1) { const parent = panels[panels.length-1].parent; closeFrom(panels.length-1); parent?.el.focus({preventScroll:true}); }
        else { handle.dispose(); invoker?.focus({preventScroll:true}); }
        break;
      }
      case 'Tab': handle.dispose(); invoker?.focus({preventScroll:true}); return;
      default: return;
    }
    e.preventDefault(); e.stopImmediatePropagation();
  }
  createPanel(items);
  layout();
  focus(panels[0],0);
  const options = {capture:true, signal:listeners.signal};
  document.addEventListener('keydown',keydown,options);
  const outside = (e: Event) => { if (!panels.some(p => p.el.contains(e.target as Node))) handle.dispose(); };
  document.addEventListener('pointerdown',outside,options);
  document.addEventListener('click',outside,options);
  document.addEventListener('scroll',e => {
    if (panels.some(p => p.el === e.target)) scheduleLayout();
    else handle.dispose();
  },options);
  window.addEventListener('resize',scheduleLayout,{signal:listeners.signal});
  window.addEventListener('blur',handle.dispose,{signal:listeners.signal});
  window.visualViewport?.addEventListener('resize',scheduleLayout,{signal:listeners.signal});
  window.visualViewport?.addEventListener('scroll',scheduleLayout,{signal:listeners.signal});
  activeMenu = handle;
  return handle;
}
