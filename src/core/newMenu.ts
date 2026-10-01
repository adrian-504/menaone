// The New menu (the sidebar's "+ New"): everything that can be created, in
// groups, each with a tile, a helper where the kind needs one, and its
// shortcut. It starts from where you are — the open record's own create
// actions come first. Type to filter, ↑↓ to move, ↵ to create, Esc to close.
// What it lists is lib/newMenu.ts; each opener lives in its own tab module and
// is reached through `window`, as everywhere in this early-loaded file.

import { escHtml, expose, positionDropdown } from '../lib/utils';
import { icon } from '../lib/icons';
import { NEW_ITEMS, filterNewItems, flatNewItems, groupNewItems, stepSelection, type NewItem } from '../lib/newMenu';
import { keysFor } from './keys';
import { contextCreateActions, contextRecordCompany } from './contextActions';

const w = () => window as any;

const RUN: Record<string, () => void> = {
  task: () => w().openTodoModal?.(null),
  meeting: () => w().openMeetingModal?.(null),
  note: () => { w().switchTab?.('notes'); w().createNewNote?.(null); },
  promise: () => w().openCommitmentModal?.(),
  company: () => w().openNewCompanyModal?.(),
  contact: () => w().openContactModal?.(null),
  opportunity: () => w().openOpportunityModal?.(null),
  proposal: () => w().openAddModal?.(null),
  agreement: () => w().openAgrModal?.(null),
  project: () => w().openProjectModal?.(null),
};

let query = '';
let selected = 0;
let hereRuns: (() => void)[] = [];

/** What the open record offers: its own create actions (a meeting from a project, a task from a meeting…), then,
 * inside a company's record, an opportunity or a contact for that company. */
function hereItems(): NewItem[] {
  hereRuns = [];
  const out: NewItem[] = [];
  const add = (label: string, iconName: string, run: () => void) => { out.push({ key: `here:${hereRuns.length}`, label, group: 'Here', icon: iconName, tint: 'var(--coral-text)' }); hereRuns.push(run); };
  for (const a of contextCreateActions()) add(a.label.replace(/^New /, ''), a.iconName, a.run);
  const company = contextRecordCompany();
  if (company) {
    const ctx = { companyId: company.id, companyName: company.name, projectId: null, opportunityId: null, meetingId: null, noteId: null };
    add(`Opportunity for ${company.name}`, 'briefcase', () => w().openOpportunityModal?.(null, ctx));
    add(`Contact at ${company.name}`, 'people', () => w().openContactModal?.(company.name, company.id));
  }
  return out;
}

const menu = () => document.getElementById('new-menu');
const isOpen = () => !!menu()?.classList.contains('open');
let all: NewItem[] = [];
const shown = () => flatNewItems(filterNewItems(all, query));

function draw(): void {
  const list = document.getElementById('new-menu-list');
  if (!list) return;
  const items = filterNewItems(all, query);
  const flat = flatNewItems(items);
  if (selected >= flat.length) selected = Math.max(0, flat.length - 1);
  list.innerHTML = flat.length ? groupNewItems(items).map((g) => `<div class="newmenu-hd">${escHtml(g.group === 'Here' ? 'From here' : g.group)}</div>${g.items.map((i) => {
    const at = flat.indexOf(i);
    const keys = i.shortcutId ? keysFor(i.shortcutId) : null;
    return `<button type="button" class="newmenu-item${at === selected ? ' is-sel' : ''}" role="option" aria-selected="${at === selected}" tabindex="-1" data-i="${at}" onclick="newMenuPick(${at})" onmousemove="newMenuHover(${at})">
      <span class="newmenu-tile" style="--c:${i.tint}">${icon(i.icon, 14)}</span>
      <span class="newmenu-t"><b>${escHtml(i.label)}</b>${i.helper ? `<span>${escHtml(i.helper)}</span>` : ''}</span>
      ${keys ? `<kbd>${escHtml(keys)}</kbd>` : ''}</button>`;
  }).join('')}`).join('') : `<div class="newmenu-none">Nothing called “${escHtml(query)}”</div>`;
  list.querySelector('.newmenu-item.is-sel')?.scrollIntoView({ block: 'nearest' });
}

export function closeNewMenu(): void {
  menu()?.classList.remove('open');
}
expose('closeNewMenu', closeNewMenu);

export function toggleNewMenu(e: Event): void {
  e.stopPropagation();
  if (isOpen()) { closeNewMenu(); return; }
  const btn = document.getElementById('sb-new-btn');
  const el = menu();
  const input = document.getElementById('new-menu-filter') as HTMLInputElement | null;
  if (!btn || !el || !input) return;
  w().closeContextMenu?.();
  all = [...hereItems(), ...NEW_ITEMS];
  query = '';
  selected = 0;
  input.value = '';
  draw();
  el.classList.add('open');
  positionDropdown(el, btn);
  input.focus({ preventScroll: true });
}
expose('toggleNewMenu', toggleNewMenu);

export function newMenuPick(index: number): void {
  const item = shown()[index];
  closeNewMenu();
  if (!item) return;
  if (item.key.startsWith('here:')) hereRuns[Number(item.key.slice(5))]?.();
  else RUN[item.key]?.();
}
expose('newMenuPick', newMenuPick);

/** The pointer moves the selection, so the keyboard and the mouse agree on one highlighted row. */
export function newMenuHover(index: number): void {
  if (index === selected) return;
  selected = index;
  document.querySelectorAll<HTMLElement>('#new-menu-list .newmenu-item').forEach((el) => {
    const on = Number(el.dataset.i) === index;
    el.classList.toggle('is-sel', on);
    el.setAttribute('aria-selected', String(on));
  });
}
expose('newMenuHover', newMenuHover);

export function newMenuFilter(value: string): void {
  query = value;
  selected = 0;
  draw();
}
expose('newMenuFilter', newMenuFilter);

export function newMenuKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    selected = stepSelection(selected, e.key === 'ArrowDown' ? 1 : -1, shown().length);
    draw();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    newMenuPick(selected);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeNewMenu();
    document.getElementById('sb-new-btn')?.focus();
  }
}
expose('newMenuKey', newMenuKey);

document.addEventListener('click', (e) => {
  if (isOpen() && !(e.target as HTMLElement | null)?.closest('#new-menu')) closeNewMenu();
});
