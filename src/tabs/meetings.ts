import { S } from '../lib/state';
import { statusBadge } from '../lib/statusTone';
import { orderMeetings } from '../lib/meetingOrder';
import { showContextMenu } from '../lib/contextMenu';
import { renderIcons } from '../core/chrome';
import { loadInto, emptyState } from '../lib/ui';
import { toast } from '../lib/ui';
import { companyLink, recordLink } from '../lib/links';
import { fmtDate, escHtml, expose, today, showConfirm, inCompany } from '../lib/utils';
import { registerTabRenderer, refreshAll, refreshBadges, notifyNavigated } from '../lib/registry';
import { getMeetings, deleteMeeting, ms365CancelOutlookMeeting } from '../lib/db';
import { getAllCompanies } from './companies';
import { attachCompanySelector } from '../lib/companySelector';
import { openOutlookMeetingModal } from './calendar';
import { persistMeeting } from '../lib/persist';
import type { Meeting } from '../lib/types';
import { companyFromForm, contextFromCompany, contextFromOpportunity, contextFromProject, inheritCompany, EMPTY_CONTEXT, type WorkContext } from '../lib/workGraph';
import { icon } from '../lib/icons';
import { isMeetingOver, writeUpState } from '../lib/meetingRecap';
import { flushMeetingNotes, isOver, renderEarlierMeetings, renderMeetingInvite, renderMeetingNotes } from './meetingNotes';
import { renderMeetingClientSection, meetingSuggestionsBanner, meetingSuggestionChip } from './meetingClient';

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
  if (!(await loadInto(document.getElementById('meeting-list'), 'meetings', 'renderTab(\'meetings\')', loadMeetings))) return;
  renderMeetingList();
}
registerTabRenderer('meetings', () => { void renderMeetingsTab(); });
expose('renderMeetingsTab', () => { if (document.getElementById('meeting-detail')?.classList.contains('open')) return; renderMeetingList(); });

let meetingWhen: 'all' | 'upcoming' | 'past' | 'writeup' = 'all';

export function setMeetingFilter(when: 'all' | 'upcoming' | 'past' | 'writeup'): void {
  meetingWhen = when;
  document.querySelectorAll<HTMLElement>('#meeting-when-seg button').forEach((b) => b.classList.toggle('active', b.dataset.when === when));
  renderMeetingList();
}
expose('setMeetingFilter', setMeetingFilter);

function renderMeetingList(): void {
  const el = document.getElementById('meeting-list');
  if (!el) return;
  const q = ((document.getElementById('meeting-search') as HTMLInputElement | null)?.value || '').trim().toLowerCase();
  const todayIso = today();
  const now = new Date();
  const tasksOf = (id: number) => S.todos.filter((t) => t.meetingId === id && t.parentId == null);
  const state = new Map(S.meetings.map((m) => [m.id, writeUpState(m, tasksOf(m.id), isMeetingOver(m, now, todayIso))]));
  const shown = S.meetings.filter((m) => {
    if (meetingWhen === 'upcoming' && !((m.meetingDate || '') >= todayIso)) return false;
    if (meetingWhen === 'past' && !(m.meetingDate && m.meetingDate < todayIso)) return false;
    if (meetingWhen === 'writeup' && !state.get(m.id)?.needsWriteUp) return false;
    return !q || [m.title, m.companyName, ...(m.attendees || [])].some((v) => (v || '').toLowerCase().includes(q));
  });
  // What's coming first (soonest at the top), history below — the order the
  // Calendar already uses, so the two modules can't disagree.
  const { upcoming, past } = orderMeetings(shown, meetingWhen === 'writeup' ? 'all' : meetingWhen, todayIso);
  const sorted = [...upcoming, ...past];
  const count = document.getElementById('meeting-count');
  if (count) count.textContent = `${sorted.length} meeting${sorted.length === 1 ? '' : 's'}`;
  if (sorted.length === 0 && S.meetings.length > 0) {
    el.innerHTML = `<div class="card">${emptyState({ icon: meetingWhen === 'writeup' && !q ? 'check' : 'search', title: meetingWhen === 'writeup' && !q ? 'Every meeting is written up' : 'No meetings match', body: q ? 'Try another name, company or attendee.' : meetingWhen === 'upcoming' ? 'Nothing scheduled from today on.' : meetingWhen === 'writeup' ? 'Past meetings all have notes, decisions or action items.' : 'No past meetings yet.', compact: true })}</div>`;
    renderIcons(el);
    return;
  }
  if (sorted.length === 0) {
    el.innerHTML = `<div class="card">${emptyState({ icon: 'meeting', title: 'No meetings logged yet', body: 'Capture attendees, decisions and action items so nothing gets lost.', action: { label: 'New meeting', onclick: 'openMeetingModal(null)' } })}</div>`;
    renderIcons(el);
    return;
  }
  const row = (m: Meeting) => `<div class="meeting-row${m.isCancelled ? ' is-cancelled' : ''}" onclick="openMeetingDetail(${m.id})">
    <div class="meeting-row-top">
      <div class="meeting-title">${m.source === 'outlook' ? icon('calendar', 13) + ' ' : ''}${escHtml(m.title)}${m.isCancelled ? ' (Cancelled)' : ''}</div>
      <div class="meeting-date">${m.meetingDate ? fmtDate(m.meetingDate) : 'No date'}</div>
    </div>
    <div class="meeting-meta">${[
      escHtml(fmtTimeRange(m.startAt, m.endAt)),
      companyLink(m.companyId, m.companyName),
      (m.attendees || []).length ? `${m.attendees.length} attendee${m.attendees.length !== 1 ? 's' : ''}` : '',
      meetingSuggestionChip(m),
    ].filter(Boolean).join(' · ')}${marks(state.get(m.id))}</div>
  </div>`;
  // In "All" the two groups are separated, so a meeting tomorrow can't end up
  // below one next month.
  const divider = upcoming.length && past.length ? `<div class="list-divider">Earlier</div>` : '';
  el.innerHTML = meetingSuggestionsBanner() + upcoming.map(row).join('') + divider + past.map(row).join('');
  renderIcons(el);
}

/** What the list shows about a meeting's write-up. */
function marks(w: ReturnType<typeof writeUpState> | undefined): string {
  if (!w) return '';
  const out: string[] = [];
  if (w.openActions) out.push(`<span class="meeting-mark">${icon('check', 11)}${w.openActions} open action${w.openActions === 1 ? '' : 's'}</span>`);
  if (w.hasNotes) out.push(`<span class="meeting-mark" title="Has notes">${icon('note', 11)}Notes</span>`);
  if (w.needsWriteUp) out.push('<span class="meeting-mark is-todo">Not written up</span>');
  return out.length ? `<span class="meeting-marks">${out.join('')}</span>` : '';
}

export function openMeetingDetail(id: number): void {
  const m = S.meetings.find((x) => x.id === id);
  // A deleted meeting (an old link or history entry): back to the list, not a stale page.
  if (!m) { if (S.meetingEditId != null && document.getElementById('meeting-detail')?.classList.contains('open')) closeMeetingDetail(); return; }
  if (S.meetingEditId !== id) flushMeetingNotes();
  S.meetingEditId = id;
  (document.getElementById('md-title') as HTMLElement).textContent = m.title;
  (document.getElementById('md-badges') as HTMLElement).innerHTML = [
    m.isCancelled ? statusBadge('meeting', 'Cancelled') : '',
    m.source === 'outlook' ? '<span class="rec-badge">Outlook</span>' : '',
    m.meetingDate ? `<span class="rec-meta">${fmtDate(m.meetingDate)}${m.startAt ? ` · ${escHtml(fmtTimeRange(m.startAt, m.endAt))}` : ''}</span>` : '',
    (m.attendees || []).length ? `<span class="rec-meta" title="${escHtml(m.attendees.join(', '))}">${icon('people', 12)} ${m.attendees.length} attendee${m.attendees.length === 1 ? '' : 's'}</span>` : '',
  ].filter(Boolean).join('');

  const projSel = document.getElementById('md-project-sel') as HTMLSelectElement;
  projSel.innerHTML = `<option value="">— No project —</option>` + S.projects.filter((p) => !p.archived).map((p) => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
  projSel.value = m.projectId != null ? String(m.projectId) : '';
  const companyInp = document.getElementById('md-company-inp') as HTMLInputElement;
  companyInp.value = m.companyName || '';
  attachCompanySelector(companyInp);
  const oppSel = document.getElementById('md-opportunity-sel') as HTMLSelectElement;
  oppSel.innerHTML = `<option value="">— No opportunity —</option>` + S.opportunities.filter((o) => !o.archived).map((o) => `<option value="${o.id}">${escHtml(o.name)}</option>`).join('');
  oppSel.value = m.opportunityId != null ? String(m.opportunityId) : '';
  renderMeetingRelationLinks(m);

  // Before and during the meeting, the client brief comes first to prepare;
  // afterwards the recap does.
  const main = document.getElementById('md-main');
  const notesEl = document.getElementById('md-notes');
  const clientEl = document.getElementById('md-client');
  const peopleEl = document.getElementById('md-people');
  if (main && notesEl && clientEl && peopleEl) {
    if (isOver(m)) main.append(notesEl, clientEl, peopleEl);
    else main.append(clientEl, peopleEl, notesEl);
  }
  renderMeetingNotes(m);
  renderMeetingClientSection(m);
  renderEarlierMeetings(m);
  renderMeetingInvite(m);

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
  flushMeetingNotes();
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

/** "Open" links beside the meeting's project and opportunity pickers. */
function renderMeetingRelationLinks(m: Meeting): void {
  const project = m.projectId != null ? S.projects.find((p) => p.id === m.projectId) : undefined;
  const opp = m.opportunityId != null ? S.opportunities.find((o) => o.id === m.opportunityId) : undefined;
  const set = (id: string, html: string) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  set('md-company-link', m.companyName ? companyLink(m.companyId, m.companyName, { className: 'md-open-link' }).replace(`>${escHtml(m.companyName)}<`, '>Open<') : '');
  // Meeting notes live on this page now; a note filed from it before stays reachable.
  const note = m.noteId != null ? S.notes.find((n) => n.id === m.noteId) : undefined;
  set('md-note-link', note ? recordLink('note', note.id, note.title || 'Meeting note') : '');
  document.getElementById('md-note-dt')!.hidden = !note;
  document.getElementById('md-note-link')!.hidden = !note;
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


/** The meeting the dialog edits (null: a new meeting), and for a new meeting
 * the context it was started from (company, project, opportunity). */
let meetingModalEditId: number | null = null;
let meetingModalContext: WorkContext | null = null;

export function openMeetingModal(id: number | null, ctx: WorkContext | null = null): void {
  meetingModalEditId = id;
  meetingModalContext = id === null ? ctx : null;
  const f = document.getElementById('meeting-form') as HTMLFormElement;
  f.reset();
  const companyField = f.elements.namedItem('mtCompany') as HTMLInputElement | null;
  if (companyField) attachCompanySelector(companyField);
  const projSel = f.elements.namedItem('mtProject') as HTMLSelectElement | null;
  if (projSel) projSel.innerHTML = `<option value="">— No project —</option>` + S.projects.filter((p) => !p.archived).map((p) => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
  const oppSel = f.elements.namedItem('mtOpportunity') as HTMLSelectElement | null;
  if (oppSel) oppSel.innerHTML = `<option value="">— No opportunity —</option>` + S.opportunities.filter((o) => !o.archived).map((o) => `<option value="${o.id}">${escHtml(o.name)}</option>`).join('');

  if (id !== null) {
    const m = S.meetings.find((x) => x.id === id);
    if (!m) return;
    (document.getElementById('meeting-modal-title') as HTMLElement).textContent = 'Edit meeting';
    (document.getElementById('meeting-submit-btn') as HTMLElement).textContent = 'Save changes';
    (f.elements.namedItem('mtTitle') as HTMLInputElement).value = m.title;
    (f.elements.namedItem('mtDate') as HTMLInputElement).value = m.meetingDate || '';
    (f.elements.namedItem('mtStart') as HTMLInputElement).value = m.startAt ? new Date(m.startAt).toTimeString().slice(0, 5) : '';
    (f.elements.namedItem('mtEnd') as HTMLInputElement).value = m.endAt ? new Date(m.endAt).toTimeString().slice(0, 5) : '';
    (f.elements.namedItem('mtCompany') as HTMLInputElement).value = m.companyName || '';
    if (projSel) projSel.value = m.projectId != null ? String(m.projectId) : '';
    if (oppSel) oppSel.value = m.opportunityId != null ? String(m.opportunityId) : '';
    (f.elements.namedItem('mtAttendees') as HTMLInputElement).value = (m.attendees || []).join(', ');
  } else {
    (document.getElementById('meeting-modal-title') as HTMLElement).textContent = 'New meeting';
    (document.getElementById('meeting-submit-btn') as HTMLElement).textContent = 'Create meeting';
    if (ctx) {
      (f.elements.namedItem('mtCompany') as HTMLInputElement).value = ctx.companyName || '';
      if (projSel && ctx.projectId != null) projSel.value = String(ctx.projectId);
      if (oppSel && ctx.opportunityId != null) oppSel.value = String(ctx.opportunityId);
      (f.elements.namedItem('mtDate') as HTMLInputElement).value = today();
    }
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
  const existing = meetingModalEditId != null ? S.meetings.find((x) => x.id === meetingModalEditId) : null;
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

  // Company: the one the meeting (or its context) had while the field still
  // shows that name; a different typed name is an explicit reassignment; an
  // empty field takes the chosen project's (or opportunity's) company.
  const projectId = projVal ? Number(projVal) : null;
  const opportunityId = oppVal ? Number(oppVal) : null;
  const typed = (f.elements.namedItem('mtCompany') as HTMLInputElement).value;
  const known = existing ? { companyId: existing.companyId ?? null, companyName: existing.companyName } : meetingModalContext;
  const fromForm = { ...EMPTY_CONTEXT, ...companyFromForm(known, typed), projectId, opportunityId };
  // Only a new meeting inherits; clearing an existing meeting's company is deliberate.
  const company = existing ? fromForm : inheritCompany(S, fromForm);
  const draft: Meeting = {
    id: existing?.id ?? 0,
    title,
    meetingDate: mtDate || null,
    companyName: company.companyName,
    companyId: company.companyId,
    projectId,
    opportunityId,
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
  const fromContext = meetingModalContext != null;
  meetingModalContext = null;
  closeMeetingModal();
  renderMeetingList();
  if (!existing && (fromContext || document.getElementById('meeting-detail')?.classList.contains('open'))) {
    // A new meeting from a company, project, opportunity or another meeting: open it.
    (window as any).openRecord('meeting', saved.id);
  } else if (existing && S.meetingEditId === saved.id && document.getElementById('meeting-detail')?.classList.contains('open')) {
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
    const groups = orderMeetings(S.meetings.filter((m) => inCompany(ref, m.companyId, m.companyName)), 'all', today());
    const companyMeetings = [...groups.upcoming, ...groups.past];
    const cnt = document.getElementById('co-meetings-tab-count');
    if (cnt) cnt.textContent = companyMeetings.length ? String(companyMeetings.length) : '';
    if (companyMeetings.length === 0) {
      container.innerHTML = emptyState({ icon: 'meeting', title: `No meetings with ${d.name} yet`, compact: true, action: { label: 'New meeting', onclick: 'createMeetingForCurrentCompany()' } });
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
  const co = S.companies.find((c) => c.name === S.currentCompany);
  openMeetingModal(null, co ? contextFromCompany(co) : { ...EMPTY_CONTEXT, companyName: S.currentCompany });
}
expose('createMeetingForCurrentCompany', createMeetingForCurrentCompany);

/** New meeting for a project: its company and the project. */
export function createMeetingForProject(projectId: number | null = S.currentProjectId): void {
  const p = projectId != null ? S.projects.find((x) => x.id === projectId) : undefined;
  if (p) openMeetingModal(null, contextFromProject(S, p));
}
expose('createMeetingForProject', createMeetingForProject);

/** New meeting for an opportunity: its company and the opportunity. */
export function createMeetingForOpportunity(opportunityId: number | null = S.currentOpportunityId): void {
  const o = opportunityId != null ? S.opportunities.find((x) => x.id === opportunityId) : undefined;
  if (o) openMeetingModal(null, contextFromOpportunity(S, o));
}
expose('createMeetingForOpportunity', createMeetingForOpportunity);

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
