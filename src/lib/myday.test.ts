import { describe, it, expect } from 'vitest';
import { utcInstant, normalizeMeeting } from './outlookTime';
import { buildAttention, buildTimeline, buildComingUp, summaryLine, isClientMeeting, type MyDayInput } from './myday';
import type { Agreement, Meeting, Opportunity, Proposal, Todo } from './types';

const proposal = (over: Partial<Proposal>): Proposal => ({
  id: 1, client: 'Co', type: 'Payroll', status: 'Sent to Client', sentDate: null, dblSignedDate: null, kickoffDate: null, finance: null, hubspot: null,
  owner: null, remarks: null, dateAdded: null, monthlyFee: null, contractMonths: null, winLossReason: null, docLink: null, archived: false,
  archivedAt: null, snoozedUntil: null, dateSentToHassan: null, dateSentToClient: null, dateSigned: null, notes: [], ...over,
});
const opp = (over: Partial<Opportunity>): Opportunity => ({
  id: 1, name: 'Deal', companyId: 1, companyName: 'Co', owner: null, stage: 'Lead', status: 'Open', estimatedValue: null, currency: 'SAR',
  probability: null, expectedCloseDate: null, description: null, nextAction: null, proposalId: null, projectId: null, sortOrder: null,
  archived: false, createdAt: '2026-09-10', updatedAt: '2026-09-10', tags: [], ...over,
});
const meeting = (over: Partial<Meeting>): Meeting => ({
  id: 1, title: 'Meeting', meetingDate: '2026-09-13', companyName: null, projectId: null, opportunityId: null, attendees: [], agenda: null,
  discussion: null, decisions: null, actionItems: null, followUp: null, nextMeeting: null, noteId: null, createdAt: null, updatedAt: null,
  outlookEventId: null, startAt: null, endAt: null, organizer: null, location: null, isOnlineMeeting: false, onlineMeetingUrl: null,
  isCancelled: false, source: 'internal', ...over,
});
const todo = (over: Partial<Todo>): Todo => ({
  id: 1, title: 'Task', type: 'general', client: null, priority: 'Medium', dueDate: null, status: 'Pending', description: null, createdAt: null,
  completedAt: null, projectId: null, parentId: null, areaId: null, section: null, sortOrder: null, recurrenceRule: null, tags: [], meetingId: null, ...over,
});
const agreement = (over: Partial<Agreement>): Agreement => ({
  id: 1, agrRef: 'AGR-1', client: 'Co', type: null, status: 'Filed', preparedBy: null, datePrepared: null, dateSentToClient: null, dateClientSigned: null,
  dateMenaSigned: null, dateFiled: null, monthlyFee: null, contractMonths: null, proposalId: null, hubspot: null, docLink: null, actionDate: null,
  remarks: null, createdAt: null, ...over,
});

const input = (over: Partial<MyDayInput>): MyDayInput => ({
  today: '2026-09-13', now: new Date('2026-09-13T11:00:00'), proposals: [], opportunities: [], pipelineFacts: [], agreements: [], meetings: [],
  todos: [], projects: [], emails: [], inboxCount: 0, reviewerName: () => 'Hassan Balaghi', ownDomains: new Set(['menabig.com']), snoozed: {}, ...over,
});

describe('Outlook times', () => {
  it('reads zone-less Outlook values as UTC', () => {
    expect(utcInstant('2026-09-13T10:00:00.0000000')).toBe('2026-09-13T10:00:00.000Z');
    expect(utcInstant('2026-09-13T10:00:00')).toBe('2026-09-13T10:00:00Z');
    expect(utcInstant('2026-09-13T10:00:00Z')).toBe('2026-09-13T10:00:00Z');
    expect(utcInstant('2026-09-13T12:00:00+02:00')).toBe('2026-09-13T12:00:00+02:00');
    expect(utcInstant(null)).toBeNull();
  });

  it('moves an Outlook meeting to its local calendar day', () => {
    const m = normalizeMeeting(meeting({ source: 'outlook', meetingDate: '2026-09-13', startAt: '2026-09-13T23:30:00.0000000' }));
    const local = new Date('2026-09-13T23:30:00Z');
    expect(m.meetingDate).toBe(`${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`);
    expect(normalizeMeeting(meeting({ startAt: '2026-09-13T10:00' })).startAt).toBe('2026-09-13T10:00');
  });
});

describe('attention', () => {
  it('ranks signed, approved and requested proposals above old follow-ups', () => {
    const items = buildAttention(input({ proposals: [
      proposal({ id: 1, status: 'Sent to Client', dateSentToClient: '2026-08-01' }),
      proposal({ id: 2, status: 'Signed by Client', dateSigned: '2026-09-12' }),
      proposal({ id: 3, status: 'Proposal Request Received', dateAdded: '2026-09-08' }),
      proposal({ id: 4, status: 'In Internal Review', reviewStatus: 'approved' }),
      proposal({ id: 5, status: 'Sent to Client', dateSentToClient: '2026-09-10' }),
    ] }));
    expect(items.map((x) => x.key)).toEqual(['proposal:2:countersign', 'proposal:4:approved', 'proposal:3:request', 'proposal:1:followup']);
    expect(items[1].reason).toContain('Hassan Balaghi');
    expect(items[3].reason).toBe('Sent 43 days ago, no answer · Payroll');
  });

  it('folds many low-urgency items of one kind into a group row', () => {
    const old = [1, 2, 3, 4, 5].map((id) => proposal({ id, client: `Co ${id}`, dateSentToClient: '2026-05-01' }));
    const recent = proposal({ id: 9, client: 'Recent', dateSentToClient: '2026-09-01' });
    const items = buildAttention(input({ proposals: [...old, recent], opportunities: [1, 2, 3, 4].map((id) => opp({ id })) }));
    const group = items.find((x) => x.key === 'group:followup-old');
    expect(group?.children).toHaveLength(5);
    expect(items.find((x) => x.key === 'group:opportunity')?.title).toBe('4 opportunities with no next step');
    expect(items.some((x) => x.key === 'proposal:9:followup')).toBe(true);
    expect(items[0].key).toBe('proposal:9:followup');
  });

  it('flags renewals, unprepared client meetings and hides snoozed items', () => {
    const base = input({
      agreements: [agreement({ serviceStatus: 'Active', endDate: '2026-10-01', noticeDays: 15 })],
      meetings: [
        meeting({ id: 1, title: 'Globex review', companyName: 'Globex', meetingDate: '2026-09-14' }),
        meeting({ id: 2, title: 'Team sync', meetingDate: '2026-09-14', attendeeEmails: ['ali@menabig.com'] }),
        meeting({ id: 3, title: 'Prepared', companyName: 'Globex', meetingDate: '2026-09-14', agenda: '1. Fees' }),
      ],
    });
    const keys = buildAttention(base).map((x) => x.key);
    expect(keys).toEqual(['agreement:1:renewal', 'meeting:1:prepare']);
    expect(buildAttention(base)[0].reason).toBe('Ends in 18 days — plan the renewal; notice due in 3 days');
    expect(buildAttention({ ...base, snoozed: { 'meeting:1:prepare': '2026-09-14' } }).map((x) => x.key)).toEqual(['agreement:1:renewal']);
    expect(buildAttention({ ...base, snoozed: { 'meeting:1:prepare': '2026-09-13' } })).toHaveLength(2);
  });

  it('tells client meetings from internal ones', () => {
    const own = new Set(['menabig.com']);
    expect(isClientMeeting(meeting({ attendeeEmails: ['a@menabig.com'] }), own)).toBe(false);
    expect(isClientMeeting(meeting({ attendeeEmails: ['a@menabig.com', 'b@globex.com'] }), own)).toBe(true);
  });
});

describe('timeline', () => {
  it('orders meetings and timed tasks around a now marker', () => {
    const t = buildTimeline(input({
      meetings: [
        meeting({ id: 1, startAt: new Date('2026-09-13T09:00:00').toISOString(), endAt: new Date('2026-09-13T09:30:00').toISOString() }),
        meeting({ id: 2, startAt: new Date('2026-09-13T10:45:00').toISOString(), endAt: new Date('2026-09-13T11:30:00').toISOString() }),
        meeting({ id: 3, startAt: new Date('2026-09-13T15:00:00').toISOString() }),
        meeting({ id: 4, meetingDate: '2026-09-14', startAt: new Date('2026-09-14T09:00:00').toISOString() }),
      ],
      todos: [
        todo({ id: 1, dueDate: '2026-09-13', dueTime: '14:00' }),
        todo({ id: 2, dueDate: '2026-09-13', priority: 'Low' }),
        todo({ id: 3, dueDate: '2026-09-13', priority: 'High' }),
        todo({ id: 4, dueDate: '2026-09-10' }),
        todo({ id: 5, dueDate: '2026-09-13', status: 'Done', completedAt: '2026-09-13T08:00:00' }),
      ],
    }));
    expect(t.timed.map((e) => (e.type === 'meeting' ? `m${e.meeting.id}` : e.type === 'task' ? `t${e.task.id}` : 'now'))).toEqual(['m1', 'm2', 'now', 't1', 'm3']);
    expect(t.timed[1].type === 'meeting' && t.timed[1].current).toBe(true);
    expect(t.anytime.map((x) => x.id)).toEqual([3, 2, 5]);
    expect(t.overdue.map((x) => x.id)).toEqual([4]);
    expect(summaryLine(t, [])).toBe('2 meetings still to go · 3 tasks due · 1 overdue');
  });
});

describe('coming up', () => {
  it('groups the next seven days, skipping empty days', () => {
    const days = buildComingUp({
      today: '2026-09-13', proposals: [proposal({ status: 'Sent to Client', validUntil: '2026-09-16' })], projects: [],
      meetings: [meeting({ meetingDate: '2026-09-14', title: 'GM' })],
      todos: [todo({ dueDate: '2026-09-16', title: 'Send fees' }), todo({ id: 2, dueDate: '2026-09-30' })],
      agreements: [agreement({ endDate: '2026-09-20', serviceStatus: 'Active' })],
      opportunities: [opp({ expectedCloseDate: '2026-09-14' })],
    });
    expect(days.map((d) => [d.date, d.entries.map((e) => e.kind)])).toEqual([
      ['2026-09-14', ['meeting', 'opportunity']],
      ['2026-09-16', ['task', 'proposal']],
      ['2026-09-20', ['agreement']],
    ]);
  });
});
