// Tasks in the app's look (1.62 "tools"): the progress line under quick-add,
// the chip a promise wears on its task, how a due date reads on the right of
// a row, and which tasks stand apart as Overdue or as Promises. The lists,
// views, quick-add parsing, keyboard and drag stay as they were. Pure:
// tabs/todo.ts draws it.

import type { Commitment, Todo } from './types';
import { daysBetween } from './pipeline';
import { fmtDateShort } from './dates';
import { plural } from './pageKit';

const iso = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);
const isDone = (t: Pick<Todo, 'status'>) => t.status === 'Done';

export interface TodayProgress { done: number; total: number; pct: number; overdue: number; promisesLate: number; note: string }

/** "2 of 6 done today" and what is behind: of the tasks due today or earlier plus the ones finished today, how many
 * are finished; how many are overdue (a promise's own task aside); how many of our promises are late. Subtasks and parked tasks are not counted. Pure. */
export function todayProgress(todos: Pick<Todo, 'id' | 'status' | 'dueDate' | 'completedAt' | 'parentId' | 'someday'>[], commitments: Pick<Commitment, 'direction' | 'status' | 'dueDate' | 'todoId'>[], today: string): TodayProgress {
  const top = todos.filter((t) => t.parentId == null);
  const done = top.filter((t) => isDone(t) && iso(t.completedAt) === today).length;
  const open = top.filter((t) => !isDone(t) && !t.someday && !!t.dueDate && iso(t.dueDate)! <= today);
  // A late promise is said once, as a promise: its task is not also counted as overdue.
  const promised = new Set(commitments.filter((c) => c.direction === 'ours' && c.status === 'open' && c.todoId != null).map((c) => c.todoId));
  const overdue = open.filter((t) => iso(t.dueDate)! < today && !promised.has(t.id)).length;
  const promisesLate = commitments.filter((c) => c.direction === 'ours' && c.status === 'open' && !!c.dueDate && iso(c.dueDate)! < today).length;
  const total = done + open.length;
  return {
    done, total, pct: total ? Math.round((done / total) * 100) : 0, overdue, promisesLate,
    note: [overdue ? `${overdue} overdue` : '', promisesLate ? `${plural(promisesLate, 'promise')} late` : ''].filter(Boolean).join(' · '),
  };
}

export interface PromiseChip { text: string; tone: 'red' | 'blue' | 'amber'; ours: boolean }

/** The chip on a task that is a promise: "⚑ We owe · 11 days late" (red once late, blue before), or what the client
 * owes — "⚐ Omar owes us" (amber). `who` is the contact's name when known. Pure. */
export function promiseChip(c: Pick<Commitment, 'direction' | 'dueDate' | 'status'>, today: string, who?: string | null): PromiseChip {
  const late = c.status === 'open' && c.dueDate ? daysBetween(iso(c.dueDate)!, today) ?? 0 : 0;
  const lateText = late > 0 ? ` · ${plural(late, 'day')} late` : '';
  if (c.direction === 'ours') return { text: `⚑ We owe${lateText}`, tone: late > 0 ? 'red' : 'blue', ours: true };
  // What they owe never says how late: the date on the right says since when.
  const first = who?.trim().split(/\s+/)[0];
  return { text: `⚐ ${first ? `${first} owes` : 'They owe'} us`, tone: 'amber', ours: false };
}

export interface DueRight { text: string; tone: 'red' | 'amber' | 'ok' | 'done' | 'wait' }

/** The date on the right of a row, coloured by lateness: red when overdue, amber today, quiet otherwise; a finished
 * task says when ("done 30 Sept"); a promise of theirs with no date says since when we have been waiting. `label` is
 * the list's own wording for the date ("Tomorrow", "Today 15:00"). Null when there is nothing to say. Pure. */
export function dueRight(t: Pick<Todo, 'status' | 'dueDate' | 'completedAt'>, today: string, label: string, waitingSince?: string | null): DueRight | null {
  if (isDone(t)) return t.completedAt ? { text: `done ${fmtDateShort(iso(t.completedAt)!, true)}`, tone: 'done' } : null;
  const due = iso(t.dueDate);
  if (!due) return waitingSince ? { text: `since ${fmtDateShort(iso(waitingSince)!, true)}`, tone: 'wait' } : null;
  return { text: label || fmtDateShort(due, true), tone: due < today ? 'red' : due === today ? 'amber' : 'ok' };
}

/** The right of a row for what a client owes us: its date while that is still ahead (amber on the day), and once it
 * has passed — or when there never was one — since when we have been waiting. `label` is the list's wording for a
 * date still ahead. Pure. */
export function owedWhen(c: Pick<Commitment, 'dueDate' | 'createdAt'>, today: string, label = ''): DueRight | null {
  const due = iso(c.dueDate);
  if (due && due >= today) return { text: label || fmtDateShort(due, true), tone: due === today ? 'amber' : 'ok' };
  const since = due || iso(c.createdAt);
  return since ? { text: `since ${fmtDateShort(since, true)}`, tone: 'wait' } : null;
}

/** A list's tasks in three parts: the promises (tasks a commitment stands behind), the overdue ones among the rest,
 * and what is left for the list's own groups. `promiseTaskIds` are the tasks of open commitments. Pure. */
export function splitTasks<T extends Pick<Todo, 'id' | 'status' | 'dueDate'>>(tasks: T[], promiseTaskIds: Set<number>, today: string, o: { overdue?: boolean } = {}): { overdue: T[]; rest: T[]; promises: T[] } {
  const promises = tasks.filter((t) => promiseTaskIds.has(t.id));
  const others = tasks.filter((t) => !promiseTaskIds.has(t.id));
  const late = (t: T) => !isDone(t) && !!t.dueDate && iso(t.dueDate)! < today;
  return o.overdue ? { overdue: others.filter(late), rest: others.filter((t) => !late(t)), promises } : { overdue: [], rest: others, promises };
}
