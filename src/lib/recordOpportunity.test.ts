// @vitest-environment jsdom
// The opportunity page's figures, the no-next-step prompt and its suggestions, the file cards and "At <company>".
import { describe, expect, it } from 'vitest';

import { atCompany, coverLabel, coverOf, fileCards, nextStepPrompt, nextStepSuggestions, opportunityHeaderFigures, serviceInName } from './recordOpportunity';
import { opportunityStepper } from './recordStory';
import { PS } from './commercial';
import type { Agreement, Opportunity, Proposal } from './types';

const T = '2026-10-01';
const O = (over: Partial<Opportunity> = {}): Opportunity => ({
  id: 2, name: 'Acme — GOSI audit', companyId: 1, companyName: 'Acme Holdings', owner: 'Ahmad', stage: 'Discovery', status: 'Open', estimatedValue: 15000, currency: 'SAR',
  probability: 20, expectedCloseDate: null, description: null, nextAction: null, proposalId: null, projectId: null, sortOrder: null, archived: false, createdAt: '2026-06-10', updatedAt: '2026-06-10', tags: [], ...over,
});

describe('the opportunity header', () => {
  it('value, probability with its bar, days in the stage (red when stalled) and the close date, or that it is not set', () => {
    const f = opportunityHeaderFigures(O(), { daysInStage: 113, stalled: true }, T);
    expect(f.map((x) => [x.value, x.label, x.tone])).toEqual([['SAR 15,000', 'value', 'green'], ['20%', 'probability', undefined], ['113 days', 'in discovery', 'red'], ['—', 'close date not set', undefined]]);
    expect(f[1].bar).toEqual({ pct: 20 });
  });
  it('a close date says how far it is, and is red once passed; what is missing is named', () => {
    const late = opportunityHeaderFigures(O({ expectedCloseDate: '2026-09-30', probability: null, estimatedValue: null }), { daysInStage: 50, stalled: false }, T);
    expect(late.map((x) => [x.value, x.label, x.tone])).toEqual([['—', 'value not set', undefined], ['—', 'probability not set', undefined], ['50 days', 'in discovery', 'amber'], ['30 Sept', 'close date · 1 day ago', 'red']]);
    expect(opportunityHeaderFigures(O({ expectedCloseDate: '2026-10-08' }), { daysInStage: 3, stalled: false }, T)[3]).toMatchObject({ label: 'close date · in 7 days', tone: undefined });
  });
  it('a decided opportunity shows its value and when it was won or lost', () => {
    expect(opportunityHeaderFigures(O({ stage: 'Won', status: 'Won' }), { daysInStage: 9, stalled: false }, T, '2026-01-20').map((x) => [x.value, x.label])).toEqual([['SAR 15,000', 'value'], ['20 Jan', 'won']]);
    expect(opportunityHeaderFigures(O({ stage: 'Lost', status: 'Lost' }), { daysInStage: 9, stalled: false }, T, '2025-04-02')[1]).toMatchObject({ value: '2 Apr 2025', label: 'lost' });
  });
});

describe('the stepper with its dates', () => {
  it('stages passed carry the day they were entered, the current one "since", Won to come the agreement', () => {
    const s = opportunityStepper(O(), 113, [{ stage: 'Lead', enteredAt: '2026-05-02' }, { stage: 'Discovery', enteredAt: '2026-06-10' }]);
    expect(s.steps.slice(0, 3).map((x) => [x.label, x.sub, x.state])).toEqual([['Lead', '2 May', 'done'], ['Qualified', '', 'done'], ['Discovery', 'since 10 Jun', 'current']]);
    expect(s.steps[s.steps.length - 1]).toMatchObject({ label: 'Won', sub: '→ agreement', state: 'todo' });
  });
});

describe('no next step', () => {
  const h = { noNextAction: true, stalled: true, daysSinceActivity: 113 };
  it('asks only on an open opportunity with nothing set, and says how long it has been quiet when stalled', () => {
    expect(nextStepPrompt(O(), h)?.headline).toBe('No next step, and nothing has happened for 113 days');
    expect(nextStepPrompt(O(), { ...h, stalled: false, daysSinceActivity: 3 })?.headline).toBe('No next step yet');
    expect(nextStepPrompt(O(), { ...h, noNextAction: false })).toBeNull();
    expect(nextStepPrompt(O({ status: 'Lost', stage: 'Lost' }), h)).toBeNull();
    expect(nextStepPrompt(O({ archived: true }), h)).toBeNull();
  });
  it('suggests a fixed list per stage, with the service and the contact filled in when known', () => {
    expect(nextStepSuggestions(O(), { service: 'GOSI audit' }).map((s) => [s.label, s.kind])).toEqual([['Book a scoping meeting', 'text'], ['Send the GOSI audit checklist', 'text'], ['Create the proposal', 'proposal'], ['Mark lost', 'lost']]);
    expect(nextStepSuggestions(O()).map((s) => s.label)[1]).toBe('Send the checklist');
    expect(nextStepSuggestions(O({ stage: 'Lead' }), { contact: 'Omar Haddad' })[0]).toEqual({ label: 'Call Omar to qualify', kind: 'text' });
    expect(nextStepSuggestions(O({ stage: 'Lead' }))[0].label).toBe('Call the client to qualify');
    expect(nextStepSuggestions(O({ stage: 'Verbal Commitment' })).map((s) => s.kind)).toEqual(['text', 'won', 'lost']);
  });
  it('once it has a proposal, the suggestion is to follow it up; every open stage ends with Mark lost; a decided one has none', () => {
    expect(nextStepSuggestions(O({ stage: 'Proposal', proposalId: 2 }))[0]).toEqual({ label: 'Follow up on the proposal', kind: 'text' });
    for (const stage of ['Lead', 'Qualified', 'Discovery', 'Meeting', 'Solution Design', 'Proposal', 'Negotiation', 'Verbal Commitment']) {
      const s = nextStepSuggestions(O({ stage }));
      expect(s[s.length - 1]).toEqual({ label: 'Mark lost', kind: 'lost' });
      expect(s.length).toBeLessThanOrEqual(4);
    }
    expect(nextStepSuggestions(O({ stage: 'Won' }))).toEqual([]);
  });
  it('finds the catalogue service the name mentions, the longest match', () => {
    const services = [{ name: 'GOSI' }, { name: 'GOSI audit' }, { name: 'Payroll' }];
    expect(serviceInName('Acme — GOSI audit', services)).toBe('GOSI audit');
    expect(serviceInName('Acme — mobilization', services)).toBeNull();
  });
});

describe('files as cards', () => {
  it('a deck is navy, a sheet green, the rest grey; a deck\'s cover says the service and version', () => {
    expect([coverOf('a.pptx'), coverOf('Commercials.xlsx'), coverOf('Scope.pdf')]).toEqual(['deck', 'sheet', 'doc']);
    expect(coverLabel('Acme Holdings_Payroll & PRO Proposal_08.01.2026_V2.pptx')).toBe('Payroll & PRO · V2');
    expect(coverLabel('Acme Holdings_Recruitment Proposal_12.09.2026.pptx')).toBe('Recruitment · V1');
    expect(coverLabel('Kickoff.pptx')).toBe('Kickoff');
    expect(coverLabel('Commercials.xlsx')).toBe('Commercials');
  });
  it('the proposal\'s documents first, then the folder newest first, without repeats', () => {
    const cards = fileCards(
      [{ fileName: 'Acme_Recruitment Proposal_12.09.2026.pptx', path: '/p/a.pptx', kind: 'proposal', version: 3, createdAt: '2026-09-12T10:00:00Z' }],
      [{ name: 'a.pptx', path: '/p/a.pptx', modifiedAt: '2026-09-12' }, { name: 'Commercials.xlsx', path: '/p/c.xlsx', modifiedAt: '2026-01-09T09:00:00Z' }, { name: 'Scope.pdf', path: '/p/s.pdf', modifiedAt: '2026-02-01' }],
    );
    expect(cards.map((c) => [c.label, c.cover, c.date])).toEqual([['Recruitment · V3', 'deck', '2026-09-12'], ['Scope', 'doc', '2026-02-01'], ['Commercials', 'sheet', '2026-01-09']]);
  });
});

describe('at the company', () => {
  const A = (over: Partial<Agreement>): Agreement => ({ id: 1, client: 'Acme Holdings', companyId: 1, status: 'Active', serviceStatus: 'Active', monthlyFee: 15000, currency: 'SAR', startDate: '2026-02-01', endDate: '2027-01-31', lines: [], ...over } as unknown as Agreement);
  const P = (over: Partial<Proposal>): Proposal => ({ id: 2, client: 'Acme Holdings', companyId: 1, type: 'Recruitment', status: PS.REVIEW, archived: false, ...over } as unknown as Proposal);
  it('the relationship with its monthly, the agreement that ends first, and what else is open — not this one or its proposal', () => {
    const at = atCompany({ id: 2, proposalId: 7 }, {
      today: T, relationship: 'Active client', agreements: [A({})], proposals: [P({}), P({ id: 7, type: 'GOSI audit' })],
      opportunities: [O(), O({ id: 1, name: 'Acme — recruitment', proposalId: 2 }), O({ id: 5, name: 'Acme — visas', stage: 'Lead' })], reviewer: () => 'Hassan Ali',
    });
    expect(at.relationship).toBe('Active client · SAR 15,000 /mo');
    expect(at.agreement).toEqual({ id: 1, text: 'ends 31 Jan 2027' });
    expect(at.open).toEqual([{ kind: 'proposal', id: 2, text: 'Recruitment, SL# 2 in review with Hassan' }, { kind: 'opportunity', id: 5, text: 'Acme — visas · lead' }]);
  });
  it('a prospect with nothing else has only its relationship', () => {
    expect(atCompany({ id: 2, proposalId: null }, { today: T, relationship: 'Prospect', agreements: [], proposals: [], opportunities: [O()], reviewer: () => '' })).toEqual({ relationship: 'Prospect', agreement: null, open: [] });
  });
});
