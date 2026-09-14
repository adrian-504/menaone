import { escHtml, expose, positionFloatingPopup } from './utils';
import { icon } from './icons';

export interface ContextMenuItem {
  label: string;
  run: () => void;
  danger?: boolean;
  iconName?: string;
  /** Renders a divider line instead of an item. */
  separator?: boolean;
}

let activeMenuItems: ContextMenuItem[] = [];

function renderMenuItems(items: ContextMenuItem[]): string {
  return items
    .map((item, i) => item.separator ? '<div class="ctx-menu-sep" role="separator"></div>' : `<div class="ctx-menu-item${item.danger ? ' danger' : ''}" onclick="activateContextMenuItem(${i})">${item.iconName ? `<span>${icon(item.iconName, 14)}</span>` : ''}<span>${escHtml(item.label)}</span></div>`)
    .join('');
}

/** Reusable right-click menu, built on the same `positionFloatingPopup`
 * viewport-clamping primitive Notes' slash-menu already uses — a context
 * menu is just that popover anchored to the click point instead of a caret.
 * Call from an `oncontextmenu` handler: `showContextMenu(e, [...])`. */
export function showContextMenu(e: MouseEvent, items: ContextMenuItem[]): void {
  e.preventDefault();
  e.stopPropagation();
  activeMenuItems = items;

  const menu = document.getElementById('ctx-menu') as HTMLElement;
  menu.innerHTML = renderMenuItems(items);
  menu.classList.add('open');

  // positionFloatingPopup anchors to an element's bounding rect; a context
  // menu anchors to the click point instead, so a throwaway 0x0 anchor at
  // the cursor stands in for one rather than duplicating the clamping math.
  const anchor = document.createElement('div');
  anchor.style.position = 'fixed';
  anchor.style.left = `${e.clientX}px`;
  anchor.style.top = `${e.clientY}px`;
  anchor.style.width = '0';
  anchor.style.height = '0';
  document.body.appendChild(anchor);
  positionFloatingPopup(menu, anchor);
  anchor.remove();
}
expose('showContextMenu', showContextMenu);

/** Same shared #ctx-menu popover, anchored to a real element's bounding rect
 * instead of a click point — for a persistent toolbar/button dropdown (e.g.
 * the sidebar's "+ New" menu) rather than a right-click menu. Reuses every
 * other mechanic (Escape/outside-click/scroll dismissal, item activation)
 * for free since it's the exact same DOM element and listeners. */
export function showMenuAt(anchorEl: HTMLElement, items: ContextMenuItem[]): void {
  activeMenuItems = items;
  const menu = document.getElementById('ctx-menu') as HTMLElement;
  menu.innerHTML = renderMenuItems(items);
  menu.classList.add('open');
  positionFloatingPopup(menu, anchorEl);
}
expose('showMenuAt', showMenuAt);

export function closeContextMenu(): void {
  document.getElementById('ctx-menu')?.classList.remove('open');
  activeMenuItems = [];
}
expose('closeContextMenu', closeContextMenu);

export function activateContextMenuItem(idx: number): void {
  const item = activeMenuItems[idx];
  closeContextMenu();
  item?.run();
}
expose('activateContextMenuItem', activateContextMenuItem);

document.addEventListener('click', () => closeContextMenu());
document.addEventListener('contextmenu', (e) => {
  if (!(e.target as HTMLElement | null)?.closest('#ctx-menu')) closeContextMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeContextMenu();
});
document.addEventListener('scroll', () => closeContextMenu(), true);
