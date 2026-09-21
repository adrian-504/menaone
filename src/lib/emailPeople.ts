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
  /** Whole domains marked "not a client". */
  dismissedDomains?: Set<string>;
  guess: (domain: string) => CompanyGuessLike;
}

export function emailPeopleCandidates(people: EmailPersonTally[], ctx: CandidateContext): EmailCandidate[] {
  const out: EmailCandidate[] = [];
  for (const p of people) {
    const email = p.email.trim().toLowerCase();
    const domain = email.split('@')[1] || '';
    if (!domain || ctx.own.has(domain) || ctx.personal.has(domain) || ctx.dismissedDomains?.has(domain)) continue;
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

// ── Companies to sort: unknown domains, one decision each ──────────────────

export type DomainKind = 'government' | 'service' | null;

const GOVERNMENT = /(^|\.)(gov|mil)(\.[a-z]{2})?$|(^|\.)(gob|gouv|gov)\.[a-z]{2}$|(^|\.)(europa\.eu|un\.org|who\.int)$/;
/** Banks, airlines, hotels, telecoms, travel and job sites — suppliers you
 * email, rarely clients. A hint for dismissing them together, never a decision. */
const SERVICES = new Set([
  'alrajhibank.com.sa', 'snb.com', 'alahli.com', 'riyadbank.com', 'sab.com', 'sabb.com', 'anb.com.sa', 'alinma.com', 'bankalbilad.com', 'bsf.sa', 'alfransi.com.sa',
  'emiratesnbd.com', 'adcb.com', 'fab.com', 'mashreq.com', 'hsbc.com', 'citi.com', 'santander.com', 'bbva.com', 'caixabank.com', 'bancsabadell.com', 'bankinter.com',
  'saudia.com', 'flynas.com', 'flyadeal.com', 'emirates.com', 'qatarairways.com', 'etihad.com', 'mea.com.lb', 'iberia.com', 'vueling.com', 'lufthansa.com', 'britishairways.com', 'turkishairlines.com',
  'marriott.com', 'hilton.com', 'accor.com', 'ihg.com', 'hyatt.com', 'booking.com', 'expedia.com', 'airbnb.com', 'tripadvisor.com', 'agoda.com',
  'stc.com.sa', 'mobily.com.sa', 'sa.zain.com', 'zain.com', 'etisalat.ae', 'du.ae', 'movistar.es', 'vodafone.es', 'orange.es',
  'bayt.com', 'indeed.com', 'glassdoor.com', 'naukrigulf.com', 'gulftalent.com', 'infojobs.net', 'monster.com',
  'amazon.com', 'amazon.sa', 'noon.com', 'apple.com', 'uber.com', 'careem.com', 'dhl.com', 'aramex.com', 'fedex.com', 'ups.com',
]);

export function domainKind(domain: string): DomainKind {
  const d = domain.toLowerCase();
  if (GOVERNMENT.test(d)) return 'government';
  if (SERVICES.has(d) || [...SERVICES].some((s) => d.endsWith(`.${s}`))) return 'service';
  return null;
}

export interface DomainGroup {
  domain: string;
  /** Suggested company name for a new company. */
  name: string;
  people: EmailCandidate[];
  sent: number;
  received: number;
  copied: number;
  lastAt: string | null;
  /** You wrote to someone there. */
  writtenTo: boolean;
  kind: DomainKind;
  /** Higher first: two-way mail, then how much, then how recent. */
  score: number;
}

/** Unknown-company people grouped by email domain, most important first. */
export function domainGroups(candidates: EmailCandidate[], now: Date = new Date()): DomainGroup[] {
  const byDomain = new Map<string, EmailCandidate[]>();
  for (const c of candidates) {
    if (c.certainty !== 'new') continue;
    byDomain.set(c.domain, [...(byDomain.get(c.domain) || []), c]);
  }
  const out: DomainGroup[] = [];
  for (const [domain, people] of byDomain) {
    const sent = people.reduce((n, p) => n + p.sent, 0);
    const received = people.reduce((n, p) => n + (p.received - p.receivedOther), 0);
    const copied = people.reduce((n, p) => n + p.copied, 0);
    const lastAt = people.map((p) => p.lastAt || '').sort().pop() || null;
    const twoWay = people.some((p) => p.strength === 'both');
    const days = lastAt ? Math.max(0, (now.getTime() - new Date(lastAt).getTime()) / 86_400_000) : 730;
    // Two-way mail counts most; volume with diminishing returns; recency decays over a year.
    const score = (twoWay ? 100 : 0) + Math.min(60, Math.log2(1 + sent * 2 + received) * 10) + Math.max(0, 40 - days / 9);
    people.sort((a, b) => (b.sent + b.received) - (a.sent + a.received));
    out.push({ domain, name: people[0].guess.name, people, sent, received, copied, lastAt, writtenTo: sent > 0, kind: domainKind(domain), score });
  }
  return out.sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain));
}
