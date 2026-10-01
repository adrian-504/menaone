// @vitest-environment jsdom
// Services (Catalog) in My Day's language (1.60 "pages-2"): grouping, prices, who is using what.
import { describe, expect, it } from 'vitest';

import { catalogGroups, categoryTile, servicePrice } from './pagesServices';
import type { Service } from './types';

const T = '2026-10-01';
const svc = (id: number, name: string, category: string, over: Partial<Service> = {}): Service => ({ id, name, category, description: null, agreementType: null, billing: 'monthly', defaultPrice: null, rateCardId: null, templateKey: null, active: true, sortOrder: null, mergedInto: null, ...over });
const card = (id: number, pricing: object) => ({ id, pricing: { name: 'x', cat: 'y', ...pricing } as any });

describe('what a service costs', () => {
  it('a range from tranches or packages, a single price, a percentage, per head, per country, once', () => {
    const cards = [
      card(1, { hasTranches: true, tranches: [{ label: 'a', noCommMin: 1200, noCommMax: 4000 }, { label: 'b', noCommMin: 5000, noCommMax: 15000 }] }),
      card(2, { hasPackages: true, packages: [{ name: 'S', min: 3500, max: 3500 }, { name: 'A', min: 6500, max: 6500 }] }),
      card(3, { percent: { standard: 10, min: 8, max: 15, basis: 'of the annual package' } }),
      card(4, { perPerson: true, noCommMin: 1350, noCommMax: 3550 }),
      card(5, { perCountry: true }),
      card(6, { perPerson: true }),
    ];
    expect(servicePrice(svc(1, 'Payroll', 'c', { rateCardId: 1 }), cards)).toBe('SAR 1,200–15,000 /mo');
    expect(servicePrice(svc(2, 'Accountancy', 'c', { rateCardId: 2 }), cards)).toBe('SAR 3,500–6,500 /mo');
    expect(servicePrice(svc(3, 'Recruitment', 'c', { rateCardId: 3 }), cards)).toBe('10% of annual package');
    expect(servicePrice(svc(4, 'Workforce', 'c', { rateCardId: 4 }), cards)).toBe('SAR 1,350–3,550 per head');
    expect(servicePrice(svc(5, 'Mobilization', 'c', { rateCardId: 5 }), cards)).toBe('per country');
    expect(servicePrice(svc(6, 'Manpower', 'c', { rateCardId: 6 }), cards)).toBe('per head');
    expect(servicePrice(svc(7, 'GM Representative', 'c', { defaultPrice: 6500 }), cards)).toBe('SAR 6,500 /mo');
    expect(servicePrice(svc(8, 'Constitution', 'c', { defaultPrice: 45000, billing: 'one_time' }), cards)).toBe('SAR 45,000 once');
    expect(servicePrice(svc(9, 'Nothing', 'c'), cards)).toBe('');
  });
});

describe('the catalogue', () => {
  const services = [svc(1, 'Payroll', 'GOSI & Payroll'), svc(2, 'Payroll and GOSI', 'GOSI & Payroll'), svc(3, 'PRO', 'Administration & PRO'), svc(4, 'Recruitment', 'Manpower & Recruitment'), svc(5, 'Company Maintenance', 'Company Maintenance'), svc(6, 'Mobilization', 'Workforce Services'), svc(7, 'Consultancy', 'Labor Law Consultancy')];
  const line = (serviceId: number | null, serviceName: string) => ({ serviceId, serviceName }) as any;
  const agr = (companyId: number, lines: any[], over: object = {}) => ({ companyId, client: `Co ${companyId}`, status: 'Signed', serviceStatus: 'Active' as const, endDate: '2027-01-31', lines, type: null, ...over });
  const prop = (id: number, status: string, lines: any[]) => ({ id, status, archived: false, lines, type: null });
  const groups = catalogGroups({
    services, rateCards: [], today: T,
    agreements: [agr(1, [line(1, 'Payroll'), line(3, 'PRO')]), agr(5, [line(1, 'Payroll')]), agr(3, [line(null, 'Company maintenance')]), agr(9, [line(1, 'Payroll')], { serviceStatus: 'Ended' })],
    proposals: [prop(2, 'In Internal Review', [line(4, 'Recruitment')]), prop(6, 'Proposal Request Received', [line(4, 'Recruitment')]), prop(4, 'Lost', [line(6, 'Mobilization')]), prop(1, 'Signed by Both Parties', [line(1, 'Payroll')])],
  });
  it('orders categories by active clients, then open proposals, then lost, then name, and numbers them', () => {
    expect(groups.map((g) => [g.no, g.category, g.activeClients, g.caption])).toEqual([
      ['01', 'GOSI & Payroll', 2, 'active clients'],
      ['02', 'Administration & PRO', 1, 'active client'],
      ['03', 'Company Maintenance', 1, 'active client'],
      ['04', 'Manpower & Recruitment', 0, '2 in proposals'],
      ['05', 'Workforce Services', 0, '1 lost'],
      ['06', 'Labor Law Consultancy', 0, 'clients'],
    ]);
  });
  it('counts a service\'s clients from active agreements only, matching names whatever their capitals', () => {
    const payroll = groups[0].services;
    expect(payroll.map((s) => [s.name, s.clients])).toEqual([['Payroll', 2], ['Payroll and GOSI', 0]]);
    expect(groups[2].services[0]).toMatchObject({ name: 'Company Maintenance', clients: 1 });
  });
  it('a category keeps its tile colour whatever the order', () => {
    const all = services.map((s) => s.category!);
    expect(categoryTile('Administration & PRO', all)).toBe(1);
    expect(categoryTile('Workforce Services', all)).toBe(6);
    expect(new Set(groups.map((g) => categoryTile(g.category, all))).size).toBe(6);
  });
});
