// Settings → Appearance (brand slice): the shell tint (Blue, the default, or
// Grey), whose name the greeting and the sidebar use when Microsoft 365 isn't
// connected, and My Day's band photo: your city (default — a photograph of
// the office city you're in, bundled in src/assets/band, see
// docs/brand-assets.md), the MENA office, or your own photos (one a day). Tint and name are remembered on this computer, like the theme; your
// photos are copied into the app's data folder (src-tauri/src/appearance.rs).

import { S } from './state';
import { OFFICES } from './offices';
import officeBand from '../assets/brand/office-band.jpg';

export type Tint = 'blue' | 'grey';
export type BandSource = 'city' | 'office' | 'mine';

const KEYS = { tint: 'menabig.tint', name: 'menabig.yourName', band: 'menabig.band' };

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* private mode: not remembered */ }
}

export function tint(): Tint { return read(KEYS.tint) === 'grey' ? 'grey' : 'blue'; }
export function setTint(t: Tint): void { write(KEYS.tint, t); applyTint(); }
/** Blue is the stylesheet's default; Grey is [data-tint="grey"]. */
export function applyTint(): void {
  const root = document.documentElement;
  if (tint() === 'grey') root.setAttribute('data-tint', 'grey'); else root.removeAttribute('data-tint');
}

export function yourName(): string { return (read(KEYS.name) || '').trim(); }
export function setYourName(name: string): void { write(KEYS.name, name.trim()); }

export function bandSource(): BandSource {
  const v = read(KEYS.band);
  return v === 'mine' || v === 'office' ? v : 'city';
}
export function setBandSource(b: BandSource): void { write(KEYS.band, b); }

/** Your name: the Microsoft account's, else the one in Settings. */
export function displayName(): string {
  return S.ms365Status?.displayName?.trim() || yourName();
}

/** "Ahmad Abdallah" → "AA"; one word → its first two letters. Pure. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** The office you're in: the one on this Mac's time zone, else the first weather city. */
export function homeCity(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  return (OFFICES.find((o) => o.timeZone === timeZone) ?? OFFICES[0]).city;
}

export type DayPart = 'morning' | 'afternoon' | 'evening';
/** Morning until noon, afternoon until 17:00, evening after (and before 05:00). Pure. */
export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
}

/** The band's blue scrim, left to right: lighter in the morning, navy-heavy in the evening. The
 * left side is dense enough for the white greeting at 4.5:1 or more on every bundled photo
 * (scripts/band-contrast.py measures it). Pure. */
export function scrimFor(part: DayPart): string {
  if (part === 'morning') return 'linear-gradient(90deg,rgba(1,75,140,.9) 0%,rgba(1,75,140,.82) 45%,rgba(1,75,140,.34) 72%,rgba(10,32,51,.2) 100%)';
  if (part === 'evening') return 'linear-gradient(90deg,rgba(10,32,51,.88) 0%,rgba(10,32,51,.8) 45%,rgba(1,75,140,.48) 72%,rgba(10,32,51,.4) 100%)';
  return 'linear-gradient(90deg,rgba(1,75,140,.93) 0%,rgba(1,75,140,.85) 45%,rgba(1,75,140,.4) 72%,rgba(10,32,51,.25) 100%)';
}

/** One photo a day, in turn. Pure. */
export function photoOfDay(names: string[], date: Date): string | null {
  if (!names.length) return null;
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
  return names[day % names.length];
}

/** The bundled photographs of the office cities (riyadh.webp, riyadh-2.webp …; docs/brand-assets.md). */
const CITY_PHOTOS = import.meta.glob('../assets/band/*.webp', { eager: true, import: 'default' }) as Record<string, string>;
export const OFFICE_BAND = officeBand;

/** Today's photo of a city (in turn, when it has more than one), or the office banner when it has none. Pure. */
export function cityPhoto(city: string, date: Date, photos: Record<string, string> = CITY_PHOTOS): string {
  const slug = city.trim().toLowerCase().replace(/[^a-z]+/g, '-');
  const mine = Object.keys(photos).filter((path) => new RegExp(`/${slug}(-\\d+)?\\.webp$`).test(path)).sort();
  const pick = photoOfDay(mine, date);
  return pick ? photos[pick] : officeBand;
}

let cached: { key: string; url: string } | null = null;
/** The band photo for today: your city's, the office, or today's one of yours. */
export async function bandPhotoUrl(now = new Date()): Promise<string> {
  const source = bandSource();
  if (source === 'city') return cityPhoto(homeCity(), now);
  if (source === 'office' || !(window as any).__TAURI_INTERNALS__?.invoke) return officeBand;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const name = photoOfDay(await invoke<string[]>('band_photos_list'), now);
    if (!name) return officeBand;
    if (cached?.key === name) return cached.url;
    const url = await invoke<string>('band_photo_data', { name });
    cached = { key: name, url };
    return url;
  } catch {
    return officeBand;
  }
}

/** The "you" block at the foot of the sidebar. */
export function renderMe(): void {
  const name = displayName();
  const av = document.getElementById('sb-me-av');
  const nm = document.getElementById('sb-me-name');
  const sub = document.getElementById('sb-me-sub');
  if (!av || !nm || !sub) return;
  av.textContent = initialsOf(name) || '·';
  nm.textContent = name || 'Add your name';
  nm.classList.toggle('is-empty', !name);
  sub.textContent = `MENA BIG · ${homeCity()}`;
}
