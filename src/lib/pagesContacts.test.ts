// @vitest-environment jsdom
// Contacts in My Day's language (1.60 "pages-2"): the last contact as a plain fact, what is open with each person, the strip.
import { describe, expect, it } from 'vitest';

import { contactBuckets, contactsStrip, lastSpokeByContact, openWith, spokeCell, type ContactFigures } from './pagesContacts';

const T = '2026-10-01';

describe('last spoke', () => {
  const contacts = [{ id: 1, email: 'jane@acme.test' }, { id: 2, email: 'Omar@acme.test' }, { id: 6, email: 'sara@elitehr.test' }, { id: 9, email: null }];
  const input = {
    today: T,
    meetings: [
      { title: 'Monthly check-in', meetingDate: '2026-09-15', startAt: null, isCancelled: false, attendeeEmails: ['jane@acme.test', 'omar@acme.test'], organizerEmail: null },
      { title: 'Cancelled one', meetingDate: '2026-09-30', startAt: null, isCancelled: true, attendeeEmails: ['jane@acme.test'], organizerEmail: null },
      { title: 'Next week', meetingDate: '2026-10-08', startAt: null, isCancelled: false, attendeeEmails: ['jane@acme.test'], organizerEmail: null },
    ],
    emails: [{ senderEmail: 'jane@acme.test', receivedAt: '2026-09-20T08:00:00Z', subject: 'Renewal terms' }],
    touches: [{ contactId: 6, kind: 'email_in' as const, direction: 'in' as const, at: '2026-07-19', subject: 'Payroll cut-off dates' }, { contactId: 2, kind: 'call' as const, direction: 'out' as const, at: '2026-09-28', subject: null }],
  };
  it('takes the latest of meetings, emails and logged touches, never a cancelled or future one', () => {
    const m = lastSpokeByContact(contacts, input);
    expect(m.get(1)).toEqual({ date: '2026-09-20', channel: 'email', subject: 'Renewal terms' });
    expect(m.get(2)).toEqual({ date: '2026-09-28', channel: 'call', subject: 'you called' });
    expect(m.get(6)).toEqual({ date: '2026-07-19', channel: 'email', subject: 'Payroll cut-off dates' });
    expect(m.has(9)).toBe(false);
  });
  it('the cell: a plain date with the channel and subject, never coloured or flagged however long ago', () => {
    expect(spokeCell({ date: T, channel: 'meeting', subject: 'Renewal terms' }, T)).toEqual({ headline: 'Today', sub: '◎ Renewal terms', days: 0 });
    expect(spokeCell({ date: '2026-09-22', channel: 'email', subject: 'Revision 2 request' }, T)).toEqual({ headline: '22 Sept', sub: '✉ Revision 2 request', days: 9 });
    const old = spokeCell({ date: '2026-07-19', channel: 'email', subject: 'x' }, T);
    expect(old).toEqual({ headline: '19 Jul', sub: '✉ x', days: 74 });
    expect(JSON.stringify(old)).not.toMatch(/quiet/);
    expect(spokeCell(undefined, T)).toEqual({ headline: '—', sub: '', days: null });
  });
});

describe('open with them', () => {
  const none = { commitments: [], proposals: [], today: T };
  it('we owe (late when overdue) in red, owes us in amber with the one thing named', () => {
    expect(openWith({ id: 1 }, { ...none, commitments: [{ contactId: 1, direction: 'ours', status: 'open', dueDate: '2026-09-19', text: 'Send the quote' }] })).toEqual([{ text: 'We owe 1 · late', tone: 'red' }]);
    expect(openWith({ id: 2 }, { ...none, commitments: [{ contactId: 2, direction: 'theirs', status: 'open', dueDate: null, text: 'October headcount' }, { contactId: 2, direction: 'theirs', status: 'kept', dueDate: null, text: 'x' }] }))
      .toEqual([{ text: 'Owes us 1 · October headcount', tone: 'amber' }]);
  });
  it('proposals they are the contact on: a promise, a revision, an offer about to lapse', () => {
    const p = (o: object) => ({ primaryContactId: 3, status: 'Proposal Request Received', promisedBy: null, validUntil: null, revision: 1, archived: false, ...o });
    expect(openWith({ id: 3 }, { ...none, proposals: [p({ promisedBy: '2026-10-02' })] })).toEqual([{ text: 'Proposal due Fri', tone: 'red' }]);
    expect(openWith({ id: 3 }, { ...none, proposals: [p({ status: 'Drafting', revision: 2 })] })).toEqual([{ text: 'Revision 2', tone: 'red' }]);
    expect(openWith({ id: 3 }, { ...none, proposals: [p({ status: 'Sent to Client', validUntil: '2026-10-05' })] })).toEqual([{ text: 'Answer by Mon', tone: 'amber' }]);
    expect(openWith({ id: 3 }, { ...none, proposals: [p({ status: 'Sent to Client', validUntil: '2026-12-05' }), p({ primaryContactId: 4, promisedBy: '2026-10-02' })] })).toEqual([]);
  });
});

describe('the strip', () => {
  const F = (id: number, name: string, company: string, dm: boolean, date: string | null): ContactFigures => ({ id, name, company, decisionMaker: dm, last: date ? { date, channel: 'email', subject: 's' } : undefined });
  const rows = [F(1, 'Jane Doe', 'Acme Holdings', true, T), F(2, 'Omar Haddad', 'Acme Holdings', false, T), F(3, 'Lina Saleh', 'Northwind Trading', true, '2026-09-24'), F(6, 'Sara Al-Otaibi', 'Elite HR', false, '2026-07-19'), F(7, 'New Person', 'Globex', false, null)];
  it('people and companies, decision makers and where, companies with no contact person, and who to review from meetings', () => {
    const s = contactsStrip(rows, T, 1, ['Initech', 'Umbrella', 'Hooli']);
    expect(s.map((p) => [p.key, p.n, p.label, p.detail])).toEqual([
      ['all', '5 people', 'across 4 companies', '2'],
      ['dm', '2', 'decision makers', 'Acme Holdings, Northwind Trading'],
      ['noperson', '3', 'companies with no contact person', 'Initech, Umbrella +1'],
      ['meetings', '1', 'from meetings, not yet a contact', 'Outlook invites · Review'],
    ]);
    expect(s[2].action).toBe("openCleanup('company-contacts')");
    expect(s[3].action).toBe('openPeopleFromMeetings()');
    // Nobody is counted for a lack of contact: Sara, last heard from 74 days ago, is in no panel.
    expect(contactsStrip(rows, T, 0).some((p) => /quiet|not spoken/i.test(`${p.key} ${p.label} ${p.detail}`))).toBe(false);
    expect(contactsStrip(rows, T, 0, ['Initech'])[2].label).toBe('company with no contact person');
  });
  it('buckets: decision makers only', () => {
    expect(contactBuckets(rows[0])).toEqual(['dm']);
    expect(contactBuckets(rows[3])).toEqual([]);
    expect(contactBuckets(rows[4])).toEqual([]);
  });
});
