// The phone's snapshot (docs/phone-sync.md, "mena-one-phone/1"): what the
// iPhone companion reads from the OneDrive folder. Pure — built from the same
// rules the Mac's own pages use (My Day, Company 360, Promises), never
// re-derived here. phoneSync.ts decides when to write it.
//
// Business records only: no email bodies, no attachments, no agreements
// section, no proposal money beyond what a company's brief already says.

import { buildAttention, buildComingUp, type AttentionItem, type MyDayInput, type UpcomingEntry } from './myday';
import { buildCompanyState, clauseText, companyRecords, lastContactByPerson, liveThreads, relationshipStatus, threadStand, type CompanyBriefInput } from './companyBrief';
import { CLOSED_WINDOW_DAYS } from './promises';
import { localIsoDate } from './outlookTime';
import type { Commitment, Company, Contact, EmailRecord, Meeting, Todo } from './types';

export const SNAPSHOT_FORMAT = 'mena-one-phone/1';
export const CAPTURE_FORMAT = 'mena-one-capture/1';
/** Meetings from this many days back to this many days ahead. */
export const MEETING_WINDOW_DAYS = 30;
/** Capture ids echoed back to the phone. */
export const IMPORTED_IDS_KEPT = 200;

// ── The contract's shapes ───────────────────────────────────────────────────

export interface PhoneAttention {
  key: string; kind: string; tone: string; score: number;
  title: string; companyId: number | null; companyName: string | null;
  reason: string; when: string | null; record: { kind: string; id: number } | null; commitmentId: number | null;
  children: PhoneAttention[];
}
export interface PhoneMeeting {
  id: number; title: string; date: string; startAt: string | null; endAt: string | null;
  companyId: number | null; companyName: string | null;
  attendees: string[]; attendeeEmails: string[];
  location: string | null; isOnline: boolean; onlineMeetingUrl: string | null;
  agenda: string | null; decisions: string | null; actionItems: string | null; followUp: string | null;
}
export interface PhoneTask {
  id: number; title: string; dueDate: string | null; priority: string | null;
  companyId: number | null; companyName: string | null; projectId: number | null; commitmentId: number | null;
}
export interface PhonePromise {
  id: number; direction: 'ours' | 'theirs'; text: string; dueDate: string | null;
  status: 'open' | 'kept' | 'dropped'; closedAt: string | null;
  companyId: number | null; companyName: string | null;
  contactId: number | null; contactName: string | null; contactEmail: string | null;
  sourceType: string | null; sourceId: number | null; todoId: number | null;
}
export interface PhoneContact { id: number; name: string | null; role: string | null; email: string | null; phone: string | null; whatsapp: string | null; isDecisionMaker: boolean }
export interface PhoneCompany {
  id: number; name: string; industries: string[]; country: string | null; city: string | null; status: string | null;
  relationship: { label: string; tone: string };
  brief: string[];
  threads: { kind: string; label: string; stand: string }[];
  lastContact: { date: string; label: string; kind: 'meeting' | 'email' } | null;
  contacts: PhoneContact[];
  pinnedNotes: { id: number; body: string; createdAt: string }[];
  recentMeetingIds: number[]; openTaskIds: number[]; openPromiseIds: number[];
}
export interface PhoneComingUpDay { date: string; entries: { kind: string; id: number; label: string; time: string | null }[] }

export interface PhoneSnapshot {
  format: typeof SNAPSHOT_FORMAT;
  generatedAt: string;
  today: string;
  mac: string;
  importedCaptureIds: string[];
  failedCaptures: { id: string; error: string }[];
  attention: PhoneAttention[];
  meetings: PhoneMeeting[];
  tasks: PhoneTask[];
  promises: PhonePromise[];
  companies: PhoneCompany[];
  comingUp: PhoneComingUpDay[];
}

export interface PhoneCapture {
  format: typeof CAPTURE_FORMAT;
  id: string;
  createdAt: string;
  device: string;
  kind: 'commitment' | 'task' | 'note' | 'keep' | 'done';
  text?: string | null;
  direction?: 'ours' | 'theirs' | null;
  companyId?: number | null;
  companyName?: string | null;
  contactId?: number | null;
  dueDate?: string | null;
  commitmentId?: number | null;
  todoId?: number | null;
}

// ── Input ───────────────────────────────────────────────────────────────────

/** A pinned company note entry (company_note_entries). */
export interface PhonePinnedNote { id: number; companyId: number | null; companyName: string | null; body: string; createdAt: string }

export interface PhoneSnapshotInput extends Omit<MyDayInput, 'attentionShown' | 'companies' | 'commitments'> {
  /** ISO time with offset (see isoWithOffset). */
  generatedAt: string;
  mac: string;
  companies: Company[];
  contacts: Contact[];
  commitments: Commitment[];
  emails: EmailRecord[];
  pinnedNotes: PhonePinnedNote[];
  importedCaptureIds: string[];
  failedCaptures: { id: string; error: string }[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

/** Local time with its UTC offset: 2026-09-24T09:12:03+03:00. */
export function isoWithOffset(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${localIsoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** A stored time (UTC "Z", an offset, or local) as local time with offset. */
function timeWithOffset(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : isoWithOffset(d);
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return localIsoDate(new Date(y, m - 1, d + n));
}

/** Outlook locations arrive as a full postal address plus a joining link; on a
 * phone only the first part is worth the space (as mobile/ did). */
export function shortLocation(loc: string | null | undefined): string | null {
  if (!loc || !loc.trim()) return null;
  if (/teams\.microsoft|meet\.google|zoom\./i.test(loc)) return 'Online';
  return loc.split(/[,;]/)[0].trim().slice(0, 40) || null;
}

const isOpenTask = (t: Todo) => t.status !== 'Done';

/** "Kick-off · Contoso Logistics" for meetings and tasks (just the title with
 * no company); "Contoso Logistics · Agreement ends" and the like for the rest. */
function comingUpLabel(e: UpcomingEntry, company: string | null): string {
  if (e.kind === 'meeting' || e.kind === 'task') return company ? `${e.title} · ${company}` : e.title;
  return e.detail ? `${e.title} · ${e.detail}` : e.title;
}

// ── Builder ─────────────────────────────────────────────────────────────────

export function buildPhoneSnapshot(i: PhoneSnapshotInput): PhoneSnapshot {
  const companyName = new Map(i.companies.map((c) => [c.id, c.name]));
  const nameFor = (id: number | null | undefined, typed: string | null | undefined): string | null =>
    (id != null ? companyName.get(id) : undefined) ?? (typed && typed.trim() ? typed : null);
  const contactById = new Map(i.contacts.map((c) => [c.id, c]));
  const commitmentByTodo = new Map(i.commitments.filter((c) => c.todoId != null).map((c) => [c.todoId!, c.id]));

  // Attention: My Day's list, same rules and order (snoozed rows are already out).
  const toAttention = (a: AttentionItem): PhoneAttention => ({
    key: a.key, kind: a.kind, tone: a.tone, score: a.score,
    title: a.title, companyId: a.companyId ?? null, companyName: nameFor(a.companyId, a.companyName),
    reason: a.reason, when: a.when ?? null, record: a.record ? { kind: a.record.kind, id: a.record.id } : null,
    commitmentId: a.commitmentId ?? null, children: (a.children || []).map(toAttention),
  });
  const attention = buildAttention({ ...i, companies: i.companies, commitments: i.commitments }).map(toAttention);

  // Meetings: not cancelled, 30 days back to 30 days ahead.
  const from = addDays(i.today, -MEETING_WINDOW_DAYS);
  const to = addDays(i.today, MEETING_WINDOW_DAYS);
  const windowMeetings = i.meetings
    .filter((m): m is Meeting & { meetingDate: string } => !m.isCancelled && !!m.meetingDate && m.meetingDate >= from && m.meetingDate <= to)
    .sort((a, b) => a.meetingDate.localeCompare(b.meetingDate) || (a.startAt || '').localeCompare(b.startAt || '') || a.id - b.id);
  const meetings: PhoneMeeting[] = windowMeetings.map((m) => ({
    id: m.id, title: m.title, date: m.meetingDate, startAt: timeWithOffset(m.startAt), endAt: timeWithOffset(m.endAt),
    companyId: m.companyId ?? null, companyName: nameFor(m.companyId, m.companyName),
    attendees: [...(m.attendees || [])], attendeeEmails: [...(m.attendeeEmails || [])],
    location: m.isOnlineMeeting && !m.location ? 'Online' : shortLocation(m.location), isOnline: !!m.isOnlineMeeting, onlineMeetingUrl: m.onlineMeetingUrl || null,
    agenda: m.agenda || null, decisions: m.decisions || null, actionItems: m.actionItems || null, followUp: m.followUp || null,
  }));

  // Tasks: every open todo.
  const openTodos = i.todos.filter(isOpenTask).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.id - b.id);
  const tasks: PhoneTask[] = openTodos.map((t) => ({
    id: t.id, title: t.title, dueDate: t.dueDate || null, priority: t.priority || null,
    companyId: t.companyId ?? null, companyName: nameFor(t.companyId, t.client), projectId: t.projectId ?? null,
    commitmentId: commitmentByTodo.get(t.id) ?? null,
  }));

  // Promises: open, plus kept or dropped in the last CLOSED_WINDOW_DAYS days.
  const closedSince = addDays(i.today, -CLOSED_WINDOW_DAYS);
  const promises: PhonePromise[] = i.commitments
    .filter((c) => c.status === 'open' || (!!c.closedAt && c.closedAt.slice(0, 10) >= closedSince))
    .sort((a, b) => a.id - b.id)
    .map((c) => {
      const who = c.contactId != null ? contactById.get(c.contactId) : undefined;
      return {
        id: c.id, direction: c.direction, text: c.text, dueDate: c.dueDate || null, status: c.status, closedAt: c.closedAt || null,
        companyId: c.companyId ?? null, companyName: nameFor(c.companyId, null),
        contactId: c.contactId ?? null, contactName: who?.name ?? null, contactEmail: who?.email ?? null,
        sourceType: c.sourceType ?? null, sourceId: c.sourceId ?? null, todoId: c.todoId ?? null,
      };
    });

  // Companies: not archived, each with its brief from the Company 360 rules.
  const graph = {
    companies: i.companies, opportunities: i.opportunities, projects: i.projects, meetings: i.meetings, proposals: i.proposals,
    agreements: i.agreements, contacts: i.contacts, todos: i.todos,
  };
  const windowIds = new Set(windowMeetings.map((m) => m.id));
  const companies: PhoneCompany[] = i.companies.filter((c) => !c.archived).sort((a, b) => a.id - b.id).map((co) => {
    const ref = { id: co.id, name: co.name };
    const pinned = i.pinnedNotes.filter((n) => (n.companyId != null ? n.companyId === co.id : n.companyName === co.name))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
    const input: CompanyBriefInput = {
      ...graph, company: ref, today: i.today, now: i.now.toISOString(), commitments: i.commitments, emails: i.emails,
      notes: pinned.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt, pinned: true })),
    };
    const r = companyRecords(input);
    // The pinned clause is the notes themselves: they travel in pinnedNotes.
    const brief = buildCompanyState(input).filter((c) => c.key !== 'pinned').map(clauseText).filter(Boolean);
    const threads = liveThreads(input, r).filter((t) => !t.dormant)
      .map((t) => ({ kind: t.record.kind, label: t.label, stand: threadStand(t.thread) }));
    const latest = [...lastContactByPerson(input, r).values()].sort((a, b) => b.date.localeCompare(a.date) || a.id - b.id)[0];
    const people = [...r.contacts].sort((a, b) => Number(!!b.isDecisionMaker) - Number(!!a.isDecisionMaker) || (a.name || '').localeCompare(b.name || '') || a.id - b.id);
    return {
      id: co.id, name: co.name, industries: [...(co.industries || [])], country: co.country || null, city: co.city || null, status: co.status || null,
      relationship: relationshipStatus(r),
      brief, threads,
      lastContact: latest ? { date: latest.date, label: `${latest.kind === 'meeting' ? 'Meeting' : 'Email'} · ${latest.label}`, kind: latest.kind } : null,
      contacts: people.map((c) => ({ id: c.id, name: c.name, role: c.role || null, email: c.email || null, phone: c.phone || null, whatsapp: c.whatsapp || null, isDecisionMaker: !!c.isDecisionMaker })),
      pinnedNotes: pinned.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt.slice(0, 10) })),
      recentMeetingIds: r.meetings.filter((m) => windowIds.has(m.id)).sort((a, b) => (b.meetingDate || '').localeCompare(a.meetingDate || '') || b.id - a.id).map((m) => m.id),
      openTaskIds: r.todos.filter(isOpenTask).map((t) => t.id).sort((a, b) => a - b),
      openPromiseIds: r.commitments.map((c) => c.id).sort((a, b) => a - b),
    };
  });

  // Coming up: the next seven days, as My Day shows them.
  const comingUp: PhoneComingUpDay[] = buildComingUp(i, 7).map((d) => ({
    date: d.date,
    entries: d.entries.map((e) => ({ kind: e.kind, id: e.record.id, label: comingUpLabel(e, nameFor(e.companyId, e.companyName)), time: e.time ?? null })),
  }));

  return {
    format: SNAPSHOT_FORMAT, generatedAt: i.generatedAt, today: i.today, mac: i.mac,
    importedCaptureIds: i.importedCaptureIds.slice(-IMPORTED_IDS_KEPT), failedCaptures: i.failedCaptures.map((f) => ({ id: f.id, error: f.error })),
    attention, meetings, tasks, promises, companies, comingUp,
  };
}

// ── Serialising ─────────────────────────────────────────────────────────────

/** JSON with keys in a fixed (sorted) order at every level, so the same data
 * always gives the same bytes. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k];
      out[k] = x === undefined ? null : sortKeys(x);
    }
    return out;
  }
  return v;
}

/** The snapshot's content without its timestamp — what "unchanged" compares. */
export function snapshotContent(s: PhoneSnapshot): string {
  return stableJson({ ...s, generatedAt: null });
}

// ── Shape checks (the examples in docs/phone and the tests) ────────────────

type Shape = 'string' | 'number' | 'boolean' | 'string?' | 'number?' | 'array' | 'object' | 'object?';
const SHAPES: Record<string, Record<string, Shape>> = {
  snapshot: { format: 'string', generatedAt: 'string', today: 'string', mac: 'string', importedCaptureIds: 'array', failedCaptures: 'array',
    attention: 'array', meetings: 'array', tasks: 'array', promises: 'array', companies: 'array', comingUp: 'array' },
  attention: { key: 'string', kind: 'string', tone: 'string', score: 'number', title: 'string', companyId: 'number?', companyName: 'string?',
    reason: 'string', when: 'string?', record: 'object?', commitmentId: 'number?', children: 'array' },
  meeting: { id: 'number', title: 'string', date: 'string', startAt: 'string?', endAt: 'string?', companyId: 'number?', companyName: 'string?',
    attendees: 'array', attendeeEmails: 'array', location: 'string?', isOnline: 'boolean', onlineMeetingUrl: 'string?',
    agenda: 'string?', decisions: 'string?', actionItems: 'string?', followUp: 'string?' },
  task: { id: 'number', title: 'string', dueDate: 'string?', priority: 'string?', companyId: 'number?', companyName: 'string?', projectId: 'number?', commitmentId: 'number?' },
  promise: { id: 'number', direction: 'string', text: 'string', dueDate: 'string?', status: 'string', closedAt: 'string?', companyId: 'number?', companyName: 'string?',
    contactId: 'number?', contactName: 'string?', contactEmail: 'string?', sourceType: 'string?', sourceId: 'number?', todoId: 'number?' },
  company: { id: 'number', name: 'string', industries: 'array', country: 'string?', city: 'string?', status: 'string?', relationship: 'object', brief: 'array',
    threads: 'array', lastContact: 'object?', contacts: 'array', pinnedNotes: 'array', recentMeetingIds: 'array', openTaskIds: 'array', openPromiseIds: 'array' },
  contact: { id: 'number', name: 'string?', role: 'string?', email: 'string?', phone: 'string?', whatsapp: 'string?', isDecisionMaker: 'boolean' },
  comingUp: { date: 'string', entries: 'array' },
  entry: { kind: 'string', id: 'number', label: 'string', time: 'string?' },
  capture: { format: 'string', id: 'string', createdAt: 'string', device: 'string', kind: 'string' },
};

function check(obj: unknown, shape: string, path: string, errs: string[]): void {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { errs.push(`${path}: not an object`); return; }
  const o = obj as Record<string, unknown>;
  for (const [k, t] of Object.entries(SHAPES[shape])) {
    const v = o[k];
    const nullable = t.endsWith('?');
    if (!(k in o)) { errs.push(`${path}.${k}: missing`); continue; }
    if (v === null) { if (!nullable) errs.push(`${path}.${k}: null`); continue; }
    const base = t.replace('?', '');
    const ok = base === 'array' ? Array.isArray(v) : base === 'object' ? typeof v === 'object' && !Array.isArray(v) : typeof v === base;
    if (!ok) errs.push(`${path}.${k}: expected ${t}`);
  }
}

/** Problems with a snapshot's shape; empty when it matches the contract. */
export function snapshotShapeErrors(s: unknown): string[] {
  const errs: string[] = [];
  check(s, 'snapshot', 'snapshot', errs);
  if (errs.length) return errs;
  const o = s as PhoneSnapshot;
  if (o.format !== SNAPSHOT_FORMAT) errs.push(`format: ${o.format}`);
  const each = (xs: unknown[], shape: string, name: string) => xs.forEach((x, n) => check(x, shape, `${name}[${n}]`, errs));
  const walkAttention = (xs: PhoneAttention[], name: string) => xs.forEach((a, n) => { check(a, 'attention', `${name}[${n}]`, errs); if (Array.isArray(a?.children)) walkAttention(a.children, `${name}[${n}].children`); });
  walkAttention(o.attention, 'attention');
  each(o.meetings, 'meeting', 'meetings');
  each(o.tasks, 'task', 'tasks');
  each(o.promises, 'promise', 'promises');
  each(o.companies, 'company', 'companies');
  o.companies.forEach((c, n) => Array.isArray(c?.contacts) && each(c.contacts, 'contact', `companies[${n}].contacts`));
  each(o.comingUp, 'comingUp', 'comingUp');
  o.comingUp.forEach((d, n) => Array.isArray(d?.entries) && each(d.entries, 'entry', `comingUp[${n}].entries`));
  return errs;
}

/** Problems with a capture file's shape; empty when it matches the contract. */
export function captureShapeErrors(c: unknown): string[] {
  const errs: string[] = [];
  check(c, 'capture', 'capture', errs);
  if (errs.length) return errs;
  const o = c as PhoneCapture;
  if (o.format !== CAPTURE_FORMAT) errs.push(`format: ${o.format}`);
  if (!['commitment', 'task', 'note', 'keep', 'done'].includes(o.kind)) errs.push(`kind: ${o.kind}`);
  if (['commitment', 'task', 'note'].includes(o.kind) && !(typeof o.text === 'string' && o.text.trim())) errs.push('text: missing');
  if (o.kind === 'commitment' && o.direction !== 'ours' && o.direction !== 'theirs') errs.push('direction: ours or theirs');
  if (o.kind === 'keep' && typeof o.commitmentId !== 'number') errs.push('commitmentId: missing');
  if (o.kind === 'done' && typeof o.todoId !== 'number') errs.push('todoId: missing');
  return errs;
}
