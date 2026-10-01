// Companies in My Day's language (1.59 "pages"): what each client is worth a
// month, how much of its agreement has run and when notice opens, what is in
// flight with it, and which agreements are to decide soon. Nothing here flags
// a company for a lack of contact (owner, 1-Oct-2026: no contact for a long
// time is not a problem to raise). Pure: tabs/companies.ts draws it.

import type { Agreement } from './types';
import { daysBetween } from './pipeline';
import { agreementRenewal } from './myday';
import { decideBy, serviceLive } from './agreementTerms';
import { fmtDateShort, fmtDateWeekday } from './dates';
import { moneyTotal, plural, type StripPanel, type Tone } from './pageKit';
import type { MoneyByCurrency } from './commercial';
import { fmtMoneyByCurrency } from './commercial';

/** The strip counts the agreements whose last day to decide falls within this many days. */
export const DECIDE_WITHIN_DAYS = 90;
/** The runway bar turns amber when the notice window opens within this many days. */
export const NOTICE_SOON_DAYS = 30;

export const RELATIONSHIP_TONE: Record<string, Tone> = { 'Active client': 'green', 'In discussion': 'amber', Prospect: 'blue', 'Past client or prospect': 'grey' };

export interface Runway { end: string; daysLeft: number; pct: number; notice: { date: string; open: boolean } | null; soon: boolean }

/** How far an agreement has run (start → end) and its notice window. Null without an end date. Pure. */
export function runway(a: Pick<Agreement, 'startDate' | 'endDate' | 'noticeDays' | 'dateClientSigned'>, today: string): Runway | null {
  if (!a.endDate) return null;
  const start = a.startDate || a.dateClientSigned || null;
  const { daysToEnd, noticeDate, daysToNotice } = agreementRenewal(a, today);
  const total = start ? daysBetween(start, a.endDate) ?? 0 : 0;
  const run = start ? daysBetween(start, today) ?? 0 : 0;
  const pct = total > 0 ? Math.round(Math.max(0, Math.min(1, run / total)) * 100) : 0;
  const soon = daysToNotice != null && daysToNotice <= NOTICE_SOON_DAYS && (daysToEnd ?? 0) >= 0;
  return { end: a.endDate.slice(0, 10), daysLeft: daysToEnd ?? 0, pct, notice: noticeDate ? { date: noticeDate, open: (daysToNotice ?? 1) <= 0 } : null, soon };
}

/** "91 d · notice opens 2 Oct" or "122 d". */
export function runwayNote(r: Runway): string {
  const d = `${r.daysLeft} d`;
  if (!r.soon || !r.notice) return d;
  return `${d} · ${r.notice.open ? 'notice open since' : 'notice opens'} ${fmtDateShort(r.notice.date)}`;
}

type Deciding = Pick<Agreement, 'status' | 'serviceStatus' | 'endDate' | 'noticeDays' | 'renewalType' | 'renewalDecision'>;

/** The decide-by dates of a company's agreements that are still to decide within 90 days: served and invoiced, the
 * term still running, no decision recorded. A date already passed (while the term runs) counts, and comes first. Pure. */
export function decideDates(agreements: Deciding[], today: string): string[] {
  const out: string[] = [];
  for (const a of agreements) {
    if (a.renewalDecision || !serviceLive(a) || !a.endDate || a.endDate.slice(0, 10) < today) continue;
    const by = decideBy(a, today);
    if (by && by.days <= DECIDE_WITHIN_DAYS) out.push(by.date);
  }
  return out.sort();
}

export interface FlightInput {
  proposals: { promisedBy?: string | null; validUntil?: string | null; status: string; revision?: number; due?: boolean }[];
  openOpps: number;
  nextMeeting: { date: string; time: string | null } | null;
}

/** "2 proposals · 2 opportunities" and the one urgent bit (a promise due, an offer expiring, a follow-up due). Pure. */
export function inFlight(i: FlightInput, today: string): { text: string; urgent: { text: string; tone: 'red' | 'amber' } | null } {
  const parts = [i.proposals.length ? plural(i.proposals.length, 'proposal') : '', i.openOpps ? plural(i.openOpps, 'opportunity', 'opportunities') : ''].filter(Boolean);
  let urgent: { text: string; tone: 'red' | 'amber' } | null = null;
  const promised = i.proposals.map((p) => p.promisedBy).filter((d): d is string => !!d && (daysBetween(today, d) ?? 99) <= 3).sort()[0];
  const expiring = i.proposals.map((p) => p.validUntil).filter((d): d is string => !!d && d >= today && (daysBetween(today, d) ?? 99) <= 7).sort()[0];
  if (promised) urgent = { text: `${i.proposals.filter((p) => p.promisedBy === promised).length} due ${promised <= today ? 'today' : fmtDateWeekday(promised).split(' ')[0]}`, tone: 'red' };
  else if (expiring) urgent = { text: `expires ${expiring === today ? 'today' : fmtDateWeekday(expiring).split(' ')[0]}`, tone: 'red' };
  else if (i.proposals.some((p) => p.due)) urgent = { text: 'follow up', tone: 'amber' };
  else {
    const rev = Math.max(1, ...i.proposals.map((p) => p.revision ?? 1));
    if (rev > 1) parts.push(`rev ${rev}`);
  }
  if (!parts.length && i.nextMeeting && (daysBetween(today, i.nextMeeting.date) ?? 99) <= 7) {
    parts.push(`Meeting ${i.nextMeeting.date === today ? 'today' : fmtDateWeekday(i.nextMeeting.date)}${i.nextMeeting.time ? ` ${i.nextMeeting.time}` : ''}`);
  }
  return { text: parts.join(' · '), urgent };
}

export interface CompanyFigures {
  name: string;
  relationship: string;
  mrr: MoneyByCurrency;
  renewal: string | null;
  /** Monthly value of its open proposals. */
  proposed: MoneyByCurrency;
  firstMet: string | null;
  /** Decide-by dates of its agreements to decide within 90 days (decideDates). */
  decide: string[];
}

export type CompanyBucket = 'client' | 'discussion' | 'prospect';

export function companyBuckets(c: Pick<CompanyFigures, 'relationship'>): CompanyBucket[] {
  const out: CompanyBucket[] = [];
  if (c.relationship === 'Active client') out.push('client');
  if (c.relationship === 'In discussion') out.push('discussion');
  if (c.relationship === 'Prospect') out.push('prospect');
  return out;
}

const addAll = (into: MoneyByCurrency, m: MoneyByCurrency) => { for (const [k, v] of Object.entries(m)) into[k] = (into[k] || 0) + v; };

/** The strip: monthly from active clients (next renewal) · in discussion (worth in proposals) · prospects (first met) ·
 * agreements to decide in 90 days (the soonest date and its client; it opens Agreements, and says 0 when there are none). Pure. */
export function companiesStrip(rows: CompanyFigures[], today?: string): StripPanel[] {
  const clients = rows.filter((r) => r.relationship === 'Active client');
  const discussion = rows.filter((r) => r.relationship === 'In discussion');
  const prospects = rows.filter((r) => r.relationship === 'Prospect');
  const decide = rows.flatMap((r) => r.decide.map((date) => ({ date, name: r.name }))).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const mrr: MoneyByCurrency = {}; clients.forEach((r) => addAll(mrr, r.mrr));
  const proposed: MoneyByCurrency = {}; discussion.forEach((r) => addAll(proposed, r.proposed));
  const next = clients.filter((r) => r.renewal).sort((a, b) => a.renewal!.localeCompare(b.renewal!))[0];
  const met = prospects.filter((r) => r.firstMet).sort((a, b) => b.firstMet!.localeCompare(a.firstMet!))[0];
  return [
    { key: 'all', total: true, n: Object.keys(mrr).length ? fmtMoneyByCurrency(mrr) : moneyTotal([]), count: clients.length, label: `a month from ${plural(clients.length, 'active client')}`, lead: next ? 'next renewal' : '', detail: next ? `${fmtDateShort(next.renewal, true)} · ${next.name}` : '', tone: 'coral' },
    { key: 'discussion', n: String(discussion.length), count: discussion.length, label: 'in discussion', lead: 'worth', detail: Object.keys(proposed).length ? `${fmtMoneyByCurrency(proposed)} /mo in proposals` : 'no priced proposal yet', tone: 'amber' },
    { key: 'prospect', n: String(prospects.length), count: prospects.length, label: prospects.length === 1 ? 'prospect' : 'prospects', lead: met ? 'first met' : '', detail: met ? `${fmtDateShort(met.firstMet, true)} · ${met.name}` : '', tone: 'blue' },
    { key: 'decide', n: String(decide.length), count: decide.length, label: `to decide in ${DECIDE_WITHIN_DAYS} days`, lead: decide[0] ? (today && decide[0].date < today ? 'was due' : 'soonest') : '', detail: decide[0] ? `${fmtDateShort(decide[0].date, true)} · ${decide[0].name}` : '', tone: decide.length ? 'amber' : 'grey', action: "navToModule('agreements')", keepZero: true },
  ];
}
