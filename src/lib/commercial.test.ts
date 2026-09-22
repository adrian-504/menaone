import { describe, it, expect, beforeEach } from 'vitest';
import { S } from './state';
import { nextDeckFileName, proposalDecks,
  lineTotals, syncProposalTotals, isAgreementActive, activeMrr, toReporting, fmtMoneyByCurrency, missingRates,
  suggestedFileName, latestVersion, contractEndDate, isClosed, isInPreparation, PS, applyGeneratedDocument,
} from './commercial';
import type { Agreement, CommercialLine, Proposal } from './types';

const line = (serviceName: string, billing: CommercialLine['billing'], unitPrice: number | null, quantity = 1): CommercialLine => ({
  id: Math.floor(Math.random() * 1e6), serviceId: null, serviceName, description: null, billing, quantity, unitPrice, commission: false, sortOrder: 0,
});

const agreement = (over: Partial<Agreement>): Agreement => ({
  id: 1, agrRef: null, client: 'Acme', type: null, status: 'Signed', preparedBy: null, datePrepared: null, dateSentToClient: null,
  dateClientSigned: null, dateMenaSigned: null, dateFiled: null, monthlyFee: null, contractMonths: null, proposalId: null,
  hubspot: null, docLink: null, actionDate: null, remarks: null, createdAt: null, lines: [], ...over,
});

describe('commercial rules', () => {
  beforeEach(() => { S.fxRates = {}; S.proposals = []; S.agreements = []; });

  it('totals monthly, one-time and contract value from lines', () => {
    const t = lineTotals([line('Payroll', 'monthly', 3000), line('PRO', 'monthly', 1500, 2), line('Company Constitution', 'one_time', 55000), line('Payroll', 'monthly', null)], 12);
    expect(t.monthly).toBe(6000);
    expect(t.oneTime).toBe(55000);
    expect(t.contractValue).toBe(6000 * 12 + 55000);
    expect(t.serviceNames).toEqual(['Payroll', 'PRO', 'Company Constitution']);
    expect(lineTotals([line('PRO', 'monthly', null)], 12).contractValue).toBeNull();
  });

  it('keeps the proposal summary fields in step with its lines', () => {
    const p = { type: 'old', monthlyFee: 1, lines: [line('Payroll', 'monthly', 2500), line('Recruitment', 'one_time', 9000)], contractMonths: 6 } as unknown as Proposal;
    syncProposalTotals(p);
    expect(p.type).toBe('Payroll + Recruitment');
    expect(p.monthlyFee).toBe(2500);
    expect(p.oneTimeFee).toBe(9000);
  });

  it('counts only agreements with a running service towards MRR, per currency', () => {
    S.agreements = [
      agreement({ id: 1, serviceStatus: 'Active', currency: 'SAR', lines: [line('Payroll', 'monthly', 4000)] }),
      agreement({ id: 2, serviceStatus: 'Active', currency: 'EUR', monthlyFee: 1000 }),
      agreement({ id: 3, serviceStatus: 'Active', currency: 'SAR', monthlyFee: 9999, endDate: '2020-01-01' }),
      agreement({ id: 4, serviceStatus: 'Kickoff scheduled', currency: 'SAR', monthlyFee: 5000 }),
      agreement({ id: 5, serviceStatus: 'Active', status: 'Canceled', currency: 'SAR', monthlyFee: 5000 }),
    ];
    expect(isAgreementActive(S.agreements[2])).toBe(false);
    const mrr = activeMrr();
    expect(mrr).toEqual({ SAR: 4000, EUR: 1000 });
    expect(fmtMoneyByCurrency(mrr)).toBe('SAR 4,000 · EUR 1,000');
    expect(toReporting(mrr)).toBeNull();
    expect(missingRates(mrr)).toEqual(['EUR']);
    expect(toReporting(mrr, { EUR: 4.2 })).toBeCloseTo(8200);
  });

  it('names proposal files like the client folders already do', () => {
    expect(suggestedFileName('Adatum', 'Recruitment Services', '2026-06-08', [])).toBe('Adatum_Recruitment Services Proposal_08.06.2026.pptx');
    const existing = ['Adatum_Recruitment Services Proposal.pdf', 'Adatum_Recruitment Services Proposal_08.06.2026.pptx', 'Adatum_Recruitment Services Proposal_08.06.2026_V2.pptx'];
    expect(latestVersion(existing)).toBe(2);
    expect(suggestedFileName('Adatum', 'Recruitment Services', '2026-09-13', existing)).toBe('Adatum_Recruitment Services Proposal_13.09.2026_V3.pptx');
    expect(suggestedFileName('Adatum', 'Payroll', '2026-09-13', existing)).toBe('Adatum_Payroll Proposal_13.09.2026.pptx');
  });

  it('names the next deck past recorded versions too', () => {
    const doc = (id: number, version: number, fileName: string) => ({ id, kind: 'proposal' as const, version, fileName, path: null, url: null, notes: null, createdAt: null });
    const p = { client: 'Adatum', documents: [] as ReturnType<typeof doc>[] };
    expect(nextDeckFileName(p, 'Recruitment', '2026-09-15', [])).toBe('Adatum_Recruitment Proposal_15.09.2026.pptx');
    p.documents = [doc(1, 1, 'Adatum_Recruitment Proposal_15.09.2026.pptx')];
    expect(nextDeckFileName(p, 'Recruitment', '2026-09-15', [])).toBe('Adatum_Recruitment Proposal_15.09.2026_V2.pptx');
    // V2 recorded but its file moved out of the folder: still V3 next.
    p.documents.push(doc(2, 2, 'Adatum_Recruitment Proposal_15.09.2026_V2.pptx'));
    expect(nextDeckFileName(p, 'Recruitment', '2026-09-16', ['Adatum_Recruitment Proposal_15.09.2026.pptx'])).toBe('Adatum_Recruitment Proposal_16.09.2026_V3.pptx');
    // A recorded version whose name follows another pattern still moves the number on.
    p.documents = [doc(1, 4, 'Renamed deck.pptx')];
    expect(nextDeckFileName(p, 'Recruitment', '2026-09-15', [])).toBe('Adatum_Recruitment Proposal_15.09.2026_V5.pptx');
    expect(proposalDecks({ documents: [doc(1, 1, 'a'), { ...doc(2, 3, 'b') }, { ...doc(3, 2, 'c'), kind: 'supporting' as never }] }).map((d) => d.version)).toEqual([3, 1]);
  });

  it('works out contract end dates and status groups', () => {
    expect(contractEndDate('2026-01-15', 12)).toBe('2027-01-14');
    expect(contractEndDate('2026-03-01', 1)).toBe('2026-03-31');
    expect(isClosed({ status: PS.WON })).toBe(true);
    expect(isClosed({ status: PS.SENT })).toBe(false);
    expect(isInPreparation({ status: PS.REVIEW })).toBe(true);
  });
});

describe('line ids', () => {
  it('never hands out the same id twice before lines are saved', async () => {
    const { newLine } = await import('./commercial');
    S.proposals = []; S.agreements = [];
    const a = newLine(null, 0);
    const b = newLine(null, 1);
    expect(a.id).not.toBe(b.id);
  });
});

describe('owner filters ("Mine")', () => {
  const jane = { id: 7, name: 'Jane Tester', email: null, jobTitle: null, department: null, isReviewer: false, active: true, notes: null } as unknown as import('./types').TeamMember;
  const omar = { ...jane, id: 8, name: 'Omar Sample' };
  beforeEach(() => { S.team = [jane, omar]; S.currentUserId = null; });

  it('matches by linked owner first, then by name ignoring case and spaces', async () => {
    const { isOwnedBy } = await import('./commercial');
    expect(isOwnedBy({ ownerId: 7, owner: 'Someone Else' }, jane)).toBe(true);
    expect(isOwnedBy({ ownerId: 8, owner: 'Jane Tester' }, jane)).toBe(false);
    expect(isOwnedBy({ owner: '  jane tester ' }, jane)).toBe(true);
    expect(isOwnedBy({ owner: '' }, jane)).toBe(false);
    expect(isOwnedBy({ owner: 'Jane Tester' }, undefined)).toBe(false);
  });

  it('shows nothing as "Mine" until the signed-in user is known', async () => {
    const { matchesOwnerFilter, ownerFilterOptions, MINE } = await import('./commercial');
    const record = { owner: 'Jane Tester' };
    expect(matchesOwnerFilter(record, '')).toBe(true);
    expect(matchesOwnerFilter(record, MINE)).toBe(false);
    expect(ownerFilterOptions(['Jane Tester'], '')).not.toContain('>Mine<');

    S.currentUserId = 7;
    expect(matchesOwnerFilter(record, MINE)).toBe(true);
    expect(matchesOwnerFilter({ owner: 'Omar Sample' }, MINE)).toBe(false);
    expect(matchesOwnerFilter({ owner: 'Omar Sample' }, 'Omar Sample')).toBe(true);
    const html = ownerFilterOptions(['Omar Sample', null, 'Jane Tester', 'Omar Sample'], MINE);
    expect(html).toContain(`<option value="${MINE}" selected>Mine</option>`);
    expect(html.match(/Omar Sample<\/option>/g)).toHaveLength(1);
    expect(html.indexOf('Jane Tester')).toBeLessThan(html.indexOf('Omar Sample'));
  });
});

describe('applyGeneratedDocument', () => {
  const doc = { id: 7, kind: 'proposal', version: 1, fileName: 'Acme_Admin Proposal.pptx', path: '/x.pptx', url: null, notes: null, createdAt: '2026-09-22' } as any;
  it('moves a requested proposal to Drafting when its first deck is generated', () => {
    const p = { id: 1, client: 'Acme', status: PS.REQUEST, documents: [] } as any;
    applyGeneratedDocument(p, doc, '/Acme');
    expect(p.status).toBe(PS.DRAFTING);
    expect(p.documents).toHaveLength(1);
  });
  it('never moves a proposal back', () => {
    for (const status of [PS.DRAFTING, PS.REVIEW, PS.SENT, PS.WON, PS.LOST]) {
      const p = { id: 1, client: 'Acme', status, documents: [] } as any;
      applyGeneratedDocument(p, doc, null);
      expect(p.status).toBe(status);
    }
  });
});
