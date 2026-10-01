// @vitest-environment jsdom
// The meeting page's header, the figures on "Where we stand" and "last met".
import { describe, expect, it } from 'vitest';

import { lastMet, meetingHead, standFigures } from './recordMeeting';
import type { Agreement } from './types';

const T = '2026-10-01';
const at = (h: number, min: number) => new Date(2026, 9, 1, h, min);
const iso = (d: Date) => d.toISOString();
const M = (over: Record<string, unknown> = {}) => ({ id: 12, title: 'Acme — renewal terms', agenda: null, discussion: null, decisions: null, followUp: null, actionItems: null, meetingDate: T, startAt: iso(at(13, 53)), endAt: iso(at(14, 38)), isCancelled: false, location: 'Microsoft Teams Meeting', isOnlineMeeting: true, ...over });
const none = { hasNotes: false, needsWriteUp: false };

describe('the meeting header', () => {
  it('a meeting running now: today and its time on the medallion, how long and where, "Now · until"', () => {
    const h = meetingHead(M(), at(14, 5), T, none);
    expect(h.med).toEqual({ top: 'Today', big: '13:53' });
    expect(h.eyebrow).toBe('Meeting · Teams · 45 min');
    expect(h.state).toEqual({ text: 'Now · until 14:38', tone: 'red' });
    expect(h.phase).toBe('running');
  });
  it('still to come: later today, tomorrow, in N days', () => {
    expect(meetingHead(M(), at(9, 0), T, none)).toMatchObject({ phase: 'upcoming', state: { text: 'Later today', tone: 'blue' } });
    const tomorrow = meetingHead(M({ meetingDate: '2026-10-02', startAt: iso(new Date(2026, 9, 2, 11, 5)), endAt: null }), at(9, 0), T, none);
    expect(tomorrow.med).toEqual({ top: 'Tomorrow', big: '11:05' });
    expect(tomorrow.state.text).toBe('Tomorrow');
    expect(meetingHead(M({ meetingDate: '2026-10-08', startAt: null, endAt: null }), at(9, 0), T, none)).toMatchObject({ med: { top: 'Oct', big: '8' }, state: { text: 'In 7 days' } });
  });
  it('over: written up, not written up, or just over; cancelled says so', () => {
    const past = M({ meetingDate: '2026-09-15', startAt: iso(new Date(2026, 8, 15, 10, 0)), endAt: iso(new Date(2026, 8, 15, 11, 0)) });
    expect(meetingHead(past, at(9, 0), T, { hasNotes: true, needsWriteUp: false })).toMatchObject({ phase: 'over', med: { top: '15 Sept', big: '10:00' }, state: { text: 'Written up', tone: 'green' } });
    expect(meetingHead(past, at(9, 0), T, { hasNotes: false, needsWriteUp: true }).state).toEqual({ text: 'Not written up', tone: 'amber' });
    expect(meetingHead(past, at(9, 0), T, none).state).toEqual({ text: 'Over', tone: 'grey' });
    expect(meetingHead(M({ isCancelled: true }), at(9, 0), T, none)).toMatchObject({ phase: 'cancelled', state: { text: 'Cancelled', tone: 'red' } });
  });
});

describe('where we stand, in figures', () => {
  const A = { id: 1, client: 'Acme Holdings', companyId: 1, status: 'Signed', serviceStatus: 'Active', monthlyFee: 15000, currency: 'SAR', startDate: '2026-02-01', endDate: '2027-01-31', noticeDays: 60, lines: [] } as unknown as Agreement;
  it('the monthly, when notice is due and how much is in flight', () => {
    const f = standFigures({ today: T, clientAgreements: [A], proposals: [], opportunities: [{ status: 'Open', archived: false, proposalId: null }, { status: 'Open', archived: false, proposalId: null }], commitments: [] });
    expect(f.map((x) => [x.value, x.label])).toEqual([['SAR 15,000', 'a month'], ['2 Dec', 'notice due'], ['2', 'in flight']]);
  });
  it('a prospect with nothing has no figures', () => {
    expect(standFigures({ today: T, clientAgreements: [], proposals: [], opportunities: [], commitments: [] })).toEqual([]);
  });
});

describe('last met', () => {
  const earlier = [
    { meetingDate: '2026-09-15', attendees: ['Jane Doe', 'Ahmad'], attendeeEmails: ['jane@acme.example'] },
    { meetingDate: '2026-08-31', attendees: ['Omar Haddad'], attendeeEmails: [] },
  ];
  it('by email address, else by name; never met is null', () => {
    expect(lastMet({ name: 'J. Doe', email: 'Jane@acme.example' }, earlier)).toBe('2026-09-15');
    expect(lastMet({ name: 'Omar Haddad' }, earlier)).toBe('2026-08-31');
    expect(lastMet({ name: 'Sara Al-Otaibi' }, earlier)).toBeNull();
    expect(lastMet({ name: 'Al' }, earlier)).toBeNull();
  });
});
