// Proposal requests (owner, 27-Sep-2026): several proposals in one form, `>>`
// promises to send a proposal, and the promised-by date.
import { describe, expect, it } from 'vitest';
import { blockSummary, blocksToSave, emptyBlock, proposalsFromBlocks, type ProposalBlock, type SharedProposalFields } from './proposalBlocks';
import { isProposalCommitment, parseCommitmentLines } from './commitments';
import { groupRequestedTogether } from './companyRecords';
import { buildAttention, buildComingUp, promisedRank, requestGroupReason, type MyDayInput } from './myday';
import { threadStand } from './companyBrief';
import { engagementThread } from './workGraph';
import type { CommercialLine, Proposal } from './types';

const line = (serviceName: string, unitPrice: number | null, billing: CommercialLine['billing'] = 'monthly'): CommercialLine =>
  ({ id: 0, serviceId: null, serviceName, description: null, billing, quantity: 1, unitPrice, sortOrder: 0 } as CommercialLine);

const shared = { client: 'Contoso Logistics', companyId: 7, status: 'Proposal Request Received', dateAdded: '2026-09-27', promisedBy: '2026-10-02',
  currency: 'SAR', ownerId: 1, reviewerId: 2 } as unknown as SharedProposalFields;

describe('proposalBlocks', () => {
  it('one block is one proposal with no request group, exactly as before', () => {
    const out = proposalsFromBlocks(shared, [{ lines: [line('Payroll', 3000)], contractMonths: 12 }], 40, () => 'g-1');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 40, client: 'Contoso Logistics', contractMonths: 12, requestGroup: null, type: null, promisedBy: '2026-10-02' });
    expect((out[0].lines ?? []).map((l) => l.serviceName)).toEqual(["Payroll"]);
  });

  it('several blocks share the header and one request group; each keeps its own lines and term', () => {
    const blocks: ProposalBlock[] = [
      { lines: [line('Administration and PRO', 2000), line('Payroll', 1250)], contractMonths: 12 },
      { lines: [line('Recruitment', 45000, 'one_time')], contractMonths: null },
      emptyBlock(12),
    ];
    const out = proposalsFromBlocks(shared, blocks, 40, () => 'g-1');
    expect(out.map((p) => p.id)).toEqual([40, 41]);
    expect(out.map((p) => p.requestGroup)).toEqual(['g-1', 'g-1']);
    expect(out.map((p) => p.contractMonths)).toEqual([12, null]);
    expect(out.map((p) => (p.lines ?? []).map((l) => l.serviceName))).toEqual([['Administration and PRO', 'Payroll'], ['Recruitment']]);
    expect(out.every((p) => p.client === 'Contoso Logistics' && p.promisedBy === '2026-10-02' && p.ownerId === 1)).toBe(true);
    // Own arrays, not shared ones.
    expect(out[0].notes).not.toBe(out[1].notes);
  });

  it('an empty extra block is ignored; with no services at all the first block is a bare request', () => {
    expect(blocksToSave([emptyBlock(), emptyBlock()])).toHaveLength(1);
    const bare = proposalsFromBlocks(shared, [emptyBlock(), emptyBlock()], 40, () => 'g-1');
    expect(bare).toHaveLength(1);
    expect(bare[0]).toMatchObject({ type: '—', requestGroup: null, lines: [] });
  });

  it('a collapsed block reads as one line', () => {
    expect(blockSummary({ lines: [line('Recruitment', 45000, 'one_time')], contractMonths: null }, 1, 'SAR')).toBe('Proposal 2 · Recruitment · SAR 45,000');
    expect(blockSummary(emptyBlock(), 2, 'SAR')).toBe('Proposal 3 · no services yet');
    expect(blockSummary({ lines: [line('Payroll', 1000)], contractMonths: 12 }, 0, 'SAR')).toBe('Proposal 1 · Payroll · SAR 12,000');
  });
});

describe('a >> promise to send a proposal', () => {
  it('is recognised at the start of the line, not anywhere', () => {
    expect(isProposalCommitment('Proposal for Payroll')).toBe(true);
    expect(isProposalCommitment('Send the proposal to Sara')).toBe(true);
    expect(isProposalCommitment('send proposal')).toBe(true);
    expect(isProposalCommitment('Prepare a proposal for recruitment')).toBe(true);
    expect(isProposalCommitment('Draft the proposal')).toBe(true);
    expect(isProposalCommitment('Proposals for EOR and Payroll')).toBe(true);
    expect(isProposalCommitment('Discuss proposal terms')).toBe(false);
    expect(isProposalCommitment('Proposals review')).toBe(false);
    expect(isProposalCommitment('Send the deck')).toBe(false);
  });

  it('keeps its due date, and << lines are never ours', () => {
    const [ours, theirs] = parseCommitmentLines('>> Proposal for Payroll by 2 Oct\n<< proposal feedback', { today: new Date('2026-09-27T10:00:00'), contacts: [] });
    expect(ours).toMatchObject({ direction: 'ours', text: 'Proposal for Payroll', dueDate: '2026-10-02' });
    expect(isProposalCommitment(ours.text)).toBe(true);
    expect(theirs.direction).toBe('theirs');
  });
});

describe('Company 360: proposals requested together', () => {
  const p = (id: number, date: string, requestGroup: string | null = null) => ({ id, requestGroup, dateAdded: date });
  it('stay side by side, sorted as one item by their latest date', () => {
    const runs = groupRequestedTogether([p(1, '2026-09-01'), p(2, '2026-09-20', 'g'), p(3, '2026-09-10'), p(4, '2026-09-22', 'g')], (x) => x.dateAdded);
    expect(runs.map((r) => [r.group, r.items.map((x) => x.id)])).toEqual([['g', [4, 2]], [null, [3]], [null, [1]]]);
  });
  it('a lone member of a group is an ordinary row', () => {
    const runs = groupRequestedTogether([p(1, '2026-09-01', 'g'), p(2, '2026-09-02')], (x) => x.dateAdded);
    expect(runs.every((r) => r.group === null)).toBe(true);
  });
});

const proposal = (over: Partial<Proposal>): Proposal => ({
  id: 1, client: 'Contoso Logistics', companyId: 7, type: 'Payroll', status: 'Proposal Request Received', sentDate: null, dblSignedDate: null, kickoffDate: null,
  finance: null, hubspot: null, owner: null, remarks: null, dateAdded: '2026-09-27', monthlyFee: null, contractMonths: null, winLossReason: null, docLink: null,
  archived: false, archivedAt: null, snoozedUntil: null, dateSentToHassan: null, dateSentToClient: null, dateSigned: null, notes: [], ...over,
});
const input = (over: Partial<MyDayInput>): MyDayInput => ({
  today: '2026-09-27', now: new Date('2026-09-27T11:00:00'), proposals: [], opportunities: [], pipelineFacts: [], agreements: [], meetings: [],
  todos: [], projects: [], emails: [], inboxCount: 0, reviewerName: () => 'Hassan', ownDomains: new Set(['menabig.test']), snoozed: {}, ...over,
});

describe('My Day: promised by', () => {
  it('red on the day and after, amber within three days, accent before', () => {
    expect(promisedRank('2026-09-26', '2026-09-27')).toMatchObject({ tone: 'red', late: true });
    expect(promisedRank('2026-09-27', '2026-09-27')).toMatchObject({ tone: 'red', late: true });
    expect(promisedRank('2026-09-30', '2026-09-27')).toMatchObject({ tone: 'amber', late: false });
    expect(promisedRank('2026-10-05', '2026-09-27')).toMatchObject({ tone: 'accent', late: false });
    expect(promisedRank(null, '2026-09-27')).toBeNull();
    expect(promisedRank('2026-10-02', '2026-09-27')!.when).toMatch(/^Promised by \w{3},? 2 Oct$/);
  });

  it('an overdue promise ranks a request 20 above the same request unpromised', () => {
    const [plain] = buildAttention(input({ proposals: [proposal({ id: 1 })] }));
    const [late] = buildAttention(input({ proposals: [proposal({ id: 1, promisedBy: '2026-09-26' })] }));
    expect(late.score - plain.score).toBe(20);
    expect(late).toMatchObject({ tone: 'red' });
    expect(late.when).toMatch(/^Promised by/);
  });

  it('a draft with a promise shows even when it is new; without one the age rule stands', () => {
    expect(buildAttention(input({ proposals: [proposal({ status: 'Drafting', dateAdded: '2026-09-26', promisedBy: '2026-09-29' })] }))[0]).toMatchObject({ tone: 'amber', key: 'proposal:1:drafting' });
    expect(buildAttention(input({ proposals: [proposal({ status: 'Drafting', dateAdded: '2026-09-26' })] }))).toEqual([]);
  });

  it('a request or draft promised in the next seven days is on its day in Coming up', () => {
    const days = buildComingUp(input({ proposals: [proposal({ promisedBy: '2026-10-01' }), proposal({ id: 2, status: 'Sent to Client', promisedBy: '2026-10-01' })] }));
    expect(days).toEqual([{ date: '2026-10-01', entries: [expect.objectContaining({ kind: 'proposal', title: 'Proposal promised', detail: 'Contoso Logistics', record: { kind: 'proposal', id: 1 } })] }]);
  });

  it('proposals requested together and promised the same day are one line', () => {
    const days = buildComingUp(input({ proposals: [proposal({ id: 1, requestGroup: 'g', promisedBy: '2026-10-01' }), proposal({ id: 2, requestGroup: 'g', promisedBy: '2026-10-01' })] }));
    expect(days[0].entries).toEqual([expect.objectContaining({ title: '2 proposals promised', detail: 'Contoso Logistics', record: { kind: 'company', id: 7 } })]);
  });
});

describe('My Day: proposals requested together are one row', () => {
  it('folds them under the client, most urgent first, opening the company', () => {
    const items = buildAttention(input({ proposals: [
      proposal({ id: 1, requestGroup: 'g' }),
      proposal({ id: 2, requestGroup: 'g', promisedBy: '2026-09-26' }),
      proposal({ id: 3, requestGroup: 'g' }),
      proposal({ id: 4, client: 'Northwind Trading', companyId: 8 }),
    ] }));
    const row = items.find((x) => x.key === 'group:request:g')!;
    expect(row).toMatchObject({ title: 'Contoso Logistics', reason: '3 proposal requests received', tone: 'red', record: { kind: 'company', id: 7 } });
    expect(row.children!.map((c) => c.record!.id)).toEqual([2, 1, 3]);
    expect(row.score).toBe(row.children![0].score);
    expect(items.some((x) => x.key === 'proposal:4:request')).toBe(true);
    expect(items.filter((x) => x.key.startsWith('proposal:1:') || x.key.startsWith('proposal:2:'))).toEqual([]);
  });

  it('says the shared stage, or just how many', () => {
    expect(requestGroupReason(['Drafting', 'Drafting'])).toBe('2 proposals in drafting');
    expect(requestGroupReason(['Proposal Request Received', 'Drafting', 'Drafting'])).toBe('3 proposals');
  });
});

describe('the engagement thread says when a request was promised', () => {
  it('adds ", promised by 2 Oct" to a request or draft', () => {
    const data = { companies: [], opportunities: [], projects: [], meetings: [], agreements: [], contacts: [], todos: [],
      proposals: [proposal({ id: 1, promisedBy: '2026-10-02' })] };
    expect(threadStand(engagementThread({ kind: 'proposal', id: 1 }, data, '2026-09-27'))).toBe('proposal at proposal request received, promised by 2 Oct');
    const sent = { ...data, proposals: [proposal({ id: 1, status: 'Sent to Client', promisedBy: '2026-10-02' })] };
    expect(threadStand(engagementThread({ kind: 'proposal', id: 1 }, sent, '2026-09-27'))).not.toContain('promised');
  });
});
