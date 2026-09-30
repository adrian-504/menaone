// The changelog (CHANGELOG.md, owner 30-Sep-2026): one entry per install —
// "## 1.50 — 2026-09-30" and up to two lines. Settings → Data shows the
// version, when it was installed and the last five entries. Pure.

import { fmtDate } from './dates';

export interface ChangelogEntry {
  version: string;
  /** YYYY-MM-DD. */
  date: string;
  lines: string[];
}

/** The entries, newest first as written. */
export function parseChangelog(md: string): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  let cur: ChangelogEntry | null = null;
  for (const raw of md.split('\n')) {
    const h = /^##\s+(\d+\.\d+)\s+—\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(raw);
    if (h) { cur = { version: h[1], date: h[2], lines: [] }; out.push(cur); continue; }
    if (/^#/.test(raw)) { cur = null; continue; }
    const text = raw.trim();
    if (cur && text) cur.lines.push(text);
  }
  return out;
}

/** "1.50.0" → "1.50". */
export const shortVersion = (v: string): string => v.trim().replace(/^(\d+\.\d+)\.0$/, '$1');

/** "MENA One 1.50 · installed 30 Sept 2026" (the date is the changelog entry's). */
export function versionLine(version: string, entries: ChangelogEntry[]): string {
  const v = shortVersion(version);
  const e = entries.find((x) => x.version === v);
  const when = e ? fmtDate(e.date) : null;
  return `MENA One ${v}${when ? ` · installed ${when}` : ''}`;
}
