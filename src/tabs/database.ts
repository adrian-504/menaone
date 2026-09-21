import { S } from '../lib/state';
import { companyLink } from '../lib/links';
import { STATUSES, ST } from '../lib/constants';
import { fmtDate, escHtml, expose, debounce, statusDot } from '../lib/utils';
import { icon } from '../lib/icons';
import { showContextMenu, showMenuAt } from '../lib/contextMenu';
import { emptyState } from '../lib/ui';
import { needsFollowUp, getFollowups } from '../core/proposals';
import { PS, isInPreparation, isWon, isLost, lineTotals, fmtMoney, currencyOf, ownerName, entityById, teamMember } from '../lib/commercial';
import { applyFilters } from '../lib/filters';
import { registerTabRenderer, getActiveTabId } from '../lib/registry';
import { createListNav } from '../lib/listNav';
import { saveCsv } from '../lib/files';
import { renderBulkBar, hideBulkBar } from '../lib/bulkBar';
import { persistProposals } from '../lib/persist';
import { undoToast } from '../lib/ui';
import { updateStatus, updateBadge, changeProposalStatus } from '../core/proposals';
import { refreshAll } from '../lib/registry';
import { LOSS_REASONS } from '../lib/constants';
import { activeTeam } from '../lib/commercial';
import { today } from '../lib/utils';
import type { Proposal } from '../lib/types';

export function dbGetFiltered(): Proposal[] {
  const showArch = (document.getElementById('db-show-archived') as HTMLInputElement | null)?.checked || false;
  const owner = (document.getElementById('db-owner') as HTMLSelectElement | null)?.value || '';
  const entity = (document.getElementById('db-entity') as HTMLSelectElement | null)?.value || '';
  const service = (document.getElementById('db-type') as HTMLSelectElement).value;
  const filtered = applyFilters(
    S.proposals,
    (document.getElementById('db-search') as HTMLInputElement).value,
    (document.getElementById('db-status') as HTMLSelectElement).value,
    '',
    (document.getElementById('db-df') as HTMLInputElement).value,
    (document.getElementById('db-dt') as HTMLInputElement).value,
    showArch
  ).filter((p) => {
    if (service && !(p.lines?.length ? p.lines.some((l) => l.serviceName === service) : p.type === service)) return false;
    if (owner && ownerName(p) !== owner) return false;
    if (entity && String(p.businessEntityId ?? '') !== entity) return false;
    return true;
  });
  filtered.sort((a, b) => {
    let av: any = S.dbSortCol === 'owner' ? ownerName(a) : (a as any)[S.dbSortCol] ?? '';
    let bv: any = S.dbSortCol === 'owner' ? ownerName(b) : (b as any)[S.dbSortCol] ?? '';
    if (typeof av === 'number' || typeof bv === 'number') { av = +(av || 0); bv = +(bv || 0); }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return S.dbSortDir === 'asc' ? cmp : -cmp;
  });
  return filtered;
}

export function renderDB(): void {
  renderProposalViews();
  const filtered = dbGetFiltered();
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / S.PS));
  if (S.dbPage > totalPages) S.dbPage = totalPages;
  const start = (S.dbPage - 1) * S.PS;
  const rows = filtered.slice(start, start + S.PS);
  const cntEl = document.getElementById('db-cnt'); if (cntEl) cntEl.textContent = `${total} proposal${total !== 1 ? 's' : ''}`;
  const infoEl = document.getElementById('pgn-info'); if (infoEl) infoEl.textContent = `Page ${S.dbPage} of ${totalPages}`;
  (document.getElementById('pgn-prev') as HTMLButtonElement).disabled = S.dbPage <= 1;
  (document.getElementById('pgn-next') as HTMLButtonElement).disabled = S.dbPage >= totalPages;
  const tbody = document.getElementById('db-tbody');
  if (!tbody) return;
  const allBox = document.getElementById('db-select-all') as HTMLInputElement | null;
  if (allBox) allBox.checked = rows.length > 0 && rows.every((p) => dbSelected.has(p.id));
  updateDbBulkBar();
  if (rows.length === 0) { tbody.innerHTML = `<tr><td colspan="11">${emptyState({ icon: 'search', title: 'No proposals match these filters', body: 'Try a different search, or clear the filters.', compact: true })}</td></tr>`; return; }
  tbody.innerHTML = rows.map((p) => {
    const cfg = ST[p.status] || { c: 'var(--muted)' };
    const fu = needsFollowUp(p);
    const services = p.lines?.length ? lineTotals(p.lines, p.contractMonths).serviceNames : (p.type && p.type !== '—' ? [p.type] : []);
    const review = p.status === PS.REVIEW ? `<span class="db-review ${p.reviewStatus === 'approved' ? 't-positive' : 't-muted'}">${p.reviewStatus === 'approved' ? 'Approved' : 'Awaiting review'}</span>` : '';
    const monthly = p.monthlyFee ? fmtMoney(p.monthlyFee, currencyOf(p)) : p.oneTimeFee ? `${fmtMoney(p.oneTimeFee, currencyOf(p))} once` : '—';
    return `<tr data-proposal-id="${p.id}" class="rec-tr${p.archived ? ' archived-row' : ''}${fu ? ' db-row-followup' : ''}${dbSelected.has(p.id) ? ' is-selected' : ''}" onclick="if(!event.target.closest('a,button,select,input'))openRecord('proposal', ${p.id})" oncontextmenu="proposalRowMenu(event, ${p.id})">
      <td class="td-chk"><input type="checkbox" ${dbSelected.has(p.id) ? 'checked' : ''} onchange="dbSelect(${p.id}, this.checked)" aria-label="Select SL# ${p.id}"></td>
      <td class="td-id">${p.id}</td>
      <td class="td-c strong" title="${escHtml(p.client)}">${companyLink(p.companyId, p.client)}${p.archived ? ' <span class="chip">Archived</span>' : ''}</td>
      <td class="db-services" title="${escHtml(services.join(', '))}">${services.length ? services.map((sv) => `<span class="chip">${escHtml(sv)}</span>`).join(' ') : '<span class="t-muted">To be confirmed</span>'}</td>
      <td class="td-status">${statusDot(cfg, p.status)}${review}<button class="rec-icon-btn row-more" onclick="proposalRowMenu(event, ${p.id})" title="Change status…" aria-label="Change status of SL# ${p.id}">${icon('more', 14)}</button></td>
      <td class="t-sub">${escHtml(ownerName(p) || '—')}</td>
      <td class="td-d">${fmtDate(p.dateAdded)}</td>
      <td class="td-d">${fmtDate(p.dateSentToClient || p.sentDate)}${fu ? ' <span class="db-fu" title="No answer for over 10 days">follow up</span>' : ''}</td>
      <td class="td-d">${p.dblSignedDate ? `<span class="t-positive">${fmtDate(p.dblSignedDate)}</span>` : '—'}</td>
      <td class="num">${monthly}</td>
      <td class="t-sub">${p.contractMonths ? `${p.contractMonths} mo` : '—'}</td>
    </tr>`;
  }).join('');
}
/** A row's status reads as text; it changes from here (right-click or "…") or on the proposal page. */
export function proposalRowMenu(e: MouseEvent, id: number): void {
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  const items = [
    { label: 'Open', iconName: 'document', run: () => (window as any).openRecord('proposal', id) },
    { label: '', run: () => {}, separator: true },
    ...STATUSES.filter((st) => st !== p.status).map((st) => ({ label: `Status: ${st}`, iconName: 'check', run: () => { void changeProposalStatus(id, st).then(() => renderDB()); } })),
  ];
  if (e.type === 'contextmenu') showContextMenu(e, items);
  else { e.stopPropagation(); showMenuAt(e.currentTarget as HTMLElement, items); }
}
expose('proposalRowMenu', proposalRowMenu);

registerTabRenderer('database', () => {
  if (S.proposalBuilderOpen) return;
  if (S.currentProposalId != null && document.getElementById('pr-detail')?.classList.contains('open')) { (window as any).renderProposalPage?.(); return; }
  S.dbPage = 1;
  renderDB();
});

createListNav<number>({
  tabId: 'database',
  getItems: () => [...document.querySelectorAll<HTMLElement>('#db-tbody tr[data-proposal-id]')].map((el) => Number(el.dataset.proposalId)),
  getEl: (id) => document.querySelector<HTMLElement>(`#db-tbody tr[data-proposal-id="${id}"]`),
  onOpen: (id) => (window as any).openRecord('proposal', id),
});
expose('renderDB', renderDB);

// ── Proposal views: one Proposals module, several ways to look at it ──

type ProposalView = 'all' | 'pending' | 'followup' | 'won' | 'lost';

function currentView(): ProposalView {
  if (S.currentTab === 'pending') return 'pending';
  if (S.currentTab === 'followup') return 'followup';
  const status = (document.getElementById('db-status') as HTMLSelectElement | null)?.value;
  return status === PS.WON ? 'won' : status === PS.LOST ? 'lost' : 'all';
}

export function renderProposalViews(): void {
  const active = currentView();
  const counts: Record<ProposalView, number> = {
    all: S.proposals.filter((p) => !p.archived).length,
    pending: S.proposals.filter((p) => !p.archived && isInPreparation(p)).length,
    followup: getFollowups().length,
    won: S.proposals.filter((p) => !p.archived && isWon(p)).length,
    lost: S.proposals.filter((p) => !p.archived && isLost(p)).length,
  };
  const labels: [ProposalView, string][] = [['all', 'All'], ['pending', 'In preparation'], ['followup', 'Follow-up'], ['won', 'Won'], ['lost', 'Lost']];
  document.querySelectorAll<HTMLElement>('[data-pr-views]').forEach((nav) => {
    nav.innerHTML = labels.map(([v, l]) => `<button class="pr-view${v === active ? ' active' : ''}" onclick="proposalView('${v}')" aria-pressed="${v === active}">${l}<span>${counts[v]}</span></button>`).join('');
  });
}
expose('renderProposalViews', renderProposalViews);

export function proposalView(view: ProposalView): void {
  const w = window as any;
  if (view === 'pending') { w.navToModule('pending'); return; }
  if (view === 'followup') { w.navToModule('followup'); return; }
  if (S.currentTab !== 'database') w.navToModule('database');
  else if (S.currentProposalId != null || S.proposalBuilderOpen) w.navToModuleList('database');
  const status = document.getElementById('db-status') as HTMLSelectElement | null;
  if (status) status.value = view === 'won' ? PS.WON : view === 'lost' ? PS.LOST : '';
  S.dbPage = 1;
  renderDB();
}
expose('proposalView', proposalView);

export function dbFilter(): void { S.dbPage = 1; renderDB(); }
expose('dbFilter', dbFilter);

// The status/type/date/archived filter controls call dbFilter() directly
// (fire once, should stay instant); the search box debounces separately so
// typing doesn't re-filter/re-sort/re-render the whole table per keystroke.
const debouncedDbSearch = debounce(dbFilter, 150);
export function dbSearchChanged(): void { debouncedDbSearch(); }
expose('dbSearchChanged', dbSearchChanged);

export function dbPageChange(d: number): void { S.dbPage += d; renderDB(); }
expose('dbPageChange', dbPageChange);

export function dbSort(col: string): void {
  if (S.dbSortCol === col) S.dbSortDir = S.dbSortDir === 'asc' ? 'desc' : 'asc';
  else { S.dbSortCol = col; S.dbSortDir = 'asc'; }
  S.dbPage = 1;
  renderDB();
}
expose('dbSort', dbSort);

export function dbClear(): void {
  ['db-search', 'db-status', 'db-type', 'db-owner', 'db-entity', 'db-df', 'db-dt'].forEach((id) => { const el = document.getElementById(id) as HTMLInputElement | null; if (el) el.value = ''; });
  S.dbPage = 1;
  renderDB();
}
expose('dbClear', dbClear);

/** Shared CSV export used by both Database and Reports tabs. */
export async function exportCSV(data: Proposal[], filenamePrefix: string): Promise<void> {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const hdr = ['SL#', 'Client', 'Services', 'Status', 'Entity', 'Currency', 'Monthly Fee', 'One-time Fee', 'Contract Months', 'Received', 'Sent Date', 'Signed Date', 'Kickoff Date', 'Owner', 'Reviewer', 'Review', 'Lead Source', 'Finance', 'Hubspot', 'Win/Loss Reason', 'Notes Count', 'Remarks'];
  const lines = [hdr.join(',')];
  for (const p of data) {
    lines.push([
      p.id, q(p.client), q(p.type), q(p.status), q(entityById(p.businessEntityId)?.name), currencyOf(p), p.monthlyFee ?? '', p.oneTimeFee ?? '', p.contractMonths ?? '',
      p.dateAdded || '', p.dateSentToClient || p.sentDate || '', p.dblSignedDate || '', p.kickoffDate || '', q(ownerName(p)), q(teamMember(p.reviewerId)?.name), q(p.reviewStatus),
      q(p.leadSource), p.finance || '', p.hubspot || '', q(p.winLossReason), (p.notes || []).length, q(p.remarks),
    ].join(','));
  }
  await saveCsv(filenamePrefix, lines.join('\n'));
}

export async function exportFiltered(): Promise<void> {
  await exportCSV(dbGetFiltered(), 'MENA_BIG_Database');
}
expose('exportFiltered', exportFiltered);

// ── Selection and bulk actions ──

const dbSelected = new Set<number>();

export function dbSelect(id: number, on: boolean): void {
  if (on) dbSelected.add(id); else dbSelected.delete(id);
  document.querySelector(`#db-tbody tr[data-proposal-id="${id}"]`)?.classList.toggle('is-selected', on);
  updateDbBulkBar();
}
expose('dbSelect', dbSelect);

export function dbSelectAll(on: boolean): void {
  document.querySelectorAll<HTMLElement>('#db-tbody tr[data-proposal-id]').forEach((tr) => {
    const id = Number(tr.dataset.proposalId);
    if (on) dbSelected.add(id); else dbSelected.delete(id);
  });
  renderDB();
}
expose('dbSelectAll', dbSelectAll);

export function dbClearSelection(): void {
  dbSelected.clear();
  renderDB();
}
expose('dbClearSelection', dbClearSelection);

/** Applies a change to every selected proposal, with one undo for all of them. */
function bulkChange(label: string, change: (p: Proposal) => void): void {
  const picked = S.proposals.filter((p) => dbSelected.has(p.id));
  if (!picked.length) return;
  const before = picked.map((p) => [p, structuredClone(p)] as const);
  picked.forEach(change);
  persistProposals();
  updateBadge();
  dbSelected.clear();
  refreshAll();
  undoToast(`${label}: ${picked.length} proposal${picked.length === 1 ? '' : 's'}`, () => {
    for (const [p, copy] of before) Object.assign(p, copy);
    persistProposals();
    updateBadge();
    refreshAll();
  });
}

const BULK_STATUSES = [PS.REQUEST, PS.DRAFTING, PS.REVIEW, PS.SENT, PS.CLIENT_SIGNED, PS.WITHDRAWN];

function updateDbBulkBar(): void {
  if (getActiveTabId() !== 'database') { hideBulkBar('db-bulk'); return; }
  renderBulkBar('db-bulk', dbSelected.size, ['proposal', 'proposals'], [
    { label: 'Status', choices: () => BULK_STATUSES.map((st) => ({ label: st, run: () => bulkChange(`Moved to ${st}`, (p) => { if (p.status !== st) { updateStatus(p.id, st); } }) })) },
    { label: 'Mark lost', danger: true, choices: () => LOSS_REASONS.map((r) => ({ label: r, run: () => bulkChange('Marked lost', (p) => {
      p.status = PS.LOST; p.winLossReason = r; p.snoozedUntil = null;
      p.notes = [...(p.notes || []), { id: Date.now() + p.id, date: today(), text: `[LOST: ${r}]` }];
    }) })) },
    { label: 'Owner', choices: () => activeTeam().map((t) => ({ label: t.name, run: () => bulkChange(`Owner set to ${t.name}`, (p) => { p.ownerId = t.id; p.owner = t.name; }) })) },
    { label: 'Archive', run: () => bulkChange('Archived', (p) => { p.archived = true; p.archivedAt = today(); }) },
    { label: 'Export CSV', run: () => { void exportCSV(S.proposals.filter((p) => dbSelected.has(p.id)), 'MENA_BIG_Proposals_selected'); } },
  ], 'dbClearSelection()', () => S.currentTab === 'database' && S.currentProposalId == null);
}
