import { createListNav } from '../lib/listNav';
import { S } from '../lib/state';
import { emptyState } from '../lib/ui';
import { companyLink } from '../lib/links';
import { WQ_STATUSES, WQ_CFG } from '../lib/constants';
import { today, fmtDate, escHtml, expose, showConfirm } from '../lib/utils';
import { matchesProposalPeriod } from '../lib/period';
import { registerTabRenderer, registerBadgeUpdater, refreshAll, getActiveTabId } from '../lib/registry';
import { persistProposals } from '../lib/persist';
import { changeProposalStatus, snoozeProposal, snoozeCustom, archiveProposal, openNotesModal, openRevisionDialog, openWlModal, nudgeReview, followUpMenu } from '../core/proposals';
import { showContextMenu } from '../lib/contextMenu';
import { icon } from '../lib/icons';
import { PS, teamMember, defaultReviewer, ownerName } from '../lib/commercial';
import type { Proposal } from '../lib/types';
import { pendingRuns } from '../lib/queues';
import { ageHtml, groupHeadHtml, registerStrip, stripHtml, stripPick, tileHtml, valueHtml, bucketOf, clearBucket } from '../lib/pageKit';
import { pricingShape } from '../lib/pricingShape';
import { cardFor } from '../lib/linesEditor';
import { pendingRow, pendingStrip, PENDING_GROUP, PENDING_ORDER, inBucket, type QueueRow, type RowActionKind } from '../lib/pagesQueues';
import { proposalContact, companyIndustry, personHtml } from '../lib/pagePeople';

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

const reviewerName = (p?: Proposal) => teamMember(p?.reviewerId)?.name || defaultReviewer()?.name || 'the reviewer';

/** The latest proposal deck on file (its version), for "deck V1 in folder". */
const latestDeck = (p: Proposal) => Math.max(0, ...(p.documents || []).filter((d) => d.kind === 'proposal').map((d) => d.version ?? 1)) || null;

export function renderPending(): void {
  (window as any).renderProposalViews?.();
  const search = ((document.getElementById('wq-search') as HTMLInputElement | null)?.value || '').toLowerCase().trim();
  const sort = (document.getElementById('wq-sort') as HTMLSelectElement | null)?.value || 'age';
  const t = today();
  const reviewer = reviewerName();
  const sub = document.getElementById('wq-sub');
  if (sub) sub.textContent = `Proposals waiting on you or on ${reviewer.split(' ')[0]} before they go to the client.`;

  const all = getPendingProposals().filter((p) => !search || [p.client, p.type, p.owner, ownerName(p), `sl# ${p.id}`, String(p.id)].some((v) => (v || '').toLowerCase().includes(search)));
  const rowOf = new Map<number, QueueRow>();
  for (const p of all) {
    const r = pendingRow(p, { today: t, reviewer: reviewerName(p), latestDeck: latestDeck(p), shape: pricingShape(p.lines, cardFor) });
    if (r) rowOf.set(p.id, r);
  }
  const rows = [...rowOf.values()];
  // A picked panel whose bucket has emptied lets go.
  if (bucketOf('pending') && !rows.some((r) => inBucket(r, bucketOf('pending')))) clearBucket('pending');
  const bucket = bucketOf('pending');

  const strip = document.getElementById('wq-strip');
  if (strip) strip.innerHTML = rows.length ? stripHtml('pending', pendingStrip(rows, all, { reviewer, today: t })) : '';
  const cntEl = document.getElementById('wq-cnt'); if (cntEl) cntEl.textContent = `${rows.length} pending`;

  const container = document.getElementById('wq-content');
  if (!container) return;
  if (rows.length === 0) {
    container.innerHTML = `<div class="sec">${emptyState({ icon: 'check', title: search ? 'No pending proposal matches' : 'No pending proposals', body: search ? 'Try another name or SL#.' : 'Every proposal has been drafted and sent.' })}</div>`;
    setNewPrimary(true);
  } else {
    // One blue button per page: the most urgent row's next step, if any row has one; else New proposal.
    const shown = PENDING_ORDER.filter((b) => inBucket({ bucket: b }, bucket));
    const ordered: { b: (typeof PENDING_ORDER)[number]; runs: ReturnType<typeof pendingRuns<Proposal>> }[] = shown.map((b) => ({ b, runs: pendingRuns(all.filter((p) => rowOf.get(p.id)?.bucket === b), sort) }));
    const primaryId = ordered.flatMap((g) => g.runs.flatMap((r) => r.items)).map((p) => rowOf.get(p.id)!).find((r) => r.urgent)?.id ?? null;
    setNewPrimary(primaryId == null);
    container.innerHTML = ordered.map(({ b, runs }) => {
      const n = runs.reduce((k, r) => k + r.items.length, 0);
      if (!n) return '';
      const g = PENDING_GROUP[b];
      const body = runs.map((r) => (r.group ? `<div class="pq-together">Requested together · ${escHtml(fmtDate(r.items.map((p) => p.dateAdded || '').sort().pop() || r.date))}</div>` : '')
        + r.items.map((p) => queueRowHtml(rowOf.get(p.id)!, { primary: p.id === primaryId, who: whoOf(p, b === 'review') })).join('')).join('');
      return `<section class="pk-group">${groupHeadHtml({ tone: g.tone, name: g.name(reviewer), count: n, note: g.note })}<div class="pk-list">${body}</div></section>`;
    }).join('');
  }

  if (S.wqShowArchived) {
    const archPending = S.proposals.filter((p) => p.archived && WQ_STATUSES.includes(p.status));
    container.innerHTML += archPending.length
      ? `<section class="pk-group is-archived">${groupHeadHtml({ tone: 'grey', name: 'Archived', count: archPending.length })}<div class="pk-list">${archPending.map((p) => `<div class="pq-row">
          <div class="pq-main"><div class="pq-title">${companyLink(p.companyId, p.client)}<span class="pq-services">${escHtml(p.type || '')}</span></div>
          <div class="pq-meta">${escHtml((WQ_CFG[p.status] || { label: p.status }).label)} · archived ${fmtDate(p.archivedAt || '')}</div></div>
          <div class="pq-actions"><button class="btn-secondary btn-sm" onclick="unarchiveProposal(${p.id});renderPending()">Unarchive</button></div>
        </div>`).join('')}</div></section>`
      : `<div class="soft-note">No archived pending proposals.</div>`;
  }
}
registerTabRenderer('pending', () => { renderPending(); });
registerStrip('pending', () => renderPending());
expose('renderPending', renderPending);
expose('stripPick', stripPick);

/** New proposal is the page's blue button unless a row's next step holds it. */
function setNewPrimary(on: boolean): void {
  const b = document.getElementById('wq-new');
  if (!b) return;
  b.classList.toggle('btn-primary', on);
  b.classList.toggle('btn-secondary', !on);
}

/** The "who" column: the client's contact and industry, or the reviewer for a proposal in review. */
export function whoOf(p: Proposal, reviewer = false): string {
  if (reviewer) return personHtml(reviewerName(p), '');
  const c = proposalContact(p);
  return personHtml(c?.name || null, companyIndustry(p.companyId));
}

/** One queue row (Pending, Follow-up): tile, client — service and SL#, one meta line, who, value, age, actions and "…". */
export function queueRowHtml(r: QueueRow, o: { primary: boolean; who: string; below?: string }): string {
  const meta = r.meta.map((m) => (m.chip ? `<span class="pk-chip t-${m.tone || 'amber'}">${escHtml(m.text)}</span>` : m.tone ? `<span class="t-${m.tone}">${escHtml(m.text)}</span>` : escHtml(m.text))).join('<span class="pk-sep">·</span>');
  const acts = r.actions.map((a, i) => {
    const blue = o.primary && i === r.actions.length - 1;
    const chevron = a.kind === 'followed_up' ? ` ${icon('chevronDown', 11)}` : '';
    return `<button class="${blue ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="event.stopPropagation();queueAct(event, ${r.id}, '${a.kind}')"${a.kind === 'followed_up' ? ' aria-haspopup="menu"' : ''}>${escHtml(a.label)}${chevron}</button>`;
  }).join('');
  return `<div class="pq-row pk-row${o.below ? ' has-below' : ''}" data-row-id="${r.id}" onclick="if(!event.target.closest('a,button'))openRecord('proposal', ${r.id})" oncontextmenu="pqMenu(event, ${r.id})">
    ${tileHtml(r.client)}
    <div class="pk-main">
      <div class="pk-title">${companyLink(r.companyId, r.client)}<span class="pk-svc">— ${escHtml(r.service)}</span><span class="pk-sl">SL# ${r.id}</span></div>
      <div class="pk-meta">${meta}</div>${o.below || ''}
    </div>
    <div class="pk-who">${o.who}</div>
    ${valueHtml(r.amount, r.amountCaption, r.amountShape)}
    ${ageHtml(r.age, r.ageCaption, r.tone)}
    <div class="pk-acts">${acts}</div>
    <button class="rec-icon-btn pk-more" onclick="event.stopPropagation();pqMenu(event, ${r.id})" data-tip="More" aria-label="More">${icon('more', 14)}</button>
  </div>`;
}

/** A row's action, by kind (Pending and Follow-up). */
export async function queueAct(e: MouseEvent, id: number, kind: RowActionKind): Promise<void> {
  const w = window as any;
  switch (kind) {
    case 'draft': return wqAdvance(id, PS.DRAFTING);
    case 'generate': return w.openGenerateProposal(id);
    case 'review': return wqAdvance(id, PS.REVIEW);
    case 'nudge': return nudgeReview(id);
    case 'record': return w.openRecord('proposal', id);
    case 'mark_sent': return wqAdvance(id, PS.SENT);
    case 'changes': return openRevisionDialog(id);
    case 'followed_up': return followUpMenu(e, id);
    case 'mark_lost': return openWlModal(id, 'lost');
  }
}
expose('queueAct', queueAct);

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
  ['wq-search', 'wq-sort'].forEach((id) => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (el) { if (el.tagName === 'SELECT') (el as HTMLSelectElement).selectedIndex = 0; else el.value = ''; }
  });
  renderPending();
}
expose('wqClear', wqClear);

// ↑↓ or j k move through the rows, Enter opens one (delight 7).
createListNav<number>({
  tabId: 'pending',
  getItems: () => [...document.querySelectorAll<HTMLElement>('#tab-pending .pq-row[data-row-id]')].map((el) => Number(el.dataset.rowId)),
  getEl: (id) => document.querySelector<HTMLElement>(`#tab-pending .pq-row[data-row-id="${id}"]`),
  onOpen: (id) => (window as any).openRecord('proposal', id),
});
