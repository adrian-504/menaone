import { describe, it, expect } from 'vitest';
import { basedOnLabel, startFromCopy, startFromMatches, startFromSub, startFromTitle } from './startFrom';
import { blocksToSave, emptyBlock, proposalsFromBlocks, type SharedProposalFields } from './proposalBlocks';
import type { CommercialLine, Proposal } from './types';

const line = (id: number, name: string, price: number, over: Partial<CommercialLine> = {}): CommercialLine => ({ id, serviceId: id, serviceName: name, description: null, billing: 'monthly', quantity: 1, unitPrice: price, commission: false, sortOrder: 0, ...over });
const proposal = (id: number, client: string, lines: CommercialLine[], over: Partial<Proposal> = {}) => ({ id, client, type: null, status: 'Sent to Client', lines, contractMonths: 12, currency: 'SAR', businessEntityId: 1, dateAdded: '2026-01-05', dateSentToClient: '2026-01-10', sentDate: '2026-01-10', primaryContactId: 7, ...over } as Proposal);

const acme = proposal(1, 'Acme Holdings', [line(1, 'Payroll', 9000), line(2, 'PRO', 6000, { description: 'Up to 25 employees', commission: true, rates: [{ label: '1–5 employees', from: 1, to: 5, price: 6000 }] })]);
const northwind = proposal(3, 'Northwind Trading', [line(4, 'Payroll', 5000)], { dateSentToClient: '2026-09-02', sentDate: '2026-09-02', contractMonths: 6, businessEntityId: 2, currency: 'EUR' });
const request = proposal(6, 'Elite HR', [], { status: 'Proposal Request Received', dateSentToClient: null, sentDate: null, dateAdded: '2026-09-27' });
const all = [acme, northwind, request];

describe('start from a past proposal (1.66)', () => {
  it('finds past proposals of any client by client, service or number; the most recent first', () => {
    // With nothing typed: the recent ones. A request with no services has nothing to start from.
    expect(startFromMatches(all, '').map((p) => p.id)).toEqual([3, 1]);
    expect(startFromMatches(all, 'payroll').map((p) => p.id)).toEqual([3, 1]);
    expect(startFromMatches(all, 'acme pro').map((p) => p.id)).toEqual([1]);
    expect(startFromMatches(all, 'SL# 3').map((p) => p.id)).toEqual([3]);
    expect(startFromMatches(all, 'recruitment')).toEqual([]);
    expect(startFromMatches(all, '', 1).map((p) => p.id)).toEqual([3]);
    expect(startFromTitle(acme)).toBe('Acme Holdings — Payroll & PRO');
    expect(startFromSub(acme)).toBe('SAR 15,000 a month · 12 months · Sent to Client · 10 Jan 2026');
    expect(startFromSub(northwind)).toBe('EUR 5,000 a month · 6 months · Sent to Client · 2 Sept 2026');
  });

  it('copies the lines with their rows and options, the term and the entity; never the client or the contact', () => {
    const copy = startFromCopy(acme, 100);
    expect(Object.keys(copy).sort()).toEqual(['basedOnId', 'businessEntityId', 'contractMonths', 'currency', 'lines']);
    expect(copy).toMatchObject({ basedOnId: 1, contractMonths: 12, businessEntityId: 1, currency: 'SAR' });
    expect(copy.lines.map((l) => [l.id, l.serviceName, l.unitPrice, l.sortOrder])).toEqual([[100, 'Payroll', 9000, 0], [101, 'PRO', 6000, 1]]);
    expect(copy.lines[1]).toMatchObject({ description: 'Up to 25 employees', commission: true, rates: [{ label: '1–5 employees', from: 1, to: 5, price: 6000 }] });
    // Its own copies: changing the new proposal's rows leaves the old one as it was.
    copy.lines[1].rates![0].price = 1;
    copy.lines[0].unitPrice = 1;
    expect([acme.lines![0].unitPrice, acme.lines![1].rates![0].price]).toEqual([9000, 6000]);
  });

  it('the new proposal records where it started, and says it in one line', () => {
    const shared = { client: 'Globex', companyId: 3, status: 'Proposal Request Received', primaryContactId: 4, currency: 'SAR', businessEntityId: 1 } as unknown as SharedProposalFields;
    const copy = startFromCopy(acme, 100);
    const blocks = [{ lines: copy.lines, contractMonths: copy.contractMonths, basedOnId: copy.basedOnId }, { ...emptyBlock(6), lines: [line(200, 'Recruitment', 7000)] }];
    expect(blocksToSave(blocks)).toHaveLength(2);
    const [a, b] = proposalsFromBlocks(shared, blocks, 50, () => 'group-1');
    expect([a.basedOnId, b.basedOnId]).toEqual([1, null]);
    // The client and the contact are the new proposal's own.
    expect([a.client, a.primaryContactId, a.lines!.map((l) => l.serviceName)]).toEqual(['Globex', 4, ['Payroll', 'PRO']]);
    expect(basedOnLabel(a.basedOnId, all)).toBe('Acme Holdings — Payroll & PRO · SL# 1');
    expect(basedOnLabel(99, all)).toBe('SL# 99');
    expect(basedOnLabel(null, all)).toBe('');
  });
});
