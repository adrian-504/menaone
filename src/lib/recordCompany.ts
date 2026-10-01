// The company page in the record anatomy (1.61 "records"): the header's five
// figures (monthly, agreement end with its runway, notice due, in flight,
// owed), the headline on each "Where we stand" card, and the In flight rows
// (open proposals and opportunities with their stage, age and one action).
// Pure: tabs/companies.ts and tabs/companyDossier.ts draw it.

import type { Agreement, Commitment, Opportunity, Proposal } from './types';
import { agreementMonthly, currencyOf, fmtMoneyByCurrency, isAgreementActive, isOpenProposal, type MoneyByCurrency } from './commercial';
import { daysBetween } from './pipeline';
import { agreementRenewal } from './myday';
import { fmtDateShort, fmtMonth } from './dates';
import { plural } from './pageKit';
import { runway } from './pagesCompanies';
import { stageOfProposal, tableCells } from './pagesProposals';
import type { Figure } from './recordFigures';
import type { ClauseKey } from './companyBrief';

const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);

export interface CompanyHeaderInput {
  today: string;
  clientAgreements: Agreement[];
  proposals: Proposal[];
  opportunities: Pick<Opportunity, 'status' | 'archived' | 'proposalId'>[];
  commitments: Pick<Commitment, 'direction' | 'status' | 'dueDate'>[];
}

/** Monthly (since) · agreement end with its runway bar · notice due · in flight (monthly in proposals) · owed. Each
 * only when it has something to say. Pure. */
export function companyHeaderFigures(i: CompanyHeaderInput): Figure[] {
  const out: Figure[] = [];
  const active = i.clientAgreements.filter((a) => isAgreementActive(a, i.today));
  const mrr: MoneyByCurrency = {};
  for (const a of active) { const m = agreementMonthly(a); if (m) mrr[currencyOf(a)] = (mrr[currencyOf(a)] || 0) + m; }
  if (Object.keys(mrr).length) {
    const since = active.map((a) => day(a.startDate) || day(a.dateClientSigned)).filter((d): d is string => !!d).sort()[0];
    out.push({ value: fmtMoneyByCurrency(mrr), label: `a month${since ? ` · since ${fmtMonth(since, 'short')}` : ''}`, tone: 'green' });
  }
  const ending = active.filter((a) => a.endDate && a.endDate >= i.today).sort((a, b) => (a.endDate || '').localeCompare(b.endDate || ''))[0];
  if (ending) {
    const w = runway(ending, i.today);
    out.push({ value: fmtDateShort(ending.endDate, true), label: `agreement ends · ${plural(w?.daysLeft ?? 0, 'day')}`, bar: w ? { pct: w.pct, tone: w.soon ? 'amber' : 'green' } : undefined });
    const { noticeDate, daysToNotice } = agreementRenewal(ending, i.today);
    if (noticeDate && daysToNotice != null) {
      out.push({ value: fmtDateShort(noticeDate, true), label: daysToNotice > 0 ? `notice due · ${plural(daysToNotice, 'day')}` : 'notice window open', tone: daysToNotice <= 90 ? 'amber' : undefined });
    }
  }
  const openProps = i.proposals.filter((p) => !p.archived && isOpenProposal(p));
  // An opportunity that has become one of the open proposals is that proposal, not a second thing.
  const taken = new Set(openProps.map((p) => p.id));
  const flight = openProps.length + i.opportunities.filter((o) => o.status === 'Open' && !o.archived && !(o.proposalId != null && taken.has(o.proposalId))).length;
  if (flight) {
    const m: MoneyByCurrency = {};
    for (const p of openProps) if (p.monthlyFee) m[currencyOf(p)] = (m[currencyOf(p)] || 0) + p.monthlyFee;
    out.push({ value: String(flight), label: `in flight${Object.keys(m).length ? ` · ${fmtMoneyByCurrency(m)} /mo` : ''}` });
  }
  const owed = owedHeadline(i.commitments, i.today);
  if (owed) out.push({ value: owed.headline, label: owed.caption, tone: owed.late ? 'red' : undefined });
  return out.slice(0, 5);
}

/** "We owe 1" / "They owe 2" / "1 each way" with how late the oldest of ours is. Null when nothing is open. Pure. */
export function owedHeadline(commitments: Pick<Commitment, 'direction' | 'status' | 'dueDate'>[], today: string): { headline: string; caption: string; late: boolean } | null {
  const open = commitments.filter((c) => c.status === 'open');
  const ours = open.filter((c) => c.direction === 'ours'), theirs = open.filter((c) => c.direction === 'theirs');
  if (!ours.length && !theirs.length) return null;
  const lateDays = Math.max(0, ...ours.map((c) => (c.dueDate && c.dueDate < today ? daysBetween(c.dueDate, today) ?? 0 : 0)));
  const headline = ours.length && theirs.length ? (ours.length === theirs.length ? `${ours.length} each way` : `We owe ${ours.length} · they owe ${theirs.length}`) : ours.length ? `We owe ${ours.length}` : `They owe ${theirs.length}`;
  const theirsLate = theirs.some((c) => c.dueDate && c.dueDate < today);
  return { headline, caption: lateDays ? `${plural(lateDays, 'day')} late` : theirsLate ? 'theirs is late' : 'nothing late', late: lateDays > 0 };
}

export interface StandInput extends CompanyHeaderInput { relationship: string; /** The last meeting's day and the next one's, for the Meetings card. */ lastMeeting: string | null; nextMeeting: string | null; threads: number }

/** The headline on each "Where we stand" card. Pure. */
export function standHeadline(key: ClauseKey, i: StandInput): string {
  if (key === 'relationship') {
    const since = i.clientAgreements.filter((a) => isAgreementActive(a, i.today)).map((a) => day(a.startDate) || day(a.dateClientSigned)).filter((d): d is string => !!d).sort()[0];
    return i.relationship === 'Active client' && since ? `Client since ${fmtMonth(since, 'short')}` : i.relationship;
  }
  if (key === 'inflight') return i.threads ? `${i.threads} open` : 'Nothing open';
  // Meetings: the next one when there is one, else the last — a date, never how long it has been.
  if (key === 'rhythm') {
    if (i.nextMeeting) return `Next ${i.nextMeeting === i.today ? 'today' : fmtDateShort(i.nextMeeting, true)}`;
    return i.lastMeeting ? `Last ${i.lastMeeting === i.today ? 'today' : fmtDateShort(i.lastMeeting, true)}` : 'None yet';
  }
  if (key === 'commitments') return owedHeadline(i.commitments, i.today)?.headline || 'Tasks overdue';
  return '';
}

export const STAND_TONE: Partial<Record<ClauseKey, 'green' | 'amber' | 'blue' | 'red'>> = { relationship: 'green', inflight: 'amber', rhythm: 'blue', commitments: 'red' };

export interface FlightRow {
  kind: 'proposal' | 'opportunity';
  id: number;
  title: string;
  sub: string;
  chip: { text: string; tone: string };
  days: number | null;
  tone: 'red' | 'amber' | 'ok';
  action: { kind: string; label: string };
  glyph: string;
  glyphTone: 'amber' | 'red' | 'grey' | 'blue' | 'coral';
}

export interface FlightInput {
  today: string;
  proposals: Proposal[];
  opportunities: Opportunity[];
  reviewer: (p: Proposal) => string;
  /** For a sent proposal: is a follow-up due, and is it stale (the Follow-up page's rules). */
  due: (p: Proposal) => boolean;
  stale: (p: Proposal) => boolean;
  followUps: (p: Proposal) => number;
  /** Days since an open opportunity last moved, and whether it has stalled. */
  health: (o: Opportunity) => { stalled: boolean; daysSinceActivity: number | null; noNextAction: boolean };
}

/** Open proposals, then open opportunities that haven't become one of them; the longest-waiting first. Pure. */
export function inFlightRows(i: FlightInput): FlightRow[] {
  const props = i.proposals.filter((p) => !p.archived && isOpenProposal(p));
  const rows: FlightRow[] = props.map((p) => {
    const c = tableCells(p, { today: i.today, reviewer: i.reviewer(p), due: i.due(p), stale: i.stale(p) });
    const stage = stageOfProposal(p);
    const n = i.followUps(p);
    const sub = [`Proposal SL# ${p.id}`, p.remarks ? p.remarks : '', stage === 'client' && p.dateSentToClient ? `sent ${fmtMonth(p.lastSentAt || p.dateSentToClient, 'short', 'ifOther')}` : '', n ? plural(n, 'follow-up') : ''].filter(Boolean).slice(0, 3).join(' · ');
    return {
      kind: 'proposal', id: p.id, title: p.type || 'Proposal', sub, chip: { text: c.chip.text, tone: c.chip.tone }, days: c.days, tone: c.tone,
      action: c.action || { kind: 'open', label: 'Open' },
      glyph: stage === 'review' ? '◔' : stage === 'client' ? '✉' : stage === 'drafting' ? '✎' : '•', glyphTone: stage === 'review' ? 'amber' : stage === 'client' ? 'grey' : stage === 'drafting' ? 'blue' : 'coral',
    };
  });
  const taken = new Set(props.map((p) => p.id));
  for (const o of i.opportunities) {
    if (o.archived || o.status !== 'Open' || (o.proposalId != null && taken.has(o.proposalId))) continue;
    const h = i.health(o);
    rows.push({
      kind: 'opportunity', id: o.id, title: o.name, sub: ['Opportunity', o.stage.toLowerCase(), h.noNextAction ? 'no next step' : (o.nextAction || '').trim()].filter(Boolean).join(' · '),
      chip: h.stalled ? { text: 'Stalled', tone: 'red' } : { text: o.stage, tone: 'grey' }, days: h.daysSinceActivity, tone: h.stalled ? 'red' : 'ok',
      action: h.noNextAction ? { kind: 'open_opp', label: 'Add next step' } : { kind: 'open_opp', label: 'Open' }, glyph: '◇', glyphTone: h.stalled ? 'red' : 'blue',
    });
  }
  const rank = (r: FlightRow) => (r.tone === 'red' ? 0 : r.tone === 'amber' ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || (b.days ?? 0) - (a.days ?? 0));
}
