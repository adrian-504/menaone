// Reminders as Mac notifications: meetings shortly before they start, timed
// tasks when they're due, and a morning summary from My Day. Runs while MENA
// One is open (the window can be hidden). Settings live under Settings →
// General; what was already sent is kept in app_meta so a restart doesn't
// repeat it.

import { S } from '../lib/state';
import { escHtml, expose } from '../lib/utils';
import { toast } from '../lib/ui';
import { getActiveTabId } from '../lib/registry';
import { getAppMeta, setAppMeta } from '../lib/db';
import { DEFAULT_REMINDERS, dueReminders, pruneSent, type Reminder, type ReminderSettings } from '../lib/reminders';
import { mydaySummaryText } from './myday';
import { renderIcons } from '../core/chrome';

const w = window as any;
const inTauri = () => !!w.__TAURI_INTERNALS__?.invoke;

let settings: ReminderSettings = { ...DEFAULT_REMINDERS };
let sent: string[] = [];
let loaded = false;
let permission: 'granted' | 'denied' | 'unknown' = 'unknown';

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try { settings = { ...DEFAULT_REMINDERS, ...JSON.parse((await getAppMeta('reminder_settings')) || '{}') }; } catch { /* defaults */ }
  try { sent = JSON.parse((await getAppMeta('reminders_sent')) || '[]'); } catch { sent = []; }
}

const saveSettings = () => setAppMeta('reminder_settings', JSON.stringify(settings)).catch(() => undefined);
const saveSent = () => setAppMeta('reminders_sent', JSON.stringify(sent)).catch(() => undefined);

async function ensurePermission(ask: boolean): Promise<boolean> {
  if (!inTauri()) {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'default' && ask) await Notification.requestPermission();
    permission = Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'denied' : 'unknown';
    return permission === 'granted';
  }
  try {
    const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
    let granted = await isPermissionGranted();
    if (!granted && ask) {
      granted = (await requestPermission()) === 'granted';
      permission = granted ? 'granted' : 'denied';
      return granted;
    }
    // Not granted and not asked yet in this session: offer to ask.
    permission = granted ? 'granted' : permission === 'denied' ? 'denied' : 'unknown';
    return granted;
  } catch {
    permission = 'unknown';
    return false;
  }
}

async function notify(r: Reminder): Promise<void> {
  const granted = await ensurePermission(false);
  if (granted) {
    if (inTauri()) {
      const { sendNotification } = await import('@tauri-apps/plugin-notification');
      sendNotification({ title: r.title, body: r.body });
    } else {
      new Notification(r.title, { body: r.body });
    }
  }
  // Inside the app, the reminder also offers a way straight to the record.
  // The morning summary says what My Day already shows: no toast over it.
  if (!r.record && getActiveTabId() === 'myday') return;
  if (document.hasFocus() || !granted) {
    toast(r.title, { detail: r.body, duration: 12000, action: r.record ? { label: 'Open', run: () => w.openRecord(r.record!.kind, r.record!.id) } : { label: 'My Day', run: () => w.navToModule('myday') } });
  }
}

export async function checkReminders(): Promise<void> {
  await load();
  if (!settings.meetings && !settings.tasks && !settings.morning) return;
  const now = new Date();
  const due = dueReminders({ now, settings, meetings: S.meetings, todos: S.todos, sent: new Set(sent), morningSummary: mydaySummaryText });
  if (!due.length) return;
  for (const r of due) {
    sent.push(r.key);
    await notify(r);
  }
  sent = pruneSent(sent, now);
  void saveSent();
}

let timer: number | null = null;
export function startReminders(): void {
  if (timer != null) return;
  void load().then(() => ensurePermission(false)).then(() => checkReminders());
  timer = window.setInterval(() => { void checkReminders(); }, 30_000);
  window.addEventListener('focus', () => { void checkReminders(); });
}
expose('startReminders', startReminders);

// ── Settings card ───────────────────────────────────────────────────────────

const MINUTES = [0, 5, 10, 15, 30, 60];
const minuteLabel = (n: number) => (n === 0 ? 'When it starts' : n === 60 ? '1 hour before' : `${n} minutes before`);

export async function renderReminderSettings(): Promise<void> {
  const el = document.getElementById('reminder-settings-card');
  if (!el) return;
  await load();
  await ensurePermission(false);
  const sel = (id: string, value: string | number, options: [string | number, string][]) =>
    `<select class="fsel" id="${id}" onchange="reminderSettingChanged()">${options.map(([v, l]) => `<option value="${v}"${String(v) === String(value) ? ' selected' : ''}>${escHtml(l)}</option>`).join('')}</select>`;
  const toggle = (id: string, on: boolean) => `<input type="checkbox" class="switch" id="${id}" ${on ? 'checked' : ''} onchange="reminderSettingChanged()">`;
  el.innerHTML = `<div class="sec settings-card">
    <div class="settings-card-hd"><span data-icon="clock"></span><div class="card-hd">Reminders</div></div>
    <p class="settings-card-desc">Mac notifications while MENA One is open, even with its window hidden.</p>
    ${permission === 'denied' ? `<div class="settings-callout tone-amber">Notifications are turned off for MENA One. Allow them in System Settings → Notifications → MENA One.</div>`
      : permission === 'unknown' ? `<div class="settings-callout tone-accent">MENA One needs your permission to show notifications. <button class="btn-secondary btn-sm" onclick="sendTestReminder()">Allow notifications</button></div>` : ''}
    <div class="rem-rows">
      <label class="rem-row">${toggle('rem-meetings', settings.meetings)}<span class="rem-label"><strong>Meetings</strong><span>Before each meeting in your calendar</span></span>${sel('rem-meeting-min', settings.meetingMinutes, MINUTES.map((n) => [n, minuteLabel(n)]))}</label>
      <label class="rem-row">${toggle('rem-tasks', settings.tasks)}<span class="rem-label"><strong>Tasks with a time</strong><span>e.g. "Call Globex tomorrow 3pm"</span></span>${sel('rem-task-min', settings.taskMinutes, MINUTES.map((n) => [n, n === 0 ? 'At the due time' : minuteLabel(n)]))}</label>
      <label class="rem-row">${toggle('rem-morning', settings.morning)}<span class="rem-label"><strong>Morning summary</strong><span>Meetings, tasks and what needs attention, from My Day</span></span>
        <span class="rem-inline"><input type="time" id="rem-morning-at" value="${escHtml(settings.morningAt)}" onchange="reminderSettingChanged()">${sel('rem-workweek', settings.workweek, [['sun-thu', 'Sunday–Thursday'], ['mon-fri', 'Monday–Friday'], ['every-day', 'Every day']])}</span></label>
    </div>
    <div class="btn-row"><button class="btn-secondary" onclick="sendTestReminder()">Send a test notification</button></div>
  </div>`;
  renderIcons(el);
}
expose('renderReminderSettings', renderReminderSettings);

export function reminderSettingChanged(): void {
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value || '';
  const on = (id: string) => !!(document.getElementById(id) as HTMLInputElement | null)?.checked;
  const wasOff = !settings.meetings && !settings.tasks && !settings.morning;
  settings = {
    meetings: on('rem-meetings'), meetingMinutes: Number(val('rem-meeting-min')), tasks: on('rem-tasks'), taskMinutes: Number(val('rem-task-min')),
    morning: on('rem-morning'), morningAt: val('rem-morning-at') || DEFAULT_REMINDERS.morningAt, workweek: (val('rem-workweek') || 'sun-thu') as ReminderSettings['workweek'],
  };
  void saveSettings();
  if (wasOff && (settings.meetings || settings.tasks || settings.morning)) void ensurePermission(true);
}
expose('reminderSettingChanged', reminderSettingChanged);

export async function sendTestReminder(): Promise<void> {
  const granted = await ensurePermission(true);
  if (!granted) {
    toast('Notifications are off for MENA One', { tone: 'error', detail: 'Allow them in System Settings → Notifications → MENA One, then try again.' });
    void renderReminderSettings();
    return;
  }
  await notify({ key: 'test', title: 'Reminders are on', body: mydaySummaryText() });
}
expose('sendTestReminder', sendTestReminder);
