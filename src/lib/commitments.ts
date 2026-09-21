// Commitments written in text: a line starting with `>>` is something we owe
// the client, `<<` something the client owes us. Optional list markers and
// checkboxes in front are fine ("- [ ] >> …"); a ticked one is already kept.
// Dates are read the way task quick-add reads them (taskParse.ts) and taken
// out of the text the same way; "by end of month" works too. For `<<`, a
// leading "Name to …" / "Name will …" names who promised it when exactly one
// of the company's contacts fits. Rules only — nothing is guessed.
// Pure (no DOM, no global state) so it can be tested.

import { isoDate, parseTaskInput } from './taskParse';

export type CommitmentDirection = 'ours' | 'theirs';
export type WaitingOn = 'us' | 'them';

export interface ParsedCommitment {
  direction: CommitmentDirection;
  text: string;
  dueDate: string | null;
  kept: boolean;
  contactId: number | null;
  /** Lower-cased text with spacing collapsed: the same line read again has the same key. */
  sourceKey: string;
}

export interface CommitmentParseContext {
  today: Date;
  /** The company's contacts, for "Name to …". */
  contacts: { id: number; name: string | null }[];
}

const LINE = /^\s*(?:[-*+]\s+)?(?:\[([ xX])\]\s+)?(>>|<<)\s*(.*?)\s*$/;
const END_OF_MONTH = /\b(?:by\s+)?(?:the\s+)?end\s+of\s+(?:the\s+)?month\b/i;

export function commitmentKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function lastDayOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/** The text without its date, and the date. */
function takeDate(raw: string, today: Date): { text: string; dueDate: string | null } {
  if (END_OF_MONTH.test(raw)) return { text: tidy(raw.replace(END_OF_MONTH, ' ')), dueDate: isoDate(lastDayOfMonth(today)) };
  const parsed = parseTaskInput(raw, { today, projects: [], companies: [] });
  let text = raw;
  // Only dates and times come out, as in a task title; tags, companies and
  // priorities are part of what was promised and stay.
  for (const t of parsed.tokens) {
    if (t.kind !== 'date' && t.kind !== 'time' && t.kind !== 'someday') continue;
    const i = text.indexOf(t.text);
    if (i >= 0) text = `${text.slice(0, i)} ${text.slice(i + t.text.length)}`;
  }
  return { text: tidy(text), dueDate: parsed.someday ? null : parsed.dueDate };
}

/** Collapses spacing and drops a "by" / "before" left behind by the date. */
function tidy(s: string): string {
  return s.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').replace(/\s+\b(by|before|until)\b(?=\s*(?:[,.;:]|$))/i, '').trim();
}

/** "Omar to …", "Lina Saleh will …": the contact, when exactly one fits. */
function whoPromised(text: string, contacts: CommitmentParseContext['contacts']): number | null {
  const m = /^(\p{L}[\p{L}'’.-]*(?:\s+\p{L}[\p{L}'’.-]*){0,2})\s+(?:to|will)\s+/u.exec(text);
  if (!m) return null;
  const said = commitmentKey(m[1]);
  const fits = contacts.filter((c) => {
    const name = commitmentKey(c.name || '');
    return !!name && (name === said || name.split(' ')[0] === said);
  });
  return fits.length === 1 ? fits[0].id : null;
}

/** Every commitment line in a text, in order, each once. */
export function parseCommitmentLines(text: string | null | undefined, ctx: CommitmentParseContext): ParsedCommitment[] {
  const out: ParsedCommitment[] = [];
  for (const line of (text || '').split('\n')) {
    const m = LINE.exec(line);
    if (!m || !m[3]) continue;
    const direction: CommitmentDirection = m[2] === '>>' ? 'ours' : 'theirs';
    const { text: body, dueDate } = takeDate(m[3], ctx.today);
    if (!body) continue;
    const sourceKey = commitmentKey(body);
    if (out.some((c) => c.sourceKey === sourceKey && c.direction === direction)) continue;
    out.push({
      direction, text: body, dueDate, kept: !!m[1] && m[1].toLowerCase() === 'x',
      contactId: direction === 'theirs' ? whoPromised(body, ctx.contacts) : null, sourceKey,
    });
  }
  return out;
}

/** Whether a line starts with a commitment marker (after list/checkbox markers). */
export function isCommitmentLine(line: string): boolean {
  return LINE.test(line) && !!LINE.exec(line)![3];
}

/** Who a proposal is waiting on, from its status alone. */
export function proposalWaitingOn(status: string | null | undefined, archived = false): WaitingOn | null {
  if (archived || !status) return null;
  if (status === 'Sent to Client') return 'them';
  if (['Proposal Request Received', 'Drafting', 'In Internal Review', 'Signed by Client'].includes(status)) return 'us';
  return null;
}

export interface WaitingSuggestion { waitingOn: WaitingOn; since: string; commitmentId: number }

/** The client's oldest open promise suggests the opportunity is waiting on them. */
export function waitingFromCommitments(list: { id: number; direction: string; status: string; createdAt?: string | null }[]): WaitingSuggestion | null {
  const open = list.filter((c) => c.direction === 'theirs' && c.status === 'open' && c.createdAt)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  return open.length ? { waitingOn: 'them', since: open[0].createdAt!.slice(0, 10), commitmentId: open[0].id } : null;
}

/** Setting who it waits on: the date is kept while the side stays the same. */
export function stampWaiting(cur: { waitingOn?: string | null; waitingSince?: string | null }, next: WaitingOn | null, today: string): { waitingOn: WaitingOn | null; waitingSince: string | null } {
  if (!next) return { waitingOn: null, waitingSince: null };
  return { waitingOn: next, waitingSince: cur.waitingOn === next && cur.waitingSince ? cur.waitingSince : today };
}
