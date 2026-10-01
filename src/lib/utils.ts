import { S } from './state';
import { ST, CHART_TOKENS } from './constants';
import { isDestructive } from './chromeKit';

/** Today's date (YYYY-MM-DD) in local time — toISOString() is UTC, which
 * gave yesterday's date in KSA before 3am. */
export function today(): string {
  return localIsoDate(new Date());
}

/** A Date as YYYY-MM-DD in local time. */
export function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Wraps a zero-arg function so rapid repeat calls (e.g. an `oninput` handler
 * firing on every keystroke) collapse into one, `ms` after the last call —
 * the same clear-timer/set-timer shape already hand-rolled per-call-site
 * elsewhere (command palette search, Opportunity/Meeting autosave), pulled
 * out here since three more search inputs need the identical debounce. */
export function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

/** List searches (foundations P3): the list redraws 150 ms after the last
 * keystroke instead of on every one; the render reads the field when it runs,
 * so the newest query always wins. `filterSoon('renderContacts')` from an
 * oninput; one timer per renderer. */
const filterTimers = new Map<string, ReturnType<typeof setTimeout>>();
export function filterSoon(render: string | (() => void), ms = 150): void {
  const key = typeof render === 'string' ? render : render.name || 'fn';
  clearTimeout(filterTimers.get(key));
  filterTimers.set(key, setTimeout(() => {
    filterTimers.delete(key);
    if (typeof render === 'string') (window as any)[render]?.();
    else render();
  }, ms));
}

/** Positions a floating menu/popover as `position:fixed`, anchored near
 * `anchor` and clamped to the viewport. Popups that only use CSS
 * `position:absolute` inherit whatever stacking context their scroll
 * container happens to be in, which is how they end up rendering underneath
 * the fixed sidebar (z-index:1000) when their anchor sits near the top of a
 * long scrolled list — this sidesteps that entirely by computing real
 * viewport coordinates, the same way notes.ts's caret-tracking menus do. */
export function positionFloatingPopup(popup: HTMLElement, anchor: HTMLElement): void {
  popup.style.position = 'fixed';
  popup.style.visibility = 'hidden';
  popup.style.right = 'auto';
  popup.style.bottom = 'auto';
  const rect = anchor.getBoundingClientRect();
  const popRect = popup.getBoundingClientRect();
  const margin = 6;
  const spaceAbove = rect.top;
  const spaceBelow = window.innerHeight - rect.bottom;
  const openAbove = spaceAbove > popRect.height + margin || spaceAbove > spaceBelow;
  popup.style.top = openAbove
    ? `${Math.max(margin, rect.top - popRect.height - margin)}px`
    : `${Math.min(window.innerHeight - popRect.height - margin, rect.bottom + margin)}px`;
  const left = Math.max(margin, Math.min(rect.right - popRect.width, window.innerWidth - popRect.width - margin));
  popup.style.left = `${left}px`;
  popup.style.visibility = '';
}

/** Where a button's dropdown goes (owner, 30-Sep-2026: the Followed up menu
 * opened upwards over the page although there was room below): below the
 * button, right-aligned to it, `gap` px apart; above only when the visible
 * area has no room below and more above. `bounds` is that visible area —
 * the button's scroll container clipped to the window. Pure. */
export function menuPlacement(
  anchor: { top: number; bottom: number; left: number; right: number },
  pop: { width: number; height: number },
  bounds: { top: number; bottom: number; width: number },
  gap = 4, margin = 6,
): { top: number; left: number; above: boolean } {
  const roomBelow = bounds.bottom - anchor.bottom - gap - margin;
  const roomAbove = anchor.top - bounds.top - gap - margin;
  const above = roomBelow < pop.height && roomAbove > roomBelow;
  const top = above
    ? Math.max(bounds.top + margin, anchor.top - gap - pop.height)
    : Math.max(bounds.top + margin, Math.min(anchor.bottom + gap, bounds.bottom - margin - pop.height));
  const left = Math.max(margin, Math.min(anchor.right - pop.width, bounds.width - pop.width - margin));
  return { top, left, above };
}

/** The visible area around an element: its nearest scrolling ancestor, clipped to the window. */
export function visibleBounds(el: HTMLElement): { top: number; bottom: number; width: number } {
  let top = 0;
  let bottom = window.innerHeight;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.clientHeight > 0) {
      const r = p.getBoundingClientRect();
      top = Math.max(top, r.top);
      bottom = Math.min(bottom, r.bottom);
      break;
    }
  }
  return { top, bottom, width: window.innerWidth };
}

/** A button's dropdown, placed by menuPlacement. */
export function positionDropdown(popup: HTMLElement, anchor: HTMLElement): void {
  popup.style.position = 'fixed';
  popup.style.visibility = 'hidden';
  popup.style.right = 'auto';
  popup.style.bottom = 'auto';
  // offsetWidth/Height, not the bounding box: the menu opens with a scale
  // animation, and a scaled box measures ~6% small (it overshot the button's right edge).
  const pop = { width: popup.offsetWidth, height: popup.offsetHeight };
  const { top, left, above } = menuPlacement(anchor.getBoundingClientRect(), pop, visibleBounds(anchor));
  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
  popup.style.transformOrigin = above ? 'bottom right' : 'top right';
  popup.style.visibility = '';
}

let textPromptResolve: ((value: string | null) => void) | null = null;

/** Replacement for the browser-native `window.prompt()`, which Tauri's
 * WKWebView on macOS does not implement (it returns null instantly with no
 * UI). Shows the `#modal-text-prompt` overlay and resolves when the user
 * clicks OK/Cancel, presses Enter/Escape, or clicks the overlay backdrop —
 * mirrors `prompt()`'s own null-on-cancel contract so call sites only need
 * `await` added, not restructuring. */
export function showTextPrompt(opts: { title: string; label?: string; defaultValue?: string; placeholder?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    textPromptResolve = resolve;
    (document.getElementById('text-prompt-title') as HTMLElement).textContent = opts.title;
    const labelEl = document.getElementById('text-prompt-label') as HTMLElement;
    labelEl.textContent = opts.label || '';
    labelEl.style.display = opts.label ? '' : 'none';
    const input = document.getElementById('text-prompt-input') as HTMLInputElement;
    input.value = opts.defaultValue || '';
    input.placeholder = opts.placeholder || '';
    document.getElementById('modal-text-prompt')?.classList.add('open');
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}

/** One date, asked in the same dialog: pre-filled, back-datable, with the button saying what it does. Resolves to the
 * date (YYYY-MM-DD) or null when cancelled or cleared. */
export function showDatePrompt(opts: { title: string; label?: string; defaultValue?: string; confirmLabel?: string; note?: string | null }): Promise<string | null> {
  const input = document.getElementById('text-prompt-input') as HTMLInputElement;
  const ok = document.getElementById('text-prompt-ok');
  input.type = 'date';
  // One amber line under the date, for what the question does not stop to ask.
  const note = document.getElementById('text-prompt-note');
  if (note) { note.textContent = opts.note || ''; note.hidden = !opts.note; }
  if (ok) ok.textContent = opts.confirmLabel || 'OK';
  return showTextPrompt({ title: opts.title, label: opts.label, defaultValue: opts.defaultValue }).then((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null));
}

export function resolveTextPrompt(value: string | null): void {
  document.getElementById('modal-text-prompt')?.classList.remove('open');
  // Back to a plain text box for the next question.
  const input = document.getElementById('text-prompt-input') as HTMLInputElement | null;
  if (input) input.type = 'text';
  const ok = document.getElementById('text-prompt-ok'); if (ok) ok.textContent = 'OK';
  const note = document.getElementById('text-prompt-note'); if (note) { note.textContent = ''; note.hidden = true; }
  const resolve = textPromptResolve;
  textPromptResolve = null;
  resolve?.(value === null ? null : value.trim());
}
expose('resolveTextPrompt', resolveTextPrompt);

let confirmPromptResolve: ((value: boolean) => void) | null = null;

/** Styled replacement for the destructive-action `window.confirm()` calls —
 * same Promise/modal-resolver shape as showTextPrompt() above, reusing the
 * app's own modal chrome (and getting the Escape/backdrop-click handling
 * every `.modal-ov` already has for free) instead of the native dialog. Not
 * a wholesale replacement of every confirm() in the app — just the ones
 * guarding real data loss. */
export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  /** What else goes with the record (worked out from it; files on disk never are), as a short list. */
  also?: string[];
  /** What stays and is worth saying, under the list. */
  stays?: string[];
  /** The action offers Undo afterwards: the footer says so. */
  undoable?: boolean;
  /** Red, with the red tile. Read from the button's label (Delete, Remove, Discard…) unless said. */
  destructive?: boolean;
}

export function showConfirm(message: string, opts?: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    confirmPromptResolve = resolve;
    const label = opts?.confirmLabel || 'Confirm';
    const destructive = opts?.destructive ?? isDestructive(label);
    (document.getElementById('confirm-prompt-title') as HTMLElement).textContent = opts?.title || (destructive ? `${label}?` : 'Are you sure?');
    (document.getElementById('confirm-prompt-message') as HTMLElement).textContent = message;
    const ok = document.getElementById('confirm-prompt-ok-btn') as HTMLElement;
    ok.textContent = label;
    // Only what destroys is red; anything else is the dialog's one primary.
    ok.className = destructive ? 'btn-danger' : 'btn-primary';
    document.getElementById('confirm-prompt-box')?.classList.toggle('is-destructive', destructive);
    const also = document.getElementById('confirm-prompt-also');
    if (also) { also.hidden = !opts?.also?.length; also.innerHTML = (opts?.also || []).map((x) => `<li>${escHtml(x)}</li>`).join(''); }
    const stays = document.getElementById('confirm-prompt-stays');
    if (stays) { stays.hidden = !opts?.stays?.length; stays.textContent = (opts?.stays || []).join(' '); }
    const undo = document.getElementById('confirm-prompt-undo');
    if (undo) undo.hidden = !opts?.undoable;
    document.getElementById('modal-confirm-prompt')?.classList.add('open');
  });
}

export function resolveConfirmPrompt(value: boolean): void {
  document.getElementById('modal-confirm-prompt')?.classList.remove('open');
  const resolve = confirmPromptResolve;
  confirmPromptResolve = null;
  resolve?.(value);
}
expose('resolveConfirmPrompt', resolveConfirmPrompt);
expose('filterSoon', filterSoon);

// Dates and times: the one family lives in ./dates (pure, so lib modules can use it too).
export * from './dates';

export function daysSince(s: string | null | undefined): number | null {
  if (!s) return null;
  // Whole calendar days between that date and today (local), so "today" is 0 at any hour.
  const d = new Date(s.slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((todayMidnight.getTime() - d.getTime()) / 86400000);
}

export function daysUntil(s: string | null | undefined): number | null {
  if (!s) return null;
  const since = daysSince(s);
  return since == null ? null : 0 - since;
}

export function addMonths(dateStr: string | null | undefined, months: number | null | undefined): string | null {
  if (!dateStr || !months) return null;
  const d = new Date(dateStr + 'T12:00:00');
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

export function fmtSAR(n: number | null | undefined): string {
  if (!n || n === 0) return '—';
  return 'SAR ' + Number(n).toLocaleString();
}

export function escHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Status indicator as a small colored dot + plain-text label — the
 * restrained pattern used throughout (Linear/Things-style), replacing the
 * earlier filled colored-pill badges. `cfg` only needs a dot color (`ch`
 * falls back to `c`); `bg`/`br` on StatusStyle are unused here but kept on
 * the type since some status configs still reference them for chart colors. */
export function statusDot(cfg: { c: string; ch?: string }, label: string, extraStyle = ''): string {
  const dot = cfg.ch || cfg.c;
  return `<span class="status-dot-label"${extraStyle ? ` style="${extraStyle}"` : ''}><span class="status-dot" style="background:${dot}"></span>${escHtml(label)}</span>`;
}

export function badge(status: string): string {
  const c = ST[status] || { c: 'var(--muted)' };
  return statusDot(c, status);
}

/** Neutral KPI/stat card — flat, no per-metric rainbow border. Pass `signal`
 * only for genuinely alerting metrics (a small dot before the label), not as
 * decoration; most KPIs should omit it entirely. */
export function kpiCard(
  lbl: string,
  val: string | number,
  sub?: string | null,
  opts?: { onclick?: string; signal?: 'danger' | 'warning' | 'positive' },
): string {
  const dotColor = opts?.signal === 'danger' ? 'var(--red)' : opts?.signal === 'warning' ? 'var(--amber)' : opts?.signal === 'positive' ? 'var(--green)' : null;
  return `<div class="kpi"${opts?.onclick ? ` onclick="${opts.onclick}"` : ''}>
    <div class="kpi-lbl">${dotColor ? `<span class="kpi-dot" style="background:${dotColor}"></span>` : ''}${escHtml(lbl)}</div>
    <div class="kpi-val">${escHtml(val)}</div>
    ${sub ? `<div class="kpi-sub">${escHtml(sub)}</div>` : ''}
  </div>`;
}

export function yn(v: string | null | undefined): string {
  if (v === 'Yes') return `<span class="t-positive">Yes</span>`;
  if (v === 'No') return `<span class="t-red">No</span>`;
  return `<span class="t-muted">—</span>`;
}

export function nextId(): number {
  return S.proposals.length > 0 ? Math.max(...S.proposals.map((p) => p.id)) + 1 : 1;
}

export function nextCtId(): number {
  return S.contacts.length > 0 ? Math.max(...S.contacts.map((c) => c.id)) + 1 : 1;
}

export function nextAgrId(): number {
  return S.agreements.length > 0 ? Math.max(...S.agreements.map((a) => a.id)) + 1 : 1;
}

export function nextTodoId(): number {
  return S.todos.length > 0 ? Math.max(...S.todos.map((t) => t.id)) + 1 : 1;
}

export function nextNoteId(): number {
  return S.notes.length > 0 ? Math.max(...S.notes.map((n) => n.id)) + 1 : 1;
}

/** Canonical list of every known company name — the single source every
 * company datalist/autocomplete in the app should read from. Unions the
 * numeric `companies` table (the eventual single source of truth, once every
 * legacy row has a resolved `companyId` — see company_migration.rs) with
 * every free-text company field still in use, so a name typed anywhere shows
 * up everywhere immediately, with no period filter hiding it. Replaces the
 * former split between this function (proposals-only) and
 * `companies.ts`'s `getAllCompanies` (proposals+agreements+contacts, and only
 * period-unfiltered by accident) — both now just call this. */
export function getClients(): string[] {
  const names = new Set<string>();
  S.companies.forEach((c) => { if (c.name) names.add(c.name); });
  S.proposals.forEach((p) => { if (p.client) names.add(p.client); });
  S.agreements.forEach((a) => { if (a.client) names.add(a.client); });
  S.contacts.forEach((c) => { if (c.clientName) names.add(c.clientName); });
  S.projects.forEach((p) => { if (p.companyName) names.add(p.companyName); });
  S.meetings.forEach((m) => { if (m.companyName) names.add(m.companyName); });
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** A company as the other records point at it: its canonical id when the
 * Company row exists, plus the name for records not linked to it yet. */
export interface CompanyRef { id: number | null; name: string }

export function companyRef(name: string): CompanyRef {
  return { id: S.companies.find((c) => c.name === name)?.id ?? null, name };
}

/** Whether two company references point at the same company. Matches by
 * company_id whenever both sides have one (the backend links every saved
 * record), and only falls back to the name for a record that hasn't been
 * linked yet — e.g. one created a moment ago whose save is still in flight. */
export function sameCompany(aId: number | null | undefined, aName: string | null | undefined, bId: number | null | undefined, bName: string | null | undefined): boolean {
  if (aId != null && bId != null) return aId === bId;
  return !!aName && aName === bName;
}

/** Whether a record (its companyId + free-text company name) belongs to `ref`. */
export function inCompany(ref: CompanyRef, recordId: number | null | undefined, recordName: string | null | undefined): boolean {
  return sameCompany(recordId, recordName, ref.id, ref.name);
}

/** Reads a CSS custom property's current computed value — used to keep
 * Chart.js canvases (which can't resolve var() themselves) in sync with the
 * active light/dark theme instead of hardcoding light-mode-only hex values. */
export function themeColor(varName: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

/** Expose a function on `window` so it stays reachable from the ported
 * inline `onclick="..."` handlers in index.html — this preserves the
 * original app's markup 1:1 instead of rewiring every handler to
 * addEventListener, which would touch hundreds of call sites for no
 * functional benefit. */
export function expose(name: string, fn: (...args: any[]) => any): void {
  (window as any)[name] = fn;
}

/** A stable avatar colour for a name, from the chart palette (a CSS variable). */
/** The initials tile colour for a name: one of six brand colours (--tile-1…6), always the same for the same name. */
export function strColor(s: string): string {
  return `var(--tile-${tileIndex(s)})`;
}

/** 1–6, stable per name (case and outer spaces don't count). Pure. */
export function tileIndex(s: string): number {
  const key = s.trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return (Math.abs(h) % 6) + 1;
}

/** The chart palette resolved to colours, for canvases (which can't read CSS variables). */
export function chartPalette(): string[] {
  return CHART_TOKENS.map((t) => themeColor(t));
}
