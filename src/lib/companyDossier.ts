// Company page as a dossier (owner, 29-Sep-2026, Concept B): "I go into a
// company page and barely learn anything." The first screen answers who, where
// we stand, what's next and who to call. This decides what the right column
// shows: the state clauses as labelled lines, the next five things and the
// five recent ones that matter (not the plumbing of status changes). Pure:
// tabs/companies.ts renders it.

import { meetingExcerpt } from './meetingExcerpt';
import type { FutureRow } from './recordTimeline';
import type { ActivityEntry, Meeting } from './types';
import type { ClauseKey } from './companyBrief';
import { fmtDateShort } from './dates';

/** Where we stand, as labelled lines; the pinned clause is the Remember panel instead. */
export const STAND_LABEL: Partial<Record<ClauseKey, string>> = {
  relationship: 'Relationship', inflight: 'In flight', rhythm: 'Meetings', commitments: 'Owed',
};

export const NEXT_LIMIT = 5;
export const RECENT_LIMIT = 5;

/** What's coming: overdue first, then soonest (the timeline's order), five at most. */
export function dossierNext(future: FutureRow[], limit = NEXT_LIMIT): FutureRow[] {
  return [...future].sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.date || '9999').localeCompare(b.date || '9999') || (a.time || '').localeCompare(b.time || '')).slice(0, limit);
}

export interface RecentRow {
  key: string;
  /** YYYY-MM-DD. */
  date: string;
  /** When exactly, to order a day's rows. */
  at: string;
  label: string;
  sub: string | null;
  tone: 'green' | 'accent' | 'amber' | 'muted';
  record: { kind: 'meeting' | 'proposal' | 'agreement' | 'task' | 'opportunity'; id: number } | null;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const label = (a: ActivityEntry) => (a.entityLabel || '').trim();

/** One activity row as something that happened, or null for plumbing
 * (contacts added, other status changes, edits). */
function meaningful(a: ActivityEntry, today: string): RecentRow | null {
  const date = (a.createdAt || '').slice(0, 10);
  if (!date) return null;
  const base = { key: `act:${a.id}`, date, at: a.createdAt || date };
  const to = (a.detail || '').split('→').pop()?.trim() || '';
  switch (a.action) {
    case 'status_changed':
      if (a.entityType === 'proposal' && to === 'Sent to Client') return { ...base, label: 'Proposal sent', sub: label(a), tone: 'accent', record: { kind: 'proposal', id: a.entityId } };
      if (a.entityType === 'proposal' && to === 'Signed by Client') return { ...base, label: 'Proposal signed by the client', sub: label(a), tone: 'green', record: { kind: 'proposal', id: a.entityId } };
      if (a.entityType === 'proposal' && to === 'Signed by Both Parties') return { ...base, label: 'Proposal signed', sub: label(a), tone: 'green', record: { kind: 'proposal', id: a.entityId } };
      if (a.entityType === 'agreement' && /^Signed/.test(to)) return { ...base, label: 'Agreement signed', sub: label(a), tone: 'green', record: { kind: 'agreement', id: a.entityId } };
      return null;
    case 'revision_sent': return { ...base, label: a.detail || 'Revision sent', sub: label(a), tone: 'accent', record: { kind: 'proposal', id: a.entityId } };
    case 'revision_requested': return { ...base, label: 'Client asked for changes', sub: label(a), tone: 'amber', record: { kind: 'proposal', id: a.entityId } };
    case 'completed': return a.entityType === 'task' ? { ...base, label: label(a) || 'Task', sub: 'Task completed', tone: 'green', record: { kind: 'task', id: a.entityId } } : null;
    case 'kept': return { ...base, label: label(a) || 'Promise', sub: 'Promise kept', tone: 'green', record: null };
    case 'note_added': return { ...base, label: 'Note logged', sub: (a.detail || '').slice(0, 120) || label(a), tone: 'muted', record: a.entityType === 'proposal' ? { kind: 'proposal', id: a.entityId } : null };
    case 'created':
      return a.entityType === 'opportunity' && daysBetween(date, today) <= 30 ? { ...base, label: `${label(a) || 'Opportunity'}`, sub: 'Opportunity created', tone: 'muted', record: { kind: 'opportunity', id: a.entityId } } : null;
    default: return null;
  }
}

/** What happened lately that matters: meetings held (with what was noted),
 * proposals sent or signed, agreements signed, notes, tasks done, promises
 * kept; newest first, five at most. */
export function dossierRecent(activity: ActivityEntry[], meetings: Pick<Meeting, 'id' | 'title' | 'meetingDate' | 'startAt' | 'isCancelled' | 'decisions' | 'discussion' | 'followUp' | 'actionItems'>[], today: string, limit = RECENT_LIMIT): RecentRow[] {
  const rows: RecentRow[] = [];
  for (const a of activity) {
    const r = meaningful(a, today);
    if (r && r.date <= today) rows.push(r);
  }
  for (const m of meetings) {
    if (m.isCancelled || !m.meetingDate || m.meetingDate >= today) continue;
    rows.push({ key: `meeting:${m.id}`, date: m.meetingDate, at: m.startAt || m.meetingDate, label: m.title, sub: meetingExcerpt(m), tone: 'muted', record: { kind: 'meeting', id: m.id } });
  }
  const seen = new Set<string>();
  return rows
    .sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key))
    .filter((r) => { const k = `${r.date}|${r.label}|${r.record?.kind}:${r.record?.id}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, limit);
}

/** "Today", "Yesterday", or "15 Sept". */
export function whenLabel(date: string, today: string): string {
  const d = daysBetween(date, today);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d === -1) return 'Tomorrow';
  return fmtDateShort(date);
}
