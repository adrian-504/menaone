// "No empty boxes": a section with nothing in it collapses to one quiet line
// (its heading, "None yet" and its + New) and sinks below the sections that
// have content, which keep their order. Clicking the line opens it for this
// visit. Company 360 started this; opportunity, project and meeting pages use
// it too.

export interface LayoutSection { el: HTMLElement; empty: boolean }

/** Applies the rule to `sections` (in their natural order) inside `host`,
 * placing them before `anchor` (or at the end when there is none). */
export function collapseEmptySections(host: HTMLElement, sections: LayoutSection[], anchor: HTMLElement | null = null): void {
  const empties: HTMLElement[] = [];
  for (const { el, empty } of sections) {
    el.classList.toggle('is-empty', empty);
    const hd = el.querySelector('.rec-section-hd');
    let hint = el.querySelector<HTMLElement>('.rec-empty-hint');
    if (empty && !hint && hd) {
      hint = document.createElement('span');
      hint.className = 'rec-empty-hint';
      hint.textContent = 'None yet';
      hint.title = 'Click to open this section';
      hint.onclick = () => el.classList.remove('is-empty');
      hd.insertBefore(hint, hd.querySelector('.rec-section-actions'));
    } else if (!empty && hint) {
      hint.remove();
    }
    if (empty) empties.push(el);
    else host.insertBefore(el, anchor);
  }
  for (const el of empties) host.insertBefore(el, anchor);
}

/** The record-page form of the rule: a section is empty when its body is the
 * `.feed-empty` line. Hidden sections are left alone. */
export function sinkEmptySections(host: HTMLElement, els: (HTMLElement | null)[], anchor: HTMLElement | null = null): void {
  collapseEmptySections(host, els.filter((el): el is HTMLElement => !!el && !el.hidden)
    .map((el) => ({ el, empty: !!el.querySelector(':scope > .feed-empty') })), anchor);
}
