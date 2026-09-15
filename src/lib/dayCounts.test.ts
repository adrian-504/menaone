// @vitest-environment jsdom
// "N days ago" / "in N days" count calendar days: a date that is today is 0
// at any hour (it used to read -1 before or after midday).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { daysSince, daysUntil } from './utils';

afterEach(() => { vi.useRealTimers(); });

describe('day counts', () => {
  for (const hour of [0, 9, 13, 23]) {
    it(`today is 0 at ${hour}:30`, () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 8, 15, hour, 30));
      expect(daysSince('2026-09-15')).toBe(0);
      expect(daysUntil('2026-09-15')).toBe(0);
      expect(daysSince('2026-09-14')).toBe(1);
      expect(daysUntil('2026-09-16')).toBe(1);
      expect(daysSince('2026-09-15T21:10:00Z')).toBe(0);
    });
  }
  it('empty or invalid dates have no count', () => {
    expect(daysSince(null)).toBeNull();
    expect(daysUntil('not a date')).toBeNull();
  });
});
