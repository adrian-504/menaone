import { describe, expect, it } from 'vitest';
import { buildRecordTimeline, type TimelineInput } from './recordTimeline';
import type { ActivityEntry, Commitment, Meeting, Opportunity, Project, Proposal, Todo } from './types';

const today = '2026-09-21';
const act = (id: number, at: string, over: Partial<ActivityEntry> = {}): ActivityEntry => ({ id, createdAt: at, action: 'created', entityType: 'opportunity', entityId: 1, ...over } as ActivityEntry);
const todo = (id: number, over: Partial<Todo>): Todo => ({ id, title: `Task ${id}`, type: 'general', client: null, priority: 'Medium', dueDate: null, status: 'Pending', description: null,
  createdAt: null, completedAt: null, projectId: null, parentId: null, areaId: null, section: null, sortOrder: null, recurrenceRule: null, tags: [], meetingId: null, ...over });
const meeting = (id: number, over: Partial<Meeting>): Meeting => ({ id, title: `Meeting ${id}`, meetingDate: '2026-09-25', isCancelled: false, opportunityId: null, projectId: null, ...over } as Meeting);
const promise = (id: number, over: Partial<Commitment>): Commitment => ({ id, direction: 'ours', text: `Promise ${id}`, contactId: null, dueDate: null, status: 'open', closedAt: null, dropReason: null,
  companyId: 1, opportunityId: null, projectId: null, sourceType: 'manual', sourceId: null, sourceKey: null, todoId: null, createdAt: null, updatedAt: null, ...over });
const opp = (over: Partial<Opportunity>): Opportunity => ({ id: 1, name: 'Contoso payroll', status: 'Open', stage: 'Proposal', expectedCloseDate: '2026-10-15', ...over } as Opportunity);

const input = (over: Partial<TimelineInput>): TimelineInput => ({
  today, activity: [], meetings: [], todos: [], commitments: [], opportunities: [opp({})], proposals: [], agreements: [], projects: [], ...over,
});

describe('buildRecordTimeline', () => {
  it('orders the future around now: overdue first, then soonest; undated apart', () => {
    const t = buildRecordTimeline([{ kind: 'opportunity', id: 1 }], input({
      todos: [todo(1, { opportunityId: 1, dueDate: '2026-09-28' }), todo(2, { opportunityId: 1, dueDate: '2026-09-10' }), todo(3, { opportunityId: 1 }), todo(4, { opportunityId: 2, dueDate: '2026-09-22' }), todo(5, { opportunityId: 1, status: 'Done', dueDate: '2026-09-22' })],
      meetings: [meeting(9, { opportunityId: 1, meetingDate: '2026-09-24' }), meeting(8, { opportunityId: 1, meetingDate: '2026-09-01' })],
      commitments: [promise(1, { opportunityId: 1, dueDate: '2026-09-23', direction: 'theirs' }), promise(2, { opportunityId: 1 })],
    }));
    expect(t.future.map((r) => [r.key, r.overdue])).toEqual([
      ['task:2', true], ['commitment:1', false], ['meeting:9', false], ['task:1', false], ['date:opp:1:close', false],
    ]);
    expect(t.undated.map((r) => r.key)).toEqual(['commitment:2', 'task:3']);
    expect(t.future.find((r) => r.key === 'commitment:1')).toMatchObject({ sub: 'They owe', action: { kind: 'mark_kept', id: 1 } });
  });

  it("counts a meeting's tasks and promises as the opportunity's", () => {
    const t = buildRecordTimeline([{ kind: 'opportunity', id: 1 }], input({
      meetings: [meeting(3, { opportunityId: 1, meetingDate: '2026-09-01' })],
      todos: [todo(1, { meetingId: 3, dueDate: '2026-09-30' })],
      commitments: [promise(1, { sourceType: 'meeting', sourceId: 3, dueDate: '2026-09-29' })],
    }));
    expect(t.future.map((r) => r.key)).toEqual(['commitment:1', 'task:1', 'date:opp:1:close']);
  });

  it("shows a promise's task once, as the promise", () => {
    const t = buildRecordTimeline([{ kind: 'opportunity', id: 1 }], input({
      todos: [todo(6, { opportunityId: 1, dueDate: '2026-09-24' })],
      commitments: [promise(1, { opportunityId: 1, dueDate: '2026-09-24', todoId: 6 })],
    }));
    expect(t.future.map((r) => r.key)).toEqual(['commitment:1', 'date:opp:1:close']);
  });

  it("adds each record's own dates", () => {
    const t = buildRecordTimeline([{ kind: 'proposal', id: 10 }, { kind: 'agreement', id: 20 }, { kind: 'project', id: 30 }], input({
      proposals: [{ id: 10, type: 'Payroll', status: 'Sent to Client', dateSentToClient: '2026-09-15', validUntil: '2026-10-15', archived: false } as Proposal],
      agreements: [{ id: 20, agrRef: 'CON_PAY_001', status: 'Signed', endDate: '2027-01-31', noticeDays: 60 } as never],
      projects: [{ id: 30, name: 'Rollout', status: 'In Progress', targetDate: '2026-12-01' } as Project],
      milestones: [{ id: 1, projectId: 30, name: 'Payroll live', status: 'Not Started', targetDate: '2026-10-31' } as never, { id: 2, projectId: 30, name: 'Done one', status: 'Done', targetDate: '2026-09-30' } as never],
    }));
    expect(t.future.map((r) => [r.label, r.date])).toEqual([
      ['Follow up with the client', '2026-09-26'], ['Offer valid until', '2026-10-15'], ['Milestone: Payroll live', '2026-10-31'],
      ['Renewal notice due', '2026-12-02'], ['Project target date', '2026-12-01'], ['Agreement ends', '2027-01-31'],
    ].sort((a, b) => a[1].localeCompare(b[1])));
  });

  it('a whole engagement merges records without duplicates, and the past is newest first', () => {
    const t = buildRecordTimeline([{ kind: 'opportunity', id: 1 }, { kind: 'project', id: 30 }], input({
      todos: [todo(1, { opportunityId: 1, projectId: 30, dueDate: '2026-09-25' })],
      activity: [act(1, '2026-09-01T10:00:00Z'), act(3, '2026-09-10T10:00:00Z'), act(2, '2026-09-05T10:00:00Z'), act(3, '2026-09-10T10:00:00Z')],
      projects: [{ id: 30, name: 'Rollout', status: 'In Progress' } as Project],
    }));
    expect(t.future.filter((r) => r.key === 'task:1')).toHaveLength(1);
    expect(t.past.map((a) => a.id)).toEqual([3, 2, 1]);
  });

  it('a closed record has no dates of its own to come', () => {
    const t = buildRecordTimeline([{ kind: 'opportunity', id: 1 }], input({ opportunities: [opp({ status: 'Won' })] }));
    expect(t.future).toEqual([]);
  });
});
