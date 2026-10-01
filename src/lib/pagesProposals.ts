// Proposals (All) in My Day's language (1.59 "pages"): a pipeline strip with
// one panel per stage, sized by how many proposals sit in it, and a table
// whose rows say the stage as a chip, how long it has sat there and the one
// next step. Pure: tabs/database.ts draws it.

import type { Proposal } from './types';
import { PS, fmtMoney, currencyOf, REPORTING_CURRENCY, proposalSentDate } from './commercial';
import { daysBetween } from './pipeline';
import { draftingSince, revisionOf } from './revisions';
import { fmtDateShort, fmtWeekday } from './dates';
import { ageTone, moneyTotal, plural, type StripPanel, type Tone } from './pageKit';

export type Stage = 'request' | 'drafting' | 'review' | 'client' | 'signed' | 'lost';
export const PIPE_ORDER: Stage[] = ['request', 'drafting', 'review', 'client', 'signed'];
export const STAGE_INFO: Record<Stage, { label: string; tone: Tone }> = {
  request: { label: 'Request', tone: 'grey' },
  drafting: { label: 'Drafting', tone: 'blue' },
  review: { label: 'In review', tone: 'amber' },
  client: { label: 'With clients', tone: 'coral' },
  signed: { label: 'Signed', tone: 'green' },
  lost: { label: 'Lost', tone: 'grey' },
};

/** Where a proposal stands. Signed by the client only is still with the client; withdrawn counts with lost. Pure. */
export function stageOfProposal(p: Pick<Proposal, 'status'>): Stage {
  switch (p.status) {
    case PS.REQUEST: return 'request';
    case PS.DRAFTING: return 'drafting';
    case PS.REVIEW: return 'review';
    case PS.SENT: case PS.CLIENT_SIGNED: return 'client';
    case PS.WON: return 'signed';
    default: return 'lost';
  }
}

/** Days in the stage, by threshold: requests and reviews amber at a week; drafts at two; with the client at two weeks, red at two months. */
export const STAGE_AGE: Record<Stage, { amber: number; red: number } | null> = {
  request: { amber: 7, red: 14 }, drafting: { amber: 14, red: 30 }, review: { amber: 7, red: 14 }, client: { amber: 14, red: 60 }, signed: null, lost: null,
};

export function stageSince(p: Proposal): string | null {
  switch (stageOfProposal(p)) {
    case 'request': return p.dateAdded;
    case 'drafting': return draftingSince(p);
    case 'review': return p.reviewRequestedAt || p.dateSentToHassan || null;
    case 'client': return proposalSentDate(p);
    default: return null;
  }
}

export interface TableCells {
  stage: Stage;
  chip: { text: string; tone: Tone };
  /** A second, smaller chip: ⚑ due Fri, follow up. */
  flag: { text: string; tone: 'coral' | 'amber' | 'red' } | null;
  days: number | null;
  tone: 'red' | 'amber' | 'ok';
  monthly: string;
  /** `monthly` says how it is priced rather than an amount. */
  shaped: boolean;
  action: { kind: string; label: string } | null;
}

/** One table row's cells. `due` is the follow-up rule's answer for a sent proposal; `stale` its "mark lost?". Pure. */
export function tableCells(p: Proposal, ctx: { today: string; reviewer: string; due?: boolean; stale?: boolean; agreementId?: number | null; /** How it is priced when not monthly. */ shape?: string | null }): TableCells {
  const stage = stageOfProposal(p);
  const since = stageSince(p);
  const days = since ? Math.max(0, daysBetween(since, ctx.today) ?? 0) : null;
  const t = STAGE_AGE[stage];
  let tone = t ? ageTone(days, t) : 'ok';
  const cur = currencyOf(p);
  const amount = p.monthlyFee ?? p.oneTimeFee ?? null;
  const num = amount == null ? '—' : fmtMoney(amount, cur).replace(cur === REPORTING_CURRENCY ? `${REPORTING_CURRENCY} ` : '', '');
  // Where a monthly figure would be blank: how it is priced ("per person per month"), when that is known.
  const monthly = amount != null && !p.monthlyFee ? `${num} once` : amount == null && ctx.shape ? ctx.shape : num;
  let chip: TableCells['chip'];
  let flag: TableCells['flag'] = null;
  let action: TableCells['action'] = null;
  switch (stage) {
    case 'request': {
      chip = { text: 'Request', tone: 'grey' };
      const left = p.promisedBy ? daysBetween(ctx.today, p.promisedBy) : null;
      if (p.promisedBy && left != null && left >= 0) flag = { text: `⚑ due ${fmtWeekday(p.promisedBy, 'short')}`, tone: left <= 1 ? 'red' : 'coral' };
      if (p.promisedBy && left != null && left < 0) flag = { text: '⚑ promise passed', tone: 'red' };
      if (left != null && left <= 1) tone = 'red';
      action = { kind: 'draft', label: 'Start drafting' };
      break;
    }
    case 'drafting': {
      const rev = revisionOf(p);
      chip = { text: rev > 1 ? `Drafting · rev ${rev}` : 'Drafting', tone: 'blue' };
      action = { kind: 'generate', label: `Generate V${rev}` };
      break;
    }
    case 'review':
      chip = { text: `In review · ${ctx.reviewer.split(' ')[0]}`, tone: 'amber' };
      action = p.reviewStatus === 'approved' ? { kind: 'mark_sent', label: 'Mark sent' } : { kind: 'nudge', label: 'Nudge' };
      break;
    case 'client':
      chip = { text: p.status === PS.CLIENT_SIGNED ? 'Client signed' : 'With client', tone: 'coral' };
      if (ctx.due) flag = { text: 'follow up', tone: 'amber' };
      action = ctx.stale ? { kind: 'mark_lost', label: 'Mark lost' } : { kind: 'followed_up', label: 'Followed up' };
      break;
    case 'signed':
      chip = { text: p.dblSignedDate ? `Signed ${fmtDateShort(p.dblSignedDate, true)}` : 'Signed', tone: 'green' };
      // Signed by both with no start date: the last step is still open.
      if (p.status === PS.WON && !p.serviceStartedAt) flag = { text: 'service not started', tone: 'amber' };
      action = ctx.agreementId ? { kind: 'agreement', label: 'Agreement' } : null;
      break;
    default:
      chip = { text: p.status === PS.WITHDRAWN ? 'Withdrawn' : 'Lost', tone: 'grey' };
  }
  return { stage, chip, flag, days: t ? days : null, tone, monthly, shaped: amount == null && !!ctx.shape, action };
}

/** A pipeline panel's width: its count, never under `min` so a single proposal still reads. Pure. */
export const PIPE_MIN = 1.4;
export function pipeFlex(count: number, min = PIPE_MIN): number {
  return Math.max(min, count);
}

/** The pipeline: request → drafting → in review → with clients → signed, each with its monthly value. Pure. */
export function pipelineStrip(proposals: Proposal[]): StripPanel[] {
  return PIPE_ORDER.map((stage) => {
    const mine = proposals.filter((p) => stageOfProposal(p) === stage);
    return {
      key: stage, n: String(mine.length), count: mine.length, label: STAGE_INFO[stage].label, tone: STAGE_INFO[stage].tone,
      detail: `${moneyTotal(mine.map((p) => ({ amount: p.monthlyFee, currency: p.currency })))} /mo`,
    };
  });
}

/** "8 proposals · newest first". */
export function countLine(n: number, sort: string): string {
  return `${plural(n, 'proposal')}${sort ? ` · ${sort}` : ''}`;
}
