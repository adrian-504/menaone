// Keyboard shortcut sheet: "?" (or ⌘/) shows every shortcut, with the ones
// for the current module first.

import { S } from '../lib/state';
import { escHtml, expose } from '../lib/utils';
import { getActiveTabId } from '../lib/registry';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl';

/** Keys are shown as key caps; alternatives are separate arrays. */
interface Shortcut { keys: string[][]; does: string; note?: string }
interface Group { title: string; tabs?: string[]; items: Shortcut[] }
const k = (does: string, ...keys: string[][]): Shortcut => ({ keys, does });

const GROUPS: Group[] = [
  { title: 'Everywhere', items: [
    k('Search and commands', [MOD, 'K']),
    k('Back / forward', [MOD, '['], [MOD, ']']),
    k('Show or hide the sidebar', [MOD, '\\']),
    k('My Day', [MOD, '1']),
    { keys: [[MOD, '2']], does: 'Tasks, Opportunities, Projects, Pending, Notes, Companies, Contacts, Follow-Up', note: `${MOD} 2 to ${MOD} 9` },
    k('New task / new note', [MOD, 'T'], [MOD, 'N']),
    k('Close a dialog or the open record', ['Esc']),
    k('This list', ['?']),
  ] },
  { title: 'Dialogs and pickers', items: [
    k('Choose in a company list', ['↑'], ['↓']),
    k('Pick the highlighted company', ['Enter']),
    k('Close the list, then the dialog', ['Esc']),
  ] },
  { title: 'Lists and records', tabs: ['companies', 'contacts', 'database', 'agreements', 'opportunities', 'projects', 'meetings'], items: [
    k('Move through a list', ['↑'], ['↓']),
    k('Open the selected record', ['Enter']),
    { keys: [['↑'], ['↓']], does: 'Previous / next record', note: 'in the side list' },
  ] },
  { title: 'Tasks', tabs: ['todo'], items: [
    k('Add a task', ['N'], ['Q']),
    { keys: [['↑'], ['↓']], does: 'Move', note: 'hold ⇧ to select several' },
    k('Open the task', ['Enter']),
    k('Complete', ['Space']),
    k('Due today', ['T']),
    k('Pick a date', ['D']),
    k('Someday', ['S']),
    k('Change priority', ['P']),
    k('Move to a project', ['M']),
    k('Delete, with undo', ['Delete']),
  ] },
  { title: 'Notes', tabs: ['notes'], items: [
    k('New note', [MOD, 'N']),
    k('Search notes', [MOD, '⇧', 'F']),
    k('Focus mode', [MOD, '.']),
    { keys: [['/']], does: 'Formatting menu', note: 'while writing' },
  ] },
  { title: 'Clean-up', tabs: ['cleanup'], items: [
    { keys: [['1']], does: 'Apply the numbered fix', note: '1 to 9' },
    k('Skip to the next record', ['→']),
  ] },
  { title: 'Files', tabs: ['files'], items: [
    k('Select', ['↑'], ['↓']),
    k('Open', ['Enter']),
    k('Up one folder', [MOD, '↑'], ['Delete']),
    k('Search this folder', [MOD, 'F']),
  ] },
];

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
  const groups = [...GROUPS].sort((a, b) => Number(!!b.tabs?.includes(tab)) - Number(!!a.tabs?.includes(tab)));
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

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || t.closest?.('.cm-editor') || S.commandPaletteOpen) return;
  const open = document.getElementById('modal-shortcuts')?.classList.contains('open');
  if (e.key === '?' || ((e.metaKey || e.ctrlKey) && e.key === '/')) {
    e.preventDefault();
    if (open) closeShortcutSheet(); else if (!document.querySelector('.modal-ov.open')) openShortcutSheet();
  }
});
