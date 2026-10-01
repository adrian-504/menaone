// @vitest-environment jsdom
// The ⌘K palette: groups with counts, the context line, the preview's figures and the actions per kind.
import { describe, expect, it } from 'vitest';

import { PREVIEW_FIGURES, contextLine, doActions, groupResults, previewActions, previewOf, type PaletteData } from './palette';
import type { Agreement, Contact, Meeting, Opportunity, Proposal, SearchResult } from './types';

const T = '2026-10-01';
const hit = (entityType: SearchResult['entityType'], entityId: number, title: string): SearchResult => ({ entityType, entityId, title, snippet: '' });
const agreement = (over: Partial<Agreement>): Agreement => ({
  id: 1, agrRef: 'SC_ADM_001', client: 'Sample Client', companyId: 1, type: 'Payroll', status: 'Signed', preparedBy: null, datePrepared: null, dateSentToClient: null, dateClientSigned: '2026-02-01',
  dateMenaSigned: null, dateFiled: null, monthlyFee: 15000, contractMonths: 12, proposalId: null, hubspot: null, docLink: null, actionDate: null, remarks: null, createdAt: null, lines: [],
  serviceStatus: 'Active', startDate: '2026-02-01', endDate: '2027-01-31', currency: 'SAR', ...over,
});
const proposal = (over: Partial<Proposal>): Proposal => ({
  id: 2, client: 'Sample Client', companyId: 1, type: 'Recruitment', status: 'In Internal Review', sentDate: null, dblSignedDate: null, kickoffDate: null, finance: null, hubspot: null, owner: 'Ahmad',
  remarks: null, dateAdded: '2026-09-01', monthlyFee: 7000, contractMonths: 12, winLossReason: null, docLink: null, archived: false, archivedAt: null, snoozedUntil: null,
  dateSentToHassan: '2026-09-08', dateSentToClient: null, dateSigned: null, notes: [], reviewRequestedAt: '2026-09-08', ...over,
});
const contact = (over: Partial<Contact>): Contact => ({ id: 1, clientName: 'Sample Client', companyId: 1, name: 'Jane Doe', role: 'CEO', email: 'jane@sample.test', phone: null, whatsapp: null, service: null, lists: [], isDecisionMaker: true, ...over });
const data = (over: Partial<PaletteData> = {}): PaletteData => ({
  today: T, now: new Date(2026, 9, 1, 14, 5), companies: [{ id: 1, name: 'Sample Client' }, { id: 2, name: 'Other Co' }],
  agreements: [agreement({})], proposals: [proposal({})], contacts: [contact({}), contact({ id: 2, name: 'Omar Haddad', role: 'Finance manager', email: null, isDecisionMaker: false })],
  opportunities: [{ id: 3, name: 'Riyadh site', companyId: 1, companyName: 'Sample Client', stage: 'Discovery', status: 'Open', estimatedValue: 50000, currency: 'SAR', probability: 40, expectedCloseDate: '2026-11-15', nextAction: null, archived: false } as unknown as Opportunity],
  projects: [], todos: [], notes: [],
  meetings: [{ id: 5, title: 'Renewal terms', meetingDate: T, startAt: new Date(2026, 9, 1, 13, 53).toISOString(), endAt: new Date(2026, 9, 1, 14, 38).toISOString(), companyName: 'Sample Client', attendees: ['Jane Doe'], isCancelled: false, isOnlineMeeting: true, location: null } as unknown as Meeting],
  commitments: [{ id: 1, direction: 'ours', text: 'Send the quote', contactId: 1, dueDate: '2026-09-20', status: 'open', companyId: 1 } as unknown as PaletteData['commitments'][number]],
  ...over,
});

describe('groups', () => {
  it('business records first, each group with its own count; an unknown kind is kept, last', () => {
    const g = groupResults([hit('note', 9, 'Note'), hit('meeting', 5, 'Renewal terms'), hit('proposal', 2, 'A'), hit('company', 1, 'Sample Client'), hit('contact', 1, 'Jane Doe'), hit('proposal', 4, 'B'), hit('email', 7, 'Mail')]);
    expect(g.map((x) => [x.label, x.items.length])).toEqual([['Companies', 1], ['Proposals', 2], ['People', 1], ['Meetings', 1], ['Notes', 1], ['Other', 1]]);
    expect(groupResults([])).toEqual([]);
  });
});

describe('the context line', () => {
  it('a company: its relationship, what it pays a month and when it renews', () => {
    expect(contextLine(hit('company', 1, 'Sample Client'), data()).text).toBe('Active client · SAR 15,000 /mo · renews 31 Jan 2027');
    expect(contextLine(hit('company', 0, 'Other Co'), data()).text).toBe('Prospect');
  });
  it('a proposal: its stage and how long it has been there, as a chip', () => {
    expect(contextLine(hit('proposal', 2, 'x'), data()).chip).toEqual({ text: 'In review · 23 days', tone: 'amber' });
  });
  it('a person: role, decision maker, company; a meeting: when, and that it is on now', () => {
    expect(contextLine(hit('contact', 1, 'Jane Doe'), data()).text).toBe('CEO · decision maker · Sample Client');
    expect(contextLine(hit('meeting', 5, 'x'), data()).text).toBe('Today 13:53 · now · Sample Client');
  });
  it('a record that is gone says nothing', () => {
    expect(contextLine(hit('proposal', 99, 'x'), data())).toEqual({ text: '' });
  });
});

describe('the preview', () => {
  it('a company: the record page\'s own figures, four at most, and its actions', () => {
    const p = previewOf(hit('company', 1, 'Sample Client'), data())!;
    expect(p).toMatchObject({ name: 'Sample Client', status: { text: 'Active client', tone: 'green' }, tile: { name: 'Sample Client', round: false }, company: 'Sample Client', email: 'jane@sample.test' });
    expect(p.figures.length).toBeLessThanOrEqual(PREVIEW_FIGURES);
    expect(p.figures[0]).toMatchObject({ value: 'SAR 15,000', tone: 'green' });
    expect(p.actions.map((a) => [a.key, a.label, a.shortcut])).toEqual([['open', 'Open company', '↵'], ['email', 'Email Jane', '⌘E'], ['proposal', 'New proposal', '⌘↵'], ['brief', 'Brief', '⌘B']]);
  });
  it('a person is a round tile; the email goes to them', () => {
    const p = previewOf(hit('contact', 1, 'Jane Doe'), data())!;
    expect(p.tile).toEqual({ name: 'Jane Doe', round: true });
    expect(p.actions.map((a) => a.key)).toEqual(['open', 'email', 'company']);
    // No address: no email action.
    expect(previewOf(hit('contact', 2, 'Omar Haddad'), data())!.actions.map((a) => a.key)).toEqual(['open', 'company']);
  });
  it('a proposal: monthly, term, and its stage as the status', () => {
    const p = previewOf(hit('proposal', 2, 'x'), data())!;
    expect(p.status).toEqual({ text: 'In review · 23 days', tone: 'amber' });
    expect(p.figures.map((f) => [f.value, f.label])).toEqual([['SAR 7,000', 'a month'], ['12 months', 'term']]);
    expect(p.actions.map((a) => a.key)).toEqual(['open', 'email', 'company']);
  });
  it('an opportunity with no next step says so', () => {
    const p = previewOf(hit('opportunity', 3, 'x'), data())!;
    expect(p.figures.map((f) => f.label)).toEqual(['value', 'probability', 'close date', 'no next step']);
    expect(p.actions.map((a) => a.key)).toEqual(['open', 'email', 'proposal', 'company']);
  });
  it('nothing for a record that is gone, or a kind with no page', () => {
    expect(previewOf(hit('proposal', 99, 'x'), data())).toBeNull();
    expect(previewOf(hit('intelligence', 1, 'x'), data())).toBeNull();
  });
});

describe('actions per kind', () => {
  it('always Open; never more than four', () => {
    expect(previewActions('note', { company: null, emailTo: null })).toEqual([{ key: 'open', label: 'Open', shortcut: '↵' }]);
    expect(previewActions('task', { company: 'Sample Client', emailTo: null }).map((a) => a.key)).toEqual(['open', 'company']);
    expect(previewActions('company', { company: 'Sample Client', emailTo: 'Jane Doe' })).toHaveLength(4);
  });
  it('"Do": a new proposal for the first company found', () => {
    expect(doActions([hit('contact', 1, 'Jane Doe'), hit('company', 1, 'Sample Client')], data())).toEqual([{ key: 'proposal', label: 'New proposal for Sample Client', sub: 'Opens the builder with Sample Client filled in', shortcut: '⌘↵', company: 'Sample Client' }]);
    expect(doActions([hit('contact', 1, 'Jane Doe')], data())).toEqual([]);
  });
});
