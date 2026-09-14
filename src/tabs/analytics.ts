import { isWon, isLost, isWithdrawn, addMoney, currencyOf, agreementMonthly, toReporting, fmtMoney, fmtMoneyByCurrency, type MoneyByCurrency } from '../lib/commercial';
import { S } from '../lib/state';
import { companyLink } from '../lib/links';
import { escHtml, fmtDate, daysSince, badge, expose } from '../lib/utils';
import { registerTabRenderer } from '../lib/registry';
import { renderPipelineInsights, renderWinLoss } from './insights';

export function populateMonthPicker(): void {
  const dates = S.proposals.filter((p) => p.sentDate || p.dblSignedDate || p.kickoffDate).map((p) => (p.sentDate || p.dblSignedDate || p.kickoffDate) as string);
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))].sort().reverse();
  const sel = document.getElementById('mp-month') as HTMLSelectElement;
  const curMo = sel.value;
  sel.innerHTML = `<option value="">Select month...</option>` + months.map((m) => {
    const d = new Date(m + '-01');
    return `<option value="${m}" ${m === curMo ? 'selected' : ''}>${d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</option>`;
  }).join('');
  const yearSel = document.getElementById('mp-year') as HTMLSelectElement;
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  const curYr = yearSel.value;
  yearSel.innerHTML = years.map((y) => `<option value="${y}" ${y === curYr ? 'selected' : ''}>${y}</option>`).join('');
  if (!curMo && months.length > 0) { sel.value = months[0]; renderMonthlyReport(); }
}
expose('populateMonthPicker', populateMonthPicker);

export function renderMonthlyReport(): void {
  const month = (document.getElementById('mp-month') as HTMLSelectElement).value;
  const contentEl = document.getElementById('mp-content');
  if (!contentEl) return;
  if (!month) { contentEl.innerHTML = `<div class="feed-empty">Choose a month above.</div>`; return; }
  const prevMonth = (() => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
  function getMonthData(mo: string) {
    return {
      sent: S.proposals.filter((p) => p.sentDate && p.sentDate.startsWith(mo)),
      signed: S.proposals.filter((p) => isWon(p) && p.dblSignedDate && p.dblSignedDate.startsWith(mo)),
      started: S.agreements.filter((a) => a.startDate && a.startDate.startsWith(mo) && (a.serviceStatus === 'Active' || a.serviceStatus === 'Ended')),
      lost: S.proposals.filter((p) => isLost(p) && (p.sentDate || '').startsWith(mo)),
      added: S.proposals.filter((p) => p.dateAdded && p.dateAdded.startsWith(mo)),
    };
  }
  const cur = getMonthData(month);
  const prev = getMonthData(prevMonth);
  function chg(c: number, p: number): string {
    const d = c - p;
    if (p === 0 && d === 0) return `<span class="pill pill-flat">—</span>`;
    if (p === 0) return `<span class="pill pill-up">+${d} new</span>`;
    const pct = Math.round((d / p) * 100);
    if (d > 0) return `<span class="pill pill-up">+${d} · ${pct}% vs last month</span>`;
    if (d < 0) return `<span class="pill pill-dn">${d} · ${pct}% vs last month</span>`;
    return `<span class="pill pill-flat">No change</span>`;
  }
  const startedMrr = (list: typeof cur.started) => { const m: MoneyByCurrency = {}; list.forEach((a) => addMoney(m, currencyOf(a), agreementMonthly(a))); return m; };
  const curMrrBy = startedMrr(cur.started);
  const curMrr = toReporting(curMrrBy) ?? curMrrBy.SAR ?? 0;
  const prevMrr = toReporting(startedMrr(prev.started)) ?? startedMrr(prev.started).SAR ?? 0;
  const mo = new Date(month + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  let html = `
  <div class="kpi-row-auto analytics-kpis">
    ${[
      { lbl: 'Proposals sent', c: cur.sent.length, p: prev.sent.length },
      { lbl: 'Added to tracker', c: cur.added.length, p: prev.added.length },
      { lbl: 'Won (signed by both)', c: cur.signed.length, p: prev.signed.length },
      { lbl: 'Services started', c: cur.started.length, p: prev.started.length },
    ].map((s) => `<div class="kpi">
      <div class="kpi-lbl">${s.lbl}</div>
      <div class="kpi-val">${s.c}</div>
      <div class="kpi-change">${chg(s.c, s.p)}</div>
    </div>`).join('')}
  </div>
  ${curMrr > 0 || prevMrr > 0 ? `<div class="kpi analytics-mrr"><div class="kpi-lbl">New MRR from services started</div><div class="kpi-val tone-green">${fmtMoneyByCurrency(curMrrBy)}</div><div class="kpi-change">${chg(curMrr, prevMrr)}</div></div>` : ''}
  `;
  if (cur.sent.length > 0) {
    html += `<div class="table-title">Proposals sent in ${mo}</div>
    <div class="tbl-wrap data-table"><table><thead><tr>
      <th>Client</th><th>Type</th><th>Status</th><th>Sent</th><th class="num">MRR</th>
    </tr></thead><tbody>${cur.sent.map((p) => `<tr><td class="strong">${companyLink(p.companyId, p.client)}</td><td class="muted">${escHtml(p.type)}</td><td>${badge(p.status)}</td><td class="muted">${fmtDate(p.sentDate)}</td><td class="num tone-green">${p.monthlyFee ? fmtMoney(p.monthlyFee, currencyOf(p)) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
  }
  contentEl.innerHTML = html;
}
expose('renderMonthlyReport', renderMonthlyReport);

export function setAnalyticsView(view: typeof S.analyticsView): void {
  S.analyticsView = view;
  document.querySelectorAll<HTMLElement>('[data-an-view]').forEach((b) => b.classList.toggle('active', b.dataset.anView === view));
  (['pipeline', 'winloss', 'monthly'] as const).forEach((v) => { const el = document.getElementById(`an-${v}`); if (el) el.hidden = v !== view; });
  if (view === 'pipeline') void renderPipelineInsights();
  else if (view === 'winloss') renderWinLoss();
  else populateMonthPicker();
}
expose('setAnalyticsView', setAnalyticsView);

registerTabRenderer('analytics', () => setAnalyticsView(S.analyticsView));
