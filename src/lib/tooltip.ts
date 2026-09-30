// Tooltips (owner, 30-Sep-2026: "it's the small things"). One component for the
// whole app instead of the slow native title tooltip: `data-tip="Collapse
// sidebar"` and, when there is a shortcut, `data-key="⌘\"`. An icon-only button
// with only an aria-label gets its label as the tip. Appears after 600 ms of
// hover below the element (above when there's no room), fades and rises 4 px in
// --dur-fast; hides on press, leave or scroll; one at a time.

import { menuPlacement, visibleBounds } from './utils';
import { keysFor } from '../core/keys';

const DELAY = 600;
let tipEl: HTMLElement | null = null;
let timer = 0;
let current: HTMLElement | null = null;

/** The label for an element, or null when it has none to show. */
export function tipFor(el: Element): { tip: string; key: string | null } | null {
  const tip = el.getAttribute('data-tip');
  // data-shortcut names a registered key (core/keys.ts): the tooltip shows what the key really is.
  const shortcut = el.getAttribute('data-shortcut');
  const key = (shortcut && keysFor(shortcut)) || el.getAttribute('data-key');
  if (tip) return { tip, key };
  const label = el.getAttribute('aria-label');
  const iconOnly = !(el.textContent || '').trim();
  if (label && iconOnly && (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button')) return { tip: label, key: el.getAttribute('data-key') };
  return null;
}

/** Below the anchor, centred on it, 6 px away; above when there's no room below. Pure. */
export function tipPlacement(anchor: { top: number; bottom: number; left: number; right: number }, tip: { width: number; height: number }, bounds: { top: number; bottom: number; width: number }): { top: number; left: number; above: boolean } {
  const gap = 6;
  const margin = 6;
  const above = anchor.bottom + gap + tip.height > bounds.bottom - margin && anchor.top - gap - tip.height >= bounds.top + margin;
  const top = above ? anchor.top - gap - tip.height : anchor.bottom + gap;
  const centre = (anchor.left + anchor.right) / 2 - tip.width / 2;
  const left = Math.max(margin, Math.min(centre, bounds.width - tip.width - margin));
  return { top: Math.round(top), left: Math.round(left), above };
}

function el(): HTMLElement {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tip';
    tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

function show(target: HTMLElement): void {
  const t = tipFor(target);
  if (!t || !target.isConnected) return;
  const box = el();
  box.innerHTML = '';
  box.append(document.createTextNode(t.tip));
  if (t.key) {
    const k = document.createElement('kbd');
    k.textContent = t.key;
    box.append(k);
  }
  box.classList.remove('open', 'above');
  box.style.visibility = 'hidden';
  box.style.display = 'flex';
  const p = tipPlacement(target.getBoundingClientRect(), { width: box.offsetWidth, height: box.offsetHeight }, visibleBounds(target));
  box.style.top = `${p.top}px`;
  box.style.left = `${p.left}px`;
  box.classList.toggle('above', p.above);
  box.style.visibility = '';
  void box.offsetWidth;
  box.classList.add('open');
}

export function hideTip(): void {
  window.clearTimeout(timer);
  current = null;
  tipEl?.classList.remove('open');
}

export function startTooltips(): void {
  document.addEventListener('pointerover', (e) => {
    const target = (e.target as Element | null)?.closest?.('[data-tip], button[aria-label], [role=button][aria-label]') as HTMLElement | null;
    if (target === current) return;
    hideTip();
    if (!target || !tipFor(target)) return;
    current = target;
    timer = window.setTimeout(() => { if (current === target && target.matches(':hover')) show(target); }, DELAY);
  });
  document.addEventListener('pointerout', (e) => {
    if (current && !current.contains(e.relatedTarget as Node | null)) hideTip();
  });
  document.addEventListener('pointerdown', hideTip, true);
  document.addEventListener('scroll', hideTip, true);
  document.addEventListener('keydown', hideTip, true);
}
