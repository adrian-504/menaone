// @vitest-environment jsdom
// Companies in My Day's language (1.59 "pages"): agreement runway and notice window, in flight, gone quiet, the strip.
import { describe, expect, it } from 'vitest';

import { companiesStrip, companyBuckets, goneQuiet, inFlight, runway, runwayNote, type CompanyFigures } from './pagesCompanies';

const T = '2026-10-01';

describe('agreement runway', () => {
  it('how far it has run, and amber when notice opens within 30 days', () => {
    const glx = runway({ startDate: '2026-01-06', endDate: '2026-12-31', noticeDays: 90, dateClientSigned: null }, T)!;
    expect([glx.daysLeft, glx.pct, glx.soon, glx.notice]).toEqual([91, 75, true, { date: '2026-10-02', open: false }]);
    expect(runwayNote(glx)).toBe('91 d · notice opens 2 Oct');
    const acme = runway({ startDate: '2026-02-01', endDate: '2027-01-31', noticeDays: 60, dateClientSigned: null }, T)!;
    expect([acme.daysLeft, acme.soon]).toEqual([122, false]);
    expect(runwayNote(acme)).toBe('122 d');
  });
  it('an open notice window says since when; no end date, no runway', () => {
    const r = runway({ startDate: '2026-01-01', endDate: '2026-11-15', noticeDays: 60, dateClientSigned: null }, T)!;
    expect(runwayNote(r)).toBe('45 d · notice open since 16 Sept');
    expect(runway({ startDate: '2026-01-01', endDate: null, noticeDays: 60, dateClientSigned: null }, T)).toBeNull();
  });
});

describe('gone quiet', () => {
  it('clients and companies in discussion after 30 days without contact; prospects never', () => {
    expect(goneQuiet('Active client', '2026-08-31', T)).toBe(31);
    expect(goneQuiet('Active client', '2026-09-10', T)).toBeNull();
    expect(goneQuiet('In discussion', '2026-08-01', T)).toBe(61);
    expect(goneQuiet('Prospect', '2026-01-01', T)).toBeNull();
    expect(goneQuiet('Active client', null, T)).toBeNull();
  });
});

describe('in flight', () => {
  it('counts, then the one urgent bit: a promise due, an offer expiring, a follow-up due', () => {
    expect(inFlight({ proposals: [{ status: 'Proposal Request Received', promisedBy: '2026-10-02' }, { status: 'Sent to Client', due: true }], openOpps: 0, nextMeeting: null }, T))
      .toEqual({ text: '2 proposals', urgent: { text: '1 due Fri', tone: 'red' } });
    expect(inFlight({ proposals: [{ status: 'Sent to Client', validUntil: '2026-10-05' }], openOpps: 2, nextMeeting: null }, T))
      .toEqual({ text: '1 proposal · 2 opportunities', urgent: { text: 'expires Mon', tone: 'red' } });
    expect(inFlight({ proposals: [{ status: 'Sent to Client', due: true }], openOpps: 0, nextMeeting: null }, T).urgent).toEqual({ text: 'follow up', tone: 'amber' });
    expect(inFlight({ proposals: [{ status: 'Drafting', revision: 2 }], openOpps: 0, nextMeeting: null }, T).text).toBe('1 proposal · rev 2');
  });
  it('nothing in flight but a meeting this week says so', () => {
    expect(inFlight({ proposals: [], openOpps: 0, nextMeeting: { date: T, time: '16:05' } }, T).text).toBe('Meeting today 16:05');
    expect(inFlight({ proposals: [], openOpps: 0, nextMeeting: { date: '2026-11-01', time: null } }, T).text).toBe('');
  });
});

describe('the strip', () => {
  const F = (over: Partial<CompanyFigures>): CompanyFigures => ({ name: 'X', relationship: 'Active client', mrr: {}, renewal: null, proposed: {}, firstMet: null, quietDays: null, ...over });
  const rows = [
    F({ name: 'Acme Holdings', mrr: { SAR: 15000 }, renewal: '2027-01-31' }),
    F({ name: 'Elite HR', mrr: { SAR: 3000 }, renewal: '2027-03-04', quietDays: 31 }),
    F({ name: 'Globex', mrr: { SAR: 4000 }, renewal: '2026-12-31' }),
    F({ name: 'Northwind Trading', relationship: 'In discussion', proposed: { SAR: 11500 } }),
    F({ name: 'Red Sea Global', relationship: 'In discussion', proposed: { SAR: 12000 } }),
    F({ name: 'Northwind', relationship: 'Prospect', firstMet: '2026-10-01' }),
  ];
  it('monthly from clients with the next renewal, discussion worth, the newest prospect, the longest quiet', () => {
    expect(companiesStrip(rows).map((p) => [p.key, p.n, p.label, p.detail])).toEqual([
      ['all', 'SAR 22,000', 'a month from 3 active clients', '31 Dec · Globex'],
      ['discussion', '2', 'in discussion', 'SAR 23,500 /mo in proposals'],
      ['prospect', '1', 'prospect', '1 Oct · Northwind'],
      ['quiet', '1', 'gone quiet', '31 days · Elite HR'],
    ]);
  });
  it('buckets: relationship, plus quiet', () => {
    expect(companyBuckets(rows[1])).toEqual(['client', 'quiet']);
    expect(companyBuckets(rows[5])).toEqual(['prospect']);
  });
});
