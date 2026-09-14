import { S } from '../lib/state';
import { toast } from '../lib/ui';
import { escHtml, expose, today } from '../lib/utils';
import { registerTabRenderer } from '../lib/registry';
import {
  ms365Status, ms365SyncCalendar, ms365CreateTeamsMeeting, ms365UpdateOutlookMeeting,
  getMeetings, saveMeeting,
} from '../lib/db';
import type { CreateTeamsMeetingInput } from '../lib/db';
import { getAllCompanies } from './companies';
import type { Meeting } from '../lib/types';
import { icon } from '../lib/icons';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function anchorDate(): Date {
  const [y, m, d] = S.calendarAnchor.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function startOfWeek(d: Date): Date {
  const r = new Date(d);
  const dow = r.getDay(); // 0=Sun
  const diff = dow === 0 ? -6 : 1 - dow; // Monday-start week
  return addDays(r, diff);
}
function sameDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Range actually synced/displayed for the current view — always padded to
 * whole local days so a meeting near midnight never falls just outside it. */
function getRange(): { start: Date; end: Date } {
  const a = anchorDate();
  if (S.calendarView === 'day') return { start: a, end: a };
  if (S.calendarView === 'week') {
    const start = startOfWeek(a);
    return { start, end: addDays(start, 6) };
  }
  const monthStart = new Date(a.getFullYear(), a.getMonth(), 1);
  const monthEnd = new Date(a.getFullYear(), a.getMonth() + 1, 0);
  // Month view's grid shows the leading/trailing days of adjacent weeks too —
  // sync that full visible range, not just the calendar month itself.
  return { start: startOfWeek(monthStart), end: addDays(startOfWeek(addDays(monthEnd, 7)), -1) };
}

export function setCalendarView(v: string): void {
  S.calendarView = v as typeof S.calendarView;
  document.querySelectorAll('.cal-vbtn').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.view === v));
  void loadAndRenderCalendar();
}
expose('setCalendarView', setCalendarView);

export function calendarNav(dir: number): void {
  if (dir === 0) { S.calendarAnchor = today(); void loadAndRenderCalendar(); return; }
  const a = anchorDate();
  const step = S.calendarView === 'day' ? 1 : S.calendarView === 'week' ? 7 : 0;
  const next = S.calendarView === 'month'
    ? new Date(a.getFullYear(), a.getMonth() + dir, 1)
    : addDays(a, step * dir);
  S.calendarAnchor = toIsoDate(next);
  void loadAndRenderCalendar();
}
expose('calendarNav', calendarNav);

async function loadAndRenderCalendar(): Promise<void> {
  if (!S.ms365Status) S.ms365Status = await ms365Status();
  const { start, end } = getRange();
  paintRangeLabel(start, end);

  if (S.ms365Status.status === 'connected') {
    S.calendarSyncing = true;
    paintSyncSub();
    try {
      const startIso = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0).toISOString();
      const endIso = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59).toISOString();
      await ms365SyncCalendar(startIso, endIso);
      S.meetings = await getMeetings();
      void (window as any).autoLinkMeetings?.();
      S.calendarSyncError = null;
    } catch (err) {
      // Previously swallowed entirely — indistinguishable from "zero events
      // this week." Still non-fatal (render whatever's cached locally), but
      // the real error now surfaces in the sync sub-label instead of being
      // discarded, so an auth/scope failure is visible instead of silent.
      console.error('[calendar] sync failed:', err);
      S.calendarSyncError = String(err);
    }
    S.calendarSyncing = false;
  } else {
    S.meetings = await getMeetings();
  }
  paintSyncSub();
  paintCalendar();
}

function paintRangeLabel(start: Date, end: Date): void {
  const el = document.getElementById('cal-range-label');
  if (!el) return;
  if (S.calendarView === 'month') { el.textContent = `${MONTH_NAMES[anchorDate().getMonth()]} ${anchorDate().getFullYear()}`; return; }
  if (S.calendarView === 'day') { el.textContent = `${DOW[start.getDay()]}, ${MONTH_NAMES[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()}`; return; }
  const sameMonth = start.getMonth() === end.getMonth();
  el.textContent = sameMonth
    ? `${MONTH_NAMES[start.getMonth()]} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`
    : `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} – ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
}

function paintSyncSub(): void {
  const el = document.getElementById('cal-sync-sub');
  if (!el) return;
  if (!S.ms365Status || S.ms365Status.status !== 'connected') { el.textContent = 'Not connected to Microsoft 365'; el.classList.remove('c-red'); return; }
  if (S.calendarSyncing) { el.textContent = 'Syncing…'; el.classList.remove('c-red'); return; }
  if (S.calendarSyncError) {
    el.textContent = `Sync failed — ${S.calendarSyncError}`;
    el.classList.add('c-red');
    return;
  }
  el.classList.remove('c-red');
  el.textContent = S.ms365Status.lastSyncAt ? `Synced ${S.ms365Status.lastSyncAt}` : '';
}

function paintCalendar(): void {
  const root = document.getElementById('cal-root');
  if (!root) return;
  if (S.calendarView === 'month') { root.innerHTML = renderMonthGrid(); return; }
  const { start, end } = getRange();
  const days: Date[] = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) days.push(new Date(d));
  root.innerHTML = days.map(renderDaySection).join('');
}

function eventsOnDay(d: Date): Meeting[] {
  return S.meetings
    .filter((m) => {
      const ref = m.startAt || m.meetingDate;
      if (!ref) return false;
      return sameDate(new Date(ref), d);
    })
    .sort((a, b) => (a.startAt || a.meetingDate || '').localeCompare(b.startAt || b.meetingDate || ''));
}

function renderDaySection(d: Date): string {
  const evts = eventsOnDay(d);
  const isToday = sameDate(d, new Date());
  return `<div class="cal-day-section">
    <div class="cal-day-hd${isToday ? ' today' : ''}">${DOW[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}${isToday ? ' · Today' : ''}</div>
    ${evts.length === 0
      ? `<div class="feed-empty">No meetings.</div>`
      : evts.map(eventRow).join('')}
  </div>`;
}

function eventRow(m: Meeting): string {
  const timeLabel = m.startAt ? `${fmtTime(m.startAt)}${m.endAt ? ` – ${fmtTime(m.endAt)}` : ''}` : 'All day';
  const meta = [m.organizer ? `Organizer: ${m.organizer}` : '', m.location || '', m.companyName || ''].filter(Boolean).join(' · ');
  return `<div class="cal-event-row${m.isCancelled ? ' cancelled' : ''}" onclick="openRecord('meeting', ${m.id})">
    <div class="cal-event-time">${escHtml(timeLabel)}</div>
    <div class="cal-event-body">
      <div class="cal-event-title">${escHtml(m.title)}${m.isCancelled ? ' (Cancelled)' : ''}</div>
      ${meta ? `<div class="cal-event-meta">${escHtml(meta)}</div>` : ''}
    </div>
    ${m.isOnlineMeeting && m.onlineMeetingUrl && !m.isCancelled ? `<a href="${escHtml(m.onlineMeetingUrl)}" target="_blank" rel="noopener" class="btn-sm" onclick="event.stopPropagation()">${icon('link', 12)} Join Teams</a>` : ''}
  </div>`;
}

function renderMonthGrid(): string {
  const { start, end } = getRange();
  const a = anchorDate();
  const cells: string[] = DOW.map((d) => `<div class="cal-month-dow">${d}</div>`);
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const evts = eventsOnDay(d);
    const isOtherMonth = d.getMonth() !== a.getMonth();
    const isToday = sameDate(d, new Date());
    const dIso = toIsoDate(d);
    cells.push(`<div class="cal-month-cell${isOtherMonth ? ' other-month' : ''}${isToday ? ' today' : ''}" onclick="jumpToDay('${dIso}')">
      <div class="cal-month-daynum">${d.getDate()}</div>
      ${evts.slice(0, 3).map((m) => `<div class="cal-month-evt">${escHtml(m.title)}</div>`).join('')}
      ${evts.length > 3 ? `<div class="cal-month-evt t-muted">+${evts.length - 3} more</div>` : ''}
    </div>`);
  }
  return `<div class="cal-month-grid">${cells.join('')}</div>`;
}

export function jumpToDay(iso: string): void {
  S.calendarAnchor = iso;
  S.calendarView = 'day';
  document.querySelectorAll('.cal-vbtn').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.view === 'day'));
  void loadAndRenderCalendar();
}
expose('jumpToDay', jumpToDay);

registerTabRenderer('calendar', () => { void loadAndRenderCalendar(); });

// ═══════════════ New / Edit Outlook meeting modal ═══════════════

export function openOutlookMeetingModal(id: number | null): void {
  S.outlookMeetingEditId = id;
  const f = document.getElementById('outlook-meeting-form') as HTMLFormElement;
  f.reset();
  const dl = document.getElementById('om-company-list'); if (dl) dl.innerHTML = getAllCompanies().map((c) => `<option value="${escHtml(c)}">`).join('');
  const projSel = f.elements.namedItem('omProject') as HTMLSelectElement | null;
  if (projSel) projSel.innerHTML = `<option value="">— No project —</option>` + S.projects.filter((p) => !p.archived).map((p) => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');

  const teamsChk = f.elements.namedItem('omTeams') as HTMLInputElement;
  if (id !== null) {
    const m = S.meetings.find((x) => x.id === id);
    if (!m) return;
    (document.getElementById('om-modal-title') as HTMLElement).textContent = 'Edit Meeting';
    (document.getElementById('om-submit-btn') as HTMLElement).textContent = 'Save Changes';
    (f.elements.namedItem('omSubject') as HTMLInputElement).value = m.title;
    if (m.startAt) {
      const s = new Date(m.startAt);
      (f.elements.namedItem('omDate') as HTMLInputElement).value = toIsoDate(s);
      (f.elements.namedItem('omStart') as HTMLInputElement).value = s.toTimeString().slice(0, 5);
    }
    if (m.endAt) (f.elements.namedItem('omEnd') as HTMLInputElement).value = new Date(m.endAt).toTimeString().slice(0, 5);
    (f.elements.namedItem('omLocation') as HTMLInputElement).value = m.location || '';
    (f.elements.namedItem('omAttendees') as HTMLInputElement).value = (m.attendees || []).join(', ');
    (f.elements.namedItem('omCompany') as HTMLInputElement).value = m.companyName || '';
    if (projSel) projSel.value = m.projectId != null ? String(m.projectId) : '';
    (f.elements.namedItem('omDescription') as HTMLTextAreaElement).value = m.discussion || '';
    teamsChk.checked = m.isOnlineMeeting;
  } else {
    (document.getElementById('om-modal-title') as HTMLElement).textContent = 'New Meeting';
    (document.getElementById('om-submit-btn') as HTMLElement).textContent = 'Create Meeting';
    (f.elements.namedItem('omDate') as HTMLInputElement).value = S.calendarAnchor || today();
    teamsChk.checked = true;
  }
  document.getElementById('modal-outlook-meeting')?.classList.add('open');
}
expose('openOutlookMeetingModal', openOutlookMeetingModal);

export function closeOutlookMeetingModal(): void {
  document.getElementById('modal-outlook-meeting')?.classList.remove('open');
}
expose('closeOutlookMeetingModal', closeOutlookMeetingModal);

export async function submitOutlookMeeting(e: Event): Promise<void> {
  e.preventDefault();
  if (!S.ms365Status || S.ms365Status.status !== 'connected') {
    toast('Connect Microsoft 365 in Settings before scheduling a meeting', { action: { label: 'Open Settings', run: () => (window as any).switchTab('settings') } });
    return;
  }
  const f = e.target as HTMLFormElement;
  const subject = (f.elements.namedItem('omSubject') as HTMLInputElement).value.trim();
  const date = (f.elements.namedItem('omDate') as HTMLInputElement).value;
  const startTime = (f.elements.namedItem('omStart') as HTMLInputElement).value;
  const endTime = (f.elements.namedItem('omEnd') as HTMLInputElement).value;
  if (!subject || !date || !startTime || !endTime) return;

  const startLocal = new Date(`${date}T${startTime}`);
  const endLocal = new Date(`${date}T${endTime}`);
  if (endLocal <= startLocal) { toast('End time must be after start time', { tone: 'error' }); return; }

  const attendeeEmails = (f.elements.namedItem('omAttendees') as HTMLInputElement).value
    .split(',').map((a) => a.trim()).filter(Boolean);

  const input: CreateTeamsMeetingInput = {
    subject,
    startIso: startLocal.toISOString(),
    endIso: endLocal.toISOString(),
    timeZone: 'UTC', // ISO strings above are already UTC instants — see fmtTime's use of local Date for display only.
    description: (f.elements.namedItem('omDescription') as HTMLTextAreaElement).value.trim(),
    location: (f.elements.namedItem('omLocation') as HTMLInputElement).value.trim(),
    attendeeEmails,
    isTeamsMeeting: (f.elements.namedItem('omTeams') as HTMLInputElement).checked,
  };

  const submitBtn = document.getElementById('om-submit-btn') as HTMLButtonElement;
  submitBtn.disabled = true;
  try {
    const existing = S.outlookMeetingEditId != null ? S.meetings.find((m) => m.id === S.outlookMeetingEditId) : null;
    let saved: Meeting;
    if (existing?.outlookEventId) {
      saved = await ms365UpdateOutlookMeeting(existing.outlookEventId, input);
    } else {
      saved = await ms365CreateTeamsMeeting(input);
    }
    // Company/Project are local-only associations (Graph has no such
    // concept) — patch them onto the newly-upserted row directly via the
    // plain save path so they don't require a second Graph round-trip.
    const companyName = (f.elements.namedItem('omCompany') as HTMLInputElement).value.trim() || null;
    const projVal = (f.elements.namedItem('omProject') as HTMLSelectElement).value;
    if (companyName || projVal) {
      saved = await saveMeeting({ ...saved, companyName, projectId: projVal ? Number(projVal) : null });
    }
    S.meetings = S.meetings.filter((m) => m.id !== saved.id);
    S.meetings.push(saved);
    closeOutlookMeetingModal();
    paintCalendar();
  } catch (err) {
    toast('Could not save this meeting to Outlook', { tone: 'error', detail: String(err) });
  }
  submitBtn.disabled = false;
}
expose('submitOutlookMeeting', submitOutlookMeeting);
