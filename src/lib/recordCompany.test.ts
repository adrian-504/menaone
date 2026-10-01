// @vitest-environment jsdom
// The company page in the record anatomy (1.61): header figures, stand headlines, In flight rows.
import { describe, expect, it } from 'vitest';

import { companyHeaderFigures, inFlightRows, owedHeadline, standHeadline } from './recordCompany';
import type { Agreement, Opportunity, Proposal } from './types';

const T = '2026-10-01';
const agr = (over: Partial<Agreement> = {}): Agreement => ({
  id: 1, agrRef: 'ACME_ADM_001_0126', client: 'Acme Holdings', companyId: 1, type: 'Administration', status: 'Signed', preparedBy: null, datePrepared: null, dateSentToClient: null, dateClientSigned: '2026-01-20',
  dateMenaSigned: null, dateFiled: null, monthlyFee: 15000, contractMonths: 12, proposalId: 1, hubspot: null, docLink: null, actionDate: null, remarks: null, createdAt: null, currency: 'SAR',
  startDate: '2026-02-01', endDate: '2027-01-31', serviceStatus: 'Active', noticeDays: 60, ...over,
});
const P = (over: Partial<Proposal>): Proposal => ({
  id: 2, client: 'Acme Holdings', companyId: 1, type: 'Recruitment', status: 'In Internal Review', sentDate: null, dblSignedDate: null, kickoffDate: null, finance: null, hubspot: null, owner: 'Ahmad',
  remarks: null, dateAdded: '2026-08-20', monthlyFee: 7000, contractMonths: 6, winLossReason: null, docLink: null, archived: false, archivedAt: null, snoozedUntil: null, dateSentToHassan: '2026-09-08',
  dateSentToClient: null, dateSigned: null, notes: [], currency: 'SAR', ...over,
});
const O = (over: Partial<Opportunity>): Opportunity => ({ id: 1, name: 'Acme — recruitment', companyId: 1, companyName: 'Acme Holdings', owner: 'Ahmad', stage: 'Proposal', status: 'Open', estimatedValue: 42000, currency: 'SAR', probability: 60, expectedCloseDate: null, description: null, nextAction: 'Chase', proposalId: 2, projectId: null, sortOrder: null, archived: false, createdAt: '2026-07-01', updatedAt: '2026-07-01', tags: [], ...over });
const sentOld = P({ id: 4, type: 'Mobilization', status: 'Sent to Client', dateSentToClient: '2025-04-10', monthlyFee: 4000 });
const gosi = O({ id: 2, name: 'Acme — GOSI audit', stage: 'Discovery', proposalId: null, nextAction: null });
const owes = [{ direction: 'ours' as const, status: 'open' as const, dueDate: '2026-09-19' }, { direction: 'theirs' as const, status: 'open' as const, dueDate: '2026-09-18' }];

describe('header figures', () => {
  it('monthly since, the agreement end with its runway, notice due, in flight with its monthly, owed', () => {
    const f = companyHeaderFigures({ today: T, clientAgreements: [agr()], proposals: [P({}), sentOld], opportunities: [O({}), gosi], commitments: owes });
    expect(f.map((x) => [x.value, x.label, x.tone ?? null])).toEqual([
      ['SAR 15,000', 'a month · since Feb 2026', 'green'],
      ['31 Jan 2027', 'agreement ends · 122 days', null],
      ['2 Dec', 'notice due · 62 days', 'amber'],
      ['3', 'in flight · SAR 11,000 /mo', null],
      ['1 each way', '12 days late', 'red'],
    ]);
    expect(f[1].bar).toEqual({ pct: 66, tone: 'green' });
  });
  it('a prospect has no money or agreement figures', () => {
    expect(companyHeaderFigures({ today: T, clientAgreements: [], proposals: [], opportunities: [], commitments: [] })).toEqual([]);
  });
});

describe('owed and stand headlines', () => {
  it('says who owes, and how late ours is', () => {
    expect(owedHeadline(owes, T)).toEqual({ headline: '1 each way', caption: '12 days late', late: true });
    expect(owedHeadline([owes[1]], T)).toEqual({ headline: 'They owe 1', caption: 'theirs is late', late: false });
    expect(owedHeadline([{ direction: 'ours', status: 'open', dueDate: '2026-10-20' }, { direction: 'ours', status: 'kept', dueDate: null }], T)).toEqual({ headline: 'We owe 1', caption: 'nothing late', late: false });
    expect(owedHeadline([], T)).toBeNull();
  });
  it('each card has a headline', () => {
    const i = { today: T, clientAgreements: [agr()], proposals: [], opportunities: [], commitments: owes, relationship: 'Active client', lastContact: T, threads: 3 };
    expect(standHeadline('relationship', i)).toBe('Client since Feb 2026');
    expect(standHeadline('inflight', i)).toBe('3 open');
    expect(standHeadline('rhythm', i)).toBe('Today');
    expect(standHeadline('rhythm', { ...i, lastContact: '2026-09-22' })).toBe('9 days ago');
    expect(standHeadline('commitments', i)).toBe('1 each way');
    expect(standHeadline('relationship', { ...i, clientAgreements: [], relationship: 'Prospect' })).toBe('Prospect');
  });
});

describe('in flight rows', () => {
  const rows = inFlightRows({
    today: T, proposals: [P({}), sentOld, P({ id: 9, status: 'Lost' })], opportunities: [O({}), gosi, O({ id: 3, status: 'Won', stage: 'Won' })],
    reviewer: () => 'Hassan Balaghi', due: (p) => p.id === 4, stale: (p) => p.id === 4, followUps: (p) => (p.id === 4 ? 4 : 0),
    health: (o) => (o.id === 2 ? { stalled: true, daysSinceActivity: 113, noNextAction: true } : { stalled: false, daysSinceActivity: 5, noNextAction: false }),
  });
  it('open proposals and the opportunities that have not become one, the most urgent first', () => {
    expect(rows.map((r) => [r.kind, r.id, r.chip.text, r.days, r.action.label])).toEqual([
      ['proposal', 4, 'With client', 539, 'Mark lost'],
      ['opportunity', 2, 'Stalled', 113, 'Add next step'],
      ['proposal', 2, 'In review · Hassan', 23, 'Nudge'],
    ]);
  });
  it('says what each row is', () => {
    expect(rows[0].sub).toBe('Proposal SL# 4 · sent Apr 2025 · 4 follow-ups');
    expect(rows[1].sub).toBe('Opportunity · discovery · no next step');
  });
});
