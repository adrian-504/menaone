// The calendar's week and day as a time grid (1.62 "tools"): where an event's
// block sits and how tall it is, how overlapping events share a column, what
// goes in the all-day row (tasks due, promises, offer expiries), where the
// now-line is, and what the header line says. Pure: tabs/calendar.ts draws it.

import type { Commitment, Meeting, Proposal, Todo } from './types';
import { PS } from './commercial';
import { fmtDate, fmtDateShort } from './dates';
import { plural } from './pageKit';

/** One hour's height on the grid, and the hours shown before scrolling. */
export const HOUR_PX = 60;
export const DAY_START_HOUR = 8;
export const DAY_END_HOUR = 18;
/** An event this long or shorter reads on one line: "title · time". */
export const SHORT_MINUTES = 30;
/** A block is never shorter than this, so its title stays readable. */
export const MIN_BLOCK_PX = 24;
const DAY_MINUTES = 24 * 60;

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const midnight = (day: string) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d); };
const px = (minutes: number) => Math.round((minutes * HOUR_PX) / 60);

/** Minutes from the local midnight of `day` to a moment, kept inside that day. */
export function minutesInto(day: string, at: Date): number {
  return Math.max(0, Math.min(DAY_MINUTES, Math.round((at.getTime() - midnight(day).getTime()) / 60000)));
}

export interface GridEvent { id: number; startAt: string | null; endAt: string | null }

export interface Block {
  id: number;
  /** From the top of the day (00:00), in px. */
  top: number;
  height: number;
  /** Which of `cols` side-by-side columns it takes when events overlap. */
  col: number;
  cols: number;
  /** 30 minutes or less: one line. */
  short: boolean;
  startMin: number;
  endMin: number;
}

/** The timed events that start on `day`, as blocks: top and height from the start and end (an event with no end, or
 * one that ends before it starts, is given half an hour; one running past midnight stops at it), and overlapping
 * events side by side — each takes the first free column, and every event in a run of overlaps shares the run's
 * column count. Two events overlap when their drawn blocks would, so a short one never sits under the next. Pure. */
export function placeBlocks(events: GridEvent[], day: string): Block[] {
  const timed = events
    .filter((e) => !!e.startAt && /T\d/.test(e.startAt) && isoDay(new Date(e.startAt)) === day)
    .map((e) => {
      const startMin = minutesInto(day, new Date(e.startAt!));
      const rawEnd = e.endAt ? Math.round((new Date(e.endAt).getTime() - midnight(day).getTime()) / 60000) : startMin + SHORT_MINUTES;
      const endMin = Math.min(DAY_MINUTES, rawEnd > startMin ? rawEnd : startMin + SHORT_MINUTES);
      return { id: e.id, startMin, endMin };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin || a.id - b.id);
  // Where a block ends as drawn: its end, or the least a block can be.
  const drawnEnd = (e: { startMin: number; endMin: number }) => Math.max(e.endMin, e.startMin + (MIN_BLOCK_PX * 60) / HOUR_PX);
  const out: Block[] = [];
  let run: Block[] = [];
  let colEnds: number[] = [];
  let runEnd = -1;
  const close = () => { for (const b of run) b.cols = colEnds.length; run = []; colEnds = []; };
  for (const e of timed) {
    if (run.length && e.startMin >= runEnd) close();
    let col = colEnds.findIndex((end) => end <= e.startMin);
    if (col === -1) { col = colEnds.length; colEnds.push(0); }
    colEnds[col] = drawnEnd(e);
    runEnd = Math.max(runEnd, drawnEnd(e));
    const b: Block = { id: e.id, top: px(e.startMin), height: Math.max(MIN_BLOCK_PX, px(e.endMin - e.startMin)), col, cols: 1, short: e.endMin - e.startMin <= SHORT_MINUTES, startMin: e.startMin, endMin: e.endMin };
    run.push(b);
    out.push(b);
  }
  close();
  return out;
}

/** Is it over, running, or still to come? */
export function eventState(e: Pick<GridEvent, 'startAt' | 'endAt'>, now: Date): 'past' | 'now' | 'ahead' {
  if (!e.startAt) return 'ahead';
  const start = new Date(e.startAt).getTime();
  const end = e.endAt ? new Date(e.endAt).getTime() : start + SHORT_MINUTES * 60000;
  return end <= now.getTime() ? 'past' : start <= now.getTime() ? 'now' : 'ahead';
}

/** The now-line: which of the days shown is today, and how far down it. Null when today is not on screen. Pure. */
export function nowLine(now: Date, days: string[]): { index: number; top: number } | null {
  const index = days.indexOf(isoDay(now));
  return index === -1 ? null : { index, top: px(minutesInto(days[index], now)) };
}

// ── The all-day row ─────────────────────────────────────────────────────────

export type AllDayKind = 'promise' | 'expiry' | 'meeting' | 'task';
export interface AllDayChip { kind: AllDayKind; id: number; text: string; tone: 'red' | 'amber' | 'blue' | 'grey'; glyph: string }

export interface AllDayInput {
  meetings: Pick<Meeting, 'id' | 'title' | 'meetingDate' | 'startAt' | 'isCancelled'>[];
  todos: Pick<Todo, 'id' | 'title' | 'dueDate' | 'status' | 'someday'>[];
  commitments: Pick<Commitment, 'id' | 'text' | 'dueDate' | 'status' | 'direction' | 'todoId'>[];
  proposals: Pick<Proposal, 'id' | 'client' | 'status' | 'validUntil' | 'archived'>[];
}

const ORDER: AllDayKind[] = ['promise', 'expiry', 'meeting', 'task'];

/** What sits in a day's all-day row: the promises due that day (what we owe in red, what a client owes in amber),
 * the offers with the client that expire that day, meetings with a date and no time, and the open tasks due that day
 * (a promise's own task is said once, as the promise). Cancelled, finished and parked things are left out. Pure. */
export function allDayChips(day: string, i: AllDayInput): AllDayChip[] {
  const on = (d: string | null | undefined) => !!d && d.slice(0, 10) === day;
  const open = i.commitments.filter((c) => c.status === 'open');
  const promised = new Set(open.filter((c) => c.todoId != null).map((c) => c.todoId));
  const chips: AllDayChip[] = [
    ...open.filter((c) => on(c.dueDate)).map((c) => (c.direction === 'ours'
      ? { kind: 'promise' as const, id: c.id, text: c.text, tone: 'red' as const, glyph: '⚑' }
      : { kind: 'promise' as const, id: c.id, text: c.text, tone: 'amber' as const, glyph: '⚐' })),
    ...i.proposals.filter((p) => !p.archived && p.status === PS.SENT && on(p.validUntil))
      .map((p) => ({ kind: 'expiry' as const, id: p.id, text: `${p.client || 'Proposal'} offer expires`, tone: 'amber' as const, glyph: '◷' })),
    ...i.meetings.filter((m) => !m.isCancelled && !(m.startAt && /T\d/.test(m.startAt)) && on(m.meetingDate))
      .map((m) => ({ kind: 'meeting' as const, id: m.id, text: m.title, tone: 'blue' as const, glyph: '◉' })),
    ...i.todos.filter((t) => t.status !== 'Done' && !t.someday && on(t.dueDate) && !promised.has(t.id))
      .map((t) => ({ kind: 'task' as const, id: t.id, text: t.title, tone: 'grey' as const, glyph: '☑' })),
  ];
  return chips.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.id - b.id);
}

// ── The header line ─────────────────────────────────────────────────────────

/** "28 Sept – 4 Oct 2026"; in one month "5 – 11 Oct 2026"; across years both years are said. Pure. */
export function rangeLabel(start: string, end: string): string {
  if (start === end) return fmtDate(start);
  if (start.slice(0, 4) !== end.slice(0, 4)) return `${fmtDate(start)} – ${fmtDate(end)}`;
  if (start.slice(0, 7) === end.slice(0, 7)) return `${Number(start.slice(8, 10))} – ${fmtDate(end)}`;
  return `${fmtDateShort(start)} – ${fmtDate(end)}`;
}

/** "5 meetings · 3 hours": the timed meetings from `start` to `end` (cancelled ones aside) and how long they run,
 * to the nearest hour — in minutes under an hour. "No meetings" when there are none. Pure. */
export function rangeStats(meetings: Pick<Meeting, 'startAt' | 'endAt' | 'isCancelled'>[], start: string, end: string): string {
  const timed = meetings.filter((m) => !m.isCancelled && !!m.startAt && /T\d/.test(m.startAt) && isoDay(new Date(m.startAt)) >= start && isoDay(new Date(m.startAt)) <= end);
  if (!timed.length) return 'No meetings';
  const minutes = timed.reduce((n, m) => n + Math.max(0, m.endAt ? (new Date(m.endAt).getTime() - new Date(m.startAt!).getTime()) / 60000 : SHORT_MINUTES), 0);
  const length = minutes < 60 ? `${Math.round(minutes)} min` : plural(Math.round(minutes / 60), 'hour');
  return `${plural(timed.length, 'meeting')} · ${length}`;
}

/** "synced with Outlook 2 min ago" from the time of the last sync; older than a day it says the day. A time it
 * cannot read is said as it came. "" when there was no sync. Pure. */
export function syncedLabel(lastSyncAt: string | null | undefined, now: Date): string {
  if (!lastSyncAt) return '';
  const at = new Date(lastSyncAt.includes('T') || !/^\d{4}-\d{2}-\d{2} /.test(lastSyncAt) ? lastSyncAt : `${lastSyncAt.replace(' ', 'T')}Z`);
  if (Number.isNaN(at.getTime())) return `synced with Outlook ${lastSyncAt}`;
  const min = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60000));
  const ago = min < 1 ? 'just now' : min < 60 ? `${min} min ago` : min < 24 * 60 ? `${plural(Math.round(min / 60), 'hour')} ago` : `on ${fmtDateShort(isoDay(at), true)}`;
  return `synced with Outlook ${ago}`;
}
