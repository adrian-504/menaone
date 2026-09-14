// Analytics: pipeline health (opportunities) and win/loss (proposals, plus
// opportunity outcomes). Numbers come from lib/pipeline.ts.

import { S } from '../lib/state';
import { escHtml, today } from '../lib/utils';
import { icon } from '../lib/icons';
import { recordLink } from '../lib/links';
import { emptyState, skeleton } from '../lib/ui';
import { getOpportunities, getPipelineFacts } from '../lib/db';
import { matchesProposalPeriod } from '../lib/period';
import { renderIcons } from '../core/chrome';
import { OPPORTUNITY_STAGES } from '../lib/types';
import type { Opportunity, PipelineFact, Proposal } from '../lib/types';
import {
  addMoney, fmtMoneyByCurrency, toReporting, missingRates, ownerName, entityById, isWon, isLost, lineTotals, fmtMoney,
  REPORTING_CURRENCY, type MoneyByCurrency,
} from '../lib/commercial';
import {
  isOpenOpportunity, opportunityHealth, pipelineByStage, weightedValue, winLossBy, dealSizeBand, reasonCounts, daysToSign, monthlyOf,
  daysBetween, type WinLossRow,
} from '../lib/pipeline';

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const money = (m: MoneyByCurrency) => (Object.keys(m).length ? fmtMoneyByCurrency(m) : '—');

function converted(m: MoneyByCurrency): string {
  const others = Object.keys(m).filter((c) => c !== REPORTING_CURRENCY);
  if (!others.length) return '';
  const total = toReporting(m);
  return total != null ? `≈ ${fmtMoney(total)}` : `Set a rate for ${missingRates(m).join(', ')} in Settings to see a SAR total`;
}

function kpi(label: string, value: string, sub = '', tone = ''): string {
  return `<div class="kpi${tone ? ` kpi-${tone}` : ''}"><div class="kpi-lbl">${escHtml(label)}</div><div class="kpi-val">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
}

// ═══════════════ Pipeline ═══════════════

export async function renderPipelineInsights(): Promise<void> {
  const el = document.getElementById('an-pipeline');
  if (!el) return;
  if (!el.childElementCount) el.innerHTML = skeleton(4, 'cards');
  let facts: PipelineFact[] = [];
  try {
    const [opps, f] = await Promise.all([getOpportunities(), getPipelineFacts()]);
    S.opportunities = opps;
    facts = f;
    S.pipelineFacts = f;
  } catch {
    facts = S.pipelineFacts;
  }
  const byId = new Map(facts.map((f) => [f.opportunityId, f] as const));
  const td = today();
  const open = S.opportunities.filter(isOpenOpportunity);
  if (!S.opportunities.length) {
    el.innerHTML = `<div class="card">${emptyState({ icon: 'target', title: 'No opportunities yet', body: 'Pipeline health appears once opportunities are tracked.', action: { label: 'Open Opportunities', onclick: "navToModule('opportunities')" } })}</div>`;
    renderIcons(el);
    return;
  }

  const value: MoneyByCurrency = {};
  const weighted: MoneyByCurrency = {};
  const closing: MoneyByCurrency = {};
  let closingCount = 0;
  const health = new Map(open.map((o) => [o.id, opportunityHealth(o, byId.get(o.id), td)] as const));
  for (const o of open) {
    const cur = (o.currency || 'SAR').toUpperCase();
    addMoney(value, cur, o.estimatedValue);
    addMoney(weighted, cur, weightedValue(o));
    const d = o.expectedCloseDate ? daysBetween(td, o.expectedCloseDate) : null;
    if (d != null && d >= 0 && d <= 30) { closingCount++; addMoney(closing, cur, o.estimatedValue); }
  }
  const attention = open.filter((o) => health.get(o.id)!.score < 70).sort((a, b) => health.get(a.id)!.score - health.get(b.id)!.score);
  const unpriced = open.filter((o) => o.estimatedValue == null).length;
  const noProbability = open.filter((o) => o.probability == null).length;

  const stages = pipelineByStage(S.opportunities, byId, OPPORTUNITY_STAGES, td);
  const owners = new Map<string, { open: number; value: MoneyByCurrency; weighted: MoneyByCurrency; won: number; lost: number }>();
  for (const o of S.opportunities.filter((x) => !x.archived)) {
    const key = (o.owner || '').trim() || 'No owner';
    if (!owners.has(key)) owners.set(key, { open: 0, value: {}, weighted: {}, won: 0, lost: 0 });
    const r = owners.get(key)!;
    const cur = (o.currency || 'SAR').toUpperCase();
    if (isOpenOpportunity(o)) { r.open++; addMoney(r.value, cur, o.estimatedValue); addMoney(r.weighted, cur, weightedValue(o)); }
    if (o.stage === 'Won') r.won++;
    if (o.stage === 'Lost') r.lost++;
  }

  el.innerHTML = `
    <div class="kpi-row-auto an-kpis">
      ${kpi('Open opportunities', String(open.length), unpriced ? `${unpriced} without a value` : 'All have a value')}
      ${kpi('Pipeline value', money(value), converted(value))}
      ${kpi('Weighted pipeline', money(weighted), noProbability ? `Stage odds used for ${noProbability}` : 'Value × probability')}
      ${kpi('Closing in 30 days', String(closingCount), money(closing))}
      ${kpi('Need attention', String(attention.length), attention.length ? 'Stalled, overdue or no next step' : 'Everything is moving', attention.length ? 'warn' : '')}
    </div>

    <section class="card an-card">
      <div class="rec-section-hd"><h2>Needs attention</h2><span class="rec-count">${attention.length || ''}</span></div>
      ${attention.length ? `<div class="rec-list">${attention.map((o) => attentionRow(o, health.get(o.id)!)).join('')}</div>`
        : emptyState({ icon: 'check', title: 'Nothing stalled', body: `Every open opportunity has had activity in the last 14 days, a next action and a close date that hasn't passed.`, compact: true })}
    </section>

    <section class="card an-card">
      <div class="rec-section-hd"><h2>By stage</h2></div>
      <div class="tbl-wrap data-table"><table>
        <thead><tr><th>Stage</th><th class="num">Open</th><th class="num">Value</th><th class="num">Weighted</th><th class="num">Avg. days in stage</th><th class="num">Won from here</th></tr></thead>
        <tbody>${stages.map((r) => `<tr>
          <td class="strong">${escHtml(r.stage)}</td><td class="num">${r.count || '—'}</td><td class="num">${money(r.value)}</td><td class="num muted">${money(r.weighted)}</td>
          <td class="num">${r.avgDaysInStage ?? '—'}</td><td class="num">${pct(r.winRateFromHere)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="table-footnote">"Won from here" counts closed opportunities that passed through the stage. Time in stage starts from the recorded stage change, or the date the opportunity was created.</p>
    </section>

    <section class="card an-card">
      <div class="rec-section-hd"><h2>By owner</h2></div>
      <div class="tbl-wrap data-table"><table>
        <thead><tr><th>Owner</th><th class="num">Open</th><th class="num">Value</th><th class="num">Weighted</th><th class="num">Won</th><th class="num">Lost</th></tr></thead>
        <tbody>${[...owners.entries()].sort((a, b) => b[1].open - a[1].open).map(([name, r]) => `<tr>
          <td class="strong">${escHtml(name)}</td><td class="num">${r.open}</td><td class="num">${money(r.value)}</td><td class="num muted">${money(r.weighted)}</td><td class="num tone-green">${r.won}</td><td class="num tone-red">${r.lost}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </section>`;
  renderIcons(el);
}

function attentionRow(o: Opportunity, h: ReturnType<typeof opportunityHealth>): string {
  return `<div class="rec-row" onclick="openRecord('opportunity', ${o.id})">
    <span class="rec-row-icon an-health tone-${h.tone}">${h.score}</span>
    <div class="rec-row-main">
      <div class="rec-row-title">${recordLink('opportunity', o.id, o.name)}${o.companyName ? ` <span class="rec-muted">· ${escHtml(o.companyName)}</span>` : ''}</div>
      <div class="rec-row-sub">${escHtml(o.stage)} · ${h.reasons.map(escHtml).join(' · ')}</div>
    </div>
    <div class="rec-row-end"><span class="rec-badge tone-${h.tone}">${h.label}</span></div>
  </div>`;
}

// ═══════════════ Win & loss ═══════════════

function companyIndustries(p: Proposal): string[] {
  const co = p.companyId != null ? S.companies.find((c) => c.id === p.companyId) : S.companies.find((c) => c.name === p.client);
  return co?.industries.length ? co.industries : ['Unknown industry'];
}

function wlTable(title: string, label: string, rows: WinLossRow[], note = ''): string {
  if (!rows.length) return '';
  return `<section class="card an-card">
    <div class="rec-section-hd"><h2>${escHtml(title)}</h2></div>
    <div class="tbl-wrap data-table"><table>
      <thead><tr><th>${escHtml(label)}</th><th class="num">Won</th><th class="num">Lost</th><th class="num">Open</th><th class="rate-col">Win rate</th><th class="num">Won monthly</th><th class="num">Avg. days to sign</th></tr></thead>
      <tbody>${rows.map((r) => {
        const tone = r.winRate == null ? 'muted' : r.winRate >= 0.5 ? 'green' : r.winRate >= 0.25 ? 'amber' : 'red';
        return `<tr>
          <td class="strong">${escHtml(r.key)}</td><td class="num tone-green">${r.won}</td><td class="num tone-red">${r.lost}</td><td class="num muted">${r.open}</td>
          <td>${r.winRate == null ? '<span class="t-muted">—</span>' : `<div class="rate-bar tone-${tone}"><div class="rate-track"><div class="rate-fill" style="width:${Math.round(r.winRate * 100)}%"></div></div><span>${pct(r.winRate)}</span></div>`}</td>
          <td class="num">${money(r.wonMonthly)}</td><td class="num muted">${r.avgDaysToSign != null ? `${r.avgDaysToSign}d` : '—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>${note ? `<p class="table-footnote">${note}</p>` : ''}
  </section>`;
}

function reasonsCard(title: string, reasons: (string | null | undefined)[], tone: 'red' | 'green'): string {
  if (!reasons.length) return '';
  const rows = reasonCounts(reasons);
  return `<section class="card an-card">
    <div class="rec-section-hd"><h2>${escHtml(title)}</h2><span class="rec-count">${reasons.length}</span></div>
    <div class="an-reasons">${rows.map((r) => `<div class="an-reason"><span class="an-reason-label">${escHtml(r.reason)}</span><div class="rate-bar tone-${tone}"><div class="rate-track"><div class="rate-fill" style="width:${Math.round(r.share * 100)}%"></div></div><span>${r.count}</span></div></div>`).join('')}</div>
  </section>`;
}

function monthKey(iso: string | null | undefined): string | null {
  return iso && /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : null;
}

function trendCard(proposals: Proposal[]): string {
  const now = new Date();
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const won = new Map<string, number>();
  const lost = new Map<string, number>();
  for (const p of proposals) {
    if (isWon(p)) { const k = monthKey(p.dblSignedDate); if (k) won.set(k, (won.get(k) || 0) + 1); }
    if (isLost(p)) { const k = monthKey(p.dateSentToClient || p.sentDate || p.dateAdded); if (k) lost.set(k, (lost.get(k) || 0) + 1); }
  }
  const max = Math.max(1, ...months.map((m) => Math.max(won.get(m) || 0, lost.get(m) || 0)));
  if (!months.some((m) => won.get(m) || lost.get(m))) return '';
  return `<section class="card an-card">
    <div class="rec-section-hd"><h2>Last 12 months</h2><span class="an-legend"><i class="tone-green"></i>Won <i class="tone-red"></i>Lost</span></div>
    <div class="an-trend">${months.map((m) => {
      const w = won.get(m) || 0;
      const l = lost.get(m) || 0;
      const label = new Date(m + '-01T12:00:00').toLocaleDateString('en-GB', { month: 'short' });
      return `<div class="an-trend-col" title="${label}: ${w} won, ${l} lost"><div class="an-trend-bars"><span class="an-bar won" style="height:${(w / max) * 100}%"></span><span class="an-bar lost" style="height:${(l / max) * 100}%"></span></div><span class="an-trend-label">${label}</span></div>`;
    }).join('')}</div>
    <p class="table-footnote">Won by the month both parties signed; lost by the month the proposal was sent, since losses have no decision date on older records.</p>
  </section>`;
}

export function renderWinLoss(): void {
  const el = document.getElementById('an-winloss');
  if (!el) return;
  const proposals = S.proposals.filter((p) => matchesProposalPeriod(p));
  const decided = proposals.filter((p) => isWon(p) || isLost(p));
  const won = proposals.filter(isWon);
  const lost = proposals.filter(isLost);
  const wonMonthly: MoneyByCurrency = {};
  won.forEach((p) => addMoney(wonMonthly, (p.currency || 'SAR').toUpperCase(), monthlyOf(p)));
  const signDays = won.map(daysToSign).filter((d): d is number => d != null);
  const winRate = decided.length ? won.length / decided.length : null;
  const period = S.globalPeriod === 'all' ? 'all time' : S.globalPeriod;

  if (!decided.length) {
    el.innerHTML = `<div class="card">${emptyState({ icon: 'target', title: 'No decided proposals in this period', body: 'Win rate appears once proposals are signed by both parties or marked lost.' })}</div>`;
    renderIcons(el);
    return;
  }

  const oppDecided = S.opportunities.filter((o) => o.stage === 'Won' || o.stage === 'Lost');
  el.innerHTML = `
    <p class="an-period">Showing ${escHtml(period)} — change the period in the sidebar.</p>
    <div class="kpi-row-auto an-kpis">
      ${kpi('Win rate', pct(winRate), `${won.length} won of ${decided.length} decided`)}
      ${kpi('Won', String(won.length), money(wonMonthly) + (Object.keys(wonMonthly).length ? ' / month' : ''))}
      ${kpi('Lost', String(lost.length), lost.filter((p) => p.winLossReason).length ? `${lost.filter((p) => p.winLossReason).length} with a reason` : 'No reasons recorded')}
      ${kpi('Avg. days to sign', signDays.length ? `${Math.round(signDays.reduce((a, b) => a + b, 0) / signDays.length)}` : '—', 'From sent to signed by both')}
    </div>
    ${trendCard(proposals)}
    <div class="an-grid">
      ${reasonsCard('Why we lose', lost.map((p) => p.winLossReason), 'red')}
      ${reasonsCard('Why we win', won.map((p) => p.winLossReason), 'green')}
    </div>
    ${wlTable('By service', 'Service', winLossBy(proposals, (p) => (p.lines?.length ? lineTotals(p.lines, p.contractMonths).serviceNames : [p.type && p.type !== '—' ? p.type : 'Service not recorded'])), 'A proposal with several services counts once for each.')}
    ${wlTable('By industry', 'Industry', winLossBy(proposals, companyIndustries))}
    ${wlTable('By owner', 'Owner', winLossBy(proposals, (p) => [ownerName(p) || 'No owner']))}
    ${wlTable('By deal size', 'Monthly fee', winLossBy(proposals, (p) => [dealSizeBand(p)]))}
    ${wlTable('By lead source', 'Source', winLossBy(proposals, (p) => [p.leadSource || 'Not recorded']))}
    ${S.businessEntities.length > 1 ? wlTable('By entity', 'Entity', winLossBy(proposals, (p) => [entityById(p.businessEntityId)?.name || 'Not set'])) : ''}
    ${oppDecided.length ? `<section class="card an-card">
      <div class="rec-section-hd"><h2>Opportunities</h2><span class="rec-count">${oppDecided.length} closed</span></div>
      <p class="an-period">${oppDecided.filter((o) => o.stage === 'Won').length} won, ${oppDecided.filter((o) => o.stage === 'Lost').length} lost.</p>
      ${reasonsCard('Opportunity loss reasons', oppDecided.filter((o) => o.stage === 'Lost').map((o) => o.winLossReason), 'red').replace('<section class="card an-card">', '<div>').replace(/<\/section>$/, '</div>')}
    </section>` : ''}
    <p class="table-footnote">Won = signed by both parties. Lost = marked lost. Withdrawn proposals are left out.</p>`;
  renderIcons(el);
}
