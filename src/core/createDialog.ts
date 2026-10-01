// One shell for every "New …" dialog (task, meeting, promise, company,
// contact, opportunity, agreement, project): a tinted tile, an eyebrow, the
// kind in Saira, keyboard hints on the left of the footer and one primary on
// its right. ⌘↵ creates; ⌘⇧↵ creates and opens the next one with the client
// and the project kept. Each dialog keeps its own form and its own saving; the
// shell only dresses it when it opens (lib/createDialog.ts says how).

import { expose } from '../lib/utils';
import { icon } from '../lib/icons';
import { CREATE_KINDS, carryOver, dialogHead, dialogHints, type CreateKind } from '../lib/createDialog';
import { registerKey } from './keys';

const w = () => window as any;
const field = (form: HTMLFormElement, name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;

/** Dresses a dialog as it opens: the header from the title its opener wrote, the hints in the footer. */
function dress(k: CreateKind): void {
  const ov = document.getElementById(k.modal);
  const modal = ov?.querySelector<HTMLElement>('.modal');
  const hd = modal?.querySelector<HTMLElement>('.modal-hd');
  const title = hd?.querySelector<HTMLElement>('.modal-title');
  if (!modal || !hd || !title) return;
  modal.classList.add('cd');
  // The opener wrote "New task" / "Edit meeting": that becomes the eyebrow and the kind.
  const raw = title.dataset.raw && title.textContent === title.dataset.shown ? title.dataset.raw : title.textContent || '';
  const head = dialogHead(raw, k.kind);
  title.dataset.raw = raw;
  title.dataset.shown = head.title;
  title.textContent = head.title;
  if (!hd.querySelector('.cd-tile')) hd.insertAdjacentHTML('afterbegin', `<span class="cd-tile" style="--c:${k.tint}" aria-hidden="true">${icon(k.icon, 18)}</span><span class="cd-eyebrow"></span>`);
  const eyebrow = hd.querySelector<HTMLElement>('.cd-eyebrow');
  if (eyebrow) eyebrow.textContent = head.eyebrow;
  const editing = head.eyebrow === 'Edit';
  modal.dataset.editing = String(editing);
  const fact = modal.querySelector<HTMLElement>('form .fact');
  if (fact) {
    let hints = fact.querySelector<HTMLElement>('.cd-hints');
    if (!hints) { hints = document.createElement('span'); hints.className = 'cd-hints'; fact.prepend(hints); }
    hints.textContent = dialogHints(editing);
  }
}

/** The topmost open create dialog, with its kind. */
function openCreate(): { k: CreateKind; form: HTMLFormElement; modal: HTMLElement } | null {
  const open = [...document.querySelectorAll<HTMLElement>('.modal-ov.open')];
  const top = open[open.length - 1];
  const k = top && CREATE_KINDS.find((x) => x.modal === top.id);
  const form = top?.querySelector<HTMLFormElement>('form');
  return k && form && top ? { k, form, modal: top } : null;
}

/** ⌘↵: the dialog's own primary. */
function submitOpen(): boolean {
  const c = openCreate();
  if (!c) return false;
  c.form.requestSubmit();
  return true;
}

/** ⌘⇧↵: creates, then opens the next one with the client and the project as they were. Nothing reopens when the
 * dialog stayed open (a required field was empty) or it was an edit. */
function submitAndAddAnother(): boolean {
  const c = openCreate();
  if (!c) return false;
  if (c.modal.querySelector<HTMLElement>('.modal')?.dataset.editing === 'true') { c.form.requestSubmit(); return true; }
  const values: Record<string, string> = {};
  for (const name of c.k.keep) values[name] = field(c.form, name)?.value ?? '';
  const kept = carryOver(values, c.k);
  c.form.requestSubmit();
  // Saving can take a moment (a promise is written by the backend): wait for the dialog to close, then open the next.
  let tries = 0;
  const next = () => {
    if (c.modal.classList.contains('open')) { if (++tries < 30) window.setTimeout(next, 80); return; }
    const open = w()[c.k.open];
    if (typeof open !== 'function') return;
    if (c.k.openWithNull) open(null); else open();
    window.setTimeout(() => {
      for (const [name, value] of Object.entries(kept)) {
        const el = field(c.form, name);
        if (!el) continue;
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      c.form.querySelector<HTMLElement>('input:not([type=hidden]):not([type=date]), textarea')?.focus();
    }, 80);
  };
  window.setTimeout(next, 0);
  return true;
}
expose('createAndAddAnother', submitAndAddAnother);

registerKey({ scope: 'dialog', combo: 'mod+enter', when: () => !!openCreate(), run: () => submitOpen() });
registerKey({ scope: 'dialog', combo: 'mod+shift+enter', when: () => !!openCreate(), run: () => submitAndAddAnother() });

/** Each create dialog is dressed when it opens (its opener has written the title by then). */
export function startCreateDialogs(): void {
  for (const k of CREATE_KINDS) {
    const ov = document.getElementById(k.modal);
    if (!ov) continue;
    let was = ov.classList.contains('open');
    new MutationObserver(() => {
      const now = ov.classList.contains('open');
      if (now && !was) dress(k);
      was = now;
    }).observe(ov, { attributes: true, attributeFilter: ['class'] });
    // An opener may write the title after it shows the dialog: follow it.
    const title = ov.querySelector('.modal-title');
    if (title) new MutationObserver(() => { if (ov.classList.contains('open') && (title as HTMLElement).dataset.shown !== title.textContent) dress(k); }).observe(title, { childList: true, characterData: true, subtree: true });
  }
}
