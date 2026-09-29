// Proposal revisions (owner, 29-Sep-2026): a client reviews a sent proposal and
// asks for a change (price, scope, terms, a service). The same proposal goes
// round Drafting → Sent again with a number and a reason, instead of a
// duplicate under a new SL#. No new status, no new page. Pure: core/proposals.ts
// applies it, the proposal page shows it.

import { fmtMoney, lineAmount, PS } from './commercial';
import type { CommercialLine, Proposal, ProposalRevision } from './types';

type RevisionProposal = Pick<Proposal, 'revision' | 'revisions' | 'dateSentToClient' | 'sentDate' | 'lastSentAt'>;

/** What the commercials were when the client asked for changes (lines_before_json). */
export interface LinesSnapshot {
  lines: CommercialLine[];
  contractMonths: number | null;
  monthlyFee: number | null;
  oneTimeFee: number | null;
}

export const revisionOf = (p: Pick<Proposal, 'revision'>): number => Math.max(1, p.revision ?? 1);

/** The revision being prepared: asked for, not sent yet. */
export function openRevision(p: Pick<Proposal, 'revisions'>): ProposalRevision | null {
  return [...(p.revisions || [])].reverse().find((r) => !r.sentAt) ?? null;
}

/** Drafting since: the open revision's request (the client asked for changes that day), else when the proposal came in. */
export function draftingSince(p: Pick<Proposal, 'revisions' | 'dateAdded'>): string | null {
  return openRevision(p)?.requestedAt || p.dateAdded || null;
}

/** The latest revision, sent or not. */
export function latestRevision(p: Pick<Proposal, 'revisions'>): ProposalRevision | null {
  const rs = p.revisions || [];
  return rs.length ? rs.reduce((a, b) => (b.number > a.number ? b : a)) : null;
}

/** Can the client's request for changes be recorded? Sent, or signed by the client only. */
export const canStartRevision = (p: Pick<Proposal, 'status'>): boolean => p.status === PS.SENT || p.status === PS.CLIENT_SIGNED;

export function linesSnapshot(p: Pick<Proposal, 'lines' | 'contractMonths' | 'monthlyFee' | 'oneTimeFee'>): LinesSnapshot {
  return { lines: (p.lines || []).map((l) => ({ ...l, rates: l.rates?.map((r) => ({ ...r })) })), contractMonths: p.contractMonths ?? null, monthlyFee: p.monthlyFee ?? null, oneTimeFee: p.oneTimeFee ?? null };
}

export function parseSnapshot(json: string | null | undefined): LinesSnapshot | null {
  try {
    const v = JSON.parse(json || '');
    return v && Array.isArray(v.lines) ? { lines: v.lines, contractMonths: v.contractMonths ?? null, monthlyFee: v.monthlyFee ?? null, oneTimeFee: v.oneTimeFee ?? null } : null;
  } catch {
    return null;
  }
}

/** The client asked for changes: a new revision row with the commercials as
 * they were, the next number, back to Drafting and the review cleared (review
 * stays optional, as today). Mutates `p`; the caller saves it once. */
export function applyRevisionRequest(p: Proposal, r: { id: number; reason: string; contactId: number | null; today: string }): ProposalRevision {
  const number = revisionOf(p) + 1;
  const row: ProposalRevision = {
    id: r.id, number, requestedAt: r.today, requestedByContactId: r.contactId, reason: r.reason.trim() || null,
    linesBeforeJson: JSON.stringify(linesSnapshot(p)), sentAt: null,
  };
  p.revisions = [...(p.revisions || []), row];
  p.revision = number;
  p.status = PS.DRAFTING;
  p.reviewStatus = null;
  p.reviewedAt = null;
  p.reviewNote = null;
  return row;
}

/** Marking it sent while a revision is open: that revision is sent today, and
 * so is the proposal's latest send; the first send stays. Null when no revision is open. */
export function applyRevisionSent(p: Proposal, today: string): ProposalRevision | null {
  const open = openRevision(p);
  if (!open) return null;
  p.revisions = (p.revisions || []).map((r) => (r.id === open.id ? { ...r, sentAt: today } : r));
  p.lastSentAt = today;
  return { ...open, sentAt: today };
}

const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** The header fact: "Revision 2 · first sent 10 Sept", once sent "Revision 2 · sent 25 Sept · first sent 10 Sept". */
export function revisionFact(p: RevisionProposal): string | null {
  const n = revisionOf(p);
  if (n <= 1) return null;
  const first = p.dateSentToClient || p.sentDate;
  const latest = latestRevision(p);
  const sent = latest?.sentAt || null;
  return [`Revision ${n}`, sent ? `sent ${shortDate(sent)}` : '', first ? `first sent ${shortDate(first)}` : ''].filter(Boolean).join(' · ');
}

// ── What changed ──

export type LineChange =
  | { kind: 'added'; service: string }
  | { kind: 'removed'; service: string }
  | { kind: 'changed'; service: string; price?: [number | null, number | null]; quantity?: [number, number]; billing?: [string, string] };

export interface RevisionDiff {
  lines: LineChange[];
  term?: [number | null, number | null];
}

const key = (l: CommercialLine) => l.serviceName.trim().toLowerCase();

/** Per service, what the revision changed: added, removed, price, quantity or billing; and the contract term. */
export function revisionDiff(before: LinesSnapshot, after: { lines: CommercialLine[]; contractMonths: number | null }): RevisionDiff {
  const was = new Map(before.lines.filter((l) => l.serviceName.trim()).map((l) => [key(l), l]));
  const now = new Map(after.lines.filter((l) => l.serviceName.trim()).map((l) => [key(l), l]));
  const lines: LineChange[] = [];
  for (const [k, l] of now) {
    const old = was.get(k);
    if (!old) { lines.push({ kind: 'added', service: l.serviceName }); continue; }
    const c: Extract<LineChange, { kind: 'changed' }> = { kind: 'changed', service: l.serviceName };
    if ((old.unitPrice ?? null) !== (l.unitPrice ?? null)) c.price = [old.unitPrice ?? null, l.unitPrice ?? null];
    if (old.quantity !== l.quantity) c.quantity = [old.quantity, l.quantity];
    if (old.billing !== l.billing) c.billing = [old.billing, l.billing];
    if (c.price || c.quantity || c.billing) lines.push(c);
  }
  for (const [k, l] of was) if (!now.has(k)) lines.push({ kind: 'removed', service: l.serviceName });
  const diff: RevisionDiff = { lines };
  if ((before.contractMonths ?? null) !== (after.contractMonths ?? null)) diff.term = [before.contractMonths ?? null, after.contractMonths ?? null];
  return diff;
}

const per = (billing: string) => (billing === 'monthly' ? ' / month' : ' one-time');

/** The muted line under a changed service: "was SAR 7,000 / month", "was 4 × SAR 1,500 / month"; null when unchanged. */
export function lineWasNote(line: CommercialLine, before: LinesSnapshot, currency: string): string | null {
  const old = before.lines.find((l) => key(l) === key(line));
  if (!old) return before.lines.length ? 'New in this revision' : null;
  const priceChanged = (old.unitPrice ?? null) !== (line.unitPrice ?? null);
  const qtyChanged = old.quantity !== line.quantity;
  if (!priceChanged && !qtyChanged && old.billing === line.billing) return null;
  const amount = qtyChanged && old.quantity > 1 ? `${old.quantity} × ${fmtMoney(old.unitPrice, currency)}` : fmtMoney(qtyChanged ? lineAmount(old) : old.unitPrice, currency);
  return `was ${old.unitPrice == null ? 'not priced' : amount}${old.unitPrice == null ? '' : per(old.billing)}`;
}

/** Services the revision took out, for one line under the table ("Removed: Recruitment"). */
export function removedServices(before: LinesSnapshot, after: CommercialLine[]): string[] {
  const now = new Set(after.filter((l) => l.serviceName.trim()).map(key));
  return before.lines.filter((l) => l.serviceName.trim() && !now.has(key(l))).map((l) => l.serviceName);
}
