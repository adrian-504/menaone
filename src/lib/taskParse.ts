// Natural-language quick add for tasks: "Call Globex tomorrow 3pm #Saudization !high"
// → title "Call Globex", due tomorrow at 15:00, project Saudization…, priority
// High, company Globex. Pure (no DOM, no global state) so it can be tested.
//
// Recognised:
//   dates     today · tonight · tomorrow/tmr · mon…sun · next monday · next week
//             in 3 days/weeks · 15 sep · sep 15 · 15/9 · 2026-09-15 · someday
//   times     3pm · 3:30pm · 15:00 · at 9 · noon
//   priority  !high !h !1 · !medium !med !m !2 · !low !l !3
//   project   #Name or #"Multi word" (closest project name; otherwise a tag)
//   company   @Name, or a known company name written in the text
//   repeat    every day / week / month · daily · weekly · monthly

export interface ParseContext {
  today: Date;
  projects: { id: number; name: string }[];
  companies: { id: number; name: string }[];
}

export type TokenKind = 'date' | 'time' | 'priority' | 'project' | 'tag' | 'company' | 'someday' | 'repeat';

export interface ParsedToken {
  kind: TokenKind;
  /** Short text for the preview chip, e.g. "Tomorrow", "!High", "Saudization Advisory". */
  label: string;
  /** Exact text matched in the input (used to ignore a token the user dismisses). */
  text: string;
}

export interface ParsedTask {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  priority: 'High' | 'Medium' | 'Low' | null;
  projectId: number | null;
  companyName: string | null;
  tags: string[];
  someday: boolean;
  recurrence: 'daily' | 'weekly' | 'monthly' | null;
  tokens: ParsedToken[];
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

function dayIndex(word: string): number {
  const w = word.toLowerCase();
  return DAYS.findIndex((d) => d === w || d.slice(0, 3) === w || (w.length >= 3 && d.startsWith(w)));
}

function monthIndex(word: string): number {
  return MONTHS.indexOf(word.toLowerCase().slice(0, 3));
}

/** A day-and-month with no year means the next time that date comes round. */
function nextOccurrence(today: Date, month: number, day: number): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  let d = new Date(today.getFullYear(), month, day);
  if (d.getMonth() !== month) return null;
  if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) d = new Date(today.getFullYear() + 1, month, day);
  return d;
}

export function friendlyDate(iso: string, today: Date): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const diff = Math.round((date.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return DAYS[date.getDay()][0].toUpperCase() + DAYS[date.getDay()].slice(1, 3);
  const month = MONTHS[date.getMonth()][0].toUpperCase() + MONTHS[date.getMonth()].slice(1);
  return y === today.getFullYear() ? `${d} ${month}` : `${d} ${month} ${y}`;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '');
}

interface Match { start: number; end: number; apply: (t: ParsedTask) => void; token: ParsedToken }

export function parseTaskInput(input: string, ctx: ParseContext, ignored: Set<string> = new Set()): ParsedTask {
  const result: ParsedTask = { title: input, dueDate: null, dueTime: null, priority: null, projectId: null, companyName: null, tags: [], someday: false, recurrence: null, tokens: [] };
  const matches: Match[] = [];
  const taken = (s: number, e: number) => matches.some((m) => s < m.end && e > m.start);
  const add = (start: number, end: number, token: ParsedToken, apply: (t: ParsedTask) => void) => {
    if (ignored.has(token.text.toLowerCase()) || taken(start, end)) return;
    matches.push({ start, end, token, apply });
  };
  const scan = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(input))) fn(m);
  };
  const today = ctx.today;
  const setDate = (d: Date) => (t: ParsedTask) => { t.dueDate = isoDate(d); t.someday = false; };
  const dateToken = (text: string, d: Date): ParsedToken => ({ kind: 'date', label: friendlyDate(isoDate(d), today), text });

  // Explicit markers first, so their words can't be read as dates or companies.
  scan(/(^|\s)!(high|h|1|medium|med|m|2|low|l|3)\b/gi, (m) => {
    const v = m[2].toLowerCase();
    const p = v[0] === 'h' || v === '1' ? 'High' : v[0] === 'l' || v === '3' ? 'Low' : 'Medium';
    const start = m.index + m[1].length;
    add(start, m.index + m[0].length, { kind: 'priority', label: `!${p}`, text: m[0].trim() }, (t) => { t.priority = p; });
  });
  scan(/(^|\s)#(?:"([^"]+)"|([^\s#@!]+))/g, (m) => {
    const raw = (m[2] ?? m[3]).trim();
    const start = m.index + m[1].length;
    const key = norm(raw);
    const project = key
      ? ctx.projects.find((p) => norm(p.name) === key) ?? ctx.projects.find((p) => norm(p.name).startsWith(key)) ?? ctx.projects.find((p) => norm(p.name).includes(key))
      : undefined;
    if (project) add(start, m.index + m[0].length, { kind: 'project', label: project.name, text: m[0].trim() }, (t) => { t.projectId = project.id; });
    else if (raw) add(start, m.index + m[0].length, { kind: 'tag', label: raw, text: m[0].trim() }, (t) => { t.tags.push(raw); });
  });
  scan(/(^|\s)@(?:"([^"]+)"|([^\s#@!]+))/g, (m) => {
    const raw = (m[2] ?? m[3]).trim();
    const start = m.index + m[1].length;
    const key = norm(raw);
    const company = ctx.companies.find((c) => norm(c.name) === key) ?? ctx.companies.find((c) => norm(c.name).startsWith(key));
    const name = company?.name ?? raw;
    add(start, m.index + m[0].length, { kind: 'company', label: name, text: m[0].trim() }, (t) => { t.companyName = name; });
  });

  // Repeat.
  scan(/\b(every\s+(day|week|month)|daily|weekly|monthly)\b/gi, (m) => {
    const w = (m[2] ?? m[1]).toLowerCase();
    const rule = w.startsWith('d') ? 'daily' : w.startsWith('w') ? 'weekly' : 'monthly';
    add(m.index, m.index + m[0].length, { kind: 'repeat', label: `Repeats ${rule}`, text: m[0] }, (t) => { t.recurrence = rule; });
  });

  // Dates.
  scan(/\bsomeday\b/gi, (m) => add(m.index, m.index + m[0].length, { kind: 'someday', label: 'Someday', text: m[0] }, (t) => { t.someday = true; t.dueDate = null; }));
  scan(/\b(today|tod|tonight)\b/gi, (m) => add(m.index, m.index + m[0].length, dateToken(m[0], today), setDate(today)));
  scan(/\b(tomorrow|tmrw?|tmr)\b/gi, (m) => { const d = addDays(today, 1); add(m.index, m.index + m[0].length, dateToken(m[0], d), setDate(d)); });
  scan(/\bnext\s+week\b/gi, (m) => {
    const d = addDays(today, ((8 - today.getDay()) % 7) || 7);
    add(m.index, m.index + m[0].length, dateToken(m[0], d), setDate(d));
  });
  scan(/\bin\s+(\d{1,3})\s+(days?|weeks?)\b/gi, (m) => {
    const d = addDays(today, Number(m[1]) * (m[2].toLowerCase().startsWith('w') ? 7 : 1));
    add(m.index, m.index + m[0].length, dateToken(m[0], d), setDate(d));
  });
  scan(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (d.getMonth() === Number(m[2]) - 1) add(m.index, m.index + m[0].length, dateToken(m[0], d), setDate(d));
  });
  scan(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi, (m) => {
    const d = nextOccurrence(today, monthIndex(m[2]), Number(m[1]));
    if (d) add(m.index, m.index + m[0].length, dateToken(m[0], d), setDate(d));
  });
  scan(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?!\d|:)\b/gi, (m) => {
    const d = nextOccurrence(today, monthIndex(m[1]), Number(m[2]));
    if (d) add(m.index, m.index + m[0].length, dateToken(m[0], d), setDate(d));
  });
  // Day/month as used in KSA and Europe: 15/9 means 15 September.
  scan(/\b(\d{1,2})\/(\d{1,2})\b/g, (m) => {
    const d = nextOccurrence(today, Number(m[2]) - 1, Number(m[1]));
    if (d) add(m.index, m.index + m[0].length, dateToken(m[0], d), setDate(d));
  });
  scan(/\b(?:(next)\s+|on\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|urday|sday)?\b/gi, (m) => {
    const idx = dayIndex(m[2]);
    if (idx < 0) return;
    let diff = (idx - today.getDay() + 7) % 7 || 7;
    if (m[1]) diff += diff < 7 ? 7 : 0;
    const d = addDays(today, diff);
    add(m.index, m.index + m[0].length, dateToken(m[0], d), setDate(d));
  });

  // Times: "3pm", "3:30 pm", "15:00", "at 9", "noon".
  scan(/\b(?:at\s+)?(noon|midday)\b/gi, (m) => add(m.index, m.index + m[0].length, { kind: 'time', label: '12:00', text: m[0] }, (t) => { t.dueTime = '12:00'; }));
  scan(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi, (m) => {
    let h = Number(m[1]) % 12;
    if (m[3].toLowerCase() === 'pm') h += 12;
    const min = m[2] ?? '00';
    if (Number(min) > 59 || Number(m[1]) > 12) return;
    const label = `${String(h).padStart(2, '0')}:${min}`;
    add(m.index, m.index + m[0].length, { kind: 'time', label, text: m[0] }, (t) => { t.dueTime = label; });
  });
  scan(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/g, (m) => {
    const label = `${m[1].padStart(2, '0')}:${m[2]}`;
    add(m.index, m.index + m[0].length, { kind: 'time', label, text: m[0] }, (t) => { t.dueTime = label; });
  });
  scan(/\bat\s+([01]?\d|2[0-3])\b(?!\s*[:/])/gi, (m) => {
    const label = `${m[1].padStart(2, '0')}:00`;
    add(m.index, m.index + m[0].length, { kind: 'time', label, text: m[0] }, (t) => { t.dueTime = label; });
  });

  // A company name written in the text ("Call Globex") links the task without
  // being removed from the title. Longest name wins; whole words only.
  const lower = input.toLowerCase();
  let best: { name: string; start: number; end: number } | null = null;
  for (const c of ctx.companies) {
    const name = c.name.trim();
    if (name.length < 3) continue;
    const idx = lower.indexOf(name.toLowerCase());
    if (idx < 0) continue;
    const before = idx === 0 ? ' ' : lower[idx - 1];
    const after = lower[idx + name.length] ?? ' ';
    if (/[\p{L}\p{N}]/u.test(before) || /[\p{L}\p{N}]/u.test(after)) continue;
    if (!best || name.length > best.name.length) best = { name, start: idx, end: idx + name.length };
  }
  const explicitCompany = matches.some((m) => m.token.kind === 'company');
  if (best && !explicitCompany && !ignored.has(best.name.toLowerCase()) && !taken(best.start, best.end)) {
    const name = best.name;
    result.tokens.push({ kind: 'company', label: name, text: name });
    result.companyName = name;
  }

  matches.sort((a, b) => a.start - b.start);
  for (const m of matches) { m.apply(result); result.tokens.push(m.token); }
  // A time on its own means today.
  if (result.dueTime && !result.dueDate && !result.someday) result.dueDate = isoDate(today);

  let title = input;
  for (const m of [...matches].sort((a, b) => b.start - a.start)) title = title.slice(0, m.start) + title.slice(m.end);
  result.title = title.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
  return result;
}
