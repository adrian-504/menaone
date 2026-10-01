// Contacts in My Day's language (1.60 "pages-2"): one flat list of people —
// who they are and where, what is open with each of them — under a strip that
// counts people, decision makers, the companies with no contact person and
// who from your meetings isn't a contact yet. Nobody is flagged for a lack of
// contact (owner, 1-Oct-2026); the last contact, where shown, is a plain fact.
// Pure: core/contacts.ts draws it.

import type { Commitment, Contact, EmailRecord, Meeting, Proposal, Touch } from './types';
import { PS } from './commercial';
import { daysBetween } from './pipeline';
import { fmtDateShort, fmtWeekday } from './dates';
import { plural, type StripPanel } from './pageKit';

export type Channel = 'meeting' | 'email' | 'call' | 'whatsapp';
export interface LastSpoke { date: string; channel: Channel; subject: string }
export const CHANNEL_ICON: Record<Channel, string> = { meeting: '◎', email: '✉', call: '☎', whatsapp: '✆' };

export interface SpokeInput {
  meetings: Pick<Meeting, 'title' | 'meetingDate' | 'startAt' | 'isCancelled' | 'attendeeEmails' | 'organizerEmail'>[];
  emails: Pick<EmailRecord, 'senderEmail' | 'receivedAt' | 'subject'>[];
  touches: Pick<Touch, 'contactId' | 'kind' | 'direction' | 'at' | 'subject'>[];
  today: string;
}

const day = (s: string | null | undefined) => (s || '').slice(0, 10);
const TOUCH_SUBJECT: Record<string, string> = { 'email_out:out': 'you emailed', 'email_in:in': 'they emailed', 'call:out': 'you called', 'call:in': 'they called', 'whatsapp:out': 'WhatsApp', 'whatsapp:in': 'WhatsApp from them', 'meeting:out': 'met', 'meeting:in': 'met' };

/** The latest meeting, email or logged touch with each contact, up to today. Pure. */
export function lastSpokeByContact(contacts: Pick<Contact, 'id' | 'email'>[], i: SpokeInput): Map<number, LastSpoke> {
  const byEmail = new Map<string, LastSpoke>();
  const offerEmail = (email: string | null | undefined, c: LastSpoke) => {
    const e = (email || '').trim().toLowerCase();
    if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(c.date) || c.date > i.today) return;
    const cur = byEmail.get(e);
    if (!cur || c.date > cur.date) byEmail.set(e, c);
  };
  for (const m of i.meetings) {
    if (m.isCancelled) continue;
    const date = day(m.startAt ? localDay(m.startAt) : m.meetingDate);
    const c: LastSpoke = { date, channel: 'meeting', subject: m.title };
    offerEmail(m.organizerEmail, c);
    for (const a of m.attendeeEmails || []) offerEmail(a, c);
  }
  for (const e of i.emails) offerEmail(e.senderEmail, { date: day(e.receivedAt), channel: 'email', subject: e.subject || 'email' });
  const out = new Map<number, LastSpoke>();
  for (const c of contacts) {
    const hit = byEmail.get((c.email || '').trim().toLowerCase());
    if (hit && c.email) out.set(c.id, hit);
  }
  for (const t of i.touches) {
    if (t.contactId == null) continue;
    const date = day(t.at);
    if (!date || date > i.today) continue;
    const cur = out.get(t.contactId);
    if (cur && cur.date > date) continue;
    const channel: Channel = t.kind === 'call' ? 'call' : t.kind === 'whatsapp' ? 'whatsapp' : t.kind === 'meeting' ? 'meeting' : 'email';
    out.set(t.contactId, { date, channel, subject: t.subject || TOUCH_SUBJECT[`${t.kind}:${t.direction}`] || 'contact' });
  }
  return out;
}

/** A timestamp's day in local time (meetings are the user's days). */
function localDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface SpokeCell { headline: string; sub: string; days: number | null }

/** The Last contact cell (a column that is off by default): the date as a plain fact — "Today", "Yesterday" or the
 * date — with the channel and subject under it. However long ago it was, it is never coloured or flagged. Pure. */
export function spokeCell(last: LastSpoke | undefined, today: string): SpokeCell {
  if (!last) return { headline: '—', sub: '', days: null };
  const days = Math.max(0, daysBetween(last.date, today) ?? 0);
  const subject = last.subject.length > 34 ? `${last.subject.slice(0, 33).trimEnd()}…` : last.subject;
  return { headline: days === 0 ? 'Today' : days === 1 ? 'Yesterday' : fmtDateShort(last.date, true), sub: `${CHANNEL_ICON[last.channel]} ${subject}`, days };
}

export interface OpenChip { text: string; tone: 'red' | 'amber' }

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** What is open with a person: promises we owe them (red, "late" when overdue), what they owe us (amber), and the
 * proposals they are the contact on that need something — one promised, an offer about to lapse, a revision. Pure. */
export function openWith(c: Pick<Contact, 'id'>, i: { commitments: Pick<Commitment, 'contactId' | 'direction' | 'status' | 'dueDate' | 'text'>[]; proposals: Pick<Proposal, 'primaryContactId' | 'status' | 'promisedBy' | 'validUntil' | 'revision' | 'archived'>[]; today: string }): OpenChip[] {
  const mine = i.commitments.filter((x) => x.contactId === c.id && x.status === 'open');
  const ours = mine.filter((x) => x.direction === 'ours');
  const theirs = mine.filter((x) => x.direction === 'theirs');
  const out: OpenChip[] = [];
  if (ours.length) out.push({ text: `We owe ${ours.length}${ours.some((x) => x.dueDate && x.dueDate < i.today) ? ' · late' : ''}`, tone: 'red' });
  if (theirs.length) out.push({ text: `Owes us ${theirs.length}${theirs.length === 1 ? ` · ${clip(theirs[0].text, 22)}` : ''}`, tone: 'amber' });
  for (const p of i.proposals) {
    if (p.archived || p.primaryContactId !== c.id) continue;
    const promised = p.status === PS.REQUEST && p.promisedBy ? daysBetween(i.today, p.promisedBy) : null;
    if (promised != null) out.push({ text: promised < 0 ? 'Proposal promise passed' : `Proposal due ${promised === 0 ? 'today' : fmtWeekday(p.promisedBy, 'short')}`, tone: 'red' });
    else if (p.status === PS.DRAFTING && (p.revision ?? 1) > 1) out.push({ text: `Revision ${p.revision}`, tone: 'red' });
    else if (p.status === PS.SENT && p.validUntil && p.validUntil >= i.today && (daysBetween(i.today, p.validUntil) ?? 99) <= 7) out.push({ text: `Answer by ${fmtWeekday(p.validUntil, 'short')}`, tone: 'amber' });
  }
  return out.slice(0, 3);
}

export interface ContactFigures { id: number; name: string; company: string; decisionMaker: boolean; last: LastSpoke | undefined }
export type ContactBucket = 'dm';

export function contactBuckets(c: ContactFigures): ContactBucket[] {
  return c.decisionMaker ? ['dm'] : [];
}

/** The strip: people (companies, spoke this month) · decision makers (where) · companies with no contact person
 * (opens Clean-up's "Without contacts") · from meetings, not yet a contact (opens the review). `noPerson` is the
 * names of the companies with nobody on file. Pure. */
export function contactsStrip(rows: ContactFigures[], today: string, fromMeetings: number, noPerson: string[] = []): StripPanel[] {
  const companies = new Set(rows.map((r) => r.company).filter(Boolean));
  const month = today.slice(0, 7);
  const spoke = rows.filter((r) => r.last?.date.slice(0, 7) === month).length;
  const dms = rows.filter((r) => r.decisionMaker);
  const dmCompanies = [...new Set(dms.map((r) => r.company).filter(Boolean))];
  return [
    { key: 'all', total: true, n: plural(rows.length, 'person', 'people'), count: rows.length, label: `across ${plural(companies.size, 'company', 'companies')}`, lead: 'spoke this month', detail: String(spoke), tone: 'coral' },
    { key: 'dm', n: String(dms.length), count: dms.length, label: dms.length === 1 ? 'decision maker' : 'decision makers', lead: 'at', detail: dmCompanies.slice(0, 3).join(', ') + (dmCompanies.length > 3 ? ` +${dmCompanies.length - 3}` : ''), tone: 'navy' },
    { key: 'noperson', n: String(noPerson.length), count: noPerson.length, label: noPerson.length === 1 ? 'company with no contact person' : 'companies with no contact person', lead: '', detail: noPerson.slice(0, 2).join(', ') + (noPerson.length > 2 ? ` +${noPerson.length - 2}` : ''), tone: 'amber', action: "openCleanup('company-contacts')" },
    { key: 'meetings', n: String(fromMeetings), count: fromMeetings, label: 'from meetings, not yet a contact', lead: 'from', detail: 'Outlook invites · Review', tone: 'blue', action: 'openPeopleFromMeetings()' },
  ];
}
