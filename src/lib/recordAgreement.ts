// The agreement page in the record anatomy (1.61 "records"): the header's
// figures, the term as one full-width lane (what has run, today, the notice
// window), and the renewal — three choices, what each does, and what was
// chosen. Pure: tabs/agreementPage.ts draws it.

import type { Agreement, RenewalDecision } from './types';
import { agreementMonthly, contractEndDate, currencyOf, fmtMoney, lineTotals } from './commercial';
import { daysBetween } from './pipeline';
import { agreementRenewal } from './myday';
import { fmtDate, fmtDateShort } from './dates';
import { plural } from './pageKit';
import type { Figure } from './recordFigures';
import { decideBy, noticeFact, pastTermActive, signatureOf, termKind, termStart, type TermKind } from './agreementTerms';

const iso = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);
const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 1000) / 10;

// ── Header ──────────────────────────────────────────────────────────────────

/** Monthly · decide by · term end · notice · signature. What is not recorded says so in grey rather than being left
 * out: unknown is not none. Pure. */
export function agreementHeaderFigures(a: Agreement, today: string): Figure[] {
  const out: Figure[] = [];
  const cur = currencyOf(a);
  const monthly = agreementMonthly(a);
  out.push(monthly ? { value: fmtMoney(monthly, cur), label: 'a month', tone: 'green' } : { value: '—', label: 'no monthly fee' });
  const kind = termKind(a);
  const end = iso(a.endDate);
  const d = decideBy(a, today);
  if (d && end! >= today && a.status === 'Signed' && !a.renewalDecision) {
    out.push({ value: fmtDateShort(d.date, true), label: d.passed ? 'decide-by passed' : `decide by · ${d.days === 0 ? 'today' : plural(d.days, 'day')}`, tone: d.passed ? 'red' : d.days <= 30 ? 'amber' : undefined });
  }
  if (kind === 'fixed') {
    const left = daysBetween(today, end!) ?? 0;
    out.push(left < 0
      ? { value: fmtDateShort(end!, true), label: pastTermActive(a, today) ? 'term ended · still active' : `term ended · ${plural(-left, 'day')} ago`, tone: pastTermActive(a, today) ? 'amber' : undefined }
      : { value: fmtDateShort(end!, true), label: `term ends · ${plural(left, 'day')}` });
  } else if (kind === 'open_ended') out.push({ value: 'Open-ended', label: 'term' });
  else if (kind === 'project') out.push({ value: 'With the project', label: 'term ends' });
  else out.push({ value: 'Not recorded', label: 'term end', tone: 'muted' });
  const notice = noticeFact(a);
  out.push({ value: notice.known ? notice.text.charAt(0).toUpperCase() + notice.text.slice(1) : 'Not recorded', label: notice.known ? 'notice' : 'notice period', tone: notice.known ? undefined : 'muted' });
  const sig = signatureOf(a);
  out.push({ value: sig.known ? sig.text.charAt(0).toUpperCase() + sig.text.slice(1) : 'Not recorded', label: 'signature', tone: sig.known ? (sig.both ? undefined : 'amber') : 'muted' });
  return out;
}

// ── The term as one lane ────────────────────────────────────────────────────

export interface TermLane {
  kind: TermKind;
  startLabel: string;
  /** "31 Dec 2026", "open-ended", "with the project". */
  endLabel: string;
  /** How much of the lane has run, 0–100. */
  elapsed: number;
  /** Today on the lane, or null when the term has not started or (for a fixed term) is over. */
  today: number | null;
  /** The notice window of a fixed term: from the last day to give notice to the end. */
  notice: { left: number; label: string } | null;
  /** Past its term and still active: where the term ended on the lane, which then runs on to today. */
  past: { left: number; label: string } | null;
}

/** The term as one lane, drawn by how it ends: start → end with what has run, today and the notice window; past its
 * term and still active, the lane runs on to today, hatched; open-ended and ending-with-the-project run from the
 * start to today and on. Null when no term is recorded. Pure. */
export function termLane(a: Pick<Agreement, 'startDate' | 'endDate' | 'noticeDays' | 'dateClientSigned' | 'renewalType' | 'status' | 'serviceStatus'>, today: string): TermLane | null {
  const kind = termKind(a);
  if (kind === 'none') return null;
  const start = termStart(a), end = iso(a.endDate);
  if (kind !== 'fixed') {
    // No end to scale by: the start at the left, today at 60%, the rest still to come.
    const started = !start || today >= start;
    return { kind, startLabel: start ? fmtDate(start) : 'start not recorded', endLabel: kind === 'open_ended' ? 'open-ended' : 'with the project', elapsed: started ? 60 : 0, today: started ? 60 : null, notice: null, past: null };
  }
  if (!start || end! <= start) return { kind, startLabel: 'start not recorded', endLabel: fmtDate(end!), elapsed: today >= end! ? 100 : 0, today: null, notice: null, past: null };
  const past = pastTermActive(a, today);
  // Past its term the lane's right edge is today, not the end.
  const right = past ? today : end!;
  const span = Math.max(1, daysBetween(start, right) ?? 1);
  const at = (d: string) => pct((daysBetween(start, d) ?? 0) / span);
  const d = decideBy(a, today);
  const inTerm = today >= start && today <= end!;
  return {
    kind, startLabel: fmtDate(start), endLabel: fmtDate(end!),
    elapsed: today <= start ? 0 : today >= end! ? (past ? at(end!) : 100) : at(today),
    today: inTerm || past ? at(today) : null,
    notice: !past && d && d.noticeKnown && d.date > start && d.date < end! ? { left: at(d.date), label: `notice window · ${fmtDateShort(d.date, true)} – ${fmtDateShort(end!, true)}` } : null,
    past: past ? { left: at(end!), label: `past term · still active since ${fmtDateShort(end!, true)}` } : null,
  };
}

// ── Documents and history ───────────────────────────────────────────────────

export interface ChainEntry { key: string; kind: 'previous' | 'principal' | 'renewal'; title: string; sub: string; agreementId: number | null; docLink: string | null; here: boolean }

/** The agreement's documents, top to bottom: the term it renews (when it is a renewal), the principal agreement with
 * its document, and the renewal drafted from it. More entries (amendments, annexes) can join later. Pure. */
export function documentChain(a: Agreement, all: Agreement[]): ChainEntry[] {
  const out: ChainEntry[] = [];
  const dated = (x: Agreement) => iso(x.dateClientSigned) || iso(x.dateMenaSigned) || iso(x.datePrepared);
  const from = a.renewedFrom != null ? all.find((x) => x.id === a.renewedFrom) : undefined;
  if (from) out.push({ key: `a${from.id}`, kind: 'previous', title: 'Previous term', sub: [from.agrRef, from.endDate ? `ended ${fmtDateShort(from.endDate, true)}` : ''].filter(Boolean).join(' · '), agreementId: from.id, docLink: from.docLink, here: false });
  const d = dated(a);
  out.push({ key: `a${a.id}`, kind: 'principal', title: from ? 'Renewal agreement' : 'Principal agreement', sub: [a.agrRef, d ? `${iso(a.dateClientSigned) || iso(a.dateMenaSigned) ? 'signed' : 'prepared'} ${fmtDateShort(d, true)}` : 'not dated'].filter(Boolean).join(' · '), agreementId: a.id, docLink: a.docLink, here: true });
  for (const r of all.filter((x) => x.renewedFrom === a.id)) {
    out.push({ key: `a${r.id}`, kind: 'renewal', title: 'Renewal', sub: [r.agrRef, (r.status || 'In preparation').toLowerCase(), r.startDate ? `from ${fmtDateShort(r.startDate, true)}` : ''].filter(Boolean).join(' · '), agreementId: r.id, docLink: r.docLink, here: false });
  }
  return out;
}

// ── Renewal ─────────────────────────────────────────────────────────────────

export interface RenewalCard { key: RenewalDecision; title: string; body: string; chosen: boolean }
export interface Renewal {
  /** Beside the heading: "decide by 2 Oct", "notice date passed 2 Oct", "ends 31 Dec". */
  deadline: string;
  tone: 'red' | 'amber' | null;
  cards: RenewalCard[];
  /** What was chosen and when: "Chosen 1 Oct". Null while undecided. */
  decided: { choice: RenewalDecision; on: string } | null;
}

type RenewalInput = Pick<Agreement, 'status' | 'serviceStatus' | 'endDate' | 'noticeDays' | 'contractMonths' | 'monthlyFee' | 'lines' | 'currency' | 'renewalDecision' | 'renewalDecidedAt'>;

/** The renewal of a signed agreement with an end date whose service has not ended: the day to decide by (the last
 * day to give notice; the end without a notice period) and the three choices. Null otherwise. Pure. */
export function renewalFor(a: RenewalInput, today: string): Renewal | null {
  const end = iso(a.endDate);
  if (a.status !== 'Signed' || !end || a.serviceStatus === 'Ended') return null;
  const { noticeDate, daysToNotice } = agreementRenewal(a, today);
  const by = noticeDate || end;
  const left = noticeDate ? daysToNotice ?? 0 : daysBetween(today, end) ?? 0;
  const decided = a.renewalDecision ? { choice: a.renewalDecision, on: a.renewalDecidedAt ? `Chosen ${fmtDateShort(a.renewalDecidedAt, true)}` : 'Chosen' } : null;
  const deadline = left < 0 ? (noticeDate ? `notice date passed ${fmtDateShort(by, true)}` : `ended ${fmtDateShort(end, true)}`) : `decide by ${fmtDateShort(by, true)}`;
  const monthly = agreementMonthly(a as Agreement);
  const term = a.contractMonths ? plural(a.contractMonths, 'month') : 'The same term';
  const cards: RenewalCard[] = [
    { key: 'renew', title: 'Renew as is', body: `${term}${monthly ? `, ${fmtMoney(monthly, currencyOf(a as Agreement))} a month` : ''}. Drafts the renewal agreement.`, chosen: a.renewalDecision === 'renew' },
    { key: 'changes', title: 'Renew with changes', body: 'Opens a proposal from this agreement’s lines.', chosen: a.renewalDecision === 'changes' },
    { key: 'end', title: 'Let it end', body: `Records the decision; My Day reminds you on ${fmtDateShort(end, true)} to mark the service ended.`, chosen: a.renewalDecision === 'end' },
  ];
  return { deadline, tone: decided ? null : left < 0 ? 'red' : left <= 30 ? 'amber' : null, cards, decided };
}

/** What a decided renewal says in a chip: on the page, in the Agreements list and on My Day. Null while undecided. Pure. */
export function decisionChip(a: Pick<Agreement, 'renewalDecision' | 'endDate'>): { text: string; tone: 'green' | 'blue' | 'grey' } | null {
  if (a.renewalDecision === 'renew') return { text: 'Renewal drafted', tone: 'green' };
  if (a.renewalDecision === 'changes') return { text: 'Renewing with changes', tone: 'blue' };
  if (a.renewalDecision === 'end') return { text: `Ending ${a.endDate ? fmtDateShort(a.endDate, true) : 'at term'}`, tone: 'grey' };
  return null;
}

const addDay = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** "Renew as is": the same client, type, entity, currency, lines, term, notice and auto-renew, starting the day after
 * this one ends, in preparation, pointing back at the agreement it renews. Its lines get their own ids (a line saved
 * under an id that exists would move from the old agreement to the new one). Pure. */
export function renewalDraft(a: Agreement, o: { id: number; agrRef: string; today: string; lineId: () => number }): Agreement {
  const { id, agrRef, today } = o;
  const start = a.endDate ? addDay(a.endDate.slice(0, 10), 1) : today;
  return {
    id, agrRef, client: a.client, companyId: a.companyId ?? null, type: a.type, status: 'In Preparation', preparedBy: a.preparedBy, preparedById: a.preparedById ?? null,
    datePrepared: today, dateSentToClient: null, dateClientSigned: null, dateMenaSigned: null, dateFiled: null,
    monthlyFee: a.monthlyFee, contractMonths: a.contractMonths, proposalId: null, hubspot: a.hubspot, docLink: null, actionDate: null,
    remarks: `Renewal of ${a.agrRef || 'the previous agreement'}`, createdAt: today,
    businessEntityId: a.businessEntityId ?? null, currency: a.currency ?? null, startDate: start, endDate: contractEndDate(start, a.contractMonths),
    serviceStatus: 'Not started', autoRenew: !!a.autoRenew, noticeDays: a.noticeDays ?? null,
    lines: (a.lines || []).map((l) => ({ ...l, id: o.lineId(), rates: l.rates ? l.rates.map((r) => ({ ...r })) : l.rates })), renewalDecision: null, renewalDecidedAt: null, renewedFrom: a.id,
    renewalType: a.renewalType ?? null, signatureStatus: null,
  };
}
