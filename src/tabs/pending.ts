import { S } from '../lib/state';
import { emptyState } from '../lib/ui';
import { companyLink } from '../lib/links';
import { WQ_STATUSES, WQ_CFG } from '../lib/constants';
import { today, fmtDate, daysSince, escHtml, expose, kpiCard, statusDot, showConfirm, fmtDateShort } from '../lib/utils';
import { matchesProposalPeriod } from '../lib/period';
import { registerTabRenderer, registerBadgeUpdater, refreshAll, getActiveTabId } from '../lib/registry';
import { persistProposals } from '../lib/persist';
import { changeProposalStatus, snoozeProposal, snoozeCustom, archiveProposal, openNotesModal, openRevisionDialog, openWlModal } from '../core/proposals';
import { showContextMenu } from '../lib/contextMenu';
import { icon } from '../lib/icons';
import { PS, teamMember, defaultReviewer, ownerName, fmtMoney, currencyOf } from '../lib/commercial';
import type { Proposal } from '../lib/types';
import { pendingRuns } from '../lib/queues';

export function getPendingProposals(): Proposal[] {
  return S.proposals.filter((p) => !p.archived && matchesProposalPeriod(p) && WQ_STATUSES.includes(p.status));
}

export function updatePendingBadge(): void {
  const n = S.proposals.filter((p) => !p.archived && p.status === PS.REQUEST).length;
  const el = document.getElementById('pending-badge');
  if (el) { el.textContent = String(n); el.style.display = n > 0 ? '' : 'none'; }
}
registerBadgeUpdater(updatePendingBadge);
expose('updatePendingBadge', updatePendingBadge);

export function wqAgeClass(days: number | null): string {
  if (days === null) return 'age-fresh';
  if (days < 3) return 'age-fresh';
  if (days < 7) return 'age-warn';
  if (days < 14) return 'age-late';
  return 'age-urgent';
}

export function wqAgeColor(days: number | null): string {
  if (days === null || days < 3) return 'var(--green)';
  if (days < 14) return 'var(--amber)';
  return 'var(--red)';
}

export function toggleWqArchived(): void {
  S.wqShowArchived = !S.wqShowArchived;
  const btn = document.getElementById('wq-toggle-archived');
  if (btn) {
    btn.classList.toggle('active', S.wqShowArchived);
    btn.textContent = S.wqShowArchived ? 'Hide archived' : 'Show archived';
  }
  renderPending();
}
expose('toggleWqArchived', toggleWqArchived);

export async function archiveAllPending(): Promise<void> {
  const pending = getPendingProposals();
  if (pending.length === 0) return;
  if (!(await showConfirm(`Archive all ${pending.length} pending proposal${pending.length > 1 ? 's' : ''}?\n\nThey will be hidden from this tab but stay under Proposals with “Show archived”.`, { confirmLabel: 'Archive all' }))) return;
  pending.forEach((p) => { p.archived = true; p.archivedAt = today(); });
  persistProposals();
  refreshAll();
}
expose('archiveAllPending', archiveAllPending);

export function renderPending(): void {
  (window as any).renderProposalViews?.();
  const search = ((document.getElementById('wq-search') as HTMLInputElement).value || '').toLowerCase();
  const filterStatus = (document.getElementById('wq-filter-status') as HTMLSelectElement).value;
  const sort = (document.getElementById('wq-sort') as HTMLSelectElement).value;

  let data = getPendingProposals().filter((p) => {
    if (filterStatus && p.status !== filterStatus) return false;
    // Search covers the owner (as the row shows it), so there's no separate owner filter.
    if (search && ![p.client, p.type, p.owner, ownerName(p)].some((v) => (v || '').toLowerCase().includes(search))) return false;
    return true;
  });

  if (sort === 'age') data.sort((a, b) => (daysSince(b.dateAdded || b.sentDate) || 0) - (daysSince(a.dateAdded || a.sentDate) || 0));
  else if (sort === 'age-desc') data.sort((a, b) => (daysSince(a.dateAdded || a.sentDate) || 0) - (daysSince(b.dateAdded || b.sentDate) || 0));
  else if (sort === 'client') data.sort((a, b) => a.client.localeCompare(b.client));

  const cntEl = document.getElementById('wq-cnt'); if (cntEl) cntEl.textContent = `${data.length} pending`;

  const container = document.getElementById('wq-content');
  if (!container) return;
  if (data.length === 0) {
    container.innerHTML = `<div class="sec">${emptyState({ icon: 'check', title: 'No pending proposals', body: 'Every proposal has been drafted and sent.' })}</div>`;
    return;
  }

  const groups = WQ_STATUSES.filter((s) => !filterStatus || s === filterStatus);
  let html = '';
  groups.forEach((status) => {
    const group = data.filter((p) => p.status === status);
    if (group.length === 0) return;
    const cfg = WQ_CFG[status];
    // Requested together: side by side under one quiet line, ordered by the oldest.
    const runs = pendingRuns(group, sort);
    html += `<section class="sec pq-group">
      <div class="rec-section-hd"><h2>${statusDot(cfg, cfg.label)}</h2><span class="rec-count">${group.length}</span></div>
      <div class="pq-list">${runs.map((r) => (r.group ? `<div class="pq-together">Requested together · ${escHtml(fmtDate(r.items.map((p) => p.dateAdded || '').sort().pop() || r.date))}</div>` : '') + r.items.map((p) => wqCard(p)).join('')).join('')}</div>
    </section>`;
  });
  container.innerHTML = html;

  if (S.wqShowArchived) {
    const archPending = S.proposals.filter((p) => p.archived && WQ_STATUSES.includes(p.status));
    let archHtml = '';
    if (archPending.length > 0) {
      archHtml = `<section class="sec pq-group is-archived">
        <div class="rec-section-hd"><h2>Archived</h2><span class="rec-count">${archPending.length}</span></div>
        <div class="pq-list">${archPending.map((p) => `<div class="pq-row">
          <div class="pq-main"><div class="pq-title">${companyLink(p.companyId, p.client)}<span class="pq-services">${escHtml(p.type || '')}</span></div>
          <div class="pq-meta">${escHtml((WQ_CFG[p.status] || { label: p.status }).label)} · archived ${fmtDate(p.archivedAt || '')}</div></div>
          <div class="pq-actions"><button class="btn-secondary btn-sm" onclick="unarchiveProposal(${p.id});renderPending()">Unarchive</button></div>
        </div>`).join('')}</div>
      </section>`;
    } else {
      archHtml = `<div class="soft-note">No archived pending proposals.</div>`;
    }
    container.innerHTML += archHtml;
  }
}
registerTabRenderer('pending', () => { renderPending(); });
expose('renderPending', renderPending);

/** "promised by 2 Oct", red once the day has come. Meta only: it changes neither the order nor the age. */
function promisedMeta(p: Proposal): string {
  if (!p.promisedBy) return '';
  const d = new Date(`${p.promisedBy.slice(0, 10)}T12:00:00`);
  const label = isNaN(d.getTime()) ? p.promisedBy : fmtDateShort(d);
  return `<span class="${p.promisedBy.slice(0, 10) <= today() ? 't-red' : ''}">promised by ${escHtml(label)}</span>`;
}

/** One pending proposal: age, client and services, where it is, and the next step. */
export function wqCard(p: Proposal): string {
  const refDate = p.dateAdded || p.sentDate || null;
  const days = daysSince(refDate);
  const cfg = WQ_CFG[p.status] || { step: 1, c: 'var(--muted)', label: p.status };
  const step = cfg.step;
  const nc = (p.notes || []).length;
  const reviewer = teamMember(p.reviewerId)?.name || defaultReviewer()?.name || 'the reviewer';
  const primary = step <= 1 ? `<button class="btn-secondary btn-sm" onclick="wqAdvance(${p.id},'${PS.DRAFTING}')">Start drafting</button>`
    : step === 2 ? `<button class="btn-secondary btn-sm" onclick="wqAdvance(${p.id},'${PS.REVIEW}')" title="Send to ${escHtml(reviewer)} for review">Send for review</button>`
    : p.reviewStatus === 'approved' ? `<button class="btn-primary btn-sm" onclick="wqAdvance(${p.id},'${PS.SENT}')">Mark sent</button>`
    : `<button class="btn-secondary btn-sm" onclick="openRecord('proposal', ${p.id})" title="Record ${escHtml(reviewer)}'s review">Record review</button>`;
  const meta = [
    step === 3 ? `<span class="${p.reviewStatus === 'approved' ? 't-positive' : ''}">${p.reviewStatus === 'approved' ? 'Approved by' : 'With'} ${escHtml(reviewer)}</span>` : '',
    ownerName(p) ? escHtml(ownerName(p)) : '',
    `SL# ${p.id}`,
    refDate ? `added ${fmtDate(refDate)}` : '',
    promisedMeta(p),
    (p.revision ?? 1) > 1 ? `Revision ${p.revision}` : '',
    nc ? `<a href="#" class="rlink" onclick="event.preventDefault();openNotesModal(${p.id})">${nc} note${nc === 1 ? '' : 's'}</a>` : '',
  ].filter(Boolean).join('<span class="pq-sep">·</span>');
  return `<div class="pq-row" onclick="if(!event.target.closest('a,button'))openRecord('proposal', ${p.id})" oncontextmenu="pqMenu(event, ${p.id})">
    <span class="pq-age ${wqAgeClass(days)}" title="${days ?? '?'} days since it was added">${days ?? '?'}<small>d</small></span>
    <div class="pq-main">
      <div class="pq-title">${companyLink(p.companyId, p.client)}<span class="pq-services">${escHtml(p.type || '')}</span></div>
      <div class="pq-meta">${meta}</div>
      ${p.remarks ? `<div class="pq-remarks" title="${escHtml(p.remarks)}">${escHtml(p.remarks)}</div>` : ''}
    </div>
    ${p.monthlyFee ? `<span class="pq-fee">${fmtMoney(p.monthlyFee, currencyOf(p))}<small>/mo</small></span>` : '<span class="pq-fee"></span>'}
    <div class="pq-actions">${primary}<button class="rec-icon-btn" onclick="pqMenu(event, ${p.id})" title="More" aria-label="More">${icon('more', 14)}</button></div>
  </div>`;
}

/** Shared "…" menu for pending and follow-up rows. */
export function pqMenu(e: MouseEvent, id: number): void {
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  const snooze = (days: number) => ({ label: `Snooze ${days} days`, iconName: 'clock', run: () => snoozeProposal(id, days) });
  showContextMenu(e, [
    { label: 'Open', iconName: 'edit', run: () => (window as any).openRecord('proposal', id) },
    { label: `Notes${(p.notes || []).length ? ` (${p.notes.length})` : ''}`, iconName: 'note', run: () => openNotesModal(id) },
    ...(p.status === PS.SENT || p.status === PS.CLIENT_SIGNED ? [
      { label: 'Client asked for changes…', iconName: 'edit', run: () => openRevisionDialog(id) },
    ] : []),
    ...(p.status === PS.SENT ? [
      { label: 'Signed by both parties…', iconName: 'check', run: () => openWlModal(id, 'won') },
      { label: 'Mark lost…', iconName: 'close', run: () => openWlModal(id, 'lost') },
    ] : []),
    { label: '', run: () => {}, separator: true },
    snooze(3), snooze(7), snooze(14),
    { label: 'Snooze until…', iconName: 'calendar', run: () => { void snoozeCustom(id); } },
    { label: '', run: () => {}, separator: true },
    { label: 'Archive', iconName: 'archive', run: () => archiveProposal(id) },
  ]);
}
expose('pqMenu', pqMenu);

export async function wqAdvance(id: number, newStatus: string): Promise<void> {
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  if (newStatus !== PS.SENT && !(await showConfirm(`Move "${p.client} — ${p.type || 'Proposal'}" to "${newStatus}"?`, { title: 'Change status?', confirmLabel: 'Move' }))) return;
  if (!(await changeProposalStatus(id, newStatus))) return;
  updatePendingBadge();
  if (getActiveTabId() === 'pending') renderPending();
}
expose('wqAdvance', wqAdvance);

export function wqClear(): void {
  ['wq-search', 'wq-filter-status', 'wq-sort'].forEach((id) => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (el) { if (el.tagName === 'SELECT') (el as HTMLSelectElement).selectedIndex = 0; else el.value = ''; }
  });
  renderPending();
}
expose('wqClear', wqClear);
