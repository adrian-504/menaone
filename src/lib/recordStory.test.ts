// @vitest-environment jsdom
// Record story visuals (1.61): the stage stepper per record type and the proposal's header figures.
import { describe, expect, it } from 'vitest';

import { opportunityStepper, proposalHeaderFigures, proposalStepper, serviceStartText, signatureStepper, stepperHtml } from './recordStory';
import type { Proposal } from './types';

const T = '2026-10-01';
const P = (over: Partial<Proposal>): Proposal => ({
  id: 3, client: 'Northwind Trading', companyId: 2, type: 'Payroll', status: 'Sent to Client', sentDate: '2026-09-02', dblSignedDate: null, kickoffDate: null, finance: null, hubspot: null, owner: 'Ahmad',
  remarks: null, dateAdded: '2026-08-28', monthlyFee: 5000, contractMonths: 12, winLossReason: null, docLink: null, archived: false, archivedAt: null, snoozedUntil: null, dateSentToHassan: '2026-08-30',
  dateSentToClient: '2026-09-02', dateSigned: null, notes: [], currency: 'SAR', reviewStatus: 'approved', reviewedAt: '2026-09-01', validUntil: '2026-10-02', ...over,
});

describe('the proposal stepper', () => {
  it('done steps before the current one, which carries its days; approval and the agreement to come are named', () => {
    const s = proposalStepper(P({}), T);
    expect(s.steps.map((x) => [x.label, x.sub, x.state])).toEqual([
      ['Request', '28 Aug', 'done'], ['Drafting', '', 'done'], ['Internal review', 'approved 1 Sept', 'done'], ['Sent to client', '2 Sept', 'current'], ['Client signed', '', 'todo'], ['Signed by both', '→ agreement', 'todo'], ['Service started', '', 'todo'],
    ]);
    expect(s.currentNote).toBe('29 days');
    expect(s.endNote).toBeNull();
  });
  it('a revision shows on Drafting; a lost proposal ends with its reason; a signed one has no current step', () => {
    const rev = proposalStepper(P({ status: 'Drafting', revision: 2, revisions: [{ number: 2, requestedAt: '2026-09-24', sentAt: null } as any] }), T);
    expect(rev.steps[1]).toEqual({ label: 'Drafting', sub: 'rev 2', state: 'current' });
    expect(rev.currentNote).toBe('7 days');
    const lost = proposalStepper(P({ status: 'Lost', winLossReason: 'Price too high' }), T);
    expect(lost.steps[lost.steps.length - 1]).toEqual({ label: 'Lost', sub: 'Price too high', state: 'ended' });
    expect(lost.currentNote).toBeNull();
  });
  it('signed with no start date: the last step is "Service not started yet", with the days since the signature', () => {
    const won = proposalStepper(P({ status: 'Signed by Both Parties', dateSigned: '2026-09-20', dblSignedDate: '2026-09-22' }), T);
    expect(won.steps.slice(0, 6).every((x) => x.state === 'done')).toBe(true);
    expect(won.steps[6]).toEqual({ label: 'Service not started yet', sub: '9 days since signature', state: 'current' });
    expect(won.currentNote).toBeNull();
  });
  it('once started it says when, against the signature', () => {
    const p = P({ status: 'Signed by Both Parties', dblSignedDate: '2026-10-03', serviceStartedAt: '2026-10-12' });
    expect(serviceStartText(p)).toBe('started 12 Oct · 9 days after signature');
    expect(proposalStepper(p, '2026-10-20').steps[6]).toEqual({ label: 'Service started', sub: '12 Oct · 9 days after signature', state: 'done' });
    expect(serviceStartText(P({ dblSignedDate: '2026-09-22', serviceStartedAt: '2026-09-22' }))).toBe('started on signature');
    expect(serviceStartText(P({ dblSignedDate: '2026-09-22', serviceStartedAt: '2026-09-20' }))).toBe('started 20 Sept · 2 days before signature');
    expect(serviceStartText(P({ dblSignedDate: null, dateSigned: null, serviceStartedAt: '2026-09-20' }))).toBe('started 20 Sept');
    expect(serviceStartText(P({ serviceStartedAt: null }))).toBeNull();
  });
  it('the agreement it became — or that there is none yet — closes a signed proposal\'s stepper', () => {
    const won = P({ status: 'Signed by Both Parties', dblSignedDate: '2026-09-22', serviceStartedAt: '2026-09-22' });
    expect(proposalStepper(won, T, { id: 4, agrRef: 'NWT_PAY_001_0926' }).endNote).toEqual({ text: 'Agreement NWT_PAY_001_0926', link: { kind: 'agreement', id: 4 } });
    expect(proposalStepper(won, T, null).endNote).toEqual({ text: 'no agreement yet', tone: 'amber' });
    expect(proposalStepper(P({}), T, null).endNote).toBeNull();
    const el = document.createElement('div'); el.innerHTML = stepperHtml(proposalStepper(won, T, null));
    expect(el.querySelector('.rk-snote.t-amber')?.textContent).toBe('no agreement yet');
  });
  it('the header says how it is priced where the monthly would be blank, and where the service stands once signed', () => {
    const perHead = proposalHeaderFigures(P({ monthlyFee: null, lines: [] }), { today: T, touch: null, due: false, shape: 'per person per month' });
    expect(perHead[0]).toEqual({ value: 'Per person per month', label: 'pricing' });
    const waiting = proposalHeaderFigures(P({ status: 'Signed by Both Parties', dblSignedDate: '2026-09-22' }), { today: T, touch: null, due: false });
    expect(waiting.map((f) => [f.value, f.label, f.tone]).slice(-2)).toEqual([['22 Sept', 'signed by both', undefined], ['9 days', 'since signature · service not started', 'amber']]);
    const started = proposalHeaderFigures(P({ status: 'Signed by Both Parties', dblSignedDate: '2026-09-22', serviceStartedAt: '2026-10-01' }), { today: T, touch: null, due: false });
    expect(started[started.length - 1]).toEqual({ value: '1 Oct', label: 'service started · 9 days after signature' });
    const same = proposalHeaderFigures(P({ status: 'Signed by Both Parties', dblSignedDate: '2026-09-22', serviceStartedAt: '2026-09-22' }), { today: T, touch: null, due: false });
    expect(same[same.length - 1].label).toBe('service started · on signature');
  });
});

describe('other steppers', () => {
  it('an opportunity walks its own stages; lost ends the line', () => {
    const s = opportunityStepper({ stage: 'Discovery', status: 'Open' }, 113);
    expect(s.steps.map((x) => x.state).slice(0, 4)).toEqual(['done', 'done', 'current', 'todo']);
    expect(s.steps.map((x) => x.label)).not.toContain('Lost');
    expect(s.currentNote).toBe('113 days');
    const lost = opportunityStepper({ stage: 'Lost', status: 'Lost' }, 5);
    expect(lost.steps[lost.steps.length - 1]).toMatchObject({ label: 'Lost', state: 'ended' });
    expect(opportunityStepper({ stage: 'Won', status: 'Won' }, 3).steps.every((x) => x.state === 'done')).toBe(true);
  });
  it('an agreement\'s signatures are done where there is a date', () => {
    const s = signatureStepper({ datePrepared: '2026-01-02', dateSentToClient: '2026-01-03', dateClientSigned: '2026-01-05', dateMenaSigned: null, dateFiled: null });
    expect(s.steps.map((x) => [x.label, x.sub, x.state])).toEqual([['Prepared', '2 Jan', 'done'], ['Sent', '3 Jan', 'done'], ['Client signed', '5 Jan', 'done'], ['MENA BIG signed', '—', 'todo'], ['Filed', '—', 'todo']]);
  });
  it('draws numbered circles, a tick when done and the days on the dashed connector', () => {
    const html = stepperHtml(proposalStepper(P({}), T));
    const el = document.createElement('div'); el.innerHTML = html;
    expect([...el.querySelectorAll('.rk-sp i')].map((i) => i.textContent)).toEqual(['✓', '✓', '✓', '04', '05', '06', '07']);
    expect(el.querySelector('.rk-sline.is-cur span')?.textContent).toBe('29 days');
    expect(el.querySelector('[aria-current="step"] b')?.textContent).toBe('Sent to client');
  });
});

describe('proposal header figures', () => {
  it('sent and due: monthly, contract value, days without contact in amber, the expiry in red', () => {
    const f = proposalHeaderFigures(P({}), { today: T, touch: { date: '2026-09-15', kind: 'email_out', days: 16 }, due: true });
    expect(f.map((x) => [x.value, x.label, x.tone ?? null])).toEqual([
      ['SAR 5,000', 'a month', 'green'], ['SAR 60,000', 'contract value · 12 mo', null], ['16 days', 'without contact', 'amber'], ['2 Oct', 'offer expires · tomorrow', 'red'],
    ]);
  });
  it('a request with a promise: days since the request and the promise', () => {
    const f = proposalHeaderFigures(P({ status: 'Proposal Request Received', dateAdded: '2026-09-24', promisedBy: '2026-10-02', monthlyFee: 6500, validUntil: null }), { today: T, touch: null, due: false });
    expect(f.slice(2).map((x) => [x.value, x.label, x.tone])).toEqual([['7 days', 'since the request', 'amber'], ['2 Oct', 'promised · 1 day left', 'red']]);
  });
  it('in review counts from when it went to the reviewer', () => {
    const f = proposalHeaderFigures(P({ status: 'In Internal Review', reviewRequestedAt: '2026-09-10', reviewStatus: 'pending', monthlyFee: 7000, contractMonths: 6, validUntil: null }), { today: T, touch: null, due: false });
    expect(f.map((x) => [x.value, x.label])).toEqual([['SAR 7,000', 'a month'], ['SAR 42,000', 'contract value · 6 mo'], ['21 days', 'in review']]);
  });
});
