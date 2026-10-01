// Each record page's story visual and header figures (1.61 "records"): the
// stage stepper (proposals, opportunities, an agreement's signatures) and the
// proposal's header figures. Pure: the record tabs draw what these return.

import type { Agreement, Opportunity, Proposal } from './types';
import { PS, PROPOSAL_STAGES, currencyOf, fmtMoney, isLost, isWithdrawn, lineTotals, proposalSentDate, stageIndex } from './commercial';
import { daysBetween } from './pipeline';
import { revisionOf } from './revisions';
import { stageSince } from './pagesProposals';
import { fmtDateShort } from './dates';
import { escHtml } from './utils';
import { plural } from './pageKit';
import { expiresIn } from './pagesQueues';
import type { Figure } from './recordFigures';
import type { LastTouch } from './followup';
import { OPPORTUNITY_STAGES } from './types';

// ── The stepper ─────────────────────────────────────────────────────────────

export interface StoryStep { label: string; sub: string; state: 'done' | 'current' | 'todo' | 'ended' }
export interface Stepper {
  steps: StoryStep[];
  /** On the dashed connector after the current step: how long it has been there ("29 days"). */
  currentNote: string | null;
}

const PROPOSAL_LABEL: Record<string, string> = {
  [PS.REQUEST]: 'Request', [PS.DRAFTING]: 'Drafting', [PS.REVIEW]: 'Internal review', [PS.SENT]: 'Sent to client', [PS.CLIENT_SIGNED]: 'Client signed', [PS.WON]: 'Signed by both',
};

/** Request → Drafting → Internal review → Sent to client → Client signed → Signed by both, with a date under each;
 * done steps before the current one, which carries its days; a revision shows on Drafting; a lost or withdrawn
 * proposal ends with that. Pure. */
export function proposalStepper(p: Proposal, today: string): Stepper {
  const at = stageIndex(p.status);
  const ended = isLost(p) || isWithdrawn(p);
  const rev = revisionOf(p);
  const date: Record<string, string | null | undefined> = {
    [PS.REQUEST]: p.dateAdded, [PS.DRAFTING]: null, [PS.REVIEW]: p.reviewRequestedAt || p.dateSentToHassan, [PS.SENT]: proposalSentDate(p), [PS.CLIENT_SIGNED]: p.dateSigned, [PS.WON]: p.dblSignedDate,
  };
  const steps: StoryStep[] = PROPOSAL_STAGES.map((s, i) => {
    const state: StoryStep['state'] = ended ? (date[s] ? 'done' : 'todo') : i < at ? 'done' : i === at ? (s === PS.WON ? 'done' : 'current') : 'todo';
    let sub = date[s] ? fmtDateShort(date[s], true) : '';
    if (s === PS.DRAFTING && rev > 1) sub = `rev ${rev}`;
    if (s === PS.REVIEW && p.reviewStatus === 'approved') sub = `approved${p.reviewedAt ? ` ${fmtDateShort(p.reviewedAt, true)}` : ''}`;
    if (s === PS.REVIEW && p.reviewStatus === 'changes_requested' && state === 'current') sub = 'changes asked';
    if (s === PS.WON && state === 'todo') sub = '→ agreement';
    return { label: PROPOSAL_LABEL[s], sub, state };
  });
  if (ended) steps.push({ label: p.status, sub: p.winLossReason || '', state: 'ended' });
  const since = stageSince(p);
  const days = !ended && since ? daysBetween(since, today) : null;
  return { steps, currentNote: days != null && days >= 0 && steps.some((s) => s.state === 'current') ? plural(days, 'day') : null };
}

/** An opportunity's own stages, the current one with its days; Lost and On Hold end the line. Pure. */
export function opportunityStepper(o: Pick<Opportunity, 'stage' | 'status'>, daysInStage: number | null): Stepper {
  const line = OPPORTUNITY_STAGES.filter((s) => s !== 'Lost' && s !== 'On Hold') as readonly string[];
  const at = line.indexOf(o.stage);
  const off = at === -1;
  const steps: StoryStep[] = line.map((s, i) => ({ label: s, sub: '', state: off ? 'todo' : i < at ? 'done' : i === at ? (s === 'Won' ? 'done' : 'current') : 'todo' }));
  if (off) steps.push({ label: o.stage, sub: '', state: o.stage === 'On Hold' ? 'current' : 'ended' });
  return { steps, currentNote: daysInStage != null && steps.some((s) => s.state === 'current') ? plural(daysInStage, 'day') : null };
}

/** An agreement's signature trail: Prepared → Sent → Client signed → MENA BIG signed → Filed; a step is done when it
 * has a date. Pure. */
export function signatureStepper(a: Pick<Agreement, 'datePrepared' | 'dateSentToClient' | 'dateClientSigned' | 'dateMenaSigned' | 'dateFiled'>): Stepper {
  const rows: [string, string | null][] = [['Prepared', a.datePrepared], ['Sent', a.dateSentToClient], ['Client signed', a.dateClientSigned], ['MENA BIG signed', a.dateMenaSigned], ['Filed', a.dateFiled]];
  return { steps: rows.map(([label, d]) => ({ label, sub: d ? fmtDateShort(d, true) : '—', state: d ? 'done' : 'todo' })), currentNote: null };
}

/** The stepper as markup: numbered circles joined by a line; blue (or `tone`) when done, a coral ring on the current
 * one and a dashed coral connector after it carrying its days. */
export function stepperHtml(s: Stepper, opts: { tone?: 'blue' | 'green'; compact?: boolean } = {}): string {
  const n = s.steps.length;
  return `<ol class="rk-stepper${opts.tone === 'green' ? ' t-green' : ''}${opts.compact || n > 7 ? ' is-compact' : ''}">${s.steps.map((st, i) => {
    const mark = st.state === 'done' ? '✓' : st.state === 'ended' ? '×' : String(i + 1).padStart(2, '0');
    const line = i < n - 1 ? `<span class="rk-sline is-${st.state === 'done' ? 'done' : st.state === 'current' ? 'cur' : 'todo'}">${st.state === 'current' && s.currentNote ? `<span>${escHtml(s.currentNote)}</span>` : ''}</span>` : '';
    return `<li class="rk-sp is-${st.state}"${st.state === 'current' ? ' aria-current="step"' : ''}><i aria-hidden="true">${mark}</i><span class="rk-sp-t"><b>${escHtml(st.label)}</b>${st.sub ? `<span>${escHtml(st.sub)}</span>` : ''}</span></li>${line}`;
  }).join('')}</ol>`;
}

// ── Proposal header ─────────────────────────────────────────────────────────

/** Monthly · contract value · how long it has waited (without contact once sent) · the offer's expiry or the promise. Pure. */
export function proposalHeaderFigures(p: Proposal, ctx: { today: string; touch: LastTouch | null; due: boolean }): Figure[] {
  const out: Figure[] = [];
  const cur = currencyOf(p);
  const t = lineTotals(p.lines, p.contractMonths);
  const monthly = t.monthly ?? p.monthlyFee;
  if (monthly) out.push({ value: fmtMoney(monthly, cur), label: 'a month', tone: 'green' });
  const value = t.contractValue ?? (monthly && p.contractMonths ? monthly * p.contractMonths : null);
  if (value) out.push({ value: fmtMoney(value, cur), label: `contract value${p.contractMonths ? ` · ${p.contractMonths} mo` : ''}` });
  else if (p.oneTimeFee) out.push({ value: fmtMoney(p.oneTimeFee, cur), label: 'one-time' });
  if (p.status === PS.SENT && ctx.touch) {
    out.push({ value: plural(ctx.touch.days, 'day'), label: ctx.touch.kind === 'sent' ? 'since it was sent' : 'without contact', tone: ctx.due ? (ctx.touch.days > 30 ? 'red' : 'amber') : undefined });
    const left = expiresIn(p.validUntil, ctx.today);
    if (p.validUntil && left != null) out.push({ value: fmtDateShort(p.validUntil, true), label: `offer expires · ${left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${left} days`}`, tone: left <= 7 ? 'red' : undefined });
    else if (p.validUntil) out.push({ value: fmtDateShort(p.validUntil, true), label: 'offer expired', tone: 'red' });
  } else if (!isLost(p) && !isWithdrawn(p) && p.status !== PS.WON) {
    const since = stageSince(p);
    const d = since ? daysBetween(since, ctx.today) : null;
    const word = p.status === PS.REQUEST ? 'since the request' : p.status === PS.DRAFTING ? 'in drafting' : p.status === PS.REVIEW ? 'in review' : 'with the client';
    if (d != null && d >= 0) out.push({ value: plural(d, 'day'), label: word, tone: d >= 14 ? 'red' : d >= 7 ? 'amber' : undefined });
    if (p.promisedBy && (p.status === PS.REQUEST || p.status === PS.DRAFTING)) {
      const left = daysBetween(ctx.today, p.promisedBy) ?? 0;
      out.push({ value: fmtDateShort(p.promisedBy, true), label: left < 0 ? `promised · ${plural(-left, 'day')} late` : left === 0 ? 'promised · today' : `promised · ${plural(left, 'day')} left`, tone: left <= 1 ? 'red' : 'amber' });
    }
  } else if (p.status === PS.WON && p.dblSignedDate) {
    out.push({ value: fmtDateShort(p.dblSignedDate, true), label: 'signed by both' });
  }
  return out.slice(0, 5);
}
