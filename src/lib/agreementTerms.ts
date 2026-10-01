// What an agreement's term says (1.61, from the review of the real
// agreements): how it ends — on a date, open-ended, with a project, or not
// recorded — the last day to decide about it, and how far the signatures got.
// Unknown is not none: a notice period that was never recorded reads "not
// recorded", one recorded as 0 reads "no notice period"; the same for the end
// date. Pure: the Agreements list, the agreement record and the company page
// all read these.

import type { Agreement, SignatureStatus } from './types';
import { endedByDecision, stillInvoiced } from './commercial';
import { daysBetween } from './pipeline';
import { fmtDate, fmtDateShort } from './dates';

// Its own plural: this file stays free of the page kit (and the DOM), so My Day's rules can read it.
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const iso = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

type Live = Pick<Agreement, 'status' | 'serviceStatus'>;

/** How the term ends: on a date, never (open-ended), with a project, or — nothing recorded. */
export type TermKind = 'fixed' | 'open_ended' | 'project' | 'none';

export function termKind(a: Pick<Agreement, 'endDate' | 'renewalType'>): TermKind {
  if (a.renewalType === 'open_ended') return 'open_ended';
  if (a.renewalType === 'project') return 'project';
  return iso(a.endDate) ? 'fixed' : 'none';
}

/** Has a term to draw: an end date, or recorded as open-ended or ending with its project. */
export const hasTerm = (a: Pick<Agreement, 'endDate' | 'renewalType'>): boolean => termKind(a) !== 'none';

export const termStart = (a: Pick<Agreement, 'startDate' | 'dateClientSigned'>): string | null => iso(a.startDate) || iso(a.dateClientSigned);

/** The service is being delivered: not cancelled, and still invoiced (its service status is Active). */
export const serviceLive = (a: Live): boolean => a.status !== 'Canceled' && stillInvoiced(a);

type PastTerm = Live & Pick<Agreement, 'endDate' | 'renewalType' | 'renewalDecision'>;
const termPassed = (a: Pick<Agreement, 'endDate' | 'renewalType'>, today: string): boolean => termKind(a) === 'fixed' && iso(a.endDate)! < today;

/** The term's end date has passed and the client is still served and invoiced: past term, still active — it counts in
 * MRR, with the renewal paperwork missing. Never "expired". Not once "Let it end" was recorded. */
export function pastTermActive(a: PastTerm, today: string): boolean {
  return termPassed(a, today) && serviceLive(a) && !endedByDecision(a, today);
}

/** The term's end date has passed and nothing says the client is still invoiced, nor that the service ended: it does
 * not count, and the page asks for the service to be set. */
export function pastTermUnset(a: PastTerm, today: string): boolean {
  return termPassed(a, today) && a.status !== 'Canceled' && !stillInvoiced(a) && a.serviceStatus !== 'Ended' && !endedByDecision(a, today);
}

export interface DecideBy {
  date: string;
  /** Days from today (negative once passed). */
  days: number;
  /** Passed while the term still runs: it renews unless notice was sent. */
  passed: boolean;
  /** False when the notice period was never recorded: the date is then the end itself. */
  noticeKnown: boolean;
}

/** The last day to decide about an agreement with a fixed end: the end less its notice period; with the notice not
 * recorded, the end itself. Null without a fixed end. Pure. */
export function decideBy(a: Pick<Agreement, 'endDate' | 'noticeDays' | 'renewalType'>, today: string): DecideBy | null {
  if (termKind(a) !== 'fixed') return null;
  const end = iso(a.endDate)!;
  const date = a.noticeDays != null && a.noticeDays > 0 ? addDays(end, -a.noticeDays) : end;
  return { date, days: daysBetween(today, date) ?? 0, passed: date < today && end >= today, noticeKnown: a.noticeDays != null };
}

export interface Fact { text: string; known: boolean }

/** "90 days", "no notice period" (recorded as 0) or "not recorded". */
export function noticeFact(a: Pick<Agreement, 'noticeDays'>): Fact {
  if (a.noticeDays == null) return { text: 'not recorded', known: false };
  return { text: a.noticeDays === 0 ? 'no notice period' : plural(a.noticeDays, 'day'), known: true };
}

/** "31 Dec 2026", "open-ended", "with the project" or "not recorded". */
export function endFact(a: Pick<Agreement, 'endDate' | 'renewalType'>): Fact & { kind: TermKind } {
  const kind = termKind(a);
  if (kind === 'fixed') return { text: fmtDate(iso(a.endDate)!), known: true, kind };
  if (kind === 'open_ended') return { text: 'open-ended', known: true, kind };
  if (kind === 'project') return { text: 'with the project', known: true, kind };
  return { text: 'not recorded', known: false, kind };
}

export const RENEWAL_TYPES: [NonNullable<Agreement['renewalType']>, string][] = [
  ['auto', 'Renews automatically'], ['extension_by_notice', 'Extended by notice'], ['client_must_request', 'Client must ask to renew'],
  ['fixed', 'Fixed term, no renewal'], ['mutual', 'Renewed by mutual agreement'], ['open_ended', 'Open-ended'], ['project', 'Ends with the project'],
];
export const SIGNATURE_STATUSES: [SignatureStatus, string][] = [
  ['signed_both', 'Signed by both'], ['mena_signed', 'Signed by MENA BIG only'], ['client_signed', 'Signed by the client only'],
  ['client_po', 'Client PO, not signed'], ['unsigned', 'Unsigned'],
];

/** "Renews automatically", … or "not recorded". */
export function renewalFact(a: Pick<Agreement, 'renewalType'>): Fact {
  const hit = RENEWAL_TYPES.find(([k]) => k === a.renewalType);
  return hit ? { text: hit[1], known: true } : { text: 'not recorded', known: false };
}

export interface Signature {
  /** What is recorded, or what the two signature dates and the status say; null when nothing does. */
  status: SignatureStatus | null;
  text: string;
  /** Both sides have signed. */
  both: boolean;
  known: boolean;
}

type Signed = Pick<Agreement, 'signatureStatus' | 'dateClientSigned' | 'dateMenaSigned' | 'status'>;

/** How far the signatures got: the recorded status; else the two signature dates; else the agreement's own status
 * (Signed, or waiting on one side); else not recorded. Pure. */
export function signatureOf(a: Signed): Signature {
  const client = !!iso(a.dateClientSigned), ours = !!iso(a.dateMenaSigned);
  const status: SignatureStatus | null = a.signatureStatus
    ?? (client && ours ? 'signed_both' : client ? 'client_signed' : ours ? 'mena_signed' : null)
    ?? (a.status === 'Signed' ? 'signed_both' : a.status === 'MENA Signature' ? 'client_signed' : a.status === 'Client Signature' ? 'mena_signed' : null);
  // "Client Signature" with nothing else recorded means the client's signature is what is awaited.
  const text = status === 'signed_both' ? 'signed by both'
    : status === 'client_signed' ? 'countersignature outstanding'
    : status === 'mena_signed' ? 'awaiting the client’s signature'
    : status === 'client_po' ? 'client PO · not signed'
    : status === 'unsigned' ? 'unsigned'
    : 'not recorded';
  return { status, text, both: status === 'signed_both', known: status != null };
}

/** How long ago the term ended, for a past-term agreement: "since 31 Aug". */
export const pastTermSince = (a: Pick<Agreement, 'endDate'>): string => (iso(a.endDate) ? `since ${fmtDateShort(iso(a.endDate)!, true)}` : '');
