// Agreements as a year view (1.60 "pages-2"): every agreement is a lane on one
// month axis — its term, how much has run, the notice window and the end —
// with the next decision said in a chip and one coral line for today. Pure:
// core/agreements.ts draws it.

import type { Agreement } from './types';
import { daysBetween } from './pipeline';
import { agreementRenewal } from './myday';
import { fmtDateShort } from './dates';
import { activeMrr, agreementMonthly, currencyOf, fmtMoneyByCurrency, isAgreementActive, type MoneyByCurrency } from './commercial';
import { plural, type StripPanel, type Tone } from './pageKit';

/** The notice window counts as "opening" this many days ahead (the strip, the amber chip, Start renewal). */
export const NOTICE_OPENING_DAYS = 30;
/** A notice date this close is named in the chip ("Notice due 2 Dec"); further out the agreement is just running. */
export const NOTICE_NAMED_DAYS = 90;
/** "Renewing" means the term ends within this many calendar months. */
export const RENEWING_MONTHS = 3;
/** The axis runs this many months past the latest end. */
export const AXIS_TAIL_MONTHS = 3;

const iso = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const ymd = (y: number, m: number, d = 1) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

type A = Pick<Agreement, 'startDate' | 'endDate' | 'noticeDays' | 'dateClientSigned' | 'status' | 'serviceStatus'>;

export const isSigned = (a: Pick<Agreement, 'status'>): boolean => a.status === 'Signed';
const AWAITING = new Set(['Client Signature', 'MENA Signature']);
export const awaitingSignature = (a: Pick<Agreement, 'status'>): boolean => AWAITING.has(a.status || '');
const termStart = (a: A) => iso(a.startDate) || iso(a.dateClientSigned);

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
  /** Null when the agreement has no start or end yet: nothing to draw. */
  term: { left: number; width: number } | null;
  /** The part of the term that has run (lighter). */
  elapsed: { left: number; width: number } | null;
  notice: { left: number; width: number; label: string } | null;
  end: { pos: number; label: string } | null;
  /** Not signed yet: a dashed outline instead of the bar. */
  outline: boolean;
}

/** One agreement's lane on the axis. Pure. */
export function agreementLane(a: A, axis: Axis, today: string): Lane {
  const start = termStart(a), end = iso(a.endDate);
  if (!start || !end || end < start) return { term: null, elapsed: null, notice: null, end: null, outline: !isSigned(a) };
  const left = axisPos(axis, start), right = axisPos(axis, end);
  const ran = today <= start ? 0 : axisPos(axis, today < end ? today : end) - left;
  const { noticeDate, daysToNotice } = agreementRenewal(a, today);
  const soon = daysToNotice != null && daysToNotice <= NOTICE_OPENING_DAYS;
  const nLeft = noticeDate ? Math.max(left, axisPos(axis, noticeDate)) : 0;
  return {
    term: { left, width: round1(right - left) },
    elapsed: ran > 0 ? { left, width: round1(ran) } : null,
    notice: noticeDate && noticeDate < end ? { left: nLeft, width: round1(right - nLeft), label: soon ? `notice ${fmtDateShort(noticeDate, true)} – ${fmtDateShort(end, true)}` : `notice ${fmtDateShort(noticeDate, true)}` } : null,
    end: { pos: right, label: fmtDateShort(end, true) },
    outline: !isSigned(a),
  };
}
const round1 = (x: number) => Math.round(x * 10) / 10;

export interface Decision { text: string; tone: Tone; action: 'renew' | 'open'; actionLabel: string; /** Sort key: the date the next decision falls on. */ on: string }

const inDays = (n: number) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${plural(n, 'day')}`);

/** The next decision on an agreement, as a chip and one action. Pure. */
export function nextDecision(a: A, today: string): Decision {
  const end = iso(a.endDate);
  if (a.status === 'Canceled') return { text: 'Cancelled', tone: 'grey', action: 'open', actionLabel: 'Open', on: '9999-12-31' };
  if (!isSigned(a)) return { text: awaitingSignature(a) ? `Awaiting ${a.status === 'MENA Signature' ? 'our' : 'the client’s'} signature` : a.status || 'In preparation', tone: awaitingSignature(a) ? 'amber' : 'grey', action: 'open', actionLabel: 'Open', on: today };
  if (!end) return { text: 'Running · no end date', tone: 'green', action: 'open', actionLabel: 'Open', on: '9999-12-30' };
  const left = daysBetween(today, end) ?? 0;
  if (left < 0) return { text: `Ended ${fmtDateShort(end, true)}`, tone: 'grey', action: 'open', actionLabel: 'Open', on: '9999-12-29' };
  const { noticeDate, daysToNotice } = agreementRenewal(a, today);
  if (noticeDate && daysToNotice != null) {
    if (daysToNotice <= 0) return { text: `Notice open · ends ${inDays(left)}`, tone: 'amber', action: 'renew', actionLabel: 'Start renewal', on: noticeDate };
    if (daysToNotice <= NOTICE_OPENING_DAYS) return { text: `Notice opens ${inDays(daysToNotice)}`, tone: 'amber', action: 'renew', actionLabel: 'Start renewal', on: noticeDate };
    if (daysToNotice <= NOTICE_NAMED_DAYS) return { text: `Notice due ${fmtDateShort(noticeDate, true)}`, tone: 'blue', action: 'open', actionLabel: 'Open', on: noticeDate };
    return { text: `Running · ${plural(left, 'day')} left`, tone: 'green', action: 'open', actionLabel: 'Open', on: noticeDate };
  }
  return { text: `Running · ${plural(left, 'day')} left`, tone: 'green', action: 'open', actionLabel: 'Open', on: end };
}

export type AgreementBucket = 'notice' | 'renewing' | 'unsigned';

/** `months` calendar months on from a date. Pure. */
export function addMonthsIso(date: string, months: number): string {
  const d = new Date(`${date.slice(0, 10)}T12:00:00`);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return ymd(d.getFullYear(), d.getMonth(), d.getDate());
}

export function agreementBuckets(a: A, today: string): AgreementBucket[] {
  const out: AgreementBucket[] = [];
  const end = iso(a.endDate);
  const live = isSigned(a) && !!end && end >= today;
  const { daysToNotice } = agreementRenewal(a, today);
  if (live && daysToNotice != null && daysToNotice <= NOTICE_OPENING_DAYS) out.push('notice');
  if (live && end! <= addMonthsIso(today, RENEWING_MONTHS)) out.push('renewing');
  if (awaitingSignature(a)) out.push('unsigned');
  return out;
}

/** The strip: monthly under signed agreements (and a year) · notice window opening · renewing in three months · awaiting signature. Pure. */
export function agreementsStrip(agreements: Agreement[], today: string): StripPanel[] {
  const running = agreements.filter((a) => isSigned(a) && isAgreementActive(a, today));
  const mrr = activeMrr(running);
  const year: MoneyByCurrency = {};
  for (const a of running) { const m = agreementMonthly(a); if (m) year[currencyOf(a)] = (year[currencyOf(a)] || 0) + m * 12; }
  const of = (b: AgreementBucket) => agreements.filter((a) => agreementBuckets(a, today).includes(b));
  const notice = of('notice').sort((a, b) => nextDecision(a, today).on.localeCompare(nextDecision(b, today).on));
  const renewing = of('renewing').sort((a, b) => (a.endDate || '').localeCompare(b.endDate || ''));
  const unsigned = of('unsigned');
  const n0 = notice[0] ? agreementRenewal(notice[0], today) : null;
  return [
    { key: 'all', total: true, n: Object.keys(mrr).length ? fmtMoneyByCurrency(mrr) : 'SAR 0', count: running.length, label: `a month under ${plural(running.length, 'signed agreement')}`, lead: 'a year', detail: Object.keys(year).length ? fmtMoneyByCurrency(year) : '—', tone: 'coral' },
    { key: 'notice', n: String(notice.length), count: notice.length, label: 'notice window opening', lead: n0 && n0.daysToNotice != null ? (n0.daysToNotice <= 0 ? 'open since' : n0.daysToNotice === 1 ? 'tomorrow' : `in ${n0.daysToNotice} days`) : '', detail: n0?.noticeDate ? `${fmtDateShort(n0.noticeDate, true)} · ${notice[0].client || ''}` : '', tone: 'amber' },
    { key: 'renewing', n: String(renewing.length), count: renewing.length, label: `renewing in ${RENEWING_MONTHS} months`, lead: 'ends', detail: renewing[0]?.endDate ? `${fmtDateShort(renewing[0].endDate, true)} · ${renewing[0].client || ''}` : '', tone: 'blue' },
    { key: 'unsigned', n: String(unsigned.length), count: unsigned.length, label: 'awaiting signature', lead: 'with', detail: unsigned.map((a) => a.client).filter(Boolean).slice(0, 2).join(', '), tone: 'amber' },
  ];
}
