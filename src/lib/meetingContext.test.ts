// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { meetingContext, type AttendeeMatch } from './meetingContext';
import type { CompanyBriefInput } from './companyBrief';
import type { Commitment, Meeting } from './types';

const meeting = (id: number, date: string, over: Partial<Meeting> = {}): Meeting => ({
  id, title: `Meeting ${id}`, meetingDate: date, startAt: null, companyId: 1, companyName: 'Contoso Test', isCancelled: false, attendees: [], attendeeEmails: [],
  agenda: null, discussion: null, decisions: null, followUp: null, actionItems: null, ...over,
} as Meeting);
const promise = (id: number, over: Partial<Commitment>): Commitment => ({
  id, direction: 'ours', text: `Promise ${id}`, contactId: null, dueDate: null, status: 'open', closedAt: null, dropReason: null, companyId: 1,
  opportunityId: null, projectId: null, sourceType: 'manual', sourceId: null, sourceKey: null, todoId: null, createdAt: null, updatedAt: null, ...over,
});
const brief = (over: Partial<CompanyBriefInput> = {}): CompanyBriefInput => ({
  company: { id: 1, name: 'Contoso Test' }, today: '2026-09-29', now: '2026-09-29T12:00:00Z', companies: [], opportunities: [], projects: [], meetings: [],
  proposals: [], agreements: [], contacts: [], todos: [], commitments: [], emails: [], notes: [], ...over,
});
const people: AttendeeMatch[] = [
  { name: 'Ahmad', status: 'internal', contact: null },
  { name: 'omar@contoso.test', status: 'contact', contact: { id: 7, name: 'Omar Haddad', role: 'Finance manager', isDecisionMaker: false } },
  { name: 'Jane Doe', status: 'contact', contact: { id: 5, name: 'Jane Doe', role: 'CEO', isDecisionMaker: true } },
  { name: 'Guest Person', status: 'new', contact: null },
];

describe('the meeting page context', () => {
  const today = meeting(10, '2026-09-29');
  const last = meeting(9, '2026-09-15', { title: 'Monthly check-in', decisions: '- Price on three people from November\n- Monthly GOSI report' });
  const older = meeting(8, '2026-08-20', { decisions: 'Start payroll.' });
  const other = meeting(11, '2026-09-20', { companyId: 2, companyName: 'Globex Test' });
  const commitments = [
    promise(1, { sourceType: 'meeting', sourceId: 9, direction: 'theirs', text: 'Omar to share the October headcount', dueDate: '2026-09-18' }),
    promise(2, { sourceType: 'meeting', sourceId: 9, text: 'Send the revised quote', dueDate: '2026-09-19' }),
    promise(3, { sourceType: 'meeting', sourceId: 9, direction: 'theirs', status: 'kept' }),
    promise(4, { companyId: 2 }),
    promise(5, { dueDate: null }),
  ];
  const sameClient = (x: Meeting) => x.companyId === 1;

  it('matches the room: people we know first (decision makers on top), MENA BIG last, strangers by name', () => {
    const ctx = meetingContext(today, brief(), people, [today, last, older, other], commitments, sameClient);
    expect(ctx.room.map((p) => [p.name, p.initials, p.role, p.decisionMaker, p.contactId, p.internal])).toEqual([
      ['Jane Doe', 'JD', 'CEO', true, 5, false],
      ['Omar Haddad', 'OH', 'Finance manager', false, 7, false],
      ['Guest Person', 'GP', null, false, null, false],
      ['Ahmad', 'A', null, false, null, true],
    ]);
  });

  it('last time: the previous meeting with this client, what was noted, its counts, and what they still owe', () => {
    const ctx = meetingContext(today, brief(), people, [today, last, older, other], commitments, sameClient);
    expect(ctx.lastTime).toEqual({
      id: 9, title: 'Monthly check-in', date: '2026-09-15', excerpt: 'Price on three people from November', decisions: 2, promises: 3,
      stillOwed: [{ id: 1, text: 'Omar to share the October headcount' }],
    });
  });

  it('open promises: the company\'s, ours and theirs, soonest first; where we stand when there is anything to say', () => {
    const ctx = meetingContext(today, brief({ commitments }), people, [today, last], commitments, sameClient);
    expect(ctx.openPromises.map((c) => c.id)).toEqual([1, 2, 5]);
    expect(ctx.stand).toMatch(/owe/);
  });

  it('an internal meeting has only the room', () => {
    const ctx = meetingContext(meeting(12, '2026-09-29', { companyId: null, companyName: null }), null, people, [last], commitments, () => false);
    expect(ctx).toMatchObject({ stand: null, lastTime: null, openPromises: [] });
    expect(ctx.room).toHaveLength(4);
  });
});
