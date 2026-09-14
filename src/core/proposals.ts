import { S } from '../lib/state';
import { STATUSES, WIN_REASONS, LOSS_REASONS } from '../lib/constants';
import { today, fmtDate, daysSince, daysUntil, escHtml, expose, positionFloatingPopup, showTextPrompt, showConfirm, localIsoDate } from '../lib/utils';
import { matchesProposalPeriod } from '../lib/period';
import { persistProposals } from '../lib/persist';
import { registerBadgeUpdater, refreshAll, getActiveTabId, renderTab } from '../lib/registry';
import { toast } from '../lib/ui';
import { syncAgreementsFromProposals } from './agreements';
import { PS, stageIndex, isLost, isWithdrawn, defaultReviewer, teamMember, renewalsDue, activeMrr, pipelineMonthly, fmtMoneyByCurrency } from '../lib/commercial';
import type { Proposal } from '../lib/types';

// ═══════════════ PERSISTENCE / LOAD ═══════════════

/** Fills milestone dates that older records never stored, from the dates
 * they do have. Run after every full data load. */
export function backfillMilestoneDates(): void {
  S.proposals.forEach((p) => {
    const stage = stageIndex(p.status);
    const closed = isLost(p) || isWithdrawn(p);
    if (!p.dateSentToHassan && p.sentDate && (stage >= stageIndex(PS.REVIEW) || closed)) p.dateSentToHassan = p.sentDate;
    if (!p.dateSentToClient && p.sentDate && (stage >= stageIndex(PS.SENT) || closed)) p.dateSentToClient = p.sentDate;
    if (!p.dateSigned && p.dblSignedDate && stage >= stageIndex(PS.CLIENT_SIGNED)) p.dateSigned = p.dblSignedDate;
  });
}

// ═══════════════ FOLLOW-UP / SNOOZE / RENEWALS ═══════════════

export function isSnoozed(p: Proposal): boolean {
  if (!p.snoozedUntil) return false;
  return new Date(p.snoozedUntil + 'T23:59:59') > new Date();
}

/** Sent to the client over 10 days ago with no answer yet. */
export function needsFollowUp(p: Proposal): boolean {
  const sent = p.dateSentToClient || p.sentDate;
  return !p.archived && p.status === PS.SENT && !!sent && (daysSince(sent) || 0) > 10;
}

export function getSnoozed(): Proposal[] {
  return S.proposals
    .filter((p) => needsFollowUp(p) && matchesProposalPeriod(p) && isSnoozed(p))
    .sort((a, b) => (a.snoozedUntil || '').localeCompare(b.snoozedUntil || ''));
}

export function getFollowups(): Proposal[] {
  return S.proposals
    .filter((p) => needsFollowUp(p) && !isSnoozed(p) && matchesProposalPeriod(p))
    .sort((a, b) => (daysSince(b.dateSentToClient || b.sentDate) || 0) - (daysSince(a.dateSentToClient || a.sentDate) || 0));
}

// ═══════════════ BADGE + ALERTS ═══════════════

export function updateBadge(): void {
  const fu = getFollowups();
  const el = document.getElementById('fu-badge');
  const al = document.getElementById('fu-alert');
  if (el) { el.textContent = String(fu.length); el.style.display = fu.length > 0 ? '' : 'none'; }
  if (al) {
    if (fu.length > 0) {
      al.style.display = '';
      const t = document.getElementById('fu-alert-title'); if (t) t.textContent = `${fu.length} proposal${fu.length > 1 ? 's' : ''} need follow-up`;
      const s = document.getElementById('fu-alert-sub'); if (s) s.textContent = `Sent proposals awaiting response for 10+ days.`;
    } else al.style.display = 'none';
  }
  const rn = renewalsDue(60);
  const ra = document.getElementById('renew-alert');
  if (ra) {
    if (rn.length > 0) {
      ra.style.display = '';
      const t = document.getElementById('renew-alert-title'); if (t) t.textContent = `${rn.length} agreement${rn.length > 1 ? 's' : ''} ending within 60 days`;
      const s = document.getElementById('renew-alert-sub');
      if (s) {
        s.textContent = rn.slice(0, 2).map((a) => {
          const du = daysUntil(a.endDate);
          return `${a.client || a.agrRef} (${du !== null && du < 0 ? 'ended' : du + 'd'})`;
        }).join(', ') + (rn.length > 2 ? ' +more' : '');
      }
    } else ra.style.display = 'none';
  }
  const dp = S.proposals.filter((p) => matchesProposalPeriod(p));
  const kpiMrr = document.getElementById('kpi-mrr'); if (kpiMrr) kpiMrr.textContent = fmtMoneyByCurrency(activeMrr());
  const kpiPipe = document.getElementById('kpi-pipe-mrr'); if (kpiPipe) kpiPipe.textContent = fmtMoneyByCurrency(pipelineMonthly(dp));
  const kpiRenew = document.getElementById('kpi-renew'); if (kpiRenew) kpiRenew.textContent = String(rn.length);
}
registerBadgeUpdater(updateBadge);

// ═══════════════ STATUS UPDATE ═══════════════

/** Records a status change with the dates and review state that go with it.
 * No questions asked — use changeProposalStatus from the UI. */
export function updateStatus(id: number, newStatus: string): void {
  const p = S.proposals.find((x) => x.id === id);
  if (!p || p.status === newStatus) return;
  p.status = newStatus;
  const td = today();
  if (newStatus === PS.REVIEW) {
    if (!p.dateSentToHassan) p.dateSentToHassan = td;
    if (p.reviewerId == null) p.reviewerId = defaultReviewer()?.id ?? null;
    p.reviewStatus = 'pending';
    p.reviewRequestedAt = td;
    p.reviewedAt = null;
    p.reviewNote = null;
  }
  if (newStatus === PS.SENT && !p.dateSentToClient) { p.dateSentToClient = td; if (!p.sentDate) p.sentDate = td; }
  if ((newStatus === PS.CLIENT_SIGNED || newStatus === PS.WON) && !p.dateSigned) p.dateSigned = td;
  if (newStatus === PS.WON && !p.dblSignedDate) p.dblSignedDate = td;
  persistProposals();
  updateBadge();
  if (newStatus === PS.WON) syncAgreementsFromProposals();
  refreshAll();
}
expose('updateStatus', updateStatus);

/** Status change from any screen: winning or losing asks for the reason,
 * and sending an unreviewed proposal asks first (every proposal is reviewed). */
export async function changeProposalStatus(id: number, newStatus: string): Promise<boolean> {
  const p = S.proposals.find((x) => x.id === id);
  if (!p || p.status === newStatus) return false;
  if (newStatus === PS.WON) { openWlModal(id, 'won'); return false; }
  if (newStatus === PS.LOST) { openWlModal(id, 'lost'); return false; }
  if (newStatus === PS.SENT && stageIndex(p.status) < stageIndex(PS.SENT) && p.reviewStatus !== 'approved') {
    const reviewer = teamMember(p.reviewerId)?.name || defaultReviewer()?.name || 'the reviewer';
    const ok = await showConfirm(`${reviewer} hasn't approved this proposal in MENA One yet. Every proposal is reviewed before it goes to the client.\n\nMark it as sent anyway?`, { title: 'Not reviewed yet', confirmLabel: 'Mark as sent' });
    if (!ok) return false;
  }
  updateStatus(id, newStatus);
  return true;
}
expose('changeProposalStatus', changeProposalStatus);

/** Status select in a list: apply, or put the select back if the change was cancelled. */
export async function statusSelectChanged(id: number, el: HTMLSelectElement): Promise<void> {
  const changed = await changeProposalStatus(id, el.value);
  const p = S.proposals.find((x) => x.id === id);
  if (!changed && p) el.value = p.status;
}
expose('statusSelectChanged', statusSelectChanged);

/** Review outcome recorded on the reviewer's behalf. */
export function recordReview(id: number, outcome: 'approved' | 'changes_requested', note: string | null): void {
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  if (p.reviewerId == null) p.reviewerId = defaultReviewer()?.id ?? null;
  p.reviewStatus = outcome;
  p.reviewedAt = today();
  p.reviewNote = note?.trim() || null;
  if (outcome === 'changes_requested' && p.status === PS.REVIEW) p.status = PS.DRAFTING;
  persistProposals();
  refreshAll();
}
expose('recordReview', recordReview);

export async function deleteProposal(id: number): Promise<void> {
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  if (await showConfirm(`Permanently delete:\n\n"${p.client} — ${p.type}" (SL# ${id})\n\nThis cannot be undone.`, { confirmLabel: 'Delete' })) {
    S.proposals = S.proposals.filter((x) => x.id !== id);
    persistProposals();
    refreshAll();
  }
}
expose('deleteProposal', deleteProposal);

export async function removeProposal(id: number): Promise<void> {
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  if (await showConfirm(`Remove "${p.client} — ${p.type}" (SL# ${id}) from the tracker permanently?\n\nThis cannot be undone.`, { confirmLabel: 'Remove' })) {
    S.proposals = S.proposals.filter((x) => x.id !== id);
    persistProposals();
    refreshAll();
  }
}
expose('removeProposal', removeProposal);

// ═══════════════ SNOOZE ═══════════════

export function snoozeProposal(id: number, days: number): void {
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  const d = new Date();
  d.setDate(d.getDate() + days);
  p.snoozedUntil = localIsoDate(d);
  persistProposals();
  document.querySelectorAll('.snooze-popup.open').forEach((el) => el.classList.remove('open'));
  refreshAll();
}
expose('snoozeProposal', snoozeProposal);

export async function snoozeCustom(id: number): Promise<void> {
  const days = parseInt((await showTextPrompt({ title: 'Snooze for how many days?', defaultValue: '3' })) || '');
  if (!isNaN(days) && days > 0) snoozeProposal(id, days);
}
expose('snoozeCustom', snoozeCustom);

export function unsnoozeProposal(id: number): void {
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  p.snoozedUntil = null;
  persistProposals();
  refreshAll();
}
expose('unsnoozeProposal', unsnoozeProposal);

export function toggleSnoozePopup(id: number | string, btn?: HTMLElement): void {
  document.querySelectorAll('.snooze-popup.open').forEach((el) => {
    if (el.id !== `snooze-pop-${id}`) el.classList.remove('open');
  });
  const pop = document.getElementById(`snooze-pop-${id}`);
  if (!pop) return;
  const opening = !pop.classList.contains('open');
  pop.classList.toggle('open');
  if (opening) {
    const anchor = btn || (pop.previousElementSibling as HTMLElement) || pop.parentElement!;
    positionFloatingPopup(pop, anchor);
  }
}
expose('toggleSnoozePopup', toggleSnoozePopup);

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest?.('.btn-snooze')) {
    document.querySelectorAll('.snooze-popup.open').forEach((el) => el.classList.remove('open'));
  }
});

// ═══════════════ DOCUMENT LINKS ═══════════════

export function saveDocLink(id: number, url: string): void {
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  p.docLink = url.trim() || null;
  persistProposals();
  if (getActiveTabId() === 'database') renderTab('database');
}
expose('saveDocLink', saveDocLink);

export function saveRemarks(id: number, text: string): void {
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  p.remarks = text.trim() || null;
  persistProposals();
  if (getActiveTabId() === 'database') renderTab('database');
}
expose('saveRemarks', saveRemarks);

// ═══════════════ ARCHIVE ═══════════════

export function archiveProposal(id: number): void {
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  p.archived = true;
  p.archivedAt = today();
  persistProposals();
  refreshAll();
}
expose('archiveProposal', archiveProposal);

export function unarchiveProposal(id: number): void {
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  p.archived = false;
  p.archivedAt = null;
  persistProposals();
  refreshAll();
}
expose('unarchiveProposal', unarchiveProposal);

// ═══════════════ ACTIVITY LOG / NOTES MODAL ═══════════════

export function openNotesModal(id: number): void {
  S.notesTargetId = id;
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  const clientEl = document.getElementById('notes-client'); if (clientEl) clientEl.textContent = `${p.client} — ${p.type} (SL# ${p.id})`;
  const inputEl = document.getElementById('notes-input') as HTMLTextAreaElement | null; if (inputEl) inputEl.value = '';
  renderActivityNotesList(p);
  document.getElementById('modal-notes')?.classList.add('open');
}
expose('openNotesModal', openNotesModal);

function renderActivityNotesList(p: Proposal): void {
  const notes = (p.notes || []).slice().reverse();
  const list = document.getElementById('activity-notes-list');
  if (!list) return;
  list.innerHTML = notes.length === 0
    ? `<div class="note-empty">No notes yet — log a call, email or meeting below.</div>`
    : notes.map((n) => `<div class="activity-note-item"><div class="note-date">${fmtDate(n.date)} — ${n.date}</div><div class="note-text">${escHtml(n.text)}</div></div>`).join('');
}

export function addNote(): void {
  const input = document.getElementById('notes-input') as HTMLTextAreaElement | null;
  const text = input?.value.trim();
  if (!text) return;
  const p = S.proposals.find((x) => x.id === S.notesTargetId);
  if (!p) return;
  if (!p.notes) p.notes = [];
  p.notes.push({ id: Date.now(), date: today(), text });
  if (input) input.value = '';
  persistProposals();
  renderActivityNotesList(p);
  if (getActiveTabId() === 'database') renderTab('database');
  else if (getActiveTabId() === 'followup') renderTab('followup');
}
expose('addNote', addNote);

export function closeNotesModal(): void {
  document.getElementById('modal-notes')?.classList.remove('open');
}
expose('closeNotesModal', closeNotesModal);

// ═══════════════ STATUS MODAL ═══════════════

export function openStatusModal(id: number): void {
  S.statusTargetId = id;
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  const clientEl = document.getElementById('status-modal-client'); if (clientEl) clientEl.textContent = `${p.client} — ${p.type}`;
  const sel = document.getElementById('status-modal-sel');
  if (sel) sel.innerHTML = STATUSES.map((s) => `<option value="${escHtml(s)}" ${p.status === s ? 'selected' : ''}>${escHtml(s)}</option>`).join('');
  document.getElementById('modal-status')?.classList.add('open');
}
expose('openStatusModal', openStatusModal);

export function applyStatusModal(): void {
  const sel = document.getElementById('status-modal-sel') as HTMLSelectElement | null;
  const st = sel?.value;
  document.getElementById('modal-status')?.classList.remove('open');
  if (st != null && S.statusTargetId != null) void changeProposalStatus(S.statusTargetId, st);
}
expose('applyStatusModal', applyStatusModal);

// ═══════════════ WIN / LOSS ═══════════════

export interface OutcomeDialog {
  mode: 'won' | 'lost';
  title: string;
  subtitle: string;
  withDate: boolean;
  date?: string | null;
  /** Reason is required for a loss. */
  onConfirm: (result: { reason: string; note: string; date: string }) => void;
}

let outcome: OutcomeDialog | null = null;

/** Won/lost dialog shared by proposals and opportunities. */
export function openOutcomeDialog(dialog: OutcomeDialog): void {
  outcome = dialog;
  const isWon = dialog.mode === 'won';
  const titleEl = document.getElementById('wl-title'); if (titleEl) titleEl.textContent = dialog.title;
  const clientEl = document.getElementById('wl-client'); if (clientEl) clientEl.textContent = dialog.subtitle;
  const lblEl = document.getElementById('wl-reason-lbl'); if (lblEl) lblEl.textContent = isWon ? 'Why did we win it?' : 'Why was it lost?';
  const reasons = isWon ? WIN_REASONS : LOSS_REASONS;
  const reasonSel = document.getElementById('wl-reason'); if (reasonSel) reasonSel.innerHTML = `<option value="">Choose a reason…</option>` + reasons.map((r) => `<option value="${escHtml(r)}">${escHtml(r)}</option>`).join('');
  const dateWrap = document.getElementById('wl-date-grp'); if (dateWrap) dateWrap.hidden = !dialog.withDate;
  const dateEl = document.getElementById('wl-date') as HTMLInputElement | null; if (dateEl) dateEl.value = dialog.date || today();
  const btn = document.getElementById('wl-confirm-btn') as HTMLButtonElement | null;
  if (btn) { btn.textContent = isWon ? 'Mark as won' : 'Mark as lost'; btn.classList.toggle('btn-danger', !isWon); }
  const noteEl = document.getElementById('wl-note') as HTMLTextAreaElement | null; if (noteEl) noteEl.value = '';
  document.getElementById('modal-wl')?.classList.add('open');
  reasonSel?.focus();
}

export function openWlModal(id: number, mode: 'won' | 'lost'): void {
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  const isWon = mode === 'won';
  openOutcomeDialog({
    mode,
    title: isWon ? 'Signed by both parties' : 'Mark as lost',
    subtitle: `${p.client} — ${p.type || 'Proposal'}`,
    withDate: isWon,
    date: p.dblSignedDate,
    onConfirm: ({ reason, note, date }) => {
      if (isWon) {
        p.dblSignedDate = date;
        if (!p.dateSigned) p.dateSigned = date;
      }
      p.status = isWon ? PS.WON : PS.LOST;
      p.winLossReason = reason || null;
      p.snoozedUntil = null;
      if (note || reason) {
        if (!p.notes) p.notes = [];
        p.notes.push({ id: Date.now(), date: today(), text: `[${isWon ? 'WON' : 'LOST'}${reason ? `: ${reason}` : ''}]${note ? ` ${note}` : ''}` });
      }
      persistProposals();
      updateBadge();
      if (isWon) syncAgreementsFromProposals();
      refreshAll();
      toast(isWon ? 'Marked as won — its agreement is being prepared' : 'Marked as lost', { tone: isWon ? 'success' : 'neutral' });
    },
  });
}
expose('openWlModal', openWlModal);

export function closeWlModal(): void {
  outcome = null;
  document.getElementById('modal-wl')?.classList.remove('open');
}
expose('closeWlModal', closeWlModal);

export function confirmWinLoss(): void {
  if (!outcome) return;
  const reasonSel = document.getElementById('wl-reason') as HTMLSelectElement | null;
  const reason = reasonSel?.value || '';
  if (outcome.mode === 'lost' && !reason) { toast('Choose why it was lost', { tone: 'error' }); reasonSel?.focus(); return; }
  const note = ((document.getElementById('wl-note') as HTMLTextAreaElement | null)?.value || '').trim();
  const date = (document.getElementById('wl-date') as HTMLInputElement | null)?.value || today();
  const current = outcome;
  closeWlModal();
  current.onConfirm({ reason, note, date });
}
expose('confirmWinLoss', confirmWinLoss);

// ═══════════════ ADD / EDIT PROPOSAL ═══════════════

/** Editing happens on the proposal's page; a new proposal opens the
 * new-proposal page. Kept under the old name for every existing caller. */
export function openAddModal(editId?: number | null, prefill?: { client?: string; opportunityId?: number }): void {
  const w = window as any;
  if (editId != null) { w.openRecord('proposal', editId); return; }
  w.openProposalBuilder?.(prefill || {});
}
expose('openAddModal', openAddModal);

/** Registered by main.ts so this module can trigger a full selects/filters
 * repopulate (client datalists, status/type dropdowns) without importing
 * every tab module directly. */
let populateAllSelectsFn: () => void = () => {};
export function registerPopulateAllSelects(fn: () => void): void {
  populateAllSelectsFn = fn;
}
function populateAllSelects(): void {
  populateAllSelectsFn();
}
