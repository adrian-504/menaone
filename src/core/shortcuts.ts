// Keyboard shortcut sheet: "?" (or ⌘/) shows every shortcut, with the ones
// for the current module first.

import { S } from '../lib/state';
import { escHtml, expose } from '../lib/utils';
import { getActiveTabId } from '../lib/registry';
import { allBindings, capsOf } from './keys';

/** Written help that isn't a key the app answers (typed markers, editor formatting). */
interface Hint { keys: string[][]; does: string; note?: string; group: string }
const HINTS: Hint[] = [
  { group: 'Everywhere', keys: [['>>']], does: 'At the start of a line in notes, meeting notes or quick capture: something we promised the client (it gets a task)' },
  { group: 'Everywhere', keys: [['<<']], does: 'Same, for something the client promised us (tracked, no task)' },
  { group: 'Dialogs and pickers', keys: [['↑'], ['↓']], does: 'Choose in a company list' },
  { group: 'Dialogs and pickers', keys: [['Enter']], does: 'Pick the highlighted company' },
  { group: 'Notes', keys: [['/']], does: 'Formatting menu', note: 'while writing' },
];

/** Which groups belong to which pages (their group comes first on that page). */
const GROUP_TABS: Record<string, string[]> = {
  'Lists and records': ['companies', 'contacts', 'database', 'agreements', 'opportunities', 'projects', 'meetings', 'pending', 'followup'],
  Tasks: ['todo'], Notes: ['notes'], 'Clean-up': ['cleanup'], Files: ['files'],
};
const ORDER = ['Everywhere', 'Dialogs and pickers', 'Lists and records', 'Tasks', 'Notes', 'Clean-up', 'Files', 'New proposal'];

interface Row { keys: string[][]; does: string; note?: string }
/** The sheet's groups, drawn from the registry (so it can't drift from the keys). */
export function sheetGroups(): { title: string; tabs?: string[]; items: Row[] }[] {
  const groups = new Map<string, Row[]>();
  const add = (group: string, row: Row) => {
    const list = groups.get(group) ?? [];
    if (!list.some((r) => r.does === row.does)) list.push(row);
    groups.set(group, list);
  };
  for (const b of allBindings()) {
    if (!b.label || !b.group) continue;
    add(b.group, { keys: (Array.isArray(b.combo) ? b.combo : [b.combo]).map(capsOf), does: b.label, note: b.note });
  }
  for (const h of HINTS) add(h.group, h);
  return [...groups.entries()]
    .sort((a, b) => (ORDER.indexOf(a[0]) + 99) % 99 - (ORDER.indexOf(b[0]) + 99) % 99)
    .map(([title, items]) => ({ title, tabs: GROUP_TABS[title], items }));
}

const caps = (combo: string[]) => combo.map((c) => `<kbd>${escHtml(c)}</kbd>`).join('');

export function openShortcutSheet(): void {
  let ov = document.getElementById('modal-shortcuts');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'modal-shortcuts';
    ov.className = 'modal-ov';
    ov.addEventListener('click', (e) => { if (e.target === ov) closeShortcutSheet(); });
    document.body.appendChild(ov);
  }
  const tab = getActiveTabId();
  const groups = [...sheetGroups()].sort((a, b) => Number(!!b.tabs?.includes(tab)) - Number(!!a.tabs?.includes(tab)));
  ov.innerHTML = `<div class="modal modal-lg shortcut-sheet" role="dialog" aria-label="Keyboard shortcuts">
    <div class="modal-hd"><div class="modal-title">Keyboard shortcuts</div><button class="modal-close" onclick="closeShortcutSheet()">×</button></div>
    <div class="shortcut-groups">${groups.map((g) => `<section class="shortcut-group${g.tabs?.includes(tab) ? ' is-current' : ''}">
      <h3>${escHtml(g.title)}${g.tabs?.includes(tab) ? ' <span class="rec-badge tone-accent">This page</span>' : ''}</h3>
      <dl>${g.items.map((it) => `<dt>${it.keys.map(caps).join('<span>or</span>')}</dt><dd>${escHtml(it.does)}${it.note ? ` <span class="t-muted">— ${escHtml(it.note)}</span>` : ''}</dd>`).join('')}</dl>
    </section>`).join('')}</div>
  </div>`;
  ov.classList.add('open');
}
expose('openShortcutSheet', openShortcutSheet);

export function closeShortcutSheet(): void {
  document.getElementById('modal-shortcuts')?.classList.remove('open');
}
expose('closeShortcutSheet', closeShortcutSheet);

// The keys themselves are registered (core/appKeys.ts and each page); this file only draws the sheet.
