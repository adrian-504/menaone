import { isWon, isLost, addMoney, currencyOf, fmtMoneyByCurrency, type MoneyByCurrency } from '../lib/commercial';
import { S } from '../lib/state';
import { companyLink } from '../lib/links';
import { STATUSES, ST } from '../lib/constants';
import { fmtDate, escHtml, badge, expose, kpiCard, statusDot } from '../lib/utils';
import { applyFilters } from '../lib/filters';
import { registerTabRenderer } from '../lib/registry';
import { exportCSV } from './database';
import type { Proposal } from '../lib/types';

export function rptGetFiltered(): Proposal[] {
  return applyFilters(
    S.proposals,
    (document.getElementById('r-search') as HTMLInputElement).value,
    (document.getElementById('r-status') as HTMLSelectElement).value,
    (document.getElementById('r-type') as HTMLSelectElement).value,
    (document.getElementById('r-df') as HTMLInputElement).value,
    (document.getElementById('r-dt') as HTMLInputElement).value,
    false
  );
}

export function renderReports(): void {
  const data = rptGetFiltered();
  const wonMonthly: MoneyByCurrency = {};
  data.filter(isWon).forEach((p) => addMoney(wonMonthly, currencyOf(p), p.monthlyFee));
  const sumDefs = [
    { lbl: 'Proposals', val: data.length },
    { lbl: 'Won (signed by both)', val: data.filter(isWon).length },
    { lbl: 'Lost', val: data.filter(isLost).length },
    { lbl: 'Monthly value won', val: Object.keys(wonMonthly).length ? fmtMoneyByCurrency(wonMonthly) : '—' },
  ];
  const sumEl = document.getElementById('rpt-sum');
  if (sumEl) sumEl.innerHTML = sumDefs.map((s) => kpiCard(s.lbl, s.val)).join('');
  const cts: Record<string, number> = {};
  data.forEach((p) => { cts[p.status] = (cts[p.status] || 0) + 1; });
  const bdEl = document.getElementById('rpt-breakdown');
  if (bdEl) bdEl.innerHTML = STATUSES.filter((s) => cts[s]).map((s) => {
    const c = ST[s] || { c: '#6B7280', ch: '#9CA3AF' };
    return `<div class="bchip">${statusDot(c, s)}<span class="bchip-n">${cts[s]}</span></div>`;
  }).join('') || `<span class="t-secondary t-muted">No data</span>`;
  const tbodyEl = document.getElementById('rpt-tbody');
  if (tbodyEl) {
    tbodyEl.innerHTML = data.length === 0
      ? `<tr><td colspan="11" class="empty">No records match</td></tr>`
      : data.map((p, i) => `<tr><td class="td-n">${i + 1}</td><td class="td-id">${p.id}</td><td class="td-c" title="${escHtml(p.client)}">${companyLink(p.companyId, p.client)}</td><td class="td-t">${escHtml(p.type)}</td><td>${badge(p.status)}</td><td class="td-d">${fmtDate(p.sentDate)}</td><td class="td-d">${fmtDate(p.dblSignedDate)}</td><td class="td-fee">${p.monthlyFee ? `SAR ${Number(p.monthlyFee).toLocaleString()}` : '—'}</td><td class="td-da">${p.dateAdded ? fmtDate(p.dateAdded) : '—'}</td><td class="t-meta t-sub">${escHtml(p.owner || '—')}</td><td class="td-r">${escHtml(p.remarks || '—')}</td></tr>`).join('');
  }
}
registerTabRenderer('reports', renderReports);
expose('renderReports', renderReports);

export function rptClear(): void {
  ['r-search', 'r-status', 'r-type', 'r-df', 'r-dt'].forEach((id) => { const el = document.getElementById(id) as HTMLInputElement | null; if (el) el.value = ''; });
  renderReports();
}
expose('rptClear', rptClear);

export async function exportReport(): Promise<void> {
  await exportCSV(rptGetFiltered(), 'MENA_BIG_Report');
}
expose('exportReport', exportReport);
