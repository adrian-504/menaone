import { applyStatus } from '../lib/bulkProposals';
import { collapseRow, collapseRows } from '../lib/motion';
import { backInDays, lastTouch, FOLLOW_UP_AFTER_DAYS, WAIT_LONGER_DAYS, type LastTouch } from '../lib/followup';
import { ownDomains } from '../lib/clientMatch';
import { S } from '../lib/state';
import { STATUSES, WIN_REASONS, LOSS_REASONS } from '../lib/constants';
import { today, fmtDate, daysSince, daysUntil, escHtml, expose, showTextPrompt, showConfirm, localIsoDate } from '../lib/utils';
import { matchesProposalPeriod } from '../lib/period';
import { persistProposals, saved } from '../lib/persist';
import { registerBadgeUpdater, refreshAll, getActiveTabId, renderTab } from '../lib/registry';
import { toast, undoToast } from '../lib/ui';
import { optimistic } from '../lib/optimistic';
import { draftAgreementsFromProposals } from './agreements';
import { PS, stageIndex, isLost, isWithdrawn, defaultReviewer, teamMember, renewalsDue, activeMrr, pipelineMonthly, fmtMoneyByCurrency } from '../lib/commercial';
import { applyRevisionRequest, applyRevisionSent } from '../lib/revisions';
import { activityForget, activityLog, activityRemove, touchesAdd, touchesDelete } from '../lib/db';
import { showMenuAt, type ContextMenuItem } from '../lib/contextMenu';
import type { Proposal, Touch, TouchKind } from '../lib/types';

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

/** A contact's first name, for "you emailed Sara". */
export const contactFirstName = (id: number): string | null => (S.contacts.find((c) => c.id === id)?.name || '').trim().split(/\s+/)[0] || null;

/** A sent proposal's latest contact: its notes, the client's emails and meetings,
 * and the follow-ups logged on it since it was sent (lib/followup.ts). */
export function proposalLastTouch(p: Proposal): LastTouch | null {
  return lastTouch(p, { emails: S.emails, meetings: S.meetings, today: today(), ownDomains: ownDomains(), touches: S.touches, contactName: contactFirstName });
}

// ═══════════════ FOLLOW-UP TOUCHES ═══════════════

const TOUCH_WORD: Record<TouchKind, string> = { email_out: 'email', email_in: 'email', call: 'call', whatsapp: 'WhatsApp', meeting: 'meeting' };

/** One click from Follow-up or the proposal page: an email, call, WhatsApp or
 * meeting with the client today, ours or theirs, with the primary contact.
 * No dialog; the toast offers Undo. */
export async function logTouch(proposalId: number, kind: TouchKind, direction: 'out' | 'in' = 'out'): Promise<void> {
  const p = S.proposals.find((x) => x.id === proposalId);
  if (!p) return;
  const draft = { proposalId, companyId: p.companyId ?? null, kind, direction, at: today(), contactId: p.primaryContactId ?? null };
  // Shown at once with a stand-in id; the saved row replaces it (delight 2: optimistic).
  const temp = { ...draft, id: -Date.now(), subject: null, source: 'manual', sourceId: null, createdAt: new Date().toISOString() } as unknown as Touch;
  const redraw = () => { updateBadge(); refreshAll(); if (S.currentProposalId === proposalId) (window as any).renderProposalPage?.(); };
  const t = await optimistic({
    apply: () => { S.touches = [...S.touches, temp]; redraw(); },
    commit: () => touchesAdd(draft),
    revert: () => { S.touches = S.touches.filter((x) => x.id !== temp.id); redraw(); },
  });
  if (!t) return;
  S.touches = [...S.touches.filter((x) => x.id !== temp.id && x.id !== t.id), t];
  redraw();
  const what = direction === 'in' ? `client replied by ${TOUCH_WORD[kind]} today` : `${TOUCH_WORD[kind]} today`;
  undoToast(`Logged: ${what}`, () => { void undoTouch(t.id); });
}
expose('logTouch', logTouch);

async function undoTouch(id: number): Promise<void> {
  await touchesDelete(id);
  S.touches = S.touches.filter((t) => t.id !== id);
  updateBadge();
  refreshAll();
  (window as any).renderProposalPage?.();
}

/** "Followed up ▾": what we did, and below, how the client replied. */
export function followUpMenu(e: MouseEvent, proposalId: number): void {
  e.stopPropagation();
  const log = (kind: TouchKind, direction: 'out' | 'in' = 'out') => () => { void logTouch(proposalId, kind, direction); };
  const items: ContextMenuItem[] = [
    { label: 'Followed up', heading: true, run: () => {} },
    { label: 'Email', run: log('email_out') },
    { label: 'Call', run: log('call') },
    { label: 'WhatsApp', run: log('whatsapp') },
    { label: 'Met', run: log('meeting') },
    { label: '', run: () => {}, separator: true },
    { label: 'Client replied', heading: true, run: () => {} },
    { label: 'Email', run: log('email_in', 'in') },
    { label: 'Call', run: log('call', 'in') },
    { label: 'WhatsApp', run: log('whatsapp', 'in') },
    { label: '', run: () => {}, separator: true },
    // What the client said, in words: the proposal's follow-up note.
    { label: 'Log a note…', iconName: 'note', run: () => openNotesModal(proposalId, 'followup') },
  ];
  showMenuAt(e.currentTarget as HTMLElement, items);
}
expose('followUpMenu', followUpMenu);

/** Sent to the client, and nothing with them for over 10 days. */
export function needsFollowUp(p: Proposal): boolean {
  if (p.archived || p.status !== PS.SENT) return false;
  const t = proposalLastTouch(p);
  return !!t && t.days > FOLLOW_UP_AFTER_DAYS;
}

/** Sent proposals put aside until a date — including ones just logged, whose
 * note alone would keep them off the list for ten days: they show when they're back. */
export function getSnoozed(): Proposal[] {
  return S.proposals
    .filter((p) => !p.archived && p.status === PS.SENT && isSnoozed(p) && matchesProposalPeriod(p))
    .sort((a, b) => (a.snoozedUntil || '').localeCompare(b.snoozedUntil || ''));
}

export function getFollowups(): Proposal[] {
  return S.proposals
    .filter((p) => needsFollowUp(p) && !isSnoozed(p) && matchesProposalPeriod(p))
    .sort((a, b) => (proposalLastTouch(b)?.days ?? 0) - (proposalLastTouch(a)?.days ?? 0));
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
  // What the status sets (review asked, the day sent, the day signed) is one rule, shared with the batch change.
  const { revisionSent } = applyStatus(p, newStatus, today(), { defaultReviewerId: defaultReviewer()?.id ?? null });
  persistProposals();
  updateBadge();
  refreshAll();
  // Marking a proposal won no longer creates its agreement behind the owner's
  // back; it offers to.
  if (revisionSent) toast(`Revision ${revisionSent.number} sent`, { tone: 'success' });
  if (newStatus === PS.WON) {
    toast('Marked as won', { detail: 'No agreement was created.', action: { label: 'Draft agreement', run: () => { void draftAgreementsFromProposals(); } } });
  }
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

/** The client asked for changes to a sent proposal: the same proposal goes
 * back to Drafting as the next revision (lib/revisions.ts), saved at once. */
export function startRevision(id: number, reason: string, contactId: number | null): void {
  const p = S.proposals.find((x) => x.id === id);
  if (!p || !reason.trim()) return;
  const nextId = Math.max(0, ...S.proposals.flatMap((x) => (x.revisions || []).map((r) => r.id))) + 1;
  const row = applyRevisionRequest(p, { id: nextId, reason, contactId, today: today() });
  persistProposals();
  updateBadge();
  refreshAll();
  if (S.currentProposalId === id) (window as any).renderProposalPage?.();
  toast(`Revision ${row.number} started — back to drafting`, { tone: 'success' });
}
expose('startRevision', startRevision);

let revisionFor: number | null = null;

/** "Client asked for changes": what they asked for (required) and who, then Start revision. */
export function openRevisionDialog(id: number): void {
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  revisionFor = id;
  const next = Math.max(1, p.revision ?? 1) + 1;
  const sub = document.getElementById('rev-sub');
  if (sub) sub.textContent = `${p.client} · SL# ${p.id} — becomes revision ${next} and goes back to drafting`;
  const reason = document.getElementById('rev-reason') as HTMLTextAreaElement | null;
  if (reason) reason.value = '';
  const contacts = p.companyId != null ? S.contacts.filter((c) => c.companyId === p.companyId) : [];
  const sel = document.getElementById('rev-contact') as HTMLSelectElement | null;
  const grp = document.getElementById('rev-contact-grp');
  if (grp) grp.hidden = !contacts.length;
  if (sel) {
    const chosen = contacts.some((c) => c.id === p.primaryContactId) ? p.primaryContactId : null;
    sel.innerHTML = `<option value="">—</option>` + contacts.map((c) => `<option value="${c.id}"${c.id === chosen ? ' selected' : ''}>${escHtml(c.name || '')}</option>`).join('');
  }
  document.getElementById('modal-revision')?.classList.add('open');
  reason?.focus();
}
expose('openRevisionDialog', openRevisionDialog);

export function closeRevisionDialog(): void {
  revisionFor = null;
  document.getElementById('modal-revision')?.classList.remove('open');
}
expose('closeRevisionDialog', closeRevisionDialog);

export function confirmRevision(): void {
  const reason = (document.getElementById('rev-reason') as HTMLTextAreaElement | null)?.value.trim() || '';
  if (!reason) { toast('Add what the client asked for', { tone: 'error' }); document.getElementById('rev-reason')?.focus(); return; }
  const contact = (document.getElementById('rev-contact') as HTMLSelectElement | null)?.value;
  const id = revisionFor;
  closeRevisionDialog();
  if (id != null) startRevision(id, reason, contact ? Number(contact) : null);
}
expose('confirmRevision', confirmRevision);

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

/** A review recorded by mistake: back to pending with the reviewer. The note
 * stays (the comment may still help), and a proposal that "changes requested"
 * sent back to Drafting returns to In Internal Review. */
export function undoReview(id: number): void {
  const p = S.proposals.find((x) => x.id === id);
  if (!p || (p.reviewStatus !== 'approved' && p.reviewStatus !== 'changes_requested')) return;
  if (p.reviewStatus === 'changes_requested' && p.status === PS.DRAFTING) p.status = PS.REVIEW;
  p.reviewStatus = 'pending';
  p.reviewedAt = null;
  persistProposals();
  refreshAll();
  const reviewer = teamMember(p.reviewerId)?.name || defaultReviewer()?.name || 'the reviewer';
  toast(`Review undone — back with ${reviewer}`);
}
expose('undoReview', undoReview);

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

// ═══════════════ UNDO ═══════════════

/** Undo for any change to a proposal (owner, 30-Sep-2026: "Undo everywhere"):
 * call before the change; the returned function puts the proposal back exactly
 * as it was and removes the timeline rows written since (the change's and the
 * undo's own), once the restore has been saved. */
export function snapshotProposal(p: Proposal): () => void {
  const before = JSON.parse(JSON.stringify(p)) as Proposal;
  const since = new Date(Date.now() - 250).toISOString();
  return () => {
    const cur = S.proposals.find((x) => x.id === p.id);
    if (!cur) return;
    for (const k of Object.keys(cur)) delete (cur as any)[k];
    Object.assign(cur, before);
    persistProposals();
    void saved('proposals').then(() => activityForget('proposal', p.id, since)).catch(() => undefined);
    refreshAll();
    (window as any).renderProposalPage?.();
  };
}

// ═══════════════ SNOOZE ═══════════════

export function snoozeProposal(id: number, days: number): void {
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  const restore = snapshotProposal(p);
  const d = new Date();
  d.setDate(d.getDate() + days);
  p.snoozedUntil = localIsoDate(d);
  persistProposals();
  undoToast(`Snoozed ${p.client} for ${days} day${days === 1 ? '' : 's'}`, restore);
  void collapseRows(document.querySelectorAll(`.pq-row[data-row-id="${id}"]`)).then(refreshAll);
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
  void collapseRows(document.querySelectorAll(`.pq-row[data-row-id="${id}"]`)).then(refreshAll);
  undoToast(`Archived ${p.client}`, () => { unarchiveProposal(id); (window as any).renderProposalPage?.(); });
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

export function openNotesModal(id: number, from?: 'followup'): void {
  S.notesTargetId = id;
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  // From Follow-up, for a sent proposal: the note is contact, so it's back in 10 days
  // anyway; "Wait longer" (unticked by default) puts it aside for longer.
  const back = document.getElementById('notes-back-row');
  if (back) back.hidden = !(from === 'followup' && p.status === PS.SENT);
  const tick = document.getElementById('notes-back') as HTMLInputElement | null; if (tick) tick.checked = false;
  const n = document.getElementById('notes-back-days') as HTMLInputElement | null; if (n) n.value = String(WAIT_LONGER_DAYS);
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
  const back = document.getElementById('notes-back-row');
  if (back && !back.hidden) {
    if ((document.getElementById('notes-back') as HTMLInputElement | null)?.checked) {
      p.snoozedUntil = backInDays(today(), Number((document.getElementById('notes-back-days') as HTMLInputElement | null)?.value));
      toast(`Back on Follow-up on ${fmtDate(p.snoozedUntil)}`);
    } else {
      toast(`Logged — back on Follow-up in ${FOLLOW_UP_AFTER_DAYS} days if nothing happens.`);
    }
    back.hidden = true;
  }
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
      refreshAll();
      toast(isWon ? 'Marked as won' : 'Marked as lost', {
        tone: isWon ? 'success' : 'neutral',
        detail: isWon ? 'No agreement was created.' : undefined,
        action: isWon ? { label: 'Draft agreement', run: () => { void draftAgreementsFromProposals(); } } : undefined,
      });
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

/** A nudge to the reviewer (My Day, Pending): ours, not contact with the client, so it goes in the activity log, not the touches. */
export async function nudgeReview(id: number): Promise<void> {
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  const who = teamMember(p.reviewerId)?.name || defaultReviewer()?.name || 'the reviewer';
  try {
    const entryId = await activityLog({ action: 'review_nudged', entityType: 'proposal', entityId: id, entityLabel: `${p.client} — ${p.type || 'proposal'}`, detail: `Nudged ${who} about the review`, companyId: p.companyId ?? null });
    undoToast(`Nudged ${who} about ${p.client}`, () => { void activityRemove(entryId); });
  } catch (err) {
    toast("Couldn't log the nudge", { tone: 'error', detail: String(err) });
  }
}
