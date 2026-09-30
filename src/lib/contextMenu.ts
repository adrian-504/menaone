import { escHtml, expose, positionDropdown, positionFloatingPopup } from './utils';
import { icon } from './icons';
import { registerKey } from '../core/keys';

export interface ContextMenuItem {
  label: string;
  run: () => void;
  danger?: boolean;
  iconName?: string;
  /** Renders a divider line instead of an item. */
  separator?: boolean;
  /** Renders the label as a group heading (not clickable). */
  heading?: boolean;
}

let activeMenuItems: ContextMenuItem[] = [];

function renderMenuItems(items: ContextMenuItem[]): string {
  return items
    .map((item, i) => item.separator ? '<div class="ctx-menu-sep" role="separator"></div>' : item.heading ? `<div class="ctx-menu-hd">${escHtml(item.label)}</div>` : `<div class="ctx-menu-item${item.danger ? ' danger' : ''}" role="menuitem" tabindex="-1" onclick="activateContextMenuItem(${i})">${item.iconName ? `<span>${icon(item.iconName, 14)}</span>` : ''}<span>${escHtml(item.label)}</span></div>`)
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
  menu.style.transformOrigin = '';
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
  positionDropdown(menu, anchorEl);
  // Keyboard focus lands in the menu (arrows move, Enter picks, Escape closes).
  menu.querySelector<HTMLElement>('.ctx-menu-item')?.focus({ preventScroll: true });
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
// A menu's keys: arrows move, Enter picks (Esc is in core/appKeys.ts).
const menuOpen = () => !!document.getElementById('ctx-menu')?.classList.contains('open');
const menuMove = (delta: number) => {
  const menu = document.getElementById('ctx-menu');
  const items = [...(menu?.querySelectorAll<HTMLElement>('.ctx-menu-item') ?? [])];
  if (!items.length) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  items[(at + delta + items.length) % items.length]?.focus();
};
registerKey({ scope: 'dialog', combo: 'arrowdown', when: menuOpen, run: () => menuMove(1) });
registerKey({ scope: 'dialog', combo: 'arrowup', when: menuOpen, run: () => menuMove(-1) });
registerKey({ scope: 'dialog', combo: 'enter', when: () => menuOpen() && !!document.activeElement?.closest?.('#ctx-menu'), run: () => { (document.activeElement as HTMLElement).click(); } });
// A long menu scrolls; only scrolling something else closes it.
document.addEventListener('scroll', (e) => {
  if (e.target instanceof Element && e.target.closest('#ctx-menu')) return;
  closeContextMenu();
}, true);
