// @vitest-environment jsdom
// The agreement page's figures, its term lane and the renewal: three choices, what was chosen, the drafted renewal.
import { describe, expect, it } from 'vitest';

import { agreementHeaderFigures, decisionChip, documentChain, renewalDraft, renewalFor, termLane } from './recordAgreement';
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
  it('monthly, decide by, term end, notice, signature', () => {
    expect(agreementHeaderFigures(A(), T).map((f) => [f.value, f.label, f.tone])).toEqual([
      ['SAR 4,000', 'a month', 'green'], ['2 Oct', 'decide by · 1 day', 'amber'], ['31 Dec', 'term ends · 91 days', undefined], ['90 days', 'notice', undefined], ['Signed by both', 'signature', undefined],
    ]);
  });
  it('what is not recorded reads so, in grey — unknown is not none', () => {
    const f = agreementHeaderFigures(A({ endDate: null, noticeDays: null, dateClientSigned: null, dateMenaSigned: null, status: 'In Preparation' }), T);
    expect(f.map((x) => [x.value, x.label, x.tone])).toEqual([
      ['SAR 4,000', 'a month', 'green'], ['Not recorded', 'term end', 'muted'], ['Not recorded', 'notice period', 'muted'], ['Not recorded', 'signature', 'muted'],
    ]);
    expect(agreementHeaderFigures(A({ noticeDays: 0 }), T)[3]).toEqual({ value: 'No notice period', label: 'notice', tone: undefined });
  });
  it('open-ended and ending with the project say so; there is then no day to decide', () => {
    expect(agreementHeaderFigures(A({ endDate: null, renewalType: 'open_ended' }), T).map((x) => x.value)).toEqual(['SAR 4,000', 'Open-ended', '90 days', 'Signed by both']);
    expect(agreementHeaderFigures(A({ endDate: null, renewalType: 'project' }), T)[1]).toEqual({ value: 'With the project', label: 'term ends' });
  });
  it('the day to decide is red once passed; past its term it is "still active"; decided, it is no longer shown', () => {
    expect(agreementHeaderFigures(A({ endDate: '2026-11-15', noticeDays: 60 }), T)[1]).toEqual({ value: '16 Sept', label: 'decide-by passed', tone: 'red' });
    const past = agreementHeaderFigures(A({ endDate: '2026-08-31' }), T);
    expect(past.map((x) => x.label)).toEqual(['a month', 'term ended · still active', 'notice', 'signature']);
    expect(past[1].tone).toBe('amber');
    expect(agreementHeaderFigures(A({ endDate: '2026-08-31', serviceStatus: 'Ended' }), T)[1]).toMatchObject({ label: 'term ended · 31 days ago', tone: undefined });
    expect(agreementHeaderFigures(A({ renewalDecision: 'end' }), T).map((x) => x.label)).toEqual(['a month', 'term ends · 91 days', 'notice', 'signature']);
  });
  it('the monthly is the stored (billed) fee; a signature still outstanding is amber', () => {
    expect(agreementHeaderFigures(A({ monthlyFee: 4500 }), T)[0].value).toBe('SAR 4,500');
    expect(agreementHeaderFigures(A({ monthlyFee: null, lines: [] }), T)[0]).toEqual({ value: '—', label: 'no monthly fee' });
    expect(agreementHeaderFigures(A({ dateMenaSigned: null }), T)[4]).toEqual({ value: 'Countersignature outstanding', label: 'signature', tone: 'amber' });
  });
});

describe('the term as a lane', () => {
  it('a fixed term: what has run, today, and the notice window from the last day to give notice to the end', () => {
    const l = termLane(A(), T)!;
    expect(l.kind).toBe('fixed');
    expect(l.startLabel).toBe('6 Jan 2026');
    expect(l.endLabel).toBe('31 Dec 2026');
    expect(l.elapsed).toBeCloseTo(74.7, 0);
    expect(l.today).toBe(l.elapsed);
    expect(l.notice?.label).toBe('notice window · 2 Oct – 31 Dec');
    expect(l.notice!.left).toBeGreaterThan(l.elapsed);
    expect(l.past).toBeNull();
  });
  it('before the start nothing has run; after the end (service ended) all of it; no notice window when it was never recorded', () => {
    expect(termLane(A({ startDate: '2026-11-01', endDate: '2027-10-31' }), T)).toMatchObject({ elapsed: 0, today: null });
    expect(termLane(A({ startDate: '2025-01-01', endDate: '2025-12-31', serviceStatus: 'Ended' }), T)).toMatchObject({ elapsed: 100, today: null, past: null });
    expect(termLane(A({ noticeDays: null }), T)?.notice).toBeNull();
  });
  it('past its term and still active: the lane runs on to today, and says since when', () => {
    const l = termLane(A({ startDate: '2025-09-01', endDate: '2026-08-31', noticeDays: 30 }), T)!;
    expect(l.past).toEqual({ left: l.elapsed, label: 'past term · still active since 31 Aug' });
    expect(l.today).toBe(100);
    expect(l.notice).toBeNull();
    expect(l.elapsed).toBeLessThan(100);
  });
  it('open-ended and ending with the project have no end to scale by; with no term recorded there is no lane', () => {
    expect(termLane(A({ endDate: null, renewalType: 'open_ended' }), T)).toMatchObject({ kind: 'open_ended', endLabel: 'open-ended', today: 60, notice: null });
    expect(termLane(A({ endDate: null, renewalType: 'project' }), T)).toMatchObject({ kind: 'project', endLabel: 'with the project' });
    expect(termLane(A({ endDate: null }), T)).toBeNull();
  });
});

describe('documents and history', () => {
  it('the principal agreement with its document; a renewal sits between the term it renews and what follows', () => {
    const first = A({ docLink: 'https://example.test/agreement.pdf' });
    const renewal = A({ id: 9, agrRef: 'GLX_BS_002_0127', status: 'In Preparation', startDate: '2027-01-01', endDate: '2027-12-31', renewedFrom: 3, dateClientSigned: null, dateMenaSigned: null, datePrepared: '2026-10-01' });
    expect(documentChain(first, [first, renewal]).map((c) => [c.kind, c.title, c.sub, c.here, !!c.docLink])).toEqual([
      ['principal', 'Principal agreement', 'GLX_BS_001_0126 · signed 5 Jan', true, true],
      ['renewal', 'Renewal', 'GLX_BS_002_0127 · in preparation · from 1 Jan 2027', false, false],
    ]);
    expect(documentChain(renewal, [first, renewal]).map((c) => [c.kind, c.title, c.sub, c.here])).toEqual([
      ['previous', 'Previous term', 'GLX_BS_001_0126 · ended 31 Dec', false],
      ['principal', 'Renewal agreement', 'GLX_BS_002_0127 · prepared 1 Oct', true],
    ]);
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
    // Once the end date has passed it reads as ended.
    expect(decisionChip(A({ renewalDecision: 'end', endDate: '2026-08-31' }), T)).toEqual({ text: 'Ended 31 Aug', tone: 'grey' });
    // Past its term there is no day left to be reminded on: the third choice ends it now.
    expect(renewalFor(A({ endDate: '2026-08-31' }), T)!.cards.map((c) => [c.key, c.title, c.body])[2]).toEqual(['end', 'End it', 'Records the service as ended.']);
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
