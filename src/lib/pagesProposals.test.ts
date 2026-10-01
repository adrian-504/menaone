// @vitest-environment jsdom
// Proposals (All) in My Day's language (1.59 "pages"): stages, days in stage, the pipeline strip and its sizing.
import { describe, expect, it } from 'vitest';

import { pipeFlex, pipelineStrip, PIPE_MIN, stageOfProposal, tableCells } from './pagesProposals';
import type { Proposal } from './types';

const T = '2026-10-01';
const P = (over: Partial<Proposal>): Proposal => ({
  id: 1, client: 'Acme Holdings', companyId: 1, type: 'Payroll', status: 'Proposal Request Received', sentDate: null, dblSignedDate: null, kickoffDate: null,
  finance: null, hubspot: null, owner: 'Ahmad', remarks: null, dateAdded: '2026-09-24', monthlyFee: null, contractMonths: null, winLossReason: null, docLink: null,
  archived: false, archivedAt: null, snoozedUntil: null, dateSentToHassan: null, dateSentToClient: null, dateSigned: null, notes: [], currency: 'SAR', ...over,
});
const ctx = { today: T, reviewer: 'Hassan Balaghi' };

describe('stages', () => {
  it('maps every status to a pipeline stage; client-signed is still with the client, withdrawn with lost', () => {
    expect(['Proposal Request Received', 'Drafting', 'In Internal Review', 'Sent to Client', 'Signed by Client', 'Signed by Both Parties', 'Lost', 'Withdrawn'].map((status) => stageOfProposal({ status })))
      .toEqual(['request', 'drafting', 'review', 'client', 'client', 'signed', 'lost', 'lost']);
  });
});

describe('table cells', () => {
  it('a request with a promise two days off: grey chip, coral ⚑ due flag, days since it came in', () => {
    const c = tableCells(P({ promisedBy: '2026-10-03', monthlyFee: 6500 }), ctx);
    expect([c.chip.text, c.flag?.text, c.flag?.tone, c.days, c.tone, c.monthly, c.action?.label]).toEqual(['Request', '⚑ due Sat', 'coral', 7, 'amber', '6,500', 'Start drafting']);
  });
  it('a promise due tomorrow turns the age red', () => {
    expect(tableCells(P({ promisedBy: '2026-10-02' }), ctx).tone).toBe('red');
  });
  it('drafting a revision: "Drafting · rev 2", days since the client asked, Generate V2', () => {
    const c = tableCells(P({ status: 'Drafting', revision: 2, revisions: [{ number: 2, requestedAt: '2026-09-24', sentAt: null } as any] }), ctx);
    expect([c.chip.text, c.days, c.action?.label]).toEqual(['Drafting · rev 2', 7, 'Generate V2']);
  });
  it('in review names the reviewer; approved offers Mark sent', () => {
    expect(tableCells(P({ status: 'In Internal Review', dateSentToHassan: '2026-09-08' }), ctx)).toMatchObject({ chip: { text: 'In review · Hassan', tone: 'amber' }, days: 23, tone: 'red', action: { kind: 'nudge' } });
    expect(tableCells(P({ status: 'In Internal Review', reviewStatus: 'approved' }), ctx).action?.label).toBe('Mark sent');
  });
  it('with a client: follow up flag when due, Mark lost when stale, amber at two weeks and red at two months', () => {
    const sent = P({ status: 'Sent to Client', dateSentToClient: '2026-09-02', monthlyFee: 5000 });
    expect(tableCells(sent, { ...ctx, due: true })).toMatchObject({ chip: { text: 'With client', tone: 'coral' }, flag: { text: 'follow up' }, days: 29, tone: 'amber', action: { kind: 'followed_up' } });
    expect(tableCells(P({ status: 'Sent to Client', dateSentToClient: '2025-04-10' }), { ...ctx, stale: true })).toMatchObject({ tone: 'red', action: { kind: 'mark_lost' } });
  });
  it('signed shows its date and links the agreement; lost has no age and no action', () => {
    expect(tableCells(P({ status: 'Signed by Both Parties', dblSignedDate: '2026-01-20', monthlyFee: 15000 }), { ...ctx, agreementId: 1 })).toMatchObject({ chip: { text: 'Signed 20 Jan', tone: 'green' }, days: null, action: { kind: 'agreement' } });
    expect(tableCells(P({ status: 'Lost' }), ctx)).toMatchObject({ chip: { text: 'Lost' }, days: null, action: null, monthly: '—' });
  });
  it('other currencies keep their code; a one-time fee says so', () => {
    expect(tableCells(P({ monthlyFee: 2000, currency: 'EUR' }), ctx).monthly).toBe('EUR 2,000');
    expect(tableCells(P({ oneTimeFee: 9000 }), ctx).monthly).toBe('9,000 once');
  });
});

describe('the pipeline strip', () => {
  it('counts and sums each stage in order; lost isn\'t in the pipeline', () => {
    const ps = [P({ monthlyFee: 6500 }), P({ id: 2 }), P({ id: 3, status: 'Drafting', monthlyFee: 4000 }), P({ id: 4, status: 'Sent to Client', monthlyFee: 12000 }), P({ id: 5, status: 'Lost', monthlyFee: 9000 })];
    expect(pipelineStrip(ps).map((p) => [p.key, p.n, p.detail])).toEqual([
      ['request', '2', 'SAR 6,500 /mo'], ['drafting', '1', 'SAR 4,000 /mo'], ['review', '0', 'SAR 0 /mo'], ['client', '1', 'SAR 12,000 /mo'], ['signed', '0', 'SAR 0 /mo'],
    ]);
  });
  it('a panel is as wide as its count, never under the minimum', () => {
    expect([pipeFlex(0), pipeFlex(1), pipeFlex(3)]).toEqual([PIPE_MIN, PIPE_MIN, 3]);
  });
});
