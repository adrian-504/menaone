// Shared interface components that are built in code rather than static
// markup: toasts (with an optional action such as Undo), empty states and
// loading skeletons. Styles live under "Design system" in styles.css; every
// variant is on the dev-only Component Gallery page.
//
// Imports only icons.ts (which imports nothing): db.ts and other low-level
// modules use these too.

import { icon } from './icons';
import { UNDO_MS, countdownLeft, stackAfterAdd, toastParts } from './chromeKit';

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

const TONE_ICON: Record<Tone, string> = { neutral: 'flag', success: 'check', error: 'warning' };

/** Shows a short message as a card in the stack at the bottom left — the same navy card and the same stack as an
 * undo (1.64: one toast style), three at most between them. Replaces `alert()`: it never blocks, and repeated
 * identical messages don't pile up. A notice with an action ("… · Review") carries it where Undo sits. */
export function toast(message: string, opts: ToastOptions = {}): { dismiss: () => void } {
  const tone = opts.tone ?? 'neutral';
  const root = undoStack();
  const existing = [...root.children].find((c) => (c as HTMLElement).dataset.message === message) as HTMLElement | undefined;
  existing?.remove();

  const el = document.createElement('div');
  el.className = `toast toast-card toast-${tone}`;
  el.dataset.message = message;
  el.innerHTML = `<span class="undo-tile is-${tone}" aria-hidden="true">${icon(TONE_ICON[tone], 14)}</span>
    <div class="toast-body"><div class="toast-msg">${esc(message)}</div>${opts.detail ? `<div class="toast-detail">${esc(opts.detail)}</div>` : ''}</div>`
    + (opts.action ? `<button class="toast-action toast-go">${esc(opts.action.label)}</button>` : '')
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
  live();
  root.appendChild(el);
  trimStack(root);

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
// Bottom-left, for 7 s each, three at most (the oldest leaves first); ⌘Z runs
// the newest (unless you're typing, where ⌘Z undoes the text). Each is a navy
// card: a tile for what was done, a title and one line about it, a coral Undo,
// and a coral bar that runs out with the time left (lib/chromeKit.ts).

interface UndoEntry { el: HTMLElement; run: () => void; timer: number; frame: number }
let undos: UndoEntry[] = [];

function dropUndo(u: UndoEntry): void {
  window.clearTimeout(u.timer);
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(u.frame);
  undos = undos.filter((x) => x !== u);
  if (!u.el.isConnected) return;
  u.el.classList.add('leaving');
  window.setTimeout(() => u.el.remove(), 180);
}

/** Only the cards still on the page count (a page that was redrawn under them takes them with it). */
function live(): void {
  for (const u of undos.filter((x) => !x.el.isConnected)) dropUndo(u);
}

/** Three cards at most in the stack, notices and undos together: the oldest leaves first. */
function trimStack(root: HTMLElement): void {
  const cards = [...root.children].filter((c) => !c.classList.contains('leaving')) as HTMLElement[];
  for (const old of cards.slice(0, Math.max(0, cards.length - 3))) {
    const u = undos.find((x) => x.el === old);
    if (u) dropUndo(u);
    else { old.classList.add('leaving'); window.setTimeout(() => old.remove(), 180); }
  }
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

/** "Task deleted · Undo" — the pattern for every reversible action. `meta.detail` is the line under the title (a
 * message written "Title: what" is split the same way); `meta.icon` is the tile's icon (a tick unless said). */
export function undoToast(message: string, undo: () => void, ms = UNDO_MS, also?: { label: string; run: () => void }, meta: { detail?: string; icon?: string } = {}): void {
  const parts = toastParts(message, meta.detail);
  const el = document.createElement('div');
  el.className = 'toast toast-card toast-undo';
  // `also`: the step that usually follows (after signing several: "Mark service started"), beside Undo.
  el.innerHTML = `<span class="undo-tile${meta.icon && meta.icon !== 'check' ? ' is-coral' : ''}" aria-hidden="true">${icon(meta.icon || 'check', 14)}</span>
    <div class="toast-body"><div class="toast-msg">${esc(parts.title)}</div>${parts.meta ? `<div class="toast-detail">${esc(parts.meta)}</div>` : ''}</div>
    ${also ? `<button class="toast-action toast-also">${esc(also.label)}</button>` : ''}<button class="toast-action toast-undo-btn">Undo <kbd>⌘Z</kbd></button><button class="toast-close" aria-label="Dismiss">×</button>
    <i class="undo-bar" aria-hidden="true"></i>`;
  const entry: UndoEntry = { el, run: () => { dropUndo(entry); undo(); }, timer: 0, frame: 0 };
  // The bar shows the time left, and stops while the pointer is on the card.
  const bar = el.querySelector<HTMLElement>('.undo-bar');
  const count = (window_: number) => {
    const started = Date.now();
    window.clearTimeout(entry.timer);
    entry.timer = window.setTimeout(() => dropUndo(entry), window_);
    if (typeof requestAnimationFrame !== 'function') return;
    cancelAnimationFrame(entry.frame);
    const tick = () => {
      const left = countdownLeft(started, Date.now(), window_);
      bar?.style.setProperty('--left', String(left));
      if (left > 0 && el.isConnected) entry.frame = requestAnimationFrame(tick);
    };
    tick();
  };
  el.querySelector('.toast-undo-btn')?.addEventListener('click', entry.run);
  if (also) el.querySelector('.toast-also')?.addEventListener('click', () => { dropUndo(entry); also.run(); });
  el.querySelector('.toast-close')?.addEventListener('click', () => dropUndo(entry));
  el.addEventListener('mouseenter', () => { window.clearTimeout(entry.timer); if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(entry.frame); });
  el.addEventListener('mouseleave', () => count(2500));
  live();
  undoStack().appendChild(el);
  const { keep, drop } = stackAfterAdd(undos, entry);
  undos = keep;
  for (const old of drop) dropUndo(old);
  trimStack(undoStack());
  count(ms);
}

/** Does it now, offers Undo for 7 s. */
export function withUndo<T>(label: string, commit: () => T, undo: () => void): T {
  const out = commit();
  undoToast(label, undo);
  return out;
}

/** The undo on screen, if any (for tests and ⌘Z). */
/** The newest undo still on screen (what ⌘Z runs), or null. */
export function pendingUndo(): (() => void) | null {
  live();
  return undos.length ? undos[undos.length - 1].run : null;
}

// ⌘Z is a registered key (core/appKeys.ts).

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
