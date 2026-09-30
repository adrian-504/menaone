// Shared interface components that are built in code rather than static
// markup: toasts (with an optional action such as Undo), empty states and
// loading skeletons. Styles live under "Design system" in styles.css; every
// variant is on the dev-only Component Gallery page.
//
// Imports only icons.ts (which imports nothing): db.ts and other low-level
// modules use these too.

import { icon } from './icons';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type Tone = 'neutral' | 'success' | 'error';

export interface ToastOptions {
  tone?: Tone;
  /** Smaller second line, e.g. the underlying error. */
  detail?: string;
  action?: { label: string; run: () => void };
  /** Milliseconds before it goes away on its own; 0 keeps it until dismissed. */
  duration?: number;
}

function stack(): HTMLElement {
  let el = document.getElementById('toast-stack');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-stack';
    el.className = 'toast-stack';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  return el;
}

/** Shows a short message at the bottom of the window. Replaces `alert()`:
 * it never blocks, and repeated identical messages don't pile up. */
export function toast(message: string, opts: ToastOptions = {}): { dismiss: () => void } {
  const tone = opts.tone ?? 'neutral';
  const root = stack();
  const existing = [...root.children].find((c) => (c as HTMLElement).dataset.message === message) as HTMLElement | undefined;
  existing?.remove();

  const el = document.createElement('div');
  el.className = `toast toast-${tone}`;
  el.dataset.message = message;
  el.innerHTML = `<div class="toast-body"><div class="toast-msg">${esc(message)}</div>${opts.detail ? `<div class="toast-detail">${esc(opts.detail)}</div>` : ''}</div>`
    + (opts.action ? `<button class="toast-action">${esc(opts.action.label)}</button>` : '')
    + `<button class="toast-close" aria-label="Dismiss">×</button>`;

  let timer: number | undefined;
  const dismiss = () => {
    window.clearTimeout(timer);
    if (!el.isConnected) return;
    el.classList.add('leaving');
    window.setTimeout(() => el.remove(), 180);
  };
  el.querySelector('.toast-close')?.addEventListener('click', dismiss);
  if (opts.action) {
    const { run } = opts.action;
    el.querySelector('.toast-action')?.addEventListener('click', () => { dismiss(); run(); });
  }
  root.appendChild(el);
  // Three at most: the oldest fades out first.
  const live = [...root.children].filter((c) => !c.classList.contains('leaving')) as HTMLElement[];
  for (const old of live.slice(0, Math.max(0, live.length - 3))) {
    old.classList.add('leaving');
    window.setTimeout(() => old.remove(), 180);
  }

  const duration = opts.duration ?? (tone === 'error' ? 8000 : opts.action ? 6000 : 3500);
  if (duration > 0) {
    timer = window.setTimeout(dismiss, duration);
    el.addEventListener('mouseenter', () => window.clearTimeout(timer));
    el.addEventListener('mouseleave', () => { timer = window.setTimeout(dismiss, 2500); });
  }
  return { dismiss };
}

/** Nothing moves under the pointer (owner, 30-Sep-2026: motion system): a
 * re-render that can reorder a list waits while the pointer is over it or a
 * row is pressed, and runs on pointer-leave or after 1.5 s without movement.
 * The latest render wins; the Notes list fix, generalised. */
const waiting = new WeakMap<HTMLElement, () => void>();
export function deferWhileHovered(list: HTMLElement | null, render: () => void): void {
  if (!list || !list.isConnected || !list.matches(':hover')) { render(); return; }
  const first = !waiting.has(list);
  waiting.set(list, render);
  if (!first) return;
  let idle = 0;
  const run = () => {
    window.clearTimeout(idle);
    list.removeEventListener('pointerleave', run);
    list.removeEventListener('pointermove', wait);
    const fn = waiting.get(list);
    waiting.delete(list);
    fn?.();
  };
  const wait = () => { window.clearTimeout(idle); idle = window.setTimeout(() => (list.querySelector(':active') ? wait() : run()), 1500); };
  list.addEventListener('pointerleave', run);
  list.addEventListener('pointermove', wait);
  wait();
}

// ── Undo (owner, 30-Sep-2026: "Undo everywhere") ───────────────────────────
// One undo at a time, bottom-left, for 7 s; a new one replaces it; ⌘Z runs it
// (unless you're typing, where ⌘Z undoes the text).

let undoEl: HTMLElement | null = null;
let undoRun: (() => void) | null = null;
let undoTimer = 0;

function clearUndo(): void {
  window.clearTimeout(undoTimer);
  undoRun = null;
  const el = undoEl;
  undoEl = null;
  if (!el?.isConnected) return;
  el.classList.add('leaving');
  window.setTimeout(() => el.remove(), 180);
}

function undoStack(): HTMLElement {
  let el = document.getElementById('undo-stack');
  if (!el) {
    el = document.createElement('div');
    el.id = 'undo-stack';
    el.className = 'undo-stack';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  return el;
}

/** "Task deleted · Undo" — the pattern for every reversible action. */
export function undoToast(message: string, undo: () => void, ms = 7000): void {
  clearUndo();
  const el = document.createElement('div');
  el.className = 'toast toast-neutral toast-undo';
  el.innerHTML = `<div class="toast-body"><div class="toast-msg">${esc(message)}</div></div><button class="toast-action">Undo <kbd>⌘Z</kbd></button><button class="toast-close" aria-label="Dismiss">×</button>`;
  const run = () => { clearUndo(); undo(); };
  el.querySelector('.toast-action')?.addEventListener('click', run);
  el.querySelector('.toast-close')?.addEventListener('click', clearUndo);
  el.addEventListener('mouseenter', () => window.clearTimeout(undoTimer));
  el.addEventListener('mouseleave', () => { undoTimer = window.setTimeout(clearUndo, 2500); });
  undoStack().appendChild(el);
  undoEl = el;
  undoRun = run;
  undoTimer = window.setTimeout(clearUndo, ms);
}

/** Does it now, offers Undo for 7 s. */
export function withUndo<T>(label: string, commit: () => T, undo: () => void): T {
  const out = commit();
  undoToast(label, undo);
  return out;
}

/** The undo on screen, if any (for tests and ⌘Z). */
export function pendingUndo(): (() => void) | null {
  return undoRun;
}

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest('.cm-editor'));
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z' && undoRun && !typing(e.target)) {
      e.preventDefault();
      undoRun();
    }
  });
}

export interface EmptyStateOptions {
  /** Name from lib/icons.ts, rendered by renderIcons(). */
  icon?: string;
  title: string;
  body?: string;
  /** Inline onclick for a primary action, e.g. `openTodoModal(null)`. */
  action?: { label: string; onclick: string };
  compact?: boolean;
}

export function emptyState(o: EmptyStateOptions): string {
  return `<div class="empty-state${o.compact ? ' compact' : ''}">`
    // Drawn here, not by a later renderIcons pass that some containers never got (the Inbox's was blank).
    + (o.icon ? `<span class="empty-state-icon">${icon(o.icon, o.compact ? 18 : 22)}</span>` : '')
    + `<div class="empty-state-title">${esc(o.title)}</div>`
    + (o.body ? `<div class="empty-state-body">${esc(o.body)}</div>` : '')
    + (o.action ? `<button class="btn-secondary empty-state-action" onclick="${esc(o.action.onclick)}">${esc(o.action.label)}</button>` : '')
    + `</div>`;
}

/** Shown in place of a list that couldn't be loaded, with a way to try again. */
export function loadFailedState(what: string, retryOnclick: string, err?: unknown): string {
  return emptyState({ icon: 'warning', title: `Couldn't load ${what}`, body: err ? String(err) : 'Something went wrong reading the database.', action: { label: 'Try again', onclick: retryOnclick } });
}

/** Loads a list for a view: while it loads the view shows placeholders; if it
 * fails, the view keeps what it already shows (with a message), or shows a
 * retry state when it has nothing yet. Returns whether the load succeeded. */
export async function loadInto(el: HTMLElement | null, what: string, retryOnclick: string, load: () => Promise<void>, variant: 'rows' | 'cards' = 'rows'): Promise<boolean> {
  const empty = !!el && !el.childElementCount;
  if (el && empty) el.innerHTML = skeleton(variant === 'cards' ? 3 : 4, variant);
  try {
    await load();
    // What replaces the placeholders fades in (delight 11): rows or the empty state, never a flash.
    if (el && el.querySelector('.skel-wrap')) {
      el.classList.add('arriving');
      window.setTimeout(() => el.classList.remove('arriving'), 260);
    }
    return true;
  } catch (err) {
    console.error(`[load] ${what}:`, err);
    if (el && (empty || el.querySelector('.skel-wrap'))) el.innerHTML = loadFailedState(what, retryOnclick, err);
    else toast(`Couldn't refresh ${what}`, { tone: 'error', detail: String(err) });
    return false;
  }
}

/** Placeholder rows shown while a view loads. */
export function skeleton(rows = 4, variant: 'rows' | 'cards' = 'rows'): string {
  const item = variant === 'cards'
    ? '<div class="skel-card"><div class="skel skel-line w60"></div><div class="skel skel-line w90"></div><div class="skel skel-line w40"></div></div>'
    : '<div class="skel-row"><div class="skel skel-dot"></div><div class="skel skel-line w70"></div><div class="skel skel-line w20"></div></div>';
  return `<div class="skel-wrap skel-${variant}" aria-busy="true" aria-label="Loading">${item.repeat(rows)}</div>`;
}
