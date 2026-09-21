import { describe, expect, it } from 'vitest';
import { buildCompanyState, clauseText, lastContactByPerson, liveThreads, meetingBrief, orderPeople, NEGLECT_DAYS, type CompanyBriefInput } from './companyBrief';
import type { Agreement, Commitment, Contact, EmailRecord, Meeting, Opportunity, Project, Proposal, Todo } from './types';

const today = '2026-09-21';
const CO = { id: 1, name: 'Contoso Logistics' };

const opp = (over: Partial<Opportunity>): Opportunity => ({
  id: 1, name: 'Contoso recruitment', companyId: 1, companyName: CO.name, owner: null, stage: 'Proposal', status: 'Open', estimatedValue: 42000,
  currency: 'SAR', probability: null, expectedCloseDate: null, description: null, nextAction: null, proposalId: null, projectId: null, sortOrder: null,
  archived: false, createdAt: '2026-07-01', updatedAt: null, tags: [], ...over,
});
const prop = (over: Partial<Proposal>): Proposal => ({
  id: 10, client: CO.name, companyId: 1, type: 'Recruitment', status: 'In Internal Review', sentDate: null, dblSignedDate: null, kickoffDate: null, finance: null,
  hubspot: null, owner: null, remarks: null, dateAdded: '2026-09-08', monthlyFee: 7000, contractMonths: 6, winLossReason: null, docLink: null,
  archived: false, archivedAt: null, snoozedUntil: null, dateSentToHassan: '2026-09-08', dateSentToClient: null, dateSigned: null, notes: [], ...over,
} as Proposal);
const agr = (over: Partial<Agreement>): Agreement => ({
  id: 20, agrRef: 'CON_PAY_001', client: CO.name, companyId: 1, type: 'Payroll', status: 'Signed', preparedBy: null, datePrepared: '2026-01-20',
  dateSentToClient: '2026-01-21', dateClientSigned: '2026-01-25', dateMenaSigned: '2026-01-26', dateFiled: null, monthlyFee: 15000, contractMonths: 12,
  proposalId: null, hubspot: null, docLink: null, actionDate: null, remarks: null, createdAt: '2026-01-20', currency: 'SAR',
  startDate: '2026-02-01', endDate: '2027-01-31', serviceStatus: 'Active', noticeDays: 60, ...over,
} as Agreement);
const meeting = (id: number, date: string, over: Partial<Meeting> = {}): Meeting => ({
  id, title: `Meeting ${id}`, meetingDate: date, companyId: 1, companyName: CO.name, isCancelled: false, attendeeEmails: [], ...over,
} as Meeting);
const promise = (id: number, over: Partial<Commitment>): Commitment => ({
  id, direction: 'ours', text: `Promise ${id}`, contactId: null, dueDate: null, status: 'open', closedAt: null, dropReason: null, companyId: 1,
  opportunityId: null, projectId: null, sourceType: 'manual', sourceId: null, sourceKey: null, todoId: null, createdAt: null, updatedAt: null, ...over,
});
const contact = (id: number, name: string, over: Partial<Contact> = {}): Contact => ({
  id, clientName: CO.name, companyId: 1, name, role: null, email: `${name.split(' ')[0].toLowerCase()}@contoso.test`, phone: null, whatsapp: null, service: null, lists: [], ...over,
});

const input = (over: Partial<CompanyBriefInput>): CompanyBriefInput => ({
  company: CO, today, now: `${today}T12:00:00Z`, companies: [], opportunities: [], projects: [], meetings: [], proposals: [], agreements: [],
  contacts: [], todos: [], commitments: [], emails: [], notes: [], ...over,
});
const texts = (i: CompanyBriefInput) => buildCompanyState(i).map((c) => [c.key, clauseText(c)]);

describe('buildCompanyState', () => {
  it('an active client with everything: five clauses, each with its facts', () => {
    const i = input({
      agreements: [agr({})],
      opportunities: [opp({ proposalId: 10 })],
      proposals: [prop({})],
      meetings: [meeting(1, '2026-09-15', { title: 'Monthly check-in' }), meeting(2, '2026-10-13', { title: 'Renewal terms' })],
      commitments: [promise(1, { dueDate: '2026-09-19' }), promise(2, {}), promise(3, { direction: 'theirs', dueDate: '2026-09-18' })],
      todos: [{ id: 5, title: 'Send the model', companyId: 1, client: CO.name, status: 'Pending', dueDate: '2026-09-10', parentId: null } as Todo],
      notes: [{ id: 1, body: 'Finance signs off above SAR 50k.', createdAt: '2026-07-14', pinned: true }, { id: 2, body: 'Not pinned', createdAt: '2026-08-01' }],
    });
    expect(texts(i)).toEqual([
      ['relationship', 'Active client since Feb 2026 — Payroll at SAR 15,000 a month. CON_PAY_001 ends 31 Jan 2027; notice due 02 Dec 2026.'],
      ['inflight', 'In flight — Contoso recruitment: proposal in internal review, SAR 7,000 a month, with us 13 days.'],
      ['rhythm', 'Last meeting 15 Sept 2026, Monthly check-in. Next meeting 13 Oct 2026, Renewal terms.'],
      ['commitments', 'We owe 2 (1 late). They owe 1 (1 late). 1 task overdue.'],
      ['pinned', ''],
    ]);
    const state = buildCompanyState(i);
    expect(state[0]).toMatchObject({ tone: 'green', links: [{ kind: 'agreement', id: 20 }] });
    expect(state[1].links).toEqual([{ kind: 'opportunity', id: 1, label: 'Contoso recruitment' }]);
    expect(state[3]).toMatchObject({ tone: 'amber', links: [{ kind: 'section', id: 'commitments' }, { kind: 'section', id: 'commitments' }, { kind: 'section', id: 'tasks' }] });
    expect(state[4].quotes).toEqual(['Finance signs off above SAR 50k.']);
  });

  it('a prospect with no history says one line, not five empty ones', () => {
    expect(texts(input({}))).toEqual([['relationship', 'Prospect — nothing recorded yet.']]);
    expect(texts(input({ meetings: [meeting(3, '2026-09-16')] }))).toEqual([
      ['relationship', 'Prospect — first contact 16 Sept 2026.'],
      ['rhythm', 'Last meeting 16 Sept 2026, Meeting 3.'],
    ]);
  });

  it('a past client shows the span it was a client', () => {
    const [rel] = buildCompanyState(input({ agreements: [agr({ startDate: '2024-01-15', endDate: '2026-03-31', serviceStatus: 'Ended' })] }));
    expect(clauseText(rel)).toBe('Past client, Jan 2024 – Mar 2026.');
    expect(rel.tone).toBe('muted');
  });

  it('notice date: the end less the notice period; amber within 30 days, and once it has passed', () => {
    const at = (t: string) => buildCompanyState(input({ today: t, now: `${t}T12:00:00Z`, agreements: [agr({})], meetings: [meeting(1, t)] }))[0];
    expect(at('2026-10-15').tone).toBe('green');
    expect(at('2026-11-05')).toMatchObject({ tone: 'amber' });
    expect(clauseText(at('2026-12-10'))).toContain('the notice date (02 Dec 2026) has passed');
  });

  it('an opportunity and its proposal are one engagement, not two', () => {
    const i = input({ opportunities: [opp({ proposalId: 10 }), opp({ id: 2, name: 'Contoso audit', createdAt: '2026-06-10' })], proposals: [prop({})] });
    expect(liveThreads(i).map((t) => t.key)).toEqual(['opportunity:1', 'opportunity:2']);
    expect(clauseText(buildCompanyState(i)[1])).toMatch(/^2 in flight — Contoso recruitment: proposal in internal review.*; Contoso audit: opportunity at proposal, SAR 42,000\.$/);
  });

  it('more than three engagements: "and N more"', () => {
    const opps = [1, 2, 3, 4, 5].map((id) => opp({ id, name: `Deal ${id}`, createdAt: `2026-0${id}-01` }));
    const [, inflight] = buildCompanyState(input({ opportunities: opps }));
    expect(inflight.links.map((l) => l.label)).toEqual(['Deal 5', 'Deal 4', 'Deal 3']);
    expect(clauseText(inflight)).toMatch(/; and 2 more\.$/);
  });

  it(`an active client with no meeting or email for over ${NEGLECT_DAYS} days is flagged; within it, not`, () => {
    const quiet = buildCompanyState(input({ agreements: [agr({})], meetings: [meeting(1, '2026-07-01')] })).find((c) => c.key === 'rhythm')!;
    expect(quiet.tone).toBe('amber');
    expect(clauseText(quiet)).toMatch(/^No meeting or email for 82 days\./);
    const email = { id: 9, subject: 'Headcount', senderEmail: 'dana@contoso.test', receivedAt: '2026-09-01T09:00:00Z', companyId: 1, companyName: CO.name } as EmailRecord;
    const recent = buildCompanyState(input({ agreements: [agr({})], meetings: [meeting(1, '2026-07-01')], emails: [email] })).find((c) => c.key === 'rhythm')!;
    expect(recent.tone).toBeNull();
    expect(clauseText(recent)).toBe('Last meeting 01 Jul 2026, Meeting 1; last email 01 Sept 2026.');
    // A prospect is never "neglected".
    expect(buildCompanyState(input({ meetings: [meeting(1, '2026-01-01')] })).find((c) => c.key === 'rhythm')!.tone).toBeNull();
    // A client with nothing on record at all.
    expect(clauseText(buildCompanyState(input({ agreements: [agr({})] })).find((c) => c.key === 'rhythm')!)).toBe('No meeting or email on record.');
  });

  it('pinned notes: newest first, three at most, then "+N pinned"', () => {
    const notes = [1, 2, 3, 4, 5].map((id) => ({ id, body: `Note ${id}`, createdAt: `2026-0${id}-01`, pinned: id !== 2 }));
    const pinned = buildCompanyState(input({ notes })).find((c) => c.key === 'pinned')!;
    expect(pinned.quotes).toEqual(['Note 5', 'Note 4', 'Note 3']);
    expect(clauseText(pinned)).toBe('+1 pinned');
  });

  it('nothing owed and nothing overdue: no commitments clause', () => {
    expect(buildCompanyState(input({ commitments: [promise(1, { status: 'kept' })] })).some((c) => c.key === 'commitments')).toBe(false);
  });
});

describe('people', () => {
  it('decision makers first, then by last contact, then by name', () => {
    const people = [contact(1, 'Adam Reyes'), contact(2, 'Dana Park', { isDecisionMaker: true }), contact(3, 'Omar Haddad'), contact(4, 'Bea Stone')];
    const i = input({
      contacts: people,
      meetings: [meeting(1, '2026-09-15', { title: 'Monthly check-in', attendeeEmails: ['omar@contoso.test'] }), meeting(2, '2026-10-13', { attendeeEmails: ['adam@contoso.test'] })],
      emails: [{ id: 7, subject: 'Invoice', senderEmail: 'bea@contoso.test', receivedAt: '2026-08-30T10:00:00Z', companyId: 1, companyName: CO.name } as EmailRecord],
    });
    const last = lastContactByPerson(i);
    expect(last.get(3)).toEqual({ date: '2026-09-15', label: 'Monthly check-in', kind: 'meeting', id: 1 });
    expect(last.get(4)).toMatchObject({ kind: 'email', date: '2026-08-30' });
    expect(last.has(1)).toBe(false); // the meeting hasn't happened yet
    expect(orderPeople(people, last).map((c) => c.id)).toEqual([2, 3, 4, 1]);
  });
});

describe('the meeting brief', () => {
  it('says the same as Company 360 for the same data', () => {
    const i = input({
      agreements: [agr({})], opportunities: [opp({ proposalId: 10, nextAction: 'Agree the headcount' })], proposals: [prop({ status: 'Sent to Client', dateSentToClient: '2026-09-02' })],
      meetings: [meeting(1, '2026-09-15', { followUp: 'Send the onboarding checklist' }), meeting(2, '2026-09-24')],
      commitments: [promise(1, { direction: 'theirs' })], projects: [{ id: 30, name: 'Rollout', companyId: 1, companyName: CO.name, status: 'In Progress' } as Project],
      notes: [{ id: 1, body: 'Prefers email.', createdAt: '2026-05-02', pinned: true }],
    });
    const brief = meetingBrief(i.meetings[1], i);
    expect(brief.clauses).toEqual(buildCompanyState(i));
    expect(brief.agenda).toContain('Follow up from 15 Sept 2026: Send the onboarding checklist');
    expect(brief.agenda).toContain('Contoso recruitment: Agree the headcount');
  });
});
