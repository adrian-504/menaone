// Opportunities in My Day's language (1.59 "pages"): a strip for the open
// pipeline (and its weighted value), what has stalled, what is past its close
// date and what was won this year; stage columns with their totals; cards
// with a probability bar, flags that say what to do in plain words, and one
// "→" line: the next step, the proposal it became, or the agreement it won.
// Pure: tabs/opportunities.ts draws it.

import type { Opportunity } from './types';
import type { OpportunityHealth } from './pipeline';
import { daysBetween } from './pipeline';
import { fmtDateShort, fmtMonth } from './dates';
import { moneyTotal, plural, type StripPanel, type Tone } from './pageKit';

const EARLY = new Set(['Lead', 'Qualified', 'Discovery', 'Meeting']);

/** A stage's colour: early grey, working blue, won green, lost and on hold muted / amber. Pure. */
export function oppStageTone(stage: string): Tone {
  if (stage === 'Won') return 'green';
  if (stage === 'Lost') return 'grey';
  if (stage === 'On Hold') return 'amber';
  return EARLY.has(stage) ? 'grey' : 'blue';
}

export const isOpen = (o: Pick<Opportunity, 'status' | 'archived'>): boolean => !o.archived && o.status === 'Open';

/** When it was won: the stage's entry date, else the last update. */
export const wonOn = (o: Pick<Opportunity, 'updatedAt' | 'createdAt'>, stageEnteredAt?: string | null): string => (stageEnteredAt || o.updatedAt || o.createdAt || '').slice(0, 10);

export type OppBucket = 'stalled' | 'overdue' | 'won';

/** Which strip buckets an opportunity falls in. Pure. */
export function oppBuckets(o: Opportunity, h: Pick<OpportunityHealth, 'stalled' | 'closeOverdue'>, today: string, stageEnteredAt?: string | null): OppBucket[] {
  const out: OppBucket[] = [];
  if (isOpen(o) && h.stalled) out.push('stalled');
  if (isOpen(o) && h.closeOverdue) out.push('overdue');
  if (o.stage === 'Won' && !o.archived && wonOn(o, stageEnteredAt).slice(0, 4) === today.slice(0, 4)) out.push('won');
  return out;
}

/** The strip: open pipeline (weighted by probability), stalled, close date passed, won this year. Pure. */
export function oppStrip(opps: Opportunity[], info: (o: Opportunity) => { health: OpportunityHealth; stageEnteredAt?: string | null }, today: string): StripPanel[] {
  const open = opps.filter(isOpen);
  const of = (b: OppBucket) => opps.filter((o) => oppBuckets(o, info(o).health, today, info(o).stageEnteredAt).includes(b));
  const stalled = of('stalled');
  const overdue = of('overdue').sort((a, b) => (a.expectedCloseDate || '').localeCompare(b.expectedCloseDate || ''));
  const won = of('won');
  const longest = Math.max(0, ...stalled.map((o) => info(o).health.daysSinceActivity ?? 0));
  const first = overdue[0];
  return [
    { key: 'all', total: true, n: moneyTotal(open.map((o) => ({ amount: o.estimatedValue, currency: o.currency }))), count: open.length, label: 'open pipeline', lead: 'weighted',
      detail: moneyTotal(open.map((o) => ({ amount: o.estimatedValue != null && o.probability != null ? Math.round(o.estimatedValue * o.probability / 100) : null, currency: o.currency }))), tone: 'coral' },
    { key: 'stalled', n: String(stalled.length), count: stalled.length, label: 'stalled', lead: 'longest', detail: `${plural(longest, 'day')} without activity`, tone: 'red' },
    { key: 'overdue', n: String(overdue.length), count: overdue.length, label: 'close date passed', lead: 'was', detail: first?.expectedCloseDate ? `${fmtDateShort(first.expectedCloseDate)} · ${first.name}` : '', tone: 'amber' },
    { key: 'won', n: String(won.length), count: won.length, label: 'won this year', lead: 'worth', detail: moneyTotal(won.map((o) => ({ amount: o.estimatedValue, currency: o.currency }))), tone: 'green' },
  ];
}

export interface Flag { text: string; tone: 'red' | 'amber' | 'blue' }

/** What the card's chips say, in plain words. Pure. */
export function oppFlags(o: Opportunity, h: OpportunityHealth): Flag[] {
  if (!isOpen(o)) return [];
  const out: Flag[] = [];
  const w = h.waiting;
  if (w?.on === 'them') out.push({ text: `Waiting on client${w.days != null ? ` ${plural(w.days, 'day')}` : ''}`, tone: w.days != null && w.days > 14 ? 'red' : 'amber' });
  if (w?.on === 'us') out.push({ text: `With us${w.days != null ? ` ${plural(w.days, 'day')}` : ''}`, tone: 'blue' });
  if (h.stalled) out.push({ text: `Stalled ${plural(h.daysSinceActivity ?? 0, 'day')}`, tone: 'red' });
  if (h.closeOverdue) out.push({ text: 'Close date passed', tone: 'red' });
  if (h.noNextAction) out.push({ text: 'No next step', tone: 'amber' });
  if (h.closingSoon) out.push({ text: 'Closing soon', tone: 'amber' });
  return out;
}

/** The card's second line: "Acme Holdings · close 30 Sept", "· won 20 Jan", "· lost Apr 2025", else the owner. Pure. */
export function oppSubline(o: Opportunity, stageEnteredAt?: string | null): string {
  const company = o.companyName || 'No company';
  if (o.stage === 'Won') return `${company} · won ${fmtDateShort(wonOn(o, stageEnteredAt), true)}`;
  if (o.stage === 'Lost') return `${company} · lost ${fmtMonth(wonOn(o, stageEnteredAt), 'short', 'ifOther')}`;
  if (o.expectedCloseDate) return `${company} · close ${fmtDateShort(o.expectedCloseDate, true)}`;
  return `${company}${o.owner ? ` · ${o.owner}` : ''}`;
}

export interface LinkedProposal { id: number; stage: 'request' | 'drafting' | 'review' | 'client' | 'signed' | 'lost'; since: string | null; reviewer?: string }
export interface LinkedAgreement { id: number; ref: string | null; endDate: string | null }

/** The "→" line: the agreement a won one became, the proposal an open one became, else the next step, else a prompt. Pure. */
export function oppNext(o: Opportunity, today: string, linked: { proposal?: LinkedProposal | null; agreement?: LinkedAgreement | null }): { text: string; kind: 'agreement' | 'proposal' | 'next' | 'add' | 'reason' | 'none'; id?: number } {
  if (o.stage === 'Lost') return o.winLossReason ? { text: `Reason: ${o.winLossReason}`, kind: 'reason' } : { text: '', kind: 'none' };
  if (o.stage === 'Won' && linked.agreement) {
    const a = linked.agreement;
    return { text: `Agreement ${a.ref || `#${a.id}`}${a.endDate ? ` · ends ${fmtDateShort(a.endDate, true)}` : ''}`, kind: 'agreement', id: a.id };
  }
  if (linked.proposal && o.stage !== 'Won') {
    const p = linked.proposal;
    const days = p.since ? Math.max(0, daysBetween(p.since, today) ?? 0) : null;
    const where = { request: 'requested', drafting: 'drafting', review: `in review${p.reviewer ? ` with ${p.reviewer.split(' ')[0]}` : ''}`, client: 'with the client', signed: 'signed', lost: 'lost' }[p.stage];
    return { text: `Proposal SL# ${p.id} · ${where}${days != null && p.stage !== 'signed' && p.stage !== 'lost' ? `, ${plural(days, 'day')}` : ''}`, kind: 'proposal', id: p.id };
  }
  if (o.nextAction?.trim()) return { text: o.nextAction.trim(), kind: 'next' };
  return isOpen(o) ? { text: 'Add a next step', kind: 'add' } : { text: '', kind: 'none' };
}
