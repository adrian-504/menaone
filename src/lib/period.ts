import { S } from './state';
import { expose } from './utils';
import type { Proposal } from './types';

export function matchesPeriod(dateStr: string | null | undefined): boolean {
  if (S.globalPeriod === 'all' || !dateStr) return S.globalPeriod === 'all';
  const d = new Date(dateStr + 'T12:00:00');
  if (isNaN(d.getTime())) return false;
  const yr = d.getFullYear();
  const q = Math.ceil((d.getMonth() + 1) / 3);
  if (S.globalPeriod === String(yr)) return true;
  if (S.globalPeriod === `${yr}-Q${q}`) return true;
  return false;
}

export function matchesProposalPeriod(p: Proposal): boolean {
  if (S.globalPeriod === 'all') return true;
  const date = p.sentDate || p.dateAdded;
  if (!date) {
    // No date on this proposal — bundle it under the full 2025 year filter
    // (quirk preserved verbatim from the original app).
    return S.globalPeriod === '2025';
  }
  return matchesPeriod(date);
}

/** Registered by main.ts once all tab modules are wired up, so setGlobalPeriod
 * can re-render whichever tab is currently active without a circular import
 * between period.ts and every tab module. */
type PeriodChangeHandler = () => void;
let onPeriodChange: PeriodChangeHandler | null = null;
export function registerPeriodChangeHandler(fn: PeriodChangeHandler) {
  onPeriodChange = fn;
}

export function setGlobalPeriod(val: string): void {
  S.globalPeriod = val;
  const selects = [...document.querySelectorAll<HTMLSelectElement>('.period-sel')];
  selects.forEach((el) => { el.value = val; el.classList.toggle('filtered', val !== 'all'); });
  const sel = selects[0] || null;
  const banner = document.getElementById('period-banner');
  const bannerTxt = document.getElementById('period-banner-txt');
  if (banner && bannerTxt) {
    if (val === 'all') {
      banner.classList.remove('active');
    } else {
      banner.classList.add('active');
      const label = sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text.trim() : val;
      bannerTxt.textContent = `Showing data for: ${label}`;
    }
  }
  onPeriodChange?.();
}
expose('setGlobalPeriod', setGlobalPeriod);

export function populatePeriodSelector(): void {
  document.querySelectorAll<HTMLSelectElement>('.period-sel').forEach((el) => { el.value = S.globalPeriod; });
}
