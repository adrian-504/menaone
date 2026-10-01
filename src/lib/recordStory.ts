// Each record page's story visual and header figures (1.61 "records"): the
// stage stepper (proposals, opportunities, an agreement's signatures) and the
// proposal's header figures. Pure: the record tabs draw what these return.

import type { Agreement, Opportunity, Proposal, StageVisit } from './types';
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
  /** After the last step: the agreement a signed proposal became, or that there is none yet. */
  endNote?: { text: string; tone?: 'amber'; link?: { kind: 'agreement'; id: number } } | null;
}

const isoDay = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);

/** When the service started, against the signature: "started 12 Oct · 9 days after signature", "started on
 * signature", "started 12 Oct" when the signature has no date. Null while it has not started. Pure. */
export function serviceStartText(p: Pick<Proposal, 'serviceStartedAt' | 'dblSignedDate' | 'dateSigned'>): string | null {
  const started = isoDay(p.serviceStartedAt);
  if (!started) return null;
  const signed = isoDay(p.dblSignedDate) || isoDay(p.dateSigned);
  const gap = signed ? daysBetween(signed, started) : null;
  if (gap === 0) return 'started on signature';
  const on = `started ${fmtDateShort(started, true)}`;
  return gap == null ? on : `${on} · ${plural(Math.abs(gap), 'day')} ${gap > 0 ? 'after' : 'before'} signature`;
}

const PROPOSAL_LABEL: Record<string, string> = {
  [PS.REQUEST]: 'Request', [PS.DRAFTING]: 'Drafting', [PS.REVIEW]: 'Internal review', [PS.SENT]: 'Sent to client', [PS.CLIENT_SIGNED]: 'Client signed', [PS.WON]: 'Signed by both',
};

/** Request → Drafting → Internal review → Sent to client → Client signed → Signed by both → Service started, with a
 * date under each; done steps before the current one, which carries its days; a revision shows on Drafting; a lost
 * or withdrawn proposal ends with that. Signed with no start date, the last step is the current one — "Service not
 * started yet", with the days since the signature. `agreement` is the one it became (null: none yet; omitted: not
 * said). Pure. */
export function proposalStepper(p: Proposal, today: string, agreement?: { id: number; agrRef: string | null } | null): Stepper {
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
  if (ended) {
    steps.push({ label: p.status, sub: p.winLossReason || '', state: 'ended' });
    return { steps, currentNote: null };
  }
  const won = p.status === PS.WON;
  const start = serviceStartText(p);
  // Signed and not started: the days count from the signature, and sit under the step (it has no connector after it).
  const signed = isoDay(p.dblSignedDate) || isoDay(p.dateSigned);
  const waiting = won && !start && signed ? daysBetween(signed, today) : null;
  steps.push(won && start ? { label: 'Service started', sub: start.replace(/^started /, ''), state: 'done' }
    : won ? { label: 'Service not started yet', sub: waiting != null && waiting >= 0 ? `${plural(waiting, 'day')} since signature` : 'since signature', state: 'current' }
    : { label: 'Service started', sub: '', state: 'todo' });
  const since = won ? null : stageSince(p);
  const days = since ? daysBetween(since, today) : null;
  const endNote: Stepper['endNote'] = !won || agreement === undefined ? null
    : agreement ? { text: `Agreement ${agreement.agrRef || `#${agreement.id}`}`, link: { kind: 'agreement', id: agreement.id } }
    : { text: 'no agreement yet', tone: 'amber' };
  return { steps, currentNote: days != null && days >= 0 && steps.some((s) => s.state === 'current') ? plural(days, 'day') : null, endNote };
}

/** An opportunity's own stages, the current one with its days and "since" date; a stage it passed through carries the
 * day it entered (from the stage history); Won to come is "→ agreement"; Lost and On Hold end the line. Pure. */
export function opportunityStepper(o: Pick<Opportunity, 'stage' | 'status'>, daysInStage: number | null, visits: StageVisit[] = []): Stepper {
  const line = OPPORTUNITY_STAGES.filter((s) => s !== 'Lost' && s !== 'On Hold') as readonly string[];
  const at = line.indexOf(o.stage);
  const off = at === -1;
  const entered = (s: string) => visits.filter((v) => v.stage === s).map((v) => v.enteredAt.slice(0, 10)).sort().pop() || '';
  const steps: StoryStep[] = line.map((s, i) => {
    const state: StoryStep['state'] = off ? (entered(s) ? 'done' : 'todo') : i < at ? 'done' : i === at ? (s === 'Won' ? 'done' : 'current') : 'todo';
    const on = entered(s);
    const sub = state === 'current' && on ? `since ${fmtDateShort(on, true)}` : state === 'done' && on ? fmtDateShort(on, true) : s === 'Won' && state === 'todo' ? '→ agreement' : '';
    return { label: s, sub, state };
  });
  if (off) steps.push({ label: o.stage, sub: entered(o.stage) ? `since ${fmtDateShort(entered(o.stage), true)}` : '', state: o.stage === 'On Hold' ? 'current' : 'ended' });
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
  const compact = !!opts.compact || n > 7;
  return `<ol class="rk-stepper${opts.tone === 'green' ? ' t-green' : ''}${compact ? ' is-compact' : ''}">${s.steps.map((st, i) => {
    const mark = st.state === 'done' ? '✓' : st.state === 'ended' ? '×' : String(i + 1).padStart(2, '0');
    const line = i < n - 1 ? `<span class="rk-sline is-${st.state === 'done' ? 'done' : st.state === 'current' ? 'cur' : 'todo'}">${st.state === 'current' && s.currentNote ? `<span>${escHtml(s.currentNote)}</span>` : ''}</span>` : '';
    return `<li class="rk-sp is-${st.state}"${st.state === 'current' ? ' aria-current="step"' : ''}${compact && st.state === 'todo' ? ` data-tip="${escHtml(st.label)}"` : ''}><i aria-hidden="true">${mark}</i><span class="rk-sp-t"><b>${escHtml(st.label)}</b>${st.sub ? `<span>${escHtml(st.sub)}</span>` : ''}</span></li>${line}`;
  }).join('')}</ol>${s.endNote ? (s.endNote.link
    ? `<a href="#" class="rlink rk-snote" onclick="event.preventDefault();openRecord('${s.endNote.link.kind}', ${s.endNote.link.id})">→ ${escHtml(s.endNote.text)}</a>`
    : `<span class="rk-snote${s.endNote.tone ? ` t-${s.endNote.tone}` : ''}">${escHtml(s.endNote.text)}</span>`) : ''}`;
}

// ── Proposal header ─────────────────────────────────────────────────────────

/** Monthly · contract value · how long it has waited (without contact once sent) · the offer's expiry or the promise. Pure. */
export function proposalHeaderFigures(p: Proposal, ctx: { today: string; touch: LastTouch | null; due: boolean; /** How it is priced when its lines are not monthly ("per person per month"). */ shape?: string | null }): Figure[] {
  const out: Figure[] = [];
  const cur = currencyOf(p);
  const t = lineTotals(p.lines, p.contractMonths);
  const monthly = t.monthly ?? p.monthlyFee;
  if (monthly) out.push({ value: fmtMoney(monthly, cur), label: 'a month', tone: 'green' });
  // Not a monthly fee: say how it is priced where the monthly figure would be blank.
  else if (ctx.shape) out.push({ value: ctx.shape.charAt(0).toUpperCase() + ctx.shape.slice(1), label: 'pricing' });
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
  } else if (p.status === PS.WON) {
    const signed = isoDay(p.dblSignedDate) || isoDay(p.dateSigned);
    if (signed) out.push({ value: fmtDateShort(signed, true), label: 'signed by both' });
    const start = serviceStartText(p);
    if (start) out.push({ value: fmtDateShort(isoDay(p.serviceStartedAt)!, true), label: start === 'started on signature' ? 'service started · on signature' : `service ${start.replace(/^started [^·]*·?\s*/, 'started · ').replace(/ · $/, '')}` });
    else { const d = signed ? daysBetween(signed, ctx.today) : null; out.push({ value: d != null && d >= 0 ? plural(d, 'day') : '—', label: 'since signature · service not started', tone: 'amber' }); }
  }
  return out.slice(0, 5);
}
