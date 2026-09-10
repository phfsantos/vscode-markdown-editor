export interface MenuRect { left: number; top: number; right: number; bottom: number }
export interface MenuViewport { left: number; top: number; width: number; height: number }

/** All coordinates are CSS pixels relative to the layout viewport. */
export function placeMenu({ anchor, size, viewport, kind }: {
  anchor: MenuRect;
  size: { width: number; height: number };
  viewport: MenuViewport;
  kind: 'root' | 'submenu';
}) {
  const inset = Math.min(10, viewport.width / 4, viewport.height / 4);
  const left = viewport.left + inset;
  const top = viewport.top + inset;
  const right = viewport.left + viewport.width - inset;
  const bottom = viewport.top + viewport.height - inset;
  const width = Math.min(size.width, right - left);
  const height = Math.min(size.height, bottom - top);
  const gap = kind === 'submenu' ? 4 : 0;
  const rightSpace = right - anchor.right - gap;
  const leftSpace = anchor.left - gap - left;
  const side: 'right' | 'left' = rightSpace >= width ? 'right'
    : leftSpace >= width ? 'left' : rightSpace >= leftSpace ? 'right' : 'left';
  const x = side === 'right' ? anchor.right + gap : anchor.left - gap - width;
  let y = kind === 'root' ? anchor.bottom : anchor.top;
  if (kind === 'root' && y + height > bottom && anchor.top - height >= top) y = anchor.top - height;
  return { left: Math.max(left, Math.min(x, right - width)), top: Math.max(top, Math.min(y, bottom - height)), width, height, side };
}
