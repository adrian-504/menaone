import { describe, expect, it } from 'vitest';
import { contactSummary, domainGroups, domainKind, emailPeopleCandidates, isMachineAddress, strengthOf, type EmailPersonTally } from './emailPeople';

const p = (email: string, over: Partial<EmailPersonTally> = {}): EmailPersonTally => ({
  email, name: null, sent: 0, received: 0, receivedOther: 0, copied: 0, firstAt: null, lastAt: '2026-09-01T00:00:00Z', ...over,
});

const acme = { id: 1, name: 'Acme Holdings' };
const northwind = { id: 2, name: 'Northwind' };
const ctx = {
  own: new Set(['menabig.test']),
  personal: new Set(['gmail.com']),
  contactEmails: new Set(['jane@acme.test']),
  dismissed: new Set(['old@acme.test']),
  guess: (domain: string) => domain === 'acme.test' ? { company: acme, name: acme.name, source: 'domain' }
    : domain === 'northwind.sa' ? { company: northwind, name: northwind.name, source: 'name' }
    : { company: null, name: domain.split('.')[0].replace(/\b\w/, (c) => c.toUpperCase()), source: 'derived' },
};

describe('machine senders', () => {
  it('knows no-reply, notifications, newsletters and mailing services', () => {
    for (const e of ['noreply@acme.test', 'no-reply@x.test', 'notifications@x.test', 'newsletter@x.test', 'mailer-daemon@x.test', 'a1b2c3d4e5f6a7b8c9@x.test', 'bounce+123@x.test', 'omar@mail.linkedin.com', 'jobs@hubspotemail.net'])
      expect(isMachineAddress(e), e).toBe(true);
    for (const e of ['omar@acme.test', 'lina.saleh@northwind.sa', 'j.doe@acme.test']) expect(isMachineAddress(e), e).toBe(false);
  });
});

describe('who counts as someone you correspond with', () => {
  it('both ways, sent, received (not bulk), copied twice', () => {
    expect(strengthOf(p('a@x.test', { sent: 2, received: 1 }))).toBe('both');
    expect(strengthOf(p('a@x.test', { sent: 1 }))).toBe('sent');
    expect(strengthOf(p('a@x.test', { received: 2, receivedOther: 1 }))).toBe('received');
    expect(strengthOf(p('a@x.test', { received: 3, receivedOther: 3 }))).toBeNull();
    expect(strengthOf(p('a@x.test', { copied: 2 }))).toBe('copied');
    expect(strengthOf(p('a@x.test', { copied: 1 }))).toBeNull();
  });
});

describe('emailPeopleCandidates', () => {
  it('leaves out colleagues, personal mail, machines, contacts and dismissed people', () => {
    const out = emailPeopleCandidates([
      p('me2@menabig.test', { sent: 5 }), p('friend@gmail.com', { sent: 5 }), p('noreply@acme.test', { received: 9 }),
      p('jane@acme.test', { sent: 5 }), p('old@acme.test', { sent: 5 }), p('omar@acme.test', { sent: 1, received: 1 }),
    ], ctx);
    expect(out.map((c) => c.email)).toEqual(['omar@acme.test']);
  });

  it('certain matches first, then likely, then new companies; stronger contact first within each', () => {
    const out = emailPeopleCandidates([
      p('lina@contoso.test', { sent: 9, received: 9 }),
      p('sara@northwind.sa', { sent: 3, received: 1, name: 'Sara Al-Otaibi' }),
      p('omar@acme.test', { copied: 3 }),
      p('ali@acme.test', { sent: 2, received: 2 }),
    ], ctx);
    expect(out.map((c) => [c.email, c.certainty, c.strength])).toEqual([
      ['ali@acme.test', 'certain', 'both'], ['omar@acme.test', 'certain', 'copied'],
      ['sara@northwind.sa', 'likely', 'both'], ['lina@contoso.test', 'new', 'both'],
    ]);
    expect(out[2].displayName).toBe('Sara Al-Otaibi');
    expect(out[0].displayName).toBe('Ali');
    expect(out[3].guess.name).toBe('Contoso');
  });

  it('matches addresses regardless of capitals', () => {
    expect(emailPeopleCandidates([p('Jane@ACME.test', { sent: 1 })], ctx)).toEqual([]);
  });
});

describe('contactSummary', () => {
  it('says how you were in touch', () => {
    expect(contactSummary({ strength: 'both', sent: 4, received: 10, receivedOther: 0, copied: 0 })).toBe('14 both ways');
    expect(contactSummary({ strength: 'received', sent: 0, received: 3, receivedOther: 1, copied: 0 })).toBe('2 received');
    expect(contactSummary({ strength: 'copied', sent: 0, received: 0, receivedOther: 0, copied: 4 })).toBe('copied 4 times');
  });
});

describe('companies to sort', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  it('groups unknown people by domain, two-way and recent first', () => {
    const cands = emailPeopleCandidates([
      p('kai@fabrikam.test', { sent: 4, received: 5, lastAt: '2026-09-10T00:00:00Z', name: 'Kai Moreno' }),
      p('sara@fabrikam.test', { copied: 3, lastAt: '2026-09-01T00:00:00Z' }),
      p('lead@oldvendor.test', { received: 9, lastAt: '2025-01-01T00:00:00Z' }),
      p('once@newco.test', { sent: 1, lastAt: '2026-09-18T00:00:00Z' }),
      p('ali@acme.test', { sent: 2, received: 2 }),
    ], ctx);
    const groups = domainGroups(cands, now);
    expect(groups.map((g) => g.domain)).toEqual(['fabrikam.test', 'newco.test', 'oldvendor.test']);
    expect(groups[0]).toMatchObject({ name: 'Fabrikam', sent: 4, received: 5, copied: 3, writtenTo: true });
    expect(groups[0].people.map((x) => x.email)).toEqual(['kai@fabrikam.test', 'sara@fabrikam.test']);
    expect(groups[2].writtenTo).toBe(false);
  });

  it('a dismissed domain never comes back', () => {
    const cands = emailPeopleCandidates([p('kai@fabrikam.test', { sent: 4 })], { ...ctx, dismissedDomains: new Set(['fabrikam.test']) });
    expect(cands).toEqual([]);
  });

  it('spots government and service providers', () => {
    expect(domainKind('mc.gov.sa')).toBe('government');
    expect(domainKind('hacienda.gob.es')).toBe('government');
    expect(domainKind('mail.alrajhibank.com.sa')).toBe('service');
    expect(domainKind('saudia.com')).toBe('service');
    expect(domainKind('fabrikam.test')).toBeNull();
  });
});
