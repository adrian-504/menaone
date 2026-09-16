import { describe, it, expect } from 'vitest';
import { orderMeetings, meetingStartKey } from './meetingOrder';

const m = (id: number, meetingDate: string, startAt: string | null = null) => ({ id, meetingDate, startAt });
const ids = (list: { id: number }[]) => list.map((x) => x.id);

describe('meeting order', () => {
  const today = '2026-09-16';
  const list = [
    m(1, '2026-10-05', '2026-10-05T09:00'),
    m(2, '2026-09-16', '2026-09-16T15:30'),
    m(3, '2026-09-16', '2026-09-16T08:00'),
    m(4, '2026-08-01', '2026-08-01T10:00'),
    m(5, '2026-09-01', '2026-09-01T10:00'),
  ];

  it('puts what is coming first, soonest at the top, and history below newest first', () => {
    const { upcoming, past } = orderMeetings(list, 'all', today);
    expect(ids(upcoming)).toEqual([3, 2, 1]); // today 08:00, today 15:30, then October
    expect(ids(past)).toEqual([5, 4]);
  });

  it('sorts same-day meetings by their start time, not just the date', () => {
    const { upcoming } = orderMeetings([m(2, '2026-09-16', '2026-09-16T15:30'), m(3, '2026-09-16', '2026-09-16T08:00')], 'upcoming', today);
    expect(ids(upcoming)).toEqual([3, 2]);
  });

  it('narrows to one side when a filter is chosen', () => {
    expect(orderMeetings(list, 'upcoming', today).past).toEqual([]);
    expect(orderMeetings(list, 'past', today).upcoming).toEqual([]);
  });

  it('treats a meeting with no time as starting at midnight, and one with no date as upcoming', () => {
    expect(meetingStartKey({ meetingDate: '2026-09-16', startAt: null })).toBe('2026-09-16T00:00');
    const { upcoming, past } = orderMeetings([m(9, '')], 'all', today);
    expect(ids(upcoming)).toEqual([9]);
    expect(past).toEqual([]);
  });
});
