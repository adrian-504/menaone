import { S } from '../lib/state';
import { showContextMenu } from '../lib/contextMenu';
import { renderIcons } from '../core/chrome';
import { skeleton, emptyState } from '../lib/ui';
import { toast } from '../lib/ui';
import { companyLink, recordLink } from '../lib/links';
import { fmtDate, escHtml, expose, nextTodoId, nextNoteId, today, showConfirm, inCompany } from '../lib/utils';
import { registerTabRenderer, refreshAll, refreshBadges, notifyNavigated } from '../lib/registry';
import { getMeetings, deleteMeeting, ms365CancelOutlookMeeting, setLinksFrom } from '../lib/db';
import { getAllCompanies } from './companies';
import { openOutlookMeetingModal } from './calendar';
import { persistTodos, persistNotes, persistMeeting } from '../lib/persist';
import { toggleTodoDone, deleteTodo, taskRowHtml } from './todo';
import { switchTab } from '../core/nav';
import { openNote } from './notes';
import type { Meeting, Todo, Note, EntityLink } from '../lib/types';
import { icon } from '../lib/icons';
import { renderMeetingClientSection, meetingSuggestionsBanner, meetingSuggestionChip } from './meetingClient';

let meetingAutoSaveTimer: ReturnType<typeof setTimeout> | null = null;

/** Time-of-day only (no date) — shared by the row list, detail badges, and
 * the Outlook info card below, so a meeting's time renders identically
 * everywhere regardless of whether it's Outlook-sourced or manually logged. */
function fmtTimeOnly(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
}
function fmtTimeRange(startAt: string | null, endAt: string | null): string {
  if (!startAt) return '';
  const start = fmtTimeOnly(startAt);
  return endAt ? `${start} – ${fmtTimeOnly(endAt)}` : start;
}

async function loadMeetings(): Promise<void> {
  S.meetings = await getMeetings();
}

async function renderMeetingsTab(): Promise<void> {
  const list = document.getElementById('meeting-list');
  if (list && !list.childElementCount) list.innerHTML = skeleton(4);
  await loadMeetings();
  renderMeetingList();
}
registerTabRenderer('meetings', () => { void renderMeetingsTab(); });
expose('renderMeetingsTab', () => { if (document.getElementById('meeting-detail')?.classList.contains('open')) return; renderMeetingList(); });

function renderMeetingList(): void {
  const el = document.getElementById('meeting-list');
  if (!el) return;
  const sorted = [...S.meetings].sort((a, b) => (b.meetingDate || '').localeCompare(a.meetingDate || ''));
  if (sorted.length === 0) {
    el.innerHTML = `<div class="card">${emptyState({ icon: 'meeting', title: 'No meetings logged yet', body: 'Capture attendees, decisions and action items so nothing gets lost.', action: { label: 'New Meeting', onclick: 'openMeetingModal(null)' } })}</div>`;
    renderIcons(el);
    return;
  }
  el.innerHTML = meetingSuggestionsBanner() + sorted.map((m) => `<div class="meeting-row${m.isCancelled ? ' is-cancelled' : ''}" onclick="openMeetingDetail(${m.id})">
    <div class="meeting-row-top">
      <div class="meeting-title">${m.source === 'outlook' ? icon('calendar', 13) + ' ' : ''}${escHtml(m.title)}${m.isCancelled ? ' (Cancelled)' : ''}</div>
      <div class="meeting-date">${m.meetingDate ? fmtDate(m.meetingDate) : 'No date'}</div>
    </div>
    <div class="meeting-meta">${[
      escHtml(fmtTimeRange(m.startAt, m.endAt)),
      companyLink(m.companyId, m.companyName),
      (m.attendees || []).length ? `${m.attendees.length} attendee${m.attendees.length !== 1 ? 's' : ''}` : '',
      meetingSuggestionChip(m),
    ].filter(Boolean).join(' · ')}</div>
  </div>`).join('');
  renderIcons(el);
}

export function openMeetingDetail(id: number): void {
  const m = S.meetings.find((x) => x.id === id);
  // A deleted meeting (an old link or history entry): back to the list, not a stale page.
  if (!m) { if (S.meetingEditId != null && document.getElementById('meeting-detail')?.classList.contains('open')) closeMeetingDetail(); return; }
  S.meetingEditId = id;
  (document.getElementById('md-title') as HTMLElement).textContent = m.title;
  (document.getElementById('md-badges') as HTMLElement).innerHTML = [
    m.meetingDate ? `<span class="chip">${fmtDate(m.meetingDate)}</span>` : '',
    m.startAt ? `<span class="chip">${escHtml(fmtTimeRange(m.startAt, m.endAt))}</span>` : '',
    ...(m.attendees || []).map((a) => `<span class="chip">${escHtml(a)}</span>`),
  ].filter(Boolean).join('');

  const projSel = document.getElementById('md-project-sel') as HTMLSelectElement;
  projSel.innerHTML = `<option value="">— No project —</option>` + S.projects.filter((p) => !p.archived).map((p) => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
  projSel.value = m.projectId != null ? String(m.projectId) : '';
  const companyInp = document.getElementById('md-company-inp') as HTMLInputElement;
  companyInp.value = m.companyName || '';
  const companyList = document.getElementById('md-company-list') as HTMLElement;
  companyList.innerHTML = getAllCompanies().map((c) => `<option value="${escHtml(c)}">`).join('');
  const oppSel = document.getElementById('md-opportunity-sel') as HTMLSelectElement;
  oppSel.innerHTML = `<option value="">— No opportunity —</option>` + S.opportunities.filter((o) => !o.archived).map((o) => `<option value="${o.id}">${escHtml(o.name)}</option>`).join('');
  oppSel.value = m.opportunityId != null ? String(m.opportunityId) : '';
  renderMeetingRelationLinks(m);

  (document.getElementById('md-agenda') as HTMLTextAreaElement).value = m.agenda || '';
  (document.getElementById('md-discussion') as HTMLTextAreaElement).value = m.discussion || '';
  (document.getElementById('md-decisions') as HTMLTextAreaElement).value = m.decisions || '';
  (document.getElementById('md-followup') as HTMLTextAreaElement).value = m.followUp || '';
  (document.getElementById('md-next-meeting') as HTMLInputElement).value = m.nextMeeting || '';

  const legacyEl = document.getElementById('md-legacy-actions') as HTMLElement;
  if (m.actionItems && m.actionItems.trim()) {
    legacyEl.style.display = '';
    legacyEl.textContent = `From before this page was live-editable:\n${m.actionItems}`;
  } else {
    legacyEl.style.display = 'none';
  }
  renderMeetingTasks(m);
  renderMeetingClientSection(m);

  const saveConfirm = document.getElementById('md-save-confirm') as HTMLElement;
  saveConfirm.style.display = 'none';

  const joinBtn = document.getElementById('md-join-btn') as HTMLAnchorElement;
  const editScheduleBtn = document.getElementById('md-edit-schedule-btn') as HTMLElement;
  const deleteBtn = document.getElementById('md-delete-btn') as HTMLElement;
  const outlookCard = document.getElementById('md-outlook-card') as HTMLElement;
  const outlookInfo = document.getElementById('md-outlook-info') as HTMLElement;
  const isOutlook = m.source === 'outlook';

  editScheduleBtn.style.display = isOutlook ? '' : 'none';
  joinBtn.style.display = isOutlook && m.isOnlineMeeting && m.onlineMeetingUrl && !m.isCancelled ? '' : 'none';
  if (joinBtn.style.display !== 'none') joinBtn.href = m.onlineMeetingUrl!;
  deleteBtn.textContent = isOutlook ? 'Cancel Meeting' : 'Delete';

  if (isOutlook) {
    const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    outlookCard.style.display = '';
    outlookInfo.innerHTML = [
      m.isCancelled ? `<div class="t-red fw-600">This meeting was cancelled in Outlook.</div>` : '',
      m.startAt ? `<div>${icon('calendar', 13)} ${escHtml(fmtTime(m.startAt))}${m.endAt ? ` – ${escHtml(new Date(m.endAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}` : ''}</div>` : '',
      m.organizer ? `<div>Organizer: ${escHtml(m.organizer)}</div>` : '',
      ...(m.location ? m.location.split(/;\s*/).filter(Boolean).map((part) => /^https?:\/\//.test(part.trim())
        ? `<div>Online: <a href="#" class="rlink" onclick="event.preventDefault();openExternalUrl('${escHtml(part.trim())}')">${escHtml(part.trim().replace(/^https?:\/\/(www\.)?/, '').split('/')[0])}</a></div>`
        : `<div>Location: ${escHtml(part)}</div>`) : []),
      `<div class="t-muted">From Outlook. Schedule changes made here go back to Outlook.</div>`,
    ].filter(Boolean).join('');
  } else {
    outlookCard.style.display = 'none';
  }

  document.getElementById('meeting-list-view')?.classList.add('hidden');
  document.getElementById('meeting-detail')?.classList.add('open');
  notifyNavigated();
}
expose('openMeetingDetail', openMeetingDetail);

export function editCurrentMeetingSchedule(): void {
  if (S.meetingEditId != null) openOutlookMeetingModal(S.meetingEditId);
}
expose('editCurrentMeetingSchedule', editCurrentMeetingSchedule);

export function closeMeetingDetail(): void {
  S.meetingEditId = null;
  document.getElementById('meeting-detail')?.classList.remove('open');
  document.getElementById('meeting-list-view')?.classList.remove('hidden');
  notifyNavigated();
}
expose('closeMeetingDetail', closeMeetingDetail);

export function editCurrentMeeting(): void {
  if (S.meetingEditId != null) openMeetingModal(S.meetingEditId);
}
expose('editCurrentMeeting', editCurrentMeeting);

export async function deleteCurrentMeeting(): Promise<void> {
  if (S.meetingEditId == null) return;
  const m = S.meetings.find((x) => x.id === S.meetingEditId);
  if (!m) return;

  if (m.source === 'outlook' && m.outlookEventId) {
    if (!(await showConfirm(`Cancel "${m.title}"? This removes it from Outlook for all attendees.`, { confirmLabel: 'Cancel Meeting' }))) return;
    try {
      await ms365CancelOutlookMeeting(m.outlookEventId);
    } catch (e) {
      toast('Could not cancel this meeting in Outlook', { tone: 'error', detail: String(e) });
      return;
    }
    await loadMeetings();
    openMeetingDetail(m.id); // re-render in place — cancelled meetings stay visible (Part 11: keep relationship history)
    return;
  }

  if (!(await showConfirm(`Delete "${m.title}"? This cannot be undone.`, { confirmLabel: 'Delete' }))) return;
  await deleteMeeting(S.meetingEditId);
  await loadMeetings();
  closeMeetingDetail();
  renderMeetingList();
}
expose('deleteCurrentMeeting', deleteCurrentMeeting);

function currentMeeting(): Meeting | undefined {
  if (S.meetingEditId == null) return undefined;
  return S.meetings.find((x) => x.id === S.meetingEditId);
}

function renderMeetingTasks(m: Meeting): void {
  const list = document.getElementById('md-tasks-list');
  if (!list) return;
  const tasks = S.todos.filter((t) => t.meetingId === m.id);
  list.innerHTML = tasks.length === 0
    ? `<div class="feed-empty">No action items yet — add them below as they come up.</div>`
    : `<div class="task-group">${tasks.map((t) => taskRowHtml(t, { compact: true })).join('')}</div>`;
}

/** Live one-at-a-time task capture — this *is* the Action Items list now,
 * not a free-text field parsed in bulk afterward. Each entry is a real,
 * immediately-persisted Todo linked to this meeting (and its project/client,
 * whatever they're currently set to). */
export function addMeetingTask(rawTitle: string): void {
  const title = rawTitle.trim();
  const m = currentMeeting();
  if (!title || !m) return;
  const t: Todo = {
    id: nextTodoId(), title, type: m.companyName ? 'client' : 'general', client: m.companyName || null,
    priority: 'Medium', dueDate: null, status: 'Pending', description: `From meeting: ${m.title}`,
    createdAt: today(), completedAt: null, projectId: m.projectId ?? null, parentId: null, areaId: null,
    section: null, sortOrder: null, recurrenceRule: null, tags: [], meetingId: m.id,
  };
  S.todos.push(t);
  persistTodos();
  refreshBadges();
  renderMeetingTasks(m);
}
expose('addMeetingTask', addMeetingTask);

export function toggleMeetingTask(id: number): void {
  toggleTodoDone(id);
  const m = currentMeeting();
  if (m) renderMeetingTasks(m);
}
expose('toggleMeetingTask', toggleMeetingTask);

export async function removeMeetingTask(id: number): Promise<void> {
  deleteTodo(id);
  const m = currentMeeting();
  if (m) renderMeetingTasks(m);
}
expose('removeMeetingTask', removeMeetingTask);

function debounceMeetingSave(fn: () => void): void {
  if (meetingAutoSaveTimer) clearTimeout(meetingAutoSaveTimer);
  meetingAutoSaveTimer = setTimeout(fn, 500);
}

type MeetingTextField = 'agenda' | 'discussion' | 'decisions' | 'followUp' | 'nextMeeting';

export function autoSaveMeetingField(field: MeetingTextField, value: string): void {
  const m = currentMeeting();
  if (!m) return;
  m[field] = value.trim() || null;
  debounceMeetingSave(() => { void persistMeeting(m); });
}
expose('autoSaveMeetingField', autoSaveMeetingField);

/** "Open" links beside the meeting's project and opportunity pickers. */
function renderMeetingRelationLinks(m: Meeting): void {
  const project = m.projectId != null ? S.projects.find((p) => p.id === m.projectId) : undefined;
  const opp = m.opportunityId != null ? S.opportunities.find((o) => o.id === m.opportunityId) : undefined;
  const set = (id: string, html: string) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  set('md-project-link', project ? recordLink('project', project.id, 'Open', { className: 'md-open-link' }) : '');
  set('md-opportunity-link', opp ? recordLink('opportunity', opp.id, 'Open', { className: 'md-open-link' }) : '');
}

export function autoSaveMeetingProject(value: string): void {
  const m = currentMeeting();
  if (!m) return;
  m.projectId = value ? Number(value) : null;
  renderMeetingRelationLinks(m);
  void persistMeeting(m);
}
expose('autoSaveMeetingProject', autoSaveMeetingProject);

export function autoSaveMeetingCompany(value: string): void {
  const m = currentMeeting();
  if (!m) return;
  m.companyName = value.trim() || null;
  void persistMeeting(m).then((saved) => {
    if (!saved) return;
    const i = S.meetings.findIndex((x) => x.id === saved.id);
    if (i > -1) S.meetings[i] = saved;
    if (S.meetingEditId === saved.id) renderMeetingClientSection(saved);
  });
}
expose('autoSaveMeetingCompany', autoSaveMeetingCompany);

export function autoSaveMeetingOpportunity(value: string): void {
  const m = currentMeeting();
  if (!m) return;
  m.opportunityId = value ? Number(value) : null;
  renderMeetingRelationLinks(m);
  void persistMeeting(m);
}
expose('autoSaveMeetingOpportunity', autoSaveMeetingOpportunity);

function compileMeetingNoteMarkdown(m: Meeting): string {
  const parts: string[] = [];
  if (m.agenda) parts.push(`## Agenda\n${m.agenda}`);
  if (m.discussion) parts.push(`## Discussion\n${m.discussion}`);
  if (m.decisions) parts.push(`## Decisions\n${m.decisions}`);
  if (m.followUp) parts.push(`## Follow-Up\n${m.followUp}`);
  if (m.nextMeeting) parts.push(`## Next Meeting\n${fmtDate(m.nextMeeting)}`);
  return parts.join('\n\n');
}

/** Compiles the meeting's live-edited fields into a real Markdown Note (the
 * Phase 3 Notes system, with backlinks/relations/search — a meeting's own
 * fields participate in none of that) and links it to whichever Project is
 * currently set. Idempotent: re-pressing after more edits updates the same
 * Note (via the meeting's `noteId`, set the first time) rather than creating
 * a duplicate. Tasks are never touched here — they're already real, saved,
 * linked Todos the moment they're added. */
export async function saveAndFileMeetingNotes(): Promise<void> {
  const m = currentMeeting();
  if (!m) return;
  const content = compileMeetingNoteMarkdown(m);
  if (!content.trim()) { toast('Add some notes before filing — there is nothing to save yet'); return; }

  let noteId = m.noteId;
  const existingNote = noteId != null ? S.notes.find((n) => n.id === noteId) : undefined;
  if (existingNote) {
    existingNote.content = content;
    existingNote.clientName = m.companyName || '';
    existingNote.updatedAt = today();
  } else {
    const newNote: Note = {
      id: nextNoteId(), title: m.meetingDate ? `${m.title} — ${fmtDate(m.meetingDate)}` : m.title, content, folder: '',
      clientName: m.companyName || '', tags: [], pinned: false, createdAt: today(), updatedAt: today(),
    };
    S.notes.unshift(newNote);
    noteId = newNote.id;
  }
  persistNotes();

  if (m.projectId != null && noteId != null) {
    const links: EntityLink[] = [{ fromType: 'note', fromId: noteId, toType: 'project', toId: m.projectId }];
    await setLinksFrom('note', noteId, links);
  }

  m.noteId = noteId;
  await persistMeeting(m);

  const saveConfirm = document.getElementById('md-save-confirm') as HTMLElement;
  saveConfirm.style.display = '';
}
expose('saveAndFileMeetingNotes', saveAndFileMeetingNotes);

export function viewMeetingNote(): void {
  const m = currentMeeting();
  if (!m || m.noteId == null) return;
  closeMeetingDetail();
  switchTab('notes');
  openNote(m.noteId);
}
expose('viewMeetingNote', viewMeetingNote);

export function openMeetingModal(id: number | null): void {
  S.meetingEditId = id;
  const f = document.getElementById('meeting-form') as HTMLFormElement;
  f.reset();
  const dl = document.getElementById('mt-company-list'); if (dl) dl.innerHTML = getAllCompanies().map((c) => `<option value="${escHtml(c)}">`).join('');
  const projSel = f.elements.namedItem('mtProject') as HTMLSelectElement | null;
  if (projSel) projSel.innerHTML = `<option value="">— No project —</option>` + S.projects.filter((p) => !p.archived).map((p) => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
  const oppSel = f.elements.namedItem('mtOpportunity') as HTMLSelectElement | null;
  if (oppSel) oppSel.innerHTML = `<option value="">— No opportunity —</option>` + S.opportunities.filter((o) => !o.archived).map((o) => `<option value="${o.id}">${escHtml(o.name)}</option>`).join('');

  if (id !== null) {
    const m = S.meetings.find((x) => x.id === id);
    if (!m) return;
    (document.getElementById('meeting-modal-title') as HTMLElement).textContent = 'Edit Meeting';
    (f.elements.namedItem('mtTitle') as HTMLInputElement).value = m.title;
    (f.elements.namedItem('mtDate') as HTMLInputElement).value = m.meetingDate || '';
    (f.elements.namedItem('mtStart') as HTMLInputElement).value = m.startAt ? new Date(m.startAt).toTimeString().slice(0, 5) : '';
    (f.elements.namedItem('mtEnd') as HTMLInputElement).value = m.endAt ? new Date(m.endAt).toTimeString().slice(0, 5) : '';
    (f.elements.namedItem('mtCompany') as HTMLInputElement).value = m.companyName || '';
    if (projSel) projSel.value = m.projectId != null ? String(m.projectId) : '';
    if (oppSel) oppSel.value = m.opportunityId != null ? String(m.opportunityId) : '';
    (f.elements.namedItem('mtAttendees') as HTMLInputElement).value = (m.attendees || []).join(', ');
  } else {
    (document.getElementById('meeting-modal-title') as HTMLElement).textContent = 'New Meeting';
  }
  document.getElementById('modal-meeting')?.classList.add('open');
}
expose('openMeetingModal', openMeetingModal);

export function closeMeetingModal(): void {
  document.getElementById('modal-meeting')?.classList.remove('open');
}
expose('closeMeetingModal', closeMeetingModal);

export async function submitMeeting(e: Event): Promise<void> {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  const title = (f.elements.namedItem('mtTitle') as HTMLInputElement).value.trim();
  if (!title) return;
  const existing = S.meetingEditId != null ? S.meetings.find((x) => x.id === S.meetingEditId) : null;
  const projVal = (f.elements.namedItem('mtProject') as HTMLSelectElement).value;
  const oppVal = (f.elements.namedItem('mtOpportunity') as HTMLSelectElement).value;
  const attendeesRaw = (f.elements.namedItem('mtAttendees') as HTMLInputElement).value;
  const mtDate = (f.elements.namedItem('mtDate') as HTMLInputElement).value;
  const mtStart = (f.elements.namedItem('mtStart') as HTMLInputElement).value;
  const mtEnd = (f.elements.namedItem('mtEnd') as HTMLInputElement).value;
  // Time is optional (unlike the Outlook-import modal, where it's required) —
  // a manually-logged meeting previously had no way to record what time it
  // happened at all. Same date+time-to-UTC-instant convention as the Outlook
  // modal's submit handler (src/tabs/calendar.ts).
  const startAt = mtDate && mtStart ? new Date(`${mtDate}T${mtStart}`).toISOString() : null;
  const endAt = mtDate && mtEnd ? new Date(`${mtDate}T${mtEnd}`).toISOString() : null;
  if (startAt && endAt && new Date(endAt) <= new Date(startAt)) { toast('End time must be after start time', { tone: 'error' }); return; }

  const draft: Meeting = {
    id: existing?.id ?? 0,
    title,
    meetingDate: mtDate || null,
    companyName: (f.elements.namedItem('mtCompany') as HTMLInputElement).value.trim() || null,
    projectId: projVal ? Number(projVal) : null,
    opportunityId: oppVal ? Number(oppVal) : null,
    attendees: attendeesRaw.split(',').map((a) => a.trim()).filter(Boolean),
    // Content fields are edited live on the meeting detail page, not this
    // scheduling-only modal — carry them forward unchanged on an edit; a
    // brand-new meeting starts with all of them empty.
    agenda: existing?.agenda ?? null,
    discussion: existing?.discussion ?? null,
    decisions: existing?.decisions ?? null,
    actionItems: existing?.actionItems ?? null,
    followUp: existing?.followUp ?? null,
    nextMeeting: existing?.nextMeeting ?? null,
    noteId: existing?.noteId ?? null,
    createdAt: existing?.createdAt ?? null,
    updatedAt: null,
    // save_meeting never touches these columns server-side — carried forward
    // here purely so the in-memory draft stays type-complete/accurate until
    // the reload after save.
    outlookEventId: existing?.outlookEventId ?? null,
    startAt,
    endAt,
    organizer: existing?.organizer ?? null,
    location: existing?.location ?? null,
    isOnlineMeeting: existing?.isOnlineMeeting ?? false,
    onlineMeetingUrl: existing?.onlineMeetingUrl ?? null,
    isCancelled: existing?.isCancelled ?? false,
    source: existing?.source ?? 'internal',
  };

  const saved = await persistMeeting(draft);
  if (!saved) return;
  await loadMeetings();
  closeMeetingModal();
  renderMeetingList();
  if (S.meetingEditId != null || document.getElementById('meeting-detail')?.classList.contains('open')) {
    S.meetingEditId = saved.id;
    openMeetingDetail(saved.id);
  }
}
expose('submitMeeting', submitMeeting);

// ── Companies tab integration: meetings linked to a company

export function renderCoMeetingsSection(d: { name: string; companyId: number | null }): void {
  const container = document.getElementById('cosub-meetings-inner');
  if (!container) return;
  void loadMeetings().then(() => {
    const ref = { id: d.companyId, name: d.name };
    const companyMeetings = S.meetings.filter((m) => inCompany(ref, m.companyId, m.companyName)).sort((a, b) => (b.meetingDate || '').localeCompare(a.meetingDate || ''));
    const cnt = document.getElementById('co-meetings-tab-count');
    if (cnt) cnt.textContent = companyMeetings.length ? String(companyMeetings.length) : '';
    if (companyMeetings.length === 0) {
      container.innerHTML = emptyState({ icon: 'meeting', title: `No meetings with ${d.name} yet`, compact: true, action: { label: 'New Meeting', onclick: 'createMeetingForCurrentCompany()' } });
      renderIcons(container);
      return;
    }
    container.innerHTML = `<div class="rec-list">${companyMeetings.map((m) => `<div class="rec-row" onclick="openRecord('meeting', ${m.id})">
      <span class="rec-row-icon">${icon('meeting', 15)}</span>
      <div class="rec-row-main"><div class="rec-row-title">${escHtml(m.title)}</div><div class="rec-row-sub">${escHtml([fmtTimeRange(m.startAt, m.endAt), (m.attendees || []).length ? `${m.attendees.length} attendee${m.attendees.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '))}</div></div>
      <span class="rec-row-date">${m.meetingDate ? fmtDate(m.meetingDate) : ''}</span>
    </div>`).join('')}</div>`;
  });
}
expose('renderCoMeetingsSection', renderCoMeetingsSection);


export function createMeetingForCurrentCompany(): void {
  if (!S.currentCompany) return;
  const companyName = S.currentCompany;
  openMeetingModal(null);
  setTimeout(() => {
    (document.querySelector('#meeting-form [name=mtCompany]') as HTMLInputElement).value = companyName;
  }, 0);
}
expose('createMeetingForCurrentCompany', createMeetingForCurrentCompany);

// ── Follow-up meeting ─────────────────────────────────────────

/** A new meeting with the same client, project, opportunity and people, and
 * last time's follow-ups as its agenda. */
export async function planFollowUpMeeting(id: number): Promise<void> {
  const m = S.meetings.find((x) => x.id === id);
  if (!m) return;
  const agenda = [m.followUp, m.decisions ? `Decisions last time: ${m.decisions}` : null].filter((x) => x && x.trim()).join('\n\n') || null;
  const saved = await persistMeeting({
    ...m, id: 0, title: /follow-up/i.test(m.title) ? m.title : `${m.title} — follow-up`, meetingDate: m.nextMeeting || today(),
    agenda, discussion: null, decisions: null, actionItems: null, followUp: null, nextMeeting: null, noteId: null,
    createdAt: null, updatedAt: null, outlookEventId: null, startAt: null, endAt: null, organizer: null, location: null,
    isOnlineMeeting: false, onlineMeetingUrl: null, isCancelled: false, source: 'internal', organizerEmail: null, attendeeEmails: [...(m.attendeeEmails || [])],
  });
  if (!saved) return;
  S.meetings.push(saved);
  (window as any).openRecord('meeting', saved.id);
  toast(`Follow-up planned for ${fmtDate(saved.meetingDate)}`, { detail: 'Use Edit schedule to put it in Outlook.' });
}
expose('planFollowUpMeeting', planFollowUpMeeting);

export function meetingMoreMenu(e: MouseEvent): void {
  const id = S.meetingEditId;
  if (id == null) return;
  const m = S.meetings.find((x) => x.id === id);
  const outlook = m?.source === 'outlook';
  showContextMenu(e, [
    { label: 'Edit details', iconName: 'edit', run: () => (window as any).editCurrentMeeting?.() },
    ...(outlook ? [{ label: 'Change time or attendees', iconName: 'calendar', run: () => (window as any).editCurrentMeetingSchedule?.() }] : []),
    { label: 'Plan a follow-up meeting', iconName: 'copy', run: () => { void planFollowUpMeeting(id); } },
    { label: '', run: () => {}, separator: true },
    { label: outlook ? 'Cancel the meeting in Outlook' : 'Delete', iconName: 'trash', danger: true, run: () => { void deleteCurrentMeeting(); } },
  ]);
}
expose('meetingMoreMenu', meetingMoreMenu);
