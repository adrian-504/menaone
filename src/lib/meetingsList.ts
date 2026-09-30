// Meetings by day (owner, 29-Sep-2026, Concept A): "just a boring list of rows".
// The list is grouped by day — Today, Tomorrow, each coming day, then Earlier by
// month — the next meeting carries the client's standing, and past meetings
// show what came out of them. Pure: tabs/meetings.ts renders it.

import { writeUpState } from './meetingRecap';
import type { Commitment, Meeting } from './types';
import { fmtDayLong, fmtMonth } from './dates';

type ListMeeting = Pick<Meeting, 'id' | 'meetingDate' | 'startAt' | 'endAt' | 'isCancelled'>;

export interface DayGroup<T> {
  key: string;
  /** "Today", "Tomorrow", "Thursday 2 October", "Earlier · September". */
  label: string;
  /** The date beside Today/Tomorrow: "Tuesday 29 September". */
  sub: string | null;
  earlier: boolean;
  meetings: T[];
}

/** Local YYYY-MM-DD. */
export const localIso = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDaysIso = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return localIso(d); };
const longDay = (iso: string) => fmtDayLong(iso);
const monthOf = (iso: string) => fmtMonth(iso);
const startKey = (m: ListMeeting) => m.startAt || `${m.meetingDate || ''}T00:00`;

/**
 * Today onward, one group per day (Today and Tomorrow named), soonest first;
 * then earlier meetings by month, newest first. A day boundary is local midnight.
 */
export function groupMeetingsByDay<T extends ListMeeting>(meetings: T[], now: Date): DayGroup<T>[] {
  const today = localIso(now);
  const tomorrow = addDaysIso(today, 1);
  const coming = meetings.filter((m) => (m.meetingDate || '') >= today).sort((a, b) => startKey(a).localeCompare(startKey(b)) || a.id - b.id);
  const earlier = meetings.filter((m) => !!m.meetingDate && m.meetingDate < today).sort((a, b) => startKey(b).localeCompare(startKey(a)) || b.id - a.id);
  const undated = meetings.filter((m) => !m.meetingDate);
  const groups: DayGroup<T>[] = [];
  for (const m of coming) {
    const day = m.meetingDate!;
    let g = groups.find((x) => x.key === day);
    if (!g) {
      g = day === today ? { key: day, label: 'Today', sub: longDay(day), earlier: false, meetings: [] }
        : day === tomorrow ? { key: day, label: 'Tomorrow', sub: longDay(day), earlier: false, meetings: [] }
          : { key: day, label: longDay(day), sub: null, earlier: false, meetings: [] };
      groups.push(g);
    }
    g.meetings.push(m);
  }
  for (const m of earlier) {
    const key = `earlier:${m.meetingDate!.slice(0, 7)}`;
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, label: `Earlier · ${monthOf(m.meetingDate!)}`, sub: null, earlier: true, meetings: [] }; groups.push(g); }
    g.meetings.push(m);
  }
  if (undated.length) groups.push({ key: 'undated', label: 'No date', sub: null, earlier: true, meetings: undated });
  return groups;
}

/** The next meeting from now: the first one not cancelled that hasn't started (all-day ones count from their day). */
export function nextMeeting<T extends ListMeeting>(meetings: T[], now: Date): T | null {
  const today = localIso(now);
  const upcoming = meetings.filter((m) => !m.isCancelled && (m.startAt ? new Date(m.startAt).getTime() >= now.getTime() : (m.meetingDate || '') >= today));
  return upcoming.sort((a, b) => startKey(a).localeCompare(startKey(b)) || a.id - b.id)[0] ?? null;
}

export interface MeetingOutcomes {
  decisions: number;
  /** Promises we made in it. */
  promisesMade: number;
  /** What the client owes us from it. */
  owedToUs: number;
  openActions: number;
  writtenUp: boolean;
  /** Over, not cancelled, and nothing written or assigned. */
  needsWriteUp: boolean;
}

const lines = (s: string | null | undefined) => (s || '').split('\n').map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '').trim()).filter(Boolean);

/** What came out of a meeting: its decisions (non-empty lines), the promises made and owed from it, open actions, and whether it was written up. */
export function meetingOutcomes(m: Meeting, commitments: Pick<Commitment, 'sourceType' | 'sourceId' | 'direction' | 'status'>[], tasks: { status: string | null }[], over: boolean): MeetingOutcomes {
  const mine = commitments.filter((c) => c.sourceType === 'meeting' && c.sourceId === m.id && c.status !== 'dropped');
  const w = writeUpState(m, tasks, over);
  return {
    decisions: lines(m.decisions).length,
    promisesMade: mine.filter((c) => c.direction === 'ours').length,
    owedToUs: mine.filter((c) => c.direction === 'theirs').length,
    openActions: w.openActions,
    writtenUp: w.hasNotes || tasks.length > 0,
    needsWriteUp: w.needsWriteUp,
  };
}

/** "30 min", "1 h", "1 h 30"; null without both times. */
export function durationLabel(startAt: string | null | undefined, endAt: string | null | undefined): string | null {
  if (!startAt || !endAt) return null;
  const min = Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000);
  if (!(min > 0)) return null;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), r = min % 60;
  return r ? `${h} h ${r}` : `${h} h`;
}

/** Where it is, short: "Teams", "Riyadh office", "Online". */
export function placeLabel(m: Pick<Meeting, 'location' | 'isOnlineMeeting'>): string | null {
  const loc = (m.location || '').trim();
  if (/teams/i.test(loc)) return 'Teams';
  if (/zoom/i.test(loc)) return 'Zoom';
  if (/meet\.google|google meet/i.test(loc)) return 'Google Meet';
  if (loc) return loc.length > 28 ? `${loc.slice(0, 27)}…` : loc;
  return m.isOnlineMeeting ? 'Online' : null;
}
