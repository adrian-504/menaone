// My Day: what needs doing today, as data. Pure — the tab renders it.
//
// - Attention: one list ranked by urgency, built from fixed rules across
//   proposals, opportunities, agreements, meetings, projects, emails and the
//   inbox. Kinds that would flood the list (e.g. forty old follow-ups) collapse
//   into one group row.
// - Timeline: today's meetings and timed tasks in order, with overdue and
//   untimed tasks around them.
// - Coming up: the next seven days, grouped by day.

import { PS } from './commercial';
import { daysBetween, isOpenOpportunity, opportunityHealth } from './pipeline';
import type { Agreement, Commitment, EmailRecord, Meeting, Opportunity, PipelineFact, Project, Proposal, Todo } from './types';
import type { RecordKind } from './navHistory';
import { localIsoDate } from './outlookTime';

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
  emails: EmailRecord[];
  inboxCount: number;
  /** Reviewer name for "waiting for …" wording. */
  reviewerName: (p: Proposal) => string;
  /** MENA BIG's own email domains, to tell client meetings from internal ones. */
  ownDomains: Set<string>;
  /** Item keys hidden until a date (inclusive of that date's start). */
  snoozed: Record<string, string>;
  /** Attention rows actually on screen (not snoozed, not behind "Show N more").
   * When given, a promise's task leaves Today only if its row is one of them. */
  attentionShown?: Set<string>;
}

// ── Attention ───────────────────────────────────────────────────────────────

export type AttentionAction =
  | 'open' | 'prepare' | 'follow_up' | 'send_to_client' | 'start_drafting'
  | 'open_followups' | 'open_action_required' | 'open_inbox' | 'open_opportunities' | 'open_review_queue' | 'open_cleanup'
  | 'mark_kept' | 'toggle_group';

export interface AttentionItem {
  key: string;
  /** Section the rule belongs to — used for the icon and for grouping. */
  kind: 'proposal' | 'review' | 'followup' | 'opportunity' | 'agreement' | 'meeting' | 'project' | 'email' | 'inbox' | 'commitment';
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const days = (n: number) => plural(n, 'day');
const shortDate = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
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

function proposalItems(i: MyDayInput): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const p of i.proposals) {
    if (p.archived) continue;
    const base = { record: { kind: 'proposal' as RecordKind, id: p.id }, companyId: p.companyId ?? null, companyName: p.client, title: p.client };
    const services = p.type ? ` · ${p.type}` : '';
    if (p.status === PS.CLIENT_SIGNED) {
      const d = daysBetween(p.dateSigned || p.dateSentToClient, i.today);
      // A signature from months ago is a record nobody updated, not today's job.
      const stale = d != null && d > 30;
      out.push({ ...base, key: `proposal:${p.id}:countersign`, kind: 'proposal', score: stale ? 44 : 92 + Math.min(d ?? 0, 7), tone: stale ? 'amber' : 'red',
        reason: stale ? `Still marked "Signed by Client" — countersign it or update the status${services}` : `Signed by the client — countersign it${services}`,
        when: d != null ? days(d) : undefined, action: { kind: 'open', label: 'Open' } });
    } else if (p.status === PS.REVIEW && p.reviewStatus === 'changes_requested') {
      out.push({ ...base, key: `proposal:${p.id}:changes`, kind: 'review', score: 88, tone: 'red',
        reason: `${i.reviewerName(p)} asked for changes${p.reviewNote ? `: ${p.reviewNote}` : ''}`, action: { kind: 'open', label: 'Open' } });
    } else if (p.status === PS.REVIEW && p.reviewStatus === 'approved') {
      out.push({ ...base, key: `proposal:${p.id}:approved`, kind: 'review', score: 86, tone: 'amber',
        reason: `Approved by ${i.reviewerName(p)} — send it to the client${services}`, action: { kind: 'send_to_client', label: 'Mark as sent' } });
    } else if (p.status === PS.REVIEW) {
      const d = daysBetween(p.reviewRequestedAt || p.dateSentToHassan, i.today) ?? 0;
      if (d >= 3) out.push({ ...base, key: `proposal:${p.id}:waiting-review`, kind: 'review', score: 38 + Math.min(d, 20) / 2, tone: d > 14 ? 'amber' : 'accent',
        reason: `Waiting for ${i.reviewerName(p)}'s review${services}`, when: days(d), action: { kind: 'open', label: 'Open' } });
    } else if (p.status === PS.REQUEST) {
      const d = daysBetween(p.dateAdded, i.today) ?? 0;
      out.push({ ...base, key: `proposal:${p.id}:request`, kind: 'proposal', score: 70 + Math.min(d, 20), tone: d > 3 ? 'red' : 'amber',
        reason: `Proposal requested — not started${services}`, when: d ? days(d) : 'Today', action: { kind: 'start_drafting', label: 'Start drafting' } });
    } else if (p.status === PS.DRAFTING) {
      const d = daysBetween(p.dateAdded, i.today) ?? 0;
      if (d > 7) out.push({ ...base, key: `proposal:${p.id}:drafting`, kind: 'proposal', score: 46 + Math.min(d, 30) / 3, tone: 'amber',
        reason: `Still drafting${services}`, when: days(d), action: { kind: 'open', label: 'Open' } });
    } else if (p.status === PS.SENT) {
      const sent = p.dateSentToClient || p.sentDate;
      const d = daysBetween(sent, i.today);
      if (d == null || d <= 10) continue;
      if (p.snoozedUntil && p.snoozedUntil >= i.today) continue;
      const validPassed = p.validUntil && p.validUntil < i.today;
      out.push({ ...base, key: `proposal:${p.id}:followup`, kind: 'followup', score: d <= 45 ? 62 + Math.min(d, 45) / 5 : 18, tone: d <= 45 ? 'amber' : 'accent',
        reason: validPassed ? `No answer, and the offer expired on ${shortDate(p.validUntil!)}${services}` : `Sent ${days(d)} ago, no answer${services}`,
        when: days(d), action: { kind: 'follow_up', label: 'Follow up' } });
    }
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
      out.push({ ...base, key: `opportunity:${o.id}:risk`, kind: 'opportunity', score: 56 + (h.closeOverdue ? 6 : 0), tone: 'red',
        reason: `At risk — ${h.reasons[0] || 'needs attention'}`, action: { kind: 'open', label: 'Open' } });
    } else if (h.waiting?.on === 'us') {
      const d = h.waiting.days ?? 0;
      out.push({ ...base, key: `opportunity:${o.id}:with-us`, kind: 'opportunity', score: 50 + Math.min(d, 30) / 3, tone: d > 7 ? 'amber' : 'accent',
        reason: `With you for ${days(d)} — the next move is yours${o.waitingNote ? `: ${o.waitingNote}` : ''}`, when: days(d), action: { kind: 'open', label: 'Open' } });
    } else if (h.noNextAction) {
      out.push({ ...base, key: `opportunity:${o.id}:next`, kind: 'opportunity', score: 32, tone: 'accent',
        reason: `${o.stage} · no next step set`, action: { kind: 'open', label: 'Set next step' } });
    }
  }
  return out;
}

/** Promises: ours overdue (just under a countersignature), ours due today or
 * tomorrow, and the client's overdue ones folded into one row. */
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
      out.push({ ...base, key: `commitment:${c.id}:overdue`, score: 90, tone: 'red',
        reason: `You promised this for ${shortDate(c.dueDate)} — ${days(late)} late`, when: days(late), action: { kind: 'mark_kept', label: 'Mark kept' } });
    } else if (c.direction === 'ours' && (c.dueDate === i.today || c.dueDate === tomorrow)) {
      out.push({ ...base, key: `commitment:${c.id}:due`, score: 60, tone: 'amber',
        reason: `You promised this for ${c.dueDate === i.today ? 'today' : 'tomorrow'}`, when: c.dueDate === i.today ? 'Today' : 'Tomorrow', action: { kind: 'mark_kept', label: 'Mark kept' } });
    } else if (c.direction === 'theirs' && c.dueDate < i.today) {
      out.push({ ...base, key: `commitment:${c.id}:owed`, score: 24, tone: 'accent',
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
    if (a.serviceStatus === 'Active' && a.endDate) {
      const { daysToEnd, daysToNotice: notice } = agreementRenewal(a, i.today);
      const d = daysToEnd!;
      if (d > 90 || d < -7) continue;
      out.push({ ...base, key: `agreement:${a.id}:renewal`, kind: 'agreement', score: d < 0 ? 84 : 80 - d / 3 + (notice != null && notice <= 7 ? 8 : 0), tone: d <= 30 ? 'red' : 'amber',
        reason: d < 0 ? `Ended ${days(-d)} ago — renew or close it${a.autoRenew ? ' (set to auto-renew)' : ''}`
          : `Ends in ${days(d)} — plan the renewal${notice != null && notice <= 14 ? `; notice due ${notice <= 0 ? 'now' : `in ${days(notice)}`}` : ''}`,
        when: shortDate(a.endDate), action: { kind: 'open', label: 'Open' } });
    } else if (a.serviceStatus === 'Kickoff scheduled' && a.startDate && a.startDate <= i.today) {
      out.push({ ...base, key: `agreement:${a.id}:kickoff`, kind: 'agreement', score: 50, tone: 'amber',
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
      title: m.title, score: isToday ? 76 : 64, tone: isToday ? 'red' : 'amber',
      reason: m.companyName ? 'No agenda yet — check the client brief' : 'No agenda yet',
      when: `${isToday ? 'Today' : 'Tomorrow'}${m.startAt ? ` ${timeLabel(m.startAt)}` : ''}`, action: { kind: 'prepare', label: 'Prepare' } });
  }
  return out;
}

function projectItems(i: MyDayInput): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const p of i.projects) {
    if (p.archived || p.status === 'Completed' || p.status === 'Cancelled') continue;
    const base = { record: { kind: 'project' as RecordKind, id: p.id }, companyId: p.companyId ?? null, companyName: p.companyName, title: p.name };
    const d = p.targetDate ? daysBetween(i.today, p.targetDate)! : null;
    if (p.status === 'At Risk') out.push({ ...base, key: `project:${p.id}:risk`, kind: 'project', score: 58, tone: 'red', reason: 'Marked at risk', action: { kind: 'open', label: 'Open' } });
    else if (d != null && d < 0) out.push({ ...base, key: `project:${p.id}:late`, kind: 'project', score: 54, tone: 'red', reason: `Target date passed ${days(-d)} ago · ${p.computedProgress ?? 0}% done`, action: { kind: 'open', label: 'Open' } });
    else if (d != null && d <= 7) out.push({ ...base, key: `project:${p.id}:due`, kind: 'project', score: 48, tone: 'amber', reason: `Due ${d === 0 ? 'today' : `in ${days(d)}`} · ${p.computedProgress ?? 0}% done`, action: { kind: 'open', label: 'Open' } });
  }
  return out;
}

function emailItems(i: MyDayInput): AttentionItem[] {
  const flagged = i.emails.filter((e) => e.flagStatus === 'flagged');
  if (!flagged.length) return [];
  const endOfToday = new Date(`${i.today}T23:59:59`);
  const due = flagged.filter((e) => e.flagDueAt && new Date(e.flagDueAt) <= endOfToday);
  const out: AttentionItem[] = due.map((e) => ({
    key: `email:${e.id}:due`, kind: 'email' as const, title: e.subject || '(No subject)', companyId: e.companyId ?? null, companyName: e.companyName,
    score: 72, tone: new Date(e.flagDueAt!) < i.now ? 'red' as const : 'amber' as const,
    reason: `Flagged email from ${e.senderName || e.senderEmail || 'someone'}`, when: e.flagDueAt!.slice(0, 10) < i.today ? 'Overdue' : 'Due today',
    action: { kind: 'open_action_required' as const, label: 'Open' },
  }));
  const rest = flagged.length - due.length;
  if (rest > 0) out.push({ key: 'email:flagged', kind: 'email', title: `${plural(rest, 'flagged email')} in Outlook`, score: 14, tone: 'accent',
    reason: 'No due date — go through them when you have a moment', action: { kind: 'open_action_required', label: 'Review' } });
  return out;
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
  { folds: (x) => x.key.endsWith(':next'),
    make: (items) => ({ key: 'group:opportunity', kind: 'opportunity', tone: 'accent', title: `${plural(items.length, 'opportunity', 'opportunities')} with no next step`,
      reason: 'Decide the next step for each, or close it', action: { kind: 'open_cleanup', label: 'Clean up', queue: 'opportunity-incomplete' } }) },
];

const snoozedNow = (i: MyDayInput, key: string) => !!i.snoozed[key] && i.snoozed[key] > i.today;

/** Everything that needs attention, most urgent first. */
export function buildAttention(i: MyDayInput): AttentionItem[] {
  let items = [
    ...proposalItems(i), ...opportunityItems(i), ...commitmentItems(i), ...agreementItems(i), ...meetingItems(i), ...projectItems(i), ...emailItems(i),
  ];
  if (i.inboxCount > 0) items.push({ key: 'inbox', kind: 'inbox', title: `${plural(i.inboxCount, 'item')} in your Inbox`, score: 30, tone: 'accent', reason: 'Captured but not sorted yet', action: { kind: 'open_inbox', label: 'Sort' } });
  items = items.filter((x) => !snoozedNow(i, x.key));

  const groups: AttentionItem[] = [];
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
