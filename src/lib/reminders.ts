// Reminders: which notifications are due right now. Pure — tabs/reminders.ts
// runs the clock, remembers what was sent and shows the notifications.

import type { Meeting, Todo } from './types';

export interface ReminderSettings {
  meetings: boolean;
  /** Minutes before a meeting starts. */
  meetingMinutes: number;
  tasks: boolean;
  /** Minutes before a task's due time. */
  taskMinutes: number;
  morning: boolean;
  /** "HH:MM" local time. */
  morningAt: string;
  /** Only weekdays Sunday–Thursday or Monday–Friday get the morning summary. */
  workweek: 'sun-thu' | 'mon-fri' | 'every-day';
}

export const DEFAULT_REMINDERS: ReminderSettings = {
  meetings: true, meetingMinutes: 10, tasks: true, taskMinutes: 0, morning: true, morningAt: '08:30', workweek: 'sun-thu',
};

export interface Reminder {
  /** Unique per occurrence, so it's sent once. */
  key: string;
  title: string;
  body: string;
  record?: { kind: 'meeting' | 'task'; id: number };
}

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** How late a reminder may still be sent (the app was asleep or just opened). */
export const GRACE_MS = 10 * 60_000;

function inWindow(fireAt: Date, now: Date, eventAt: Date): boolean {
  const t = now.getTime();
  return t >= fireAt.getTime() && t - fireAt.getTime() <= GRACE_MS && t < eventAt.getTime() + 60_000;
}

export function isWorkday(d: Date, workweek: ReminderSettings['workweek']): boolean {
  const day = d.getDay();
  if (workweek === 'every-day') return true;
  return workweek === 'sun-thu' ? day >= 0 && day <= 4 : day >= 1 && day <= 5;
}

export interface ReminderInput {
  now: Date;
  settings: ReminderSettings;
  meetings: Meeting[];
  todos: Todo[];
  /** Keys already sent. */
  sent: Set<string>;
  /** Morning summary text, built by the caller from My Day. */
  morningSummary: () => string;
}

export function dueReminders(i: ReminderInput): Reminder[] {
  const out: Reminder[] = [];
  const { now, settings } = i;
  if (settings.meetings) {
    for (const m of i.meetings) {
      if (m.isCancelled || !m.startAt) continue;
      const start = new Date(m.startAt);
      if (isNaN(start.getTime())) continue;
      const fireAt = new Date(start.getTime() - settings.meetingMinutes * 60_000);
      const key = `meeting:${m.id}:${m.startAt}`;
      if (i.sent.has(key) || !inWindow(fireAt, now, start)) continue;
      const mins = Math.max(0, Math.round((start.getTime() - now.getTime()) / 60_000));
      out.push({
        key, record: { kind: 'meeting', id: m.id }, title: m.title,
        body: [mins <= 0 ? 'Starting now' : `In ${mins} minute${mins === 1 ? '' : 's'} · ${hhmm(start)}`, m.companyName, m.location && !/teams/i.test(m.location) ? m.location : m.onlineMeetingUrl ? 'Online' : null].filter(Boolean).join(' · '),
      });
    }
  }
  if (settings.tasks) {
    for (const t of i.todos) {
      if (t.status === 'Done' || !t.dueDate || !t.dueTime) continue;
      const due = new Date(`${t.dueDate}T${t.dueTime}:00`);
      if (isNaN(due.getTime())) continue;
      const fireAt = new Date(due.getTime() - settings.taskMinutes * 60_000);
      const key = `task:${t.id}:${t.dueDate}T${t.dueTime}`;
      if (i.sent.has(key) || !inWindow(fireAt, now, new Date(due.getTime() + GRACE_MS))) continue;
      out.push({ key, record: { kind: 'task', id: t.id }, title: t.title, body: [`Due ${settings.taskMinutes ? `at ${t.dueTime}` : 'now'}`, t.client, t.priority === 'High' ? 'High priority' : null].filter(Boolean).join(' · ') });
    }
  }
  if (settings.morning && isWorkday(now, settings.workweek)) {
    const [h, m] = settings.morningAt.split(':').map(Number);
    const fireAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h || 0, m || 0);
    const key = `morning:${localDate(now)}`;
    if (!i.sent.has(key) && now >= fireAt && now.getTime() - fireAt.getTime() <= 3 * 60 * 60_000) {
      out.push({ key, title: 'Your day at MENA One', body: i.morningSummary() });
    }
  }
  return out;
}

/** Keeps the sent list small: drops keys for days before yesterday. */
export function pruneSent(sent: string[], now: Date): string[] {
  const cutoff = localDate(new Date(now.getTime() - 2 * 86_400_000));
  return sent.filter((k) => {
    const date = k.match(/(\d{4}-\d\d-\d\d)/)?.[1];
    return !date || date >= cutoff;
  }).slice(-300);
}
