// Pipeline health and win/loss numbers. Pure functions over records, so the
// Analytics page, the opportunity board and tests all agree.

import type { Opportunity, PipelineFact, Proposal } from './types';
import { addMoney, currencyOf, isLost, isWon, isWithdrawn, lineTotals, type MoneyByCurrency } from './commercial';

export const STALLED_DAYS = 14;
export const LONG_IN_STAGE_DAYS = 45;
export const CLOSING_SOON_DAYS = 7;

/** Used when an opportunity has no probability of its own. */
export const STAGE_PROBABILITY: Record<string, number> = {
  Lead: 10, Qualified: 20, Discovery: 30, Meeting: 35, 'Solution Design': 45, Proposal: 60,
  Negotiation: 75, 'Verbal Commitment': 90, Won: 100, Lost: 0, 'On Hold': 10,
};

export function daysBetween(fromIso: string | null | undefined, toIso: string): number | null {
  if (!fromIso) return null;
  const a = new Date(fromIso.slice(0, 10) + 'T12:00:00').getTime();
  const b = new Date(toIso.slice(0, 10) + 'T12:00:00').getTime();
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

export const isOpenOpportunity = (o: Opportunity): boolean => !o.archived && (o.status === 'Open' || (!o.status && !['Won', 'Lost', 'On Hold'].includes(o.stage)));

export function probabilityOf(o: Opportunity): number {
  return o.probability ?? STAGE_PROBABILITY[o.stage] ?? 0;
}

export function weightedValue(o: Opportunity): number | null {
  return o.estimatedValue == null ? null : (o.estimatedValue * probabilityOf(o)) / 100;
}

export interface OpportunityHealth {
  /** 0–100, from fixed rules. */
  score: number;
  label: 'Healthy' | 'Needs attention' | 'At risk';
  tone: 'green' | 'amber' | 'red';
  reasons: string[];
  daysSinceActivity: number | null;
  daysInStage: number | null;
  closeOverdue: boolean;
  closingSoon: boolean;
  noNextAction: boolean;
  /** No activity for over STALLED_DAYS and not waiting on anyone. */
  stalled: boolean;
  /** Who it's waiting on, and for how many days. */
  waiting: { on: 'us' | 'them'; days: number | null } | null;
}

/** Work already planned on the opportunity: an open task (its own or from one
 * of its meetings) or an open commitment we owe. */
export interface OpportunityWork { openWork: boolean }

export function opportunityHealth(o: Opportunity, fact: PipelineFact | undefined, today: string, work?: OpportunityWork): OpportunityHealth {
  const reasons: string[] = [];
  let score = 100;
  const lastActivity = fact?.lastActivityAt || o.createdAt;
  const sinceActivity = daysBetween(lastActivity, today);
  const inStage = daysBetween(fact?.stageEnteredAt || o.createdAt, today);
  const closeIn = o.expectedCloseDate ? daysBetween(today, o.expectedCloseDate) : null;
  // A task or a promise is a next action; the free-text box is the fallback.
  const noNextAction = !(o.nextAction && o.nextAction.trim()) && !work?.openWork;
  const closeOverdue = closeIn != null && closeIn < 0;
  const closingSoon = closeIn != null && closeIn >= 0 && closeIn <= CLOSING_SOON_DAYS;
  const waitingOn = o.waitingOn === 'us' || o.waitingOn === 'them' ? o.waitingOn : null;
  const waiting = waitingOn ? { on: waitingOn, days: daysBetween(o.waitingSince || lastActivity, today) } : null;
  // Waiting on the client: the wait is what's measured. With us: never stalled — it's ours to move.
  const quiet = waitingOn === 'them' ? waiting!.days : waitingOn === 'us' ? null : sinceActivity;
  const quietWhat = waitingOn === 'them' ? 'Waiting on the client for' : 'No activity for';
  if (quiet != null && quiet > 30) { score -= 45; reasons.push(`${quietWhat} ${quiet} days`); }
  else if (quiet != null && quiet > STALLED_DAYS) { score -= 25; reasons.push(`${quietWhat} ${quiet} days`); }
  if (closeOverdue) { score -= 20; reasons.push(`Close date passed ${-closeIn!} days ago`); }
  if (noNextAction) { score -= 15; reasons.push('No next action'); }
  if (inStage != null && inStage > LONG_IN_STAGE_DAYS) { score -= 10; reasons.push(`${inStage} days in ${o.stage}`); }
  if (o.estimatedValue == null) { score -= 10; reasons.push('No value'); }
  score = Math.max(0, score);
  const label = score >= 70 ? 'Healthy' : score >= 40 ? 'Needs attention' : 'At risk';
  const stalled = !waitingOn && sinceActivity != null && sinceActivity > STALLED_DAYS;
  return { score, label, tone: score >= 70 ? 'green' : score >= 40 ? 'amber' : 'red', reasons, daysSinceActivity: sinceActivity, daysInStage: inStage, closeOverdue, closingSoon, noNextAction, stalled, waiting };
}

export interface StageRow {
  stage: string;
  count: number;
  value: MoneyByCurrency;
  weighted: MoneyByCurrency;
  avgDaysInStage: number | null;
  /** Of opportunities that ever reached this stage and are decided, the share won. */
  winRateFromHere: number | null;
}

export function pipelineByStage(opps: Opportunity[], facts: Map<number, PipelineFact>, stages: readonly string[], today: string): StageRow[] {
  return stages.filter((s) => !['Won', 'Lost', 'On Hold'].includes(s)).map((stage) => {
    const here = opps.filter((o) => isOpenOpportunity(o) && o.stage === stage);
    const value: MoneyByCurrency = {};
    const weighted: MoneyByCurrency = {};
    const days: number[] = [];
    for (const o of here) {
      const cur = (o.currency || 'SAR').toUpperCase();
      addMoney(value, cur, o.estimatedValue);
      addMoney(weighted, cur, weightedValue(o));
      const d = daysBetween(facts.get(o.id)?.stageEnteredAt || o.createdAt, today);
      if (d != null) days.push(d);
    }
    const reached = opps.filter((o) => (o.stage === 'Won' || o.stage === 'Lost') && (facts.get(o.id)?.stages || []).some((v) => v.stage === stage));
    const won = reached.filter((o) => o.stage === 'Won').length;
    return {
      stage, count: here.length, value, weighted,
      avgDaysInStage: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null,
      winRateFromHere: reached.length ? won / reached.length : null,
    };
  });
}

// ── Win/loss ──

export interface WinLossRow {
  key: string;
  won: number;
  lost: number;
  open: number;
  /** won / (won + lost); null when nothing is decided. */
  winRate: number | null;
  wonMonthly: MoneyByCurrency;
  avgDaysToSign: number | null;
}

export function daysToSign(p: Proposal): number | null {
  if (!isWon(p) || !p.dblSignedDate) return null;
  const sent = p.dateSentToClient || p.sentDate;
  const d = daysBetween(sent, p.dblSignedDate);
  return d != null && d >= 0 ? d : null;
}

export function monthlyOf(p: Proposal): number | null {
  return p.lines?.length ? lineTotals(p.lines, p.contractMonths).monthly : p.monthlyFee;
}

/** Groups proposals (withdrawn ones left out) by one or more keys each. */
export function winLossBy(proposals: Proposal[], keys: (p: Proposal) => string[]): WinLossRow[] {
  const rows = new Map<string, WinLossRow & { signDays: number[] }>();
  for (const p of proposals) {
    if (p.archived && !isWon(p) && !isLost(p)) continue;
    if (isWithdrawn(p)) continue;
    for (const key of [...new Set(keys(p).filter(Boolean))]) {
      if (!rows.has(key)) rows.set(key, { key, won: 0, lost: 0, open: 0, winRate: null, wonMonthly: {}, avgDaysToSign: null, signDays: [] });
      const r = rows.get(key)!;
      if (isWon(p)) {
        r.won++;
        addMoney(r.wonMonthly, currencyOf(p), monthlyOf(p));
        const d = daysToSign(p);
        if (d != null) r.signDays.push(d);
      } else if (isLost(p)) r.lost++;
      else r.open++;
    }
  }
  return [...rows.values()].map(({ signDays, ...r }) => ({
    ...r,
    winRate: r.won + r.lost ? r.won / (r.won + r.lost) : null,
    avgDaysToSign: signDays.length ? Math.round(signDays.reduce((a, b) => a + b, 0) / signDays.length) : null,
  })).sort((a, b) => (b.won + b.lost + b.open) - (a.won + a.lost + a.open) || a.key.localeCompare(b.key));
}

export function dealSizeBand(p: Proposal): string {
  const m = monthlyOf(p);
  if (m == null || m === 0) return 'Not priced';
  if (m < 5000) return 'Under 5,000 / month';
  if (m < 10000) return '5,000–10,000 / month';
  if (m < 25000) return '10,000–25,000 / month';
  return '25,000+ / month';
}

export function reasonCounts(reasons: (string | null | undefined)[]): { reason: string; count: number; share: number }[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const r of reasons) {
    const key = (r || '').trim() || 'No reason recorded';
    counts.set(key, (counts.get(key) || 0) + 1);
    total++;
  }
  return [...counts.entries()].map(([reason, count]) => ({ reason, count, share: total ? count / total : 0 })).sort((a, b) => b.count - a.count);
}
