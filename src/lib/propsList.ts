// Read first, edit on demand (docs/ux-conventions.md, "Focus"): a record's
// facts as text. Clicking a value — or Enter on it — turns that one row into
// its usual control; the page's own change handler saves it (same autosave
// and "Saved" flash as before), Esc puts the old value back, leaving the row
// returns it to text. Empty optional values aren't shown until "Edit", which
// shows every field as the form it used to be. Agreement, proposal and the
// record pages' Details panels use it.

import { escHtml, expose } from './utils';

export interface PropField {
  key: string;
  label: string;
  /** Read-mode HTML (escaped by the caller); '' when empty. */
  display: string;
  /** The field's edit control (its existing input, select or textarea, wired to the page's change handler). */
  control?: () => string;
  /** Shown in read mode even when empty (as "Add …"). */
  always?: boolean;
  /** Runs after the control is in the page (company picker, auto-grow…). */
  mount?: (dd: HTMLElement) => void;
}

interface ListState { render: () => void; fields: PropField[] }
const lists = new Map<string, ListState>();
const editAll = new Set<string>();
let editing: { list: string; key: string } | null = null;

export const isEditingAll = (listId: string) => editAll.has(listId);

/** The list's rows. `render` redraws it (the page's own render for that section). */
export function propsListHtml(listId: string, fields: PropField[], render: () => void): string {
  lists.set(listId, { render, fields });
  const all = editAll.has(listId);
  const id = escHtml(listId);
  return fields.map((f) => {
    const k = escHtml(f.key);
    const isEditing = all || (editing?.list === listId && editing.key === f.key);
    if (isEditing && f.control) return `<dt>${escHtml(f.label)}</dt><dd class="pl-edit" data-pl="${id}" data-key="${k}">${f.control()}</dd>`;
    if (!f.display && !f.always) return '';
    if (!f.control) return `<dt>${escHtml(f.label)}</dt><dd class="pl-val pl-ro">${f.display || '<span class="rec-muted">—</span>'}</dd>`;
    return `<dt>${escHtml(f.label)}</dt><dd class="pl-val${f.display ? '' : ' is-empty'}" tabindex="0" role="button" aria-label="Edit ${escHtml(f.label)}" data-pl="${id}" data-key="${k}"
      onclick="if(!event.target.closest('a,button'))propsEdit('${id}','${k}')" onkeydown="if(event.key==='Enter'&&event.target===this){event.preventDefault();propsEdit('${id}','${k}')}">${f.display || `<span class="pl-add">Add ${escHtml(f.label.toLowerCase())}</span>`}</dd>`;
  }).join('');
}

/** Wires the controls a list just rendered: focus, Esc, leaving the row. Call after putting the HTML in the page. */
export function mountPropsList(listId: string): void {
  const state = lists.get(listId);
  if (!state) return;
  for (const dd of document.querySelectorAll<HTMLElement>(`dd.pl-edit[data-pl="${CSS.escape(listId)}"]`)) {
    const field = state.fields.find((f) => f.key === dd.dataset.key);
    field?.mount?.(dd);
    if (editAll.has(listId)) continue;
    const control = dd.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea');
    if (!control) continue;
    const original = control.value;
    // A change is saved by the page, which then redraws: the row is text again.
    dd.addEventListener('change', () => { editing = null; }, true);
    control.focus();
    if (control instanceof HTMLInputElement && ['text', 'url', 'number', 'email'].includes(control.type)) control.select();
    control.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      control.value = original;
      done(listId, true);
    });
    // Leaving the row without a change returns it to text; a change saves
    // through the page's handler, which redraws the page anyway.
    dd.addEventListener('focusout', () => {
      window.setTimeout(() => {
        if (!dd.isConnected || dd.contains(document.activeElement)) return;
        if (document.activeElement?.closest('.company-selector-popover')) return;
        if (editing?.list === listId && editing.key === dd.dataset.key) done(listId, false);
      }, 180);
    });
  }
}

// A click anywhere outside the row being edited also returns it to text
// (focus events alone miss clicks on non-focusable parts of the page).
document.addEventListener('mousedown', (e) => {
  if (!editing) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest(`dd.pl-edit[data-pl="${CSS.escape(editing.list)}"]`) || target?.closest('.company-selector-popover')) return;
  const list = editing.list;
  window.setTimeout(() => { if (editing?.list === list) done(list, false); }, 0);
}, true);

function done(listId: string, refocus: boolean): void {
  const key = editing?.key;
  editing = null;
  lists.get(listId)?.render();
  if (refocus && key) document.querySelector<HTMLElement>(`dd.pl-val[data-pl="${CSS.escape(listId)}"][data-key="${CSS.escape(key)}"]`)?.focus();
}

export function propsEdit(listId: string, key: string): void {
  const state = lists.get(listId);
  if (!state) return;
  editing = { list: listId, key };
  state.render();
}
expose('propsEdit', propsEdit);

/** Edit shows every field as the form; Done returns to reading. */
export function propsEditAll(listId: string, on?: boolean): void {
  const next = on ?? !editAll.has(listId);
  if (next) editAll.add(listId); else editAll.delete(listId);
  editing = null;
  lists.get(listId)?.render();
}
expose('propsEditAll', propsEditAll);

/** The section-header button for a list: "Edit" / "Done". */
export function propsEditButton(listId: string): string {
  const on = editAll.has(listId);
  return `<button class="btn-ghost btn-sm" onclick="propsEditAll('${escHtml(listId)}')" aria-pressed="${on}">${on ? 'Done' : 'Edit'}</button>`;
}

/** Ends a one-row edit (for saves that don't go through a change event, e.g. the company picker). */
export function endPropsEdit(): void {
  editing = null;
}

/** Forgets editing state when a different record opens. */
export function resetPropsLists(prefix: string): void {
  for (const id of [...editAll]) if (id.startsWith(prefix)) editAll.delete(id);
  if (editing?.list.startsWith(prefix)) editing = null;
}
