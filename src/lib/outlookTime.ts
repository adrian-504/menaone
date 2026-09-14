// Outlook times. Graph is asked for UTC, but values arrive without a zone
// ("2026-09-13T10:00:00.0000000"), which the browser reads as local time.
// Older synced rows are stored that way, so every load goes through here.

import type { EmailRecord, Meeting } from './types';


/** A Date as YYYY-MM-DD in local time (utils.ts has side effects tests can't load). */
export function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Outlook sync asks Graph for UTC but the value arrives without a zone
 * ("2026-09-13T10:00:00.0000000"), which the browser would read as local time.
 * Returns a proper UTC instant; values that already carry a zone are kept. */
export function utcInstant(s: string | null | undefined): string | null {
  if (!s) return s ?? null;
  if (/(Z|[+-]\d\d:?\d\d)$/i.test(s)) return s;
  const m = s.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?)(\.\d+)?$/);
  return m ? `${m[1]}${m[2] ? m[2].slice(0, 4) : ''}Z` : s;
}

/** Fixes an Outlook meeting's times, and its date to the local calendar day. */
export function normalizeMeeting<T extends Meeting>(m: T): T {
  if (m.source !== 'outlook' || !m.startAt) return m;
  const startAt = utcInstant(m.startAt);
  const endAt = utcInstant(m.endAt);
  const d = new Date(startAt!);
  return { ...m, startAt, endAt, meetingDate: isNaN(d.getTime()) ? m.meetingDate : localIsoDate(d) };
}

export function normalizeEmail<T extends EmailRecord>(e: T): T {
  return e.flagDueAt ? { ...e, flagDueAt: utcInstant(e.flagDueAt) } : e;
}

