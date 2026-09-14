// Bulk actions bar: appears at the bottom of a list while records are
// selected. Choice actions (owner, status, reason) open a menu of options.

import { escHtml } from './utils';
import { showMenuAt, type ContextMenuItem } from './contextMenu';

export interface BulkAction {
  label: string;
  danger?: boolean;
  /** Runs directly… */
  run?: () => void;
  /** …or offers these choices first. */
  choices?: () => ContextMenuItem[];
}

const registry = new Map<string, BulkAction[]>();
const visibleWhen = new Map<string, () => boolean>();

export function renderBulkBar(id: string, count: number, noun: [string, string], actions: BulkAction[], clear: string, visible: () => boolean = () => true): void {
  visibleWhen.set(id, visible);
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'bulk-bar';
    el.setAttribute('role', 'toolbar');
    document.body.appendChild(el);
  }
  registry.set(id, actions);
  el.classList.toggle('open', count > 0 && visible());
  if (!count) return;
  el.innerHTML = `<span class="bulk-count">${count} ${escHtml(count === 1 ? noun[0] : noun[1])} selected</span>
    ${actions.map((a, i) => `<button class="bulk-btn${a.danger ? ' danger' : ''}" onclick="bulkBarAction(event, '${id}', ${i})">${escHtml(a.label)}${a.choices ? ' ▾' : ''}</button>`).join('')}
    <button class="bulk-btn bulk-clear" onclick="${clear}" aria-label="Clear selection">×</button>`;
}

export function bulkBarAction(e: MouseEvent, id: string, index: number): void {
  const action = registry.get(id)?.[index];
  if (!action) return;
  if (action.choices) {
    e.stopPropagation();
    showMenuAt(e.currentTarget as HTMLElement, action.choices());
    return;
  }
  action.run?.();
}
(window as any).bulkBarAction = bulkBarAction;

export function hideBulkBar(id: string): void {
  document.getElementById(id)?.classList.remove('open');
}

/** Hides bars whose list isn't on screen any more (called on every navigation). */
export function syncBulkBars(): void {
  for (const [id, visible] of visibleWhen) {
    const el = document.getElementById(id);
    if (el && el.classList.contains('open') && !visible()) el.classList.remove('open');
  }
}
