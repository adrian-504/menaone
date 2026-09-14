import { isOpenProposal, isWon, isLost, isAgreementActive } from '../lib/commercial';
import { S } from '../lib/state';
import { STATUSES, ST, CC } from '../lib/constants';
import { escHtml, kpiCard, themeColor, fmtDate, statusDot } from '../lib/utils';
import { matchesProposalPeriod } from '../lib/period';
import { registerTabRenderer } from '../lib/registry';
import { updateBadge, getFollowups } from '../core/proposals';
import { isOverdue } from './todo';
import { getAllCompanies } from './companies';
import { getIntelligenceItems } from '../lib/db';
import type { Proposal } from '../lib/types';

declare const Chart: any;

export function destroyChart(id: string): void {
  if (S.charts[id]) { S.charts[id].destroy(); delete S.charts[id]; }
}

export function renderDashboard(): void {
  const dp = S.proposals.filter((p) => matchesProposalPeriod(p));
  const set = (id: string, val: string | number) => { const el = document.getElementById(id); if (el) el.textContent = String(val); };
  set('kpi-total', dp.length);
  set('kpi-active', dp.filter((p) => !p.archived && isOpenProposal(p)).length);
  set('kpi-signed', dp.filter(isWon).length);
  set('kpi-service', new Set(S.agreements.filter((a) => isAgreementActive(a)).map((a) => a.companyId ?? a.client)).size);
  set('kpi-closed', dp.filter(isLost).length);
  updateBadge();
  setTimeout(() => { renderStatusChart(dp); renderTypeChart(dp); renderMonthlyChart(dp); renderTopClients(dp); }, 10);
  renderWorkManagementKpis();
  renderRelationshipsKpis();
  renderKnowledgeKpis();
  void renderIntelSummary();
}
registerTabRenderer('dashboard', renderDashboard);

const IMPORTANCE_COLOR: Record<string, string> = { critical: 'var(--red)', important: 'var(--amber)', monitor: 'var(--muted)' };

/** Compact, non-scrolling summary — top few unarchived items by importance,
 * not a news ticker (Part 25: "without overwhelming work management"). */
async function renderIntelSummary(): Promise<void> {
  const card = document.getElementById('dash-intel-card');
  if (!card) return;
  const [reg, biz] = await Promise.all([getIntelligenceItems('regulatory'), getIntelligenceItems('business')]);
  if (document.getElementById('dash-intel-card') !== card) return;
  const order: Record<string, number> = { critical: 0, important: 1, monitor: 2 };
  const items = [...reg, ...biz]
    .sort((a, b) => (order[a.importance] ?? 3) - (order[b.importance] ?? 3) || (b.publishedAt || '').localeCompare(a.publishedAt || ''))
    .slice(0, 4);
  if (items.length === 0) { card.style.display = 'none'; return; }
  card.style.display = '';
  card.innerHTML = `<div class="rec-section-hd"><h2>Regulatory &amp; business watch</h2><div class="rec-section-actions"><button class="btn-sm" onclick="navToModule('intelligence')">View all</button></div></div>
    <div class="rec-list">${items.map((it) => `<div class="rec-row" onclick="navToModule('intelligence')">
      ${statusDot({ c: IMPORTANCE_COLOR[it.importance] || 'var(--muted)' }, '')}
      <div class="rec-row-main"><div class="rec-row-title">${escHtml(it.headline)}</div></div>
      <span class="rec-row-date">${escHtml(it.sourceName)}${it.publishedAt ? ` · ${escHtml(fmtDate(it.publishedAt))}` : ''}</span>
    </div>`).join('')}</div>`;
}

function renderWorkManagementKpis(): void {
  const el = document.getElementById('dash-work-kpis');
  if (!el) return;
  const openTasks = S.todos.filter((t) => t.status !== 'Done').length;
  const overdueTasks = S.todos.filter((t) => isOverdue(t)).length;
  const activeProjects = S.projects.filter((p) => !p.archived && p.status !== 'Completed' && p.status !== 'Cancelled').length;
  const atRiskProjects = S.projects.filter((p) => !p.archived && p.status === 'At Risk').length;
  el.innerHTML = [
    kpiCard('Open Tasks', openTasks, 'Across all areas', { onclick: "switchTab('todo')" }),
    kpiCard('Overdue Tasks', overdueTasks, 'Need attention', { onclick: "switchTab('todo');setTodoFilter('overdue')", signal: overdueTasks > 0 ? 'danger' : undefined }),
    kpiCard('Active Projects', activeProjects, 'Client + internal', { onclick: "switchTab('projects')" }),
    kpiCard('Projects At Risk', atRiskProjects, 'Flagged status', { onclick: "switchTab('projects')", signal: atRiskProjects > 0 ? 'warning' : undefined }),
  ].join('');
}

function renderRelationshipsKpis(): void {
  const el = document.getElementById('dash-relationships-kpis');
  if (!el) return;
  const companies = getAllCompanies().length;
  const contacts = S.contacts.length;
  const followups = getFollowups().length;
  el.innerHTML = [
    kpiCard('Companies', companies, 'Total relationships', { onclick: "switchTab('companies')" }),
    kpiCard('Contacts', contacts, 'People tracked', { onclick: "switchTab('contacts')" }),
    kpiCard('Follow-Ups Needed', followups, 'Sent >10 days ago', { onclick: "switchTab('followup')", signal: followups > 0 ? 'warning' : undefined }),
    kpiCard('Meetings Logged', S.meetings.length, 'Total captured', { onclick: "switchTab('meetings')" }),
  ].join('');
}

function renderKnowledgeKpis(): void {
  const el = document.getElementById('dash-knowledge-kpis');
  if (!el) return;
  const notes = S.notes.length;
  const pinned = S.notes.filter((n) => n.pinned).length;
  const templates = S.noteTemplates.length;
  el.innerHTML = [
    kpiCard('Total Notes', notes, 'All folders', { onclick: "switchTab('notes')" }),
    kpiCard('Pinned Notes', pinned, 'Quick reference', { onclick: "switchTab('notes')" }),
    kpiCard('Note Templates', templates, 'Ready to use', { onclick: "switchTab('notes')" }),
  ].join('');
}

export function renderStatusChart(dp?: Proposal[]): void {
  dp = dp || S.proposals;
  destroyChart('status');
  const counts: Record<string, number> = {};
  dp.forEach((p) => { counts[p.status] = (counts[p.status] || 0) + 1; });
  const labels = STATUSES.filter((s) => counts[s]);
  const data = labels.map((s) => counts[s]);
  const colors = labels.map((s) => (ST[s] || { ch: '#94A3B8' }).ch);
  const ctx = document.getElementById('ch-status') as HTMLCanvasElement | null;
  if (!ctx) return;
  S.charts.status = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels.map((s) => (s.length > 26 ? s.slice(0, 24) + '…' : s)), datasets: [{ data, backgroundColor: colors, borderRadius: 4, borderSkipped: false }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: (i: any) => labels[i[0].dataIndex], label: (i: any) => `Count: ${i.raw}` } } },
      scales: { x: { grid: { color: themeColor('--border') }, ticks: { color: themeColor('--muted'), font: { size: 10 } } }, y: { grid: { display: false }, ticks: { color: themeColor('--sub'), font: { size: 9 } } } },
    },
  });
}

export function renderTypeChart(dp?: Proposal[]): void {
  dp = dp || S.proposals;
  destroyChart('type');
  const counts: Record<string, number> = {};
  dp.forEach((p) => { const t = p.type && p.type !== '—' ? p.type : 'Other'; counts[t] = (counts[t] || 0) + 1; });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top8 = sorted.slice(0, 8).map(([name, value]) => ({ name, value }));
  const rest = sorted.slice(8).reduce((s, [, v]) => s + v, 0);
  if (rest > 0) top8.push({ name: 'Other', value: rest });
  const colors = CC.slice(0, top8.length);
  const ctx = document.getElementById('ch-type') as HTMLCanvasElement | null;
  if (!ctx) return;
  S.charts.type = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: top8.map((d) => d.name), datasets: [{ data: top8.map((d) => d.value), backgroundColor: colors, borderWidth: 2, borderColor: themeColor('--surface'), hoverOffset: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (i: any) => `${i.label}: ${i.raw}` } } } },
  });
  const legend = document.getElementById('type-legend');
  if (legend) legend.innerHTML = top8.slice(0, 8).map((t, i) => `<div class="legend-item"><i style="background:${colors[i]}"></i><span>${escHtml(t.name)} (${t.value})</span></div>`).join('');
}

export function renderMonthlyChart(dp?: Proposal[]): void {
  dp = dp || S.proposals;
  destroyChart('monthly');
  const counts: Record<string, { count: number; label: string }> = {};
  dp.filter((p) => p.sentDate).forEach((p) => {
    const d = new Date(p.sentDate + 'T12:00:00');
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    counts[k] = counts[k] || { count: 0, label: d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) };
    counts[k].count++;
  });
  const sorted = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  const ctx = document.getElementById('ch-monthly') as HTMLCanvasElement | null;
  if (!ctx) return;
  S.charts.monthly = new Chart(ctx, {
    type: 'line',
    data: { labels: sorted.map(([, v]) => v.label), datasets: [{ data: sorted.map(([, v]) => v.count), borderColor: themeColor('--accent'), backgroundColor: themeColor('--accent-bg'), fill: true, tension: 0.35, pointBackgroundColor: themeColor('--accent'), pointRadius: 3, pointHoverRadius: 5, borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (i: any) => `Proposals: ${i.raw}` } } }, scales: { x: { grid: { display: false }, ticks: { color: themeColor('--muted'), font: { size: 9 }, maxRotation: 35 } }, y: { grid: { color: themeColor('--border') }, ticks: { color: themeColor('--muted'), font: { size: 10 } }, beginAtZero: true } } },
  });
}

export function renderTopClients(dp?: Proposal[]): void {
  dp = dp || S.proposals;
  const counts: Record<string, number> = {};
  dp.forEach((p) => { counts[p.client] = (counts[p.client] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = top[0] ? top[0][1] : 1;
  const el = document.getElementById('top-clients');
  if (el) el.innerHTML = top.map(([name, cnt], i) => `<div class="tc-row"><span class="tc-rank">${i + 1}</span><span class="tc-name" title="${escHtml(name)}">${escHtml(name)}</span><div class="tc-bar-wrap"><div class="tc-bar" style="width:${Math.round((cnt / max) * 100)}%;background:${CC[i % CC.length]}"></div></div><span class="tc-cnt">${cnt}</span></div>`).join('');
}
