import { describe, it, expect } from 'vitest';
import { nudge, parseDate } from './dateParse';

// Wednesday 30 September 2026.
const today = new Date(2026, 8, 30, 10);
const p = (t: string) => parseDate(t, today);

describe('what a date field understands', () => {
  it('words', () => {
    expect(p('today')).toBe('2026-09-30');
    expect(p('tomorrow')).toBe('2026-10-01');
    expect(p('in 3 days')).toBe('2026-10-03');
    expect(p('in 2 weeks')).toBe('2026-10-14');
    expect(p('next week')).toBe('2026-10-05');
  });

  it('a weekday is the next one, never today or the past', () => {
    expect(p('Tue')).toBe('2026-10-06');
    expect(p('wednesday')).toBe('2026-10-07');
    expect(p('fri')).toBe('2026-10-02');
    // As in quick capture: "next Tue" is the Tuesday of next week.
    expect(p('next tue')).toBe('2026-10-13');
  });

  it('day and month: day first (02/10 is 2 October), a past one is next year', () => {
    expect(p('02/10')).toBe('2026-10-02');
    expect(p('15/9')).toBe('2027-09-15');
    expect(p('2 Oct')).toBe('2026-10-02');
    expect(p('Oct 2')).toBe('2026-10-02');
    expect(p('1 Sept')).toBe('2027-09-01');
  });

  it('full dates, including the past', () => {
    expect(p('2026-10-02')).toBe('2026-10-02');
    expect(p('2 Oct 2025')).toBe('2025-10-02');
    expect(p('Oct 2, 2025')).toBe('2025-10-02');
    expect(p('02/10/2025')).toBe('2025-10-02');
    expect(p('2.10.25')).toBe('2025-10-02');
  });

  it('refuses what is not a date', () => {
    expect(p('')).toBeNull();
    expect(p('31/2')).toBeNull();
    expect(p('30/02/2026')).toBeNull();
    expect(p('call Omar tomorrow')).toBeNull();
    expect(p('banana')).toBeNull();
  });

  it('↑/↓ nudge a day, ⇧ a week, across months', () => {
    expect(nudge('2026-09-30', 1)).toBe('2026-10-01');
    expect(nudge('2026-10-01', -7)).toBe('2026-09-24');
  });
});
