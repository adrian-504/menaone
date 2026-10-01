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

const iso = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);
const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 1000) / 10;
const termStart = (a: Pick<Agreement, 'startDate' | 'dateClientSigned'>) => iso(a.startDate) || iso(a.dateClientSigned);

// ── Header ──────────────────────────────────────────────────────────────────

/** Contracted · a month · days left with the end date (amber once notice is near) · the notice period. Pure. */
export function agreementHeaderFigures(a: Agreement, today: string): Figure[] {
  const out: Figure[] = [];
  const cur = currencyOf(a);
  const t = lineTotals(a.lines, a.contractMonths);
  const monthly = agreementMonthly(a);
  const value = t.contractValue ?? (monthly && a.contractMonths ? monthly * a.contractMonths : null);
  if (value) out.push({ value: fmtMoney(value, cur), label: 'contracted', tone: 'green' });
  if (monthly) out.push({ value: fmtMoney(monthly, cur), label: 'a month' });
  const end = iso(a.endDate);
  if (end) {
    const left = daysBetween(today, end) ?? 0;
    const { daysToNotice } = agreementRenewal(a, today);
    if (left < 0) out.push({ value: fmtDateShort(end, true), label: `ended · ${plural(-left, 'day')} ago` });
    else out.push({ value: plural(left, 'day'), label: `left · ends ${fmtDateShort(end, true)}`, tone: left <= 30 ? 'red' : (daysToNotice != null && daysToNotice <= 30) || left <= 90 ? 'amber' : undefined });
  }
  if (a.noticeDays != null) out.push({ value: plural(a.noticeDays, 'day'), label: 'notice' });
  return out;
}

// ── The term as one lane ────────────────────────────────────────────────────

export interface TermLane {
  startLabel: string;
  endLabel: string;
  /** How much of the term has run, 0–100. */
  elapsed: number;
  /** Today on the lane, or null when the term has not started or is over. */
  today: number | null;
  /** The notice window: from the last day to give notice to the end. */
  notice: { left: number; label: string } | null;
}

/** The term from its start to its end with what has run, today, and the notice window. Null without both dates. Pure. */
export function termLane(a: Pick<Agreement, 'startDate' | 'endDate' | 'noticeDays' | 'dateClientSigned'>, today: string): TermLane | null {
  const start = termStart(a), end = iso(a.endDate);
  if (!start || !end || end <= start) return null;
  const span = Math.max(1, daysBetween(start, end) ?? 1);
  const at = (d: string) => pct((daysBetween(start, d) ?? 0) / span);
  const { noticeDate } = agreementRenewal(a, today);
  const inTerm = today >= start && today <= end;
  return {
    startLabel: fmtDate(start), endLabel: fmtDate(end),
    elapsed: today <= start ? 0 : today >= end ? 100 : at(today),
    today: inTerm ? at(today) : null,
    notice: noticeDate && noticeDate > start && noticeDate < end ? { left: at(noticeDate), label: `notice window · ${fmtDateShort(noticeDate, true)} – ${fmtDateShort(end, true)}` } : null,
  };
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
  };
}
