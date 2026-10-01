// Projects in My Day's language (1.59 "pages"): each project as a milestone
// track — milestones placed by date between the first one (or today) and the target,
// done ones filled, the next one ringed, a coral "today" marker — with how
// many are done, the days left and what comes next. Pure: tabs/projects.ts
// draws it.

import type { Milestone, Project } from './types';
import { daysBetween } from './pipeline';
import { fmtDateShort } from './dates';

/** Where the track's first and last points sit (percent), so their labels fit inside the card. */
export const TRACK_MIN = 4;
export const TRACK_MAX = 96;
/** Milestone labels are about this wide (percent of the track): closer points are spread apart. */
export const TRACK_GAP = 9;

export interface TrackPoint { id: number; name: string; date: string | null; dateLabel: string; pos: number; state: 'done' | 'next' | 'todo' }
export interface Track {
  points: TrackPoint[];
  /** Today on the same scale, or null when the project has no dates to place it by. */
  today: number | null;
  /** Where the filled part of the line ends: today, kept inside the line. */
  done: number;
}

type M = Pick<Milestone, 'id' | 'name' | 'status' | 'targetDate' | 'completionDate' | 'sortOrder'>;
type P = Pick<Project, 'startDate' | 'targetDate' | 'createdAt'>;

const iso = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);
const isDone = (m: Pick<Milestone, 'status'>) => m.status === 'Done';

/** Milestones in the order they come: by date, undated ones after, then by their own order. Pure. */
export function orderMilestones<T extends M>(list: T[]): T[] {
  return [...list].sort((a, b) => (iso(a.targetDate) || '9999').localeCompare(iso(b.targetDate) || '9999') || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

/** The next milestone: the first not done, in date order. */
export function nextMilestone<T extends M>(list: T[]): T | null {
  return orderMilestones(list).find((m) => !isDone(m)) ?? null;
}

/** The milestone track: positions by date between start and target, spread so labels don't overlap, and today on the same scale. Pure. */
export function projectTrack(p: P, milestones: M[], today: string): Track {
  const ordered = orderMilestones(milestones);
  if (!ordered.length) return { points: [], today: null, done: 0 };
  const dates = ordered.map((m) => iso(m.targetDate)).filter((d): d is string => !!d);
  // The line runs from the first milestone, or today when that comes first, to the target: what is left to do,
  // not the months before the first milestone (as the approved mock draws it). Without dated milestones, from the start.
  const first = dates[0];
  const start = first ? (today < first ? today : first) : iso(p.startDate) || iso(p.createdAt) || today;
  let end = iso(p.targetDate) || dates[dates.length - 1] || today;
  if (dates.length && dates[dates.length - 1] > end) end = dates[dates.length - 1];
  const span = Math.max(1, daysBetween(start, end) ?? 1);
  const scale = (d: string) => TRACK_MIN + Math.max(0, Math.min(1, (daysBetween(start, d) ?? 0) / span)) * (TRACK_MAX - TRACK_MIN);
  const n = ordered.length;
  const raw = ordered.map((m, i) => (iso(m.targetDate) ? scale(iso(m.targetDate)!) : TRACK_MIN + ((i + 0.5) / n) * (TRACK_MAX - TRACK_MIN)));
  // Spread: each at least a label apart from the one before, then pulled back inside the line from the right.
  const gap = n > 1 ? Math.min(TRACK_GAP, (TRACK_MAX - TRACK_MIN) / (n - 1)) : 0;
  const pos = [...raw];
  for (let i = 1; i < n; i++) pos[i] = Math.max(pos[i], pos[i - 1] + gap);
  pos[n - 1] = Math.min(pos[n - 1], TRACK_MAX);
  for (let i = n - 2; i >= 0; i--) pos[i] = Math.min(pos[i], pos[i + 1] - gap);
  const next = nextMilestone(ordered);
  const points: TrackPoint[] = ordered.map((m, i) => ({
    id: m.id, name: m.name, date: iso(m.targetDate), dateLabel: iso(m.targetDate) ? fmtDateShort(iso(m.targetDate), true) : 'no date',
    pos: Math.round(pos[i] * 10) / 10, state: isDone(m) ? 'done' : m.id === next?.id ? 'next' : 'todo',
  }));
  // Today sits between the milestones either side of it, on their (spread) positions.
  const lastDate = points.map((x) => x.date).filter((d): d is string => !!d).sort().pop();
  const anchors = [{ date: start, pos: TRACK_MIN / 2 }, ...points.filter((x) => x.date).map((x) => ({ date: x.date!, pos: x.pos }))];
  if (!lastDate || end > lastDate) anchors.push({ date: end, pos: 100 - TRACK_MIN / 2 });
  anchors.sort((x, y) => x.date.localeCompare(y.date) || x.pos - y.pos);
  const last = anchors[anchors.length - 1];
  let at: number;
  if (today <= anchors[0].date) at = anchors[0].pos;
  else if (today >= last.date) at = today > last.date ? 100 - TRACK_MIN / 2 : last.pos;
  else {
    const hi = anchors.findIndex((x) => x.date > today);
    const lo = anchors[hi - 1], up = anchors[hi];
    const whole = daysBetween(lo.date, up.date) ?? 0;
    at = whole > 0 ? lo.pos + ((daysBetween(lo.date, today) ?? 0) / whole) * (up.pos - lo.pos) : up.pos;
  }
  const t = Math.round(Math.max(TRACK_MIN / 2, Math.min(100 - TRACK_MIN / 2, at)) * 10) / 10;
  return { points, today: t, done: t };
}

export interface ProjectFigures {
  done: number;
  total: number;
  /** Days to the target date (negative when past); null without one. */
  daysToTarget: number | null;
  targetLabel: string;
  next: { name: string; days: number | null } | null;
}

export function projectFigures(p: Pick<Project, 'targetDate'>, milestones: M[], today: string): ProjectFigures {
  const next = nextMilestone(milestones);
  return {
    done: milestones.filter(isDone).length, total: milestones.length,
    daysToTarget: p.targetDate ? daysBetween(today, p.targetDate) : null,
    targetLabel: p.targetDate ? fmtDateShort(p.targetDate, true) : '',
    next: next ? { name: next.name, days: next.targetDate ? daysBetween(today, next.targetDate) : null } : null,
  };
}

/** The sort key "by next milestone": its date; projects without one go last, by target date. Pure. */
export function nextMilestoneKey(p: Pick<Project, 'targetDate'>, milestones: M[]): string {
  const d = iso(nextMilestone(milestones)?.targetDate);
  return d ? `0:${d}` : `1:${iso(p.targetDate) || '9999-12-31'}`;
}

/** The progress ring's stroke: "37.7 94.2" for 40% of a circle of radius 15. Pure. */
export const RING_C = Math.round(2 * Math.PI * 15 * 10) / 10;
export function ringDash(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  return `${Math.round((p / 100) * RING_C * 10) / 10} ${RING_C}`;
}
