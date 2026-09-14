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
import { escHtml, positionFloatingPopup } from './utils';
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

function ensurePopover(): HTMLDivElement {
  if (popover) return popover;
  popover = document.createElement('div');
  popover.className = 'company-selector-popover';
  document.body.appendChild(popover);
  return popover;
}

function hide(): void {
  popover?.classList.remove('open');
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

function render(query: string): void {
  const input = activeInput;
  if (!input) return;
  const pop = ensurePopover();
  const q = query.trim().toLowerCase();
  const all = S.companies;
  const matches = (q ? all.filter((c) => c.name.toLowerCase().includes(q)) : all.slice()).slice(0, 8);
  activeMatches = matches;
  const exact = q !== '' && all.some((c) => c.name.toLowerCase() === q);

  const rows = matches
    .map((c, i) => `
      <div class="company-selector-row" data-i="${i}">
        <span class="company-selector-name">${escHtml(c.name)}</span>
        ${c.industries[0] ? `<span class="company-selector-sub">${escHtml(c.industries[0])}</span>` : ''}
      </div>
    `)
    .join('');

  let extra = '';
  if (q && !exact) {
    const norm = normalizeCompanyNameForMatch(q);
    const nearMatch = norm ? all.find((c) => normalizeCompanyNameForMatch(c.name) === norm) : undefined;
    if (nearMatch) {
      extra += `<div class="company-selector-warn">Similar to existing company: <strong>${escHtml(nearMatch.name)}</strong></div>`;
    }
    extra += `<div class="company-selector-row company-selector-create" data-create="1">+ Create "${escHtml(query.trim())}"</div>`;
  }

  pop.innerHTML = rows + extra;
  if (!rows && !extra) {
    hide();
    return;
  }
  pop.classList.add('open');
  positionFloatingPopup(pop, input);

  pop.querySelectorAll<HTMLElement>('.company-selector-row[data-i]').forEach((el) => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const i = Number(el.dataset.i);
      const c = activeMatches[i];
      if (c) commit(c.name);
    });
  });
  const createEl = pop.querySelector<HTMLElement>('[data-create]');
  createEl?.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const name = query.trim();
    hide();
    void persistCreateCompany(name).then((created) => {
      if (created) commit(created.name);
    });
  });
}

/** Attaches the searchable company dropdown to a plain text input. Safe to
 * call once per input at render time (each call re-registers its own
 * listeners; re-attaching an already-attached input just adds a harmless
 * duplicate set, matching how other `expose()`-style setup functions in this
 * codebase are called on every modal open). */
export function attachCompanySelector(input: HTMLInputElement, opts: CompanySelectorOptions = {}): void {
  // This custom popover fully replaces the native <datalist> autocomplete —
  // leaving `list` set means the browser shows its own suggestion list on
  // top of this one (the bug where two menus appeared at once).
  input.removeAttribute('list');
  const open = () => {
    activeInput = input;
    activeOptions = opts;
    render(input.value);
  };
  input.addEventListener('focus', open);
  input.addEventListener('input', open);
  input.addEventListener('blur', () => {
    // Delay so a mousedown on a popover row fires before the popover is torn down.
    setTimeout(() => { if (activeInput === input) hide(); }, 150);
  });
}

document.addEventListener('scroll', hide, true);
