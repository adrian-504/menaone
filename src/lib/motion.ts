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

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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

