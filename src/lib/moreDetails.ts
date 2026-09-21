// Create dialogs show what's needed first; optional fields (.fgrp-more) wait
// behind "More details" — unless the context already filled one in, in which
// case they're shown so nothing prefilled is hidden (docs/ux-conventions.md, Focus).

function isSet(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): boolean {
  if (el instanceof HTMLSelectElement) return el.multiple ? el.selectedOptions.length > 0 : el.selectedIndex > 0;
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return el.checked !== el.defaultChecked;
  return el.value.trim() !== '';
}

/** Call after the dialog's fields are filled for this opening. */
export function foldMoreDetails(formId: string): void {
  const form = document.getElementById(formId);
  if (!form) return;
  const more = [...form.querySelectorAll<HTMLElement>('.fgrp-more')];
  if (!more.length) return;
  let btn = form.querySelector<HTMLButtonElement>('.more-toggle');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-ghost btn-sm more-toggle';
    btn.onclick = () => { form.classList.add('show-more'); btn!.hidden = true; more.find((g) => !g.hidden)?.querySelector<HTMLElement>('input, select, textarea')?.focus(); };
    const grid = more[0].closest('.fg');
    grid?.after(btn);
  }
  const prefilled = more.some((g) => [...g.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')].some(isSet));
  form.classList.toggle('show-more', prefilled);
  btn.textContent = 'More details';
  btn.hidden = prefilled;
}
