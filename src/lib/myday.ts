// My Day: what needs doing today, as data. Pure — the tab renders it.
//
// - Attention: what only you can move today and is not already in Today or
//   the rail, in a fixed order (TIER below), from fixed rules across promises,
//   proposals, agreements, meetings, opportunities, projects and the inbox.
//   Kinds that would flood the list collapse into one group row. It never
//   lists a client for a lack of contact (owner, 1-Oct-2026: not knowing is
//   not the same as quiet, and the app is not a contact log).
// - Timeline: today's meetings and timed tasks in order, with overdue and
//   untimed tasks around them.
// - Coming up: the next seven days, grouped by day.

import { PS, proposalSentDate } from './commercial';
import { draftingSince, openRevision } from './revisions';
import { lastTouch, touchWhat } from './followup';
import { daysBetween, isOpenOpportunity, opportunityHealth } from './pipeline';
import { decideBy, pastTermActive, serviceLive } from './agreementTerms';
import type { Agreement, Commitment, EmailRecord, Meeting, Opportunity, PipelineFact, Project, Proposal, Todo, Touch } from './types';
import type { RecordKind } from './navHistory';
import { localIsoDate } from './outlookTime';
import { fmtDateShort, fmtDateWeekday } from './dates';
import { writeUpState } from './meetingRecap';

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface MyDayInput {
  today: string;
  now: Date;
  proposals: Proposal[];
  opportunities: Opportunity[];
  pipelineFacts: PipelineFact[];
  agreements: Agreement[];
  meetings: Meeting[];
  todos: Todo[];
  projects: Project[];
  /** Promises made and owed (commitments.ts). */
  commitments?: Commitment[];
  /** Company names, for commitment rows. */
  companies?: { id: number; name: string }[];
  /** The database check at launch failed (housekeeping.rs quick_check). */
  integrityFailed?: boolean;
  /** Follow-ups logged against proposals: a sent proposal waits from the last contact, not from the send. */
  touches?: Touch[];
  contactName?: (id: number) => string | null;
  emails: EmailRecord[];
  inboxCount: number;
  /** Reviewer name for "waiting for …" wording. */
  reviewerName: (p: Proposal) => string;
  /** MENA BIG's own email domains, to tell client meetings from internal ones. */
  ownDomains: Set<string>;
  /** Item keys hidden until a date (inclusive of that date's start). */
  snoozed: Record<string, string>;
  /** My Day's rail shows proposals in play (1.57): their stage rows leave this list; a late promise stays. */
  railOwnsProposals?: boolean;
  /** The proposals the rail shows as rows right now. A review outcome waiting on you (approved, changes asked) is
   * listed here only when the rail is not already showing it. */
  railShown?: Set<number>;
  /** An attendee as a person's name (the contact's, when we have them). */
  nameOf?: (attendee: string) => string;
  /** Attention rows actually on screen (not snoozed, not behind "Show N more").
   * When given, a promise's task leaves Today only if its row is one of them. */
  attentionShown?: Set<string>;
}

// ── Attention ───────────────────────────────────────────────────────────────

export type AttentionAction =
  | 'open' | 'prepare' | 'follow_up' | 'send_to_client' | 'start_drafting'
  | 'open_followups' | 'open_action_required' | 'open_inbox' | 'open_opportunities' | 'open_review_queue' | 'open_cleanup'
  | 'mark_kept' | 'toggle_group' | 'open_data_settings' | 'write_up' | 'nudge';

export interface AttentionItem {
  key: string;
  /** Section the rule belongs to — used for the icon and for grouping. */
  kind: 'proposal' | 'review' | 'followup' | 'opportunity' | 'agreement' | 'meeting' | 'project' | 'email' | 'inbox' | 'commitment' | 'system' | 'writeup';
  score: number;
  tone: 'red' | 'amber' | 'accent';
  title: string;
  record?: { kind: RecordKind; id: number };
  companyId?: number | null;
  companyName?: string | null;
  reason: string;
  /** Short age/when label, e.g. "12 days", "Tomorrow 08:30". */
  when?: string;
  action: { kind: AttentionAction; label: string; /** Clean-up queue, for open_cleanup. */ queue?: string };
  /** Set on group rows: the items folded into it. */
  children?: AttentionItem[];
  /** The commitment a row is about (for Mark kept). */
  commitmentId?: number;
}

/** The order of Needs your attention, top to bottom (owner, 1-Oct-2026). A row's score is its tier plus up to 99 for
 * how pressing it is inside the tier, so nothing in a lower tier ever sits above a higher one. */
export const TIER = {
  /** The database check at launch failed: above everything. */
  system: 1000,
  /** 1. A promise of yours that is late, or due today or tomorrow (a proposal you promised for a date counts). */
  ownPromise: 900,
  /** 2. A review outcome waiting on you: approved and not yet sent, or changes asked. */
  reviewOutcome: 800,
  /** 3. Signed by the client, waiting for MENA's signature. */
  countersign: 700,
  /** 4. A promise owed to you that is late. */
  owedLate: 600,
  /** 5. Signed by both for a week or more with the service not started, or (signed in the last 60 days) with no agreement yet. */
  afterSigned: 500,
  /** 6. An agreement whose decide-by date has passed or falls within 30 days, or that is past term and still active. */
  agreement: 400,
  /** 7. A meeting today or tomorrow with no agenda; meetings to write up. */
  meeting: 300,
  /** 8. An opportunity at risk, or with you for more than a week (and those with no next step, folded). */
  opportunity: 200,
  /** Not in the owner's list, kept below it: a project at risk or within 7 days of its date, a kickoff that was due,
   * a flagged email that is due (flagged emails with no date are not counted here: nothing to act on); and, only
   * when My Day has no rail, the proposal stages the rail would show. */
  other: 100,
  /** 9. The Inbox count, last. */
  inbox: 0,
} as const;
/** Days a signed proposal may sit before its missing service start or agreement is raised. */
export const AFTER_SIGNED_DAYS = 7;
/** "No agreement yet" is raised only for proposals signed in the last this-many days: an older one is a record nobody
 * linked, not today's job (its own page still says so). It must never become a permanent row. */
export const NO_AGREEMENT_WITHIN_DAYS = 60;
/** An agreement's decide-by date is raised this many days ahead. */
export const DECIDE_AHEAD_DAYS = 30;
/** An opportunity is raised once it has been with you longer than this. */
export const WITH_YOU_DAYS = 7;
const within = (n: number) => Math.max(0, Math.min(99, n));

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const days = (n: number) => plural(n, 'day');
const shortDate = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return isNaN(d.getTime()) ? iso : fmtDateShort(d, true);
};

function timeLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Whether a meeting involves people outside MENA BIG. */
export function isClientMeeting(m: Meeting, own: Set<string>): boolean {
  if (m.companyId != null || (m.companyName && m.companyName.trim())) return true;
  return (m.attendeeEmails || []).some((e) => {
    const d = e.split('@')[1]?.toLowerCase();
    return !!d && !own.has(d);
  });
}

/** A request or draft we promised for a date: red on the day and after, amber
 * within three days, accent before that. */
export function promisedRank(promisedBy: string | null | undefined, today: string): { tone: AttentionItem['tone']; when: string; late: boolean } | null {
  if (!promisedBy) return null;
  const d = daysBetween(today, promisedBy) ?? 0;
  const date = new Date(`${promisedBy.slice(0, 10)}T12:00:00`);
  const label = isNaN(date.getTime()) ? promisedBy : fmtDateWeekday(date);
  return { tone: d <= 0 ? 'red' : d <= 3 ? 'amber' : 'accent', when: `Promised by ${label}`, late: d <= 0 };
}

function proposalItems(i: MyDayInput): AttentionItem[] {
  const out: AttentionItem[] = [];
  const linked = new Set(i.agreements.map((a) => a.proposalId).filter((x) => x != null));
  for (const p of i.proposals) {
    if (p.archived) continue;
    const base = { record: { kind: 'proposal' as RecordKind, id: p.id }, companyId: p.companyId ?? null, companyName: p.client, title: p.client };
    const services = p.type ? ` · ${p.type}` : '';
    if (p.status === PS.CLIENT_SIGNED) {
      const d = daysBetween(p.dateSigned || proposalSentDate(p), i.today);
      // A signature from months ago is a record nobody updated, not today's job: last in its tier.
      const stale = d != null && d > 30;
      out.push({ ...base, key: `proposal:${p.id}:countersign`, kind: 'proposal', score: TIER.countersign + (stale ? 0 : 50 + within(d ?? 0)), tone: stale ? 'amber' : 'red',
        reason: stale ? `Still marked "Signed by Client" — countersign it or update the status${services}` : `Signed by the client — countersign it${services}`,
        when: d != null ? days(d) : undefined, action: { kind: 'open', label: 'Open' } });
    } else if (p.status === PS.WON) {
      // Signed by both a week or more ago and the last steps are not taken (1.61's fields).
      const signed = p.dblSignedDate || p.dateSigned;
      const d = daysBetween(signed, i.today);
      if (d == null || d < AFTER_SIGNED_DAYS) continue;
      if (!p.serviceStartedAt) out.push({ ...base, key: `proposal:${p.id}:not-started`, kind: 'proposal', score: TIER.afterSigned + 50 + within(d / 4), tone: 'amber',
        reason: `Signed by both ${days(d)} ago — the service has not started${services}`, when: days(d), action: { kind: 'open', label: 'Open' } });
      else if (!linked.has(p.id) && d <= NO_AGREEMENT_WITHIN_DAYS) out.push({ ...base, key: `proposal:${p.id}:no-agreement`, kind: 'proposal', score: TIER.afterSigned + within(d / 8), tone: 'accent',
        reason: `Signed by both on ${shortDate(signed!)} — no agreement yet${services}`, when: days(d), action: { kind: 'open', label: 'Open' } });
    } else if (p.status === PS.REVIEW && p.reviewStatus === 'changes_requested') {
      out.push({ ...base, key: `proposal:${p.id}:changes`, kind: 'review', score: TIER.reviewOutcome + 50, tone: 'red',
        reason: `${i.reviewerName(p)} asked for changes${p.reviewNote ? `: ${p.reviewNote}` : ''}`, action: { kind: 'open', label: 'Open' } });
    } else if (p.status === PS.REVIEW && p.reviewStatus === 'approved') {
      out.push({ ...base, key: `proposal:${p.id}:approved`, kind: 'review', score: TIER.reviewOutcome + 40, tone: 'amber',
        reason: `Approved by ${i.reviewerName(p)} — send it to the client${services}`, action: { kind: 'send_to_client', label: 'Mark as sent' } });
    } else if (p.status === PS.REVIEW) {
      const d = daysBetween(p.reviewRequestedAt || p.dateSentToHassan, i.today) ?? 0;
      if (d >= 3) out.push({ ...base, key: `proposal:${p.id}:waiting-review`, kind: 'review', score: TIER.other + 20 + Math.min(d, 20) / 2, tone: d > 14 ? 'amber' : 'accent',
        reason: `Waiting for ${i.reviewerName(p)}'s review${services}`, when: days(d), action: { kind: 'open', label: 'Open' } });
    } else if (p.status === PS.REQUEST) {
      const d = daysBetween(p.dateAdded, i.today) ?? 0;
      const promised = promisedRank(p.promisedBy, i.today);
      out.push({ ...base, key: `proposal:${p.id}:request`, kind: 'proposal', score: TIER.other + 60 + Math.min(d, 20) / 2 + (promised?.late ? 20 : 0), tone: promised?.tone ?? (d > 3 ? 'red' : 'amber'),
        reason: `Proposal requested — not started${services}`, when: promised?.when ?? (d ? days(d) : 'Today'), action: { kind: 'start_drafting', label: 'Start drafting' } });
    } else if (p.status === PS.DRAFTING) {
      const d = daysBetween(draftingSince(p), i.today) ?? 0;
      // A revision counts from the client's request; the first promise-by date no longer applies.
      const revising = openRevision(p);
      const what = revising ? `Revision ${revising.number} in drafting` : 'Still drafting';
      const promised = revising ? null : promisedRank(p.promisedBy, i.today);
      const score = TIER.other + 46 + Math.min(d, 30) / 3;
      if (promised) out.push({ ...base, key: `proposal:${p.id}:drafting`, kind: 'proposal', score: score + (promised.late ? 20 : 0), tone: promised.tone,
        reason: `${what}${services}`, when: promised.when, action: { kind: 'open', label: 'Open' } });
      else if (d > 7) out.push({ ...base, key: `proposal:${p.id}:drafting`, kind: 'proposal', score, tone: 'amber',
        reason: `${what}${services}`, when: days(d), action: { kind: 'open', label: 'Open' } });
    } else if (p.status === PS.SENT) {
      // Waiting since the last contact (notes, the client's emails, meetings, logged follow-ups), as Follow-up counts it.
      const touch = lastTouch(p, { emails: i.emails, meetings: i.meetings, today: i.today, ownDomains: i.ownDomains, touches: i.touches, contactName: i.contactName });
      const d = touch?.days ?? daysBetween(proposalSentDate(p), i.today);
      if (d == null || d <= 10) continue;
      if (p.snoozedUntil && p.snoozedUntil >= i.today) continue;
      const validPassed = p.validUntil && p.validUntil < i.today;
      out.push({ ...base, key: `proposal:${p.id}:followup`, kind: 'followup', score: TIER.other + (d <= 45 ? 40 + Math.min(d, 45) / 5 : 8), tone: d <= 45 ? 'amber' : 'accent',
        reason: validPassed ? `No answer, and the offer expired on ${shortDate(p.validUntil!)}${services}` : touch && touch.kind !== 'sent' ? `No answer — ${touchWhat(touch)}${services}` : `Sent ${days(d)} ago, no answer${services}`,
        when: days(d), action: { kind: 'follow_up', label: 'Follow up' } });
    }
  }
  return out;
}

/** A proposal we promised by today or earlier and haven't sent for review: a late promise, not a stage — it stays here too. */
function latePromiseItems(i: MyDayInput): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const p of i.proposals) {
    if (p.archived || (p.status !== PS.REQUEST && p.status !== PS.DRAFTING) || !p.promisedBy || openRevision(p)) continue;
    const d = daysBetween(i.today, p.promisedBy) ?? 0;
    if (d > 0) continue;
    const services = p.type ? ` · ${p.type}` : '';
    out.push({ key: `proposal:${p.id}:promise`, kind: 'commitment', record: { kind: 'proposal', id: p.id }, companyId: p.companyId ?? null, companyName: p.client,
      title: `${p.client} proposal`, score: TIER.ownPromise + 50 + within(-d), tone: 'red',
      reason: `You promised it for ${shortDate(p.promisedBy)}${d < 0 ? ` — ${days(-d)} late` : ' — due today'}${services}`, when: d < 0 ? days(-d) : 'Today',
      action: p.status === PS.REQUEST ? { kind: 'start_drafting', label: 'Start drafting' } : { kind: 'open', label: 'Open' } });
  }
  return out;
}

/** Whether an opportunity already has work planned: an open task (its own or
 * from one of its meetings) or an open promise we made. */
export function hasOpenWork(o: Opportunity, i: Pick<MyDayInput, 'todos' | 'meetings' | 'commitments'>): boolean {
  const meetingIds = new Set(i.meetings.filter((m) => m.opportunityId === o.id).map((m) => m.id));
  const task = i.todos.some((t) => t.status !== 'Done' && (t.opportunityId === o.id || (t.meetingId != null && meetingIds.has(t.meetingId))));
  return task || (i.commitments || []).some((c) => c.direction === 'ours' && c.status === 'open' && c.opportunityId === o.id);
}

function opportunityItems(i: MyDayInput): AttentionItem[] {
  const facts = new Map(i.pipelineFacts.map((f) => [f.opportunityId, f]));
  const out: AttentionItem[] = [];
  for (const o of i.opportunities) {
    if (!isOpenOpportunity(o)) continue;
    const h = opportunityHealth(o, facts.get(o.id), i.today, { openWork: hasOpenWork(o, i) });
    const base = { record: { kind: 'opportunity' as RecordKind, id: o.id }, companyId: o.companyId, companyName: o.companyName, title: o.name };
    if (h.closeOverdue || h.tone === 'red') {
      out.push({ ...base, key: `opportunity:${o.id}:risk`, kind: 'opportunity', score: TIER.opportunity + 60 + (h.closeOverdue ? 6 : 0), tone: 'red',
        reason: `At risk — ${h.reasons[0] || 'needs attention'}`, action: { kind: 'open', label: 'Open' } });
    } else if (h.waiting?.on === 'us') {
      // With you for a week or less is not yet something to raise.
      const d = h.waiting.days ?? 0;
      if (d > WITH_YOU_DAYS) out.push({ ...base, key: `opportunity:${o.id}:with-us`, kind: 'opportunity', score: TIER.opportunity + 30 + Math.min(d, 30) / 3, tone: 'amber',
        reason: `With you for ${days(d)} — the next move is yours${o.waitingNote ? `: ${o.waitingNote}` : ''}`, when: days(d), action: { kind: 'open', label: 'Open' } });
    } else if (h.noNextAction) {
      out.push({ ...base, key: `opportunity:${o.id}:next`, kind: 'opportunity', score: TIER.opportunity + 10, tone: 'accent',
        reason: `${o.stage} · no next step set`, action: { kind: 'open', label: 'Set next step' } });
    }
  }
  return out;
}

/** Promises: ours overdue first, then ours due today or tomorrow (tier 1), and the client's overdue ones folded
 * into one row (tier 4). */
function commitmentItems(i: MyDayInput): AttentionItem[] {
  const tomorrow = addDays(i.today, 1);
  const out: AttentionItem[] = [];
  for (const c of i.commitments || []) {
    if (c.status !== 'open' || !c.dueDate) continue;
    const company = c.companyId != null ? (i.companies || []).find((x) => x.id === c.companyId)?.name ?? null : null;
    const record = c.opportunityId != null ? { kind: 'opportunity' as RecordKind, id: c.opportunityId }
      : c.projectId != null ? { kind: 'project' as RecordKind, id: c.projectId }
      : c.sourceType === 'meeting' && c.sourceId != null ? { kind: 'meeting' as RecordKind, id: c.sourceId }
      : c.companyId != null ? { kind: 'company' as RecordKind, id: c.companyId } : undefined;
    const base = { kind: 'commitment' as const, title: c.text, record, companyId: c.companyId, companyName: company, commitmentId: c.id };
    const late = daysBetween(c.dueDate, i.today) ?? 0;
    if (c.direction === 'ours' && c.dueDate < i.today) {
      out.push({ ...base, key: `commitment:${c.id}:overdue`, score: TIER.ownPromise + 50 + within(late), tone: 'red',
        reason: `You promised this for ${shortDate(c.dueDate)} — ${days(late)} late`, when: days(late), action: { kind: 'mark_kept', label: 'Mark kept' } });
    } else if (c.direction === 'ours' && (c.dueDate === i.today || c.dueDate === tomorrow)) {
      out.push({ ...base, key: `commitment:${c.id}:due`, score: TIER.ownPromise + (c.dueDate === i.today ? 20 : 10), tone: 'amber',
        reason: `You promised this for ${c.dueDate === i.today ? 'today' : 'tomorrow'}`, when: c.dueDate === i.today ? 'Today' : 'Tomorrow', action: { kind: 'mark_kept', label: 'Mark kept' } });
    } else if (c.direction === 'theirs' && c.dueDate < i.today) {
      out.push({ ...base, key: `commitment:${c.id}:owed`, score: TIER.owedLate + within(late), tone: 'accent',
        reason: `Promised to you for ${shortDate(c.dueDate)} — chase it or mark it kept`, when: days(late), action: { kind: 'mark_kept', label: 'Mark kept' } });
    }
  }
  return out;
}

/** Days to an agreement's end and to its notice date (the end less its notice
 * period) — My Day's renewal rule, shared with Company 360 and the Brief. */
export function agreementRenewal(a: Pick<Agreement, 'endDate' | 'noticeDays'>, today: string): { daysToEnd: number | null; noticeDate: string | null; daysToNotice: number | null } {
  if (!a.endDate) return { daysToEnd: null, noticeDate: null, daysToNotice: null };
  const daysToEnd = daysBetween(today, a.endDate)!;
  if (a.noticeDays == null) return { daysToEnd, noticeDate: null, daysToNotice: null };
  const d = new Date(`${a.endDate.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - a.noticeDays);
  return { daysToEnd, noticeDate: d.toISOString().slice(0, 10), daysToNotice: daysToEnd - a.noticeDays };
}

function agreementItems(i: MyDayInput): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const a of i.agreements) {
    if (a.status === 'Canceled') continue;
    const base = { record: { kind: 'agreement' as RecordKind, id: a.id }, companyId: a.companyId ?? null, companyName: a.client, title: a.client || a.agrRef || 'Agreement' };
    const end = a.endDate ? a.endDate.slice(0, 10) : null;
    if (serviceLive(a) && end) {
      // The renewal is decided (1.61): nothing to plan. It comes back on the end date, to mark the service ended.
      if (a.renewalDecision) {
        const d = daysBetween(i.today, end)!;
        if (d > 0 || d < -7) continue;
        const how = a.renewalDecision === 'end' ? '' : a.renewalDecision === 'renew' ? ' (the renewal is drafted)' : ' (renewing with changes)';
        out.push({ ...base, key: `agreement:${a.id}:renewal`, kind: 'agreement', score: TIER.agreement + 30, tone: 'amber',
          reason: `${d === 0 ? 'Ends today' : `Ended ${days(-d)} ago`} — mark the service ended${how}`, when: shortDate(end), action: { kind: 'open', label: 'Open' } });
        continue;
      }
      // Past its term and still served and invoiced: the renewal paperwork is missing.
      if (pastTermActive(a, i.today)) {
        const d = daysBetween(end, i.today) ?? 0;
        out.push({ ...base, key: `agreement:${a.id}:renewal`, kind: 'agreement', score: TIER.agreement + 70 + within(d / 30), tone: 'red',
          reason: `Past term since ${shortDate(end)}, still active — renew it or end it${a.autoRenew ? ' (set to auto-renew)' : ''}`, when: shortDate(end), action: { kind: 'open', label: 'Open' } });
        continue;
      }
      // The last day to decide: the end less its notice period (the end itself when the notice was never recorded).
      const by = decideBy(a, i.today);
      if (!by || by.days > DECIDE_AHEAD_DAYS) continue;
      const notice = by.noticeKnown ? '' : ' (notice period not recorded)';
      if (by.days < 0) out.push({ ...base, key: `agreement:${a.id}:renewal`, kind: 'agreement', score: TIER.agreement + 60, tone: 'red',
        reason: `The last day to decide was ${shortDate(by.date)} — it ends ${shortDate(end)}; renew it or let it end`, when: shortDate(end), action: { kind: 'open', label: 'Open' } });
      else out.push({ ...base, key: `agreement:${a.id}:renewal`, kind: 'agreement', score: TIER.agreement + 50 - by.days, tone: by.days <= 7 ? 'red' : 'amber',
        reason: `Decide by ${shortDate(by.date)}${by.days === 0 ? ' — today' : ` — in ${days(by.days)}`}: renew it or let it end on ${shortDate(end)}${notice}`, when: shortDate(by.date), action: { kind: 'open', label: 'Open' } });
    } else if (a.serviceStatus === 'Kickoff scheduled' && a.startDate && a.startDate <= i.today) {
      out.push({ ...base, key: `agreement:${a.id}:kickoff`, kind: 'agreement', score: TIER.other + 50, tone: 'amber',
        reason: `Kickoff was due ${a.startDate === i.today ? 'today' : shortDate(a.startDate)} — mark the service active`, action: { kind: 'open', label: 'Open' } });
    }
  }
  return out;
}

function meetingItems(i: MyDayInput): AttentionItem[] {
  const tomorrow = addDays(i.today, 1);
  const out: AttentionItem[] = [];
  for (const m of i.meetings) {
    if (m.isCancelled || !m.meetingDate || (m.meetingDate !== i.today && m.meetingDate !== tomorrow)) continue;
    if (m.agenda && m.agenda.trim()) continue;
    if (!isClientMeeting(m, i.ownDomains)) continue;
    if (m.meetingDate === i.today && m.startAt && new Date(m.startAt) < i.now) continue;
    const isToday = m.meetingDate === i.today;
    out.push({ key: `meeting:${m.id}:prepare`, kind: 'meeting', record: { kind: 'meeting', id: m.id }, companyId: m.companyId ?? null, companyName: m.companyName,
      title: m.title, score: TIER.meeting + (isToday ? 60 : 50), tone: isToday ? 'red' : 'amber',
      reason: m.companyName ? 'No agenda yet — check the client brief' : 'No agenda yet',
      when: `${isToday ? 'Today' : 'Tomorrow'}${m.startAt ? ` ${timeLabel(m.startAt)}` : ''}`, action: { kind: 'prepare', label: 'Prepare' } });
  }
  return out;
}

/** "omar.haddad@acme.test" → "Omar Haddad"; a name stays as it is. Pure. */
export function personName(attendee: string): string {
  if (!attendee.includes('@')) return attendee;
  return attendee.split('@')[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/** A client meeting that ended today or yesterday with nothing written (the Meetings page's write-up rule). */
function writeUpItems(i: MyDayInput): AttentionItem[] {
  const yesterday = addDays(i.today, -1);
  const out: AttentionItem[] = [];
  for (const m of i.meetings) {
    if (m.isCancelled || (m.meetingDate !== i.today && m.meetingDate !== yesterday)) continue;
    const ended = m.meetingDate === yesterday || (m.endAt ? new Date(m.endAt) <= i.now : false);
    if (!ended || !isClientMeeting(m, i.ownDomains)) continue;
    const tasks = i.todos.filter((t) => t.meetingId === m.id);
    if (!writeUpState(m, tasks, true).needsWriteUp) continue;
    const guest = (m.attendees || []).find((a) => !Array.from(i.ownDomains).some((d) => a.toLowerCase().endsWith(`@${d}`)));
    const who = guest ? (i.nameOf ? i.nameOf(guest) : personName(guest)) : '';
    const isToday = m.meetingDate === i.today;
    out.push({ key: `meeting:${m.id}:writeup`, kind: 'writeup', record: { kind: 'meeting', id: m.id }, companyId: m.companyId ?? null, companyName: m.companyName,
      title: `Write up ${m.title}`, score: TIER.meeting + (isToday ? 30 : 20), tone: 'amber',
      reason: [m.endAt ? `Ended ${timeLabel(m.endAt)}` : 'Ended', 'no notes yet', who || ''].filter(Boolean).join(' · '),
      when: isToday ? 'today' : 'yesterday', action: { kind: 'write_up', label: 'Write up' } });
  }
  return out;
}

function projectItems(i: MyDayInput): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const p of i.projects) {
    if (p.archived || p.status === 'Completed' || p.status === 'Cancelled') continue;
    const base = { record: { kind: 'project' as RecordKind, id: p.id }, companyId: p.companyId ?? null, companyName: p.companyName, title: p.name };
    const d = p.targetDate ? daysBetween(i.today, p.targetDate)! : null;
    if (p.status === 'At Risk') out.push({ ...base, key: `project:${p.id}:risk`, kind: 'project', score: TIER.other + 58, tone: 'red', reason: 'Marked at risk', action: { kind: 'open', label: 'Open' } });
    else if (d != null && d < 0) out.push({ ...base, key: `project:${p.id}:late`, kind: 'project', score: TIER.other + 54, tone: 'red', reason: `Target date passed ${days(-d)} ago · ${p.computedProgress ?? 0}% done`, action: { kind: 'open', label: 'Open' } });
    else if (d != null && d <= 7) out.push({ ...base, key: `project:${p.id}:due`, kind: 'project', score: TIER.other + 48, tone: 'amber', reason: `Due ${d === 0 ? 'today' : `in ${days(d)}`} · ${p.computedProgress ?? 0}% done`, action: { kind: 'open', label: 'Open' } });
  }
  return out;
}

function emailItems(i: MyDayInput): AttentionItem[] {
  const flagged = i.emails.filter((e) => e.flagStatus === 'flagged');
  if (!flagged.length) return [];
  const endOfToday = new Date(`${i.today}T23:59:59`);
  const due = flagged.filter((e) => e.flagDueAt && new Date(e.flagDueAt) <= endOfToday);
  return due.map((e) => ({
    key: `email:${e.id}:due`, kind: 'email' as const, title: e.subject || '(No subject)', companyId: e.companyId ?? null, companyName: e.companyName,
    score: TIER.other + 72, tone: new Date(e.flagDueAt!) < i.now ? 'red' as const : 'amber' as const,
    reason: `Flagged email from ${e.senderName || e.senderEmail || 'someone'}`, when: e.flagDueAt!.slice(0, 10) < i.today ? 'Overdue' : 'Due today',
    action: { kind: 'open_action_required' as const, label: 'Open' },
  }));
}

const GROUP_WHEN_OVER = 3;
interface GroupRule {
  /** Fold only when there are more than this many (default GROUP_WHEN_OVER). */
  over?: number;
  /** Which items fold into the group; urgent ones always stay visible. */
  folds: (x: AttentionItem) => boolean;
  make: (items: AttentionItem[]) => Omit<AttentionItem, 'children' | 'score'>;
}
const GROUPS: GroupRule[] = [
  { folds: (x) => x.key.endsWith(':followup') && x.tone === 'accent',
    make: (items) => ({ key: 'group:followup-old', kind: 'followup', tone: 'accent', title: `${plural(items.length, 'proposal')} sent over 45 days ago with no answer`,
      reason: 'Follow up one last time, or mark them lost', action: { kind: 'open_cleanup', label: 'Clean up', queue: 'stale-sent' } }) },
  { over: 6, folds: (x) => x.key.endsWith(':followup') && x.tone === 'amber',
    make: (items) => ({ key: 'group:followup', kind: 'followup', tone: 'amber', title: `${plural(items.length, 'proposal')} to follow up`,
      reason: 'Sent to the client 10 to 45 days ago with no answer', action: { kind: 'open_followups', label: 'Open follow-ups' } }) },
  { folds: (x) => x.key.endsWith(':waiting-review'),
    make: (items) => ({ key: 'group:review', kind: 'review', tone: items.some((x) => x.tone === 'amber') ? 'amber' : 'accent', title: `${plural(items.length, 'proposal')} waiting for review`,
      reason: `In internal review — the oldest for ${days(Math.max(...items.map((x) => parseInt(x.when || '0', 10))))}`, action: { kind: 'open_review_queue', label: 'Open' } }) },
  { over: 0, folds: (x) => x.key.endsWith(':owed'),
    make: (items) => ({ key: 'group:owed', kind: 'commitment', tone: 'accent', title: `Owed to you (${items.length})`,
      reason: 'Clients promised these and the date has passed', action: { kind: 'toggle_group', label: 'Show' } }) },
  // Meetings to write up: one row once there are more than two.
  { over: 2, folds: (x) => x.key.endsWith(':writeup'),
    make: (items) => ({ key: 'group:writeup', kind: 'writeup', tone: 'amber', title: `${plural(items.length, 'meeting')} to write up`,
      reason: 'Ended with nothing written yet', action: { kind: 'toggle_group', label: 'Show' } }) },
  // Signed by both, no agreement yet: one row once there are more than two.
  { over: 2, folds: (x) => x.key.endsWith(':no-agreement'),
    make: (items) => ({ key: 'group:no-agreement', kind: 'proposal', tone: 'accent', title: `${plural(items.length, 'signed proposal')} with no agreement yet`,
      reason: 'Signed by both a week or more ago — draft the agreement, or link the one that exists', action: { kind: 'toggle_group', label: 'Show' } }) },
  { folds: (x) => x.key.endsWith(':next'),
    make: (items) => ({ key: 'group:opportunity', kind: 'opportunity', tone: 'accent', title: `${plural(items.length, 'opportunity', 'opportunities')} with no next step`,
      reason: 'Decide the next step for each, or close it', action: { kind: 'open_cleanup', label: 'Clean up', queue: 'opportunity-incomplete' } }) },
];

const REQUEST_GROUP_STAGE: Record<string, [string, string]> = {
  [PS.REQUEST]: ['proposal request received', 'proposal requests received'],
  [PS.DRAFTING]: ['proposal in drafting', 'proposals in drafting'],
  [PS.REVIEW]: ['proposal in internal review', 'proposals in internal review'],
  [PS.SENT]: ['proposal sent to the client', 'proposals sent to the client'],
  [PS.CLIENT_SIGNED]: ['proposal signed by the client', 'proposals signed by the client'],
};
/** "3 proposal requests received" when they share a stage, else "3 proposals". */
export function requestGroupReason(statuses: string[]): string {
  const n = statuses.length;
  const shared = statuses.every((s) => s === statuses[0]) ? REQUEST_GROUP_STAGE[statuses[0]] : undefined;
  return shared ? `${n} ${n === 1 ? shared[0] : shared[1]}` : `${n} proposals`;
}

const snoozedNow = (i: MyDayInput, key: string) => !!i.snoozed[key] && i.snoozed[key] > i.today;

/** Proposal-stage rows the rail's Proposals in play already shows with its own action (1.57):
 * requests and drafts, waiting for review (and the reviewer's answer), and sent with no answer. */
export function inRail(key: string): boolean {
  return /^proposal:\d+:(request|drafting|waiting-review|changes|approved|followup)$/.test(key);
}

/** A review outcome waiting on you: it is raised here unless the rail is showing that proposal's row. */
const isReviewOutcome = (key: string) => /^proposal:\d+:(changes|approved)$/.test(key);

/** Everything that needs you, in the order of TIER; inside a tier, the most pressing first. Nothing here is also a
 * row in the rail, and no client is listed for a lack of contact. */
export function buildAttention(i: MyDayInput): AttentionItem[] {
  const ownedByRail = (x: AttentionItem) => inRail(x.key) && !(isReviewOutcome(x.key) && i.railShown && !i.railShown.has(x.record!.id));
  let items = [
    ...(i.railOwnsProposals ? [...proposalItems(i).filter((x) => !ownedByRail(x)), ...latePromiseItems(i)] : proposalItems(i)), ...opportunityItems(i), ...commitmentItems(i), ...agreementItems(i), ...meetingItems(i), ...writeUpItems(i), ...projectItems(i), ...emailItems(i),
  ];
  // The launch check found a problem: one red row, nothing done automatically.
  if (i.integrityFailed) items.push({ key: 'db:integrity', kind: 'system', title: 'Database check failed — back up and tell Ahmad', score: TIER.system, tone: 'red', reason: 'Settings → Data has the details and the backups', action: { kind: 'open_data_settings', label: 'Open' } });
  if (i.inboxCount > 0) items.push({ key: 'inbox', kind: 'inbox', title: `${plural(i.inboxCount, 'item')} in your Inbox`, score: TIER.inbox, tone: 'accent', reason: 'Captured but not sorted yet', action: { kind: 'open_inbox', label: 'Sort' } });
  items = items.filter((x) => !snoozedNow(i, x.key));

  const groups: AttentionItem[] = [];
  // Proposals requested together are one row: the client, the shared stage, the most urgent one's tone.
  const groupOf = new Map(i.proposals.filter((p) => p.requestGroup).map((p) => [p.id, p]));
  const byGroup = new Map<string, AttentionItem[]>();
  for (const x of items) {
    const p = x.record?.kind === 'proposal' ? groupOf.get(x.record.id) : undefined;
    if (p?.requestGroup) byGroup.set(p.requestGroup, [...(byGroup.get(p.requestGroup) || []), x]);
  }
  for (const [group, folded] of byGroup) {
    if (folded.length < 2) continue;
    folded.sort((a, b) => b.score - a.score);
    const keys = new Set(folded.map((x) => x.key));
    items = items.filter((x) => !keys.has(x.key));
    const members = folded.map((x) => groupOf.get(x.record!.id)!);
    const lead = members[0];
    const row: AttentionItem = {
      key: `group:request:${group}`, kind: 'proposal', tone: folded[0].tone, score: folded[0].score,
      title: lead.client, companyId: lead.companyId ?? null, companyName: lead.client,
      record: lead.companyId != null ? { kind: 'company', id: lead.companyId } : folded[0].record,
      reason: requestGroupReason(members.map((p) => p.status)), when: folded[0].when,
      action: { kind: 'open', label: 'Open' }, children: folded,
    };
    if (!snoozedNow(i, row.key)) groups.push(row);
  }
  for (const rule of GROUPS) {
    const folded = items.filter(rule.folds);
    if (folded.length <= (rule.over ?? GROUP_WHEN_OVER)) continue;
    folded.sort((a, b) => b.score - a.score);
    const keys = new Set(folded.map((x) => x.key));
    items = items.filter((x) => !keys.has(x.key));
    const group: AttentionItem = { ...rule.make(folded), score: folded[0].score - 2, children: folded };
    if (!snoozedNow(i, group.key)) groups.push(group);
  }
  return [...items, ...groups].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

// ── Timeline ────────────────────────────────────────────────────────────────

export type TimelineEntry =
  | { type: 'meeting'; at: string; meeting: Meeting; past: boolean; current: boolean }
  | { type: 'task'; at: string; task: Todo; past: boolean }
  | { type: 'now'; at: string };

export interface Timeline {
  overdue: Todo[];
  timed: TimelineEntry[];
  anytime: Todo[];
  allDay: Meeting[];
}

const isOpenTask = (t: Todo) => t.status !== 'Done';
const byPriority = (t: Todo) => (t.priority === 'High' ? 0 : t.priority === 'Low' ? 2 : 1);

/** Tasks of promises we made that "Needs your attention" already shows (late,
 * due today or tomorrow) — listed once, there, with the reason and Mark kept. */
export function tasksShownAsPromises(i: Pick<MyDayInput, 'today' | 'commitments' | 'snoozed' | 'attentionShown'>): Set<number> {
  const tomorrow = addDays(i.today, 1);
  const rowKey = (c: Commitment) => `commitment:${c.id}:${c.dueDate! < i.today ? 'overdue' : 'due'}`;
  // A snoozed row, or one behind "Show N more", isn't on screen: its task stays in Today.
  const visible = (key: string) => !(i.snoozed?.[key] && i.snoozed[key] > i.today) && (!i.attentionShown || i.attentionShown.has(key));
  return new Set((i.commitments || [])
    .filter((c) => c.direction === 'ours' && c.status === 'open' && c.todoId != null && c.dueDate && c.dueDate <= tomorrow && visible(rowKey(c)))
    .map((c) => c.todoId!));
}

/** The attention rows on screen, when the list shows its first `limit`. */
export function shownAttentionKeys(items: AttentionItem[], limit: number | null): Set<string> {
  return new Set((limit == null ? items : items.slice(0, limit)).map((x) => x.key));
}

export function buildTimeline(i: Pick<MyDayInput, 'today' | 'now' | 'meetings' | 'todos' | 'commitments' | 'snoozed' | 'attentionShown'>): Timeline {
  const promised = tasksShownAsPromises(i);
  const todos = i.todos.filter((t) => !promised.has(t.id));
  const overdue = todos.filter((t) => isOpenTask(t) && !t.parentId && t.dueDate && t.dueDate < i.today)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '') || byPriority(a) - byPriority(b));
  const dueToday = todos.filter((t) => !t.parentId && t.dueDate === i.today && (isOpenTask(t) || (t.completedAt || '').slice(0, 10) === i.today));
  const meetings = i.meetings.filter((m) => !m.isCancelled && m.meetingDate === i.today);
  const nowIso = i.now.toISOString();
  const timed: TimelineEntry[] = [];
  for (const m of meetings) {
    if (!m.startAt) continue;
    const end = m.endAt ? new Date(m.endAt) : new Date(new Date(m.startAt).getTime() + 30 * 60000);
    timed.push({ type: 'meeting', at: new Date(m.startAt).toISOString(), meeting: m, past: end <= i.now, current: new Date(m.startAt) <= i.now && end > i.now });
  }
  for (const t of dueToday) {
    if (!t.dueTime) continue;
    const at = new Date(`${i.today}T${t.dueTime}:00`);
    timed.push({ type: 'task', at: at.toISOString(), task: t, past: at <= i.now });
  }
  timed.sort((a, b) => a.at.localeCompare(b.at));
  const idx = timed.findIndex((e) => e.at > nowIso && !(e.type === 'meeting' && e.current));
  if (timed.length) timed.splice(idx === -1 ? timed.length : idx, 0, { type: 'now', at: nowIso });
  const anytime = dueToday.filter((t) => !t.dueTime)
    .sort((a, b) => Number(!isOpenTask(a)) - Number(!isOpenTask(b)) || byPriority(a) - byPriority(b) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return { overdue, timed, anytime, allDay: meetings.filter((m) => !m.startAt) };
}

// ── Coming up ───────────────────────────────────────────────────────────────

export interface UpcomingEntry {
  kind: 'meeting' | 'task' | 'agreement' | 'opportunity' | 'project' | 'proposal';
  title: string;
  detail: string;
  record: { kind: RecordKind; id: number };
  time?: string;
  companyId?: number | null;
  companyName?: string | null;
}

export interface UpcomingDay { date: string; entries: UpcomingEntry[] }

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return localIsoDate(new Date(y, m - 1, d + n));
}

export function buildComingUp(i: Pick<MyDayInput, 'today' | 'meetings' | 'todos' | 'agreements' | 'opportunities' | 'projects' | 'proposals'>, span = 7): UpcomingDay[] {
  const first = addDays(i.today, 1);
  const last = addDays(i.today, span);
  const inRange = (d: string | null | undefined): d is string => !!d && d >= first && d <= last;
  const entries: (UpcomingEntry & { date: string; sort: string })[] = [];
  for (const m of i.meetings) {
    if (m.isCancelled || !inRange(m.meetingDate)) continue;
    entries.push({ date: m.meetingDate, sort: `0${m.startAt ? new Date(m.startAt).toISOString() : ''}`, kind: 'meeting', title: m.title, detail: m.companyName || (m.location ?? '') || 'Meeting',
      time: m.startAt ? timeLabel(m.startAt) : undefined, record: { kind: 'meeting', id: m.id }, companyId: m.companyId ?? null, companyName: m.companyName });
  }
  for (const t of i.todos) {
    if (!isOpenTask(t) || t.parentId || !inRange(t.dueDate)) continue;
    entries.push({ date: t.dueDate, sort: `1${t.dueTime || '99'}${byPriority(t)}`, kind: 'task', title: t.title, detail: t.client || (t.priority === 'High' ? 'High priority' : 'Task'),
      time: t.dueTime || undefined, record: { kind: 'task', id: t.id }, companyId: t.companyId ?? null, companyName: t.client });
  }
  for (const a of i.agreements) {
    if (a.status === 'Canceled' || a.serviceStatus === 'Ended' || !inRange(a.endDate)) continue;
    entries.push({ date: a.endDate, sort: '2', kind: 'agreement', title: a.client || a.agrRef || 'Agreement', detail: 'Agreement ends', record: { kind: 'agreement', id: a.id }, companyId: a.companyId ?? null, companyName: a.client });
  }
  for (const o of i.opportunities) {
    if (!isOpenOpportunity(o) || !inRange(o.expectedCloseDate)) continue;
    entries.push({ date: o.expectedCloseDate, sort: '3', kind: 'opportunity', title: o.name, detail: `Expected to close · ${o.stage}`, record: { kind: 'opportunity', id: o.id }, companyId: o.companyId, companyName: o.companyName });
  }
  for (const p of i.projects) {
    if (p.archived || p.status === 'Completed' || p.status === 'Cancelled' || !inRange(p.targetDate)) continue;
    entries.push({ date: p.targetDate, sort: '4', kind: 'project', title: p.name, detail: `Project due · ${p.computedProgress ?? 0}% done`, record: { kind: 'project', id: p.id }, companyId: p.companyId ?? null, companyName: p.companyName });
  }
  // Proposals promised in the next days; those requested together are one line.
  const promised = new Map<string, Proposal[]>();
  for (const p of i.proposals) {
    if (p.archived || (p.status !== PS.REQUEST && p.status !== PS.DRAFTING) || !inRange(p.promisedBy)) continue;
    const key = `${p.promisedBy}|${p.requestGroup || `id:${p.id}`}`;
    promised.set(key, [...(promised.get(key) || []), p]);
  }
  for (const ps of promised.values()) {
    const p = ps[0];
    const together = ps.length > 1 && p.companyId != null;
    entries.push({ date: p.promisedBy!, sort: '5', kind: 'proposal', title: together ? `${ps.length} proposals promised` : 'Proposal promised', detail: p.client,
      record: together ? { kind: 'company', id: p.companyId! } : { kind: 'proposal', id: p.id }, companyId: p.companyId ?? null, companyName: p.client });
  }
  for (const p of i.proposals) {
    if (p.archived || p.status !== PS.SENT || !inRange(p.validUntil)) continue;
    entries.push({ date: p.validUntil, sort: '5', kind: 'proposal', title: p.client, detail: 'Proposal offer expires', record: { kind: 'proposal', id: p.id }, companyId: p.companyId ?? null, companyName: p.client });
  }
  const daysOut: UpcomingDay[] = [];
  for (let n = 1; n <= span; n++) {
    const date = addDays(i.today, n);
    const list = entries.filter((e) => e.date === date).sort((a, b) => a.sort.localeCompare(b.sort));
    if (list.length) daysOut.push({ date, entries: list.map(({ date: _d, sort: _s, ...e }) => e) });
  }
  return daysOut;
}

// ── Header ──────────────────────────────────────────────────────────────────

export function greeting(now: Date): string {
  const h = now.getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function summaryLine(t: Timeline, attention: AttentionItem[]): string {
  const upcoming = t.timed.filter((e) => e.type === 'meeting' && !e.past).length + t.allDay.length;
  const due = t.anytime.filter(isOpenTask).length + t.timed.filter((e) => e.type === 'task' && isOpenTask(e.task)).length;
  const urgent = attention.filter((a) => a.tone === 'red').length;
  const parts: string[] = [];
  const meetingsToday = t.timed.filter((e) => e.type === 'meeting').length + t.allDay.length;
  if (upcoming) parts.push(upcoming === meetingsToday ? plural(upcoming, 'meeting') : `${plural(upcoming, 'meeting')} still to go`);
  if (due) parts.push(`${plural(due, 'task')} due`);
  if (t.overdue.length) parts.push(`${t.overdue.length} overdue`);
  if (urgent) parts.push(`${urgent} urgent ${urgent === 1 ? 'item' : 'items'}`);
  return parts.length ? parts.join(' · ') : 'Nothing scheduled and nothing urgent — a good day to move deals forward.';
}

// ── The index row under the band (brand slice) ──────────────────────────────
// The brand's zero-padded index device: "01 3 need you · 02 1 meeting to go …".
// Each figure comes from a signal My Day already has; a zero is left out and
// the rest are numbered in order.

export type IndexTarget = 'attention' | 'today' | 'overdue' | 'followup' | 'inplay';
export interface IndexItem { ix: string; n: number; label: string; target: IndexTarget }

const flat = (items: AttentionItem[]): AttentionItem[] => items.flatMap((a) => [a, ...(a.children ?? [])]);

/** With `inPlay` (1.57), 04 is the proposals in play instead of the clients waiting on you. */
export function buildIndex(t: Timeline, attention: AttentionItem[], inPlay?: number): IndexItem[] {
  const all = flat(attention);
  const toGo = t.timed.filter((e) => e.type === 'meeting' && !e.past).length;
  const waiting = new Set(all.filter((a) => /^proposal:\d+:followup$|^commitment:\d+:(overdue|due)$/.test(a.key)).map((a) => (a.companyName || a.title).toLowerCase()));
  const late = all.filter((a) => /^commitment:\d+:overdue$/.test(a.key)).length;
  const word = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const rows: Omit<IndexItem, 'ix'>[] = [
    { n: attention.length, label: 'need you', target: 'attention' },
    { n: toGo, label: word(toGo, 'meeting to go', 'meetings to go'), target: 'today' },
    { n: t.overdue.length, label: word(t.overdue.length, 'task overdue', 'tasks overdue'), target: 'overdue' },
    inPlay != null
      ? { n: inPlay, label: word(inPlay, 'proposal in play', 'proposals in play'), target: 'inplay' as const }
      : { n: waiting.size, label: word(waiting.size, 'client waiting on you', 'clients waiting on you'), target: 'followup' as const },
    { n: late, label: word(late, 'promise late', 'promises late'), target: 'attention' },
  ];
  return rows.filter((r) => r.n > 0).map((r, i) => ({ ...r, ix: String(i + 1).padStart(2, '0') }));
}

/** The meeting in the Now panel: the one running, else the next one today. */
export function nowMeeting(t: Timeline): { meeting: Meeting; current: boolean } | null {
  const meetings = t.timed.filter((e): e is Extract<TimelineEntry, { type: 'meeting' }> => e.type === 'meeting' && !e.meeting.isCancelled);
  const running = meetings.find((e) => e.current);
  if (running) return { meeting: running.meeting, current: true };
  const next = meetings.find((e) => !e.past);
  return next ? { meeting: next.meeting, current: false } : null;
}
