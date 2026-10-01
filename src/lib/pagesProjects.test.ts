// Projects in My Day's language (1.59 "pages"): the milestone track's positions, the today marker, what's next, the ring.
import { describe, expect, it } from 'vitest';

import { nextMilestone, nextMilestoneKey, orderMilestones, projectFigures, projectTrack, ringDash, ringProgress, TRACK_GAP, TRACK_MAX, TRACK_MIN } from './pagesProjects';

const T = '2026-10-01';
const M = (id: number, name: string, targetDate: string | null, status = 'Not Started') => ({ id, name, targetDate, status, completionDate: null, sortOrder: id });
const acme = [M(1, 'Onboarding pack', '2026-09-02', 'Done'), M(2, 'GOSI registrations', '2026-09-20', 'Done'), M(3, 'October payroll run', '2026-10-28', 'In Progress'), M(4, 'Iqama renewals', '2026-11-30'), M(5, 'Year-end WPS', '2026-12-31')];
const P = { startDate: '2026-02-01', targetDate: '2026-12-31', createdAt: '2026-02-01' };

describe('the milestone track', () => {
  it('places milestones by date from the first one to the target, done / next / to do', () => {
    const t = projectTrack(P, acme, T);
    expect(t.points.map((x) => x.state)).toEqual(['done', 'done', 'next', 'todo', 'todo']);
    expect(t.points[0].pos).toBe(TRACK_MIN);
    expect(t.points[4].pos).toBe(TRACK_MAX);
    // 28 Oct is 56 of 120 days in: 4 + 0.4667 × 92.
    expect(t.points[2].pos).toBeCloseTo(46.9, 1);
    expect(t.points.map((x) => x.dateLabel)).toEqual(['2 Sept', '20 Sept', '28 Oct', '30 Nov', '31 Dec']);
  });
  it('today sits between the milestones either side of it, and the filled line ends there', () => {
    const t = projectTrack(P, acme, T);
    expect(t.today!).toBeGreaterThan(t.points[1].pos);
    expect(t.today!).toBeLessThan(t.points[2].pos);
    expect(t.done).toBe(t.today);
  });
  it('starts at today when the first milestone is still ahead', () => {
    const t = projectTrack({ startDate: '2026-08-01', targetDate: '2026-12-01', createdAt: '2026-08-01' }, [M(1, 'Hire a recruiter', '2026-10-15'), M(2, 'Launch', '2026-12-01')], T);
    expect(t.today).toBe(TRACK_MIN / 2);
    expect(t.points[0].pos).toBeGreaterThan(TRACK_MIN + 10);
    expect(t.points[0].state).toBe('next');
  });
  it('spreads milestones that fall on nearly the same day so their labels fit', () => {
    const t = projectTrack(P, [M(1, 'A', '2026-09-01'), M(2, 'B', '2026-09-02'), M(3, 'C', '2026-09-03'), M(4, 'D', '2026-12-31')], T);
    expect(t.points[1].pos - t.points[0].pos).toBeGreaterThanOrEqual(TRACK_GAP - 0.01);
    expect(t.points[2].pos - t.points[1].pos).toBeGreaterThanOrEqual(TRACK_GAP - 0.01);
    expect(t.points[3].pos).toBe(TRACK_MAX);
  });
  it('undated milestones take an even place; no milestones, no track', () => {
    const t = projectTrack(P, [M(1, 'A', null), M(2, 'B', null)], T);
    expect(t.points.map((x) => x.dateLabel)).toEqual(['no date', 'no date']);
    expect(t.points[0].pos).toBeLessThan(t.points[1].pos);
    expect(projectTrack(P, [], T)).toEqual({ points: [], today: null, done: 0 });
  });
});

describe('figures', () => {
  it('done of total, days to the target, and the next milestone', () => {
    expect(projectFigures(P, acme, T)).toEqual({ done: 2, total: 5, daysToTarget: 91, targetLabel: '31 Dec', next: { name: 'October payroll run', days: 27 } });
    expect(projectFigures({ targetDate: null }, [], T)).toEqual({ done: 0, total: 0, daysToTarget: null, targetLabel: '', next: null });
  });
  it('orders by date and sorts projects by their next milestone, those without one last', () => {
    expect(orderMilestones([M(2, 'B', null), M(1, 'A', '2026-10-01'), M(3, 'C', '2026-09-01')]).map((m) => m.name)).toEqual(['C', 'A', 'B']);
    expect(nextMilestone(acme)?.name).toBe('October payroll run');
    const keys = [nextMilestoneKey(P, acme), nextMilestoneKey({ targetDate: '2026-12-01' }, [M(9, 'Hire', '2026-10-15')]), nextMilestoneKey({ targetDate: '2026-11-01' }, [])];
    expect([...keys].sort()).toEqual([keys[1], keys[0], keys[2]]);
  });
  it('the ring follows tasks when there are tasks, else milestones done of total', () => {
    expect(ringProgress({ taskCount: 4, computedProgress: 25 }, { done: 2, total: 5 })).toEqual({ pct: 25, of: 'tasks' });
    expect(ringProgress({ taskCount: 0, computedProgress: 0 }, { done: 2, total: 5 })).toEqual({ pct: 40, of: 'milestones' });
    expect(ringProgress({ taskCount: 0, computedProgress: 0 }, { done: 0, total: 0 })).toEqual({ pct: 0, of: 'none' });
  });
  it('the ring draws the share of a 94.2 circumference', () => {
    expect(ringDash(40)).toBe('37.7 94.2');
    expect(ringDash(0)).toBe('0 94.2');
    expect(ringDash(140)).toBe('94.2 94.2');
  });
});
