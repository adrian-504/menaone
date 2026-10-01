// @vitest-environment jsdom
// The agreement page's figures, its term lane and the renewal: three choices, what was chosen, the drafted renewal.
import { describe, expect, it } from 'vitest';

import { agreementHeaderFigures, decisionChip, renewalDraft, renewalFor, termLane } from './recordAgreement';
import type { Agreement } from './types';

const T = '2026-10-01';
const A = (over: Partial<Agreement> = {}): Agreement => ({
  id: 3, agrRef: 'GLX_BS_001_0126', client: 'Globex', companyId: 4, type: 'Company maintenance', status: 'Signed', preparedBy: 'Hassan Balaghi', preparedById: 2,
  datePrepared: '2026-01-02', dateSentToClient: '2026-01-03', dateClientSigned: '2026-01-05', dateMenaSigned: '2026-01-05', dateFiled: '2026-01-06',
  monthlyFee: 4000, contractMonths: 12, proposalId: 9, hubspot: 'Yes', docLink: null, actionDate: null, remarks: null, createdAt: '2026-01-02',
  businessEntityId: 1, currency: 'SAR', startDate: '2026-01-06', endDate: '2026-12-31', serviceStatus: 'Active', autoRenew: false, noticeDays: 90,
  lines: [{ id: 41, serviceId: 7, serviceName: 'Company maintenance', description: null, billing: 'monthly', quantity: 1, unitPrice: 4000, commission: false, sortOrder: 0 }], ...over,
});

describe('the agreement header', () => {
  it('contracted, a month, days left with the end (amber when notice is near), the notice period', () => {
    expect(agreementHeaderFigures(A(), T).map((f) => [f.value, f.label, f.tone])).toEqual([
      ['SAR 48,000', 'contracted', 'green'], ['SAR 4,000', 'a month', undefined], ['91 days', 'left · ends 31 Dec', 'amber'], ['90 days', 'notice', undefined],
    ]);
  });
  it('far from its end it is plain; in its last month red; once over it says when it ended', () => {
    expect(agreementHeaderFigures(A({ endDate: '2027-12-31', noticeDays: 30 }), T)[2]).toMatchObject({ value: '456 days', tone: undefined });
    expect(agreementHeaderFigures(A({ endDate: '2026-10-20' }), T)[2]).toMatchObject({ value: '19 days', tone: 'red' });
    expect(agreementHeaderFigures(A({ endDate: '2026-09-20' }), T)[2]).toEqual({ value: '20 Sept', label: 'ended · 11 days ago' });
  });
});

describe('the term as a lane', () => {
  it('what has run, today, and the notice window from the last day to give notice to the end', () => {
    const l = termLane(A(), T)!;
    expect(l.startLabel).toBe('6 Jan 2026');
    expect(l.endLabel).toBe('31 Dec 2026');
    expect(l.elapsed).toBeCloseTo(74.7, 0);
    expect(l.today).toBe(l.elapsed);
    expect(l.notice?.label).toBe('notice window · 2 Oct – 31 Dec');
    expect(l.notice!.left).toBeGreaterThan(l.elapsed);
  });
  it('before the start nothing has run; after the end all of it; without both dates there is no lane', () => {
    expect(termLane(A({ startDate: '2026-11-01', endDate: '2027-10-31' }), T)).toMatchObject({ elapsed: 0, today: null });
    expect(termLane(A({ startDate: '2025-01-01', endDate: '2025-12-31' }), T)).toMatchObject({ elapsed: 100, today: null });
    expect(termLane(A({ endDate: null }), T)).toBeNull();
    expect(termLane(A({ noticeDays: null }), T)?.notice).toBeNull();
  });
});

describe('the renewal', () => {
  it('a signed, running agreement with an end date: decide by the last day to give notice; three choices that say what they do', () => {
    const r = renewalFor(A(), T)!;
    expect(r.deadline).toBe('decide by 2 Oct');
    expect(r.tone).toBe('amber');
    expect(r.decided).toBeNull();
    expect(r.cards.map((c) => [c.key, c.title, c.body, c.chosen])).toEqual([
      ['renew', 'Renew as is', '12 months, SAR 4,000 a month. Drafts the renewal agreement.', false],
      ['changes', 'Renew with changes', 'Opens a proposal from this agreement’s lines.', false],
      ['end', 'Let it end', 'Records the decision; My Day reminds you on 31 Dec to mark the service ended.', false],
    ]);
  });
  it('without a notice period the end is the deadline; past it, it says so in red; far away it is quiet', () => {
    expect(renewalFor(A({ noticeDays: null }), T)).toMatchObject({ deadline: 'decide by 31 Dec', tone: null });
    expect(renewalFor(A({ noticeDays: 120 }), T)).toMatchObject({ deadline: 'notice date passed 2 Sept', tone: 'red' });
    expect(renewalFor(A({ endDate: '2027-12-31' }), T)).toMatchObject({ tone: null });
  });
  it('a decision marks its card, says when, and is no longer urgent', () => {
    const r = renewalFor(A({ renewalDecision: 'end', renewalDecidedAt: '2026-10-01' }), T)!;
    expect(r.cards.map((c) => c.chosen)).toEqual([false, false, true]);
    expect(r.decided).toEqual({ choice: 'end', on: 'Chosen 1 Oct' });
    expect(r.tone).toBeNull();
  });
  it('there is nothing to decide on an unsigned agreement, one without an end, or one whose service has ended', () => {
    expect(renewalFor(A({ status: 'Client Signature' }), T)).toBeNull();
    expect(renewalFor(A({ endDate: null }), T)).toBeNull();
    expect(renewalFor(A({ serviceStatus: 'Ended' }), T)).toBeNull();
  });
  it('says the decision in a chip', () => {
    expect(decisionChip(A())).toBeNull();
    expect(decisionChip(A({ renewalDecision: 'renew' }))).toEqual({ text: 'Renewal drafted', tone: 'green' });
    expect(decisionChip(A({ renewalDecision: 'changes' }))).toEqual({ text: 'Renewing with changes', tone: 'blue' });
    expect(decisionChip(A({ renewalDecision: 'end' }))).toEqual({ text: 'Ending 31 Dec', tone: 'grey' });
  });
});

describe('renew as is', () => {
  it('drafts the same agreement for the next term: it starts the day after, is in preparation, and points back', () => {
    let n = 900;
    const d = renewalDraft(A(), { id: 77, agrRef: 'GLX_BS_002_0127', today: T, lineId: () => ++n });
    expect(d).toMatchObject({
      id: 77, agrRef: 'GLX_BS_002_0127', client: 'Globex', type: 'Company maintenance', status: 'In Preparation', serviceStatus: 'Not started',
      startDate: '2027-01-01', endDate: '2027-12-31', contractMonths: 12, monthlyFee: 4000, noticeDays: 90, currency: 'SAR', businessEntityId: 1,
      renewedFrom: 3, renewalDecision: null, proposalId: null, dateClientSigned: null, datePrepared: T, remarks: 'Renewal of GLX_BS_001_0126',
    });
  });
  it('its lines are copies with ids of their own, so the old agreement keeps its lines', () => {
    let n = 900;
    const a = A();
    const d = renewalDraft(a, { id: 77, agrRef: 'X', today: T, lineId: () => ++n });
    expect(d.lines!.map((l) => [l.id, l.serviceName, l.unitPrice])).toEqual([[901, 'Company maintenance', 4000]]);
    expect(a.lines![0].id).toBe(41);
    expect(d.lines![0]).not.toBe(a.lines![0]);
  });
});
