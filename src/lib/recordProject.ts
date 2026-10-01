// The project page in the record anatomy (1.61 "records"): the header's
// figures, the note under each milestone on the full-width track, and the
// tasks grouped by the milestone they belong to. Pure: tabs/projects.ts
// draws it.

import type { Milestone, Project, Todo } from './types';
import { daysBetween } from './pipeline';
import { fmtDateShort } from './dates';
import { plural } from './pageKit';
import { nextMilestone, orderMilestones, projectFigures as trackFigures } from './pagesProjects';
import type { Figure } from './recordFigures';

type M = Pick<Milestone, 'id' | 'name' | 'status' | 'targetDate' | 'completionDate' | 'sortOrder'>;
type T = Pick<Todo, 'id' | 'status' | 'dueDate' | 'section' | 'completedAt' | 'parentId'>;

const iso = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);
const isDone = (t: Pick<Todo, 'status'>) => t.status === 'Done';
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// ── Header ──────────────────────────────────────────────────────────────────

/** Milestones done · days to the next milestone · tasks open · days to the target. Each only when the project has it. Pure. */
export function projectHeaderFigures(p: Pick<Project, 'targetDate' | 'taskCount' | 'taskDoneCount' | 'status'>, milestones: M[], today: string): Figure[] {
  const f = trackFigures(p, milestones, today);
  const closed = p.status === 'Completed' || p.status === 'Cancelled';
  const out: Figure[] = [];
  if (f.total) out.push({ value: `${f.done} of ${f.total}`, label: f.total === 1 ? 'milestone done' : 'milestones done' });
  if (f.next && f.next.days != null && !closed) {
    const d = f.next.days;
    out.push({ value: d === 0 ? 'Today' : plural(Math.abs(d), 'day'), label: d < 0 ? `late · ${f.next.name}` : d === 0 ? f.next.name : `to ${f.next.name}`, tone: d < 0 ? 'red' : undefined });
  }
  if (p.taskCount > 0) { const open = p.taskCount - p.taskDoneCount; out.push({ value: String(open), label: open === 1 ? 'task open' : 'tasks open' }); }
  if (f.daysToTarget != null && !closed) out.push({ value: plural(Math.abs(f.daysToTarget), 'day'), label: f.daysToTarget < 0 ? 'past the target' : 'to target', tone: f.daysToTarget < 0 ? 'red' : undefined });
  return out;
}

// ── Tasks by milestone ──────────────────────────────────────────────────────

export interface TaskGroup<X> {
  /** The milestone's id, or null for the tasks no milestone claims. */
  milestoneId: number | null;
  name: string;
  done: number;
  total: number;
  pct: number;
  /** "1 of 3 · due 28 Oct". */
  note: string;
  tasks: X[];
}

/** Which milestone a task belongs to: the one its heading names; else, by its date, the first milestone due on or
 * after it (a finished task without a due date goes by the day it was finished); else none. Pure. */
export function milestoneOf(t: T, ordered: M[]): M | null {
  if (t.section) { const named = ordered.find((m) => same(m.name, t.section!)); if (named) return named; }
  const on = iso(t.dueDate) || (isDone(t) ? iso(t.completedAt) : null);
  if (!on) return null;
  return ordered.find((m) => iso(m.targetDate) && iso(m.targetDate)! >= on) ?? null;
}

/** A project's top-level tasks under their milestones: groups with work still open first, in milestone order, then the
 * finished ones, then the tasks no milestone claims. Inside a group: open by due date, then done. Pure. */
export function tasksByMilestone<X extends T>(tasks: X[], milestones: M[]): TaskGroup<X>[] {
  const ordered = orderMilestones(milestones);
  const ids = new Set(tasks.map((t) => t.id));
  const top = tasks.filter((t) => t.parentId == null || !ids.has(t.parentId));
  const by = new Map<number | null, X[]>();
  for (const t of top) {
    const key = milestoneOf(t, ordered)?.id ?? null;
    if (!by.has(key)) by.set(key, []);
    by.get(key)!.push(t);
  }
  const sorted = (list: X[]) => [...list].sort((a, b) => Number(isDone(a)) - Number(isDone(b)) || (iso(a.dueDate) || '9999').localeCompare(iso(b.dueDate) || '9999') || a.id - b.id);
  const group = (m: M | null, list: X[]): TaskGroup<X> => {
    const done = list.filter(isDone).length;
    const due = m ? iso(m.targetDate) : null;
    return {
      milestoneId: m?.id ?? null, name: m ? m.name : ordered.length ? 'Not tied to a milestone' : 'Tasks', done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0,
      note: `${done} of ${list.length}${due ? ` · due ${fmtDateShort(due, true)}` : ''}`, tasks: sorted(list),
    };
  };
  const groups = ordered.filter((m) => by.has(m.id)).map((m) => group(m, by.get(m.id)!));
  const open = groups.filter((g) => g.done < g.total), finished = groups.filter((g) => g.done === g.total);
  return [...open, ...finished, ...(by.has(null) ? [group(null, by.get(null)!)] : [])];
}

// ── The track's notes ───────────────────────────────────────────────────────

export interface TrackNote { text: string; tone: 'green' | 'blue' | 'red' | null }

/** Under each milestone on the track: "✓ done", "next · 2 of 3 tasks" (or how late it is), nothing for the ones to
 * come. Pure. */
export function trackNotes<X extends T>(milestones: M[], groups: TaskGroup<X>[], today: string): Map<number, TrackNote> {
  const next = nextMilestone(milestones);
  const out = new Map<number, TrackNote>();
  for (const m of milestones) {
    if (m.status === 'Done') { out.set(m.id, { text: '✓ done', tone: 'green' }); continue; }
    if (m.id !== next?.id) continue;
    const g = groups.find((x) => x.milestoneId === m.id);
    const late = iso(m.targetDate) ? daysBetween(iso(m.targetDate)!, today) ?? 0 : 0;
    const tasks = g ? `${g.done} of ${g.total} ${g.total === 1 ? 'task' : 'tasks'}` : '';
    out.set(m.id, late > 0 ? { text: [`${plural(late, 'day')} late`, tasks].filter(Boolean).join(' · '), tone: 'red' } : { text: ['next', tasks].filter(Boolean).join(' · '), tone: 'blue' });
  }
  return out;
}
