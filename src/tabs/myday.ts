// My Day: a plan for today. What's on now, one ranked list of what needs you,
// then today's timeline; beside it (1.57 "focus") the proposals in play, the
// next seven days, and anything regulatory that's critical.
// The rules live in lib/myday.ts; this file renders and handles actions.

import { settleNew } from '../lib/motion';
import { stripCompanyToken } from '../lib/commitments';
import { setCommitmentKept, readCommitmentsFrom } from './commitments';
import { parseTaskInput } from '../lib/taskParse';
import { EMPTY_CONTEXT } from '../lib/workGraph';
import { renderOfficeStrip } from './officeStrip';
import { standLine } from './companyState';
import { OFFICE_BAND, bandPhotoUrl, dayPart, displayName, scrimFor } from '../lib/appearance';
import { nowLineHtml } from '../lib/timeline';
import { S } from '../lib/state';
import { companyLink, recordLink } from '../lib/links';
import { escHtml, expose, fmtDate, today, fmtDayLong, fmtWeekday, fmtDateShort, fmtTime } from '../lib/utils';
import { icon } from '../lib/icons';
import { registerTabRenderer, getActiveTabId } from '../lib/registry';
import { onChange } from '../lib/changes';
import { showContextMenu, type ContextMenuItem } from '../lib/contextMenu';
import { deferWhileHovered, toast, undoToast } from '../lib/ui';
import { renderIcons } from '../core/chrome';
import { changeProposalStatus, contactFirstName, nudgeReview, snoozeProposal } from '../core/proposals';
import { addTaskFromText, deleteTodo, openDatePopover, quickAddTokensHtml, setTasksDue, toggleTodoDone } from './todo';
import { unprocessedInboxItems } from './inbox';
import { getAppMeta, getIntelligenceItems, getPipelineFacts, ms365GetCachedEmails, setAppMeta } from '../lib/db';
import { buildInPlay, buildComingUpFocus, regulatoryNotes, STAGE_LABEL, STAGE_ORDER, type ComingDay, type ComingItem, type InPlay, type PlayRow } from '../lib/mydayFocus';
import { briefInputFor } from './companyState';
import { companyContact, companyRecords } from '../lib/companyBrief';
import { initialsOf } from '../lib/appearance';
import { ownDomains } from '../lib/clientMatch';
import { PS, teamMember, defaultReviewer, isAgreementActive, isOpenProposal } from '../lib/commercial';
import { strColor } from '../lib/utils';
import { followUpMenu } from '../core/proposals';
import {
  buildAttention, buildTimeline, shownAttentionKeys, personName, greeting, summaryLine, addDays, isClientMeeting, buildIndex, nowMeeting,
  type AttentionItem, type MyDayInput, type Timeline, type QuietClient,
} from '../lib/myday';
import type { IntelligenceItem, Meeting, Todo } from '../lib/types';
import { daysBetween } from '../lib/pipeline';

const w = window as any;
const ATTENTION_VISIBLE = 8;

let snoozed: Record<string, string> = {};
let snoozedLoaded = false;
let factsLoadedAt = 0;
let emailsLoaded = false;
let showAllAttention = false;
const openGroups = new Set<string>();
let attentionByKey = new Map<string, AttentionItem>();

// ── Data ────────────────────────────────────────────────────────────────────

function hhmm(iso: string | null | undefined): string {
  return fmtTime(iso);
}

function input(): MyDayInput {
  const reviewer = defaultReviewer()?.name || 'the reviewer';
  return {
    today: today(), now: new Date(),
    proposals: S.proposals, opportunities: S.opportunities, pipelineFacts: S.pipelineFacts, agreements: S.agreements,
    meetings: S.meetings, todos: S.todos, projects: S.projects, emails: S.emails, inboxCount: unprocessedInboxItems().length,
    commitments: S.commitments, companies: S.companies, touches: S.touches, contactName: contactFirstName,
    integrityFailed: S.housekeeping?.integrity?.ok === false,
    reviewerName: (p) => teamMember(p.reviewerId)?.name || reviewer,
    ownDomains: ownDomains(), snoozed, quietClients: quietClients(), nameOf: attendeeName, railOwnsProposals: true,
  };
}

/** An attendee as a name: the contact with that email, else the email's name part, capitalised. */
function attendeeName(a: string): string {
  const email = a.trim().toLowerCase();
  const c = email.includes('@') ? S.contacts.find((x) => (x.email || '').toLowerCase() === email) : null;
  return c?.name || personName(a);
}

/** Active clients (a running agreement or an open proposal) and when we last met, emailed or called them. */
function quietClients(): QuietClient[] {
  const t = today();
  const ids = new Set<number>();
  for (const a of S.agreements) if (a.companyId != null && isAgreementActive(a, t)) ids.add(a.companyId);
  for (const p of S.proposals) if (p.companyId != null && !p.archived && isOpenProposal(p)) ids.add(p.companyId);
  const out: QuietClient[] = [];
  for (const id of ids) {
    const c = S.companies.find((x) => x.id === id);
    if (!c) continue;
    const bi = briefInputFor({ id, name: c.name });
    const r = companyRecords(bi);
    const { lastContact } = companyContact(bi, r);
    const service = r.clientAgreements.flatMap((a) => (a.lines?.length ? a.lines.map((l) => l.serviceName) : [a.type || ''])).filter(Boolean)[0]
      || r.proposals.find((p) => isOpenProposal(p))?.type || null;
    out.push({ companyId: id, name: c.name, lastContact, days: lastContact ? daysBetween(lastContact, t) : null, service: service ? service.toLowerCase() : null });
  }
  return out;
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

/** Attention first: a promise's task leaves Today only when its row is on screen. */
function inputWithShown(): { data: MyDayInput; attention: AttentionItem[] } {
  const data = input();
  const attention = buildAttention(data);
  return { data: { ...data, attentionShown: shownAttentionKeys(attention, showAllAttention ? null : ATTENTION_VISIBLE) }, attention };
}

export function renderMyDay(): void {
  const { data, attention } = inputWithShown();
  const timeline = buildTimeline(data);
  attentionByKey = new Map();
  for (const a of attention) { attentionByKey.set(a.key, a); a.children?.forEach((c) => attentionByKey.set(c.key, c)); }

  const now = data.now;
  setHtml('myday-greeting', escHtml(`${greeting(now)}${firstName() ? `, ${firstName()}` : ''}.`));
  renderOfficeStrip();
  setHtml('myday-date', escHtml(fmtDayLong(now, true).replace(',', '')));
  paintBand(now);
  const inPlay = buildInPlay(S.proposals, { emails: data.emails, meetings: data.meetings, today: data.today, ownDomains: data.ownDomains, touches: data.touches, contactName: data.contactName });
  setHtml('myday-index', indexHtml(buildIndex(timeline, attention, inPlay.total)));
  const nowPick = nowMeeting(timeline);
  setHtml('myday-now', nowPick ? nowPanelHtml(nowPick.meeting, nowPick.current) : '');
  const nowSec = document.getElementById('myday-now-sec'); if (nowSec) nowSec.hidden = !nowPick;
  setHtml('myday-today', todayHtml(timeline, data));
  setHtml('myday-attention-cnt', attention.length ? String(attention.length).padStart(2, '0') : '');
  setHtml('myday-attention', attentionHtml(attention));
  setHtml('myday-inplay', inPlayHtml(inPlay));
  setHtml('myday-inplay-cnt', inPlay.total ? String(inPlay.total).padStart(2, '0') : '');
  const playSec = document.getElementById('myday-inplay-sec'); if (playSec) playSec.hidden = !inPlay.total;
  const coming = buildComingUpFocus({ ...data, timeOf: hhmm, nameOf: attendeeName });
  setHtml('myday-upcoming', comingHtml(coming, data.today));
  // Nothing coming up: no section saying so (Focus rule 4).
  const upSec = document.getElementById('myday-upcoming-sec'); if (upSec) upSec.hidden = !coming.length;
  const root = document.getElementById('tab-myday');
  if (root) renderIcons(root);

  void ensureData().then((changed) => { if (changed && getActiveTabId() === 'myday') renderMyDay(); });
  void loadRegulatory();
}
registerTabRenderer('myday', renderMyDay);

/** One line for the morning notification, e.g. "3 meetings · 2 tasks due · 4 need attention". */
export function mydaySummaryText(): string {
  const { data, attention } = inputWithShown();
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
  const n = displayName();
  return n ? n.split(/\s+/)[0] : '';
}

// ── The band, the index row and the Now panel (brand slice) ─────────────────

let bandPart = '';
/** The photo decodes after the first paint (its box is reserved, so nothing moves); the scrim follows the time of day. */
function paintBand(now: Date): void {
  const scrim = document.getElementById('myday-band-scrim');
  const part = dayPart(now.getHours());
  if (scrim && bandPart !== part) { bandPart = part; scrim.style.background = scrimFor(part); }
  const img = document.getElementById('myday-band-img') as HTMLImageElement | null;
  if (!img) return;
  requestAnimationFrame(() => {
    void bandPhotoUrl(now).then((url) => {
      if (img.getAttribute('src') === url) return;
      img.classList.remove('is-in');
      img.classList.toggle('is-office', url === OFFICE_BAND);
      img.onload = () => img.classList.add('is-in');
      img.src = url;
    });
  });
}

function indexHtml(items: ReturnType<typeof buildIndex>): string {
  return items.map((x) => `<button class="mdy-ix" type="button" onclick="mydayIndexGo('${x.target}')"><span class="mdy-ix-n">${x.ix}</span><span class="mdy-ix-fig">${x.n}</span><span class="mdy-ix-label">${escHtml(x.label)}</span></button>`).join('');
}

export function mydayIndexGo(target: string): void {
  if (target === 'followup') { (window as any).navToModule?.('followup'); return; }
  const id = target === 'attention' ? 'myday-attention-sec' : target === 'overdue' ? 'myday-today' : target === 'inplay' ? 'myday-inplay-sec' : 'myday-today-sec';
  document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}
expose('mydayIndexGo', mydayIndexGo);

function nowPanelHtml(m: Meeting, current: boolean): string {
  const stand = m.companyName ? standLine({ id: m.companyId ?? null, name: m.companyName }) : '';
  const when = current ? (m.endAt ? `until ${hhmm(m.endAt)}` : 'now') : m.startAt ? `at ${hhmm(m.startAt)}` : '';
  const who = [m.companyName ? companyLink(m.companyId, m.companyName) : '', (m.attendees || []).slice(0, 3).map((a) => escHtml(a.split('@')[0])).join(', '), m.isOnlineMeeting ? 'Teams' : m.location ? escHtml(m.location) : '']
    .filter(Boolean).join('<span class="mdy-sep">·</span>');
  return `<div class="mdy-np">
    <div class="mdy-np-main">
      <div class="mdy-np-title">${recordLink('meeting', m.id, m.title)}${when ? ` <span class="mdy-np-when">${escHtml(when)}</span>` : ''}</div>
      ${who ? `<div class="mdy-meta">${who}</div>` : ''}
      ${stand ? `<div class="mt-stand"><span class="mt-stand-label">Where we stand</span>${escHtml(stand)}</div>` : ''}
    </div>
    <div class="mdy-np-act">
      ${m.onlineMeetingUrl ? `<button class="btn-primary btn-sm" onclick="mydayJoin(${m.id})">Join</button>` : ''}
      <button class="btn-secondary btn-sm" onclick="openRecord('meeting', ${m.id})">Notes</button>
    </div>
  </div>`;
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
      ${opts.overdue ? `<button class="btn-secondary btn-sm" onclick="mydayMoveTask(${t.id}, 0)">Today</button>` : ''}
      <button class="btn-secondary btn-sm" onclick="mydayMoveTask(${t.id}, 1)">Tomorrow</button>
      <button class="rec-icon-btn" onclick="mydayTaskDate(event, ${t.id})" data-tip="Pick a date" aria-label="Pick a date">${icon('calendar', 13)}</button>
    </div>`}
  </div>`;
}

function meetingRow(m: Meeting, past: boolean, current: boolean, own: Set<string>): string {
  const client = isClientMeeting(m, own);
  const needsNotes = past && !(m.discussion || m.decisions || m.actionItems) && client;
  const where = [m.companyName ? companyLink(m.companyId, m.companyName) : '', m.location && !/microsoft teams/i.test(m.location) ? escHtml(m.location) : '', m.isOnlineMeeting ? 'Teams' : '']
    .filter(Boolean).join('<span class="mdy-sep">·</span>');
  return `<div class="mdy-slot-body">
      <div class="mdy-meeting-title">${recordLink('meeting', m.id, m.title)}${current ? ' <span class="mdy-nowtag">now</span>' : ''}</div>
      ${where ? `<div class="mdy-meta">${where}</div>` : ''}
    </div>
    <div class="mdy-row-actions">
      ${m.onlineMeetingUrl && !past && !current ? `<button class="btn-secondary btn-sm" onclick="mydayJoin(${m.id})">${icon('meeting', 12)} Join</button>` : ''}
      ${!past && !current && client ? `<button class="btn-secondary btn-sm" onclick="openRecord('meeting', ${m.id})">${m.agenda ? 'Brief' : 'Prepare'}</button>` : ''}
      ${needsNotes ? `<button class="btn-secondary btn-sm" onclick="openRecord('meeting', ${m.id})">${icon('note', 12)} Add notes</button>` : ''}
    </div>`;
}

function todayHtml(t: Timeline, data: MyDayInput): string {
  const parts: string[] = [];
  if (t.overdue.length) {
    parts.push(`<div class="mdy-group-hd"><span class="t-red">${icon('warning', 12)} Overdue</span><span class="rcnt">${t.overdue.length}</span>
      <button class="btn-secondary btn-sm mdy-hd-action" onclick="mydayMoveOverdue()">Move all to today</button></div>
      <div class="mdy-tasks">${t.overdue.slice(0, 8).map((x) => taskRow(x, { overdue: true })).join('')}</div>
      ${t.overdue.length > 8 ? `<button class="mdy-more" onclick="navToModule('todo')">${t.overdue.length - 8} more in Tasks</button>` : ''}`);
  }
  if (t.allDay.length) {
    parts.push(`<div class="mdy-allday">${t.allDay.map((m) => `<span class="chip">${icon('calendar', 11)} ${recordLink('meeting', m.id, m.title)}</span>`).join('')}</div>`);
  }
  if (t.timed.length) {
    parts.push(`<div class="mdy-timeline">${t.timed.map((e) => {
      if (e.type === 'now') return nowLineHtml(hhmm(e.at));
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
  proposal: 'database', review: 'check', followup: 'repeat', opportunity: 'warning', agreement: 'document',
  meeting: 'clock', project: 'target', email: 'mail', inbox: 'inbox', commitment: 'flag', system: 'warning', writeup: 'edit', quiet: 'people',
};
/** The tile's colour, by what the row is (mock: red late promise and at risk, amber write-up and no agenda, blue waiting on a client, green waiting on Hassan). */
const KIND_TINT: Partial<Record<AttentionItem['kind'], 'red' | 'amber' | 'blue' | 'green'>> = {
  writeup: 'amber', meeting: 'amber', followup: 'blue', quiet: 'blue', review: 'green', opportunity: 'red', system: 'red',
};
const tintOf = (a: AttentionItem) => KIND_TINT[a.kind] ?? (a.tone === 'red' ? 'red' : a.tone === 'amber' ? 'amber' : 'blue');

function attentionRow(a: AttentionItem, child = false): string {
  const isGroup = !!a.children?.length;
  const open = openGroups.has(a.key);
  const title = a.record ? recordLink(a.record.kind, a.record.id, a.title) : escHtml(a.title);
  const company = a.companyName && !a.title.includes(a.companyName) && !child ? `<span class="mdy-sep">·</span>${companyLink(a.companyId, a.companyName)}` : '';
  return `<div class="mdy-att${child ? ' is-child' : ''} tone-${a.tone}" data-key="${escHtml(a.key)}">
    ${child ? '' : `<span class="mdy-att-icon tint-${tintOf(a)}">${icon(KIND_ICON[a.kind], 14)}</span>`}
    <div class="mdy-att-main"${isGroup ? ` onclick="mydayToggleGroup('${escHtml(a.key)}')"` : ''}>
      <div class="mdy-att-title">${isGroup ? `<span class="mdy-chev${open ? ' open' : ''}">${icon('chevronRight', 12)}</span>` : ''}${title}${company}</div>
      <div class="mdy-att-reason">${escHtml(a.reason)}</div>
    </div>
    ${a.when ? `<span class="mdy-when">${escHtml(a.when)}</span>` : ''}
    <div class="mdy-att-actions">
      <button class="btn-secondary btn-sm" onclick="mydayAct('${escHtml(a.key)}')">${escHtml(a.action.label)}</button>
      <button class="rec-icon-btn" onclick="mydayItemMenu(event, '${escHtml(a.key)}')" data-tip="More" aria-label="More">${icon('more', 14)}</button>
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
    case 'open_data_settings': w.switchTab('settings'); w.setSettingsPane('data'); return;
    case 'open_cleanup': w.openCleanup(a.action.queue); return;
    case 'toggle_group': w.mydayToggleGroup(a.key); return;
    case 'write_up': open(); return;
    case 'email_company':
      if (a.companyName) { w.openCompanyDetail?.(a.companyName); setTimeout(() => w.openCompanyTemplates?.(), 250); }
      return;
    case 'mark_kept':
      if (a.commitmentId != null) { setCommitmentKept(a.commitmentId, true); renderMyDay(); }
      return;
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

// ── Rail: proposals in play, coming up, regulatory ─────────────────────────

const STAGE_TINT: Record<PlayRow['stage'], string> = { draft: 'coral', hassan: 'amber', client: 'blue' };

function inPlayHtml(p: InPlay): string {
  if (!p.total) return '';
  const panels = p.stages.map((s) => `<button class="mdy-stage st-${STAGE_TINT[s.stage]}" onclick="mydayPlayAll('${s.stage}')"><span class="mdy-stage-n">${s.count}</span><span class="mdy-stage-l">${escHtml(STAGE_LABEL[s.stage].charAt(0).toLowerCase() + STAGE_LABEL[s.stage].slice(1))}</span><span class="mdy-stage-d"><span class="mdy-stage-o">oldest</span>${s.oldest} ${s.oldest === 1 ? 'day' : 'days'}</span></button>`).join('');
  const groups = STAGE_ORDER.map((stage) => {
    const rows = p.rows.filter((r) => r.stage === stage);
    if (!rows.length) return '';
    const count = p.stages.find((s) => s.stage === stage)?.count ?? rows.length;
    return `<div class="mdy-stg st-${STAGE_TINT[stage]}"><i></i>${escHtml(STAGE_LABEL[stage])}<span class="mdy-stg-cnt">${count}</span>${p.hidden[stage] ? `<button class="rlink mdy-stg-all" onclick="mydayPlayAll('${stage}')">+${p.hidden[stage]}</button>` : ''}</div>
      ${rows.map(playRowHtml).join('')}`;
  }).join('');
  return `<div class="mdy-flow">${panels}</div>${groups}`;
}

function playRowHtml(r: PlayRow): string {
  return `<div class="mdy-pr rec-row" tabindex="0" data-proposal-id="${r.id}" onclick="openRecord('proposal', ${r.id})" onkeydown="if(event.key==='Enter'&&event.target===this)this.click()">
    <span class="mdy-pr-tile" style="background:${strColor(r.client)}">${escHtml(initialsOf(r.client))}</span>
    <div class="mdy-pr-main"><div class="mdy-pr-title">${escHtml(r.client)} — ${escHtml(r.service)}</div><div class="mdy-pr-meta">${escHtml(r.meta)}</div></div>
    <div class="mdy-pr-right"><span class="mdy-age${r.tone ? ` t-${r.tone}` : ''}">${escHtml(r.ageLabel)}</span><button class="rlink mdy-pr-act" onclick="event.stopPropagation();mydayPlay(event, ${r.id}, '${r.action.kind}')">${escHtml(r.action.label)}</button></div>
  </div>`;
}

export function mydayPlayAll(stage: string): void {
  w.navToModule(stage === 'client' ? 'followup' : 'pending');
}
expose('mydayPlayAll', mydayPlayAll);

export async function mydayPlay(e: MouseEvent, id: number, action: string): Promise<void> {
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  if (action === 'draft') { w.openRecord('proposal', id); return; }
  if (action === 'followed_up') { followUpMenu(e, id); return; }
  if (action === 'revision_sent' || action === 'mark_sent') { if (await changeProposalStatus(id, PS.SENT)) renderMyDay(); return; }
  if (action === 'nudge') await nudgeReview(id);
}
expose('mydayPlay', mydayPlay);

const COMING_ICON: Record<ComingItem['kind'], [string, string]> = {
  meeting: ['meeting', 'blue'], promise_ours: ['flag', 'amber'], proposal_promised: ['flag', 'amber'], promise_theirs: ['flag', 'amber-outline'], expiry: ['clock', 'red'], notice: ['document', 'green'],
};

function comingHtml(days: ComingDay[], todayIso: string): string {
  if (!days.length) return '';
  const items = days.reduce((n, d) => n + d.items.length, 0);
  return days.map((d) => {
    const dt = new Date(`${d.date}T12:00:00`);
    return `<div class="mdy-cday${d.date === todayIso ? ' is-today' : ''}">
      <div class="mdy-med"><b>${dt.getDate()}</b><span>${escHtml(fmtWeekday(d.date).slice(0, 3))}</span></div>
      <div class="mdy-cday-items">${d.items.map((it) => {
        const [ic, tint] = COMING_ICON[it.kind];
        const title = it.record ? recordLink(it.record.kind, it.record.id, it.title) : escHtml(it.title);
        const company = it.companyName && !it.title.includes(it.companyName) ? `<span class="mdy-sep">·</span>${companyLink(it.companyId ?? null, it.companyName)}` : '';
        return `<div class="mdy-cev"><span class="mdy-cev-k tint-${tint}">${icon(ic, 10)}</span><div><div class="mdy-cev-t">${title}${company}</div><div class="mdy-cev-s">${it.time ? `<span class="mono">${escHtml(it.time)}</span> · ` : ''}${escHtml(it.detail)}</div></div></div>`;
      }).join('')}</div>
    </div>`;
  }).join('') + (items >= 10 ? '<button class="mdy-more" onclick="navToModule(\'calendar\')">More in Calendar</button>' : '');
}

/** Critical regulatory stories only, with the clients whose services they touch; nothing critical, no block. */
async function loadRegulatory(): Promise<void> {
  let items: IntelligenceItem[] = [];
  try { items = await getIntelligenceItems(); } catch { /* none shown */ }
  const t = today();
  const clients = new Map<number, { id: number; name: string; services: string[] }>();
  for (const a of S.agreements) {
    if (a.companyId == null || !isAgreementActive(a, t)) continue;
    const c = clients.get(a.companyId) || { id: a.companyId, name: a.client || '', services: [] };
    c.services.push(...(a.lines?.length ? a.lines.map((l) => l.serviceName) : [a.type || '']).filter(Boolean));
    clients.set(a.companyId, c);
  }
  const notes = regulatoryNotes(items, [...clients.values()]);
  const sec = document.getElementById('myday-reg-sec');
  if (sec) sec.hidden = !notes.length;
  setHtml('myday-reg', notes.map(({ item, clients: cs }) => `<div class="mdy-alert">
    <div class="mdy-alert-chip">Critical · ${escHtml(item.sourceName)}</div>
    <div class="mdy-alert-t">${escHtml(item.headline)}</div>
    <div class="mdy-alert-s">${escHtml([item.effectiveDate ? `Effective ${fmtDateShort(item.effectiveDate)}` : '', item.whoAffected || item.category || ''].filter(Boolean).join(' · '))}</div>
    <div class="mdy-alert-r"><button class="rlink" onclick="navToModule('intelligence');openIntelModal(${item.id})">Read</button>${cs.length ? ` · Note for ${cs.slice(0, 3).map((c) => companyLink(c.id, c.name)).join(', ')}${cs.length > 3 ? ` and ${cs.length - 3} more` : ''}` : ''}</div>
  </div>`).join(''));
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
  const overdue = buildTimeline(inputWithShown().data).overdue;
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
  if (/^(>>|<<)/.test(raw)) { void captureCommitment(raw).then((ok) => { if (ok) { input.value = ''; mydayCapturePreview(); renderMyDay(); } }); return; }
  const task = addTaskFromText(raw, { dueDate: today() });
  if (!task) return;
  input.value = '';
  mydayCapturePreview();
  renderMyDay();
  settleNew(document.querySelector(`#tab-myday .task-row[data-task-id="${task.id}"]`));
  input.focus();
  const where = task.someday ? 'Someday' : !task.dueDate ? 'Anytime' : task.dueDate === today() ? 'today' : fmtDate(task.dueDate);
  undoToast(`Added "${task.title}" to ${where}`, () => { deleteTodo(task.id, { silent: true }); renderMyDay(); });
}
expose('mydayCapture', mydayCapture);

/** A commitment typed into quick capture: `>> …` we owe, `<< …` they owe.
 * "@Company" (or a company name in the text) says whose it is. */
export async function captureCommitment(raw: string): Promise<boolean> {
  const body = raw.replace(/^(>>|<<)\s*/, '');
  const parsed = parseTaskInput(body, { today: new Date(), projects: [], companies: S.companies.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name })) });
  const co = parsed.companyName ? S.companies.find((c) => c.name === parsed.companyName) : undefined;
  const explicit = parsed.tokens.find((t) => t.kind === 'company' && /^[@＠]/.test(t.text));
  const text = explicit ? stripCompanyToken(raw, parsed.companyName, explicit.text) : raw;
  const added = await readCommitmentsFrom('capture', null, [text], { ...EMPTY_CONTEXT, companyId: co?.id ?? null, companyName: co?.name ?? null });
  if (!added.commitments.length) { toast('Nothing to add — write what was promised after >> or <<'); return false; }
  const request = added.proposals[0];
  toast(request ? `Promise added for ${request.client} — proposal request SL# ${request.id}`
    : raw.startsWith('>>') ? `Commitment added${co ? ` for ${co.name}` : ''}, with a task` : `Noted: ${co ? co.name : 'the client'} owes you this`);
  return true;
}

expose('captureCommitment', captureCommitment);

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
  pending = setTimeout(() => { pending = null; deferWhileHovered(document.getElementById('tab-myday'), renderMyDay); }, 120);
});

// The "now" line and meeting states move with the clock — never under the pointer.
setInterval(() => {
  if (getActiveTabId() === 'myday' && !document.hidden) deferWhileHovered(document.getElementById('tab-myday'), renderMyDay);
}, 60_000);
