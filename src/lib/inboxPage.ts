// The Inbox in the app's look (1.62 "tools"): what a captured line most likely
// becomes (the primary action on its row) and the one or two other choices,
// how its kind and age read, the line beside the title, and the days the
// inbox was at zero. Capturing and converting stay as they were. Pure:
// tabs/inbox.ts draws it.

import type { InboxItem, Proposal } from './types';
import { PS } from './commercial';
import { fmtDateShort, fmtTime, fmtWeekday } from './dates';
import { daysBetween } from './pipeline';
import { plural } from './pageKit';

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ── Kinds ───────────────────────────────────────────────────────────────────

export interface KindLook { glyph: string; tone: 'blue' | 'coral' | 'amber' | 'grey'; label: string }

const KINDS: Record<string, KindLook> = {
  task: { glyph: '☑', tone: 'blue', label: 'task' },
  followup: { glyph: '↻', tone: 'coral', label: 'follow-up' },
  idea: { glyph: '✦', tone: 'amber', label: 'idea' },
  note: { glyph: '▤', tone: 'grey', label: 'note' },
};

/** The tile and the word for a captured line's kind; an unknown kind reads as a task. */
export const kindLook = (kind: string): KindLook => KINDS[kind] ?? KINDS.task;

// ── Where it goes ───────────────────────────────────────────────────────────

export type DestinationKey = 'task' | 'followup' | 'note' | 'client_note' | 'opportunity';
export interface Destination { key: DestinationKey; label: string }
export interface Destinations { best: Destination; others: Destination[] }

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** What a captured line most likely becomes, then the other choices (two at most). A task becomes a task; a
 * follow-up a task tagged follow-up; an idea a note; a note that names a client goes to that client's notes (or
 * starts an opportunity), and a note that names no one becomes a note. The rest stays in the row's menu. Pure. */
export function inboxDestinations(kind: string, company: string | null | undefined): Destinations {
  const task: Destination = { key: 'task', label: 'Task' };
  const note: Destination = { key: 'note', label: 'Note' };
  switch (kind) {
    case 'followup': return { best: { key: 'followup', label: 'Follow-up task' }, others: [task] };
    case 'idea': return { best: { key: 'note', label: 'Make note' }, others: [task] };
    case 'note': return company?.trim()
      ? { best: { key: 'client_note', label: `Add to ${clip(company.trim(), 22)} notes` }, others: [{ key: 'opportunity', label: 'Opportunity' }] }
      : { best: { key: 'note', label: 'Make note' }, others: [task] };
    default: return { best: { key: 'task', label: 'Make task' }, others: [note, { key: 'followup', label: 'Follow-up' }] };
  }
}

// ── How it reads ────────────────────────────────────────────────────────────

/** "captured today 09:12", "captured yesterday", "captured 3 days ago", and past a week the day. "" with no time. Pure. */
export function capturedWhen(createdAt: string | null | undefined, now: Date): string {
  if (!createdAt) return '';
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return '';
  const days = daysBetween(isoDay(at), isoDay(now)) ?? 0;
  if (days <= 0) return `captured today ${fmtTime(at)}`;
  if (days === 1) return 'captured yesterday';
  return days <= 7 ? `captured ${days} days ago` : `captured ${fmtDateShort(isoDay(at), true)}`;
}

/** Beside the title: "4 to sort · oldest 2 days". "" when there is nothing to sort. Pure. */
export function inboxSummary(items: Pick<InboxItem, 'createdAt'>[], now: Date): string {
  if (!items.length) return '';
  const ages = items.map((i) => (i.createdAt ? daysBetween(isoDay(new Date(i.createdAt)), isoDay(now)) ?? 0 : 0));
  const oldest = Math.max(0, ...ages);
  return `${items.length} to sort · oldest ${oldest === 0 ? 'today' : oldest === 1 ? 'yesterday' : plural(oldest, 'day')}`;
}

/** On a follow-up that names a client: the offer with them that runs out within a week, or already has —
 * "offer expires Mon", "offer expired 28 Sept". Null when there is none. Pure. */
export function offerChip(company: string | null | undefined, proposals: Pick<Proposal, 'client' | 'status' | 'validUntil' | 'archived'>[], today: string): { text: string; tone: 'red' | 'amber' } | null {
  const name = company?.trim().toLowerCase();
  if (!name) return null;
  const due = proposals.filter((p) => !p.archived && p.status === PS.SENT && !!p.validUntil && (p.client || '').trim().toLowerCase() === name)
    .map((p) => p.validUntil!.slice(0, 10)).sort()[0];
  if (!due) return null;
  const left = daysBetween(today, due) ?? 0;
  if (left < 0) return { text: `offer expired ${fmtDateShort(due, true)}`, tone: 'red' };
  if (left > 7) return null;
  return { text: left === 0 ? 'offer expires today' : `offer expires ${fmtWeekday(due, 'short')}`, tone: left <= 3 ? 'red' : 'amber' };
}

// ── Inbox zero ──────────────────────────────────────────────────────────────

// The days at zero are kept as a JSON list of dates in app_meta, under "inbox_zero_days" (no table of its own).
const KEEP_DAYS = 400;

/** The stored list as dates; anything else in it is dropped. Pure. */
export function parseZeroDays(raw: string | null | undefined): string[] {
  try {
    const list: unknown = JSON.parse(raw || '[]');
    return Array.isArray(list) ? [...new Set(list.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort() : [];
  } catch { return []; }
}

/** The list with today in it: once a day, in order, and no further back than about a year. Pure. */
export function withZeroDay(list: string[], today: string): string[] {
  return [...new Set([...list, today])].filter((d) => (daysBetween(d, today) ?? 0) <= KEEP_DAYS).sort();
}

/** How many days this month the inbox was seen empty. Pure. */
export function zeroDaysThisMonth(list: string[], today: string): number {
  return new Set(list.filter((d) => d.slice(0, 7) === today.slice(0, 7) && d <= today)).size;
}

/** "Inbox zero 12 days this month"; just "Inbox zero" before any day is counted. */
export const zeroHeadline = (days: number): string => (days > 0 ? `Inbox zero ${plural(days, 'day')} this month` : 'Inbox zero');
