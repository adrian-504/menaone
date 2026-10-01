// Agreements as a year view (1.60 "pages-2", reworked in 1.61 for how the real
// agreements are recorded): two groups. "With a term" — an end date, or
// open-ended, or ending with its project — is a lane each on one month axis,
// drawn by how the term ends, with the day to decide by as the headline and
// the default order. "No term recorded" is a compact list without lanes: most
// agreements have no dates yet, and a page of warnings would say nothing.
// Pure: core/agreements.ts draws it.

import type { Agreement } from './types';
import { daysBetween } from './pipeline';
import { fmtDateShort } from './dates';
import { activeMrr, agreementMonthly, currencyOf, fmtMoneyByCurrency, isAgreementActive, type MoneyByCurrency } from './commercial';
import { plural, type StripPanel, type Tone } from './pageKit';
import { decideBy, hasTerm, pastTermActive, termKind, termStart, type TermKind } from './agreementTerms';

/** A decision this close is amber and offers Start renewal. */
export const NOTICE_OPENING_DAYS = 30;
/** A decision this close is named in the chip ("Decision due 2 Dec"); further out the agreement is just running. */
export const NOTICE_NAMED_DAYS = 90;
/** The axis runs this many months past the latest end. */
export const AXIS_TAIL_MONTHS = 3;

const iso = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const ymd = (y: number, m: number, d = 1) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

type A = Pick<Agreement, 'startDate' | 'endDate' | 'noticeDays' | 'dateClientSigned' | 'status' | 'serviceStatus' | 'renewalDecision' | 'renewalType'>;

export const isSigned = (a: Pick<Agreement, 'status'>): boolean => a.status === 'Signed';
const AWAITING = new Set(['Client Signature', 'MENA Signature']);
export const awaitingSignature = (a: Pick<Agreement, 'status'>): boolean => AWAITING.has(a.status || '');

export interface Axis { start: string; end: string; ticks: { pos: number; label: string }[] }

/** One axis for all lanes: from the month of the earliest start to three months after the latest end, a tick each
 * quarter ("Jan 26", "Apr", "Jul", "Oct", "Jan 27"). Without dated agreements: this year. Pure. */
export function agreementAxis(agreements: A[], today: string): Axis {
  const starts = agreements.map(termStart).filter((d): d is string => !!d).sort();
  const ends = agreements.map((a) => iso(a.endDate)).filter((d): d is string => !!d).sort();
  const first = starts[0] || `${today.slice(0, 4)}-01-01`;
  const last = ends[ends.length - 1] || `${today.slice(0, 4)}-12-31`;
  const sy = Number(first.slice(0, 4)), sm = Number(first.slice(5, 7)) - 1;
  // Start on a quarter so the ticks fall on Jan / Apr / Jul / Oct.
  const startM = sm - (sm % 3);
  const start = ymd(sy, startM);
  const ey = Number(last.slice(0, 4)), em = Number(last.slice(5, 7)) - 1 + AXIS_TAIL_MONTHS + 1;
  const endDate = new Date(ey, em, 1);
  // …and end on one, so the last tick sits at 100%.
  while (endDate.getMonth() % 3 !== 0) endDate.setMonth(endDate.getMonth() + 1);
  const end = ymd(endDate.getFullYear(), endDate.getMonth());
  const span = Math.max(1, daysBetween(start, end) ?? 1);
  const ticks: Axis['ticks'] = [];
  for (let d = new Date(sy, startM, 1); ymd(d.getFullYear(), d.getMonth()) <= end; d.setMonth(d.getMonth() + 3)) {
    const at = ymd(d.getFullYear(), d.getMonth());
    const jan = d.getMonth() === 0;
    ticks.push({ pos: pct((daysBetween(start, at) ?? 0) / span), label: `${MONTHS[d.getMonth()]}${jan || !ticks.length ? ` ${String(d.getFullYear()).slice(2)}` : ''}` });
  }
  return { start, end, ticks };
}

const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 1000) / 10;

/** Where a date sits on the axis, 0–100. Pure. */
export function axisPos(axis: Axis, date: string): number {
  const span = Math.max(1, daysBetween(axis.start, axis.end) ?? 1);
  return pct((daysBetween(axis.start, date) ?? 0) / span);
}

export interface Lane {
  kind: TermKind;
  /** The bar: start → end for a fixed term; start → the right edge for an open-ended one; start → today for one
   * that ends with its project. Null when there is nothing to draw (no term, or no dates at all). */
  term: { left: number; width: number } | null;
  /** The part that has run (lighter). */
  elapsed: { left: number; width: number } | null;
  /** A tick where the notice period opens (the decide-by day), when the notice is recorded and not zero. */
  tick: number | null;
  end: { pos: number; label: string } | null;
  /** Past its term and still active: hatched from the end to today. */
  past: { left: number; width: number } | null;
  /** How the line leaves the bar: an arrow to the right edge (open-ended), a dashed tail (ends with the project). */
  tail: { kind: 'arrow' | 'dashed'; left: number; width: number } | null;
  /** Not signed yet: a dashed outline instead of the bar. */
  outline: boolean;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** One agreement's lane on the axis, drawn by how its term ends. Pure. */
export function agreementLane(a: A, axis: Axis, today: string): Lane {
  const kind = termKind(a);
  const start = termStart(a), end = iso(a.endDate);
  const outline = !isSigned(a);
  const none: Lane = { kind, term: null, elapsed: null, tick: null, end: null, past: null, tail: null, outline };
  if (kind === 'none') return none;
  const todayPos = axisPos(axis, today);
  // Without a start the bar begins at the axis' left edge.
  const left = start ? axisPos(axis, start) : 0;
  if (kind === 'fixed') {
    if (start && end! < start) return none;
    const right = axisPos(axis, end!);
    const ran = start && today <= start ? 0 : Math.min(todayPos, right) - left;
    const d = decideBy(a, today);
    const tickAt = d && d.noticeKnown && d.date < end! ? axisPos(axis, d.date) : null;
    return {
      ...none,
      term: { left, width: round1(right - left) },
      elapsed: ran > 0 ? { left, width: round1(ran) } : null,
      tick: tickAt != null && tickAt > left ? tickAt : null,
      end: { pos: right, label: fmtDateShort(end!, true) },
      past: pastTermActive(a, today) && todayPos > right ? { left: right, width: round1(todayPos - right) } : null,
    };
  }
  const started = !start || today >= start;
  if (kind === 'open_ended') {
    return { ...none, term: { left, width: round1(100 - left) }, elapsed: started && todayPos > left ? { left, width: round1(todayPos - left) } : null, tail: { kind: 'arrow', left: 100, width: 0 } };
  }
  // Ends with the project: solid as far as today, then a dashed tail.
  const solidTo = started ? Math.max(left, todayPos) : left;
  return { ...none, term: solidTo > left ? { left, width: round1(solidTo - left) } : null, tail: { kind: 'dashed', left: solidTo, width: round1(100 - solidTo) } };
}

export interface Decision { text: string; /** Said after the chip's text where there is room. */ more?: string; tone: Tone; action: 'renew' | 'open'; actionLabel: string; /** Sort key: the day to decide by (or what stands in for it). */ on: string }

const inDays = (n: number) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${plural(n, 'day')}`);
const UNSIGNED_TEXT: Record<string, string> = { 'Client Signature': 'Awaiting the client’s signature', 'MENA Signature': 'Awaiting our signature', 'Client Review': 'With the client for review', 'On Hold': 'On hold' };

/** Where an agreement stands, as one chip and one action: cancelled, not signed yet, decided, past its term and
 * still active, the decide-by day passed or near, or simply running. Pure. */
export function nextDecision(a: A, today: string): Decision {
  const open = (text: string, tone: Tone, on: string): Decision => ({ text, tone, action: 'open', actionLabel: 'Open', on });
  if (a.status === 'Canceled') return open('Cancelled', 'grey', '9999-12-31');
  if (!isSigned(a)) return open(UNSIGNED_TEXT[a.status || ''] || a.status || 'In preparation', awaitingSignature(a) || a.status === 'On Hold' ? 'amber' : 'grey', today);
  const kind = termKind(a);
  const end = iso(a.endDate);
  if (kind === 'none') return open('Signed · no term recorded', 'grey', '9999-12-28');
  if (kind === 'open_ended') return open('Running · open-ended', 'green', '9999-12-26');
  if (kind === 'project') return open('Running · ends with the project', 'green', '9999-12-27');
  const left = daysBetween(today, end!) ?? 0;
  if (left < 0) return pastTermActive(a, today) ? open('Past term · still active', 'amber', end!) : open(`Ended ${fmtDateShort(end!, true)}`, 'grey', '9999-12-29');
  // Decided already (1.61): the chip says what was chosen, and there is no renewal left to start.
  if (a.renewalDecision) {
    const text = a.renewalDecision === 'renew' ? 'Renewal drafted' : a.renewalDecision === 'changes' ? 'Renewing with changes' : `Ending ${fmtDateShort(end!, true)}`;
    return open(text, a.renewalDecision === 'renew' ? 'green' : a.renewalDecision === 'changes' ? 'blue' : 'grey', end!);
  }
  const d = decideBy(a, today)!;
  const renew = (text: string, tone: Tone): Decision => ({ text, tone, action: 'renew', actionLabel: 'Start renewal', on: d.date });
  if (d.passed) return { ...renew(`Decide-by passed ${fmtDateShort(d.date, true)}`, 'red'), more: 'renews unless notice was sent' };
  if (d.days <= NOTICE_OPENING_DAYS) return renew(`Decision due ${inDays(d.days)}`, 'amber');
  if (d.days <= NOTICE_NAMED_DAYS) return open(`Decision due ${fmtDateShort(d.date, true)}`, 'blue', d.date);
  return open(`Running · ${plural(left, 'day')} left`, 'green', d.date);
}

/** The headline on a row with a term: the day to decide by and how far it is; what stands in when there is none. Pure. */
export function decideHeadline(a: A, today: string): { value: string; sub: string; tone: 'red' | 'amber' | null } {
  const kind = termKind(a);
  if (kind === 'open_ended') return { value: '—', sub: 'open-ended', tone: null };
  if (kind === 'project') return { value: '—', sub: 'with the project', tone: null };
  const end = iso(a.endDate);
  if (kind === 'none' || !end) return { value: '—', sub: 'no term recorded', tone: null };
  if (!isSigned(a)) return { value: fmtDateShort(end, true), sub: 'ends · not signed yet', tone: null };
  if (end < today) return { value: fmtDateShort(end, true), sub: pastTermActive(a, today) ? 'term ended' : 'ended', tone: pastTermActive(a, today) ? 'amber' : null };
  if (a.renewalDecision) return { value: fmtDateShort(end, true), sub: 'ends', tone: null };
  const d = decideBy(a, today)!;
  if (d.passed) return { value: fmtDateShort(d.date, true), sub: 'decide-by passed', tone: 'red' };
  return { value: fmtDateShort(d.date, true), sub: `decide by · ${d.days === 0 ? 'today' : plural(d.days, 'day')}`, tone: d.days <= NOTICE_OPENING_DAYS ? 'amber' : null };
}

/** The one fact missing on an agreement that otherwise has a term: its notice period. Null when nothing is. Pure. */
export function missingFact(a: A): string | null {
  return termKind(a) === 'fixed' && isSigned(a) && a.noticeDays == null ? 'notice not recorded' : null;
}

export type AgreementBucket = 'decide' | 'past';

/** A decision is due within this many days (literal days, on the decide-by day). */
export const DECIDE_WITHIN_DAYS = 90;

/** `months` calendar months on from a date. Pure. */
export function addMonthsIso(date: string, months: number): string {
  const d = new Date(`${date.slice(0, 10)}T12:00:00`);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return ymd(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Which strip buckets an agreement falls in: a decision due within 90 days (or already passed, while the term
 * runs) on a signed, undecided agreement; past its term and still active. Each agreement counts once per panel. Pure. */
export function agreementBuckets(a: A, today: string): AgreementBucket[] {
  const out: AgreementBucket[] = [];
  const d = isSigned(a) && !a.renewalDecision ? decideBy(a, today) : null;
  const end = iso(a.endDate);
  if (d && end && end >= today && d.days <= DECIDE_WITHIN_DAYS) out.push('decide');
  if (pastTermActive(a, today)) out.push('past');
  return out;
}

/** Sorting the two groups: with a term, by the day to decide (the soonest, or longest passed, first); without one, by
 * status — Signed, with the client, in preparation, on hold — then client. Pure. */
const STATUS_ORDER = ['Signed', 'MENA Signature', 'Client Signature', 'Client Review', 'In Preparation', 'On Hold', 'Canceled'];
export function agreementGroups<T extends Agreement>(agreements: T[], today: string): { term: T[]; noTerm: T[] } {
  const by = (a: T, b: T) => (a.client || '').localeCompare(b.client || '') || a.id - b.id;
  const rank = (a: T) => { const i = STATUS_ORDER.indexOf(a.status || ''); return i === -1 ? STATUS_ORDER.length : i; };
  return {
    term: agreements.filter((a) => hasTerm(a)).sort((a, b) => nextDecision(a, today).on.localeCompare(nextDecision(b, today).on) || by(a, b)),
    noTerm: agreements.filter((a) => !hasTerm(a)).sort((a, b) => rank(a) - rank(b) || by(a, b)),
  };
}

/** The strip: monthly under signed agreements (and a year) · to decide in 90 days · past term, still active · with
 * no term recorded (that one opens the second group instead of filtering). Pure. */
export function agreementsStrip(agreements: Agreement[], today: string): StripPanel[] {
  const running = agreements.filter((a) => isSigned(a) && isAgreementActive(a, today));
  const mrr = activeMrr(running);
  const year: MoneyByCurrency = {};
  for (const a of running) { const m = agreementMonthly(a); if (m) year[currencyOf(a)] = (year[currencyOf(a)] || 0) + m * 12; }
  const of = (b: AgreementBucket) => agreements.filter((a) => agreementBuckets(a, today).includes(b));
  const decide = of('decide').sort((a, b) => decideBy(a, today)!.date.localeCompare(decideBy(b, today)!.date));
  const past = of('past').sort((a, b) => (a.endDate || '').localeCompare(b.endDate || ''));
  const noTerm = agreements.filter((a) => !hasTerm(a) && a.status !== 'Canceled');
  const d0 = decide[0] ? decideBy(decide[0], today)! : null;
  return [
    { key: 'all', total: true, n: Object.keys(mrr).length ? fmtMoneyByCurrency(mrr) : 'SAR 0', count: running.length, label: `a month under ${plural(running.length, 'signed agreement')}`, lead: 'a year', detail: Object.keys(year).length ? fmtMoneyByCurrency(year) : '—', tone: 'coral' },
    { key: 'decide', n: String(decide.length), count: decide.length, label: `to decide in ${DECIDE_WITHIN_DAYS} days`, lead: d0 ? (d0.passed ? 'passed' : d0.days === 0 ? 'today' : d0.days === 1 ? 'tomorrow' : 'first') : '', detail: d0 ? `${fmtDateShort(d0.date, true)} · ${decide[0].client || ''}` : '', tone: 'amber' },
    { key: 'past', n: String(past.length), count: past.length, label: 'past term, still active', lead: 'since', detail: past[0]?.endDate ? `${fmtDateShort(past[0].endDate, true)} · ${past[0].client || ''}` : '', tone: 'amber' },
    { key: 'noterm', n: String(noTerm.length), count: noTerm.length, label: 'with no term recorded', lead: 'listed', detail: 'below, without a lane', tone: 'blue', action: 'agrShowNoTerm()' },
  ];
}
