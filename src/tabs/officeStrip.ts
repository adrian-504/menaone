// The slim strip under the My Day greeting: a clock for each office with the
// weather and whether people there are at work, and a line for public
// holidays in the coming week. Both can be switched off in Settings → General.

import { getActiveTabId } from '../lib/registry';
import { renderIcons } from '../core/chrome';
import { escHtml, expose } from '../lib/utils';
import { icon } from '../lib/icons';
import { getAppMeta, setAppMeta, weatherNow, type WeatherNow } from '../lib/db';
import { OFFICES, STATUS_LABEL, localParts, officeStatus } from '../lib/offices';
import { holidaysFor, upcomingHolidays, type HolidayCountry } from '../lib/holidays';

interface StripSettings { clocks: boolean; holidays: boolean }
const DEFAULTS: StripSettings = { clocks: true, holidays: true };
const SETTINGS_KEY = 'myday_strip';

let settings: StripSettings = { ...DEFAULTS };
let settingsLoaded = false;

async function loadSettings(): Promise<void> {
  if (settingsLoaded) return;
  settingsLoaded = true;
  try { settings = { ...DEFAULTS, ...JSON.parse((await getAppMeta(SETTINGS_KEY)) || '{}') }; } catch { /* defaults */ }
}

// ── Weather: fetched at most every 30 minutes (MET Norway's data refreshes
// about that often); after a failure, tried again in 10.
const WEATHER_TTL = 30 * 60_000;
const RETRY_AFTER_FAILURE = 10 * 60_000;
let weather = new Map<string, WeatherNow>();
let weatherFetchedAt = 0;
let weatherInFlight = false;

function refreshWeatherIfStale(): void {
  if (weatherInFlight || Date.now() - weatherFetchedAt < WEATHER_TTL) return;
  weatherInFlight = true;
  weatherNow(OFFICES.map((o) => ({ id: o.id, lat: o.lat, lon: o.lon })))
    .then((list) => {
      if (list.length) {
        weather = new Map(list.map((w) => [w.id, w]));
        weatherFetchedAt = Date.now();
      } else {
        weatherFetchedAt = Date.now() - WEATHER_TTL + RETRY_AFTER_FAILURE;
      }
    })
    .catch(() => { weatherFetchedAt = Date.now() - WEATHER_TTL + RETRY_AFTER_FAILURE; })
    .finally(() => { weatherInFlight = false; renderOfficeStrip(); });
}

/** MET Norway symbol → icon and words. Night variants keep the moon. */
export function weatherLook(symbol: string): { iconName: string; label: string } {
  const s = symbol.toLowerCase();
  if (s.includes('thunder')) return { iconName: 'storm', label: 'Thunder' };
  if (s.includes('snow') || s.includes('sleet')) return { iconName: 'snow', label: s.includes('sleet') ? 'Sleet' : 'Snow' };
  if (s.includes('rain') || s.includes('showers')) return { iconName: 'rain', label: s.includes('light') ? 'Light rain' : 'Rain' };
  if (s.startsWith('fog')) return { iconName: 'fog', label: 'Fog' };
  if (s.startsWith('partlycloudy')) return { iconName: s.endsWith('_night') ? 'cloud-moon' : 'cloud-sun', label: 'Partly cloudy' };
  if (s.startsWith('cloudy')) return { iconName: 'cloud', label: 'Cloudy' };
  const night = s.endsWith('_night') || s.endsWith('_polartwilight');
  return { iconName: night ? 'moon' : 'sun', label: s.startsWith('fair') ? 'Mostly clear' : 'Clear' };
}

const CITY_FOR: Record<HolidayCountry, string> = { SA: 'Riyadh', LB: 'Beirut', ES: 'Barcelona' };

function holidayLine(now: Date): string {
  const todayIso = localParts(now, Intl.DateTimeFormat().resolvedOptions().timeZone).date;
  const items = upcomingHolidays(todayIso, 7).slice(0, 3);
  if (!items.length) return '';
  const day = (iso: string) => iso === todayIso
    ? 'Today'
    : new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return items.map((h) => `<span class="mdy-holiday"><strong>${escHtml(day(h.date))}</strong> ${escHtml(h.name.replace(/ \((Barcelona|Catalonia)\)$/, ''))}${h.expected ? ' <span class="mdy-holiday-note">(expected)</span>' : ''} · ${escHtml(CITY_FOR[h.country])}</span>`).join('<span class="mdy-holiday-sep"></span>');
}

export function renderOfficeStrip(): void {
  const el = document.getElementById('myday-offices');
  if (!el) return;
  if (!settingsLoaded) { void loadSettings().then(renderOfficeStrip); return; }
  const now = new Date();
  const parts: string[] = [];

  if (settings.clocks) {
    refreshWeatherIfStale();
    const holidayDates = new Set([now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]
      .flatMap((y) => holidaysFor(y)).map((h) => `${h.country}|${h.date}`));
    const chips = OFFICES.map((o) => {
      const local = localParts(now, o.timeZone);
      const status = officeStatus(now, o, holidayDates);
      const w = weather.get(o.id);
      const look = w ? weatherLook(w.symbol) : null;
      const wx = w && look ? `<span class="mdy-office-wx">${icon(look.iconName, 13)}${w.temperature}°</span>` : '';
      const title = [o.city, local.time, STATUS_LABEL[status], w && look ? `${look.label}, ${w.temperature}°C` : ''].filter(Boolean).join(' · ');
      return `<div class="mdy-office is-${status}" role="listitem" title="${escHtml(title)}" aria-label="${escHtml(title)}">
        <span class="mdy-office-dot" aria-hidden="true"></span><span class="mdy-office-city">${escHtml(o.city)}</span><span class="mdy-office-time">${escHtml(local.time)}</span>${wx}
      </div>`;
    }).join('');
    const credit = weather.size ? '<span class="mdy-office-credit" title="Weather data from MET Norway (CC BY 4.0)">Weather: MET Norway</span>' : '';
    parts.push(`<div class="mdy-offices" role="list" aria-label="Office clocks">${chips}${credit}</div>`);
  }
  if (settings.holidays) {
    const line = holidayLine(now);
    if (line) parts.push(`<div class="mdy-holidays">${icon('calendar', 13)}<div class="mdy-holidays-list">${line}</div></div>`);
  }
  el.innerHTML = parts.join('');
  el.hidden = parts.length === 0;
}
expose('renderOfficeStrip', renderOfficeStrip);

// Clocks move on their own; only while My Day is on screen.
setInterval(() => {
  if (!document.hidden && getActiveTabId() === 'myday') renderOfficeStrip();
}, 20_000);

// ── Settings → General ──────────────────────────────────────────────────────

export async function renderOfficeStripSettings(): Promise<void> {
  const el = document.getElementById('office-strip-settings-card');
  if (!el) return;
  await loadSettings();
  const toggle = (id: string, on: boolean) => `<input type="checkbox" class="switch" id="${id}" ${on ? 'checked' : ''} onchange="officeStripSettingChanged()">`;
  el.innerHTML = `<div class="sec settings-card">
    <div class="settings-card-hd"><span data-icon="clock"></span><div class="card-hd">My Day</div></div>
    <p class="settings-card-desc">Small extras under the greeting on My Day.</p>
    <div class="rem-rows">
      <label class="rem-row">${toggle('strip-clocks', settings.clocks)}<span class="rem-label"><strong>Office clocks and weather</strong><span>${escHtml(OFFICES.map((o) => o.city).join(', '))}, with working hours and weekends</span></span></label>
      <label class="rem-row">${toggle('strip-holidays', settings.holidays)}<span class="rem-label"><strong>Public holidays this week</strong><span>Saudi Arabia, Lebanon and Spain (Barcelona). Islamic holidays are shown as expected until announced</span></span></label>
    </div>
  </div>`;
  renderIcons();
}
expose('renderOfficeStripSettings', renderOfficeStripSettings);

export function officeStripSettingChanged(): void {
  settings = {
    clocks: (document.getElementById('strip-clocks') as HTMLInputElement | null)?.checked ?? true,
    holidays: (document.getElementById('strip-holidays') as HTMLInputElement | null)?.checked ?? true,
  };
  void setAppMeta(SETTINGS_KEY, JSON.stringify(settings)).catch(() => undefined);
  if (getActiveTabId() === 'myday') renderOfficeStrip();
}
expose('officeStripSettingChanged', officeStripSettingChanged);
