// The body of a meeting page: its notes (agenda, discussion, decisions,
// action items, follow-up) written with the same editor as Notes, and on the
// side the earlier meetings with the same client and the Outlook invite.
// The meeting page is the one place a meeting's notes live.

import type { EditorView } from '@codemirror/view';
import { S } from '../lib/state';
import { renderIcons } from '../core/chrome';
import { toast } from '../lib/ui';
import { recordLink, companyLink } from '../lib/links';
import { fmtDate, escHtml, expose, today, inCompany } from '../lib/utils';
import { persistMeeting, persistTodos } from '../lib/persist';
import { refreshBadges } from '../lib/registry';
import { icon } from '../lib/icons';
import { createNoteEditor } from '../lib/markdownEditor';
import { parseTaskInput } from '../lib/taskParse';
import { contextFromMeeting, taskFields } from '../lib/workGraph';
import { blankTask, taskRowHtml, toggleTodoDone } from './todo';
import { readCommitmentsFrom, toggleCommitmentKept } from './commitments';
import { SECTION_LABEL, earlierMeetings, isMeetingOver, meetingSections, previewLines, type NoteField, type SectionKey } from '../lib/meetingRecap';
import type { Meeting } from '../lib/types';

const PLACEHOLDER: Record<NoteField, string> = {
  agenda: 'What this meeting is about. Start a line with - for a point',
  discussion: 'Notes as the meeting happens. - for a bullet, [ ] for a checkbox, **bold**',
  decisions: 'What was decided? Start a line with >> for what we owe, << for what the client owes',
  followUp: 'What happens next. >> something we owe, << something the client owes',
};

const editors = new Map<NoteField, EditorView>();
/** Sections opened with "+ Add" on this visit to this meeting. */
let opened = new Set<SectionKey>();
let openedFor: number | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function destroyEditors(): void {
  for (const view of editors.values()) view.destroy();
  editors.clear();
}

function meeting(id: number): Meeting | undefined {
  return S.meetings.find((x) => x.id === id);
}

function meetingTasks(m: Meeting) {
  return S.todos.filter((t) => t.meetingId === m.id && t.parentId == null);
}

export function isOver(m: Meeting): boolean {
  return isMeetingOver(m, new Date(), today());
}

// ── Notes ──────────────────────────────────────────────────────────────────

export function renderMeetingNotes(m: Meeting, focus?: SectionKey): void {
  const el = document.getElementById('md-notes');
  if (!el) return;
  if (openedFor !== m.id) { opened = new Set(); openedFor = m.id; }
  destroyEditors();
  const over = isOver(m);
  const tasks = meetingTasks(m);
  const { shown, addable } = meetingSections(m, over, tasks.length, opened);
  const title = over ? (m.isCancelled ? 'Notes' : 'Recap') : 'Meeting notes';

  const section = (k: SectionKey) => {
    if (k === 'actions') {
      return `<div class="md-sec" data-sec="actions">
        <div class="md-sec-hd"><h3>${SECTION_LABEL.actions}</h3><span class="md-sec-count" id="md-actions-count"></span></div>
        <div id="md-tasks-list" class="md-tasks-list"></div>
        ${actionAddRow(m)}
        ${m.actionItems?.trim() ? `<div class="rec-legacy-text">From before action items were tasks:\n${escHtml(m.actionItems)}</div>` : ''}
      </div>`;
    }
    return `<div class="md-sec" data-sec="${k}">
      <div class="md-sec-hd"><h3>${SECTION_LABEL[k]}</h3></div>
      <div class="md-editor notes-editor" id="md-ed-${k}"></div>
    </div>`;
  };

  el.innerHTML = `<div class="rec-section-hd"><h2>${title}</h2></div>
    <div class="md-doc">${shown.map(section).join('')}</div>
    ${addable.length ? `<div class="md-add-row">${addable.map((k) => `<button class="md-add-sec" onclick="openMeetingSection('${k}')">${icon('plus', 12)} ${SECTION_LABEL[k]}</button>`).join('')}</div>` : ''}
    ${nextMeetingRow(m)}`;

  for (const k of shown) {
    if (k === 'actions') continue;
    const host = document.getElementById(`md-ed-${k}`);
    if (!host) continue;
    const field = k;
    editors.set(field, createNoteEditor(host, {
      doc: m[field] || '',
      placeholder: PLACEHOLDER[field],
      onChange: (doc) => saveField(m.id, field, doc),
      resolveWikilink: () => null,
      onWikilinkClick: () => undefined,
      onImageFile: () => toast('Images go in Notes or Files — meeting notes are text'),
      resolveAttachmentUrl: () => undefined,
    }));
    // Promises are read once a line is finished: when the box loses focus.
    host.addEventListener('focusout', () => { void readMeetingCommitments(m.id); });
  }
  renderMeetingTasks(m);
  renderIcons(el);
  if (focus && focus !== 'actions') editors.get(focus)?.focus();
  if (focus === 'actions') (document.getElementById('md-task-input') as HTMLInputElement | null)?.focus();
}
expose('renderMeetingNotesFor', (id: number) => { const m = meeting(id); if (m && S.meetingEditId === id) renderMeetingNotes(m); });

function saveField(id: number, field: NoteField, value: string): void {
  const m = meeting(id);
  if (!m) return;
  m[field] = value.trim() ? value : null;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void persistMeeting(m); }, 500);
}

/** Saves a pending edit straight away (leaving the page). */
export function flushMeetingNotes(): void {
  if (S.meetingEditId == null) return;
  const m = meeting(S.meetingEditId);
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (m) void persistMeeting(m);
  }
  if (m) void readMeetingCommitments(m.id);
}

/** `>>` / `<<` lines in the meeting's notes become commitments with its
 * company, opportunity, project and the meeting itself. */
export async function readMeetingCommitments(id: number): Promise<void> {
  const m = meeting(id);
  if (!m) return;
  const texts = [m.discussion, m.decisions, m.followUp, m.actionItems];
  if (!texts.some((t) => t && /(>>|<<)/.test(t))) return;
  await readCommitmentsFrom('meeting', m.id, texts, contextFromMeeting(S, m));
}

export function openMeetingSection(k: SectionKey): void {
  const m = S.meetingEditId != null ? meeting(S.meetingEditId) : undefined;
  if (!m) return;
  opened.add(k);
  renderMeetingNotes(m, k);
}
expose('openMeetingSection', openMeetingSection);

/** Replaces a section's text from outside the editor (suggested agenda). */
export function setMeetingSectionText(m: Meeting, field: NoteField): void {
  opened.add(field);
  if (S.meetingEditId === m.id) renderMeetingNotes(m);
}

// ── Next meeting ───────────────────────────────────────────────────────────

function nextMeetingRow(m: Meeting): string {
  const set = !!m.nextMeeting;
  return `<div class="md-next">
    <span class="md-next-label">${icon('calendar', 13)} Next meeting</span>
    ${set
      ? `<button class="md-next-date" onclick="pickNextMeeting()">${escHtml(fmtDate(m.nextMeeting))}</button>
         <button class="md-link-btn" onclick="planFollowUpMeeting(${m.id})">Create it</button>
         <button class="md-next-clear" onclick="setNextMeeting('')" title="Clear" aria-label="Clear the next meeting date">${icon('close', 12)}</button>`
      : `<button class="md-next-date is-unset" onclick="pickNextMeeting()">Not set</button>`}
    <input type="date" id="md-next-meeting" class="md-next-input" value="${escHtml(m.nextMeeting || '')}" onchange="setNextMeeting(this.value)" tabindex="-1" aria-label="Next meeting date">
  </div>`;
}

export function pickNextMeeting(): void {
  const input = document.getElementById('md-next-meeting') as HTMLInputElement | null;
  if (!input) return;
  input.classList.add('is-picking');
  input.focus();
  try { input.showPicker(); } catch { /* the field itself is shown */ }
}
expose('pickNextMeeting', pickNextMeeting);

export function setNextMeeting(value: string): void {
  const m = S.meetingEditId != null ? meeting(S.meetingEditId) : undefined;
  if (!m) return;
  m.nextMeeting = value || null;
  void persistMeeting(m);
  const row = document.querySelector('#md-notes .md-next');
  if (row) { row.outerHTML = nextMeetingRow(m); renderIcons(document.getElementById('md-notes')!); }
}
expose('setNextMeeting', setNextMeeting);

// ── Action items ───────────────────────────────────────────────────────────

/** People who can own an action item: the team, then the meeting's attendees. */
function ownerOptions(m: Meeting): string[] {
  const team = S.team.filter((t) => t.active !== false).map((t) => t.name);
  return [...new Set([...team, ...(m.attendees || [])].map((n) => n.trim()).filter(Boolean))];
}

function actionAddRow(m: Meeting): string {
  const enter = `onkeydown="if(event.key==='Enter'){event.preventDefault();addMeetingAction()}"`;
  return `<div class="md-task-add">
    <input id="md-task-input" class="md-task-title" placeholder="Add an action item — e.g. Send the revised quote fri" ${enter}>
    <input id="md-task-owner" class="md-task-owner" list="md-owner-list" placeholder="Owner" ${enter}>
    <input id="md-task-due" class="md-task-due" type="date" aria-label="Due date" ${enter}>
    <button class="btn-secondary btn-sm" onclick="addMeetingAction()">Add</button>
    <datalist id="md-owner-list">${ownerOptions(m).map((n) => `<option value="${escHtml(n)}">`).join('')}</datalist>
  </div>`;
}

export function renderMeetingTasks(m: Meeting): void {
  const list = document.getElementById('md-tasks-list');
  if (!list) return;
  const tasks = S.todos.filter((t) => t.meetingId === m.id);
  list.innerHTML = tasks.length ? `<div class="task-group">${tasks.map((t) => taskRowHtml(t, { compact: true })).join('')}</div>` : '';
  renderIcons(list);
  const top = tasks.filter((t) => t.parentId == null);
  const open = top.filter((t) => t.status !== 'Done').length;
  const count = document.getElementById('md-actions-count');
  if (count) count.textContent = !top.length ? '' : open === top.length ? `${open} open` : open ? `${open} open · ${top.length - open} done` : 'All done';
}

/** After a task changes anywhere (completed, owner set in the task panel). */
function refreshMeetingActions(): void {
  if (S.meetingEditId == null || !document.getElementById('meeting-detail')?.classList.contains('open')) return;
  const m = meeting(S.meetingEditId);
  if (!m) return;
  renderMeetingTasks(m);
  renderEarlierMeetings(m);
}
expose('refreshMeetingActions', refreshMeetingActions);

/** A new action item: a real task for the meeting's company, project and
 * opportunity, with an owner and a due date. Words like "fri" or "tomorrow"
 * in the text set the date when the date field is empty. */
export function addMeetingAction(): void {
  const m = S.meetingEditId != null ? meeting(S.meetingEditId) : undefined;
  const titleEl = document.getElementById('md-task-input') as HTMLInputElement | null;
  const ownerEl = document.getElementById('md-task-owner') as HTMLInputElement | null;
  const dueEl = document.getElementById('md-task-due') as HTMLInputElement | null;
  const raw = titleEl?.value.trim() || '';
  if (!m || !titleEl || !raw) { titleEl?.focus(); return; }
  const parsed = parseTaskInput(raw, { today: new Date(), projects: [], companies: [] });
  const t = blankTask({
    ...taskFields(contextFromMeeting(S, m)),
    title: parsed.title || raw,
    dueDate: dueEl?.value || parsed.dueDate,
    dueTime: dueEl?.value ? null : parsed.dueTime,
    priority: parsed.priority || 'Medium',
    owner: ownerEl?.value.trim() || null,
    description: `From meeting: ${m.title}`,
  });
  S.todos.push(t);
  persistTodos();
  refreshBadges();
  titleEl.value = '';
  if (ownerEl) ownerEl.value = '';
  if (dueEl) dueEl.value = '';
  renderMeetingTasks(m);
  titleEl.focus();
}
expose('addMeetingAction', addMeetingAction);

// ── Earlier with this client ───────────────────────────────────────────────

function clientOf(m: Meeting) {
  if (m.companyId != null) return S.companies.find((c) => c.id === m.companyId) || (m.companyName ? { id: m.companyId, name: m.companyName } : null);
  return m.companyName ? { id: null, name: m.companyName } : null;
}

export function renderEarlierMeetings(m: Meeting): void {
  const el = document.getElementById('md-earlier');
  if (!el) return;
  const client = clientOf(m);
  const earlier = client ? earlierMeetings(m, S.meetings, (x) => inCompany({ id: client.id ?? null, name: client.name }, x.companyId, x.companyName)) : [];
  el.hidden = earlier.length === 0;
  if (!earlier.length || !client) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="rec-section-hd"><h2>Earlier with ${escHtml(client.name)}</h2></div>
    <div class="md-earlier-list">${earlier.map((e) => {
      const decisions = previewLines(e.decisions, 3);
      const notes = decisions.length ? [] : previewLines(e.discussion, 2);
      const open = S.todos.filter((t) => t.meetingId === e.id && t.status !== 'Done' && !S.commitments.some((c) => c.todoId === t.id));
      const promises = S.commitments.filter((c) => c.sourceType === 'meeting' && c.sourceId === e.id && c.status === 'open');
      return `<div class="md-earlier-item">
        <div class="md-earlier-hd">${recordLink('meeting', e.id, e.title)}<span class="md-earlier-date">${escHtml(fmtDate(e.meetingDate))}</span></div>
        ${decisions.length ? `<div class="md-earlier-label">Decided</div><ul class="md-earlier-points">${decisions.map((d) => `<li>${escHtml(d)}</li>`).join('')}</ul>` : ''}
        ${notes.length ? `<ul class="md-earlier-points is-notes">${notes.map((d) => `<li>${escHtml(d)}</li>`).join('')}</ul>` : ''}
        ${open.length ? `<div class="md-earlier-label">Still open</div>${open.slice(0, 4).map((t) => `<div class="md-earlier-task">
            <button class="task-check" onclick="completeEarlierAction(${t.id})" aria-label="Complete" title="Complete"></button>
            <span>${escHtml(t.title)}${t.owner ? ` <span class="md-earlier-owner">· ${escHtml(t.owner)}</span>` : ''}</span></div>`).join('')}${open.length > 4 ? `<div class="md-earlier-more">and ${open.length - 4} more</div>` : ''}` : ''}
        ${promises.length ? `<div class="md-earlier-label">Promised</div>${promises.slice(0, 4).map((c) => `<div class="md-earlier-task">
            <button class="task-check" onclick="toggleEarlierCommitment(${c.id})" aria-label="Mark kept" title="Mark kept"></button>
            <span><span class="cm-dir${c.direction === 'theirs' ? ' is-theirs' : ''}" aria-label="${c.direction === 'ours' ? 'We owe it' : 'They owe it'}">${c.direction === 'ours' ? '→' : '←'}</span> ${escHtml(c.text)}${c.dueDate ? ` <span class="md-earlier-owner">· ${escHtml(fmtDate(c.dueDate))}</span>` : ''}</span></div>`).join('')}` : ''}
        ${!decisions.length && !notes.length && !open.length && !promises.length ? '<div class="md-earlier-empty">Nothing written up</div>' : ''}
      </div>`;
    }).join('')}</div>
    <div class="md-earlier-foot">${companyLink(client.id, client.name, { className: 'rlink' }).replace(`>${escHtml(client.name)}<`, `>All meetings with ${escHtml(client.name)}<`)}</div>`;
  renderIcons(el);
}

export function toggleEarlierCommitment(id: number): void {
  toggleCommitmentKept(id);
  const m = S.meetingEditId != null ? meeting(S.meetingEditId) : undefined;
  if (m) renderEarlierMeetings(m);
}
expose('toggleEarlierCommitment', toggleEarlierCommitment);

export function completeEarlierAction(id: number): void {
  toggleTodoDone(id);
  const m = S.meetingEditId != null ? meeting(S.meetingEditId) : undefined;
  if (m) renderEarlierMeetings(m);
}
expose('completeEarlierAction', completeEarlierAction);

// ── Invite ─────────────────────────────────────────────────────────────────

function linkify(text: string): string {
  return escHtml(text).replace(/https?:\/\/[^\s<>"']+/g, (url) => {
    const shown = url.replace(/^https?:\/\/(www\.)?/, '').split(/[/?#]/)[0];
    return `<a href="#" class="rlink" title="${url}" onclick="event.preventDefault();openExternalUrl('${url.replace(/'/g, '%27')}')">${shown}</a>`;
  });
}

export function renderMeetingInvite(m: Meeting): void {
  const el = document.getElementById('md-invite');
  if (!el) return;
  const text = (m.inviteText || '').trim();
  el.hidden = !text;
  if (!text) { el.innerHTML = ''; return; }
  const long = text.split('\n').length > 8 || text.length > 420;
  el.innerHTML = `<div class="rec-section-hd"><h2>Invite</h2><span class="rec-count">from Outlook</span></div>
    <div class="md-invite-text${long ? ' is-clamped' : ''}" id="md-invite-text">${linkify(text)}</div>
    ${long ? `<button class="md-link-btn md-invite-more" onclick="toggleMeetingInvite(this)">Show all</button>` : ''}`;
}

export function toggleMeetingInvite(btn: HTMLElement): void {
  const box = document.getElementById('md-invite-text');
  if (!box) return;
  const clamped = box.classList.toggle('is-clamped');
  btn.textContent = clamped ? 'Show all' : 'Show less';
}
expose('toggleMeetingInvite', toggleMeetingInvite);
