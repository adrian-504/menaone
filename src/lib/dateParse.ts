// What a date field understands (foundations F1): the same phrases as quick
// capture — today, tomorrow, next week, in 3 days, Tue, next Tue, 2 Oct,
// Oct 2, 02/10 (day first, as in KSA and Europe), 2026-10-02 — plus full dates
// with a year: 2 Oct 2026, Oct 2 2026, 02/10/2026. A date without a year, or a
// weekday, is the next one from today. Pure.

import { isoDate, parseTaskInput } from './taskParse';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthOf = (word: string) => MONTHS.indexOf(word.slice(0, 3).toLowerCase());

function exact(year: number, month: number, day: number): string | null {
  const d = new Date(year, month, day);
  return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day ? isoDate(d) : null;
}

/** The ISO date a field's text means, or null when it isn't one. */
export function parseDate(text: string, today: Date): string | null {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return null;
  let m: RegExpExecArray | null;
  // With a year: 2 Oct 2026 · Oct 2, 2026 · 02/10/2026 · 2.10.26
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?,? (\d{4})$/i.exec(t)) && monthOf(m[2]) >= 0) return exact(+m[3], monthOf(m[2]), +m[1]);
  if ((m = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/i.exec(t)) && monthOf(m[1]) >= 0) return exact(+m[3], monthOf(m[1]), +m[2]);
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t))) return exact(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1]);
  // Everything quick capture understands, when the whole text is the date.
  const parsed = parseTaskInput(t, { today, projects: [], companies: [] });
  const rest = parsed.tokens.reduce((s, tok) => s.replace(tok.text, ''), t).replace(/\b(on|by|due)\b/gi, '').trim();
  return parsed.dueDate && !rest ? parsed.dueDate : null;
}

/** One day or one week on from `iso` (↑/↓ in a date field). */
export function nudge(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + days));
}
