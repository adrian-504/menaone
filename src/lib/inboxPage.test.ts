// @vitest-environment jsdom
// The Inbox: where a captured line goes, how it reads, and the days at zero.
import { describe, expect, it } from 'vitest';

import { capturedWhen, inboxDestinations, inboxSummary, kindLook, offerChip, parseZeroDays, withZeroDay, zeroDaysThisMonth, zeroHeadline } from './inboxPage';

const T = '2026-10-01';
const at = (h: number, m: number, day = T) => { const [y, mo, d] = day.split('-').map(Number); return new Date(y, mo - 1, d, h, m); };

describe('where a captured line goes', () => {
  const read = (kind: string, company: string | null = null) => { const d = inboxDestinations(kind, company); return [d.best.key, d.best.label, d.others.map((o) => `${o.key}:${o.label}`)]; };
  it('a task becomes a task; a follow-up a task tagged follow-up; an idea a note', () => {
    expect(read('task')).toEqual(['task', 'Make task', ['note:Note', 'followup:Follow-up']]);
    expect(read('followup', 'Sample Client')).toEqual(['followup', 'Follow-up task', ['task:Task']]);
    expect(read('idea')).toEqual(['note', 'Make note', ['task:Task']]);
  });
  it('a note that names a client goes to that client\'s notes, or starts an opportunity; one that names no one is a note', () => {
    expect(read('note', 'Sample Client')).toEqual(['client_note', 'Add to Sample Client notes', ['opportunity:Opportunity']]);
    expect(read('note', '  ')).toEqual(['note', 'Make note', ['task:Task']]);
    expect(read('note', 'A Very Long Company Name Trading Est.')[1]).toBe('Add to A Very Long Company N… notes');
  });
  it('never more than two other choices; a kind it does not know is a task', () => {
    for (const k of ['task', 'followup', 'idea', 'note']) expect(inboxDestinations(k, 'X').others.length).toBeLessThanOrEqual(2);
    expect(read('something-else')[0]).toBe('task');
    expect([kindLook('followup'), kindLook('nope').label]).toEqual([{ glyph: '↻', tone: 'coral', label: 'follow-up' }, 'task']);
  });
});

describe('how it reads', () => {
  it('when it was captured', () => {
    const now = at(14, 5);
    expect(capturedWhen(at(9, 12).toISOString(), now)).toBe('captured today 09:12');
    expect(capturedWhen(at(18, 0, '2026-09-30').toISOString(), now)).toBe('captured yesterday');
    expect(capturedWhen(at(8, 0, '2026-09-29').toISOString(), now)).toBe('captured 2 days ago');
    expect(capturedWhen(at(8, 0, '2026-09-12').toISOString(), now)).toBe('captured 12 Sept');
    expect([capturedWhen(null, now), capturedWhen('not a date', now)]).toEqual(['', '']);
  });
  it('the line beside the title', () => {
    const now = at(14, 5);
    const items = [{ createdAt: at(9, 12).toISOString() }, { createdAt: at(8, 0, '2026-09-29').toISOString() }, { createdAt: null }];
    expect(inboxSummary(items, now)).toBe('3 to sort · oldest 2 days');
    expect(inboxSummary([{ createdAt: at(9, 12).toISOString() }], now)).toBe('1 to sort · oldest today');
    expect(inboxSummary([{ createdAt: at(9, 12, '2026-09-30').toISOString() }], now)).toBe('1 to sort · oldest yesterday');
    expect(inboxSummary([], now)).toBe('');
  });
  it('a follow-up that names a client says when the offer with them runs out', () => {
    const p = (validUntil: string | null, over: Record<string, unknown> = {}) => ({ client: 'Sample Client', status: 'Sent to Client', validUntil, archived: false, ...over });
    expect(offerChip('sample client', [p('2026-10-05')], T)).toEqual({ text: 'offer expires Mon', tone: 'amber' });
    expect(offerChip('Sample Client', [p('2026-10-02')], T)).toEqual({ text: 'offer expires Fri', tone: 'red' });
    expect(offerChip('Sample Client', [p(T)], T)?.text).toBe('offer expires today');
    expect(offerChip('Sample Client', [p('2026-09-28')], T)).toEqual({ text: 'offer expired 28 Sept', tone: 'red' });
    expect(offerChip('Sample Client', [p('2026-11-30')], T)).toBeNull();
    expect(offerChip('Sample Client', [p('2026-10-02', { status: 'Signed by Both Parties' }), p('2026-10-02', { archived: true }), p(null)], T)).toBeNull();
    expect(offerChip(null, [p('2026-10-02')], T)).toBeNull();
  });
});

describe('the days at zero', () => {
  it('today is recorded once, in order', () => {
    expect(withZeroDay(['2026-09-28', '2026-09-30'], T)).toEqual(['2026-09-28', '2026-09-30', T]);
    expect(withZeroDay(['2026-09-30', T], T)).toEqual(['2026-09-30', T]);
    expect(withZeroDay([], T)).toEqual([T]);
  });
  it('nothing older than about a year is kept', () => {
    expect(withZeroDay(['2025-06-01', '2026-01-15'], T)).toEqual(['2026-01-15', T]);
  });
  it('counts this month\'s days only', () => {
    const list = ['2026-09-28', '2026-09-30', '2026-10-01', '2026-10-03', '2026-10-04'];
    expect(zeroDaysThisMonth(list, '2026-10-04')).toBe(3);
    expect(zeroDaysThisMonth(list, '2026-09-30')).toBe(2);
    expect(zeroDaysThisMonth([], T)).toBe(0);
    expect([zeroHeadline(12), zeroHeadline(1), zeroHeadline(0)]).toEqual(['Inbox zero 12 days this month', 'Inbox zero 1 day this month', 'Inbox zero']);
  });
  it('reads the stored list safely', () => {
    expect(parseZeroDays('["2026-10-01","2026-09-30","2026-10-01","nope",7]')).toEqual(['2026-09-30', '2026-10-01']);
    expect([parseZeroDays(null), parseZeroDays('{'), parseZeroDays('{"a":1}')]).toEqual([[], [], []]);
  });
});
