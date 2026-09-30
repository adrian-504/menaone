import { describe, it, expect, vi, afterEach } from 'vitest';
import { fmtDate, fmtDateShort, fmtDateWeekday, fmtDateTime, fmtDayLong, fmtMonth, fmtTime, fmtTimeRange, fmtWeekday, isoToday } from './dates';

describe('dates and times: one family', () => {
  afterEach(() => vi.useRealTimers());

  it('fmtDate: "2 Sept 2026", no leading zero; "—" when missing', () => {
    expect(fmtDate('2026-09-02')).toBe('2 Sept 2026');
    expect(fmtDate('2026-10-30')).toBe('30 Oct 2026');
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate('not a date')).toBe('—');
  });

  it('fmtDateShort: "2 Sept", the year only when asked and not this year', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 30, 12));
    expect(fmtDateShort('2026-09-02')).toBe('2 Sept');
    expect(fmtDateShort('2025-12-24', true)).toBe('24 Dec 2025');
    expect(fmtDateShort('2026-12-24', true)).toBe('24 Dec');
    expect(fmtDateShort(undefined)).toBe('');
  });

  it('fmtDateWeekday: "Wed 2 Sept"', () => {
    expect(fmtDateWeekday('2026-09-02')).toBe('Wed 2 Sept');
  });

  it('times are 24-hour: "14:05", and a range "11:00 – 12:00"', () => {
    const at = (h: number, m: number) => new Date(2026, 8, 30, h, m).toISOString();
    expect(fmtTime(at(14, 5))).toBe('14:05');
    expect(fmtTimeRange(at(11, 0), at(12, 0))).toBe('11:00 – 12:00');
    expect(fmtTimeRange(at(9, 30), null)).toBe('09:30');
    expect(fmtTime('2026-09-30')).toBe('');
    expect(fmtDateTime(new Date(2026, 8, 2, 8, 0))).toBe('2 Sept 2026 08:00');
  });

  it('the long forms stay: greeting, month headings, weekday names', () => {
    expect(fmtDayLong('2026-09-30')).toMatch(/^Wednesday,? 30 September$/);
    expect(fmtMonth('2026-09-30')).toBe('September 2026');
    expect(fmtMonth('2026-09-30', 'short', 'never')).toBe('Sept');
    expect(fmtWeekday('2026-09-30', 'short')).toBe('Wed');
  });

  it('isoToday is the local day', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 0, 5, 23, 30));
    expect(isoToday()).toBe('2026-01-05');
  });
});

describe('nothing else formats dates or times', () => {
  it('no toLocaleDateString / toLocaleTimeString / 12-hour toLocaleString outside dates.ts', () => {
    const files = import.meta.glob('../**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const offenders = Object.entries(files)
      .filter(([path]) => !path.endsWith('/dates.ts') && !/\.test\.ts$/.test(path))
      .flatMap(([path, src]) => src.split('\n').map((line, i) => ({ path, i: i + 1, line })))
      .filter(({ line }) => /toLocale(Date|Time)String\(|toLocaleString\((undefined|'en-GB')/.test(line))
      .map(({ path, i }) => `${path}:${i}`);
    expect(offenders).toEqual([]);
  });
});
