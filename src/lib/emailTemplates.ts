// Template emails (owner, 29-Sep-2026): on a company page, pick a template and
// a contact and get the email ready to copy or open in Outlook. Templates are
// plain text; placeholders are filled from the company, the contact, its
// proposals and agreements, and the current team member. A placeholder with
// nothing to fill it stays visible as {name}, so he sees what to complete.
// Pure: tabs/companyTemplates.ts renders it, Settings edits the texts.

import { isAgreementActive, lineTotals, PS, proposalSentDate } from './commercial';
import { escHtml } from './utils';
import type { Agreement, Contact, EmailTemplate, Proposal, TeamMember } from './types';

export const SIGNATURE_NAME = '_signature';

/** Every placeholder the app fills; others ({where}, {day_1}…) are his to fill. */
export const PLACEHOLDERS = ['first_name', 'full_name', 'company', 'services', 'proposal_date', 'my_name', 'my_title', 'email', 'phone', 'signature'] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
export type TemplateContext = Partial<Record<Placeholder, string | null>>;

const HOLE = /\{([a-z0-9_]+)\}/gi;

function fill(text: string, ctx: TemplateContext): string {
  return text.replace(HOLE, (whole, key: string) => {
    const v = (ctx as Record<string, string | null | undefined>)[key.toLowerCase()];
    return v != null && v !== '' ? v : whole;
  });
}

/** Subject and body with the placeholders filled; the signature first, so its own placeholders are filled too. */
export function renderTemplate(tpl: Pick<EmailTemplate, 'subject' | 'body'>, ctx: TemplateContext): { subject: string; body: string } {
  const withSignature = ctx.signature != null ? tpl.body.replace(/\{signature\}/gi, ctx.signature) : tpl.body;
  return { subject: fill(tpl.subject, ctx), body: fill(withSignature, ctx) };
}

/** The placeholders still to fill in a rendered text, e.g. ['where', 'day_1']. */
export function unfilled(text: string): string[] {
  return [...new Set([...text.matchAll(HOLE)].map((m) => m[1]))];
}

/** Rendered text as HTML, each unfilled {placeholder} marked so it stands out. */
export function holesHtml(text: string): string {
  return escHtml(text).replace(HOLE, (whole) => `<span class="tpl-hole">${whole}</span>`);
}

const longDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const IN_PLAY = new Set<string>([PS.SENT, PS.REVIEW, PS.DRAFTING]);

/** The proposal a template talks about: the latest one sent, in review or drafting. */
export function currentProposal(proposals: Proposal[]): Proposal | null {
  const live = proposals.filter((p) => !p.archived && IN_PLAY.has(p.status));
  const when = (p: Proposal) => proposalSentDate(p) || p.dateAdded || '';
  return live.sort((a, b) => when(b).localeCompare(when(a)) || b.id - a.id)[0] ?? null;
}

/** {services}: that proposal's services, else the active agreement's, else "our services". */
export function servicesPhrase(proposals: Proposal[], agreements: Agreement[], today: string): string {
  const p = currentProposal(proposals);
  const fromLines = (lines: { serviceName: string }[] | undefined, type: string | null | undefined) => {
    const names = [...new Set((lines || []).map((l) => l.serviceName.trim()).filter(Boolean))];
    return names.length ? names.join(' & ') : (type || '').trim();
  };
  if (p) {
    const s = lineTotals(p.lines, p.contractMonths).serviceNames.join(' & ') || (p.type || '').trim();
    if (s) return s;
  }
  const a = agreements.find((x) => isAgreementActive(x, today));
  const s = a ? fromLines(a.lines, a.type) : '';
  return s || 'our services';
}

/** Who the email goes to by default: a decision maker, else the latest proposal's contact, else the first person. */
export function defaultContact(contacts: Contact[], proposals: Proposal[]): Contact | null {
  const dm = contacts.find((c) => c.isDecisionMaker);
  if (dm) return dm;
  const primary = currentProposal(proposals)?.primaryContactId;
  return contacts.find((c) => c.id === primary) ?? contacts[0] ?? null;
}

export interface ContextInput {
  company: string;
  contact: Contact | null;
  proposals: Proposal[];
  agreements: Agreement[];
  me: TeamMember | null | undefined;
  signature: string | null;
  today: string;
}

export function templateContext(i: ContextInput): TemplateContext {
  const name = (i.contact?.name || '').trim();
  const p = currentProposal(i.proposals);
  const sent = p ? proposalSentDate(p) : null;
  return {
    first_name: name.split(/\s+/)[0] || null,
    full_name: name || null,
    company: i.company,
    services: servicesPhrase(i.proposals, i.agreements, i.today),
    proposal_date: sent ? longDate(sent) : null,
    my_name: i.me?.name || null,
    my_title: i.me?.jobTitle || null,
    email: i.me?.email || null,
    phone: null,
    signature: i.signature,
  };
}

/** A mailto: link Outlook opens as a new message: subject and body encoded, lines as CRLF. */
export function mailtoUrl(to: string | null, subject: string, body: string): string {
  const addr = (to || '').trim();
  const q = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\r?\n/g, '\r\n'))}`;
  return `mailto:${/^[^\s@<>"]+@[^\s@<>"]+$/.test(addr) ? addr : ''}?${q}`;
}

/** What Copy puts on the clipboard: the subject, a blank line, the body. */
export const clipboardText = (subject: string, body: string): string => `${subject}\n\n${body}`;
