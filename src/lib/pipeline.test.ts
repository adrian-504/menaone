import { describe, it, expect } from 'vitest';
import { opportunityHealth, pipelineByStage, winLossBy, reasonCounts, dealSizeBand, weightedValue } from './pipeline';
import type { Opportunity, PipelineFact, Proposal } from './types';

const opp = (over: Partial<Opportunity>): Opportunity => ({
  id: 1, name: 'Deal', companyId: 1, companyName: 'Co', owner: null, stage: 'Proposal', status: 'Open', estimatedValue: 10000, currency: 'SAR',
  probability: null, expectedCloseDate: null, description: null, nextAction: 'Call', proposalId: null, projectId: null, sortOrder: null,
  archived: false, createdAt: '2026-09-01', updatedAt: '2026-09-01', tags: [], ...over,
});
const proposal = (over: Partial<Proposal>): Proposal => ({
  id: 1, client: 'Co', type: 'Payroll', status: 'Sent to Client', sentDate: null, dblSignedDate: null, kickoffDate: null, finance: null, hubspot: null,
  owner: null, remarks: null, dateAdded: null, monthlyFee: null, contractMonths: null, winLossReason: null, docLink: null, archived: false,
  archivedAt: null, snoozedUntil: null, dateSentToHassan: null, dateSentToClient: null, dateSigned: null, notes: [], ...over,
});

describe('pipeline health', () => {
  it('scores activity, close date, next action and time in stage', () => {
    const fresh = opportunityHealth(opp({}), { opportunityId: 1, stageEnteredAt: '2026-09-01', lastActivityAt: '2026-09-10', stages: [] }, '2026-09-13');
    expect(fresh.label).toBe('Healthy');
    const stale = opportunityHealth(opp({ nextAction: null, expectedCloseDate: '2026-08-01' }), { opportunityId: 1, stageEnteredAt: '2026-06-01', lastActivityAt: '2026-07-01', stages: [] }, '2026-09-13');
    expect(stale.label).toBe('At risk');
    expect(stale.reasons).toEqual(expect.arrayContaining(['No next action', 'Close date passed 43 days ago']));
  });

  it('weights value by probability, falling back to the stage', () => {
    expect(weightedValue(opp({ probability: 50 }))).toBe(5000);
    expect(weightedValue(opp({ stage: 'Negotiation' }))).toBe(7500);
  });

  it('works out win rate from the stages closed deals passed through', () => {
    const facts = new Map<number, PipelineFact>([
      [2, { opportunityId: 2, stageEnteredAt: null, lastActivityAt: null, stages: [{ stage: 'Proposal', enteredAt: '2026-01-01' }, { stage: 'Won', enteredAt: '2026-02-01' }] }],
      [3, { opportunityId: 3, stageEnteredAt: null, lastActivityAt: null, stages: [{ stage: 'Proposal', enteredAt: '2026-01-01' }, { stage: 'Lost', enteredAt: '2026-02-01' }] }],
    ]);
    const rows = pipelineByStage([opp({}), opp({ id: 2, stage: 'Won', status: 'Won' }), opp({ id: 3, stage: 'Lost', status: 'Lost' })], facts, ['Proposal', 'Won', 'Lost'], '2026-09-13');
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(1);
    expect(rows[0].winRateFromHere).toBe(0.5);
  });
});

describe('win and loss', () => {
  it('groups by several keys and leaves withdrawn proposals out', () => {
    const rows = winLossBy([
      proposal({ id: 1, status: 'Signed by Both Parties', monthlyFee: 5000, dateSentToClient: '2026-01-01', dblSignedDate: '2026-01-11' }),
      proposal({ id: 2, status: 'Lost', winLossReason: 'Price too high' }),
      proposal({ id: 3, status: 'Withdrawn' }),
      proposal({ id: 4, status: 'Sent to Client', type: 'PRO' }),
    ], (p) => [p.type || '']);
    const payroll = rows.find((r) => r.key === 'Payroll')!;
    expect(payroll).toMatchObject({ won: 1, lost: 1, open: 0, winRate: 0.5, avgDaysToSign: 10 });
    expect(payroll.wonMonthly).toEqual({ SAR: 5000 });
    expect(rows.find((r) => r.key === 'PRO')!.winRate).toBeNull();
  });

  it('counts reasons and bands deal sizes', () => {
    expect(reasonCounts(['Price too high', 'Price too high', null])[0]).toMatchObject({ reason: 'Price too high', count: 2 });
    expect(dealSizeBand(proposal({ monthlyFee: 12000 }))).toBe('10,000–25,000 / month');
    expect(dealSizeBand(proposal({}))).toBe('Not priced');
  });
});
