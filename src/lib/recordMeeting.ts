// The meeting page in the record anatomy (1.61 "records"): the header's time
// medallion, eyebrow and state chip, the three figures on "Where we stand",
// and when each person in the room was last met. Pure: tabs/meetings.ts and
// tabs/meetingContext.ts draw it.

import type { Meeting } from './types';
import { daysBetween } from './pipeline';
import { fmtDateShort, fmtTime } from './dates';
import { durationLabel, isRunning, placeLabel } from './meetingsList';
import { isMeetingOver } from './meetingRecap';
import { plural } from './pageKit';
import { companyHeaderFigures, type CompanyHeaderInput } from './recordCompany';
import type { Figure } from './recordFigures';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

export type MeetingPhase = 'upcoming' | 'running' | 'over' | 'cancelled';
export interface MeetingHead {
  /** The medallion: "TODAY" over "13:53"; a day without a time is the month over the day. */
  med: { top: string; big: string };
  /** "Meeting · Teams · 45 min". */
  eyebrow: string;
  state: { text: string; tone: 'red' | 'blue' | 'green' | 'amber' | 'grey' };
  phase: MeetingPhase;
}

type M = Parameters<typeof isMeetingOver>[0] & Pick<Meeting, 'meetingDate' | 'startAt' | 'endAt' | 'isCancelled' | 'location' | 'isOnlineMeeting'>;

/** The header of a meeting: when it is, how long and where, and where it stands — running now, still to come, or
 * over and written up or not. Pure. */
export function meetingHead(m: M, now: Date, today: string, w: { hasNotes: boolean; needsWriteUp: boolean }): MeetingHead {
  const date = m.meetingDate ? m.meetingDate.slice(0, 10) : null;
  const away = date ? daysBetween(today, date) ?? 0 : null;
  const dayWord = away === 0 ? 'Today' : away === 1 ? 'Tomorrow' : away === -1 ? 'Yesterday' : date ? fmtDateShort(date, true) : 'No date';
  const med = m.startAt ? { top: dayWord, big: fmtTime(m.startAt) }
    : date ? { top: away != null && Math.abs(away) <= 1 ? dayWord : MONTHS[Number(date.slice(5, 7)) - 1], big: String(Number(date.slice(8, 10))) }
    : { top: 'No date', big: '—' };
  const eyebrow = ['Meeting', placeLabel(m), durationLabel(m.startAt, m.endAt)].filter(Boolean).join(' · ');
  const running = isRunning(m, now);
  const over = isMeetingOver(m, now, today) && !running;
  const phase: MeetingPhase = m.isCancelled ? 'cancelled' : running ? 'running' : over ? 'over' : 'upcoming';
  const state: MeetingHead['state'] = phase === 'cancelled' ? { text: 'Cancelled', tone: 'red' }
    : phase === 'running' ? { text: m.endAt ? `Now · until ${fmtTime(m.endAt)}` : 'Now', tone: 'red' }
    : phase === 'over' ? (w.needsWriteUp ? { text: 'Not written up', tone: 'amber' } : w.hasNotes ? { text: 'Written up', tone: 'green' } : { text: 'Over', tone: 'grey' })
    : { text: away == null ? 'No date yet' : away <= 0 ? 'Later today' : away === 1 ? 'Tomorrow' : `In ${plural(away, 'day')}`, tone: 'blue' };
  return { med, eyebrow, state, phase };
}

/** "Where we stand" in three figures: the monthly, when notice is due, how much is in flight — each only when the
 * company has it (the company page's own figures, shortened). Pure. */
export function standFigures(i: CompanyHeaderInput): Figure[] {
  const all = companyHeaderFigures(i);
  const out: Figure[] = [];
  const monthly = all.find((f) => f.label.startsWith('a month'));
  if (monthly) out.push({ value: monthly.value, label: 'a month', tone: 'green' });
  const notice = all.find((f) => f.label.startsWith('notice'));
  if (notice) out.push({ value: notice.value, label: notice.label.startsWith('notice window') ? 'notice open' : 'notice due', tone: notice.tone });
  const flight = all.find((f) => f.label.startsWith('in flight'));
  if (flight) out.push({ value: flight.value, label: 'in flight' });
  return out;
}

/** The day a person was last met before this meeting: by their email address on an earlier meeting, or their name
 * among its attendees. `earlier` is the client's meetings before this one. Null when never. Pure. */
export function lastMet(person: { name: string; email?: string | null }, earlier: Pick<Meeting, 'meetingDate' | 'attendees' | 'attendeeEmails'>[]): string | null {
  const name = person.name.trim().toLowerCase();
  const email = (person.email || '').trim().toLowerCase();
  const dates = earlier.filter((m) => m.meetingDate && (
    (email && (m.attendeeEmails || []).some((a) => a.toLowerCase() === email))
    || (name.length > 3 && (m.attendees || []).some((a) => a.toLowerCase().includes(name)))
  )).map((m) => m.meetingDate!.slice(0, 10)).sort();
  return dates.pop() || null;
}
