// List pages show search and at most two filters; the rest sit behind one
// "Filters" button that counts how many of them are in use, with Clear
// (docs/ux-conventions.md, Focus). The controls are moved, not rebuilt: their
// ids, handlers and remembered values (rememberFilters.ts) all keep working.

import { escHtml } from './utils';

type Control = HTMLInputElement | HTMLSelectElement;

function isActive(el: Control): boolean {
  if (el instanceof HTMLSelectElement) return el.selectedIndex > 0 && el.value !== '';
  if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
  return el.value.trim() !== '';
}

function reset(el: Control): void {
  if (el instanceof HTMLSelectElement) el.selectedIndex = 0;
  else if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
  else el.value = '';
}

const bars: (() => void)[] = [];

/**
 * @param bar  the list's filter bar
 * @param keep ids of the (at most two) filters that stay visible beside search
 */
export function foldFilterBar(bar: HTMLElement | null, keep: string[]): void {
  if (!bar || bar.querySelector('.fbar-more')) return;
  // Everything that filters, other than search and the kept ones, moves into the panel.
  const pageClear = [...bar.children].find((n): n is HTMLButtonElement => n instanceof HTMLButtonElement && /^\s*clear\s*$/i.test(n.textContent || ''));
  const moving = [...bar.children].filter((node): node is HTMLElement => {
    if (!(node instanceof HTMLElement) || node === pageClear) return false;
    if (node.classList.contains('f-search') || keep.includes(node.id)) return false;
    return node.matches('select, input, label, .fbar-range');
  });
  if (!moving.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'fbar-more';
  wrap.innerHTML = `<button type="button" class="btn-secondary btn-sm fbar-more-btn" aria-expanded="false" aria-haspopup="true">Filters<span class="fbar-count"></span></button>
    <button type="button" class="btn-ghost btn-sm fbar-clear" hidden>Clear</button>
    <div class="fbar-panel" role="group" aria-label="More filters" hidden></div>`;
  const panel = wrap.querySelector<HTMLElement>('.fbar-panel')!;
  const btn = wrap.querySelector<HTMLButtonElement>('.fbar-more-btn')!;
  const clear = wrap.querySelector<HTMLButtonElement>('.fbar-clear')!;
  // The page's own Clear (it also resets its search and state) takes our place; without one, ours clears the bar.
  if (pageClear) { pageClear.className = 'btn-ghost btn-sm fbar-clear'; pageClear.hidden = true; clear.replaceWith(pageClear); }
  for (const node of moving) {
    const label = node.getAttribute('aria-label') || node.getAttribute('title') || '';
    const row = document.createElement('div');
    row.className = 'fbar-panel-row';
    if (label && node.matches('select')) row.innerHTML = `<span class="fbar-panel-label">${escHtml(label)}</span>`;
    row.appendChild(node);
    panel.appendChild(row);
  }
  bar.appendChild(wrap);
  const controls = () => [...panel.querySelectorAll<Control>('select, input')];
  const clearBtn = pageClear || clear;
  const allControls = () => [...bar.querySelectorAll<Control>('select, input')];
  const update = () => {
    const n = controls().filter(isActive).length;
    btn.querySelector('.fbar-count')!.textContent = n ? ` · ${n}` : '';
    btn.classList.toggle('has-active', n > 0);
    clearBtn.hidden = !allControls().some(isActive);
  };
  const open = (on: boolean) => { panel.hidden = !on; btn.setAttribute('aria-expanded', String(on)); if (on) panel.querySelector<HTMLElement>('select, input')?.focus(); };
  btn.addEventListener('click', () => open(panel.hidden === true));
  if (pageClear) pageClear.addEventListener('click', () => window.setTimeout(update, 0));
  else clear.addEventListener('click', () => {
    for (const el of allControls()) if (isActive(el)) { reset(el); el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('input', { bubbles: true })); }
    update();
  });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { open(false); btn.focus(); } });
  document.addEventListener('mousedown', (e) => { if (!panel.hidden && !wrap.contains(e.target as Node)) open(false); });
  bar.addEventListener('change', update);
  bar.addEventListener('input', update);
  bars.push(update);
  // Remembered values arrive when the page first renders its options.
  window.setTimeout(update, 0);
  window.setTimeout(update, 1500);
}

/** Recounts every folded bar (after a page restores or clears filters in code). */
export function refreshFilterBars(): void {
  for (const update of bars) update();
}
