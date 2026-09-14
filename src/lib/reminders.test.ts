import { describe, it, expect } from 'vitest';
import { dueReminders, pruneSent, isWorkday, DEFAULT_REMINDERS, type ReminderInput } from './reminders';
import type { Meeting, Todo } from './types';

const meeting = (over: Partial<Meeting>): Meeting => ({
  id: 1, title: 'Acme review', meetingDate: '2026-09-14', companyName: 'Acme', projectId: null, opportunityId: null, attendees: [], agenda: null,
  discussion: null, decisions: null, actionItems: null, followUp: null, nextMeeting: null, noteId: null, createdAt: null, updatedAt: null,
  outlookEventId: null, startAt: null, endAt: null, organizer: null, location: null, isOnlineMeeting: false, onlineMeetingUrl: null,
  isCancelled: false, source: 'outlook', ...over,
});
const todo = (over: Partial<Todo>): Todo => ({
  id: 1, title: 'Send fees', type: 'general', client: null, priority: 'Medium', dueDate: null, status: 'Pending', description: null, createdAt: null,
  completedAt: null, projectId: null, parentId: null, areaId: null, section: null, sortOrder: null, recurrenceRule: null, tags: [], meetingId: null, ...over,
});
const at = (s: string) => new Date(s);
const input = (over: Partial<ReminderInput>): ReminderInput => ({
  now: at('2026-09-14T09:52:00'), settings: { ...DEFAULT_REMINDERS, morning: false }, meetings: [], todos: [], sent: new Set(), morningSummary: () => '2 meetings', ...over,
});

describe('reminders', () => {
  it('reminds of a meeting ten minutes ahead, once, and not for cancelled or long-past ones', () => {
    const m = meeting({ startAt: at('2026-09-14T10:00:00').toISOString() });
    const [r] = dueReminders(input({ meetings: [m, meeting({ id: 2, startAt: at('2026-09-14T10:00:00').toISOString(), isCancelled: true })] }));
    expect(r.title).toBe('Acme review');
    expect(r.body).toBe('In 8 minutes · 10:00 · Acme');
    expect(dueReminders(input({ meetings: [m], sent: new Set([r.key]) }))).toEqual([]);
    expect(dueReminders(input({ meetings: [m], now: at('2026-09-14T09:45:00') }))).toEqual([]);
    expect(dueReminders(input({ meetings: [m], now: at('2026-09-14T10:05:00') }))).toEqual([]);
  });

  it('reminds of timed tasks at their due time', () => {
    const t = todo({ dueDate: '2026-09-14', dueTime: '09:50' });
    expect(dueReminders(input({ todos: [t, todo({ id: 2, dueDate: '2026-09-14' }), todo({ id: 3, dueDate: '2026-09-14', dueTime: '09:50', status: 'Done' })] })).map((r) => r.record?.id)).toEqual([1]);
    expect(dueReminders(input({ todos: [t], settings: { ...DEFAULT_REMINDERS, morning: false, tasks: false } }))).toEqual([]);
  });

  it('sends the morning summary once on workdays, within three hours of the set time', () => {
    const morning = { settings: DEFAULT_REMINDERS };
    expect(dueReminders(input({ ...morning, now: at('2026-09-13T08:40:00') })).map((r) => r.key)).toEqual(['morning:2026-09-13']);
    expect(dueReminders(input({ ...morning, now: at('2026-09-18T08:40:00') }))).toEqual([]); // Friday
    expect(dueReminders(input({ ...morning, now: at('2026-09-13T12:00:00') }))).toEqual([]);
    expect(isWorkday(at('2026-09-18T08:40:00'), 'mon-fri')).toBe(true);
  });

  it('forgets old sent keys', () => {
    expect(pruneSent(['morning:2026-09-10', 'morning:2026-09-13', 'task:1:2026-09-14T09:50'], at('2026-09-14T10:00:00'))).toEqual(['morning:2026-09-13', 'task:1:2026-09-14T09:50']);
  });
});
