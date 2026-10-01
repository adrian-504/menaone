import { describe, it, expect } from 'vitest';
import { followUpCount, lastTouch, touchDoing, touchLabel, touchWhat } from './followup';
import { buildAttention, type MyDayInput } from './myday';
import { buildCompanyState, clauseText, companyContact, lastContactByPerson, type CompanyBriefInput } from './companyBrief';
import type { Contact, Proposal, Touch } from './types';

const touch = (id: number, over: Partial<Touch>): Touch => ({
  id, companyId: 1, proposalId: 7, kind: 'email_out', direction: 'out', at: '2026-09-20', subject: null, contactId: null, source: 'manual', sourceId: null,
  createdAt: '2026-09-20T09:00:00Z', ...over,
});
const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: 7, client: 'Contoso Test', companyId: 1, type: 'Payroll', status: 'Sent to Client', sentDate: '2026-09-10', dblSignedDate: null, kickoffDate: null,
  finance: null, hubspot: null, owner: null, remarks: null, dateAdded: '2026-09-01', monthlyFee: 7000, contractMonths: 12, winLossReason: null,
  docLink: null, archived: false, archivedAt: null, snoozedUntil: null, dateSentToHassan: null, dateSentToClient: '2026-09-10', dateSigned: null, notes: [], ...over,
});
const names: Record<number, string> = { 5: 'Sara' };
const ctx = (touches: Touch[], today = '2026-09-25') => ({ emails: [], meetings: [], today, touches, contactName: (id: number) => names[id] ?? null });

describe('a logged follow-up is the last touch', () => {
  it('each kind wins when it is the latest, with who and which way', () => {
    const p = proposal();
    expect(lastTouch(p, ctx([touch(1, { contactId: 5, at: '2026-09-22' })]))).toEqual({ date: '2026-09-22', kind: 'email_out', by: 'us', who: 'Sara', days: 3 });
    expect(lastTouch(p, ctx([touch(1, { kind: 'call', at: '2026-09-22' }), touch(2, { kind: 'whatsapp', direction: 'in', at: '2026-09-24' })]))).toMatchObject({ kind: 'whatsapp', by: 'client', days: 1 });
    expect(lastTouch(p, ctx([touch(1, { kind: 'email_in', direction: 'in', at: '2026-09-23' })]))).toMatchObject({ kind: 'email', days: 2 });
    expect(lastTouch(p, ctx([touch(1, { kind: 'meeting', at: '2026-09-21' })]))).toMatchObject({ kind: 'meeting', days: 4 });
  });

  it('ignores touches on another proposal, before the send or in the future', () => {
    const p = proposal();
    const t = lastTouch(p, ctx([touch(1, { proposalId: 8 }), touch(2, { at: '2026-09-01' }), touch(3, { at: '2026-09-30' })]));
    expect(t).toMatchObject({ kind: 'sent', days: 15 });
  });

  it('counts our follow-ups since the latest send, not the client\'s replies or meetings', () => {
    const touches = [touch(1, {}), touch(2, { kind: 'call' }), touch(3, { kind: 'whatsapp' }), touch(4, { kind: 'email_in', direction: 'in' }), touch(5, { kind: 'call', direction: 'in' }), touch(6, { kind: 'meeting' }), touch(7, { at: '2026-09-05' })];
    expect(followUpCount(proposal(), touches)).toBe(3);
    expect(followUpCount(proposal({ lastSentAt: '2026-09-21' }), touches)).toBe(0);
  });
});

describe('labels', () => {
  it('say what the last contact was', () => {
    const t = (over: object) => ({ kind: 'sent' as const, days: 3, ...over });
    expect(touchWhat(t({ kind: 'email_out', who: 'Sara' }))).toBe('you emailed Sara 3 days ago');
    expect(touchWhat(t({ kind: 'email_out' }))).toBe('you emailed the client 3 days ago');
    expect(touchWhat(t({ kind: 'call', by: 'us' }))).toBe('you called 3 days ago');
    expect(touchWhat(t({ kind: 'call', by: 'client' }))).toBe('client called 3 days ago');
    expect(touchWhat(t({ kind: 'whatsapp', by: 'us' }))).toBe('WhatsApp 3 days ago');
    expect(touchWhat(t({ kind: 'email' }))).toBe('client replied 3 days ago');
    expect(touchLabel({ date: '2026-09-22', kind: 'email_out', who: 'Sara', days: 3 }, '2 Sept', 2)).toBe('Sent 2 Sept · 2 follow-ups · you emailed Sara 3 days ago');
    expect(touchLabel({ date: '2026-09-02', kind: 'sent', days: 3 }, '2 Sept')).toBe('Sent 2 Sept');
    expect(touchDoing({ kind: 'email_out', direction: 'out' }, 'Sara')).toBe('you emailed Sara');
    expect(touchDoing({ kind: 'call', direction: 'in' }, null)).toBe('client called');
  });
});

describe('My Day follows the last contact', () => {
  const input = (touches: Touch[]): MyDayInput => ({
    today: '2026-09-25', now: new Date('2026-09-25T11:00:00'), proposals: [proposal()], opportunities: [], pipelineFacts: [], agreements: [], meetings: [],
    todos: [], projects: [], emails: [], inboxCount: 0, reviewerName: () => 'Reviewer', ownDomains: new Set(), snoozed: {}, touches, contactName: (id) => names[id] ?? null,
  });
  it('stops asking after a follow-up, and asks again ten days later saying what we did', () => {
    expect(buildAttention(input([])).find((a) => a.key === 'proposal:7:followup')?.reason).toBe('Sent 15 days ago, no answer · Payroll');
    expect(buildAttention(input([touch(1, { contactId: 5, at: '2026-09-22' })])).some((a) => a.key === 'proposal:7:followup')).toBe(false);
    expect(buildAttention(input([touch(1, { contactId: 5, at: '2026-09-12' })])).find((a) => a.key === 'proposal:7:followup')?.reason).toBe('No answer — you emailed Sara 13 days ago · Payroll');
  });
});

describe('the company brief sees our emails and calls', () => {
  const contact = (id: number, name: string): Contact => ({ id, clientName: 'Contoso Test', companyId: 1, name, role: null, email: `${name.toLowerCase()}@contoso.test`, phone: null, whatsapp: null, service: null, lists: [] });
  const input = (touches: Touch[]): CompanyBriefInput => ({
    company: { id: 1, name: 'Contoso Test' }, today: '2026-09-25', now: '2026-09-25T12:00:00Z', companies: [], opportunities: [], projects: [], meetings: [],
    proposals: [], agreements: [], contacts: [contact(5, 'Sara')], todos: [], commitments: [], emails: [], notes: [], touches,
  });
  it('a logged email or call is the last contact, for the company and for the person', () => {
    const rhythm = (touches: Touch[]) => buildCompanyState(input(touches)).find((c) => c.key === 'rhythm');
    // The company's Meetings line is about meetings only (1.64); a logged email or call is still its last contact.
    expect(rhythm([])).toBeUndefined();
    expect(rhythm([touch(1, { at: '2026-09-20' })])).toBeUndefined();
    expect(companyContact(input([touch(1, { at: '2026-09-20' }), touch(2, { kind: 'call', at: '2026-09-22' })])).lastContact).toBe('2026-09-22');
    expect(lastContactByPerson(input([touch(1, { kind: 'call', contactId: 5, at: '2026-09-22' })])).get(5)).toEqual({ date: '2026-09-22', label: 'You called', kind: 'touch', id: 1 });
    expect(lastContactByPerson(input([touch(1, { companyId: 2, contactId: 5 })])).has(5)).toBe(false);
  });
});
