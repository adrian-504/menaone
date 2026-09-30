// Settings → Appearance (brand slice): the shell tint (Blue, the default, or
// Grey), whose name the greeting and the sidebar use when Microsoft 365 isn't
// connected, and My Day's band photo (the office, or your own photos, one a
// day). Tint and name are remembered on this computer, like the theme; your
// photos are copied into the app's data folder (src-tauri/src/appearance.rs).

import { S } from './state';
import { OFFICES } from './offices';
import officeBand from '../assets/brand/office-band.jpg';

export type Tint = 'blue' | 'grey';
export type BandSource = 'default' | 'mine';

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

export function bandSource(): BandSource { return read(KEYS.band) === 'mine' ? 'mine' : 'default'; }
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

/** The band's blue scrim, left to right: lighter in the morning, navy-heavy in the evening. Pure. */
export function scrimFor(part: DayPart): string {
  if (part === 'morning') return 'linear-gradient(90deg,rgba(1,75,140,.78) 0%,rgba(1,75,140,.62) 38%,rgba(1,75,140,.28) 70%,rgba(10,32,51,.18) 100%)';
  if (part === 'evening') return 'linear-gradient(90deg,rgba(10,32,51,.85) 0%,rgba(10,32,51,.74) 38%,rgba(1,75,140,.48) 70%,rgba(10,32,51,.4) 100%)';
  return 'linear-gradient(90deg,rgba(1,75,140,.92) 0%,rgba(1,75,140,.78) 38%,rgba(1,75,140,.38) 70%,rgba(10,32,51,.25) 100%)';
}

/** One photo a day, in turn. Pure. */
export function photoOfDay(names: string[], date: Date): string | null {
  if (!names.length) return null;
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
  return names[day % names.length];
}

let cached: { key: string; url: string } | null = null;
/** The band photo for today: the office, or today's one of yours. */
export async function bandPhotoUrl(now = new Date()): Promise<string> {
  if (bandSource() !== 'mine' || !(window as any).__TAURI_INTERNALS__?.invoke) return officeBand;
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
