import { describe, it, expect } from 'vitest';
import { durationLabel, groupMeetingsByDay, meetingOutcomes, nextMeeting, placeLabel, meetingDays, nowLineAfter, isRunning } from './meetingsList';
import type { Commitment, Meeting } from './types';

// Local times: the list's days are the user's days.
const at = (day: string, hm: string) => new Date(`${day}T${hm}:00`).toISOString();
const meeting = (id: number, day: string | null, hm: string | null, over: Partial<Meeting> = {}): Meeting => ({
  id, title: `Meeting ${id}`, meetingDate: day, startAt: day && hm ? at(day, hm) : null, endAt: null, isCancelled: false, attendees: [],
  agenda: null, discussion: null, decisions: null, followUp: null, actionItems: null, ...over,
} as Meeting);
const NOW = new Date('2026-09-29T15:00:00');

describe('grouping by day', () => {
  it('today, tomorrow, each coming day, then earlier by month newest first; midnight is the boundary', () => {
    const ms = [
      meeting(1, '2026-09-29', '09:00'), meeting(2, '2026-09-29', '23:59'), meeting(3, '2026-09-30', '00:00'), meeting(4, '2026-10-02', '11:00'),
      meeting(5, '2026-09-28', '23:59'), meeting(6, '2026-09-15', '11:00'), meeting(7, '2026-08-20', '11:00'), meeting(8, null, null),
    ];
    const g = groupMeetingsByDay(ms, NOW);
    expect(g.map((x) => [x.label, x.meetings.map((m) => m.id)])).toEqual([
      ['Today', [1, 2]], ['Tomorrow', [3]], ['Friday 2 October', [4]],
      ['Earlier · September 2026', [5, 6]], ['Earlier · August 2026', [7]], ['No date', [8]],
    ]);
    expect(g[0].sub).toBe('Tuesday 29 September');
    expect(g.filter((x) => x.earlier).map((x) => x.key)).toEqual(['earlier:2026-09', 'earlier:2026-08', 'undated']);
  });
});

describe('the next meeting', () => {
  it('is the first not cancelled that has not started; an all-day one counts from its day', () => {
    const ms = [meeting(1, '2026-09-29', '09:00'), meeting(2, '2026-09-29', '16:00', { isCancelled: true }), meeting(3, '2026-09-29', '17:30'), meeting(4, '2026-09-30', '09:00')];
    expect(nextMeeting(ms, NOW)?.id).toBe(3);
    expect(nextMeeting([meeting(5, '2026-09-29', null), meeting(6, '2026-09-30', '09:00')], NOW)?.id).toBe(5);
    expect(nextMeeting([meeting(1, '2026-09-29', '09:00')], NOW)).toBeNull();
  });
});

describe('outcomes', () => {
  const c = (id: number, over: Partial<Commitment>): Commitment => ({ id, direction: 'ours', sourceType: 'meeting', sourceId: 9, status: 'open', ...over } as Commitment);
  it('counts decisions, promises made and owed from the meeting, open actions, and whether it was written up', () => {
    const m = meeting(9, '2026-09-15', '11:00', { decisions: '- Price on three people\n- Monthly GOSI report\n\n', discussion: 'Talked.' });
    const cs = [c(1, {}), c(2, { direction: 'theirs' }), c(3, { status: 'dropped' }), c(4, { sourceId: 10 }), c(5, { sourceType: 'note' })];
    expect(meetingOutcomes(m, cs, [{ status: 'Pending' }, { status: 'Done' }], true)).toEqual({ decisions: 2, promisesMade: 1, owedToUs: 1, openActions: 1, writtenUp: true, needsWriteUp: false });
    expect(meetingOutcomes(meeting(10, '2026-09-16', '11:00'), [], [], true)).toMatchObject({ writtenUp: false, needsWriteUp: true, decisions: 0 });
  });

  it('labels the duration and the place', () => {
    expect(durationLabel(at('2026-09-29', '10:00'), at('2026-09-29', '10:30'))).toBe('30 min');
    expect(durationLabel(at('2026-09-29', '10:00'), at('2026-09-29', '11:30'))).toBe('1 h 30');
    expect(durationLabel(at('2026-09-29', '10:00'), null)).toBeNull();
    expect(placeLabel({ location: 'Microsoft Teams Meeting', isOnlineMeeting: true })).toBe('Teams');
    expect(placeLabel({ location: null, isOnlineMeeting: true })).toBe('Online');
    expect(placeLabel({ location: 'Riyadh office', isOnlineMeeting: false })).toBe('Riyadh office');
  });
});

describe('day medallions (1.59 pages)', () => {
  const now = new Date('2026-10-01T14:05:00');
  const M = (id: number, date: string, start?: string, mins = 30) => ({ id, meetingDate: date, startAt: start ? new Date(`${date}T${start}:00`).toISOString() : null, endAt: start ? new Date(new Date(`${date}T${start}:00`).getTime() + mins * 60_000).toISOString() : null, isCancelled: false });
  it('one group per day: today and onward soonest first, then earlier days newest first, and the first past day counts the past', () => {
    const days = meetingDays([M(1, '2026-09-15', '11:00'), M(2, '2026-10-02', '11:05'), M(3, '2026-10-01', '16:05'), M(4, '2026-10-01', '10:35'), M(5, '2026-09-16', '11:00'), M(6, '2025-04-10', '09:00')], now);
    expect(days.map((d) => [d.eyebrow, d.day, d.weekdayMonth, d.meetings.map((m) => m.id)])).toEqual([
      ['Today', '1', 'Thu Oct', [4, 3]],
      ['Tomorrow', '2', 'Fri Oct', [2]],
      ['', '16', 'Wed Sept', [5]],
      ['', '15', 'Tue Sept', [1]],
      ['', '10', 'Thu Apr 2025', [6]],
    ]);
    expect(days[0].today).toBe(true);
    expect(days[2].earlier).toBe(true);
    expect(days.map((d) => d.pastCount)).toEqual([undefined, undefined, 3, undefined, undefined]);
    // A meeting of today that is over stays under Today: nothing is past.
    expect(meetingDays([M(4, '2026-10-01', '10:35')], now).map((d) => [d.eyebrow, d.pastCount])).toEqual([['Today', undefined]]);
  });
  it('the now-line goes after the meetings that have started', () => {
    const today = [M(1, '2026-10-01', '10:35'), M(2, '2026-10-01', '12:05'), M(3, '2026-10-01', '13:53', 45), M(4, '2026-10-01', '16:05')];
    expect(nowLineAfter(today, now)).toBe(3);
    expect(nowLineAfter(today, new Date('2026-10-01T08:00:00'))).toBe(0);
    expect(nowLineAfter(today, new Date('2026-10-01T20:00:00'))).toBe(4);
  });
  it('running: started and not yet ended; cancelled never', () => {
    expect(isRunning(M(3, '2026-10-01', '13:53', 45), now)).toBe(true);
    expect(isRunning(M(2, '2026-10-01', '12:05'), now)).toBe(false);
    expect(isRunning(M(4, '2026-10-01', '16:05'), now)).toBe(false);
    expect(isRunning({ ...M(3, '2026-10-01', '13:53', 45), isCancelled: true }, now)).toBe(false);
  });
});
