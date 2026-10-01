// "After the yes" (1.65 "followup"): what happens between a client saying yes
// and the service running. Two facts are recorded here and nowhere else — the
// day the client accepted, and the day the engagement letter went out — and
// four are read from what the proposal already carries: signed by the client,
// signed by both, its agreement, the day the service started. The proposal's
// stepper gains no steps; this is a checklist beside it. Pure:
// tabs/proposalPage.ts draws it.

import type { Agreement, Proposal } from './types';
import { PS, stageIndex } from './commercial';

export type YesKey = 'accepted' | 'letter' | 'client_signed' | 'both_signed' | 'agreement' | 'started';
export interface YesItem {
  key: YesKey;
  label: string;
  done: boolean;
  /** The day it happened, when recorded. A step that a later one implies is done without a day. */
  date: string | null;
  /** What its one click says when it is not done: "Mark", "Draft"; null when there is nothing to click. */
  mark: string | null;
  /** The agreement, on that step, once there is one. */
  agreementId?: number;
}

type YesProposal = Pick<Proposal, 'id' | 'status' | 'acceptedAt' | 'engagementLetterSentAt' | 'dateSigned' | 'dblSignedDate' | 'serviceStartedAt'>;
const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);

/** The checklist is for a proposal that is with the client or further: before that there is no yes to follow, and a
 * lost or withdrawn one shows it only when the client had accepted. */
export function showsAfterYes(p: Pick<Proposal, 'status' | 'acceptedAt'>): boolean {
  if (p.status === PS.SENT || p.status === PS.CLIENT_SIGNED || p.status === PS.WON) return true;
  return !!p.acceptedAt && (p.status === PS.LOST || p.status === PS.WITHDRAWN);
}

/** Accepted · Engagement letter · Signed by client · Signed by both · Agreement · Service started, each with its day
 * or what marks it. A signature implies the acceptance: it reads done, with no day, when none was recorded. Pure. */
export function afterYes(p: YesProposal, agreements: Pick<Agreement, 'id' | 'proposalId' | 'datePrepared' | 'createdAt'>[]): YesItem[] {
  const at = stageIndex(p.status);
  const clientSigned = at >= stageIndex(PS.CLIENT_SIGNED) && p.status !== PS.LOST && p.status !== PS.WITHDRAWN;
  const bothSigned = p.status === PS.WON;
  const open = p.status !== PS.LOST && p.status !== PS.WITHDRAWN;
  const agreement = agreements.find((a) => a.proposalId === p.id) ?? null;
  return [
    { key: 'accepted', label: 'Accepted', done: !!p.acceptedAt || clientSigned, date: day(p.acceptedAt), mark: !p.acceptedAt && open ? 'Mark' : null },
    { key: 'letter', label: 'Engagement letter sent', done: !!p.engagementLetterSentAt, date: day(p.engagementLetterSentAt), mark: !p.engagementLetterSentAt && open ? 'Mark' : null },
    { key: 'client_signed', label: 'Signed by the client', done: clientSigned, date: clientSigned ? day(p.dateSigned) : null, mark: !clientSigned && open ? 'Mark' : null },
    { key: 'both_signed', label: 'Signed by both', done: bothSigned, date: bothSigned ? day(p.dblSignedDate) : null, mark: !bothSigned && open ? 'Mark' : null },
    { key: 'agreement', label: 'Agreement', done: !!agreement, date: agreement ? day(agreement.datePrepared) || day(agreement.createdAt) : null, mark: !agreement && bothSigned ? 'Draft' : null, agreementId: agreement?.id },
    { key: 'started', label: 'Service started', done: !!p.serviceStartedAt, date: day(p.serviceStartedAt), mark: !p.serviceStartedAt && bothSigned ? 'Mark' : null },
  ];
}

/** Accepted, and not yet signed by the client: what lists say in place of "With client". */
export function paperworkPending(p: Pick<Proposal, 'status' | 'acceptedAt'>): boolean {
  return p.status === PS.SENT && !!p.acceptedAt;
}
export const PAPERWORK_PENDING = 'Accepted · paperwork pending';
