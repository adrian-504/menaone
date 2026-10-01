// @vitest-environment jsdom
// Agreements as a year view (1.60 "pages-2", reworked in 1.61): the month axis, each lane by how its term ends,
// the next decision, the day-to-decide headline, the two groups and the strip.
import { describe, expect, it } from 'vitest';

import { addMonthsIso, agreementAxis, agreementBuckets, agreementGroups, agreementLane, agreementsStrip, axisPos, decideHeadline, missingFact, nextDecision } from './pagesAgreements';
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
  it('a fixed term: the bar, the part already run, a tick where notice opens and the end', () => {
    const l = agreementLane(glx, ax, T);
    expect(l.kind).toBe('fixed');
    expect(l.term!.left).toBeCloseTo(axisPos(ax, '2026-01-06'), 1);
    expect(l.term!.left + l.term!.width).toBeCloseTo(axisPos(ax, '2026-12-31'), 0);
    expect(l.elapsed!.left + l.elapsed!.width).toBeCloseTo(axisPos(ax, T), 0);
    // 90 days before 31 Dec.
    expect(l.tick).toBeCloseTo(axisPos(ax, '2026-10-02'), 1);
    expect(l.end).toEqual({ pos: axisPos(ax, '2026-12-31'), label: '31 Dec' });
    expect([l.past, l.tail, l.outline]).toEqual([null, null, false]);
  });
  it('no tick when the notice was never recorded, or is none', () => {
    expect(agreementLane(A({ noticeDays: null }), ax, T).tick).toBeNull();
    expect(agreementLane(A({ noticeDays: 0 }), ax, T).tick).toBeNull();
  });
  it('past its term and still active: hatched from the end to today; ended and no longer active: no hatch', () => {
    const past = agreementLane(A({ startDate: '2026-02-01', endDate: '2026-08-31' }), ax, T);
    expect(past.past!.left).toBeCloseTo(axisPos(ax, '2026-08-31'), 1);
    expect(past.past!.left + past.past!.width).toBeCloseTo(axisPos(ax, T), 0);
    expect(agreementLane(A({ startDate: '2026-02-01', endDate: '2026-08-31', serviceStatus: 'Ended' }), ax, T).past).toBeNull();
  });
  it('open-ended runs to the right edge with an arrow; one that ends with its project is solid to today, then dashed', () => {
    const open = agreementLane(A({ endDate: null, renewalType: 'open_ended' }), ax, T);
    expect(open.kind).toBe('open_ended');
    expect(open.term!.left + open.term!.width).toBeCloseTo(100, 0);
    expect(open.tail).toMatchObject({ kind: 'arrow' });
    expect(open.end).toBeNull();
    const project = agreementLane(A({ endDate: null, renewalType: 'project' }), ax, T);
    expect(project.term!.left + project.term!.width).toBeCloseTo(axisPos(ax, T), 0);
    expect(project.tail!.kind).toBe('dashed');
    expect(project.tail!.left + project.tail!.width).toBeCloseTo(100, 0);
  });
  it('not signed yet is an outline; no term recorded draws nothing', () => {
    expect(agreementLane(nwt, agreementAxis([nwt], T), T)).toMatchObject({ outline: true, elapsed: null });
    expect(agreementLane(A({ startDate: null, endDate: null, dateClientSigned: null }), ax, T)).toMatchObject({ kind: 'none', term: null, tail: null });
  });
});

describe('the next decision', () => {
  it('a decision within 30 days is amber with Start renewal; within 90 it is named in blue; else it is running', () => {
    expect(nextDecision(glx, T)).toMatchObject({ text: 'Decision due tomorrow', tone: 'amber', action: 'renew', actionLabel: 'Start renewal', on: '2026-10-02' });
    expect(nextDecision(acme, T)).toMatchObject({ text: 'Decision due 2 Dec', tone: 'blue', action: 'open' });
    expect(nextDecision(ehr, T)).toMatchObject({ text: 'Running · 154 days left', tone: 'green', action: 'open' });
  });
  it('the day to decide has passed while the term runs: red, and it says what happens', () => {
    expect(nextDecision(A({ endDate: '2026-11-15', noticeDays: 60 }), T)).toMatchObject({ text: 'Decide-by passed 16 Sept', more: 'renews unless notice was sent', tone: 'red', action: 'renew', on: '2026-09-16' });
  });
  it('a decided renewal says what was chosen, and there is no renewal left to start', () => {
    expect(nextDecision(A({ renewalDecision: 'renew' }), T)).toMatchObject({ text: 'Renewal drafted', tone: 'green', action: 'open', actionLabel: 'Open' });
    expect(nextDecision(A({ renewalDecision: 'changes' }), T)).toMatchObject({ text: 'Renewing with changes', tone: 'blue', action: 'open' });
    expect(nextDecision(A({ renewalDecision: 'end' }), T)).toMatchObject({ text: 'Ending 31 Dec', tone: 'grey', action: 'open' });
  });
  it('past its term it is "still active" — never expired — or, when the service has ended, ended', () => {
    expect(nextDecision(A({ endDate: '2026-08-31' }), T)).toMatchObject({ text: 'Past term · still active', tone: 'amber' });
    expect(nextDecision(A({ endDate: '2026-08-31', serviceStatus: 'Ended' }), T)).toMatchObject({ text: 'Ended 31 Aug', tone: 'grey' });
  });
  it('open-ended, ending with its project, with no term, unsigned and cancelled each say so', () => {
    expect(nextDecision(A({ endDate: null, renewalType: 'open_ended' }), T)).toMatchObject({ text: 'Running · open-ended', tone: 'green' });
    expect(nextDecision(A({ endDate: null, renewalType: 'project' }), T).text).toBe('Running · ends with the project');
    expect(nextDecision(A({ endDate: null }), T)).toMatchObject({ text: 'Signed · no term recorded', tone: 'grey' });
    expect(nextDecision(nwt, T)).toMatchObject({ text: 'Awaiting the client’s signature', tone: 'amber', on: T });
    expect(nextDecision(A({ status: 'MENA Signature' }), T).text).toBe('Awaiting our signature');
    expect(nextDecision(A({ status: 'In Preparation' }), T)).toMatchObject({ text: 'In Preparation', tone: 'grey' });
    expect(nextDecision(A({ status: 'Canceled' }), T).text).toBe('Cancelled');
  });
});

describe('the headline: the day to decide', () => {
  it('the date and how far it is; amber when near, red once passed', () => {
    expect(decideHeadline(glx, T)).toEqual({ value: '2 Oct', sub: 'decide by · 1 day', tone: 'amber' });
    expect(decideHeadline(acme, T)).toEqual({ value: '2 Dec', sub: 'decide by · 62 days', tone: null });
    expect(decideHeadline(A({ endDate: '2026-11-15', noticeDays: 60 }), T)).toEqual({ value: '16 Sept', sub: 'decide-by passed', tone: 'red' });
  });
  it('with the notice not recorded it is the end itself, and the row says the one fact that is missing', () => {
    const a = A({ noticeDays: null });
    expect(decideHeadline(a, T)).toEqual({ value: '31 Dec', sub: 'decide by · 91 days', tone: null });
    expect(missingFact(a)).toBe('notice not recorded');
    // Recorded as none is not missing.
    expect(missingFact(A({ noticeDays: 0 }))).toBeNull();
    expect(missingFact(A({ endDate: null, noticeDays: null }))).toBeNull();
  });
  it('what stands in when there is no day to decide', () => {
    expect(decideHeadline(A({ endDate: null, renewalType: 'open_ended' }), T)).toEqual({ value: '—', sub: 'open-ended', tone: null });
    expect(decideHeadline(A({ endDate: null, renewalType: 'project' }), T).sub).toBe('with the project');
    expect(decideHeadline(A({ endDate: '2026-08-31' }), T)).toEqual({ value: '31 Aug', sub: 'term ended', tone: 'amber' });
    expect(decideHeadline(A({ renewalDecision: 'end' }), T)).toEqual({ value: '31 Dec', sub: 'ends', tone: null });
    expect(decideHeadline(nwt, T)).toEqual({ value: '31 Oct 2027', sub: 'ends · not signed yet', tone: null });
  });
});

describe('two groups', () => {
  const noTerm = (id: number, client: string, status: string) => A({ id, client, status, startDate: null, endDate: null, dateClientSigned: null, serviceStatus: null, noticeDays: null });
  it('with a term by the day to decide; without one by status, then client', () => {
    const open = A({ id: 9, client: 'Zeta', endDate: null, renewalType: 'open_ended' });
    const passed = A({ id: 8, client: 'Red Sea Global', endDate: '2026-11-15', noticeDays: 60 });
    const g = agreementGroups([ehr, noTerm(11, 'Globex', 'In Preparation'), acme, open, noTerm(12, 'Acme Holdings', 'Signed'), glx, noTerm(13, 'Elite HR', 'On Hold'), passed, noTerm(14, 'Acme Holdings', 'Client Review'), noTerm(15, 'Acme Holdings', 'In Preparation')], T);
    expect(g.term.map((a) => a.client)).toEqual(['Red Sea Global', 'Globex', 'Acme Holdings', 'Elite HR', 'Zeta']);
    expect(g.noTerm.map((a) => [a.client, a.status])).toEqual([['Acme Holdings', 'Signed'], ['Acme Holdings', 'Client Review'], ['Acme Holdings', 'In Preparation'], ['Globex', 'In Preparation'], ['Elite HR', 'On Hold']]);
  });
});

describe('the strip', () => {
  const past = A({ id: 7, client: 'Elite HR', startDate: '2025-09-01', endDate: '2026-08-31', noticeDays: 30, monthlyFee: 2500 });
  const noTerm = A({ id: 10, client: 'Acme Holdings', startDate: null, endDate: null, dateClientSigned: null, serviceStatus: null, noticeDays: null });
  it('monthly and yearly under signed agreements; to decide in 90 days; past term, still active; with no term recorded', () => {
    expect(agreementsStrip([glx, acme, ehr, nwt, past, noTerm], T).map((p) => [p.key, p.n, p.label, p.lead, p.detail])).toEqual([
      // The past-term one is still served and invoiced: it is in the total.
      ['all', 'SAR 24,500', 'a month under 4 signed agreements', 'a year', 'SAR 294,000'],
      ['decide', '2', 'to decide in 90 days', 'tomorrow', '2 Oct · Globex'],
      ['past', '1', 'past term, still active', 'since', '31 Aug · Elite HR'],
      ['noterm', '1', 'with no term recorded', 'listed', 'below, without a lane'],
    ]);
  });
  it('the last panel opens the second group instead of filtering; cancelled ones are not counted in it', () => {
    const strip = agreementsStrip([glx, noTerm, { ...noTerm, id: 11, status: 'Canceled' }], T);
    expect(strip[3]).toMatchObject({ n: '1', tone: 'blue', action: 'agrShowNoTerm()' });
  });
  it('buckets: each agreement counts once per panel', () => {
    expect(agreementBuckets(glx, T)).toEqual(['decide']);
    expect(agreementBuckets(acme, T)).toEqual(['decide']);
    expect(agreementBuckets(ehr, T)).toEqual([]);
    expect(agreementBuckets(nwt, T)).toEqual([]);
    expect(agreementBuckets(past, T)).toEqual(['past']);
    // Decided, or passed: decided ones are out; a passed day to decide still needs deciding.
    expect(agreementBuckets(A({ renewalDecision: 'end' }), T)).toEqual([]);
    expect(agreementBuckets(A({ endDate: '2026-11-15', noticeDays: 60 }), T)).toEqual(['decide']);
    expect(addMonthsIso('2026-10-01', 3)).toBe('2027-01-01');
    expect(addMonthsIso('2026-11-30', 3)).toBe('2027-02-28');
  });
});
