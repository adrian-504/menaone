// @vitest-environment jsdom
// The project page's figures, tasks grouped by milestone and the notes under the track.
import { describe, expect, it } from 'vitest';

import { milestoneOf, projectHeaderFigures, tasksByMilestone, trackNotes } from './recordProject';
import type { Milestone, Todo } from './types';

const T = '2026-10-01';
const M = (id: number, name: string, targetDate: string | null, status = 'Not Started'): Milestone => ({ id, projectId: 1, name, description: null, status, targetDate, completionDate: null, sortOrder: id });
const MS = [M(1, 'Onboarding pack', '2026-09-02', 'Done'), M(2, 'GOSI registrations', '2026-09-20', 'Done'), M(3, 'October payroll run', '2026-10-28', 'In Progress'), M(4, 'Iqama renewals', '2026-11-30'), M(5, 'Year-end WPS', '2026-12-31')];
const K = (id: number, over: Partial<Todo> = {}) => ({ id, title: `t${id}`, status: 'Pending', dueDate: null, section: null, completedAt: null, parentId: null, ...over }) as Todo;

describe('the project header', () => {
  it('milestones done, days to the next one, tasks open, days to the target', () => {
    const f = projectHeaderFigures({ targetDate: '2026-12-31', taskCount: 4, taskDoneCount: 1, status: 'In Progress' }, MS, T);
    expect(f.map((x) => [x.value, x.label, x.tone])).toEqual([['2 of 5', 'milestones done', undefined], ['27 days', 'to October payroll run', undefined], ['3', 'tasks open', undefined], ['91 days', 'to target', undefined]]);
  });
  it('a late milestone and a passed target are red; a project with nothing planned has no figures', () => {
    const f = projectHeaderFigures({ targetDate: '2026-09-25', taskCount: 0, taskDoneCount: 0, status: 'At Risk' }, [M(1, 'Kickoff', '2026-09-28')], T);
    expect(f.map((x) => [x.value, x.label, x.tone])).toEqual([['0 of 1', 'milestone done', undefined], ['3 days', 'late · Kickoff', 'red'], ['6 days', 'past the target', 'red']]);
    expect(projectHeaderFigures({ targetDate: null, taskCount: 0, taskDoneCount: 0, status: 'Planning' }, [], T)).toEqual([]);
  });
  it('a completed project counts its milestones and tasks but no longer counts down', () => {
    expect(projectHeaderFigures({ targetDate: '2026-09-25', taskCount: 2, taskDoneCount: 2, status: 'Completed' }, [M(1, 'Kickoff', '2026-09-28')], T).map((x) => x.label)).toEqual(['milestone done', 'tasks open']);
  });
});

describe('tasks by milestone', () => {
  it('a task goes to the milestone its heading names, else to the first one due on or after its date, else to none', () => {
    expect(milestoneOf(K(1, { section: 'iqama renewals', dueDate: '2026-10-05' }), MS)?.id).toBe(4);
    expect(milestoneOf(K(2, { dueDate: '2026-10-25' }), MS)?.id).toBe(3);
    expect(milestoneOf(K(3, { dueDate: '2026-10-28' }), MS)?.id).toBe(3);
    expect(milestoneOf(K(4, { status: 'Done', completedAt: '2026-09-30T10:00:00Z' }), MS)?.id).toBe(3);
    expect(milestoneOf(K(5), MS)).toBeNull();
    expect(milestoneOf(K(6, { dueDate: '2027-02-01' }), MS)).toBeNull();
    expect(milestoneOf(K(7, { section: 'Admin', dueDate: '2026-11-15' }), MS)?.id).toBe(4);
  });
  it('groups carry their progress and due date; open work first, then finished groups, then the unclaimed', () => {
    const tasks = [
      K(1, { status: 'Done', dueDate: '2026-09-30', completedAt: '2026-09-30' }), K(2, { dueDate: '2026-10-20' }), K(3, { dueDate: '2026-10-25' }),
      K(4, { dueDate: '2026-11-15' }), K(5, { status: 'Done', dueDate: '2026-09-01' }), K(6), K(7, { parentId: 2, dueDate: '2026-12-01' }),
    ];
    const g = tasksByMilestone(tasks, MS);
    expect(g.map((x) => [x.name, x.note, x.pct, x.tasks.map((t) => t.id)])).toEqual([
      ['October payroll run', '1 of 3 · due 28 Oct', 33, [2, 3, 1]],
      ['Iqama renewals', '0 of 1 · due 30 Nov', 0, [4]],
      ['Onboarding pack', '1 of 1 · due 2 Sept', 100, [5]],
      ['Not tied to a milestone', '0 of 1', 0, [6]],
    ]);
  });
  it('without milestones the tasks are one plain group; without tasks there are no groups', () => {
    expect(tasksByMilestone([K(1), K(2, { status: 'Done' })], []).map((x) => [x.name, x.note])).toEqual([['Tasks', '1 of 2']]);
    expect(tasksByMilestone([], MS)).toEqual([]);
  });
});

describe('the notes under the track', () => {
  it('done milestones are ticked, the next one says its tasks, later ones say nothing', () => {
    const groups = tasksByMilestone([K(1, { status: 'Done', dueDate: '2026-09-30' }), K(2, { dueDate: '2026-10-20' }), K(3, { dueDate: '2026-10-25' })], MS);
    const n = trackNotes(MS, groups, T);
    expect(n.get(1)).toEqual({ text: '✓ done', tone: 'green' });
    expect(n.get(3)).toEqual({ text: 'next · 1 of 3 tasks', tone: 'blue' });
    expect(n.has(4)).toBe(false);
  });
  it('a next milestone past its date says how late it is', () => {
    expect(trackNotes([M(1, 'Kickoff', '2026-09-28')], [], T).get(1)).toEqual({ text: '3 days late', tone: 'red' });
    expect(trackNotes([M(1, 'Kickoff', null)], [], T).get(1)).toEqual({ text: 'next', tone: 'blue' });
  });
});
