// @vitest-environment jsdom
// What an agreement's term says: how it ends, the day to decide, and that unknown is not none.
import { describe, expect, it } from 'vitest';

import { decideBy, endFact, hasTerm, noticeFact, pastTermActive, pastTermUnset, renewalFact, signatureOf, termKind } from './agreementTerms';

const T = '2026-10-01';

describe('how a term ends', () => {
  it('on a date, open-ended, with its project — or nothing recorded', () => {
    expect(termKind({ endDate: '2026-12-31', renewalType: null })).toBe('fixed');
    expect(termKind({ endDate: null, renewalType: 'open_ended' })).toBe('open_ended');
    expect(termKind({ endDate: null, renewalType: 'project' })).toBe('project');
    expect(termKind({ endDate: null, renewalType: 'auto' })).toBe('none');
    expect(termKind({ endDate: '', renewalType: undefined })).toBe('none');
    expect([hasTerm({ endDate: null, renewalType: 'project' }), hasTerm({ endDate: null, renewalType: null })]).toEqual([true, false]);
  });
  it('says the end in words', () => {
    expect(endFact({ endDate: '2026-12-31', renewalType: null })).toMatchObject({ text: '31 Dec 2026', known: true });
    expect(endFact({ endDate: null, renewalType: 'open_ended' }).text).toBe('open-ended');
    expect(endFact({ endDate: null, renewalType: 'project' }).text).toBe('with the project');
    expect(endFact({ endDate: null, renewalType: null })).toMatchObject({ text: 'not recorded', known: false });
  });
});

describe('unknown is not none', () => {
  it('a notice period never recorded is not "no notice period"', () => {
    expect(noticeFact({ noticeDays: null })).toEqual({ text: 'not recorded', known: false });
    expect(noticeFact({ noticeDays: 0 })).toEqual({ text: 'no notice period', known: true });
    expect(noticeFact({ noticeDays: 90 })).toEqual({ text: '90 days', known: true });
    expect(noticeFact({ noticeDays: 1 }).text).toBe('1 day');
  });
  it('the same for how it renews', () => {
    expect(renewalFact({ renewalType: null })).toEqual({ text: 'not recorded', known: false });
    expect(renewalFact({ renewalType: 'fixed' })).toEqual({ text: 'Fixed term, no renewal', known: true });
    expect(renewalFact({ renewalType: 'auto' }).text).toBe('Renews automatically');
  });
});

describe('the day to decide', () => {
  it('is the end less the notice period', () => {
    expect(decideBy({ endDate: '2026-12-31', noticeDays: 90, renewalType: null }, T)).toEqual({ date: '2026-10-02', days: 1, passed: false, noticeKnown: true });
  });
  it('with the notice not recorded, or none, it is the end itself — and says which', () => {
    expect(decideBy({ endDate: '2026-12-31', noticeDays: null, renewalType: null }, T)).toMatchObject({ date: '2026-12-31', days: 91, noticeKnown: false });
    expect(decideBy({ endDate: '2026-12-31', noticeDays: 0, renewalType: null }, T)).toMatchObject({ date: '2026-12-31', noticeKnown: true });
  });
  it('has passed only while the term still runs; there is none without a fixed end', () => {
    expect(decideBy({ endDate: '2026-11-15', noticeDays: 60, renewalType: null }, T)).toMatchObject({ date: '2026-09-16', passed: true, days: -15 });
    expect(decideBy({ endDate: '2026-08-31', noticeDays: 30, renewalType: null }, T)).toMatchObject({ passed: false });
    expect(decideBy({ endDate: null, noticeDays: 30, renewalType: 'open_ended' }, T)).toBeNull();
    expect(decideBy({ endDate: null, noticeDays: null, renewalType: null }, T)).toBeNull();
  });
});

describe('past term, still active', () => {
  it('the end has passed and the service is still delivered', () => {
    const a = { endDate: '2026-08-31', renewalType: null, status: 'Signed', serviceStatus: 'Active' as const };
    expect(pastTermActive(a, T)).toBe(true);
    expect(pastTermActive({ ...a, serviceStatus: 'Ended' as const }, T)).toBe(false);
    expect(pastTermActive({ ...a, status: 'Canceled' }, T)).toBe(false);
    expect(pastTermActive({ ...a, endDate: '2026-12-31' }, T)).toBe(false);
    expect(pastTermActive({ ...a, endDate: null, renewalType: 'open_ended' as const }, T)).toBe(false);
    // "Let it end" was recorded: it is over, not past term.
    expect(pastTermActive({ ...a, renewalDecision: 'end' as const }, T)).toBe(false);
  });
  it('the end has passed and the service was never set: the page asks for it', () => {
    const a = { endDate: '2026-08-31', renewalType: null, status: 'Signed', serviceStatus: null };
    expect(pastTermUnset(a, T)).toBe(true);
    expect(pastTermUnset({ ...a, serviceStatus: 'Not started' as const }, T)).toBe(true);
    expect(pastTermUnset({ ...a, serviceStatus: 'Active' as const }, T)).toBe(false);
    expect(pastTermUnset({ ...a, serviceStatus: 'Ended' as const }, T)).toBe(false);
    expect(pastTermUnset({ ...a, status: 'Canceled' }, T)).toBe(false);
    expect(pastTermUnset({ ...a, endDate: '2026-12-31' }, T)).toBe(false);
  });
});

describe('how far the signatures got', () => {
  const none = { signatureStatus: null, dateClientSigned: null, dateMenaSigned: null, status: 'In Preparation' };
  it('the recorded status wins; else the two dates; else the agreement\'s own status; else not recorded', () => {
    expect(signatureOf({ ...none, signatureStatus: 'client_po', dateClientSigned: '2026-01-05', dateMenaSigned: '2026-01-06' })).toMatchObject({ status: 'client_po', text: 'client PO · not signed', both: false, known: true });
    expect(signatureOf({ ...none, dateClientSigned: '2026-01-05', dateMenaSigned: '2026-01-06' })).toMatchObject({ status: 'signed_both', both: true });
    expect(signatureOf({ ...none, dateClientSigned: '2026-01-05' })).toMatchObject({ status: 'client_signed', text: 'countersignature outstanding' });
    expect(signatureOf({ ...none, dateMenaSigned: '2026-01-06' })).toMatchObject({ status: 'mena_signed', text: 'awaiting the client’s signature' });
    expect(signatureOf({ ...none, status: 'Signed' })).toMatchObject({ status: 'signed_both', both: true });
    expect(signatureOf({ ...none, status: 'MENA Signature' }).status).toBe('client_signed');
    expect(signatureOf({ ...none, status: 'Client Signature' }).status).toBe('mena_signed');
    expect(signatureOf(none)).toEqual({ status: null, text: 'not recorded', both: false, known: false });
  });
});
