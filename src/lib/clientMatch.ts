// Matching people and meetings to client companies by email address:
// a contact's exact address, or the domain of their email (contoso.com →
// Contoso). Company websites are suggested from the same domains. Personal
// mail providers and MENA BIG's own domains never count.

import { S } from './state';
import type { Company, Contact, Meeting, Opportunity } from './types';

export const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com', 'icloud.com',
  'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.net', 'mail.com', 'yandex.com', 'zoho.com',
  'hotmail.co.uk', 'outlook.sa', 'hotmail.fr', 'yahoo.fr', 'live.co.uk',
]);

export function emailDomain(email: string | null | undefined): string | null {
  const m = (email || '').trim().toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})$/);
  return m ? m[1] : null;
}

export function websiteDomain(url: string | null | undefined): string | null {
  const m = (url || '').trim().toLowerCase().match(/^(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})/);
  return m ? m[1] : null;
}

/** MENA BIG's own mail domains: the connected Outlook account and team emails. */
export function ownDomains(): Set<string> {
  const out = new Set<string>();
  const add = (e: string | null | undefined) => { const d = emailDomain(e); if (d) out.add(d); };
  add(S.ms365Status?.accountEmail);
  S.team.forEach((t) => add(t.email));
  for (const d of S.ownDomains) out.add(d);
  for (const d of calendarOwnerDomains()) out.add(d);
  return out;
}

let ownerCache: { meetings: unknown; length: number; domains: string[] } | null = null;

/** A company domain on most synced meetings is the calendar owner's own
 * (it covers colleagues' addresses when the Outlook account isn't known). */
function calendarOwnerDomains(): string[] {
  if (ownerCache && ownerCache.meetings === S.meetings && ownerCache.length === S.meetings.length) return ownerCache.domains;
  const synced = S.meetings.filter((m) => m.source === 'outlook');
  const counts = new Map<string, number>();
  for (const m of synced) {
    for (const d of new Set([...(m.attendeeEmails || []), m.organizerEmail || ''].map(emailDomain))) {
      if (d && !PERSONAL_DOMAINS.has(d)) counts.set(d, (counts.get(d) || 0) + 1);
    }
  }
  const domains = synced.length >= 3 ? [...counts].filter(([, n]) => n / synced.length >= 0.6).map(([d]) => d) : [];
  ownerCache = { meetings: S.meetings, length: S.meetings.length, domains };
  return domains;
}

const isCompanyDomain = (d: string | null, own: Set<string>): d is string => !!d && !PERSONAL_DOMAINS.has(d) && !own.has(d);

function companyForContact(c: Contact): Company | undefined {
  if (c.companyId != null) return S.companies.find((x) => x.id === c.companyId);
  const n = (c.clientName || '').trim().toLowerCase();
  return n ? S.companies.find((x) => x.name.toLowerCase() === n) : undefined;
}

export interface DomainOwner { company: Company; source: 'confirmed' | 'contacts' | 'website'; contacts: number }

/** Which companies each email domain belongs to. */
export function domainIndex(): Map<string, DomainOwner[]> {
  const own = ownDomains();
  const index = new Map<string, DomainOwner[]>();
  const add = (domain: string, company: Company, source: DomainOwner['source']) => {
    const list = index.get(domain) || [];
    const existing = list.find((x) => x.company.id === company.id);
    if (existing) {
      if (source === 'contacts') existing.contacts++;
      if (source === 'confirmed' || (source === 'website' && existing.source === 'contacts')) existing.source = source;
    } else list.push({ company, source, contacts: source === 'contacts' ? 1 : 0 });
    index.set(domain, list);
  };
  for (const c of S.contacts) {
    const d = emailDomain(c.email);
    const co = companyForContact(c);
    if (isCompanyDomain(d, own) && co) add(d, co, 'contacts');
  }
  for (const co of S.companies) {
    const d = websiteDomain(co.website);
    if (d && !own.has(d)) add(d, co, 'website');
  }
  for (const [domain, companyId] of Object.entries(S.companyDomains)) {
    const co = S.companies.find((x) => x.id === companyId);
    if (co) add(domain, co, 'confirmed');
  }
  return index;
}

export interface MeetingLinkSuggestion {
  company: Company;
  /** high: an attendee is a known contact, or the domain was confirmed before. */
  confidence: 'high' | 'medium';
  reasons: string[];
  contacts: Contact[];
  /** Attendees from that company who aren't contacts yet. */
  newPeople: { email: string; name: string | null }[];
  opportunity: Opportunity | null;
}

export function meetingEmails(m: Meeting): string[] {
  return [...new Set([...(m.attendeeEmails || []), m.organizerEmail || ''].map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')))];
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Companies a meeting is probably with, best first. */
export function suggestMeetingCompanies(m: Meeting, index = domainIndex()): MeetingLinkSuggestion[] {
  const own = ownDomains();
  const byCompany = new Map<number, { company: Company; score: number; reasons: Set<string>; contacts: Contact[]; domains: Set<string>; confirmed: boolean }>();
  const bump = (company: Company, score: number, reason: string) => {
    const e = byCompany.get(company.id) || { company, score: 0, reasons: new Set<string>(), contacts: [], domains: new Set<string>(), confirmed: false };
    e.score += score;
    e.reasons.add(reason);
    byCompany.set(company.id, e);
    return e;
  };
  const emails = meetingEmails(m).filter((e) => isCompanyDomain(emailDomain(e), own));
  for (const email of emails) {
    const contact = S.contacts.find((c) => (c.email || '').trim().toLowerCase() === email);
    const co = contact ? companyForContact(contact) : undefined;
    if (contact && co) {
      const e = bump(co, 10, `${contact.name || email} is a contact at ${co.name}`);
      e.contacts.push(contact);
      continue;
    }
    const domain = emailDomain(email)!;
    for (const owner of index.get(domain) || []) {
      const e = bump(owner.company, owner.source === 'confirmed' ? 8 : 4, `@${domain} ${owner.source === 'website' ? 'matches their website' : owner.source === 'confirmed' ? 'was linked to them before' : `is their contacts' email domain`}`);
      e.domains.add(domain);
      if (owner.source === 'confirmed') e.confirmed = true;
    }
  }
  const title = ` ${norm(m.title || '')} `;
  if (title.trim()) {
    for (const co of S.companies) {
      const n = norm(co.name);
      if (n.length >= 4 && title.includes(` ${n} `)) bump(co, 3, `The title mentions ${co.name}`);
    }
  }
  const list = [...byCompany.values()].sort((a, b) => b.score - a.score);
  return list.map((e) => {
    const knownEmails = new Set(S.contacts.map((c) => (c.email || '').trim().toLowerCase()));
    const names = new Map<string, string>();
    (m.attendeeEmails || []).forEach((email, i) => { if (m.attendees?.[i]) names.set(email.toLowerCase(), m.attendees[i]); });
    const newPeople = emails.filter((email) => e.domains.has(emailDomain(email)!) && !knownEmails.has(email)).map((email) => ({ email, name: names.get(email) || null }));
    const openOpps = S.opportunities.filter((o) => !o.archived && o.status === 'Open' && o.companyId === e.company.id);
    return {
      company: e.company,
      confidence: e.contacts.length > 0 || e.confirmed ? 'high' : 'medium',
      reasons: [...e.reasons],
      contacts: e.contacts,
      newPeople,
      opportunity: openOpps.length === 1 ? openOpps[0] : null,
    };
  });
}

/** Link automatically only when one company is clearly ahead on strong evidence. */
export function automaticMeetingLink(m: Meeting, index = domainIndex()): MeetingLinkSuggestion | null {
  if (m.companyId != null || (m.companyName || '').trim() || S.dismissedMeetingLinks.includes(m.id)) return null;
  const [best, second] = suggestMeetingCompanies(m, index);
  if (!best || best.confidence !== 'high') return null;
  if (second && second.confidence === 'high') return null;
  return best;
}

export interface WebsiteSuggestion { company: Company; domain: string; contacts: number; reason: string }

/** Websites for companies that have none, from their contacts' email domains. */
export function suggestWebsites(): WebsiteSuggestion[] {
  const own = ownDomains();
  const out: WebsiteSuggestion[] = [];
  for (const co of S.companies) {
    if ((co.website || '').trim() || co.archived) continue;
    const counts = new Map<string, number>();
    for (const c of S.contacts) {
      if (companyForContact(c)?.id !== co.id) continue;
      const d = emailDomain(c.email);
      if (isCompanyDomain(d, own)) counts.set(d, (counts.get(d) || 0) + 1);
    }
    for (const [domain, companyId] of Object.entries(S.companyDomains)) {
      if (companyId === co.id && !counts.has(domain)) counts.set(domain, 0);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best) continue;
    // A domain shared by several companies (a group's mail domain) is still a fair guess, but say so.
    const shared = S.contacts.some((c) => emailDomain(c.email) === best[0] && companyForContact(c) && companyForContact(c)!.id !== co.id);
    out.push({
      company: co, domain: best[0], contacts: best[1],
      reason: best[1] ? `${best[1]} contact${best[1] === 1 ? '' : 's'} use @${best[0]}${shared ? ' (also used by another company)' : ''}` : `@${best[0]} was linked to them`,
    });
  }
  return out.sort((a, b) => a.company.name.localeCompare(b.company.name));
}

// ── People from meetings ────────────────────────────────────────────────────

export interface CompanyGuess {
  /** Existing company, when one matches. */
  company: Company | null;
  /** Name to use: the existing company's, or one derived for a new company. */
  name: string;
  source: 'meeting' | 'domain' | 'name' | 'derived';
}

export interface MeetingPerson {
  email: string;
  name: string;
  domain: string | null;
  status: 'internal' | 'contact' | 'new';
  contact: Contact | null;
  /** Only for new people from a company domain (not personal mail). */
  guess: CompanyGuess | null;
}

const squash = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const LEGAL_WORDS = /\b(co|company|llc|ltd|limited|inc|group|holding|holdings|est|establishment|sa|sl|slu|gmbh|plc|wll|fze|fzco)\b/gi;

/** "Woodgrove X MENA - Status Meeting" + woodgrovemena.com → "Woodgrove MENA".
 * Words are joined while they spell the start of the domain; short connector
 * words ("X", "&", "and") in between are skipped. */
function nameFromTitle(title: string, root: string): string | null {
  const words = title.split(/[\s\-–—|:,/]+/).filter(Boolean);
  const connector = (w: string) => w.length <= 1 || /^(and|x|for|with|meets?)$/i.test(w);
  let best: string[] | null = null;
  let bestLen = 0;
  for (let i = 0; i < words.length; i++) {
    if (connector(words[i])) continue;
    let joined = '';
    const picked: string[] = [];
    for (let j = i; j < words.length; j++) {
      const next = joined + squash(words[j]);
      if (next && root.startsWith(next)) {
        joined = next;
        picked.push(words[j]);
        if (joined.length >= 4 && joined.length > bestLen) { best = [...picked]; bestLen = joined.length; }
      } else if (!connector(words[j])) break;
    }
  }
  return best ? best.join(' ') : null;
}

/** Which company a new person from `domain` probably works for. */
export function guessCompany(domain: string, m: Pick<Meeting, 'title' | 'companyId' | 'companyName'> | null, index = domainIndex(), externalDomains: string[] = []): CompanyGuess {
  const owners = index.get(domain) || [];
  const byDomain = owners.find((o) => o.source === 'confirmed') || owners.find((o) => o.source === 'website') || [...owners].sort((a, b) => b.contacts - a.contacts)[0];
  if (byDomain) return { company: byDomain.company, name: byDomain.company.name, source: 'domain' };
  const root = domain.split('.').slice(0, -1).filter((p) => !['co', 'com', 'net', 'org', 'gov', 'edu'].includes(p)).pop() || domain.split('.')[0];
  const rootKey = squash(root);
  const linked = m?.companyId != null ? S.companies.find((c) => c.id === m.companyId) : m?.companyName ? S.companies.find((c) => c.name.toLowerCase() === m.companyName!.trim().toLowerCase()) : undefined;
  if (linked && externalDomains.length === 1) return { company: linked, name: linked.name, source: 'meeting' };
  const byName = S.companies.find((c) => {
    const key = squash(c.name.replace(LEGAL_WORDS, ''));
    return key.length >= 4 && (key === rootKey || rootKey.startsWith(key) || key.startsWith(rootKey));
  });
  if (byName) return { company: byName, name: byName.name, source: 'name' };
  const fromTitle = m?.title ? nameFromTitle(m.title, rootKey) : null;
  const derived = fromTitle || root.replace(/[-_]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
  return { company: null, name: derived, source: 'derived' };
}

/** Everyone in a meeting: MENA BIG colleagues, known contacts, and new people. */
export function meetingPeople(m: Meeting, index = domainIndex()): MeetingPerson[] {
  const own = ownDomains();
  const contactsByEmail = new Map(S.contacts.filter((c) => c.email).map((c) => [c.email!.trim().toLowerCase(), c]));
  const names = new Map<string, string>();
  (m.attendeeEmails || []).forEach((e, i) => { const n = m.attendees?.[i]; if (n && !n.includes('@')) names.set(e.trim().toLowerCase(), n); });
  if (m.organizerEmail && m.organizer && !m.organizer.includes('@')) names.set(m.organizerEmail.trim().toLowerCase(), m.organizer);
  const emails = meetingEmails(m);
  const external = [...new Set(emails.map(emailDomain).filter((d): d is string => isCompanyDomain(d, own)))];
  return emails.map((email) => {
    const domain = emailDomain(email);
    const contact = contactsByEmail.get(email) || null;
    const name = names.get(email) || contact?.name || nameFromEmail(email);
    if (domain && own.has(domain)) return { email, name, domain, status: 'internal' as const, contact, guess: null };
    if (contact) return { email, name, domain, status: 'contact' as const, contact, guess: null };
    return { email, name, domain, status: 'new' as const, contact: null, guess: isCompanyDomain(domain, own) ? guessCompany(domain, m, index, external) : null };
  });
}

export function nameFromEmail(email: string): string {
  return email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\d+/g, '').trim().replace(/\b\w/g, (ch) => ch.toUpperCase()) || email;
}

export interface SuggestedContact extends MeetingPerson {
  meetings: number;
  lastMeetingId: number;
  lastMeetingTitle: string;
  lastMeetingDate: string | null;
}

/** New people across all meetings, most-met first. */
export function suggestedContacts(meetings: Meeting[] = S.meetings, dismissed: string[] = []): SuggestedContact[] {
  const index = domainIndex();
  const skip = new Set(dismissed.map((e) => e.toLowerCase()));
  const byEmail = new Map<string, SuggestedContact>();
  const sorted = [...meetings].filter((m) => !m.isCancelled).sort((a, b) => (a.meetingDate || '').localeCompare(b.meetingDate || ''));
  for (const m of sorted) {
    for (const p of meetingPeople(m, index)) {
      if (p.status !== 'new' || skip.has(p.email)) continue;
      const prev = byEmail.get(p.email);
      byEmail.set(p.email, {
        ...p,
        name: prev && p.name === nameFromEmail(p.email) ? prev.name : p.name,
        guess: p.guess?.company ? p.guess : prev?.guess?.company ? prev.guess : p.guess ?? prev?.guess ?? null,
        meetings: (prev?.meetings || 0) + 1, lastMeetingId: m.id, lastMeetingTitle: m.title, lastMeetingDate: m.meetingDate,
      });
    }
  }
  return [...byEmail.values()].sort((a, b) => Number(!a.guess) - Number(!b.guess) || b.meetings - a.meetings || (b.lastMeetingDate || '').localeCompare(a.lastMeetingDate || ''));
}
