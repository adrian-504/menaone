// Shared interface components that are built in code rather than static
// markup: toasts (with an optional action such as Undo), empty states and
// loading skeletons. Styles live under "Design system" in styles.css; every
// variant is on the dev-only Component Gallery page.
//
// No imports on purpose: db.ts and other low-level modules use these too.

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
    window.setTimeout(() => el.remove(), 160);
  };
  el.querySelector('.toast-close')?.addEventListener('click', dismiss);
  if (opts.action) {
    const { run } = opts.action;
    el.querySelector('.toast-action')?.addEventListener('click', () => { dismiss(); run(); });
  }
  root.appendChild(el);
  while (root.children.length > 3) root.firstElementChild?.remove();

  const duration = opts.duration ?? (tone === 'error' ? 8000 : opts.action ? 6000 : 3500);
  if (duration > 0) {
    timer = window.setTimeout(dismiss, duration);
    el.addEventListener('mouseenter', () => window.clearTimeout(timer));
    el.addEventListener('mouseleave', () => { timer = window.setTimeout(dismiss, 2500); });
  }
  return { dismiss };
}

/** "Task deleted · Undo" — the pattern for reversible deletes. */
export function undoToast(message: string, undo: () => void): void {
  toast(message, { action: { label: 'Undo', run: undo } });
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
    + (o.icon ? `<span class="empty-state-icon" data-icon="${esc(o.icon)}" data-icon-size="${o.compact ? 18 : 22}"></span>` : '')
    + `<div class="empty-state-title">${esc(o.title)}</div>`
    + (o.body ? `<div class="empty-state-body">${esc(o.body)}</div>` : '')
    + (o.action ? `<button class="btn-secondary empty-state-action" onclick="${esc(o.action.onclick)}">${esc(o.action.label)}</button>` : '')
    + `</div>`;
}

/** Placeholder rows shown while a view loads. */
export function skeleton(rows = 4, variant: 'rows' | 'cards' = 'rows'): string {
  const item = variant === 'cards'
    ? '<div class="skel-card"><div class="skel skel-line w60"></div><div class="skel skel-line w90"></div><div class="skel skel-line w40"></div></div>'
    : '<div class="skel-row"><div class="skel skel-dot"></div><div class="skel skel-line w70"></div><div class="skel skel-line w20"></div></div>';
  return `<div class="skel-wrap skel-${variant}" aria-busy="true" aria-label="Loading">${item.repeat(rows)}</div>`;
}
