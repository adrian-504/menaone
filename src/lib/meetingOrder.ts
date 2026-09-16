// One ordering rule for meetings, used by the Meetings list and by the
// meetings section on a company page: what's coming first (soonest at the
// top), then what already happened (most recent first). The Calendar sorts
// the same way, so the two modules can't disagree any more.

/** Sort key: the real start time when there is one, otherwise the date alone. */
export function meetingStartKey(m: { startAt?: string | null; meetingDate?: string | null }): string {
  return m.startAt || `${m.meetingDate || ''}T00:00`;
}

export type MeetingWhen = 'all' | 'upcoming' | 'past';

/**
 * Splits meetings into upcoming (today onwards, soonest first) and past
 * (yesterday back, most recent first). `when` narrows it to one side; 'all'
 * returns both so the list can show a divider between them.
 */
export function orderMeetings<T extends { startAt?: string | null; meetingDate?: string | null }>(
  list: T[],
  when: MeetingWhen,
  todayIso: string,
): { upcoming: T[]; past: T[] } {
  const isPast = (m: T) => !!m.meetingDate && m.meetingDate < todayIso;
  const byStart = (a: T, b: T) => meetingStartKey(a).localeCompare(meetingStartKey(b));
  const upcoming = when === 'past' ? [] : list.filter((m) => !isPast(m)).sort(byStart);
  const past = when === 'upcoming' ? [] : list.filter(isPast).sort((a, b) => byStart(b, a));
  return { upcoming, past };
}
