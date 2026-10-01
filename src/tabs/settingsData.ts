// Settings → Data, at the top (owner, 30-Sep-2026): the version and when it was
// installed, three quiet lines on the backups, the database check and the
// install backups, and the last five changelog entries. No new buttons.

import changelogMd from '../../CHANGELOG.md?raw';
import packageJson from '../../package.json?raw';
import { S } from '../lib/state';
import { escHtml, expose, fmtDate, fmtDateShort, fmtTime } from '../lib/utils';
import { housekeepingStatus } from '../lib/db';
import { parseChangelog, versionLine } from '../lib/changelog';
import type { HousekeepingStatus } from '../lib/types';

const entries = parseChangelog(changelogMd);
const version = (() => { try { return String(JSON.parse(packageJson).version || ''); } catch { return ''; } })();
/** The installed version, for the line under Settings' title. */
export const APP_VERSION = version;

/** "today 09:12", "yesterday 09:12", "28 Sept 09:12". */
function when(d: Date | null): string {
  if (!d || isNaN(d.getTime())) return '';
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  const day = fmtDate(d) === fmtDate(now) ? 'today' : fmtDate(d) === fmtDate(yesterday) ? 'yesterday' : fmtDateShort(d);
  return `${day} ${fmtTime(d)}`;
}

/** A stored moment: a full timestamp shows its time; a date alone (written
 * before 1.51) shows only its day — read as UTC midnight it would show a
 * made-up time ("today 02:00"). */
function whenAt(value: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!day) return when(new Date(value));
  return when(new Date(+day[1], +day[2] - 1, +day[3])).replace(/ \d{2}:\d{2}$/, '');
}

/** The three lines, as text with a tone; pure enough to test through the page. */
export function statusLines(h: HousekeepingStatus | null): { text: string; bad: boolean }[] {
  if (!h) return [{ text: 'Backups: checking…', bad: false }];
  const daily = h.dailyLast ? when(new Date(h.dailyLast * 1000)) : 'none yet';
  const od = h.onedriveError
    ? `OneDrive copy failed: ${h.onedriveError}`
    : h.onedriveLast ? `OneDrive copy ${whenAt(h.onedriveLast)} (${h.onedriveKept} kept)` : 'OneDrive copy not made yet';
  const check = h.integrity
    ? `Database check: ${h.integrity.ok ? 'ok' : `failed${h.integrity.detail ? ` (${h.integrity.detail})` : ''}`} · ${whenAt(h.integrity.at)}`
    : 'Database check: not run yet';
  const t = h.installBackupsTidy;
  const archived = t?.at && t.archivedTo ? `older ones archived ${fmtDateShort(t.at)}`
    : t && !t.archivedTo ? 'older ones wait for the archive drive' : 'none archived yet';
  return [
    { text: `Daily backup: ${daily} · ${od}`, bad: !!h.onedriveError },
    { text: check, bad: h.integrity?.ok === false },
    { text: `Local install backups: ${h.installBackups} (${archived})`, bad: false },
  ];
}

export async function renderDataStatus(): Promise<void> {
  const el = document.getElementById('data-status');
  if (!el) return;
  const draw = () => {
    el.innerHTML = `<div class="data-version">${escHtml(versionLine(version, entries))}</div>
      ${statusLines(S.housekeeping).map((l) => `<div class="data-line${l.bad ? ' is-bad' : ''}">${escHtml(l.text)}</div>`).join('')}
      <ul class="data-changes">${entries.slice(0, 5).map((e) => `<li><span class="data-change-v">${escHtml(e.version)}</span>${escHtml(e.lines.join(' '))}</li>`).join('')}</ul>`;
  };
  draw();
  try { S.housekeeping = await housekeepingStatus(); } catch { /* the lines say "checking" */ }
  draw();
}
expose('renderDataStatus', renderDataStatus);

/** Read once the launch checks have had time to run, for My Day's red row. */
export function loadHousekeepingSoon(): void {
  setTimeout(() => { void housekeepingStatus().then((h) => { S.housekeeping = h; if (h?.integrity?.ok === false) (window as any).renderMyDay?.(); }).catch(() => undefined); }, 5000);
}
