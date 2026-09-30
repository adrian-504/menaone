// Motion that belongs to the whole app rather than to one page (owner,
// 30-Sep-2026: "premium apps make every single click feel nicer"). The rules
// are in docs/ux-conventions.md, "Motion"; the timings are the tokens in
// styles.css. Nothing here moves layout: only transform and opacity.
//
// - Dialogs close with a 180 ms fade instead of vanishing, and give focus back
//   to whatever opened them. Every dialog is a .modal-ov toggled with .open, so
//   one observer covers them all without touching the 40-odd close functions.
// - The sidebar's active fill and the segmented switchers' selection travel to
//   the new item (180 ms) instead of jumping: one highlight element per group,
//   moved with transform.

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Dialogs ────────────────────────────────────────────────────────────────

const openers = new WeakMap<Element, HTMLElement>();

function watchDialogs(): void {
  new MutationObserver((records) => {
    for (const r of records) {
      const el = r.target as HTMLElement;
      if (!el.classList?.contains('modal-ov')) continue;
      const wasOpen = (r.oldValue || '').split(/\s+/).includes('open');
      const isOpen = el.classList.contains('open');
      if (isOpen && !wasOpen) {
        el.classList.remove('closing');
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== document.body && !el.contains(active)) openers.set(el, active);
      } else if (!isOpen && wasOpen) {
        if (!reduced()) {
          el.classList.add('closing');
          window.setTimeout(() => el.classList.remove('closing'), 180);
        }
        const opener = openers.get(el);
        openers.delete(el);
        if (opener?.isConnected && !document.querySelector('.modal-ov.open')) opener.focus({ preventScroll: true });
      }
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
}

// ── Travelling highlight ───────────────────────────────────────────────────

const placers = new Set<() => void>();

/** Re-places every highlight — after a tab switch shows segments that were hidden. */
export function refreshHighlights(): void {
  placers.forEach((p) => p());
}

/** Puts one highlight behind `container`'s items and moves it to the active one. */
export function travellingHighlight(container: HTMLElement, itemSelector: string, activeSelector: string): void {
  if (container.dataset.travel) return;
  container.dataset.travel = '1';
  container.classList.add('has-travel');
  const hl = document.createElement('span');
  hl.className = 'travel-hl';
  hl.setAttribute('aria-hidden', 'true');
  container.prepend(hl);
  let shown = false;
  const place = () => {
    const active = [...container.querySelectorAll<HTMLElement>(activeSelector)].find((a) => a.matches(itemSelector) && a.offsetParent !== null);
    if (!active) { hl.style.opacity = '0'; shown = false; return; }
    const c = container.getBoundingClientRect();
    const a = active.getBoundingClientRect();
    const jump = !shown || reduced();
    if (jump) hl.style.transition = 'none';
    hl.style.width = `${a.width}px`;
    hl.style.height = `${a.height}px`;
    hl.style.transform = `translate(${Math.round(a.left - c.left + container.scrollLeft)}px, ${Math.round(a.top - c.top + container.scrollTop)}px)`;
    hl.style.opacity = '1';
    if (jump) { void hl.offsetWidth; hl.style.transition = ''; }
    shown = true;
  };
  new MutationObserver((records) => {
    // Straight from the observer (a microtask after the change): rAF doesn't run in a hidden window.
    if (records.some((r) => r.target !== hl)) place();
  }).observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  new ResizeObserver(() => { shown = false; place(); }).observe(container);
  const placer = () => { if (container.isConnected) place(); else placers.delete(placer); };
  placers.add(placer);
  place();
}

const GROUPS: [string, string, string][] = [
  ['#sidebar .sb-nav', '.sb-item', '.sb-item.active'],
  ['.seg-btns', '.seg-btn', '.seg-btn.active'],
  ['.segmented', 'button', 'button.active'],
];

function attachHighlights(root: ParentNode): void {
  for (const [group, item, active] of GROUPS) {
    root.querySelectorAll<HTMLElement>(group).forEach((c) => travellingHighlight(c, item, active));
  }
}

export function startMotion(): void {
  watchDialogs();
  attachHighlights(document);
  // Segments drawn later (status views, filters) get one too.
  const SEG = '.seg-btns, .segmented';
  new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (n instanceof HTMLElement && (n.matches(SEG) || n.querySelector(SEG))) attachHighlights(n.parentElement || n);
      });
    }
  }).observe(document.body, { subtree: true, childList: true });
}

// ── New items settle in (delight 3) ─────────────────────────────────────────

/** Something the user just added fades up 4 px into place (--dur-base). Only
 * ever called right after a user action, never on a render or a data load. */
export function settleNew(el: Element | null | undefined): void {
  if (!(el instanceof HTMLElement) || reduced()) return;
  el.classList.remove('is-new');
  void el.offsetWidth;
  el.classList.add('is-new');
  const done = () => el.classList.remove('is-new');
  el.addEventListener('animationend', done, { once: true });
  window.setTimeout(done, 400);
}

// ── Rows leave (delight 4) ──────────────────────────────────────────────────

const token = (name: string, fallback: number) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? (v.endsWith('ms') ? n : n * 1000) : fallback;
};

/** A row that is going away fades (--dur-fast) and then closes up (--dur-base,
 * --ease-in), so the rows below slide up instead of jumping. Resolves when it
 * is done — or at once with reduced motion, no animation support, or a table
 * row (which can't shrink) — and never waits on a paused (hidden) window. */
export function collapseRow(el: Element | null | undefined): Promise<void> {
  if (!(el instanceof HTMLElement) || reduced() || typeof el.animate !== 'function') return Promise.resolve();
  const fast = token('--dur-fast', 120);
  const base = token('--dur-base', 180);
  const easeIn = getComputedStyle(document.documentElement).getPropertyValue('--ease-in').trim() || 'ease-in';
  const cs = getComputedStyle(el);
  el.style.pointerEvents = 'none';
  const fade = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fast, easing: easeIn, fill: 'forwards' });
  const settle = (a: Animation, ms: number) => Promise.race([a.finished.then(() => undefined, () => undefined), new Promise<void>((r) => window.setTimeout(r, ms + 60))]);
  return settle(fade, fast).then(() => {
    if (el.tagName === 'TR') return undefined;
    el.style.overflow = 'hidden';
    const close = el.animate([
      { height: `${el.offsetHeight}px`, marginTop: cs.marginTop, marginBottom: cs.marginBottom, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom },
      { height: '0px', marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' },
    ], { duration: base, easing: easeIn, fill: 'forwards' });
    return settle(close, base);
  });
}

/** Every matching row collapses together. */
export function collapseRows(els: Iterable<Element>): Promise<void> {
  return Promise.all([...els].map(collapseRow)).then(() => undefined);
}

// ── Travelling focus in lists (delight 7) ───────────────────────────────────

/** Keyboard moves in a list (↑↓, j k): a focus ring slides to the new row —
 * --dur-fast to a neighbour, --dur-base for a longer jump. Only called from
 * keyboard handlers; the mouse never moves it, and pressing in the list hides it. */
export function keyTravel(row: Element | null | undefined, container?: Element | null): void {
  if (!(row instanceof HTMLElement)) return;
  const list = (container as HTMLElement | null) || (row.closest('.tbl-wrap') as HTMLElement | null) || row.parentElement;
  if (!list) return;
  if (getComputedStyle(list).position === 'static') list.style.position = 'relative';
  let hl = list.querySelector<HTMLElement>(':scope > .key-hl');
  const fresh = !hl;
  if (!hl) {
    hl = document.createElement('span');
    hl.className = 'key-hl';
    hl.setAttribute('aria-hidden', 'true');
    list.prepend(hl);
    list.addEventListener('pointerdown', () => { if (hl) hl.style.opacity = '0'; });
  }
  const l = list.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  const x = Math.round(r.left - l.left + list.scrollLeft);
  const y = Math.round(r.top - l.top + list.scrollTop);
  const prev = Number(hl.dataset.y);
  const hidden = hl.style.opacity === '0';
  hl.classList.toggle('is-jump', Number.isFinite(prev) && Math.abs(y - prev) > r.height * 1.5);
  const jumpNow = fresh || hidden || reduced();
  if (jumpNow) hl.style.transition = 'none';
  hl.style.width = `${Math.round(r.width)}px`;
  hl.style.height = `${Math.round(r.height)}px`;
  hl.style.transform = `translate(${x}px, ${y}px)`;
  hl.dataset.y = String(y);
  hl.style.opacity = '1';
  if (jumpNow) { void hl.offsetWidth; hl.style.transition = ''; }
}

