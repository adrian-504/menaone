// @vitest-environment jsdom
// The company page's services: one line per service, with where it stands.
import { describe, expect, it } from 'vitest';

import { companyServiceRows } from './companyServices';
import type { Agreement, CommercialLine, Proposal } from './types';

const T = '2026-10-01';
const line = (id: number, serviceName: string, unitPrice: number | null, billing: CommercialLine['billing'] = 'monthly'): CommercialLine => ({ id, serviceId: null, serviceName, description: null, billing, quantity: 1, unitPrice, commission: false, sortOrder: 0 });
const A = (over: Partial<Agreement>): Agreement => ({
  id: 1, agrRef: 'ACME_ADM_001_0126', client: 'Acme Holdings', companyId: 1, type: 'Administration', status: 'Signed', preparedBy: null, datePrepared: null, dateSentToClient: null,
  dateClientSigned: null, dateMenaSigned: null, dateFiled: null, monthlyFee: 15000, contractMonths: 12, proposalId: null, hubspot: null, docLink: null, actionDate: null, remarks: null, createdAt: null,
  currency: 'SAR', startDate: '2026-02-01', endDate: '2027-01-31', serviceStatus: 'Active', noticeDays: 60, lines: [line(11, 'Payroll', 9000), line(12, 'PRO', 6000)], ...over,
});
const P = (over: Partial<Proposal>): Proposal => ({ id: 5, client: 'Acme Holdings', companyId: 1, type: 'Recruitment', status: 'Signed by Both Parties', archived: false, currency: 'SAR', monthlyFee: null, lines: [], serviceStartedAt: '2026-09-10', ...over } as unknown as Proposal);

describe('a company\'s services', () => {
  it('one line per service under an active agreement: what it costs, the agreement, when it expires, Live', () => {
    const rows = companyServiceRows({ today: T, agreements: [A({})], proposals: [] });
    expect(rows.map((r) => [r.service, r.monthly, r.agreement?.ref, r.expires.text, r.status, r.tone])).toEqual([
      ['Payroll', 'SAR 9,000', 'ACME_ADM_001_0126', '31 Jan 2027', 'Live', 'green'],
      ['PRO', 'SAR 6,000', 'ACME_ADM_001_0126', '31 Jan 2027', 'Live', 'green'],
    ]);
  });
  it('with no end date it is Live and expires "not recorded"; open-ended says so', () => {
    expect(companyServiceRows({ today: T, agreements: [A({ endDate: null })], proposals: [] })[0]).toMatchObject({ status: 'Live', expires: { text: 'not recorded', known: false } });
    expect(companyServiceRows({ today: T, agreements: [A({ endDate: null, renewalType: 'open_ended' })], proposals: [] })[0].expires).toEqual({ text: 'open-ended', known: true });
  });
  it('past its end date and still active is "Past term · still active", first in the list', () => {
    const rows = companyServiceRows({ today: T, agreements: [A({}), A({ id: 2, agrRef: 'ACME_ACC_002_0925', endDate: '2026-08-31', lines: [line(21, 'Accountancy', 2500)] })], proposals: [] });
    expect(rows[0]).toMatchObject({ service: 'Accountancy', status: 'Past term · still active', tone: 'amber', expires: { text: '31 Aug' } });
  });
  it('a one-time line is one-time work', () => {
    const rows = companyServiceRows({ today: T, agreements: [A({ lines: [line(31, 'Company Constitution', 55000, 'one_time')] })], proposals: [] });
    expect(rows[0]).toMatchObject({ service: 'Company Constitution', monthly: 'one-time', status: 'One-time work', tone: 'grey' });
  });
  it('a service started from a signed proposal with no agreement line for it reads "No agreement"', () => {
    const rows = companyServiceRows({ today: T, agreements: [A({})], proposals: [P({ lines: [line(51, 'Recruitment', 7000)] })] });
    expect(rows.find((r) => r.service === 'Recruitment')).toMatchObject({ status: 'No agreement', tone: 'amber', agreement: null, proposalId: 5, monthly: 'SAR 7,000' });
    // Covered by an agreement line (whatever its capitals): not listed twice, and not "No agreement".
    const covered = companyServiceRows({ today: T, agreements: [A({})], proposals: [P({ lines: [line(52, 'payroll', 9000)] })] });
    expect(covered.map((r) => r.service)).toEqual(['Payroll', 'PRO']);
    // Signed but not started yet: nothing is running.
    expect(companyServiceRows({ today: T, agreements: [], proposals: [P({ serviceStartedAt: null, lines: [line(53, 'Recruitment', 7000)] })] })).toEqual([]);
  });
  it('an agreement whose service is not marked active counts once its proposal has started', () => {
    const quiet = A({ serviceStatus: null, endDate: null, noticeDays: null });
    expect(companyServiceRows({ today: T, agreements: [quiet], proposals: [] })).toEqual([]);
    const rows = companyServiceRows({ today: T, agreements: [quiet], proposals: [P({ lines: [line(54, 'Payroll', 9000)] })] });
    expect(rows.map((r) => [r.service, r.status, r.expires.text])).toEqual([['Payroll', 'Live', 'not recorded']]);
  });
  it('cancelled and ended agreements deliver nothing; an agreement without lines is its type', () => {
    expect(companyServiceRows({ today: T, agreements: [A({ status: 'Canceled' }), A({ id: 2, serviceStatus: 'Ended' })], proposals: [] })).toEqual([]);
    expect(companyServiceRows({ today: T, agreements: [A({ lines: [], type: 'Payroll + PRO' })], proposals: [] }).map((r) => [r.service, r.monthly])).toEqual([['Payroll', 'SAR 15,000'], ['PRO', '—']]);
  });
});
