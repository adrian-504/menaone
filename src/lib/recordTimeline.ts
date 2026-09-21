// One timeline for a record, past and future around "now": what happened
// (the activity log, newest nearest the line) and what's coming (meetings,
// open tasks and promises, and the record's own dates), overdue items just
// under the line. The same list serves one record or a whole engagement
// (several records, deduplicated). Pure, so it can be tested; the renderer
// is src/lib/timeline.ts.

import type { ActivityEntry, Agreement, Commitment, Meeting, Milestone, Opportunity, Project, Proposal, Todo } from './types';
import type { ThreadKind } from './workGraph';

export interface TimelineRecord { kind: ThreadKind; id: number }

export interface TimelineInput {
  today: string;
  activity: ActivityEntry[];
  meetings: Meeting[];
  todos: Todo[];
  commitments: Commitment[];
  opportunities: Opportunity[];
  proposals: Proposal[];
  agreements: Agreement[];
  projects: Project[];
  /** The project's milestones (loaded with its page). */
  milestones?: Milestone[];
}

export type FutureAction = { kind: 'complete_task' | 'mark_kept' | 'open_meeting'; id: number };

export interface FutureRow {
  key: string;
  kind: 'meeting' | 'task' | 'commitment' | 'date';
  date: string | null;
  time?: string | null;
  label: string;
  sub?: string;
  record?: { kind: 'meeting' | 'task' | 'opportunity' | 'proposal' | 'agreement' | 'project'; id: number };
  overdue: boolean;
  action?: FutureAction;
}

export interface RecordTimeline {
  /** Newest first. */
  past: ActivityEntry[];
  /** Dated, overdue first then soonest first. */
  future: FutureRow[];
  /** Open tasks and promises with no date. */
  undated: FutureRow[];
}

/** Days after the day a proposal was sent that a follow-up falls due (core/proposals.ts: over 10). */
export const FOLLOW_UP_AFTER_DAYS = 11;

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function buildRecordTimeline(records: TimelineRecord[], i: TimelineInput): RecordTimeline {
  const has = (kind: ThreadKind, id: number | null | undefined) => id != null && records.some((r) => r.kind === kind && r.id === id);
  const oppIds = records.filter((r) => r.kind === 'opportunity').map((r) => r.id);
  const projectIds = records.filter((r) => r.kind === 'project').map((r) => r.id);
  // Meetings of an opportunity or project count as theirs; their tasks too.
  const meetingIds = new Set(i.meetings.filter((m) => (m.opportunityId != null && oppIds.includes(m.opportunityId)) || (m.projectId != null && projectIds.includes(m.projectId))).map((m) => m.id));

  const out = new Map<string, FutureRow>();
  const put = (row: Omit<FutureRow, 'overdue'>) => {
    if (out.has(row.key)) return;
    out.set(row.key, { ...row, overdue: !!row.date && row.date < i.today });
  };

  for (const m of i.meetings) {
    if (m.isCancelled || !meetingIds.has(m.id) || !m.meetingDate || m.meetingDate < i.today) continue;
    put({ key: `meeting:${m.id}`, kind: 'meeting', date: m.meetingDate, time: m.startAt ? new Date(m.startAt).toTimeString().slice(0, 5) : null,
      label: m.title, record: { kind: 'meeting', id: m.id }, action: { kind: 'open_meeting', id: m.id } });
  }
  for (const t of i.todos) {
    if (t.status === 'Done' || t.parentId != null) continue;
    if (!(has('opportunity', t.opportunityId) || has('project', t.projectId) || (t.meetingId != null && meetingIds.has(t.meetingId)))) continue;
    // A promise's task shows as the promise.
    if (i.commitments.some((c) => c.todoId === t.id && c.status === 'open')) continue;
    put({ key: `task:${t.id}`, kind: 'task', date: t.dueDate, time: t.dueTime || null, label: t.title, sub: t.owner || undefined,
      record: { kind: 'task', id: t.id }, action: { kind: 'complete_task', id: t.id } });
  }
  for (const c of i.commitments) {
    if (c.status !== 'open') continue;
    if (!(has('opportunity', c.opportunityId) || has('project', c.projectId) || (c.sourceType === 'meeting' && c.sourceId != null && meetingIds.has(c.sourceId)))) continue;
    put({ key: `commitment:${c.id}`, kind: 'commitment', date: c.dueDate, label: c.text, sub: c.direction === 'ours' ? 'We owe' : 'They owe',
      action: { kind: 'mark_kept', id: c.id } });
  }
  // The records' own dates.
  for (const r of records) {
    if (r.kind === 'opportunity') {
      const o = i.opportunities.find((x) => x.id === r.id);
      if (o?.status === 'Open' && o.expectedCloseDate) put({ key: `date:opp:${o.id}:close`, kind: 'date', date: o.expectedCloseDate, label: 'Expected close', sub: o.name, record: { kind: 'opportunity', id: o.id } });
    }
    if (r.kind === 'proposal') {
      const p = i.proposals.find((x) => x.id === r.id);
      if (p && !p.archived && p.status === 'Sent to Client') {
        const sent = p.dateSentToClient || p.sentDate;
        const follow = p.snoozedUntil || (sent ? addDays(sent, FOLLOW_UP_AFTER_DAYS) : null);
        if (follow) put({ key: `date:proposal:${p.id}:followup`, kind: 'date', date: follow, label: 'Follow up with the client', sub: `${p.type || 'Proposal'} (SL# ${p.id})`, record: { kind: 'proposal', id: p.id } });
        if (p.validUntil) put({ key: `date:proposal:${p.id}:valid`, kind: 'date', date: p.validUntil, label: 'Offer valid until', sub: `${p.type || 'Proposal'} (SL# ${p.id})`, record: { kind: 'proposal', id: p.id } });
      }
    }
    if (r.kind === 'agreement') {
      const a = i.agreements.find((x) => x.id === r.id);
      if (a && a.status !== 'Canceled' && a.serviceStatus !== 'Ended' && a.endDate) {
        put({ key: `date:agreement:${a.id}:end`, kind: 'date', date: a.endDate, label: 'Agreement ends', sub: a.agrRef || undefined, record: { kind: 'agreement', id: a.id } });
        if (a.noticeDays) put({ key: `date:agreement:${a.id}:notice`, kind: 'date', date: addDays(a.endDate, -a.noticeDays), label: 'Renewal notice due', sub: `${a.noticeDays} days before the end`, record: { kind: 'agreement', id: a.id } });
      }
    }
    if (r.kind === 'project') {
      const p = i.projects.find((x) => x.id === r.id);
      const open = p && !['Completed', 'Cancelled'].includes(p.status);
      if (open && p!.targetDate) put({ key: `date:project:${p!.id}:target`, kind: 'date', date: p!.targetDate, label: 'Project target date', sub: p!.name, record: { kind: 'project', id: p!.id } });
      if (open) {
        for (const m of (i.milestones || []).filter((x) => x.projectId === r.id && x.status !== 'Done' && x.targetDate)) {
          put({ key: `date:milestone:${m.id}`, kind: 'date', date: m.targetDate, label: `Milestone: ${m.name}`, record: { kind: 'project', id: r.id } });
        }
      }
    }
  }

  const rows = [...out.values()];
  const future = rows.filter((x) => x.date).sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.date! + (a.time || '')).localeCompare(b.date! + (b.time || '')) || a.label.localeCompare(b.label));
  const undated = rows.filter((x) => !x.date).sort((a, b) => a.label.localeCompare(b.label));

  const seen = new Set<number>();
  const past = [...i.activity].filter((a) => !seen.has(a.id) && seen.add(a.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  return { past, future, undated };
}
