import { S } from '../lib/state';
import { expose, showConfirm } from '../lib/utils';
import { setActiveTabId, renderTab, notifyNavigated } from '../lib/registry';
import { closeCurrentRecord } from './router';

/** Every `.modal-ov` already closes on backdrop click via an inline
 * `onclick="if(event.target===this)closeXModal()"` attribute — Escape
 * reuses that exact same behavior by dispatching a real click event at the
 * modal element itself (so `event.target === this` holds, same as an actual
 * backdrop click) instead of requiring per-modal Escape wiring or parsing
 * each one's close function out of its markup. Also means Escape and
 * backdrop-click share the same unsaved-changes guard below for free. */
function closeTopmostModal(): boolean {
  const open = document.querySelectorAll<HTMLElement>('.modal-ov.open');
  const modal = open[open.length - 1];
  if (!modal) return false;
  modal.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}

/** Escape closes the topmost open modal, otherwise leaves the open record
 * (company, project, opportunity, meeting) for its module's list. Only fires
 * when nothing else already owns Escape (the command palette). */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (S.commandPaletteOpen) return;
  if (closeTopmostModal()) return;
  closeCurrentRecord({ fromEscape: true });
});

/** Marks an open modal "dirty" the moment any of its fields are touched, so
 * the backdrop-click guard below can ask before discarding — generic across
 * all modals, no per-modal field tracking needed. Reset happens via the
 * class-attribute observer further down whenever a modal is (re)opened. */
document.addEventListener('input', (e) => {
  const modal = (e.target as HTMLElement).closest?.('.modal-ov.open') as HTMLElement | null;
  if (modal) modal.dataset.dirty = '1';
});
document.addEventListener('change', (e) => {
  const modal = (e.target as HTMLElement).closest?.('.modal-ov.open') as HTMLElement | null;
  if (modal) modal.dataset.dirty = '1';
});

const modalDirtyReset = new MutationObserver((mutations) => {
  for (const m of mutations) {
    const el = m.target as HTMLElement;
    if (el.classList.contains('open')) el.dataset.dirty = '';
  }
});
document.querySelectorAll('.modal-ov').forEach((el) => modalDirtyReset.observe(el, { attributes: true, attributeFilter: ['class'] }));

/** Clicking the backdrop of a modal with unsaved input previously discarded
 * it silently (every `.modal-ov` closes unconditionally on backdrop click) —
 * this asks first, once, for all modals, rather than adding a confirm to
 * each modal's own close function individually. Capture-phase so it runs
 * before the target's own inline onclick and can cancel it. */
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (!target.classList?.contains('modal-ov') || !target.classList.contains('open')) return;
  if (target.dataset.dirty !== '1') return;
  // Hold the close, ask, then replay it without the guard if confirmed.
  e.stopImmediatePropagation();
  e.preventDefault();
  void showConfirm('Your changes in this form will be lost.', { title: 'Discard changes?', confirmLabel: 'Discard' }).then((discard) => {
    if (!discard) return;
    target.dataset.dirty = '';
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}, true);

export function switchTab(t: string): void {
  S.currentTab = t;
  setActiveTabId(t);
  document.querySelectorAll('.tab').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.sb-item').forEach((el) => el.classList.remove('active'));
  document.getElementById('tab-' + t)?.classList.add('active');
  // Notes and Tasks are full-height workspaces with their own scrolling panes.
  document.querySelector('main')?.classList.toggle('workspace', !!document.getElementById('tab-' + t)?.classList.contains('ws-tab'));
  const sbEl = document.querySelector(`[data-tab="${t}"]`);
  if (sbEl) sbEl.classList.add('active');
  renderTab(t);
  notifyNavigated();
}
expose('switchTab', switchTab);
