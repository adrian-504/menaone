// @vitest-environment jsdom
// Agreements as a year view (1.60 "pages-2"): the month axis, each lane, the next decision, the strip.
import { describe, expect, it } from 'vitest';

import { addMonthsIso, agreementAxis, agreementBuckets, agreementLane, agreementsStrip, axisPos, nextDecision } from './pagesAgreements';
import type { Agreement } from './types';

const T = '2026-10-01';
const A = (over: Partial<Agreement>): Agreement => ({
  id: 1, agrRef: 'GLX_BS_001_0126', client: 'Globex', companyId: 3, type: 'Company maintenance', status: 'Signed', preparedBy: null, datePrepared: null, dateSentToClient: null,
  dateClientSigned: '2026-01-05', dateMenaSigned: '2026-01-05', dateFiled: null, monthlyFee: 4000, contractMonths: 12, proposalId: null, hubspot: null, docLink: null, actionDate: null,
  remarks: null, createdAt: '2026-01-02', currency: 'SAR', startDate: '2026-01-06', endDate: '2026-12-31', serviceStatus: 'Active', noticeDays: 90, ...over,
});
const glx = A({});
const acme = A({ id: 2, client: 'Acme Holdings', monthlyFee: 15000, startDate: '2026-02-01', endDate: '2027-01-31', noticeDays: 60 });
const ehr = A({ id: 3, client: 'Elite HR', monthlyFee: 3000, startDate: '2026-03-05', endDate: '2027-03-04', noticeDays: 60 });
const nwt = A({ id: 4, client: 'Northwind Trading', status: 'Client Signature', serviceStatus: 'Not started', monthlyFee: 6500, startDate: '2026-11-01', endDate: '2027-10-31', dateClientSigned: null });

describe('the month axis', () => {
  it('spans the earliest start to three months past the latest end, on quarters, with the year on January', () => {
    const ax = agreementAxis([glx, acme, ehr], T);
    expect([ax.start, ax.end]).toEqual(['2026-01-01', '2027-07-01']);
    expect(ax.ticks.map((t) => t.label)).toEqual(['Jan 26', 'Apr', 'Jul', 'Oct', 'Jan 27', 'Apr', 'Jul']);
    expect(ax.ticks[0].pos).toBe(0);
    expect(ax.ticks[ax.ticks.length - 1].pos).toBe(100);
    expect(axisPos(ax, T)).toBeCloseTo(50, 0);
  });
  it('without dated agreements it shows this year', () => {
    const ax = agreementAxis([A({ startDate: null, endDate: null, dateClientSigned: null })], T);
    expect(ax.start).toBe('2026-01-01');
  });
});

describe('a lane', () => {
  const ax = agreementAxis([glx, acme, ehr], T);
  it('the term, the part already run, the notice window and the end', () => {
    const l = agreementLane(glx, ax, T);
    expect(l.term!.left).toBeCloseTo(axisPos(ax, '2026-01-06'), 1);
    expect(l.term!.left + l.term!.width).toBeCloseTo(axisPos(ax, '2026-12-31'), 0);
    expect(l.elapsed!.left + l.elapsed!.width).toBeCloseTo(axisPos(ax, T), 0);
    // Notice opens 2 Oct (90 days before 31 Dec): tomorrow, so the label names the whole window.
    expect(l.notice!.label).toBe('notice 2 Oct – 31 Dec');
    expect(l.notice!.left).toBeCloseTo(axisPos(ax, '2026-10-02'), 1);
    expect(l.end).toEqual({ pos: axisPos(ax, '2026-12-31'), label: '31 Dec' });
    expect(l.outline).toBe(false);
  });
  it('a notice further off is named by its date only; an unsigned one is an outline; no dates, no bar', () => {
    expect(agreementLane(acme, ax, T).notice!.label).toBe('notice 2 Dec');
    expect(agreementLane(nwt, agreementAxis([nwt], T), T)).toMatchObject({ outline: true, elapsed: null });
    expect(agreementLane(A({ startDate: null, endDate: null, dateClientSigned: null }), ax, T).term).toBeNull();
  });
});

describe('the next decision', () => {
  it('notice opening within 30 days → amber and Start renewal; within 90 → named in blue; else running', () => {
    expect(nextDecision(glx, T)).toMatchObject({ text: 'Notice opens tomorrow', tone: 'amber', action: 'renew', actionLabel: 'Start renewal', on: '2026-10-02' });
    expect(nextDecision(acme, T)).toMatchObject({ text: 'Notice due 2 Dec', tone: 'blue', action: 'open' });
    expect(nextDecision(ehr, T)).toMatchObject({ text: 'Running · 154 days left', tone: 'green', action: 'open' });
    expect(nextDecision(A({ endDate: '2026-11-15', noticeDays: 60 }), T)).toMatchObject({ text: 'Notice open · ends in 45 days', tone: 'amber', action: 'renew' });
    // A decided renewal says what was chosen, and there is no renewal left to start.
    expect(nextDecision(A({ renewalDecision: 'renew' }), T)).toMatchObject({ text: 'Renewal drafted', tone: 'green', action: 'open', actionLabel: 'Open' });
    expect(nextDecision(A({ renewalDecision: 'changes' }), T)).toMatchObject({ text: 'Renewing with changes', tone: 'blue', action: 'open' });
    expect(nextDecision(A({ renewalDecision: 'end' }), T)).toMatchObject({ text: 'Ending 31 Dec', tone: 'grey', action: 'open' });
  });
  it('unsigned, ended and cancelled say so', () => {
    expect(nextDecision(nwt, T)).toMatchObject({ text: 'Awaiting the client’s signature', tone: 'amber', on: T });
    expect(nextDecision(A({ status: 'MENA Signature' }), T).text).toBe('Awaiting our signature');
    expect(nextDecision(A({ endDate: '2026-08-31' }), T).text).toBe('Ended 31 Aug');
    expect(nextDecision(A({ status: 'Canceled' }), T).text).toBe('Cancelled');
  });
  it('sorts by the decision date: the unsigned one first, then the soonest notice', () => {
    const order = [ehr, acme, nwt, glx].sort((a, b) => nextDecision(a, T).on.localeCompare(nextDecision(b, T).on)).map((a) => a.client);
    expect(order).toEqual(['Northwind Trading', 'Globex', 'Acme Holdings', 'Elite HR']);
  });
});

describe('the strip', () => {
  it('monthly and yearly under signed agreements, notice opening, renewing in three months, awaiting signature', () => {
    expect(agreementsStrip([glx, acme, ehr, nwt], T).map((p) => [p.key, p.n, p.label, p.lead, p.detail])).toEqual([
      ['all', 'SAR 22,000', 'a month under 3 signed agreements', 'a year', 'SAR 264,000'],
      ['notice', '1', 'notice window opening', 'tomorrow', '2 Oct · Globex'],
      ['renewing', '1', 'renewing in 3 months', 'ends', '31 Dec · Globex'],
      ['unsigned', '1', 'awaiting signature', 'with', 'Northwind Trading'],
    ]);
  });
  it('buckets and calendar months', () => {
    expect(agreementBuckets(glx, T)).toEqual(['notice', 'renewing']);
    expect(agreementBuckets(ehr, T)).toEqual([]);
    expect(agreementBuckets(nwt, T)).toEqual(['unsigned']);
    expect(addMonthsIso('2026-10-01', 3)).toBe('2027-01-01');
    expect(addMonthsIso('2026-11-30', 3)).toBe('2027-02-28');
  });
});
