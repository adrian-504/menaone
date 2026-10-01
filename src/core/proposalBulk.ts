// The bar that appears while proposals are selected (Proposals and Pending):
// move them to a status together — one date for the batch when the status has
// one — mark the service started, set the owner, mark lost, archive. One undo
// covers the lot. What each status sets is lib/bulkProposals.ts, the same rule
// the single-proposal path uses.

import { S } from '../lib/state';
import { PS, activeTeam, defaultReviewer } from '../lib/commercial';
import { LOSS_REASONS } from '../lib/constants';
import { fmtDateShort } from '../lib/dates';
import { plural } from '../lib/pageKit';
import { persistProposals } from '../lib/persist';
import { refreshAll } from '../lib/registry';
import { undoToast, toast } from '../lib/ui';
import { showDatePrompt, today } from '../lib/utils';
import type { BulkAction } from '../lib/bulkBar';
import { applyStatus, batchStartDate, BULK_STATUSES, PENDING_BULK_STATUSES, statusDateLabel, statusNeedsDate, unreviewedNote } from '../lib/bulkProposals';
import { applyLost, askSent, updateBadge } from './proposals';
import type { Proposal } from '../lib/types';

const STATUS_DONE: Record<string, string> = { [PS.SENT]: 'sent', [PS.CLIENT_SIGNED]: 'signed', [PS.WON]: 'signed' };

/** Applies a change to these proposals, with one undo for all of them. `also` adds the step that usually follows to
 * the undo toast. Returns the proposals changed. */
export function bulkApply(ids: number[], label: string, change: (p: Proposal) => void, o: { clear?: () => void; also?: { label: string; run: () => void } } = {}): Proposal[] {
  const picked = S.proposals.filter((p) => ids.includes(p.id));
  if (!picked.length) return [];
  const before = picked.map((p) => [p, structuredClone(p)] as const);
  picked.forEach(change);
  persistProposals();
  updateBadge();
  o.clear?.();
  refreshAll();
  undoToast(`${label}: ${plural(picked.length, 'proposal')}`, () => {
    // Exactly as it was: a field the change added (a start date on a record that had none) goes too.
    for (const [p, copy] of before) {
      for (const k of Object.keys(p)) if (!(k in copy)) delete (p as unknown as Record<string, unknown>)[k];
      Object.assign(p, copy);
    }
    persistProposals();
    updateBadge();
    refreshAll();
  }, 7000, o.also);
  return picked;
}

/** Moves the selection to a status. Sent, Signed by Client and Signed by Both ask once for the day (today by default,
 * back-datable) and give it to all of them. Signed by Both leaves the service not started, and offers to start it. */
export async function bulkStatus(ids: number[], status: string, clear?: () => void): Promise<void> {
  const moving = S.proposals.filter((p) => ids.includes(p.id) && p.status !== status);
  if (!moving.length) { toast(`Already ${status}`); return; }
  let date = today();
  let sentById: number | null | undefined;
  const dated = statusNeedsDate(status);
  if (dated) {
    const q = { title: `${status} · ${plural(moving.length, 'proposal')}`, label: statusDateLabel(status, moving.length), note: unreviewedNote(moving, status), defaultValue: date, confirmLabel: moving.length === 1 ? `Mark ${STATUS_DONE[status]}` : `Mark ${moving.length} ${STATUS_DONE[status]}` };
    if (status === PS.SENT) {
      // Sent: the one day, and who sent them (their owner unless said).
      const sent = await askSent(q, moving);
      if (!sent) return;
      date = sent.date;
      sentById = sent.sentById;
    } else {
      const picked = await showDatePrompt(q);
      if (!picked) return;
      date = picked;
    }
  }
  const reviewer = defaultReviewer()?.id ?? null;
  const movedIds = moving.map((p) => p.id);
  bulkApply(movedIds, dated ? `${status} on ${fmtDateShort(date, true)}` : `Moved to ${status}`, (p) => { applyStatus(p, status, date, { defaultReviewerId: reviewer, explicit: dated, sentById }); }, {
    clear,
    also: status === PS.WON ? { label: 'Mark service started', run: () => { void bulkServiceStarted(movedIds); } } : undefined,
  });
}

/** "Service started" for the signed ones in the selection: one date, pre-filled with their signature date. */
export async function bulkServiceStarted(ids: number[], clear?: () => void): Promise<void> {
  const signed = S.proposals.filter((p) => ids.includes(p.id) && p.status === PS.WON);
  if (!signed.length) { toast('Only proposals signed by both parties can start', { detail: 'Mark them signed first.' }); return; }
  const date = await showDatePrompt({ title: `Service started · ${plural(signed.length, 'proposal')}`, label: `The day the service started${signed.length < ids.length ? ` (the ${signed.length} signed by both)` : ''}`, defaultValue: batchStartDate(signed, today()), confirmLabel: 'Mark started' });
  if (!date) return;
  bulkApply(signed.map((p) => p.id), `Service started ${fmtDateShort(date, true)}`, (p) => { p.serviceStartedAt = date; }, { clear });
}

/** The bar's actions. `scope: 'pending'` keeps the moves that make sense before a proposal has gone out. */
export function proposalBulkActions(ids: () => number[], clear: () => void, scope: 'all' | 'pending' = 'all'): BulkAction[] {
  // A batch is lost today for the reason picked (the single dialog takes another day and "lost to").
  const lost: BulkAction = { label: 'Mark lost', danger: true, choices: () => LOSS_REASONS.map((r) => ({ label: r, run: () => { bulkApply(ids(), 'Marked lost', (p) => { applyLost(p, { reason: r, date: today() }); }, { clear }); } })) };
  const owner: BulkAction = { label: 'Owner', choices: () => activeTeam().map((t) => ({ label: t.name, run: () => { bulkApply(ids(), `Owner set to ${t.name}`, (p) => { p.ownerId = t.id; p.owner = t.name; }, { clear }); } })) };
  if (scope === 'pending') {
    return [
      ...PENDING_BULK_STATUSES.map((st) => ({ label: st === PS.REVIEW ? 'Send for review' : 'Sent to client', run: () => { void bulkStatus(ids(), st, clear); } })),
      owner, lost,
    ];
  }
  return [
    { label: 'Status', choices: () => BULK_STATUSES.map((st) => ({ label: st, run: () => { void bulkStatus(ids(), st, clear); } })) },
    { label: 'Service started', run: () => { void bulkServiceStarted(ids(), clear); } },
    lost, owner,
    { label: 'Archive', run: () => { bulkApply(ids(), 'Archived', (p) => { p.archived = true; p.archivedAt = today(); }, { clear }); } },
  ];
}
