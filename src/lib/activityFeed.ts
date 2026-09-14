// Activity feed: renders unified activity entries (and any extra dated events
// a page wants to mix in) as a timeline grouped by day, each entry a sentence
// with a link to the record it's about.

import { escHtml, fmtDate } from './utils';
import { icon } from './icons';
import { recordLink } from './links';
import type { ActivityEntry } from './types';
import type { RecordKind } from './navHistory';

export interface FeedItem {
  /** ISO timestamp or YYYY-MM-DD. */
  at: string;
  iconName: string;
  tone?: 'green' | 'amber' | 'red' | 'accent' | 'muted';
  /** Sentence as HTML (already escaped). */
  html: string;
  detail?: string | null;
}

const ENTITY_ICON: Record<string, string> = {
  proposal: 'database', agreement: 'document', contact: 'people', task: 'check', note: 'note',
  meeting: 'meeting', opportunity: 'briefcase', project: 'target', company: 'building',
};
const ENTITY_NOUN: Record<string, string> = {
  proposal: 'Proposal', agreement: 'Agreement', contact: 'Contact', task: 'Task', note: 'Note',
  meeting: 'Meeting', opportunity: 'Opportunity', project: 'Project', company: 'Company',
};
const LINKABLE = new Set(['proposal', 'agreement', 'contact', 'task', 'note', 'meeting', 'opportunity', 'project', 'company']);

function subject(a: ActivityEntry): string {
  const label = a.entityLabel || ENTITY_NOUN[a.entityType] || 'Record';
  if (a.action === 'deleted' || !LINKABLE.has(a.entityType)) return `<strong>${escHtml(label)}</strong>`;
  return recordLink(a.entityType as RecordKind, a.entityId, label);
}

/** One activity entry as a feed item. */
export function activityItem(a: ActivityEntry): FeedItem {
  const noun = ENTITY_NOUN[a.entityType] || 'Record';
  const s = subject(a);
  const base = { at: a.createdAt, iconName: ENTITY_ICON[a.entityType] || 'clock' };
  switch (a.action) {
    case 'created': {
      const verb = a.entityType === 'contact' ? 'added' : a.entityType === 'meeting' ? 'scheduled' : 'created';
      return { ...base, tone: 'accent', html: `${noun} ${verb} · ${s}`, detail: a.entityType === 'proposal' || a.entityType === 'agreement' ? a.detail : a.entityType === 'contact' ? a.detail : null };
    }
    case 'status_changed': return { ...base, tone: 'amber', html: `${noun} status changed · ${s}`, detail: a.detail };
    case 'stage_changed': return { ...base, tone: 'amber', html: `Opportunity moved · ${s}`, detail: a.detail };
    case 'completed': return { ...base, tone: 'green', iconName: 'check', html: `Task completed · ${s}` };
    case 'note_added': return { ...base, tone: 'accent', iconName: 'note', html: `Note logged on ${s}`, detail: a.detail };
    case 'updated': return { ...base, tone: 'muted', html: `${noun} edited · ${s}` };
    case 'deleted': return { ...base, tone: 'red', iconName: 'trash', html: `${noun} deleted · ${s}` };
    case 'proposal_linked': return { ...base, tone: 'accent', html: `Proposal linked to ${s}`, detail: a.detail };
    case 'project_created': return { ...base, tone: 'green', html: `Project started from ${s}`, detail: a.detail };
    default: return { ...base, tone: 'muted', html: `${noun} · ${s}`, detail: a.detail || a.action.replace(/_/g, ' ') };
  }
}

function dayKey(at: string): string { return at.slice(0, 10); }

function dayLabel(day: string): string {
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (day === iso(today)) return 'Today';
  const y = new Date(today); y.setDate(y.getDate() - 1);
  if (day === iso(y)) return 'Yesterday';
  return fmtDate(day);
}

function timeOf(at: string): string {
  if (at.length <= 10) return '';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Timeline HTML, newest first, grouped by day. */
export function renderFeed(items: FeedItem[], opts: { empty?: string; limit?: number } = {}): string {
  const sorted = items.filter((i) => i.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, opts.limit ?? 200);
  if (!sorted.length) return `<div class="feed-empty">${escHtml(opts.empty || 'Nothing has happened here yet.')}</div>`;
  let html = '';
  let current = '';
  for (const item of sorted) {
    const day = dayKey(item.at);
    if (day !== current) {
      if (current) html += '</div>';
      current = day;
      html += `<div class="feed-day"><div class="feed-day-label">${escHtml(dayLabel(day))}</div>`;
    }
    const time = timeOf(item.at);
    html += `<div class="feed-item">
      <span class="feed-icon feed-${item.tone || 'muted'}">${icon(item.iconName, 12)}</span>
      <div class="feed-body">
        <div class="feed-line">${item.html}${time ? `<span class="feed-time">${time}</span>` : ''}</div>
        ${item.detail ? `<div class="feed-detail">${escHtml(item.detail)}</div>` : ''}
      </div>
    </div>`;
  }
  return html + '</div>';
}
