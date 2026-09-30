// Dates and times on screen: one family (owner, 30-Sep-2026). Pure; utils.ts
// re-exports it.
// Every date and time on screen goes through these; nothing else in src/ calls
// toLocaleDateString / toLocaleTimeString (dates.test.ts checks). Stored dates
// are YYYY-MM-DD and read at local noon, so no timezone can shift the day; a
// full timestamp is read as the moment it names.

type DateInput = string | Date | null | undefined;

function asDate(v: DateInput): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
const gb = (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-GB', opts);
const thisYear = (d: Date) => d.getFullYear() === new Date().getFullYear();

/** "2 Sept 2026"; "—" when there is no date. */
export function fmtDate(s: DateInput): string {
  const d = asDate(s);
  return d ? gb(d, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

/** "2 Sept 2026" for a full timestamp (file times, updatedAt); "" when missing. */
export function fmtDateFromIso(s: DateInput): string {
  const d = asDate(s);
  return d ? gb(d, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

/** "2 Sept"; with `yearIfOther`, "2 Sept 2025" for another year. "" when missing. */
export function fmtDateShort(s: DateInput, yearIfOther = false): string {
  const d = asDate(s);
  return d ? gb(d, { day: 'numeric', month: 'short', year: yearIfOther && !thisYear(d) ? 'numeric' : undefined }) : '';
}

/** "Tue 2 Sept". */
export function fmtDateWeekday(s: DateInput): string {
  const d = asDate(s);
  return d ? gb(d, { weekday: 'short', day: 'numeric', month: 'short' }) : '';
}

/** "Tuesday" / "Tue". */
export function fmtWeekday(s: DateInput, width: 'long' | 'short' = 'long'): string {
  const d = asDate(s);
  return d ? gb(d, { weekday: width }) : '';
}

/** "Tuesday 2 September" — My Day's greeting and day headings; with `year`, the brief's full date. */
export function fmtDayLong(s: DateInput, year = false): string {
  const d = asDate(s);
  return d ? gb(d, { weekday: 'long', day: 'numeric', month: 'long', year: year ? 'numeric' : undefined }) : '';
}

/** "2 September 2026" — for letters and emails. */
export function fmtDateLong(s: DateInput): string {
  const d = asDate(s);
  return d ? gb(d, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

/** "September 2026", "Sept 2026", "Sept"; year: always, never, or only when not this year. */
export function fmtMonth(s: DateInput, month: 'long' | 'short' = 'long', year: 'always' | 'never' | 'ifOther' = 'always'): string {
  const d = asDate(s);
  if (!d) return '';
  const withYear = year === 'always' || (year === 'ifOther' && !thisYear(d));
  return gb(d, { month, year: withYear ? 'numeric' : undefined });
}

/** "14:05", 24-hour; "" when missing or a bare date. */
export function fmtTime(s: DateInput): string {
  if (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = asDate(s);
  return d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
}

/** "11:00 – 12:00". */
export function fmtTimeRange(start: DateInput, end: DateInput): string {
  const a = fmtTime(start);
  const b = fmtTime(end);
  return a && b ? `${a} – ${b}` : a;
}

/** "2 Sept 2026 14:05". */
export function fmtDateTime(s: DateInput): string {
  const d = asDate(s);
  return d ? `${fmtDate(d)} ${fmtTime(d)}` : '';
}

/** Today as YYYY-MM-DD in local time (for storing, not showing). */
export function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
