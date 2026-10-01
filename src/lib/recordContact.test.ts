// @vitest-environment jsdom
// The contact page in the record anatomy (1.61): header figures, the trail across months, what is open with them.
import { describe, expect, it } from 'vitest';

import { contactHeaderFigures, monthTrail, openWithRows, TRAIL_MAX } from './recordContact';
import type { Commitment, Proposal } from './types';

const T = '2026-10-01';

describe('header figures', () => {
  it('last contact and what it was, what we owe and how late, meetings this year, the company\'s monthly', () => {
    const f = contactHeaderFigures({
      today: T, last: { date: T, channel: 'meeting', subject: 'Acme — renewal terms' },
      commitments: [{ direction: 'ours', status: 'open', dueDate: '2026-09-19', text: 'Send the revised quote for three people' }, { direction: 'theirs', status: 'open', dueDate: null, text: 'x' }],
      meetingDates: ['2026-08-20', '2026-09-15', T, '2025-12-01', '2026-10-09'], companyMonthly: 'SAR 15,000',
    });
    expect(f.map((x) => [x.value, x.label, x.tone ?? null])).toEqual([
      ['Today', 'last contact · Acme — renewal terms', null],
      ['We owe 1', 'Send the revised quote… · 12 days late', 'red'],
      ['3', 'meetings this year', null],
      ['SAR 15,000', 'a month at their company', 'green'],
    ]);
  });
  it('when only they owe, says so in amber; quiet for 60 days is amber', () => {
    const f = contactHeaderFigures({ today: T, last: { date: '2026-07-19', channel: 'email', subject: 'Cut-off' }, commitments: [{ direction: 'theirs', status: 'open', dueDate: null, text: 'October headcount' }], meetingDates: [], companyMonthly: '' });
    expect(f.map((x) => [x.value, x.tone])).toEqual([['74 days', 'amber'], ['Owes us 1', 'amber']]);
  });
});

describe('the trail across months', () => {
  const input = {
    today: T,
    meetings: [{ id: 1, title: 'Payroll kickoff', meetingDate: '2026-08-20', isCancelled: false }, { id: 2, title: 'Monthly check-in', meetingDate: '2026-09-15', isCancelled: false }, { id: 12, title: 'Renewal terms', meetingDate: T, isCancelled: false }, { id: 9, title: 'Old', meetingDate: '2026-01-10', isCancelled: false }, { id: 8, title: 'Cancelled', meetingDate: '2026-09-20', isCancelled: true }],
    emails: [{ subject: 'Retainer renewal', receivedAt: '2026-10-01T08:00:00Z' }],
    touches: [{ kind: 'call' as const, at: '2026-09-25', subject: null }],
    notes: [{ id: 5, title: 'Kickoff note', updatedAt: '2026-09-01' }],
  };
  it('places events by date from the first of the earliest month to today, one dot a day, the meeting winning', () => {
    const t = monthTrail(input);
    expect(t.events.map((e) => [e.kind, e.date])).toEqual([['meeting', '2026-08-20'], ['note', '2026-09-01'], ['meeting', '2026-09-15'], ['call', '2026-09-25'], ['meeting', T]]);
    expect(t.since).toBe('Aug');
    expect(t.months.map((m) => m.label)).toEqual(['Aug', 'Sept', 'Oct']);
    expect(t.events[t.events.length - 1]).toMatchObject({ today: true, pos: 96, showLabel: true });
    expect(t.events[0].pos).toBeGreaterThan(4);
    expect(t.counts).toEqual({ meeting: 3, email: 0, note: 1, call: 1 });
  });
  it('keeps the latest ten and lets a crowded label give way to the one after it', () => {
    const meetings = Array.from({ length: 14 }, (_, n) => ({ id: n, title: `M${n}`, meetingDate: `2026-09-${String(n + 10).padStart(2, '0')}`, isCancelled: false }));
    const t = monthTrail({ today: T, meetings, emails: [], touches: [], notes: [] });
    expect(t.events.length).toBe(TRAIL_MAX);
    expect(t.events[t.events.length - 1].showLabel).toBe(true);
    expect(t.events.filter((e) => e.showLabel).length).toBeLessThan(TRAIL_MAX);
  });
  it('nothing in four months, no trail', () => {
    expect(monthTrail({ today: T, meetings: [input.meetings[3]], emails: [], touches: [], notes: [] }).events).toEqual([]);
  });
});

describe('open with them', () => {
  const c = (over: Partial<Commitment>): Commitment => ({ id: 1, direction: 'ours', text: 'Send the revised quote', contactId: 1, dueDate: '2026-09-19', status: 'open', closedAt: null, dropReason: null, companyId: 1, opportunityId: null, projectId: null, sourceType: 'meeting', sourceId: 2, sourceKey: null, todoId: null, createdAt: '2026-09-15T10:00:00Z', updatedAt: null, ...over });
  const p = { id: 2, client: 'Acme', type: 'Recruitment', status: 'In Internal Review', primaryContactId: 1, archived: false, reviewRequestedAt: '2026-09-08', dateAdded: '2026-08-20' } as Proposal;
  it('promises either way and their open proposals, the late ones first', () => {
    const rows = openWithRows({ id: 1 }, { today: T, commitments: [c({}), c({ id: 2, direction: 'theirs', dueDate: null, text: 'Headcount' }), c({ id: 3, contactId: 9 }), c({ id: 4, status: 'kept' })], proposals: [p, { ...p, id: 9, primaryContactId: 7 } as Proposal], reviewer: () => 'Hassan Balaghi' });
    expect(rows.map((r) => [r.kind, r.id, r.age, r.tone, r.action.label])).toEqual([
      ['commitment', 1, '12 days late', 'red', 'Mark kept'],
      ['proposal', 2, '23 days', 'amber', 'Open'],
      ['commitment', 2, '', 'ok', 'Received'],
    ]);
    expect(rows[0].sub).toBe('You promised on 15 Sept · due 19 Sept');
    expect(rows[1].sub).toBe('Proposal SL# 2 · in review with Hassan');
  });
});
