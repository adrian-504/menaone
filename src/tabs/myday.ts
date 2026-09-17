// My Day: a plan for today. Timeline of meetings and tasks, one ranked list of
// what needs attention across the business, the week ahead, and a side rail
// with quick capture, the pipeline, watch items and recent activity.
// The rules live in lib/myday.ts; this file renders and handles actions.

import { renderOfficeStrip } from './officeStrip';
import { S } from '../lib/state';
import { companyLink, recordLink } from '../lib/links';
import { escHtml, expose, fmtDate, today } from '../lib/utils';
import { icon } from '../lib/icons';
import { registerTabRenderer, getActiveTabId } from '../lib/registry';
import { onChange } from '../lib/changes';
import { showContextMenu, type ContextMenuItem } from '../lib/contextMenu';
import { toast, undoToast } from '../lib/ui';
import { renderIcons } from '../core/chrome';
import { changeProposalStatus, snoozeProposal } from '../core/proposals';
import { addTaskFromText, deleteTodo, openDatePopover, quickAddTokensHtml, setTasksDue, toggleTodoDone } from './todo';
import { unprocessedInboxItems } from './inbox';
import { getActivity, getAppMeta, getIntelligenceItems, getPipelineFacts, ms365GetCachedEmails, setAppMeta } from '../lib/db';
import { activityItem } from '../lib/activityFeed';
import { ownDomains } from '../lib/clientMatch';
import { PS, activeMrr, addMoney, currencyOf, fmtMoneyByCurrency, teamMember, defaultReviewer, toReporting, fmtMoney, type MoneyByCurrency } from '../lib/commercial';
import { isOpenOpportunity, monthlyOf, weightedValue } from '../lib/pipeline';
import {
  buildAttention, buildComingUp, buildTimeline, greeting, summaryLine, addDays, isClientMeeting,
  type AttentionItem, type MyDayInput, type Timeline, type UpcomingDay,
} from '../lib/myday';
import type { IntelligenceItem, Meeting, Todo } from '../lib/types';

const w = window as any;
const ATTENTION_VISIBLE = 7;

let snoozed: Record<string, string> = {};
let snoozedLoaded = false;
let factsLoadedAt = 0;
let emailsLoaded = false;
let showAllAttention = false;
const openGroups = new Set<string>();
let attentionByKey = new Map<string, AttentionItem>();

// ── Data ────────────────────────────────────────────────────────────────────

function hhmm(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function input(): MyDayInput {
  const reviewer = defaultReviewer()?.name || 'the reviewer';
  return {
    today: today(), now: new Date(),
    proposals: S.proposals, opportunities: S.opportunities, pipelineFacts: S.pipelineFacts, agreements: S.agreements,
    meetings: S.meetings, todos: S.todos, projects: S.projects, emails: S.emails, inboxCount: unprocessedInboxItems().length,
    reviewerName: (p) => teamMember(p.reviewerId)?.name || reviewer,
    ownDomains: ownDomains(), snoozed,
  };
}

/** Loads what My Day needs that other tabs normally load on their own visit. */
async function ensureData(): Promise<boolean> {
  let changed = false;
  const jobs: Promise<void>[] = [];
  if (!snoozedLoaded) {
    jobs.push(getAppMeta('myday_snoozed').then((v) => {
      snoozedLoaded = true;
      try { snoozed = v ? JSON.parse(v) : {}; } catch { snoozed = {}; }
      const t = today();
      for (const [k, until] of Object.entries(snoozed)) if (until <= t) delete snoozed[k];
      changed = true;
    }).catch(() => { snoozedLoaded = true; }));
  }
  if (Date.now() - factsLoadedAt > 5 * 60_000) {
    factsLoadedAt = Date.now();
    jobs.push(getPipelineFacts().then((f) => { S.pipelineFacts = f; changed = true; }).catch(() => undefined));
  }
  if (!emailsLoaded && S.ms365Status?.status === 'connected') {
    emailsLoaded = true;
    if (!S.emails.length) jobs.push(ms365GetCachedEmails().then((e) => { S.emails = e; changed = true; }).catch(() => undefined));
  }
  await Promise.all(jobs);
  return changed;
}

// ── Render ──────────────────────────────────────────────────────────────────

export function renderMyDay(): void {
  const data = input();
  const timeline = buildTimeline(data);
  const attention = buildAttention(data);
  attentionByKey = new Map();
  for (const a of attention) { attentionByKey.set(a.key, a); a.children?.forEach((c) => attentionByKey.set(c.key, c)); }

  const now = data.now;
  setHtml('myday-greeting', escHtml(`${greeting(now)}${firstName() ? `, ${firstName()}` : ''}`));
  renderOfficeStrip();
  setHtml('myday-date', `${escHtml(now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}<span class="mdy-dot">·</span>${escHtml(summaryLine(timeline, attention))}`);
  setHtml('myday-today', todayHtml(timeline, data));
  setHtml('myday-attention-cnt', attention.length ? String(attention.length) : '');
  setHtml('myday-attention', attentionHtml(attention));
  setHtml('myday-upcoming', upcomingHtml(buildComingUp(data)));
  setHtml('myday-pipeline', pipelineHtml());
  const root = document.getElementById('tab-myday');
  if (root) renderIcons(root);

  void ensureData().then((changed) => { if (changed && getActiveTabId() === 'myday') renderMyDay(); });
  void loadIntel();
  void loadActivity();
}
registerTabRenderer('myday', renderMyDay);

/** One line for the morning notification, e.g. "3 meetings · 2 tasks due · 4 need attention". */
export function mydaySummaryText(): string {
  const data = input();
  const attention = buildAttention(data);
  const line = summaryLine(buildTimeline(data), attention);
  const top = attention[0];
  return top ? `${line} · First: ${top.title} — ${top.reason}` : line;
}
expose('renderMyDay', renderMyDay);

function setHtml(id: string, html: string): void {
  const el = document.getElementById(id);
  if (el && el.innerHTML !== html) el.innerHTML = html;
}

function firstName(): string {
  const n = S.ms365Status?.displayName?.trim();
  return n ? n.split(/\s+/)[0] : '';
}

// ── Today ───────────────────────────────────────────────────────────────────

function taskRow(t: Todo, opts: { overdue?: boolean } = {}): string {
  const done = t.status === 'Done';
  const project = t.projectId != null ? S.projects.find((p) => p.id === t.projectId) : null;
  const meta = [
    opts.overdue && t.dueDate ? `<span class="t-red">${escHtml(fmtDate(t.dueDate))}</span>` : '',
    t.client ? companyLink(t.companyId, t.client) : '',
    project ? recordLink('project', project.id, project.name) : '',
  ].filter(Boolean).join('<span class="mdy-sep">·</span>');
  return `<div class="mdy-task task-row${done ? ' is-done' : ''}" data-task-id="${t.id}" oncontextmenu="todoContextMenu(event, ${t.id})">
    <button class="task-check${done ? ' checked' : ''}${t.priority === 'High' ? ' pri-high' : ''}" onclick="mydayToggleTask(${t.id})" aria-label="${done ? 'Mark as not done' : 'Complete'}"></button>
    <div class="mdy-task-main" onclick="openRecord('task', ${t.id})">
      <div class="mdy-task-title">${escHtml(t.title)}</div>
      ${meta ? `<div class="mdy-meta">${meta}</div>` : ''}
    </div>
    ${done ? '' : `<div class="mdy-row-actions">
      ${opts.overdue ? `<button class="btn-sm mdy-mini" onclick="mydayMoveTask(${t.id}, 0)">Today</button>` : ''}
      <button class="btn-sm mdy-mini" onclick="mydayMoveTask(${t.id}, 1)">Tomorrow</button>
      <button class="rec-icon-btn" onclick="mydayTaskDate(event, ${t.id})" title="Pick a date" aria-label="Pick a date">${icon('calendar', 13)}</button>
    </div>`}
  </div>`;
}

function meetingRow(m: Meeting, past: boolean, current: boolean, own: Set<string>): string {
  const client = isClientMeeting(m, own);
  const needsNotes = past && !(m.discussion || m.decisions || m.actionItems) && client;
  const where = [m.companyName ? companyLink(m.companyId, m.companyName) : '', m.location && !/microsoft teams/i.test(m.location) ? escHtml(m.location) : '', m.isOnlineMeeting ? 'Teams' : '']
    .filter(Boolean).join('<span class="mdy-sep">·</span>');
  return `<div class="mdy-slot-body">
      <div class="mdy-meeting-title">${recordLink('meeting', m.id, m.title)}${current ? ' <span class="rec-badge tone-green">Now</span>' : ''}</div>
      ${where ? `<div class="mdy-meta">${where}</div>` : ''}
    </div>
    <div class="mdy-row-actions">
      ${m.onlineMeetingUrl && !past ? `<button class="btn-sm mdy-mini${current ? ' mdy-join' : ''}" onclick="mydayJoin(${m.id})">${icon('meeting', 12)} Join</button>` : ''}
      ${!past && client ? `<button class="btn-sm mdy-mini" onclick="openRecord('meeting', ${m.id})">${m.agenda ? 'Brief' : 'Prepare'}</button>` : ''}
      ${needsNotes ? `<button class="btn-sm mdy-mini" onclick="openRecord('meeting', ${m.id})">${icon('note', 12)} Add notes</button>` : ''}
    </div>`;
}

function todayHtml(t: Timeline, data: MyDayInput): string {
  const parts: string[] = [];
  if (t.overdue.length) {
    parts.push(`<div class="mdy-group-hd"><span class="t-red">${icon('warning', 12)} Overdue</span><span class="rcnt">${t.overdue.length}</span>
      <button class="btn-sm mdy-mini mdy-hd-action" onclick="mydayMoveOverdue()">Move all to today</button></div>
      <div class="mdy-tasks">${t.overdue.slice(0, 8).map((x) => taskRow(x, { overdue: true })).join('')}</div>
      ${t.overdue.length > 8 ? `<button class="mdy-more" onclick="navToModule('todo')">${t.overdue.length - 8} more in Tasks</button>` : ''}`);
  }
  if (t.allDay.length) {
    parts.push(`<div class="mdy-allday">${t.allDay.map((m) => `<span class="chip">${icon('calendar', 11)} ${recordLink('meeting', m.id, m.title)}</span>`).join('')}</div>`);
  }
  if (t.timed.length) {
    parts.push(`<div class="mdy-timeline">${t.timed.map((e) => {
      if (e.type === 'now') return `<div class="mdy-now"><span class="mdy-now-time">${escHtml(hhmm(e.at))}</span><span class="mdy-now-line"></span></div>`;
      if (e.type === 'meeting') {
        return `<div class="mdy-slot${e.past ? ' is-past' : ''}${e.current ? ' is-current' : ''}">
          <div class="mdy-time">${escHtml(hhmm(e.meeting.startAt))}<span>${escHtml(hhmm(e.meeting.endAt))}</span></div>
          <span class="mdy-slot-dot kind-meeting"></span>
          ${meetingRow(e.meeting, e.past, e.current, data.ownDomains)}
        </div>`;
      }
      return `<div class="mdy-slot${e.past && e.task.status !== 'Done' ? ' is-late' : ''}">
        <div class="mdy-time">${escHtml(e.task.dueTime || '')}</div>
        <span class="mdy-slot-dot kind-task"></span>
        ${taskRow(e.task)}
      </div>`;
    }).join('')}</div>`);
  }
  if (t.anytime.length) {
    const open = t.anytime.filter((x) => x.status !== 'Done').length;
    parts.push(`<div class="mdy-group-hd"><span>${icon('check', 12)} ${t.timed.length ? 'Also today' : 'Tasks for today'}</span><span class="rcnt">${open}</span></div>
      <div class="mdy-tasks">${t.anytime.map((x) => taskRow(x)).join('')}</div>`);
  }
  if (!parts.length) {
    return `<div class="mdy-empty">${icon('sun', 18)}<div><strong>A clear day.</strong> No meetings or tasks due today — add one below, or pick something from the list on the right.</div></div>`;
  }
  return parts.join('');
}

// ── Attention ───────────────────────────────────────────────────────────────

const KIND_ICON: Record<AttentionItem['kind'], string> = {
  proposal: 'database', review: 'check', followup: 'repeat', opportunity: 'briefcase', agreement: 'document',
  meeting: 'meeting', project: 'target', email: 'mail', inbox: 'inbox',
};

function attentionRow(a: AttentionItem, child = false): string {
  const isGroup = !!a.children?.length;
  const open = openGroups.has(a.key);
  const title = a.record ? recordLink(a.record.kind, a.record.id, a.title) : escHtml(a.title);
  const company = a.companyName && a.companyName !== a.title && !child ? `<span class="mdy-sep">·</span>${companyLink(a.companyId, a.companyName)}` : '';
  return `<div class="mdy-att${child ? ' is-child' : ''} tone-${a.tone}" data-key="${escHtml(a.key)}">
    ${child ? '' : `<span class="mdy-att-icon">${icon(KIND_ICON[a.kind], 14)}</span>`}
    <div class="mdy-att-main"${isGroup ? ` onclick="mydayToggleGroup('${escHtml(a.key)}')"` : ''}>
      <div class="mdy-att-title">${isGroup ? `<span class="mdy-chev${open ? ' open' : ''}">${icon('chevronRight', 12)}</span>` : ''}${title}${company}</div>
      <div class="mdy-att-reason">${escHtml(a.reason)}</div>
    </div>
    ${a.when ? `<span class="mdy-when">${escHtml(a.when)}</span>` : ''}
    <div class="mdy-att-actions">
      <button class="btn-sm mdy-mini${a.tone === 'red' && !child ? ' mdy-primary' : ''}" onclick="mydayAct('${escHtml(a.key)}')">${escHtml(a.action.label)}</button>
      <button class="rec-icon-btn" onclick="mydayItemMenu(event, '${escHtml(a.key)}')" title="More" aria-label="More">${icon('more', 14)}</button>
    </div>
  </div>
  ${isGroup && open ? `<div class="mdy-att-children">${a.children!.slice(0, 25).map((c) => attentionRow(c, true)).join('')}${a.children!.length > 25 ? `<button class="mdy-more" onclick="mydayAct('${escHtml(a.key)}')">${a.children!.length - 25} more</button>` : ''}</div>` : ''}`;
}

function attentionHtml(items: AttentionItem[]): string {
  if (!items.length) return `<div class="mdy-empty">${icon('check', 18)}<div><strong>All clear.</strong> No proposals, renewals, meetings or deals need you right now.</div></div>`;
  const visible = showAllAttention ? items : items.slice(0, ATTENTION_VISIBLE);
  const hidden = items.length - visible.length;
  return `<div class="mdy-att-list">${visible.map((a) => attentionRow(a)).join('')}</div>
    ${hidden > 0 ? `<button class="mdy-more" onclick="mydayShowAll(true)">Show ${hidden} more</button>` : items.length > ATTENTION_VISIBLE ? `<button class="mdy-more" onclick="mydayShowAll(false)">Show fewer</button>` : ''}`;
}

export function mydayToggleGroup(key: string): void {
  if (openGroups.has(key)) openGroups.delete(key); else openGroups.add(key);
  renderMyDay();
}
expose('mydayToggleGroup', mydayToggleGroup);

export function mydayShowAll(on: boolean): void {
  showAllAttention = on;
  renderMyDay();
}
expose('mydayShowAll', mydayShowAll);

export async function mydayAct(key: string): Promise<void> {
  const a = attentionByKey.get(key);
  if (!a) return;
  const open = () => { if (a.record) w.openRecord(a.record.kind, a.record.id); };
  switch (a.action.kind) {
    case 'send_to_client':
      if (a.record && await changeProposalStatus(a.record.id, PS.SENT)) toast(`${a.title} marked as sent to the client`);
      renderMyDay();
      return;
    case 'start_drafting':
      if (a.record && await changeProposalStatus(a.record.id, PS.DRAFTING)) open();
      return;
    case 'open_followups': w.navToModule('followup'); return;
    case 'open_review_queue': w.navToModule('pending'); return;
    case 'open_opportunities': w.navToModule('opportunities'); return;
    case 'open_action_required': w.navToModule('action-required'); return;
    case 'open_inbox': w.navToModule('inbox'); return;
    case 'open_cleanup': w.openCleanup(a.action.queue); return;
    default: open();
  }
}
expose('mydayAct', mydayAct);

function saveSnoozed(): void {
  void setAppMeta('myday_snoozed', JSON.stringify(snoozed)).catch(() => undefined);
}

function snooze(key: string, days: number, label: string): void {
  const before = snoozed[key];
  snoozed[key] = addDays(today(), days);
  saveSnoozed();
  renderMyDay();
  undoToast(`Hidden ${label}`, () => {
    if (before) snoozed[key] = before; else delete snoozed[key];
    saveSnoozed();
    renderMyDay();
  });
}

export function mydayItemMenu(e: MouseEvent, key: string): void {
  const a = attentionByKey.get(key);
  if (!a) return;
  const items: ContextMenuItem[] = [];
  if (a.record) items.push({ label: 'Open', iconName: 'edit', run: () => w.openRecord(a.record!.kind, a.record!.id) });
  if (a.companyId != null) items.push({ label: 'Open company', iconName: 'building', run: () => w.openRecord('company', a.companyId!) });
  if (a.kind === 'followup' && a.record) {
    items.push({ label: 'Snooze follow-up for a week', iconName: 'clock', run: () => { snoozeProposal(a.record!.id, 7); renderMyDay(); } });
  }
  if (items.length) items.push({ label: '', run: () => {}, separator: true });
  items.push(
    { label: 'Hide until tomorrow', iconName: 'moon', run: () => snooze(key, 1, 'until tomorrow') },
    { label: 'Hide for a week', iconName: 'archive', run: () => snooze(key, 7, 'for a week') },
  );
  showContextMenu(e, items);
}
expose('mydayItemMenu', mydayItemMenu);

// ── Coming up ───────────────────────────────────────────────────────────────

const UPCOMING_ICON: Record<string, string> = { meeting: 'meeting', task: 'check', agreement: 'document', opportunity: 'briefcase', project: 'target', proposal: 'database' };

function dayName(iso: string): string {
  if (iso === addDays(today(), 1)) return 'Tomorrow';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long' });
}

function upcomingHtml(days: UpcomingDay[]): string {
  if (!days.length) return `<div class="mdy-empty compact">Nothing scheduled for the next 7 days.</div>`;
  return days.map((d) => `<div class="mdy-day">
    <div class="mdy-day-hd"><strong>${escHtml(dayName(d.date))}</strong><span>${escHtml(new Date(`${d.date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</span></div>
    ${d.entries.slice(0, 8).map((e) => `<div class="mdy-up" onclick="openRecord('${e.record.kind}', ${e.record.id})">
      <span class="mdy-up-time">${e.time ? escHtml(e.time) : icon(UPCOMING_ICON[e.kind] || 'calendar', 12)}</span>
      <span class="mdy-up-title">${escHtml(e.title)}</span>
      <span class="mdy-up-detail">${escHtml(e.detail)}</span>
    </div>`).join('')}
    ${d.entries.length > 8 ? `<div class="mdy-up-more">+${d.entries.length - 8} more</div>` : ''}
  </div>`).join('');
}

// ── Rail ────────────────────────────────────────────────────────────────────

function stat(label: string, value: string, sub: string, onclick: string): string {
  return `<button class="mdy-stat" onclick="${onclick}"><span class="mdy-stat-label">${escHtml(label)}</span><span class="mdy-stat-value">${escHtml(value)}</span><span class="mdy-stat-sub">${escHtml(sub)}</span></button>`;
}

function pipelineHtml(): string {
  const open = S.opportunities.filter(isOpenOpportunity);
  const value: MoneyByCurrency = {};
  const weighted: MoneyByCurrency = {};
  for (const o of open) { addMoney(value, o.currency || 'SAR', o.estimatedValue); addMoney(weighted, o.currency || 'SAR', weightedValue(o)); }
  const withValue = open.filter((o) => o.estimatedValue != null).length;
  const sent = S.proposals.filter((p) => !p.archived && p.status === PS.SENT);
  const sentMonthly: MoneyByCurrency = {};
  for (const p of sent) addMoney(sentMonthly, currencyOf(p), monthlyOf(p));
  const mrr = activeMrr();
  const active = S.agreements.filter((a) => a.serviceStatus === 'Active').length;
  const month = today().slice(0, 7);
  const wonThisMonth = S.proposals.filter((p) => p.status === PS.WON && (p.dateSigned || p.dblSignedDate || '').startsWith(month)).length;
  const money = (m: MoneyByCurrency) => (Object.values(m).some((v) => v) ? fmtMoneyByCurrency(m) : '—');
  const reporting = (m: MoneyByCurrency) => (Object.keys(m).length > 1 ? `≈ ${fmtMoney(toReporting(m))} total` : '');
  return `<div class="mdy-stats">
    ${stat('Open pipeline', money(value), withValue < open.length ? `${open.length} open · ${open.length - withValue} without a value` : `${open.length} open ${open.length === 1 ? 'opportunity' : 'opportunities'}`, "navToModule('opportunities')")}
    ${stat('Weighted', money(weighted), reporting(weighted) || 'Value × probability', "navToModule('analytics')")}
    ${stat('Proposals out', String(sent.length), Object.values(sentMonthly).some((v) => v) ? `${fmtMoneyByCurrency(sentMonthly)} / month` : 'Waiting on the client', "navToModule('followup')")}
    ${stat('Active MRR', money(mrr), `${active} active ${active === 1 ? 'agreement' : 'agreements'}${wonThisMonth ? ` · ${wonThisMonth} won this month` : ''}`, "navToModule('agreements')")}
  </div>`;
}

async function loadIntel(): Promise<void> {
  let items: IntelligenceItem[] = [];
  try {
    items = (await getIntelligenceItems())
      .filter((i) => i.importance === 'critical' || i.importance === 'important')
      .sort((a, b) => (a.importance === b.importance ? 0 : a.importance === 'critical' ? -1 : 1))
      .slice(0, 4);
  } catch { /* shown as empty */ }
  const card = document.getElementById('myday-watch-card');
  if (card) card.hidden = items.length === 0;
  setHtml('myday-watch', items.map((i) => `<div class="mdy-rail-row" onclick="navToModule('intelligence');openIntelModal(${i.id})">
    <span class="mdy-pill tone-${i.importance === 'critical' ? 'red' : 'amber'}"></span>
    <div><div class="mdy-rail-title">${escHtml(i.headline)}</div><div class="mdy-meta">${i.kind === 'regulatory' ? 'Regulatory' : 'Business'} · ${escHtml(i.importance)}</div></div>
  </div>`).join(''));
}

async function loadActivity(): Promise<void> {
  const entries = await getActivity({ limit: 8 }).catch(() => []);
  const el = document.getElementById('myday-activity');
  if (!el) return;
  const html = entries.length
    ? entries.map((a) => {
        const f = activityItem(a);
        const at = a.createdAt.length > 10 ? new Date(a.createdAt) : null;
        const when = at && !isNaN(at.getTime())
          ? (a.createdAt.slice(0, 10) === today() ? hhmm(a.createdAt) : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))
          : fmtDate(a.createdAt);
        return `<div class="mdy-act"><span class="feed-icon feed-${f.tone || 'muted'}">${icon(f.iconName, 11)}</span><div class="mdy-act-line">${f.html}</div><span class="mdy-act-when">${escHtml(when)}</span></div>`;
      }).join('')
    : `<div class="mdy-empty compact">Nothing logged yet.</div>`;
  if (el.innerHTML !== html) el.innerHTML = html;
}

// ── Actions ─────────────────────────────────────────────────────────────────

export function mydayToggleTask(id: number): void {
  const t = S.todos.find((x) => x.id === id);
  if (!t) return;
  const wasOpen = t.status !== 'Done';
  toggleTodoDone(id);
  renderMyDay();
  if (wasOpen) undoToast(`Completed "${t.title}"`, () => { toggleTodoDone(id); renderMyDay(); });
}
expose('mydayToggleTask', mydayToggleTask);
// Kept for older inline handlers.
expose('toggleTodoDoneFromMyDay', mydayToggleTask);

export function mydayMoveTask(id: number, days: number): void {
  const t = S.todos.find((x) => x.id === id);
  if (!t) return;
  const before = t.dueDate;
  setTasksDue([id], addDays(today(), days));
  renderMyDay();
  undoToast(`Moved "${t.title}" to ${days === 0 ? 'today' : 'tomorrow'}`, () => { setTasksDue([id], before); renderMyDay(); });
}
expose('mydayMoveTask', mydayMoveTask);

export function mydayMoveOverdue(): void {
  const overdue = buildTimeline(input()).overdue;
  if (!overdue.length) return;
  const before = overdue.map((t) => [t.id, t.dueDate] as const);
  setTasksDue(overdue.map((t) => t.id), today());
  renderMyDay();
  undoToast(`Moved ${overdue.length} overdue ${overdue.length === 1 ? 'task' : 'tasks'} to today`, () => {
    for (const [id, d] of before) setTasksDue([id], d);
    renderMyDay();
  });
}
expose('mydayMoveOverdue', mydayMoveOverdue);

export function mydayTaskDate(e: MouseEvent, id: number): void {
  const row = (e.currentTarget as HTMLElement).closest<HTMLElement>('.task-row');
  if (row) openDatePopover(row, [id]);
}
expose('mydayTaskDate', mydayTaskDate);

export function mydayJoin(id: number): void {
  const url = S.meetings.find((m) => m.id === id)?.onlineMeetingUrl;
  if (!url) return;
  void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url)).catch(() => window.open(url, '_blank'));
}
expose('mydayJoin', mydayJoin);

export function mydayCapturePreview(): void {
  const input = document.getElementById('myday-capture-input') as HTMLInputElement | null;
  setHtml('myday-capture-preview', input ? quickAddTokensHtml(input.value) : '');
}
expose('mydayCapturePreview', mydayCapturePreview);

export function mydayCapture(e: Event): void {
  e.preventDefault();
  const input = document.getElementById('myday-capture-input') as HTMLInputElement | null;
  const raw = input?.value.trim();
  if (!raw || !input) return;
  const task = addTaskFromText(raw, { dueDate: today() });
  if (!task) return;
  input.value = '';
  mydayCapturePreview();
  renderMyDay();
  const where = task.someday ? 'Someday' : !task.dueDate ? 'Anytime' : task.dueDate === today() ? 'today' : fmtDate(task.dueDate);
  undoToast(`Added "${task.title}" to ${where}`, () => { deleteTodo(task.id, { silent: true }); renderMyDay(); });
}
expose('mydayCapture', mydayCapture);

export function mydayCaptureKey(e: KeyboardEvent): void {
  // Handled here rather than by implicit form submission, which not every
  // WebView fires for synthesized keys.
  if (e.key === 'Enter' && !e.isComposing) { mydayCapture(e); return; }
  if (e.key !== 'Escape') return;
  const input = e.target as HTMLInputElement;
  if (input.value) { input.value = ''; mydayCapturePreview(); } else input.blur();
  e.stopPropagation();
}
expose('mydayCaptureKey', mydayCaptureKey);

// ── Live updates ────────────────────────────────────────────────────────────

let pending: ReturnType<typeof setTimeout> | null = null;
onChange(() => {
  if (getActiveTabId() !== 'myday') return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => { pending = null; renderMyDay(); }, 120);
});

// The "now" line and meeting states move with the clock.
setInterval(() => {
  if (getActiveTabId() === 'myday' && !document.hidden) renderMyDay();
}, 60_000);
