// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { clipboardText, currentProposal, defaultContact, holesHtml, mailtoUrl, renderTemplate, servicesPhrase, templateContext, unfilled } from './emailTemplates';
import type { Agreement, CommercialLine, Contact, Proposal, TeamMember } from './types';

const line = (serviceName: string): CommercialLine => ({ id: 1, serviceId: null, serviceName, description: null, billing: 'monthly', quantity: 1, unitPrice: 1000, commission: false, sortOrder: 0 });
const proposal = (id: number, over: Partial<Proposal>): Proposal => ({
  id, client: 'Contoso Test', companyId: 1, type: null, status: 'Sent to Client', sentDate: null, dblSignedDate: null, kickoffDate: null, finance: null,
  hubspot: null, owner: null, remarks: null, dateAdded: '2026-09-01', monthlyFee: null, contractMonths: 12, winLossReason: null, docLink: null,
  archived: false, archivedAt: null, snoozedUntil: null, dateSentToHassan: null, dateSentToClient: null, dateSigned: null, notes: [], ...over,
});
const contact = (id: number, name: string, over: Partial<Contact> = {}): Contact => ({ id, clientName: 'Contoso Test', companyId: 1, name, role: null, email: `${name.split(' ')[0].toLowerCase()}@contoso.test`, phone: null, whatsapp: null, service: null, lists: [], ...over });
const me: TeamMember = { id: 1, name: 'Test Owner', email: 'owner@menabig.test', jobTitle: 'Business Development Manager', department: null, isReviewer: false, active: true, notes: null };
const SIG = '{my_name}\n{my_title}\nMENA Business Investment Group\n{email} · {phone}';

describe('renderTemplate', () => {
  it('fills every placeholder it knows, the signature first so its own are filled too', () => {
    const r = renderTemplate({ subject: '{company} — {services} Proposal', body: 'Dear {first_name},\n\nSent on {proposal_date}.\n\n{signature}' },
      { first_name: 'Sara', company: 'Contoso Test', services: 'Payroll & PRO', proposal_date: '10 September 2026', my_name: 'Test Owner', my_title: 'BDM', email: 'owner@menabig.test', signature: SIG });
    expect(r.subject).toBe('Contoso Test — Payroll & PRO Proposal');
    expect(r.body).toBe('Dear Sara,\n\nSent on 10 September 2026.\n\nTest Owner\nBDM\nMENA Business Investment Group\nowner@menabig.test · {phone}');
  });

  it('keeps unknown or empty placeholders visible, and lists them', () => {
    const r = renderTemplate({ subject: 'At {where}', body: 'Dear {first_name}, would {day_1} suit you?' }, { first_name: '' });
    expect(r).toEqual({ subject: 'At {where}', body: 'Dear {first_name}, would {day_1} suit you?' });
    expect(unfilled(`${r.subject}\n${r.body}`)).toEqual(['where', 'first_name', 'day_1']);
    expect(holesHtml('a <b> {where}')).toBe('a &lt;b&gt; <span class="tpl-hole">{where}</span>');
  });
});

describe('services and the proposal date', () => {
  const agr = { id: 1, status: 'Signed', serviceStatus: 'Active', startDate: '2026-01-01', endDate: '2026-12-31', type: 'Payroll', lines: [line('Payroll'), line('GOSI')] } as unknown as Agreement;

  it('uses the latest proposal sent, in review or drafting; else the active agreement; else "our services"', () => {
    const ps = [proposal(1, { dateSentToClient: '2026-08-01', lines: [line('Recruitment')] }), proposal(2, { status: 'Drafting', dateAdded: '2026-09-20', lines: [line('Payroll'), line('PRO')] }), proposal(3, { status: 'Lost', dateAdded: '2026-09-25', lines: [line('Audit')] })];
    expect(currentProposal(ps)?.id).toBe(2);
    expect(servicesPhrase(ps, [agr], '2026-09-29')).toBe('Payroll & PRO');
    expect(servicesPhrase([], [agr], '2026-09-29')).toBe('Payroll & GOSI');
    expect(servicesPhrase([], [], '2026-09-29')).toBe('our services');
  });

  it('the proposal date is its latest send, written out', () => {
    const ctx = templateContext({ company: 'Contoso Test', contact: contact(5, 'Sara Haddad'), proposals: [proposal(1, { dateSentToClient: '2026-09-10', lastSentAt: '2026-09-25', lines: [line('Payroll')] })], agreements: [], me, signature: SIG, today: '2026-09-29' });
    expect(ctx).toMatchObject({ first_name: 'Sara', full_name: 'Sara Haddad', company: 'Contoso Test', services: 'Payroll', proposal_date: '25 September 2026', my_name: 'Test Owner', my_title: 'Business Development Manager', email: 'owner@menabig.test', phone: null });
    expect(templateContext({ company: 'X', contact: null, proposals: [], agreements: [], me: null, signature: null, today: '2026-09-29' })).toMatchObject({ first_name: null, proposal_date: null, my_name: null });
  });
});

describe('who it goes to, and how it leaves', () => {
  it('a decision maker, else the latest proposal\'s contact, else the first person', () => {
    const cs = [contact(1, 'Adam'), contact(2, 'Bea'), contact(3, 'Cy')];
    expect(defaultContact([...cs.slice(0, 2), contact(3, 'Cy', { isDecisionMaker: true })], [])?.id).toBe(3);
    expect(defaultContact(cs, [proposal(1, { primaryContactId: 2 })])?.id).toBe(2);
    expect(defaultContact(cs, [])?.id).toBe(1);
    expect(defaultContact([], [])).toBeNull();
  });

  it('builds a mailto with the subject and body encoded and lines as CRLF', () => {
    expect(mailtoUrl('sara@contoso.test', 'A & B — Proposal', 'Dear Sara,\n\nThanks?')).toBe('mailto:sara@contoso.test?subject=A%20%26%20B%20%E2%80%94%20Proposal&body=Dear%20Sara%2C%0D%0A%0D%0AThanks%3F');
    expect(mailtoUrl('not an email', 's', 'b')).toBe('mailto:?subject=s&body=b');
    expect(clipboardText('Subject', 'Body')).toBe('Subject\n\nBody');
  });
});
