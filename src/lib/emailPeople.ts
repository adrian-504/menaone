// People from email: which of the people you've emailed are worth adding as
// contacts, and for which company. Rules only:
// - left out: MENA BIG's own addresses, personal mail (Gmail…), machine
//   senders (no-reply, notifications, newsletters…), existing contacts and
//   people you dismissed;
// - kept: people you've written to, people who wrote to you (not just bulk
//   mail Outlook filed under "Other"), and people copied on client mail at
//   least twice;
// - the company comes from the email domain (clientMatch.guessCompany):
//   "certain" when the domain belongs to a company already, "likely" when a
//   company's name fits the domain, otherwise a new company to confirm.
// Pure apart from the guess function passed in, so it can be tested.

export interface EmailPersonTally {
  email: string;
  name: string | null;
  sent: number;
  received: number;
  receivedOther: number;
  copied: number;
  firstAt: string | null;
  lastAt: string | null;
}

export type Strength = 'both' | 'sent' | 'received' | 'copied';
export type Certainty = 'certain' | 'likely' | 'new';

export interface CompanyGuessLike { company: { id: number; name: string } | null; name: string; source: string }

export interface EmailCandidate extends EmailPersonTally {
  domain: string;
  strength: Strength;
  certainty: Certainty;
  guess: CompanyGuessLike;
  /** Display name: from Outlook, or made from the address. */
  displayName: string;
}

const MACHINE = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer[-_.]?daemon|postmaster|bounces?|notifications?|notify|alerts?|newsletters?|news|marketing|mailer|info[-_.]?noreply|automated|system|jira|confluence|calendar|invitations?|updates?|digest|billing|receipts?|accounts?[-_.]?payable|hello|team|support|feedback|survey)(\b|[-_.+].*)?$/i;
const MACHINE_DOMAIN = /(^|\.)(mailchimp|sendgrid|mandrillapp|mcsv|amazonses|hubspotemail|hs-inbox|salesforce|zendesk|freshdesk|intercom-mail|linkedin|facebookmail|microsoftonline|docusign|dropbox|zoom|slack|atlassian|notion|calendly|eventbrite|surveymonkey|typeform)\.[a-z.]+$/i;

export function isMachineAddress(email: string): boolean {
  const [local, domain] = email.toLowerCase().split('@');
  if (!local || !domain) return true;
  return MACHINE.test(local) || MACHINE_DOMAIN.test(domain) || /^[a-f0-9]{16,}$/.test(local) || local.includes('+');
}

export function strengthOf(p: EmailPersonTally): Strength | null {
  const realReceived = p.received - p.receivedOther;
  if (p.sent > 0 && p.received > 0) return 'both';
  if (p.sent > 0) return 'sent';
  if (realReceived > 0) return 'received';
  if (p.copied >= 2) return 'copied';
  return null;
}

const STRENGTH_ORDER: Record<Strength, number> = { both: 0, sent: 1, received: 2, copied: 3 };
const CERTAINTY_ORDER: Record<Certainty, number> = { certain: 0, likely: 1, new: 2 };

export function nameFromAddress(email: string): string {
  return email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\d+/g, '').trim().replace(/\b\w/g, (c) => c.toUpperCase()) || email;
}

export interface CandidateContext {
  own: Set<string>;
  personal: Set<string>;
  contactEmails: Set<string>;
  dismissed: Set<string>;
  guess: (domain: string) => CompanyGuessLike;
}

export function emailPeopleCandidates(people: EmailPersonTally[], ctx: CandidateContext): EmailCandidate[] {
  const out: EmailCandidate[] = [];
  for (const p of people) {
    const email = p.email.trim().toLowerCase();
    const domain = email.split('@')[1] || '';
    if (!domain || ctx.own.has(domain) || ctx.personal.has(domain)) continue;
    if (ctx.contactEmails.has(email) || ctx.dismissed.has(email) || isMachineAddress(email)) continue;
    const strength = strengthOf(p);
    if (!strength) continue;
    const guess = ctx.guess(domain);
    const certainty: Certainty = guess.company && guess.source === 'domain' ? 'certain' : guess.company ? 'likely' : 'new';
    out.push({ ...p, email, domain, strength, certainty, guess, displayName: p.name?.trim() || nameFromAddress(email) });
  }
  return out.sort((a, b) => CERTAINTY_ORDER[a.certainty] - CERTAINTY_ORDER[b.certainty]
    || STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength]
    || (b.sent + b.received) - (a.sent + a.received)
    || (b.lastAt || '').localeCompare(a.lastAt || ''));
}

/** "14 both ways", "3 sent", "2 received", "copied 4 times". */
export function contactSummary(c: Pick<EmailCandidate, 'strength' | 'sent' | 'received' | 'receivedOther' | 'copied'>): string {
  const real = c.received - c.receivedOther;
  if (c.strength === 'both') return `${c.sent + c.received} both ways`;
  if (c.strength === 'sent') return `${c.sent} sent`;
  if (c.strength === 'received') return `${real} received`;
  return `copied ${c.copied} times`;
}
