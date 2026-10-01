// @vitest-environment jsdom
// Tasks: the progress line, the promise chip, the date on the right, and which tasks stand apart.
import { describe, expect, it } from 'vitest';

import { dueRight, owedWhen, promiseChip, splitTasks, todayProgress } from './tasksPage';

const T = '2026-10-01';
const K = (id: number, over: Record<string, unknown> = {}) => ({ id, status: 'Pending', dueDate: null as string | null, completedAt: null as string | null, parentId: null as number | null, someday: false, ...over });

describe('the progress line', () => {
  it('counts what was due by today and what was finished today; overdue and late promises beside it', () => {
    const todos = [
      K(1, { dueDate: '2026-09-10' }), K(2, { dueDate: '2026-09-11' }), K(3, { dueDate: '2026-09-15' }), K(4, { dueDate: T }),
      K(5, { status: 'Done', completedAt: T }), K(6, { status: 'Done', completedAt: `${T}T09:30:00Z`, dueDate: '2026-09-30' }),
      // Not counted: done earlier, due later, parked, a subtask, no date.
      K(7, { status: 'Done', completedAt: '2026-09-28' }), K(8, { dueDate: '2026-10-20' }), K(9, { dueDate: '2026-09-01', someday: true }), K(10, { dueDate: '2026-09-01', parentId: 1 }), K(11),
    ];
    const C = (over: Record<string, unknown>) => ({ direction: 'ours' as 'ours' | 'theirs', status: 'open' as 'open' | 'kept', dueDate: null as string | null, todoId: null as number | null, ...over });
    const commitments = [C({ dueDate: '2026-09-19' }), C({ status: 'kept', dueDate: '2026-09-01' }), C({ direction: 'theirs', dueDate: '2026-09-18' })];
    expect(todayProgress(todos, commitments, T)).toEqual({ done: 2, total: 6, pct: 33, overdue: 3, promisesLate: 1, note: '3 overdue · 1 promise late' });
    // The late promise's own task is counted in the total, and said once: as the promise.
    expect(todayProgress(todos, [C({ dueDate: '2026-09-15', todoId: 3 })], T)).toMatchObject({ total: 6, overdue: 2, note: '2 overdue · 1 promise late' });
  });
  it('nothing due and nothing done: zero of zero, and nothing to add', () => {
    expect(todayProgress([K(1)], [], T)).toMatchObject({ done: 0, total: 0, pct: 0, note: '' });
    expect(todayProgress([K(1, { dueDate: '2026-09-10' })], [{ direction: 'ours', status: 'open', dueDate: '2026-09-01', todoId: null }, { direction: 'ours', status: 'open', dueDate: '2026-09-02', todoId: null }], T).note).toBe('1 overdue · 2 promises late');
  });
});

describe('the promise chip', () => {
  it('what we owe is blue until it is late, then red with how late', () => {
    expect(promiseChip({ direction: 'ours', dueDate: '2026-09-20', status: 'open' }, T)).toEqual({ text: '⚑ We owe · 11 days late', tone: 'red', ours: true });
    expect(promiseChip({ direction: 'ours', dueDate: '2026-10-05', status: 'open' }, T)).toEqual({ text: '⚑ We owe', tone: 'blue', ours: true });
    expect(promiseChip({ direction: 'ours', dueDate: null, status: 'open' }, T).text).toBe('⚑ We owe');
  });
  it('what the client owes names them', () => {
    expect(promiseChip({ direction: 'theirs', dueDate: null, status: 'open' }, T, 'Omar Haddad')).toEqual({ text: '⚐ Omar owes us', tone: 'amber', ours: false });
    expect(promiseChip({ direction: 'theirs', dueDate: '2026-09-18', status: 'open' }, T, null).text).toBe('⚐ They owe us');
  });
  it('what they owe says since when on the right once its date has passed, or when it never had one', () => {
    expect(owedWhen({ dueDate: '2026-09-18', createdAt: '2026-09-15T10:00:00Z' }, T)).toEqual({ text: 'since 18 Sept', tone: 'wait' });
    expect(owedWhen({ dueDate: null, createdAt: '2026-09-15T10:00:00Z' }, T)).toEqual({ text: 'since 15 Sept', tone: 'wait' });
    expect(owedWhen({ dueDate: T, createdAt: null }, T, 'Today')).toEqual({ text: 'Today', tone: 'amber' });
    expect(owedWhen({ dueDate: '2026-10-09', createdAt: null }, T)).toEqual({ text: '9 Oct', tone: 'ok' });
    expect(owedWhen({ dueDate: null, createdAt: null }, T)).toBeNull();
  });
});

describe('the date on the right', () => {
  it('red when overdue, amber today, quiet later; the list\'s own wording is kept', () => {
    expect(dueRight({ status: 'Pending', dueDate: '2026-09-10', completedAt: null }, T, '10 Sept')).toEqual({ text: '10 Sept', tone: 'red' });
    expect(dueRight({ status: 'Pending', dueDate: T, completedAt: null }, T, 'Today 15:00')).toEqual({ text: 'Today 15:00', tone: 'amber' });
    expect(dueRight({ status: 'Pending', dueDate: '2026-10-25', completedAt: null }, T, '')).toEqual({ text: '25 Oct', tone: 'ok' });
  });
  it('a finished task says when; a promise of theirs with no date says since when; else nothing', () => {
    expect(dueRight({ status: 'Done', dueDate: '2026-09-30', completedAt: '2026-09-30' }, T, 'Yesterday')).toEqual({ text: 'done 30 Sept', tone: 'done' });
    expect(dueRight({ status: 'Pending', dueDate: null, completedAt: null }, T, '', '2026-09-18T10:00:00Z')).toEqual({ text: 'since 18 Sept', tone: 'wait' });
    expect(dueRight({ status: 'Pending', dueDate: null, completedAt: null }, T, '')).toBeNull();
  });
});

describe('which tasks stand apart', () => {
  const tasks = [K(1, { dueDate: '2026-09-10' }), K(2, { dueDate: '2026-10-20' }), K(3), K(6, { dueDate: '2026-09-19' }), K(7), K(8, { status: 'Done', dueDate: '2026-09-01' })];
  it('promises are their own group; with `overdue`, so are the late ones among the rest', () => {
    const s = splitTasks(tasks, new Set([6, 7]), T, { overdue: true });
    expect([s.overdue.map((t) => t.id), s.rest.map((t) => t.id), s.promises.map((t) => t.id)]).toEqual([[1], [2, 3, 8], [6, 7]]);
  });
  it('without it only the promises are taken out', () => {
    const s = splitTasks(tasks, new Set([6]), T);
    expect([s.overdue, s.rest.map((t) => t.id), s.promises.map((t) => t.id)]).toEqual([[], [1, 2, 3, 7, 8], [6]]);
  });
});
