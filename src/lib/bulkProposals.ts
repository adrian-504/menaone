// Changing several proposals at once (owner, 1-Oct-2026: "i sent 3 proposals
// with different services to a client. Then he signs all 3, i want to be able
// to select all 3 and set them together"). What a status change sets on a
// proposal — the same fields whether it is done one at a time or in a batch —
// which statuses ask for one date for the batch, and the rows a shift-click
// selects. Pure.

import type { Proposal, ProposalRevision } from './types';
import { PS, stageIndex } from './commercial';
import { applyRevisionSent } from './revisions';

/** The statuses a batch can be moved to. Lost has its own action (it needs a reason). */
export const BULK_STATUSES: string[] = [PS.REQUEST, PS.DRAFTING, PS.REVIEW, PS.SENT, PS.CLIENT_SIGNED, PS.WON, PS.WITHDRAWN];
/** On Pending the moves that make sense there. */
export const PENDING_BULK_STATUSES: string[] = [PS.REVIEW, PS.SENT];

/** Moving to one of these asks once for the day it happened: the day sent, or the day signed. */
export const statusNeedsDate = (status: string): boolean => status === PS.SENT || status === PS.CLIENT_SIGNED || status === PS.WON;

/** What the date is, for the question: "the day they were sent" / "signed". */
export const statusDateLabel = (status: string, n: number): string =>
  `The day ${n === 1 ? 'it was' : 'they were'} ${status === PS.SENT ? 'sent to the client' : status === PS.CLIENT_SIGNED ? 'signed by the client' : 'signed by both parties'}`;

/** Sending several to the client does not stop to ask about the review; the date question carries one line instead,
 * when any of them has not been through it: "2 of these haven't been reviewed". Counts the ones not yet sent whose
 * review is not approved. Null when the status is not Sent, or all were reviewed. Pure. */
export function unreviewedNote(moving: Pick<Proposal, 'status' | 'reviewStatus'>[], status: string): string | null {
  if (status !== PS.SENT) return null;
  const n = moving.filter((p) => stageIndex(p.status) < stageIndex(PS.SENT) && p.reviewStatus !== 'approved').length;
  if (!n) return null;
  return moving.length === 1 ? 'This one hasn’t been reviewed' : `${n} of these ${n === 1 ? 'hasn’t' : 'haven’t'} been reviewed`;
}

export interface StatusChange { revisionSent: ProposalRevision | null }

/** Moves one proposal to a status on a given day and sets what that status sets: review asked (reviewer, pending,
 * requested on), the day sent (the first send stays; an open revision is sent), the day signed. With `explicit` the
 * day was chosen by hand — a batch date, a back-dated signature — and replaces a signature date already there;
 * otherwise (the day is simply today) existing dates are kept. Signed by both leaves the service not started. Pure. */
export function applyStatus(p: Proposal, status: string, date: string, o: { defaultReviewerId?: number | null; explicit?: boolean; /** Who sent it (1.65), when the status is Sent and it was asked. */ sentById?: number | null } = {}): StatusChange {
  if (p.status === status) return { revisionSent: null };
  p.status = status;
  if (status === PS.REVIEW) {
    if (!p.dateSentToHassan) p.dateSentToHassan = date;
    if (p.reviewerId == null) p.reviewerId = o.defaultReviewerId ?? null;
    p.reviewStatus = 'pending';
    p.reviewRequestedAt = date;
    p.reviewedAt = null;
    p.reviewNote = null;
  }
  // Sending a revision: that revision and the latest send are that day; the first send stays.
  const revisionSent = status === PS.SENT ? applyRevisionSent(p, date) : null;
  if (status === PS.SENT && !p.dateSentToClient) { p.dateSentToClient = date; if (!p.sentDate) p.sentDate = date; }
  if (status === PS.SENT && o.sentById !== undefined) p.sentById = o.sentById;
  if (status === PS.CLIENT_SIGNED && (o.explicit || !p.dateSigned)) p.dateSigned = date;
  if (status === PS.WON) {
    if (!p.dateSigned) p.dateSigned = date;
    if (o.explicit || !p.dblSignedDate) p.dblSignedDate = date;
  }
  return { revisionSent };
}

/** The rows a shift-click selects: from the last one ticked to this one, in the order the list shows them. */
export function rangeIds(order: number[], from: number, to: number): number[] {
  const a = order.indexOf(from), b = order.indexOf(to);
  if (a === -1 || b === -1) return b === -1 ? [] : [to];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** The pre-fill for "Service started" on a batch: the latest signature date among them, else today. */
export function batchStartDate(picked: Pick<Proposal, 'dblSignedDate' | 'dateSigned'>[], today: string): string {
  return picked.map((p) => (p.dblSignedDate || p.dateSigned || '').slice(0, 10)).filter(Boolean).sort().pop() || today;
}

/** Who sent a proposal, when it was not its owner: the name to show ("sent by Hassan"). Null when the owner sent it
 * or nobody was recorded. Pure. */
export function sentByOther(p: Pick<Proposal, 'sentById' | 'ownerId'>, memberName: (id: number) => string | null): string | null {
  if (p.sentById == null || p.sentById === p.ownerId) return null;
  return memberName(p.sentById);
}

/** The pre-pick for "Sent by" on a batch: their owner when they share one, else the current user, else nobody. */
export function defaultSender(picked: Pick<Proposal, 'ownerId'>[], currentUserId: number | null): number | null {
  const owners = [...new Set(picked.map((p) => p.ownerId ?? null))];
  return owners.length === 1 && owners[0] != null ? owners[0] : currentUserId;
}
