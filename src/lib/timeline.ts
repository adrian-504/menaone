// The timeline component: a "now" line with what happened above it and what's
// coming below — My Day's today list and every record's timeline use it.
// Rows come from recordTimeline.ts (records) or myday.ts (the day).

import { escHtml, fmtDate } from './utils';
import { icon } from './icons';
import { recordLink } from './links';
import { activityItem, renderFeed, type FeedItem } from './activityFeed';
import type { FutureRow, RecordTimeline } from './recordTimeline';

/** The "now" marker, shared by My Day and record timelines. */
export function nowLineHtml(label: string, cls = 'mdy-now'): string {
  return `<div class="${cls}"><span class="${cls}-time">${escHtml(label)}</span><span class="${cls}-line"></span></div>`;
}

const KIND_ICON: Record<FutureRow['kind'], string> = { meeting: 'meeting', task: 'check', commitment: 'flag', date: 'calendar' };

function futureRowHtml(r: FutureRow, today: string): string {
  const title = r.record && r.record.kind !== 'task' ? recordLink(r.record.kind, r.record.id, r.label) : escHtml(r.label);
  const when = r.date ? (r.date === today ? 'Today' : fmtDate(r.date)) + (r.time ? ` ${r.time}` : '') : '';
  const action = !r.action ? ''
    : r.action.kind === 'complete_task' ? `<button class="task-check" onclick="timelineAct('complete_task', ${r.action.id})" aria-label="Complete" title="Complete"></button>`
    : r.action.kind === 'mark_kept' ? `<button class="task-check" onclick="timelineAct('mark_kept', ${r.action.id})" aria-label="Mark kept" title="Mark kept"></button>`
    : '';
  return `<div class="tl-row${r.overdue ? ' is-overdue' : ''}" data-key="${escHtml(r.key)}">
    <span class="tl-when">${escHtml(when)}</span>
    ${action || `<span class="tl-icon">${icon(KIND_ICON[r.kind], 13)}</span>`}
    <div class="tl-main"><div class="tl-title">${r.record?.kind === 'task' ? `<a href="#" class="rlink" onclick="event.preventDefault();openRecord('task', ${r.record.id})">${escHtml(r.label)}</a>` : title}</div>
      ${r.sub ? `<div class="tl-sub">${escHtml(r.sub)}</div>` : ''}</div>
  </div>`;
}

export interface TimelineOptions {
  today: string;
  nowLabel: string;
  /** How many past rows to show (the newest); null for all. */
  pastLimit: number | null;
  /** onclick for "Show earlier". */
  showEarlier?: string;
  /** Dated history that isn't in the activity log (Company 360: proposal and agreement dates from before the log). */
  extraPast?: FeedItem[];
}

export function recordTimelineHtml(t: RecordTimeline, o: TimelineOptions): string {
  const all = [...t.past.map(activityItem), ...(o.extraPast || [])].filter((x) => x.at).sort((a, b) => b.at.localeCompare(a.at));
  const past = o.pastLimit == null ? all : all.slice(0, o.pastLimit);
  const hidden = all.length - past.length;
  const pastHtml = past.length
    ? `${hidden > 0 && o.showEarlier ? `<button class="mdy-more tl-earlier" onclick="${o.showEarlier}">Show ${hidden} earlier</button>` : ''}
       <div class="feed tl-past">${renderFeed(past, { oldestFirst: true, limit: past.length })}</div>`
    : '<div class="feed-empty tl-empty">Nothing recorded yet.</div>';
  const future = t.future.length ? `<div class="tl-future">${t.future.map((r) => futureRowHtml(r, o.today)).join('')}</div>` : '';
  const undated = t.undated.length ? `<div class="tl-group-hd">No date <span class="rcnt">${t.undated.length}</span></div><div class="tl-future">${t.undated.map((r) => futureRowHtml(r, o.today)).join('')}</div>` : '';
  const nothingAhead = !future && !undated ? '<div class="feed-empty tl-empty">Nothing coming up.</div>' : '';
  return `${pastHtml}${nowLineHtml(o.nowLabel, 'tl-now')}${future}${undated}${nothingAhead}`;
}
