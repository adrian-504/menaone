import { S } from './state';
import { ST } from './constants';

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

export function resolveTextPrompt(value: string | null): void {
  document.getElementById('modal-text-prompt')?.classList.remove('open');
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
export function showConfirm(message: string, opts?: { title?: string; confirmLabel?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    confirmPromptResolve = resolve;
    (document.getElementById('confirm-prompt-title') as HTMLElement).textContent = opts?.title || 'Are you sure?';
    (document.getElementById('confirm-prompt-message') as HTMLElement).textContent = message;
    (document.getElementById('confirm-prompt-ok-btn') as HTMLElement).textContent = opts?.confirmLabel || 'Confirm';
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

/** DD-MMM-YYYY display format. Dates are stored as YYYY-MM-DD strings and always
 * parsed with a fixed T12:00:00 time to dodge timezone day-shift bugs — this
 * convention is preserved exactly from the original app. */
export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s + 'T12:00:00');
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Same DD-MMM-YYYY display format as fmtDate(), for inputs that are already
 * full ISO timestamps (file mtimes, updatedAt fields) rather than bare
 * YYYY-MM-DD strings — skips fmtDate's T12:00:00 append, which would corrupt
 * a timestamp that already carries real time/timezone info. */
export function fmtDateFromIso(s: string | null | undefined): string {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function daysSince(s: string | null | undefined): number | null {
  if (!s) return null;
  const d = new Date(s + 'T12:00:00');
  return isNaN(d.getTime()) ? null : Math.floor((Date.now() - d.getTime()) / 86400000);
}

export function daysUntil(s: string | null | undefined): number | null {
  if (!s) return null;
  const d = new Date(s + 'T12:00:00');
  return isNaN(d.getTime()) ? null : Math.floor((d.getTime() - Date.now()) / 86400000);
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
  const c = ST[status] || { c: '#6B7280', ch: '#9CA3AF' };
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

/** A stable avatar colour for a name. */
export function strColor(s: string): string {
  const palette = ['#1D4ED8', '#7C3AED', '#0D9488', '#D97706', '#DC2626', '#0369A1', '#065F46', '#92400E', '#DB2777', '#059669'];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffffffff;
  return palette[Math.abs(h) % palette.length];
}
