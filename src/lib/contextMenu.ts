import { escHtml, expose, positionDropdown, positionFloatingPopup, strColor } from './utils';
import { initialsOf } from './appearance';
import { orderMenu } from './chromeKit';
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
  /** The keys that do the same, shown on the right ("⌘D", "N"). */
  shortcut?: string;
  /** The row that names the record the menu is for (first, not clickable): its tile, title and one line. */
  head?: MenuHead;
}

export interface MenuHead {
  title: string;
  meta?: string;
  /** A company's or a person's name for an initials tile (a person's is round), or an icon. */
  tile?: { name: string; round?: boolean } | { icon: string };
}

/** The header item of a record's menu. */
export const menuHead = (title: string, meta = '', tile?: MenuHead['tile']): ContextMenuItem => ({ label: title, run: () => {}, head: { title, meta, tile } });

const SEPARATOR: ContextMenuItem = { label: '', run: () => {}, separator: true };

function headHtml(h: MenuHead): string {
  const t = h.tile;
  const tile = !t ? '' : 'name' in t
    ? `<span class="ctx-head-tile${t.round ? ' is-round' : ''}" style="background:${strColor(t.name || '?')}" aria-hidden="true">${escHtml(initialsOf(t.name) || '·')}</span>`
    : `<span class="ctx-head-tile is-icon" aria-hidden="true">${icon(t.icon, 14)}</span>`;
  return `<div class="ctx-menu-head">${tile}<div class="ctx-head-t"><b>${escHtml(h.title)}</b>${h.meta ? `<span>${escHtml(h.meta)}</span>` : ''}</div></div>`;
}

let activeMenuItems: ContextMenuItem[] = [];

/** The menu in its order (lib/chromeKit.ts): the header, the groups, what destroys last. The order drawn is the
 * order kept, so a click finds its item. */
function arrange(items: ContextMenuItem[]): ContextMenuItem[] {
  return orderMenu(items, SEPARATOR);
}

function renderMenuItems(items: ContextMenuItem[]): string {
  return items
    .map((item, i) => item.head ? headHtml(item.head)
      : item.separator ? '<div class="ctx-menu-sep" role="separator"></div>'
      : item.heading ? `<div class="ctx-menu-hd">${escHtml(item.label)}</div>`
      : `<div class="ctx-menu-item${item.danger ? ' danger' : ''}" role="menuitem" tabindex="-1" onclick="activateContextMenuItem(${i})">${item.iconName ? `<span class="ctx-menu-ic">${icon(item.iconName, 14)}</span>` : ''}<span class="ctx-menu-l">${escHtml(item.label)}</span>${item.shortcut ? `<kbd>${escHtml(item.shortcut)}</kbd>` : ''}</div>`)
    .join('');
}

/** What opened the menu: the focus returns to it when the menu closes. */
let menuOpener: HTMLElement | null = null;

/** Reusable right-click menu, built on the same `positionFloatingPopup`
 * viewport-clamping primitive Notes' slash-menu already uses — a context
 * menu is just that popover anchored to the click point instead of a caret.
 * Call from an `oncontextmenu` handler: `showContextMenu(e, [...])`. */
export function showContextMenu(e: MouseEvent, items: ContextMenuItem[]): void {
  e.preventDefault();
  e.stopPropagation();
  items = arrange(items);
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
  menuOpener = anchorEl;
  items = arrange(items);
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
  const menu = document.getElementById('ctx-menu');
  // The focus goes back to what opened the menu, so it is never left on a hidden item (and a row action's redraw
  // can keep it on the row: lib/keepPlace.ts).
  if (menu?.contains(document.activeElement)) { if (menuOpener?.isConnected) menuOpener.focus({ preventScroll: true }); else (document.activeElement as HTMLElement | null)?.blur(); }
  menuOpener = null;
  menu?.classList.remove('open');
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
