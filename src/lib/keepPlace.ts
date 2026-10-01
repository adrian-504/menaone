// Keeping your place through a redraw (1.64). A row action — Followed up,
// Nudge, a status change — redraws the whole list; the page must stay where
// it is and the keyboard must stay on the row you acted on. `keepPlace` wraps
// a redraw: it notes the scroll position and where the focus is (which row,
// which control in it), redraws, and puts both back. A row that left the list
// hands the focus to the row that took its place.

/** What marks a list row, in the order tried. */
const ROW_ATTRS = ['data-row-id', 'data-proposal-id', 'data-id', 'data-company-id', 'data-contact-id', 'data-project-id'];
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface FocusAddress {
  /** The focused element's own id, when it has one. */
  id?: string;
  /** The list it sits in: the nearest ancestor with an id. */
  scope?: string;
  /** Its row: the attribute that names it, and the value. */
  attr?: string;
  value?: string;
  /** Which of the row's controls (in document order); -1 for the row itself. */
  control?: number;
  /** The row's place among the list's rows, for when the row itself is gone. */
  rowIndex?: number;
}

const rowOf = (el: Element): { row: Element; attr: string } | null => {
  for (const attr of ROW_ATTRS) { const row = el.closest(`[${attr}]`); if (row) return { row, attr }; }
  return null;
};

/** Where the focus is, in terms that survive a redraw. Null when nothing (or only the page) is focused. */
export function focusAddress(el: Element | null): FocusAddress | null {
  if (!el || el === document.body || el === document.documentElement) return null;
  if (el.id) return { id: el.id };
  const hit = rowOf(el);
  if (!hit) return null;
  const { row, attr } = hit;
  const scopeEl = row.parentElement?.closest('[id]') ?? null;
  const rows = [...(scopeEl ?? document).querySelectorAll(`[${attr}]`)];
  return {
    scope: scopeEl?.id, attr, value: row.getAttribute(attr) ?? '',
    control: el === row ? -1 : [...row.querySelectorAll(FOCUSABLE)].indexOf(el),
    rowIndex: rows.indexOf(row),
  };
}

/** The element an address points at now: the same control in the same row; the row itself when the control is gone;
 * the row that took its place when the row is gone. Null when there is nothing to land on. */
export function findFocus(a: FocusAddress | null): HTMLElement | null {
  if (!a) return null;
  if (a.id) return document.getElementById(a.id);
  if (!a.attr) return null;
  const scope: ParentNode = (a.scope && document.getElementById(a.scope)) || document;
  const rows = [...scope.querySelectorAll<HTMLElement>(`[${a.attr}]`)];
  if (!rows.length) return null;
  const row = rows.find((r) => r.getAttribute(a.attr!) === a.value) ?? rows[Math.min(Math.max(a.rowIndex ?? 0, 0), rows.length - 1)];
  const controls = [...row.querySelectorAll<HTMLElement>(FOCUSABLE)];
  if (a.control != null && a.control >= 0 && controls[a.control]) return controls[a.control];
  return row.matches(FOCUSABLE) ? row : controls[controls.length - 1] ?? null;
}

let keeping = false;

/** Redraw without losing your place: the scroll position and the keyboard focus are as they were. `settle` also
 * checks one frame later (a redraw that finishes laying out late), unless you moved to another page meanwhile. */
export function keepPlace(render: () => void, o: { settle?: () => string } = {}): void {
  if (keeping || typeof window === 'undefined') { render(); return; }
  keeping = true;
  const y = window.scrollY;
  const address = focusAddress(document.activeElement);
  const where = o.settle?.();
  try { render(); } finally { keeping = false; }
  const restore = () => {
    if (window.scrollY !== y) window.scrollTo(0, y);
    const lost = !document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected;
    if (address && lost) findFocus(address)?.focus({ preventScroll: true });
  };
  restore();
  if (o.settle && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { if (o.settle!() === where) restore(); });
}
