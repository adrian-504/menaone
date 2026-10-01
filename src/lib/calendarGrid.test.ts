// @vitest-environment jsdom
// The calendar's time grid: where blocks sit, how overlaps share the column, the all-day row, the now-line, the header line.
import { describe, expect, it } from 'vitest';

import { allDayChips, eventState, HOUR_PX, MIN_BLOCK_PX, nowLine, placeBlocks, rangeLabel, rangeStats, syncedLabel } from './calendarGrid';

const DAY = '2026-10-01';
// Local times, so the tests read the same in any time zone.
const at = (h: number, m = 0, day = DAY) => { const [y, mo, d] = day.split('-').map(Number); return new Date(y, mo - 1, d, h, m).toISOString(); };
const ev = (id: number, sh: number, sm: number, eh: number, em: number) => ({ id, startAt: at(sh, sm), endAt: at(eh, em) });

describe('where a block sits', () => {
  it('top from the start, height from the length, an hour being 60px', () => {
    expect(HOUR_PX).toBe(60);
    const [b] = placeBlocks([ev(1, 13, 53, 14, 38)], DAY);
    expect(b).toMatchObject({ id: 1, top: 833, height: 45, col: 0, cols: 1, short: false });
    expect(placeBlocks([ev(2, 11, 5, 12, 5)], DAY)[0]).toMatchObject({ top: 665, height: 60, short: false });
  });
  it('half an hour or less reads on one line, and is never shorter than the least a block can be', () => {
    expect(placeBlocks([ev(1, 10, 35, 11, 5)], DAY)[0]).toMatchObject({ top: 635, height: 30, short: true });
    expect(placeBlocks([ev(2, 9, 0, 9, 10)], DAY)[0]).toMatchObject({ height: MIN_BLOCK_PX, short: true });
  });
  it('no end, or an end before the start, is given half an hour; past midnight it stops at midnight', () => {
    expect(placeBlocks([{ id: 1, startAt: at(9), endAt: null }], DAY)[0]).toMatchObject({ top: 540, height: 30 });
    expect(placeBlocks([{ id: 2, startAt: at(9), endAt: at(8) }], DAY)[0]).toMatchObject({ top: 540, height: 30 });
    expect(placeBlocks([{ id: 3, startAt: at(23), endAt: at(1, 0, '2026-10-02') }], DAY)[0]).toMatchObject({ top: 1380, height: 60 });
  });
  it('only the timed events that start that day', () => {
    const blocks = placeBlocks([ev(1, 9, 0, 10, 0), { id: 2, startAt: at(9, 0, '2026-10-02'), endAt: at(10, 0, '2026-10-02') }, { id: 3, startAt: null, endAt: null }, { id: 4, startAt: '2026-10-01', endAt: null }], DAY);
    expect(blocks.map((b) => b.id)).toEqual([1]);
  });
});

describe('overlapping events', () => {
  it('two at once sit side by side; one after them has the column to itself', () => {
    const blocks = placeBlocks([ev(1, 9, 0, 10, 0), ev(2, 9, 30, 10, 30), ev(3, 11, 0, 12, 0)], DAY);
    expect(blocks.map((b) => [b.id, b.col, b.cols])).toEqual([[1, 0, 2], [2, 1, 2], [3, 0, 1]]);
  });
  it('a third takes the first column that is free again; the run shares one column count', () => {
    const blocks = placeBlocks([ev(1, 9, 0, 11, 0), ev(2, 9, 0, 9, 45), ev(3, 10, 0, 10, 30), ev(4, 10, 15, 11, 0)], DAY);
    expect(blocks.map((b) => [b.id, b.col, b.cols])).toEqual([[1, 0, 3], [2, 1, 3], [3, 1, 3], [4, 2, 3]]);
  });
  it('back to back is not an overlap — unless the first is drawn longer than it runs', () => {
    expect(placeBlocks([ev(1, 9, 0, 10, 0), ev(2, 10, 0, 11, 0)], DAY).map((b) => b.cols)).toEqual([1, 1]);
    // Ten minutes is drawn as 24px, so what starts at its end would sit under it.
    expect(placeBlocks([ev(1, 9, 0, 9, 10), ev(2, 9, 10, 10, 0)], DAY).map((b) => [b.col, b.cols])).toEqual([[0, 2], [1, 2]]);
  });
});

describe('over, running, to come', () => {
  it('reads the clock', () => {
    const now = new Date(at(14, 5));
    expect([eventState(ev(1, 12, 5, 12, 35), now), eventState(ev(2, 13, 53, 14, 38), now), eventState(ev(3, 16, 5, 16, 35), now)]).toEqual(['past', 'now', 'ahead']);
  });
});

describe('the now-line', () => {
  const week = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
  it('sits in today\'s column at the minute', () => {
    expect(nowLine(new Date(at(14, 5)), week)).toEqual({ index: 3, top: 845 });
    expect(nowLine(new Date(at(0, 0)), [DAY])).toEqual({ index: 0, top: 0 });
  });
  it('is not drawn on a week without today', () => {
    expect(nowLine(new Date(at(14, 5, '2026-10-07')), week)).toBeNull();
  });
});

describe('the all-day row', () => {
  const input = {
    meetings: [{ id: 1, title: 'Site visit', meetingDate: DAY, startAt: null, isCancelled: false }, { id: 2, title: 'Timed', meetingDate: DAY, startAt: at(9), isCancelled: false }, { id: 3, title: 'Off', meetingDate: DAY, startAt: null, isCancelled: true }],
    todos: [{ id: 5, title: 'Weekly payroll review', dueDate: DAY, status: 'Pending', someday: false }, { id: 6, title: 'Send the quote', dueDate: DAY, status: 'Pending', someday: false },
      { id: 7, title: 'Done already', dueDate: DAY, status: 'Done', someday: false }, { id: 8, title: 'Parked', dueDate: DAY, status: 'Pending', someday: true }, { id: 9, title: 'Another day', dueDate: '2026-10-02', status: 'Pending', someday: false }],
    commitments: [{ id: 1, text: 'Send the quote', dueDate: DAY, status: 'open' as const, direction: 'ours' as const, todoId: 6 }, { id: 2, text: 'Share the headcount', dueDate: DAY, status: 'open' as const, direction: 'theirs' as const, todoId: null },
      { id: 3, text: 'Kept', dueDate: DAY, status: 'kept' as const, direction: 'ours' as const, todoId: null }],
    proposals: [{ id: 3, client: 'Sample Client', status: 'Sent to Client', validUntil: DAY, archived: false }, { id: 4, client: 'Signed', status: 'Signed by Both Parties', validUntil: DAY, archived: false }, { id: 5, client: 'Archived', status: 'Sent to Client', validUntil: DAY, archived: true }],
  };
  it('promises, offers expiring, meetings with no time, tasks due — in that order', () => {
    expect(allDayChips(DAY, input).map((c) => [c.kind, c.id, c.tone, c.glyph, c.text])).toEqual([
      ['promise', 1, 'red', '⚑', 'Send the quote'],
      ['promise', 2, 'amber', '⚐', 'Share the headcount'],
      ['expiry', 3, 'amber', '◷', 'Sample Client offer expires'],
      ['meeting', 1, 'blue', '◉', 'Site visit'],
      ['task', 5, 'grey', '☑', 'Weekly payroll review'],
    ]);
  });
  it('a promise\'s own task is said once; another day has its own', () => {
    expect(allDayChips(DAY, input).some((c) => c.kind === 'task' && c.id === 6)).toBe(false);
    expect(allDayChips('2026-10-02', input).map((c) => c.id)).toEqual([9]);
    expect(allDayChips('2026-10-03', input)).toEqual([]);
  });
});

describe('the header line', () => {
  it('the range in the app\'s date format', () => {
    expect(rangeLabel('2026-09-28', '2026-10-04')).toBe('28 Sept – 4 Oct 2026');
    expect(rangeLabel('2026-10-05', '2026-10-11')).toBe('5 – 11 Oct 2026');
    expect(rangeLabel('2026-12-28', '2027-01-03')).toBe('28 Dec 2026 – 3 Jan 2027');
    expect(rangeLabel(DAY, DAY)).toBe('1 Oct 2026');
  });
  it('how many meetings and how long, cancelled and untimed ones aside', () => {
    const m = (sh: number, sm: number, mins: number, over: Record<string, unknown> = {}) => ({ startAt: at(sh, sm), endAt: new Date(new Date(at(sh, sm)).getTime() + mins * 60000).toISOString(), isCancelled: false, ...over });
    const week = [m(10, 35, 30), m(12, 5, 30), m(13, 53, 45), m(16, 5, 30), { ...m(11, 5, 60), startAt: at(11, 5, '2026-10-02'), endAt: at(12, 5, '2026-10-02') }, m(9, 0, 60, { isCancelled: true }), { startAt: null, endAt: null, isCancelled: false }];
    expect(rangeStats(week, '2026-09-28', '2026-10-04')).toBe('5 meetings · 3 hours');
    expect(rangeStats(week, '2026-10-02', '2026-10-02')).toBe('1 meeting · 1 hour');
    expect(rangeStats([m(9, 0, 45)], DAY, DAY)).toBe('1 meeting · 45 min');
    expect(rangeStats(week, '2026-10-05', '2026-10-11')).toBe('No meetings');
  });
  it('when Outlook was last synced', () => {
    const now = new Date('2026-10-01T11:05:00Z');
    expect(syncedLabel('2026-10-01T11:03:00Z', now)).toBe('synced with Outlook 2 min ago');
    expect(syncedLabel('2026-10-01 11:04:40', now)).toBe('synced with Outlook just now');
    expect(syncedLabel('2026-10-01T08:05:00Z', now)).toBe('synced with Outlook 3 hours ago');
    expect(syncedLabel('2026-09-28T08:05:00Z', now)).toBe('synced with Outlook on 28 Sept');
    expect(syncedLabel('a while back', now)).toBe('synced with Outlook a while back');
    expect(syncedLabel(null, now)).toBe('');
  });
});
