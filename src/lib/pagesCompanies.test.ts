// @vitest-environment jsdom
// Companies in My Day's language (1.59 "pages"): agreement runway and notice window, in flight, to decide, the strip.
import { describe, expect, it } from 'vitest';

import { companiesStrip, companyBuckets, decideDates, inFlight, runway, runwayNote, type CompanyFigures } from './pagesCompanies';

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

describe('to decide in 90 days (1.64: in place of "gone quiet")', () => {
  const A = (over: object) => ({ status: 'Signed', serviceStatus: 'Active', endDate: null, noticeDays: null, renewalType: null, renewalDecision: null, ...over }) as never;
  it('the decide-by dates of live agreements within 90 days, soonest first; a passed one counts while the term runs', () => {
    expect(decideDates([A({ endDate: '2027-01-31', noticeDays: 60 }), A({ endDate: '2026-12-31', noticeDays: 90 }), A({ endDate: '2026-11-15', noticeDays: 60 })], T))
      .toEqual(['2026-09-16', '2026-10-02', '2026-12-02']);
    // With no notice period recorded the date is the end itself.
    expect(decideDates([A({ endDate: '2026-11-30' })], T)).toEqual(['2026-11-30']);
  });
  it('not when it is far off, decided, past term, ended, open-ended or cancelled', () => {
    expect(decideDates([
      A({ endDate: '2027-06-30', noticeDays: 30 }), A({ endDate: '2026-12-31', noticeDays: 90, renewalDecision: 'renew' }), A({ endDate: '2026-08-31' }),
      A({ endDate: '2026-12-31', noticeDays: 90, serviceStatus: 'Ended' }), A({ renewalType: 'open_ended' }), A({ endDate: '2026-12-31', noticeDays: 90, status: 'Canceled' }),
    ], T)).toEqual([]);
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
  const F = (over: Partial<CompanyFigures>): CompanyFigures => ({ name: 'X', relationship: 'Active client', mrr: {}, renewal: null, proposed: {}, firstMet: null, decide: [], ...over });
  const rows = [
    F({ name: 'Acme Holdings', mrr: { SAR: 15000 }, renewal: '2027-01-31' }),
    F({ name: 'Elite HR', mrr: { SAR: 3000 }, renewal: '2027-03-04' }),
    F({ name: 'Globex', mrr: { SAR: 4000 }, renewal: '2026-12-31', decide: ['2026-10-02'] }),
    F({ name: 'Northwind Trading', relationship: 'In discussion', proposed: { SAR: 11500 } }),
    F({ name: 'Red Sea Global', relationship: 'In discussion', proposed: { SAR: 12000 } }),
    F({ name: 'Northwind', relationship: 'Prospect', firstMet: '2026-10-01' }),
  ];
  it('monthly from clients with the next renewal, discussion worth, the newest prospect, what is to decide', () => {
    expect(companiesStrip(rows).map((p) => [p.key, p.n, p.label, p.detail])).toEqual([
      ['all', 'SAR 22,000', 'a month from 3 active clients', '31 Dec · Globex'],
      ['discussion', '2', 'in discussion', 'SAR 23,500 /mo in proposals'],
      ['prospect', '1', 'prospect', '1 Oct · Northwind'],
      ['decide', '1', 'to decide in 90 days', '2 Oct · Globex'],
    ]);
    // A decide-by date already passed (the term still running) says so.
    expect(companiesStrip(rows, '2026-10-05')[3].lead).toBe('was due');
    expect(companiesStrip(rows, T)[3].lead).toBe('soonest');
    const decide = companiesStrip(rows)[3];
    expect([decide.tone, decide.action, decide.keepZero]).toEqual(['amber', "navToModule('agreements')", true]);
    // None to decide: the panel stays, at 0 and neutral. No company is ever counted for a lack of contact.
    const none = companiesStrip(rows.map((r) => ({ ...r, decide: [] })))[3];
    expect([none.n, none.label, none.detail, none.tone]).toEqual(['0', 'to decide in 90 days', '', 'grey']);
    expect(companiesStrip(rows).some((p) => /quiet|contact/i.test(`${p.key} ${p.label} ${p.lead} ${p.detail}`))).toBe(false);
  });
  it('buckets: the relationship only', () => {
    expect(companyBuckets(rows[1])).toEqual(['client']);
    expect(companyBuckets(rows[5])).toEqual(['prospect']);
  });
});
