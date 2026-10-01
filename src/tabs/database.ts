import { rangeIds } from '../lib/bulkProposals';
import { requestGroupIds, requestSiblings } from '../lib/proposalGroups';
import { proposalBulkActions } from '../core/proposalBulk';
import { pricingShape } from '../lib/pricingShape';
import { cardFor } from '../lib/linesEditor';
import { S } from '../lib/state';
import { companyLink } from '../lib/links';
import { STATUSES } from '../lib/constants';
import { escHtml, expose, debounce } from '../lib/utils';
import { bucketOf, clearBucket, plural, registerStrip, stripHtml, tileHtml } from '../lib/pageKit';
import { pipeFlex, pipelineStrip, stageOfProposal, tableCells } from '../lib/pagesProposals';
import { proposalStaleMonths, type RowActionKind } from '../lib/pagesQueues';
import { followUpCount } from '../lib/followup';
import { queueAct } from './pending';
import { icon } from '../lib/icons';
import { showContextMenu, showMenuAt, menuHead } from '../lib/contextMenu';
import { emptyState } from '../lib/ui';
import { needsFollowUp } from '../core/proposals';
import { withClients } from './followup';
import { PS, isInPreparation, isWon, isLost, lineTotals, currencyOf, ownerName, entityById, teamMember, defaultReviewer } from '../lib/commercial';
import { applyFilters } from '../lib/filters';
import { registerTabRenderer, getActiveTabId } from '../lib/registry';
import { createListNav } from '../lib/listNav';
import { saveCsv } from '../lib/files';
import { renderBulkBar, hideBulkBar } from '../lib/bulkBar';
import { toast } from '../lib/ui';
import { changeProposalStatus, nudgeTipFor } from '../core/proposals';
import { refreshAll } from '../lib/registry';
import { today } from '../lib/utils';
import type { Proposal } from '../lib/types';

export function dbGetFiltered(withBucket = true): Proposal[] {
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
  // A pipeline panel picked on the All view narrows the table to its stage.
  const bucket = withBucket && !currentStatusFilter() ? bucketOf('proposals') : null;
  if (bucket) filtered.splice(0, filtered.length, ...filtered.filter((p) => stageOfProposal(p) === bucket));
  filtered.sort((a, b) => {
    let av: any = S.dbSortCol === 'owner' ? ownerName(a) : (a as any)[S.dbSortCol] ?? '';
    let bv: any = S.dbSortCol === 'owner' ? ownerName(b) : (b as any)[S.dbSortCol] ?? '';
    if (typeof av === 'number' || typeof bv === 'number') { av = +(av || 0); bv = +(bv || 0); }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return S.dbSortDir === 'asc' ? cmp : -cmp;
  });
  return filtered;
}

const currentStatusFilter = () => (document.getElementById('db-status') as HTMLSelectElement | null)?.value || '';

export function renderDB(): void {
  renderProposalViews();
  // The pipeline strip: on the All view, from what the filters leave (before a panel narrows it).
  const strip = document.getElementById('db-strip');
  if (strip) {
    const base = currentStatusFilter() ? [] : dbGetFiltered(false);
    if (bucketOf('proposals') && !base.some((p) => stageOfProposal(p) === bucketOf('proposals'))) clearBucket('proposals');
    strip.innerHTML = base.length ? stripHtml('proposals', pipelineStrip(base), { pipe: true, flex: (p) => pipeFlex(p.count) }) : '';
  }
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
  if (rows.length === 0) { tbody.innerHTML = `<tr><td colspan="8">${emptyState({ icon: 'search', title: 'No proposals match these filters', body: 'Try a different search, or clear the filters.', compact: true })}</td></tr>`; return; }
  const t = today();
  const reviewer = (p: Proposal) => teamMember(p.reviewerId)?.name || defaultReviewer()?.name || 'the reviewer';
  tbody.innerHTML = rows.map((p) => {
    const fu = needsFollowUp(p);
    const stale = p.status === PS.SENT && proposalStaleMonths(p, S.touches, followUpCount(p, S.touches), t) != null;
    const agreementId = S.agreements.find((a) => a.proposalId === p.id)?.id ?? null;
    const c = tableCells(p, { today: t, reviewer: reviewer(p), due: fu, stale, agreementId, shape: pricingShape(p.lines, cardFor) });
    const services = p.lines?.length ? lineTotals(p.lines, p.contractMonths).serviceNames : (p.type && p.type !== '—' ? [p.type] : []);
    const act = c.action ? `<button class="rlink pk-act" onclick="event.stopPropagation();dbAct(event, ${p.id}, '${c.action.kind}')"${c.action.kind === 'followed_up' ? ' aria-haspopup="menu"' : ''}${c.action.kind === 'nudge' ? ` data-tip="${escHtml(nudgeTipFor(p.id))}"` : ''}>${escHtml(c.action.label)}</button>` : '';
    return `<tr data-proposal-id="${p.id}" class="rec-tr${p.archived ? ' archived-row' : ''}${dbSelected.has(p.id) ? ' is-selected' : ''}" onclick="if(!event.target.closest('a,button,select,input'))openRecord('proposal', ${p.id})" oncontextmenu="proposalRowMenu(event, ${p.id})">
      <td class="td-chk"><input type="checkbox" ${dbSelected.has(p.id) ? 'checked' : ''} onclick="dbCheckClick(event, ${p.id})" aria-label="Select SL# ${p.id}"></td>
      <td class="pk-td-co"><div class="pk-co">${tileHtml(p.client, 'pk-tile sm')}<div class="pk-co-t">${companyLink(p.companyId, p.client)}<span class="pk-svc">— ${escHtml(services.join(', ') || 'to be confirmed')}</span>${p.archived ? ' <span class="pk-chip t-grey">Archived</span>' : ''}</div></div></td>
      <td class="mono t-sub">${p.id}</td>
      <td><span class="pk-stage t-${c.chip.tone}"><i></i>${escHtml(c.chip.text)}</span>${c.flag ? ` <span class="pk-chip t-${c.flag.tone}">${escHtml(c.flag.text)}</span>` : ''}</td>
      <td class="num"><span class="pk-age-sm t-${c.tone}">${c.days == null ? '—' : escHtml(plural(c.days, 'day'))}</span></td>
      <td class="num"><span class="pk-mrr${c.monthly === '—' ? ' is-none' : c.shaped ? ' is-shape' : ''}">${escHtml(c.monthly)}</span></td>
      <td class="mono t-sub">${escHtml(ownerName(p) || '—')}</td>
      <td class="num pk-td-act">${act}<button class="rec-icon-btn row-more" onclick="proposalRowMenu(event, ${p.id})" data-tip="Change status…" aria-label="Change status of SL# ${p.id}">${icon('more', 14)}</button></td>
    </tr>`;
  }).join('');
}

/** The table's one next step. */
export function dbAct(e: MouseEvent, id: number, kind: string): void {
  if (kind === 'agreement') {
    const a = S.agreements.find((x) => x.proposalId === id);
    if (a) (window as any).openRecord('agreement', a.id);
    return;
  }
  void queueAct(e, id, kind as RowActionKind).then(() => { if (getActiveTabId() === 'database') renderDB(); });
}
expose('dbAct', dbAct);
registerStrip('proposals', () => { S.dbPage = 1; renderDB(); });

/** A row's status reads as text; it changes from here (right-click or "…") or on the proposal page. */
export function proposalRowMenu(e: MouseEvent, id: number): void {
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  const items = [
    menuHead(`${p.client} — ${p.type || 'Proposal'}`, `Proposal SL# ${p.id} · ${(p.status || '').toLowerCase()}`, { name: p.client || '?' }),
    { label: 'Open', iconName: 'document', shortcut: '↵', run: () => (window as any).openRecord('proposal', id) },
    // Requested together with others: tick the whole set in one go.
    ...(requestSiblings(p, S.proposals).length ? [{ label: `Select the ${requestSiblings(p, S.proposals).length} sent with this`, iconName: 'check', run: () => dbSelectGroup(id) }] : []),
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
    // With clients: every sent proposal (the sidebar badge stays the ones due).
    followup: withClients().length,
    won: S.proposals.filter((p) => !p.archived && isWon(p)).length,
    lost: S.proposals.filter((p) => !p.archived && isLost(p)).length,
  };
  const labels: [ProposalView, string][] = [['all', 'All'], ['pending', 'Pending'], ['followup', 'Follow-up'], ['won', 'Won'], ['lost', 'Lost']];
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
// A checkbox shows on a row on hover and stays on every row once one is ticked; the header's selects them all;
// shift-click takes the rows in between. The bar (core/proposalBulk.ts) then changes them together.

const dbSelected = new Set<number>();
let dbLastTicked: number | null = null;
const dbShownIds = (): number[] => [...document.querySelectorAll<HTMLElement>('#db-tbody tr[data-proposal-id]')].map((tr) => Number(tr.dataset.proposalId));

function paintDbSelection(): void {
  document.querySelectorAll<HTMLElement>('#db-tbody tr[data-proposal-id]').forEach((tr) => {
    const on = dbSelected.has(Number(tr.dataset.proposalId));
    tr.classList.toggle('is-selected', on);
    const box = tr.querySelector<HTMLInputElement>('.td-chk input'); if (box) box.checked = on;
  });
  const all = document.getElementById('db-select-all') as HTMLInputElement | null;
  const shown = dbShownIds();
  if (all) all.checked = shown.length > 0 && shown.every((id) => dbSelected.has(id));
  updateDbBulkBar();
}

export function dbSelect(id: number, on: boolean): void {
  if (on) dbSelected.add(id); else dbSelected.delete(id);
  dbLastTicked = id;
  paintDbSelection();
}
expose('dbSelect', dbSelect);

/** A click on a row's checkbox: with Shift, every row from the last one ticked to this one takes this one's state. */
export function dbCheckClick(e: MouseEvent, id: number): void {
  const on = (e.currentTarget as HTMLInputElement).checked;
  if (e.shiftKey && dbLastTicked != null && dbLastTicked !== id) {
    for (const x of rangeIds(dbShownIds(), dbLastTicked, id)) { if (on) dbSelected.add(x); else dbSelected.delete(x); }
    dbLastTicked = id;
    paintDbSelection();
    return;
  }
  dbSelect(id, on);
}
expose('dbCheckClick', dbCheckClick);

/** "Select the N sent with this": the proposals requested together with it that this list is showing. */
export function dbSelectGroup(id: number): void {
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  const group = requestGroupIds(p, S.proposals);
  const shown = new Set(dbShownIds());
  const here = group.filter((x) => shown.has(x));
  here.forEach((x) => dbSelected.add(x));
  dbLastTicked = id;
  paintDbSelection();
  if (here.length < group.length) toast(`${group.length - here.length} sent with it ${group.length - here.length === 1 ? 'is' : 'are'} not in this list`, { detail: 'Clear the filters to select the whole set.' });
}
expose('dbSelectGroup', dbSelectGroup);

export function dbSelectAll(on: boolean): void {
  for (const id of dbShownIds()) { if (on) dbSelected.add(id); else dbSelected.delete(id); }
  paintDbSelection();
}
expose('dbSelectAll', dbSelectAll);

export function dbClearSelection(): void {
  dbSelected.clear();
  dbLastTicked = null;
  paintDbSelection();
}
expose('dbClearSelection', dbClearSelection);

function updateDbBulkBar(): void {
  if (getActiveTabId() !== 'database') { hideBulkBar('db-bulk'); return; }
  renderBulkBar('db-bulk', dbSelected.size, ['proposal', 'proposals'], [
    ...proposalBulkActions(() => [...dbSelected], () => { dbSelected.clear(); dbLastTicked = null; }),
    { label: 'Export CSV', run: () => { void exportCSV(S.proposals.filter((p) => dbSelected.has(p.id)), 'MENA_BIG_Proposals_selected'); } },
  ], 'dbClearSelection()', () => S.currentTab === 'database' && S.currentProposalId == null);
}
