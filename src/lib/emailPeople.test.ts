import { describe, expect, it } from 'vitest';
import { contactSummary, emailPeopleCandidates, isMachineAddress, strengthOf, type EmailPersonTally } from './emailPeople';

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
