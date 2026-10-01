import { noteSync, OFFLINE_LABEL } from '../lib/offline';
import { S } from '../lib/state';
import { toast } from '../lib/ui';
import { escHtml, expose, today, fmtTime, fmtDayLong, strColor } from '../lib/utils';
import { tileHtml } from '../lib/pageKit';
import { allDayChips, eventState, nowLine, placeBlocks, rangeLabel, rangeStats, syncedLabel, DAY_START_HOUR, DAY_END_HOUR, HOUR_PX, type AllDayChip } from '../lib/calendarGrid';
import { attachCompanySelector } from '../lib/companySelector';
import { registerTabRenderer, getActiveTabId } from '../lib/registry';
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
  document.querySelectorAll('.cal-vbtn').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.view === S.calendarView));

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
      noteSync('calendar', null, () => loadAndRenderCalendar());
    } catch (err) {
      // Previously swallowed entirely — indistinguishable from "zero events
      // this week." Still non-fatal (render whatever's cached locally), but
      // the real error now surfaces in the sync sub-label instead of being
      // discarded, so an auth/scope failure is visible instead of silent.
      // Offline is not an error: a quiet mark, and it tries again by itself (O3).
      if (noteSync('calendar', err, () => loadAndRenderCalendar())) S.calendarSyncError = null;
      else { console.error('[calendar] sync failed:', err); S.calendarSyncError = String(err); }
    }
    S.calendarSyncing = false;
  } else {
    S.meetings = await getMeetings();
  }
  paintSyncSub();
  paintCalendar();
}

/** The line above the grid: the range in Saira, then how many meetings and how long. */
function paintRangeLabel(start: Date, end: Date): void {
  const el = document.getElementById('cal-range-label');
  if (!el) return;
  const stats = document.getElementById('cal-stats');
  const a = anchorDate();
  const from = S.calendarView === 'month' ? toIsoDate(new Date(a.getFullYear(), a.getMonth(), 1)) : toIsoDate(start);
  const to = S.calendarView === 'month' ? toIsoDate(new Date(a.getFullYear(), a.getMonth() + 1, 0)) : toIsoDate(end);
  el.textContent = S.calendarView === 'month' ? `${MONTH_NAMES[a.getMonth()]} ${a.getFullYear()}` : S.calendarView === 'day' ? fmtDayLong(from, true) : rangeLabel(from, to);
  if (stats) stats.textContent = rangeStats(S.meetings, from, to);
}

function paintSyncSub(): void {
  const el = document.getElementById('cal-sync-sub');
  if (!el) return;
  const say = (text: string, state: '' | 'ok' | 'bad' = '') => { el.textContent = text; el.classList.toggle('is-ok', state === 'ok'); el.classList.toggle('c-red', state === 'bad'); };
  if (!S.ms365Status || S.ms365Status.status !== 'connected') return say('Not connected to Microsoft 365');
  if (S.calendarSyncing) return say('Syncing…');
  if (S.ms365Offline) return say(OFFLINE_LABEL);
  if (S.calendarSyncError) return say(`Sync failed — ${S.calendarSyncError}`, 'bad');
  const label = syncedLabel(S.ms365Status.lastSyncAt, new Date());
  say(label, label ? 'ok' : '');
}

function paintCalendar(keepScroll = false): void {
  const root = document.getElementById('cal-root');
  if (!root) return;
  const { start, end } = getRange();
  paintRangeLabel(start, end);
  if (S.calendarView === 'month') { root.innerHTML = renderMonthGrid(); return; }
  const days: Date[] = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) days.push(new Date(d));
  const was = keepScroll ? document.getElementById('cal-gscroll')?.scrollTop : undefined;
  root.innerHTML = renderTimeGrid(days);
  // Opens on the working day: 08:00 at the top (earlier when something starts before it), unless the place is being kept.
  const scroll = document.getElementById('cal-gscroll');
  if (scroll) scroll.scrollTop = was ?? Math.max(0, firstHour(days) * HOUR_PX - HOUR_LEAD_PX);
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

// ── Week and day: a time grid ───────────────────────────────────────────────

/** Colour = client: the client's tile colour; MENA BIG's own for a meeting with no client. */
const INTERNAL = 'MENA BIG';
const colourOf = (m: Pick<Meeting, 'companyName'>): string => (m.companyName ? strColor(m.companyName) : 'var(--tile-3)');

const isTimed = (m: Meeting) => !!m.startAt && /T\d/.test(m.startAt);

/** The hour the grid opens on: 08:00, or the hour of the earliest event shown when that is sooner. */
function firstHour(days: Date[]): number {
  const earliest = days.flatMap((d) => eventsOnDay(d).filter((m) => isTimed(m) && !m.isCancelled)).map((m) => new Date(m.startAt!).getHours());
  return Math.min(DAY_START_HOUR, ...earliest);
}

/** Room above the first hour's line, so its label is not cut. */
const HOUR_LEAD_PX = 10;
const CHIPS_SHOWN = 2;
const chipOpen = (c: AllDayChip): string => (c.kind === 'task' ? `openRecord('task', ${c.id})` : c.kind === 'promise' ? `openCommitmentSource(${c.id})` : c.kind === 'expiry' ? `openRecord('proposal', ${c.id})` : `openRecord('meeting', ${c.id})`);
const chipHtml = (c: AllDayChip): string => `<button class="cal-chip t-${c.tone}" onclick="${chipOpen(c)}" data-tip="${escHtml(c.text)}"><i aria-hidden="true">${c.glyph}</i><span>${escHtml(c.text)}</span></button>`;

function eventBlock(m: Meeting, b: { top: number; height: number; col: number; cols: number; short: boolean }, now: Date): string {
  const state = m.isCancelled ? 'past' : eventState(m, now);
  const time = fmtTime(m.startAt);
  // Who it is with: the first attendee by name (an address reads as the contact it belongs to, or is left out).
  const who = (m.attendees || []).filter((x) => x && x !== m.organizer).map((x) => (x.includes('@') ? S.contacts.find((c) => c.email?.toLowerCase() === x.toLowerCase())?.name || '' : x)).find(Boolean) || '';
  const join = m.isOnlineMeeting && m.onlineMeetingUrl && !m.isCancelled && state !== 'past'
    ? `<a href="${escHtml(m.onlineMeetingUrl)}" target="_blank" rel="noopener" class="cal-ev-join" onclick="event.stopPropagation()">Join</a>` : '';
  const where = join || escHtml(m.isOnlineMeeting ? 'Teams' : m.location || '');
  const sub = [escHtml(time), escHtml(who), where].filter(Boolean).join(' · ');
  const width = 100 / b.cols;
  return `<div class="cal-ev${b.short ? ' is-short' : ''}${state === 'past' ? ' is-past' : state === 'now' ? ' is-now' : ''}${m.isCancelled ? ' is-cancelled' : ''}" role="button" tabindex="0" style="--c:${colourOf(m)};top:${b.top}px;height:${b.height}px;left:${(b.col * width).toFixed(2)}%;width:${width.toFixed(2)}%"
    onclick="openRecord('meeting', ${m.id})" onkeydown="if(event.key==='Enter')this.click()" data-tip="${escHtml(`${m.title} · ${time}${m.endAt ? `–${fmtTime(m.endAt)}` : ''}${m.companyName ? ` · ${m.companyName}` : ''}`)}">
    <div class="cal-ev-in"><b>${escHtml(m.title)}${m.isCancelled ? ' (cancelled)' : ''}</b><span>${sub}</span></div>
  </div>`;
}

/** The week (seven columns) or the day (one): an hour gutter, a header per day, the all-day row, and the events as
 * blocks placed by their start and end. The whole day is there; it opens on 08:00–18:00 and scrolls. */
function renderTimeGrid(days: Date[]): string {
  const now = new Date();
  const isos = days.map(toIsoDate);
  const line = nowLine(now, isos);
  const input = { meetings: S.meetings, todos: S.todos, commitments: S.commitments, proposals: S.proposals };
  const chips = isos.map((d) => allDayChips(d, input));
  const hasChips = chips.some((c) => c.length);
  const cls = (d: Date, i: number) => `${line?.index === i ? ' is-today' : ''}${d.getDay() === 0 || d.getDay() === 6 ? ' is-weekend' : ''}`;
  const head = days.map((d, i) => `<button class="cal-dh${cls(d, i)}" onclick="jumpToDay('${isos[i]}')" aria-label="${escHtml(fmtDayLong(isos[i]))}${line?.index === i ? ', today' : ''}">
      <b>${d.getDate()}</b><span>${DOW[d.getDay()]}${line?.index === i ? ' · today' : ''}</span></button>`).join('');
  const allDay = hasChips ? `<div class="cal-gut cal-ad-l">all-day</div>${chips.map((list, i) => `<div class="cal-ad${cls(days[i], i)}">${list.slice(0, CHIPS_SHOWN).map(chipHtml).join('')}${list.length > CHIPS_SHOWN ? `<button class="cal-chip t-grey is-more" onclick="jumpToDay('${isos[i]}')">+${list.length - CHIPS_SHOWN} more</button>` : ''}</div>`).join('')}` : '';
  const hours = Array.from({ length: 23 }, (_, h) => `<span style="top:${(h + 1) * HOUR_PX}px">${String(h + 1).padStart(2, '0')}:00</span>`).join('');
  const cols = days.map((d, i) => {
    const events = eventsOnDay(d).filter(isTimed);
    const byId = new Map(events.map((m) => [m.id, m]));
    const blocks = placeBlocks(events, isos[i]).map((b) => eventBlock(byId.get(b.id)!, b, now)).join('');
    return `<div class="cal-col${cls(d, i)}">${blocks}${line?.index === i ? `<i class="cal-now" style="top:${line.top}px" aria-hidden="true"></i>` : ''}</div>`;
  }).join('');
  // Colour = client: the clients with a meeting on screen, then MENA BIG's own when one has no client.
  const shown = days.flatMap((d) => eventsOnDay(d)).filter((m) => !m.isCancelled);
  const clients = [...new Set(shown.map((m) => m.companyName).filter((x): x is string => !!x))].sort();
  const legend = shown.length ? `<div class="cal-legend"><span>Colour = client</span>${clients.map((c) => `<span class="pk-mini-co">${tileHtml(c, 'pk-tile mini')}${escHtml(c)}</span>`).join('')}${shown.some((m) => !m.companyName) ? `<span class="pk-mini-co"><span class="pk-tile mini is-internal" aria-hidden="true">MB</span>Internal</span>` : ''}${hasChips ? '<span class="cal-legend-r">All-day row: tasks, promises, expiries</span>' : ''}</div>` : '';
  return `<div class="cal-grid${days.length === 1 ? ' is-day' : ''}" style="--days:${days.length};--hours:${DAY_END_HOUR - DAY_START_HOUR}">
    <div class="cal-ghead"><div class="cal-gut"></div>${head}${allDay}</div>
    <div class="cal-gscroll" id="cal-gscroll" tabindex="-1">
      <div class="cal-gbody"><div class="cal-gut cal-hours" aria-hidden="true">${hours}</div>${cols}</div>
    </div>
  </div>${legend}`;
}

function renderMonthGrid(): string {
  const { start, end } = getRange();
  const a = anchorDate();
  // The weeks start on Monday, and so does the row of day names.
  const cells: string[] = [...DOW.slice(1), DOW[0]].map((d) => `<div class="cal-month-dow">${d}</div>`);
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const evts = eventsOnDay(d);
    const isOtherMonth = d.getMonth() !== a.getMonth();
    const isToday = sameDate(d, new Date());
    const dIso = toIsoDate(d);
    cells.push(`<div class="cal-month-cell${isOtherMonth ? ' other-month' : ''}${isToday ? ' today' : ''}" onclick="jumpToDay('${dIso}')">
      <div class="cal-month-daynum">${d.getDate()}</div>
      ${evts.slice(0, 3).map((m) => `<div class="cal-month-evt is-client${m.isCancelled ? ' is-cancelled' : ''}" style="--c:${colourOf(m)}">${isTimed(m) ? `<i>${escHtml(fmtTime(m.startAt))}</i>` : ''}${escHtml(m.title)}</div>`).join('')}
      ${evts.length > 3 ? `<div class="cal-month-evt t-muted">+${evts.length - 3} more</div>` : ''}
    </div>`);
  }
  return `<div class="cal-month-grid">${cells.join('')}</div>`;
}

// The now-line and what counts as over follow the clock while the calendar is open.
window.setInterval(() => {
  if (getActiveTabId() === 'calendar' && S.calendarView !== 'month' && document.getElementById('cal-gscroll')) paintCalendar(true);
}, 60_000);

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
  const omCompany = (document.getElementById('outlook-meeting-form') as HTMLFormElement | null)?.elements.namedItem('omCompany') as HTMLInputElement | null;
  if (omCompany) attachCompanySelector(omCompany);
  const projSel = f.elements.namedItem('omProject') as HTMLSelectElement | null;
  if (projSel) projSel.innerHTML = `<option value="">— No project —</option>` + S.projects.filter((p) => !p.archived).map((p) => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');

  const teamsChk = f.elements.namedItem('omTeams') as HTMLInputElement;
  if (id !== null) {
    const m = S.meetings.find((x) => x.id === id);
    if (!m) return;
    (document.getElementById('om-modal-title') as HTMLElement).textContent = 'Edit meeting';
    (document.getElementById('om-submit-btn') as HTMLElement).textContent = 'Save changes';
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
    (document.getElementById('om-modal-title') as HTMLElement).textContent = 'New meeting';
    (document.getElementById('om-submit-btn') as HTMLElement).textContent = 'Create meeting';
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
    toast('Connect Microsoft 365 in Settings before scheduling a meeting', { action: { label: 'Open settings', run: () => (window as any).switchTab('settings') } });
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

// Repainted when Outlook goes offline or comes back (lib/offline.ts).
expose('paintCalendarSyncSub', paintSyncSub);
