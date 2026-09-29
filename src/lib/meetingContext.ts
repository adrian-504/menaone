// The meeting page with its context (owner, 29-Sep-2026, Concept B): Ahmad writes
// his notes in the boxes and wants the client beside them without leaving the
// page — where we stand, who is in the room, what happened last time, and the
// promises still open. Panels with nothing in them are left out; an internal
// meeting (no client) has only In the room. Pure: tabs/meetingContext.ts renders it.

import { buildCompanyState, clauseText, type CompanyBriefInput } from './companyBrief';
import { earlierMeetings } from './meetingRecap';
import { meetingExcerpt } from './meetingExcerpt';
import type { Commitment, Contact, Meeting } from './types';

export interface RoomPerson {
  name: string;
  initials: string;
  role: string | null;
  decisionMaker: boolean;
  /** The contact they matched, when they did. */
  contactId: number | null;
  internal: boolean;
}

export interface LastTime {
  id: number;
  title: string;
  date: string | null;
  excerpt: string | null;
  decisions: number;
  promises: number;
  /** What they promised us in it and still owe. */
  stillOwed: { id: number; text: string }[];
}

export interface MeetingContext {
  stand: string | null;
  room: RoomPerson[];
  lastTime: LastTime | null;
  openPromises: Commitment[];
}

/** An attendee as the page matched them (lib/clientMatch.ts meetingPeople). */
export interface AttendeeMatch { name: string; status: 'internal' | 'contact' | 'new'; contact: Pick<Contact, 'id' | 'name' | 'role' | 'isDecisionMaker'> | null }

const initials = (name: string) => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
const lines = (s: string | null | undefined) => (s || '').split('\n').map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '').trim()).filter(Boolean);

/**
 * `brief` is the company's input for Company 360 (null for an internal meeting);
 * `people` the attendees as matched; `sameClient` tells the client's meetings.
 */
export function meetingContext(m: Meeting, brief: CompanyBriefInput | null, people: AttendeeMatch[], meetings: Meeting[], commitments: Commitment[], sameClient: (x: Meeting) => boolean): MeetingContext {
  const room: RoomPerson[] = people.map((p) => {
    const name = p.contact?.name || p.name;
    return { name, initials: initials(name), role: p.contact?.role || null, decisionMaker: !!p.contact?.isDecisionMaker, contactId: p.contact?.id ?? null, internal: p.status === 'internal' };
  }).sort((a, b) => Number(a.internal) - Number(b.internal) || Number(b.decisionMaker) - Number(a.decisionMaker) || Number(b.contactId != null) - Number(a.contactId != null));
  if (!brief) return { stand: null, room, lastTime: null, openPromises: [] };

  const stand = buildCompanyState(brief).filter((c) => c.key === 'relationship' || c.key === 'inflight' || c.key === 'commitments').map(clauseText).join(' ') || null;

  const last = earlierMeetings(m, meetings, sameClient, 1)[0] ?? null;
  const fromLast = last ? commitments.filter((c) => c.sourceType === 'meeting' && c.sourceId === last.id && c.status !== 'dropped') : [];
  const lastTime: LastTime | null = last ? {
    id: last.id, title: last.title, date: last.meetingDate, excerpt: meetingExcerpt(last), decisions: lines(last.decisions).length, promises: fromLast.length,
    stillOwed: fromLast.filter((c) => c.direction === 'theirs' && c.status === 'open').map((c) => ({ id: c.id, text: c.text })),
  } : null;

  const companyId = brief.company.id;
  const openPromises = commitments
    .filter((c) => c.status === 'open' && companyId != null && c.companyId === companyId)
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.id - b.id);

  return { stand, room, lastTime, openPromises };
}
