// The contact page in the record anatomy (1.61 "records"): the header's
// figures, the contact trail across the last months (meetings, emails, calls,
// notes as dots on one line with month ticks) and what is open with the
// person. Pure: tabs/contactPage.ts draws it.

import type { Commitment, Contact, EmailRecord, Meeting, Note, Proposal, Touch } from './types';
import { PS, isOpenProposal } from './commercial';
import { daysBetween } from './pipeline';
import { fmtDateShort } from './dates';
import { plural } from './pageKit';
import { stageOfProposal, stageSince } from './pagesProposals';
import { CHANNEL_ICON, type LastSpoke } from './pagesContacts';
import type { Figure } from './recordFigures';

const day = (s: string | null | undefined) => (s || '').slice(0, 10);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

// ── Header ──────────────────────────────────────────────────────────────────

export interface ContactHeaderInput {
  today: string;
  last: LastSpoke | undefined;
  commitments: Pick<Commitment, 'direction' | 'status' | 'dueDate' | 'text'>[];
  /** Dates of the meetings they were in. */
  meetingDates: string[];
  /** The company's monthly under active agreements, formatted; '' when none. */
  companyMonthly: string;
}

/** Last contact (and what it was) · owed · meetings this year · monthly at their company. Pure. */
export function contactHeaderFigures(i: ContactHeaderInput): Figure[] {
  const out: Figure[] = [];
  if (i.last) {
    const d = Math.max(0, daysBetween(i.last.date, i.today) ?? 0);
    out.push({ value: d === 0 ? 'Today' : d === 1 ? 'Yesterday' : plural(d, 'day'), label: `last contact · ${clip(i.last.subject, 28)}`, tone: d >= 60 ? 'amber' : undefined });
  }
  const open = i.commitments.filter((c) => c.status === 'open');
  const ours = open.filter((c) => c.direction === 'ours'), theirs = open.filter((c) => c.direction === 'theirs');
  if (ours.length) {
    const late = Math.max(0, ...ours.map((c) => (c.dueDate && c.dueDate < i.today ? daysBetween(c.dueDate, i.today) ?? 0 : 0)));
    out.push({ value: `We owe ${ours.length}`, label: `${clip(ours[0].text, 24)}${late ? ` · ${plural(late, 'day')} late` : ''}`, tone: late ? 'red' : undefined });
  } else if (theirs.length) {
    out.push({ value: `Owes us ${theirs.length}`, label: clip(theirs[0].text, 30), tone: 'amber' });
  }
  const year = i.today.slice(0, 4);
  const n = i.meetingDates.filter((d) => d.slice(0, 4) === year && d <= i.today).length;
  if (n) out.push({ value: String(n), label: n === 1 ? 'meeting this year' : 'meetings this year' });
  if (i.companyMonthly) out.push({ value: i.companyMonthly, label: 'a month at their company', tone: 'green' });
  return out;
}

// ── The trail across months ─────────────────────────────────────────────────

export type TrailKind = 'meeting' | 'email' | 'note' | 'call';
export interface TrailEvent { kind: TrailKind; date: string; label: string; pos: number; today: boolean; showLabel: boolean; record?: { kind: 'meeting' | 'note'; id: number } }
export interface MonthTrail { events: TrailEvent[]; months: { pos: number; label: string }[]; since: string; counts: Record<TrailKind, number> }

/** How far back the trail looks, and how many dots it draws. */
export const TRAIL_DAYS = 120;
export const TRAIL_MAX = 10;
const RANK: Record<TrailKind, number> = { meeting: 0, call: 1, email: 2, note: 3 };
const LABEL_GAP = 11;

export interface TrailInput {
  today: string;
  meetings: Pick<Meeting, 'id' | 'title' | 'meetingDate' | 'isCancelled'>[];
  emails: Pick<EmailRecord, 'subject' | 'receivedAt'>[];
  touches: Pick<Touch, 'kind' | 'at' | 'subject'>[];
  notes: Pick<Note, 'id' | 'title' | 'updatedAt'>[];
}

/** Meetings, emails, calls and notes with a person over the last four months, placed by date between the first of
 * the earliest month and today; the latest ten; a label gives way when it would overlap the one before. Pure. */
export function monthTrail(i: TrailInput): MonthTrail {
  const from = (() => { const d = new Date(`${i.today}T12:00:00`); d.setDate(d.getDate() - TRAIL_DAYS); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const raw: Omit<TrailEvent, 'pos' | 'showLabel'>[] = [
    ...i.meetings.filter((m) => !m.isCancelled && m.meetingDate).map((m) => ({ kind: 'meeting' as const, date: day(m.meetingDate), label: m.title, today: day(m.meetingDate) === i.today, record: { kind: 'meeting' as const, id: m.id } })),
    ...i.emails.filter((e) => e.receivedAt).map((e) => ({ kind: 'email' as const, date: day(e.receivedAt), label: e.subject || 'Email', today: day(e.receivedAt) === i.today })),
    ...i.touches.map((t) => ({ kind: (t.kind === 'call' || t.kind === 'whatsapp' ? 'call' : t.kind === 'meeting' ? 'meeting' : 'email') as TrailKind, date: day(t.at), label: t.subject || (t.kind === 'call' ? 'Call' : t.kind === 'whatsapp' ? 'WhatsApp' : t.kind === 'meeting' ? 'Met' : 'Email'), today: day(t.at) === i.today })),
    ...i.notes.filter((n) => n.updatedAt).map((n) => ({ kind: 'note' as const, date: day(n.updatedAt), label: n.title || 'Note', today: day(n.updatedAt) === i.today, record: { kind: 'note' as const, id: n.id } })),
  ].filter((e) => e.date >= from && e.date <= i.today)
    // One dot a day: the meeting if there was one, else the call, the email, the note.
    .sort((a, b) => a.date.localeCompare(b.date) || RANK[a.kind] - RANK[b.kind])
    .filter((e, n, all) => n === 0 || all[n - 1].date !== e.date)
    .slice(-TRAIL_MAX);
  const counts: Record<TrailKind, number> = { meeting: 0, email: 0, note: 0, call: 0 };
  raw.forEach((e) => { counts[e.kind] += 1; });
  if (!raw.length) return { events: [], months: [], since: '', counts };
  const start = `${raw[0].date.slice(0, 7)}-01`;
  const span = Math.max(1, daysBetween(start, i.today) ?? 1);
  // The line keeps a margin each side so the first and last labels fit.
  const at = (d: string) => Math.round((4 + ((daysBetween(start, d) ?? 0) / span) * 92) * 10) / 10;
  const events: TrailEvent[] = raw.map((e) => ({ ...e, label: clip(e.label, 22), pos: at(e.date), showLabel: true }));
  // Labels are decided from the right: today's (and the latest) always show.
  let next = Infinity;
  for (let n = events.length - 1; n >= 0; n--) {
    events[n].showLabel = next - events[n].pos >= LABEL_GAP;
    if (events[n].showLabel) next = events[n].pos;
  }
  const months: MonthTrail['months'] = [];
  for (let d = new Date(`${start}T12:00:00`); ; d.setMonth(d.getMonth() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    if (iso > i.today) break;
    months.push({ pos: at(iso), label: MONTHS[d.getMonth()] });
  }
  return { events, months, since: MONTHS[Number(start.slice(5, 7)) - 1], counts };
}

// ── Open with them ──────────────────────────────────────────────────────────

export interface OpenRow {
  kind: 'commitment' | 'proposal';
  id: number;
  title: string;
  sub: string;
  age: string;
  tone: 'red' | 'amber' | 'ok';
  action: { kind: 'mark_kept' | 'open'; label: string };
  glyph: string;
  glyphTone: 'red' | 'amber' | 'blue';
}

/** What is open with a person: the promises either way, and the open proposals they are the contact on. Pure. */
export function openWithRows(c: Pick<Contact, 'id'>, i: { today: string; commitments: Commitment[]; proposals: Proposal[]; reviewer: (p: Proposal) => string }): OpenRow[] {
  const rows: OpenRow[] = [];
  for (const m of i.commitments) {
    if (m.contactId !== c.id || m.status !== 'open') continue;
    const late = m.dueDate ? daysBetween(m.dueDate, i.today) ?? 0 : 0;
    const ours = m.direction === 'ours';
    rows.push({
      kind: 'commitment', id: m.id, title: m.text,
      sub: [`${ours ? 'You promised' : 'They promised'}${m.createdAt ? ` on ${fmtDateShort(day(m.createdAt), true)}` : ''}`, m.dueDate ? `due ${fmtDateShort(m.dueDate, true)}` : 'no date'].join(' · '),
      age: late > 0 ? `${plural(late, 'day')} late` : m.dueDate ? (late === 0 ? 'due today' : `in ${plural(-late, 'day')}`) : '',
      tone: late > 0 ? (ours ? 'red' : 'amber') : 'ok', action: { kind: 'mark_kept', label: ours ? 'Mark kept' : 'Received' }, glyph: ours ? '⚑' : '⚐', glyphTone: ours ? 'red' : 'amber',
    });
  }
  for (const p of i.proposals) {
    if (p.archived || p.primaryContactId !== c.id || !isOpenProposal(p)) continue;
    const stage = stageOfProposal(p);
    const since = stageSince(p);
    const d = since ? Math.max(0, daysBetween(since, i.today) ?? 0) : null;
    const where = p.status === PS.REQUEST ? 'requested' : p.status === PS.DRAFTING ? 'drafting' : p.status === PS.REVIEW ? `in review with ${i.reviewer(p).split(' ')[0]}` : 'with the client';
    rows.push({
      kind: 'proposal', id: p.id, title: `${p.client} — ${p.type || 'Proposal'}`, sub: `Proposal SL# ${p.id} · ${where}`,
      age: d == null ? '' : plural(d, 'day'), tone: d != null && d >= 14 ? 'amber' : 'ok', action: { kind: 'open', label: 'Open' },
      glyph: stage === 'review' ? '◔' : stage === 'client' ? '✉' : '✎', glyphTone: stage === 'review' ? 'amber' : 'blue',
    });
  }
  const rank = (r: OpenRow) => (r.tone === 'red' ? 0 : r.tone === 'amber' ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b));
}

export { CHANNEL_ICON };
