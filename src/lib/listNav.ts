// Shared keyboard-list-navigation utility (Core Refinement & Product
// Maturity, Stage 4). The "highlighted index + .sel class + arrow-key/Enter"
// pattern this stage needs already existed — independently hand-rolled three
// times (command palette, Notes' [[wikilink]] menu, Notes' /slash menu). This
// extracts it into one reusable factory for new call sites, following this
// codebase's existing procedural style (closured module state, not a class)
// rather than introducing a new OOP pattern. The three existing call sites
// are left as-is — not touching working code just to consolidate it.
import { S } from './state';
import { getActiveTabId } from './registry';

export interface ListNavConfig<T extends number | string> {
  /** Ids of every currently-rendered row, in visual order. Called fresh on
   * every key press so it always matches whatever's actually on screen,
   * regardless of the list's own filter/sort state — no duplicated logic. */
  getItems: () => T[];
  /** Look up a row's DOM element by id, for highlighting + scrollIntoView. */
  getEl: (id: T) => HTMLElement | null;
  /** Enter (or click, if wired) — open/activate the row. */
  onOpen: (id: T) => void;
  /** Space — only meaningful for some lists (e.g. Tasks' done-toggle). */
  onToggle?: (id: T) => void;
  /** Gate: only this tab, only while this list is actually visible. */
  tabId: string;
  selectedClass?: string;
}

export interface ListNav<T extends number | string> {
  selected: T | null;
  selectId: (id: T | null) => void;
}

function isTypingTarget(): boolean {
  const tag = (document.activeElement as HTMLElement | null)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function anyModalOpen(): boolean {
  return !!document.querySelector('.modal-ov.open') || S.commandPaletteOpen;
}

export function createListNav<T extends number | string>(config: ListNavConfig<T>): ListNav<T> {
  const cls = config.selectedClass || 'sel';
  const state: ListNav<T> = {
    selected: null,
    selectId(id: T | null) {
      state.selected = id;
      for (const itemId of config.getItems()) {
        config.getEl(itemId)?.classList.toggle(cls, itemId === id);
      }
      if (id != null) config.getEl(id)?.scrollIntoView({ block: 'nearest' });
    },
  };

  function moveBy(delta: number): void {
    const items = config.getItems();
    if (items.length === 0) return;
    const idx = state.selected == null ? -1 : items.indexOf(state.selected);
    const next = Math.min(Math.max(idx + delta, 0), items.length - 1);
    state.selectId(items[next]);
  }

  document.addEventListener('keydown', (e) => {
    if (getActiveTabId() !== config.tabId) return;
    if (anyModalOpen() || isTypingTarget()) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); moveBy(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveBy(-1); }
    else if (e.key === 'Enter') { if (state.selected != null) { e.preventDefault(); config.onOpen(state.selected); } }
    else if (e.key === ' ') { if (state.selected != null && config.onToggle) { e.preventDefault(); config.onToggle(state.selected); } }
  });

  return state;
}
