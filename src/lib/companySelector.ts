// Shared Company Selector — attaches a searchable dropdown (existing
// companies, with industry as secondary text, plus a "+ Create" row) to any
// plain text `<input>` currently used for typing a company/client name.
// Mirrors the existing `contextMenu.ts` floating-popover pattern rather than
// inventing new positioning logic. Selecting or creating a company just sets
// the input's value — resolving that name to a `companyId` still happens
// server-side on save (see resolve_company in opportunities.rs), exactly as
// it already does for every one of these fields. This only makes picking an
// existing company easier and warns before creating a likely duplicate; it
// does not change what gets persisted.
import { S } from './state';
import { escHtml } from './utils';
import { persistCreateCompany } from './persist';
import type { Company } from './types';

export interface CompanySelectorOptions {
  /** Called after the input's value is set, whether by picking an existing
   * company or creating a new one — for callers that need to react (e.g.
   * refreshing a related contacts list keyed off the typed name). */
  onSelect?: (name: string) => void;
}

const LEGAL_SUFFIX_RE = /\b(sole proprietorship|branch|l l c|llc|ltd|limited|plc|llp|lp|sarl|s a r l|wll|w l l|fzc|fze|gmbh|corporation|corp|inc|co|sa)\b/g;

/** Exported for the Companies list's "possible duplicates" data-quality
 * check, which needs the exact same fuzzy-match logic used here (and
 * server-side in company_migration.rs) so the three don't drift apart. */
export function normalizeCompanyNameForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(LEGAL_SUFFIX_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

let popover: HTMLDivElement | null = null;
let activeInput: HTMLInputElement | null = null;
let activeOptions: CompanySelectorOptions = {};
let activeMatches: Company[] = [];
let activeIndex = -1;
let activeQuery = '';

function ensurePopover(): HTMLDivElement {
  if (popover) return popover;
  popover = document.createElement('div');
  popover.className = 'company-selector-popover';
  popover.setAttribute('role', 'listbox');
  document.body.appendChild(popover);
  // Rows are picked on mousedown so the input keeps focus; one listener for all rows.
  popover.addEventListener('mousedown', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.company-selector-row');
    if (!row) return;
    e.preventDefault();
    if (row.dataset.create) createFromQuery();
    else pick(Number(row.dataset.i));
  });
  return popover;
}

function hide(): void {
  popover?.classList.remove('open');
  activeIndex = -1;
}

function isOpen(): boolean {
  return !!popover?.classList.contains('open');
}

function commit(name: string): void {
  if (activeInput) {
    activeInput.value = name;
    activeInput.dispatchEvent(new Event('input', { bubbles: true }));
    activeInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
  activeOptions.onSelect?.(name);
  hide();
}

function pick(i: number): void {
  const c = activeMatches[i];
  if (c) commit(c.name);
}

function createFromQuery(): void {
  const name = activeQuery.trim();
  if (!name) return;
  hide();
  void persistCreateCompany(name).then((created) => {
    if (created) commit(created.name);
  });
}

/** Companies whose name contains the query: names starting with it first, then A–Z. */
function matchCompanies(q: string): Company[] {
  const all = S.companies;
  if (!q) return [...all].sort((a, b) => a.name.localeCompare(b.name));
  return all
    .filter((c) => c.name.toLowerCase().includes(q))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name));
}

/** Directly under the input (above it when there's no room), left-aligned, at least as wide as the input. */
function place(pop: HTMLElement, input: HTMLElement): void {
  const rect = input.getBoundingClientRect();
  const margin = 6;
  pop.style.minWidth = `${Math.min(Math.max(rect.width, 220), 420)}px`;
  const height = pop.offsetHeight;
  const below = window.innerHeight - rect.bottom - margin;
  const top = below >= height || below >= rect.top ? rect.bottom + 4 : Math.max(margin, rect.top - height - 4);
  pop.style.top = `${top}px`;
  pop.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - pop.offsetWidth - margin))}px`;
}

function render(query: string): void {
  const input = activeInput;
  if (!input) return;
  const pop = ensurePopover();
  activeQuery = query;
  const q = query.trim().toLowerCase();
  const matches = matchCompanies(q);
  activeMatches = matches;
  const exact = q !== '' && S.companies.some((c) => c.name.toLowerCase() === q);

  const rows = matches
    .map((c, i) => `
      <div class="company-selector-row" role="option" data-i="${i}">
        <span class="company-selector-name">${escHtml(c.name)}</span>
        ${c.industries[0] ? `<span class="company-selector-sub">${escHtml(c.industries[0])}</span>` : ''}
      </div>
    `)
    .join('');

  let extra = '';
  if (q && !exact) {
    const norm = normalizeCompanyNameForMatch(q);
    const nearMatch = norm ? S.companies.find((c) => normalizeCompanyNameForMatch(c.name) === norm) : undefined;
    if (nearMatch) {
      extra += `<div class="company-selector-warn">Similar to existing company: <strong>${escHtml(nearMatch.name)}</strong></div>`;
    }
    extra += `<div class="company-selector-row company-selector-create" role="option" data-create="1">+ Create "${escHtml(query.trim())}"</div>`;
  }

  pop.innerHTML = rows + extra;
  if (!rows && !extra) {
    hide();
    return;
  }
  activeIndex = -1;
  pop.scrollTop = 0;
  pop.classList.add('open');
  place(pop, input);
}

/** Arrow keys move through the list, Enter picks, Escape closes. */
function onKey(e: KeyboardEvent): void {
  if (!isOpen() || !popover) return;
  const rows = [...popover.querySelectorAll<HTMLElement>('.company-selector-row')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = Math.max(0, Math.min(rows.length - 1, activeIndex + (e.key === 'ArrowDown' ? 1 : -1)));
    rows.forEach((r, i) => r.classList.toggle('active', i === activeIndex));
    rows[activeIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && activeIndex >= 0) {
    e.preventDefault();
    const row = rows[activeIndex];
    if (row?.dataset.create) createFromQuery(); else pick(Number(row?.dataset.i));
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    hide();
  }
}

/** Attaches the searchable company dropdown to a plain text input. Safe to
 * call once per input at render time: an input that already has it is left as it is. */
export function attachCompanySelector(input: HTMLInputElement, opts: CompanySelectorOptions = {}): void {
  // This custom popover fully replaces the native <datalist> autocomplete —
  // leaving `list` set means the browser shows its own suggestion list on
  // top of this one (the bug where two menus appeared at once).
  input.removeAttribute('list');
  input.setAttribute('autocomplete', 'off');
  const open = () => {
    activeInput = input;
    activeOptions = opts;
    render(input.value);
  };
  const attached = input as HTMLInputElement & { companySelectorOpen?: () => void };
  if (attached.companySelectorOpen) {
    // Re-attached (dialogs set this up every time they open): keep one set of listeners, latest options.
    attached.companySelectorOpen = open;
    return;
  }
  attached.companySelectorOpen = open;
  input.addEventListener('focus', () => attached.companySelectorOpen?.());
  input.addEventListener('input', () => attached.companySelectorOpen?.());
  input.addEventListener('keydown', onKey);
  input.addEventListener('blur', () => {
    // Delay so a mousedown on a popover row fires before the popover is torn down.
    setTimeout(() => { if (activeInput === input) hide(); }, 150);
  });
}

// Scrolling the page moves the input away from the list, so the list closes —
// but scrolling the list itself (mouse wheel or trackpad) must not close it.
document.addEventListener('scroll', (e) => {
  if (popover && e.target instanceof Node && popover.contains(e.target)) return;
  hide();
}, true);
