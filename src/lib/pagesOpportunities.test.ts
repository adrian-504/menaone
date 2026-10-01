// @vitest-environment jsdom
// Opportunities in My Day's language (1.59 "pages"): the strip's buckets, stage colours, flags and the "→" line.
import { describe, expect, it } from 'vitest';

import { oppBuckets, oppFlags, oppNext, oppStageTone, oppStrip, oppSubline } from './pagesOpportunities';
import type { OpportunityHealth } from './pipeline';
import type { Opportunity } from './types';

const T = '2026-10-01';
const O = (over: Partial<Opportunity>): Opportunity => ({
  id: 1, name: 'Acme — GOSI audit', companyId: 1, companyName: 'Acme Holdings', owner: 'Ahmad', stage: 'Discovery', status: 'Open', estimatedValue: 15000, currency: 'SAR',
  probability: 20, expectedCloseDate: null, description: null, nextAction: null, proposalId: null, projectId: null, sortOrder: null, archived: false,
  createdAt: '2026-06-10', updatedAt: '2026-06-10', tags: [], ...over,
});
const H = (over: Partial<OpportunityHealth> = {}): OpportunityHealth => ({ score: 100, label: 'Healthy', tone: 'green', reasons: [], daysSinceActivity: 3, daysInStage: 3, closeOverdue: false, closingSoon: false, noNextAction: false, stalled: false, waiting: null, ...over });

describe('stage colours', () => {
  it('early stages grey, working stages blue, won green, lost muted, on hold amber', () => {
    expect(['Lead', 'Discovery', 'Proposal', 'Negotiation', 'Won', 'Lost', 'On Hold'].map(oppStageTone)).toEqual(['grey', 'grey', 'blue', 'blue', 'green', 'grey', 'amber']);
  });
});

describe('the strip', () => {
  const gosi = O({});
  const riyadh = O({ id: 2, name: 'Acme — recruitment', stage: 'Proposal', estimatedValue: 42000, probability: 60, expectedCloseDate: '2026-09-30' });
  const won = O({ id: 3, name: 'Acme — payroll', stage: 'Won', status: 'Won', estimatedValue: 108000, updatedAt: '2026-01-20' });
  const oldWon = O({ id: 4, stage: 'Won', status: 'Won', estimatedValue: 5000, updatedAt: '2025-11-02' });
  const lost = O({ id: 5, stage: 'Lost', status: 'Lost', estimatedValue: 60000 });
  const health = new Map<number, OpportunityHealth>([[1, H({ stalled: true, daysSinceActivity: 112, noNextAction: true })], [2, H({ stalled: true, daysSinceActivity: 21, closeOverdue: true })]]);
  const info = (o: Opportunity) => ({ health: health.get(o.id) || H() });
  it('sums the open pipeline and weights it by probability', () => {
    const s = oppStrip([gosi, riyadh, won, oldWon, lost], info, T);
    expect(s.map((p) => [p.key, p.n, p.detail])).toEqual([
      ['all', 'SAR 57,000', 'SAR 28,200'],
      ['stalled', '2', '112 days without activity'],
      ['overdue', '1', '30 Sept · Acme — recruitment'],
      ['won', '1', 'SAR 108,000'],
    ]);
  });
  it('puts each opportunity in its buckets; closed ones are never stalled', () => {
    expect(oppBuckets(riyadh, health.get(2)!, T)).toEqual(['stalled', 'overdue']);
    expect(oppBuckets(won, H({ stalled: true }), T)).toEqual(['won']);
    expect(oppBuckets(oldWon, H(), T)).toEqual([]);
    expect(oppBuckets(won, H(), T, '2025-12-30')).toEqual([]);
  });
});

describe('cards', () => {
  it('flags in plain words; none on a closed one', () => {
    expect(oppFlags(O({}), H({ stalled: true, daysSinceActivity: 112, noNextAction: true })).map((f) => [f.text, f.tone])).toEqual([['Stalled 112 days', 'red'], ['No next step', 'amber']]);
    expect(oppFlags(O({}), H({ waiting: { on: 'them', days: 20 } })).map((f) => [f.text, f.tone])).toEqual([['Waiting on client 20 days', 'red']]);
    expect(oppFlags(O({ stage: 'Won', status: 'Won' }), H({ stalled: true }))).toEqual([]);
  });
  it('the second line says close, won or lost', () => {
    expect(oppSubline(O({ expectedCloseDate: '2026-09-30' }))).toBe('Acme Holdings · close 30 Sept');
    expect(oppSubline(O({}))).toBe('Acme Holdings · Ahmad');
    expect(oppSubline(O({ stage: 'Won', updatedAt: '2026-01-20' }))).toBe('Acme Holdings · won 20 Jan');
  });
  it('the → line: the proposal it became, the agreement it won, the next step, or a prompt', () => {
    expect(oppNext(O({ stage: 'Proposal' }), T, { proposal: { id: 2, stage: 'review', since: '2026-09-08', reviewer: 'Hassan Balaghi' } }).text).toBe('Proposal SL# 2 · in review with Hassan, 23 days');
    expect(oppNext(O({ stage: 'Won', status: 'Won' }), T, { agreement: { id: 1, ref: 'ACME_ADM_001_0126', endDate: '2027-01-31' } }).text).toBe('Agreement ACME_ADM_001_0126 · ends 31 Jan 2027');
    expect(oppNext(O({ nextAction: 'Send the scope' }), T, {})).toEqual({ text: 'Send the scope', kind: 'next' });
    expect(oppNext(O({}), T, {}).kind).toBe('add');
    expect(oppNext(O({ stage: 'Lost', status: 'Lost', winLossReason: 'Price too high' }), T, {}).text).toBe('Reason: Price too high');
    expect(oppNext(O({ stage: 'Lost', status: 'Lost' }), T, {}).kind).toBe('none');
  });
});
