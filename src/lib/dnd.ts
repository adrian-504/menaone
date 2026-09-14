// Drag and drop for the whole app, built on pointer events rather than the
// HTML5 drag API (which the desktop webview's file-drop handling interferes
// with, and which can't show a proper preview or auto-scroll).
//
// Markup declares what can move and where it can land:
//   <div data-drag-kind="task" data-drag-id="12">            a draggable item
//   <button data-drop="task-list" data-drop-value="today">   a drop target
//   <div data-sort="task-order" data-drop-value="…">          a list you can
//        (its children with data-drag-id)                     reorder by dropping between items
//
// Modules register what each kind and target does. A press becomes a drag
// only after the pointer moves a few pixels, so clicks keep working.

export interface DragPayload {
  kind: string;
  ids: number[];
  source: HTMLElement;
}

export interface DropInfo {
  /** `data-drop-value` of the target. */
  value: string;
  target: HTMLElement;
  /** For sortable lists: the item the drop lands before (null = at the end). */
  beforeId: number | null;
}

export interface DragSource {
  /** Everything that moves when this element is dragged (e.g. the whole selection). */
  ids?: (id: number, el: HTMLElement) => number[];
  /** Preview text, e.g. "3 tasks". Defaults to the element's own look. */
  label?: (ids: number[], el: HTMLElement) => string | null;
}

export interface DropTarget {
  accepts: string[];
  /** Return false to show the target as unavailable for this payload. */
  canDrop?: (payload: DragPayload, value: string) => boolean;
  onDrop: (payload: DragPayload, info: DropInfo) => void;
}

const sources = new Map<string, DragSource>();
const targets = new Map<string, DropTarget>();

export function registerDragSource(kind: string, source: DragSource = {}): void {
  sources.set(kind, source);
}

export function registerDropTarget(type: string, target: DropTarget): void {
  targets.set(type, target);
}

const THRESHOLD = 5;
const EDGE = 56;

interface Session {
  payload: DragPayload;
  startX: number;
  startY: number;
  pointerId: number;
  started: boolean;
  ghost: HTMLElement | null;
  offsetX: number;
  offsetY: number;
  over: { el: HTMLElement; type: string; sortable: boolean } | null;
  beforeId: number | null;
  lastX: number;
  lastY: number;
  scrollRaf: number;
}

let session: Session | null = null;
let line: HTMLElement | null = null;

function isFormControl(el: HTMLElement): boolean {
  return !!el.closest('input, textarea, select, [contenteditable="true"], .cm-editor, .task-check, .tag-chip-input');
}

document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.ctrlKey || session) return;
  const target = e.target as HTMLElement;
  const el = target.closest<HTMLElement>('[data-drag-kind]');
  if (!el || isFormControl(target)) return;
  const kind = el.dataset.dragKind!;
  const id = Number(el.dataset.dragId);
  if (!sources.has(kind) || !Number.isFinite(id)) return;
  const src = sources.get(kind)!;
  const ids = src.ids ? src.ids(id, el) : [id];
  session = {
    payload: { kind, ids, source: el }, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, started: false,
    ghost: null, offsetX: 0, offsetY: 0, over: null, beforeId: null, lastX: e.clientX, lastY: e.clientY, scrollRaf: 0,
  };
}, true);

document.addEventListener('pointermove', (e) => {
  if (!session || e.pointerId !== session.pointerId) return;
  session.lastX = e.clientX;
  session.lastY = e.clientY;
  if (!session.started) {
    if (Math.hypot(e.clientX - session.startX, e.clientY - session.startY) < THRESHOLD) return;
    begin(session);
  }
  e.preventDefault();
  moveGhost(session);
  hitTest(session);
});

document.addEventListener('pointerup', (e) => {
  if (!session || e.pointerId !== session.pointerId) return;
  const s = session;
  if (s.started) {
    finish(s, true);
    // The release shouldn't also count as a click on whatever is underneath.
    const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
  }
  session = null;
});

document.addEventListener('pointercancel', () => { if (session?.started) finish(session, false); session = null; });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && session?.started) { e.stopPropagation(); e.preventDefault(); finish(session, false); session = null; }
}, true);
// Native drags (text, images) would fight with ours.
document.addEventListener('dragstart', (e) => {
  if ((e.target as HTMLElement).closest?.('[data-drag-kind]')) e.preventDefault();
});

function begin(s: Session): void {
  s.started = true;
  const src = s.payload.source;
  const rect = src.getBoundingClientRect();
  const label = sources.get(s.payload.kind)?.label?.(s.payload.ids, src) ?? null;
  const ghost = document.createElement('div');
  ghost.className = 'dnd-ghost';
  if (label) {
    ghost.classList.add('dnd-ghost-label');
    ghost.textContent = label;
    s.offsetX = -14;
    s.offsetY = -14;
  } else {
    const clone = src.cloneNode(true) as HTMLElement;
    // The preview is a copy: no ids, and not itself a draggable or drop target.
    for (const n of [clone, ...clone.querySelectorAll<HTMLElement>('*')]) {
      for (const attr of ['id', 'data-drag-kind', 'data-drag-id', 'data-drop', 'data-sort', 'onclick']) n.removeAttribute(attr);
    }
    clone.classList.remove('sel', 'open', 'dnd-source');
    ghost.appendChild(clone);
    ghost.style.width = `${Math.min(rect.width, 420)}px`;
    s.offsetX = Math.min(s.startX - rect.left, 400);
    s.offsetY = s.startY - rect.top;
  }
  if (s.payload.ids.length > 1) {
    const badge = document.createElement('span');
    badge.className = 'dnd-count';
    badge.textContent = String(s.payload.ids.length);
    ghost.appendChild(badge);
  }
  document.body.appendChild(ghost);
  s.ghost = ghost;
  document.body.classList.add('dnd-active');
  for (const id of s.payload.ids) {
    document.querySelectorAll<HTMLElement>(`[data-drag-kind="${s.payload.kind}"][data-drag-id="${id}"]`).forEach((n) => n.classList.add('dnd-source'));
  }
  window.getSelection()?.removeAllRanges();
  autoScroll(s);
}

function moveGhost(s: Session): void {
  if (s.ghost) s.ghost.style.transform = `translate(${s.lastX - s.offsetX}px, ${s.lastY - s.offsetY}px)`;
}

function clearOver(s: Session): void {
  s.over?.el.classList.remove('drop-target', 'drop-denied');
  s.over = null;
  s.beforeId = null;
  if (line) line.style.display = 'none';
}

function hitTest(s: Session): void {
  const under = document.elementFromPoint(s.lastX, s.lastY) as HTMLElement | null;
  let el: HTMLElement | null = under;
  let found: { el: HTMLElement; type: string; sortable: boolean } | null = null;
  while (el && el !== document.body) {
    const drop = el.dataset?.drop;
    const sort = el.dataset?.sort;
    const type = drop || sort;
    if (type) {
      const t = targets.get(type);
      if (t && t.accepts.includes(s.payload.kind)) { found = { el, type, sortable: !!sort && !drop }; break; }
    }
    el = el.parentElement;
  }
  if (!found) { clearOver(s); return; }
  if (s.over?.el !== found.el) {
    clearOver(s);
    s.over = found;
    const t = targets.get(found.type)!;
    const ok = t.canDrop ? t.canDrop(s.payload, found.el.dataset.dropValue || '') : true;
    found.el.classList.add(ok ? 'drop-target' : 'drop-denied');
  }
  if (found.sortable) placeLine(s, found.el);
}

/** Works out which item the pointer is between and draws the insertion line. */
function placeLine(s: Session, container: HTMLElement): void {
  const items = [...container.querySelectorAll<HTMLElement>(':scope > [data-drag-id], :scope > * > [data-drag-id]')]
    .filter((n) => n.closest('[data-sort]') === container);
  let before: HTMLElement | null = null;
  for (const item of items) {
    const r = item.getBoundingClientRect();
    if (s.lastY < r.top + r.height / 2) { before = item; break; }
  }
  s.beforeId = before ? Number(before.dataset.dragId) : null;
  if (!line) {
    line = document.createElement('div');
    line.className = 'dnd-line';
    document.body.appendChild(line);
  }
  const ref = before ?? items[items.length - 1];
  const box = (ref ?? container).getBoundingClientRect();
  const y = before ? box.top - 1 : ref ? box.bottom + 1 : box.top + 8;
  line.style.display = 'block';
  line.style.left = `${box.left + 6}px`;
  line.style.width = `${Math.max(40, box.width - 12)}px`;
  line.style.top = `${y}px`;
}

function scrollableAt(x: number, y: number): HTMLElement | null {
  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  while (el && el !== document.body) {
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return null;
}

function autoScroll(s: Session): void {
  const tick = () => {
    if (!s.started) return;
    const box = scrollableAt(s.lastX, s.lastY);
    const top = box ? box.getBoundingClientRect().top : 44;
    const bottom = box ? box.getBoundingClientRect().bottom : window.innerHeight;
    let dy = 0;
    if (s.lastY < top + EDGE) dy = -Math.ceil(((top + EDGE - s.lastY) / EDGE) * 14);
    else if (s.lastY > bottom - EDGE) dy = Math.ceil(((s.lastY - (bottom - EDGE)) / EDGE) * 14);
    if (dy) {
      if (box) box.scrollTop += dy; else window.scrollBy(0, dy);
      hitTest(s);
    }
    s.scrollRaf = requestAnimationFrame(tick);
  };
  s.scrollRaf = requestAnimationFrame(tick);
}

function finish(s: Session, drop: boolean): void {
  cancelAnimationFrame(s.scrollRaf);
  const over = s.over;
  const beforeId = s.beforeId;
  s.started = false;
  s.ghost?.remove();
  document.body.classList.remove('dnd-active');
  document.querySelectorAll('.dnd-source').forEach((n) => n.classList.remove('dnd-source'));
  clearOver(s);
  if (!drop || !over) return;
  const t = targets.get(over.type);
  const value = over.el.dataset.dropValue || '';
  if (!t || (t.canDrop && !t.canDrop(s.payload, value))) return;
  t.onDrop(s.payload, { value, target: over.el, beforeId: over.sortable ? beforeId : null });
}

/** Moves `ids` to sit before `beforeId` (or at the end) within `order`. */
export function reorder<T extends { id: number }>(order: T[], ids: number[], beforeId: number | null): T[] {
  const moving = order.filter((x) => ids.includes(x.id));
  const rest = order.filter((x) => !ids.includes(x.id));
  const at = beforeId == null ? rest.length : rest.findIndex((x) => x.id === beforeId);
  rest.splice(at < 0 ? rest.length : at, 0, ...moving);
  return rest;
}
