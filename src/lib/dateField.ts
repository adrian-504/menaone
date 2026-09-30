// One date control (foundations F1). Every <input type="date"> in the app —
// in index.html or drawn later — becomes a text field you can type in:
// "tomorrow", "next Tue", "in 3 days", "2 Oct", "02/10", "2 Oct 2026" (see
// lib/dateParse.ts). While you type, what it understood shows beneath it
// ("Thu 2 Oct 2026"); Enter or leaving the field keeps it; Esc puts it back.
// ↑/↓ move a day, ⇧↑/⇧↓ a week; a click or ⌥↓ opens a small calendar. It
// shows dates the app's way ("2 Oct 2026") and its .value is still the ISO
// date the rest of the app reads and writes, so no caller changed.

import { fmtDate, fmtDateWeekday, fmtMonth } from './dates';
import { nudge, parseDate } from './dateParse';
import { isoDate } from './taskParse';

const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
const shown = (el: HTMLInputElement) => native.get!.call(el) as string;
const show = (el: HTMLInputElement, text: string) => native.set!.call(el, text);
const iso = (el: HTMLInputElement) => el.dataset.iso || '';

let hint: HTMLElement | null = null;
let cal: HTMLElement | null = null;
let calFor: HTMLInputElement | null = null;
let calMonth = new Date();
/** True while the field announces its own change (so it isn't read as typing). */
let ownEvent = false;

function place(box: HTMLElement, el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  box.style.left = `${Math.round(r.left)}px`;
  box.style.top = `${Math.round(r.bottom + 4)}px`;
}

function showHint(el: HTMLInputElement): void {
  hint ??= Object.assign(document.createElement('div'), { className: 'df-hint' });
  if (!hint.isConnected) document.body.appendChild(hint);
  const text = shown(el).trim();
  const parsed = text ? parseDate(text, new Date()) : null;
  hint.textContent = !text ? 'Type a date: tomorrow, next Tue, 2 Oct…' : parsed ? `${fmtDateWeekday(parsed)} ${parsed.slice(0, 4)}` : 'Not a date yet';
  hint.classList.toggle('is-bad', !!text && !parsed);
  place(hint, el);
  hint.classList.add('open');
}

function hideHint(): void {
  hint?.classList.remove('open');
}

function drawCalendar(): void {
  if (!cal || !calFor) return;
  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(y, m + 1, 0).getDate();
  const today = isoDate(new Date());
  const cells: string[] = [];
  for (let i = 0; i < lead; i++) cells.push('<span></span>');
  for (let d = 1; d <= days; d++) {
    const v = isoDate(new Date(y, m, d));
    cells.push(`<button type="button" class="df-day${v === today ? ' is-today' : ''}${v === iso(calFor) ? ' is-on' : ''}" data-iso="${v}">${d}</button>`);
  }
  cal.innerHTML = `<div class="df-cal-hd"><button type="button" class="rec-icon-btn" data-step="-1" aria-label="Previous month">‹</button><span>${fmtMonth(first)}</span><button type="button" class="rec-icon-btn" data-step="1" aria-label="Next month">›</button></div>
    <div class="df-cal-dow">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="df-cal-grid">${cells.join('')}</div>`;
}

function openCalendar(el: HTMLInputElement): void {
  if (!cal) {
    cal = document.createElement('div');
    cal.className = 'df-cal';
    // mousedown, not click: the field mustn't blur (and commit) before the pick lands.
    cal.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const t = e.target as HTMLElement;
      const step = t.closest<HTMLElement>('[data-step]')?.dataset.step;
      if (step) { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + Number(step), 1); drawCalendar(); return; }
      const day = t.closest<HTMLElement>('[data-iso]')?.dataset.iso;
      if (day && calFor) { const f = calFor; closeCalendar(); commit(f, day); }
    });
  }
  if (!cal.isConnected) document.body.appendChild(cal);
  calFor = el;
  const at = iso(el) || isoDate(new Date());
  calMonth = new Date(Number(at.slice(0, 4)), Number(at.slice(5, 7)) - 1, 1);
  drawCalendar();
  place(cal, el);
  cal.classList.add('open');
  hideHint();
}

function closeCalendar(): void {
  cal?.classList.remove('open');
  calFor = null;
}

/** Keeps a value (ISO, or '' to clear) and tells the page, if it changed. */
function commit(el: HTMLInputElement, value: string): void {
  const before = iso(el);
  el.dataset.iso = value;
  show(el, value ? fmtDate(value) : '');
  if (value !== before) {
    ownEvent = true;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    ownEvent = false;
  }
}

/** The typed text is kept if it's a date (or empty); otherwise it goes back, with a shake. */
function commitTyped(el: HTMLInputElement): void {
  const text = shown(el).trim();
  const value = text ? parseDate(text, new Date()) : '';
  if (value == null) {
    show(el, iso(el) ? fmtDate(iso(el)) : '');
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    return;
  }
  commit(el, value);
}

export function upgradeDateField(el: HTMLInputElement): void {
  if (el.dataset.df) return;
  el.dataset.df = '1';
  const start = el.value || el.getAttribute('value') || '';
  el.type = 'text';
  el.classList.add('date-field');
  el.autocomplete = 'off';
  el.spellcheck = false;
  if (!el.placeholder) el.placeholder = 'Date';
  Object.defineProperty(el, 'value', {
    configurable: true,
    get: () => iso(el),
    set: (v: string) => {
      const value = v ? (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : parseDate(v, new Date()) || '') : '';
      el.dataset.iso = value;
      show(el, value ? fmtDate(value) : '');
    },
  });
  el.value = start;
  let typed = false;
  el.addEventListener('mousedown', () => { if (document.activeElement === el || !el.readOnly) setTimeout(() => openCalendar(el), 0); });
  el.addEventListener('focus', () => { typed = false; el.select(); });
  el.addEventListener('input', () => { if (ownEvent) return; typed = true; closeCalendar(); showHint(el); });
  el.addEventListener('blur', () => { hideHint(); closeCalendar(); if (typed) commitTyped(el); typed = false; });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { if (typed) { e.preventDefault(); commitTyped(el); typed = false; hideHint(); } return; }
    if (e.key === 'Escape') {
      if (cal?.classList.contains('open') || typed) { e.preventDefault(); e.stopPropagation(); closeCalendar(); hideHint(); show(el, iso(el) ? fmtDate(iso(el)) : ''); typed = false; }
      return;
    }
    if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); openCalendar(el); return; }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const base = typed ? parseDate(shown(el), new Date()) || iso(el) : iso(el);
      const step = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 7 : 1);
      commit(el, nudge(base || isoDate(new Date()), base ? step : 0));
      typed = false;
      hideHint();
      el.select();
    }
  });
}

/** Upgrades every date input now and whenever one is drawn. */
export function startDateFields(): void {
  const up = (root: ParentNode) => root.querySelectorAll<HTMLInputElement>('input[type="date"]').forEach(upgradeDateField);
  up(document);
  new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => {
      if (n instanceof HTMLInputElement && n.type === 'date') upgradeDateField(n);
      else if (n instanceof HTMLElement && n.querySelector('input[type="date"]')) up(n);
    });
  }).observe(document.body, { subtree: true, childList: true });
  document.addEventListener('scroll', () => { closeCalendar(); hideHint(); }, true);
}
