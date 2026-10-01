// @vitest-environment jsdom
// How a fee is charged: the basis of a line, a proposal's shape where a monthly figure would be blank, and an
// agreement's fees grouped by basis.
import { describe, expect, it } from 'vitest';

import { feeGroups, lineBasis, lineShape, pricingShape } from './pricingShape';
import type { CommercialLine } from './types';

const L = (over: Partial<CommercialLine>): CommercialLine => ({ id: 1, serviceId: null, serviceName: 'Payroll', description: null, billing: 'monthly', quantity: 1, unitPrice: 3000, commission: false, sortOrder: 0, ...over });
const RECRUITMENT = { percent: { min: 8, standard: 10, max: 12, basis: 'of the annual package' } };
const WORKFORCE = { perPerson: true };
const MOBILIZATION = { perCountry: true };
const ACCOUNTANCY = { hasPackages: true };
const cards: Record<string, object | null> = { Recruitment: RECRUITMENT, Workforce: WORKFORCE, Mobilization: MOBILIZATION, Accountancy: ACCOUNTANCY };
const cardFor = (l: CommercialLine) => (cards[l.serviceName] ?? null) as never;

describe('how one line is charged', () => {
  it('monthly, per person per month, per hire, per action, one-time, a percentage', () => {
    expect(lineBasis(L({}), null)).toBe('monthly');
    expect(lineBasis(L({ serviceName: 'Workforce' }), WORKFORCE)).toBe('per_person');
    expect(lineBasis(L({ serviceName: 'Recruitment', unitPrice: null }), RECRUITMENT)).toBe('per_hire');
    expect(lineBasis(L({ serviceName: 'Mobilization', billing: 'one_time' }), MOBILIZATION)).toBe('per_action');
    expect(lineBasis(L({ serviceName: 'Work visas', billing: 'one_time', quantity: 12 }), null)).toBe('per_action');
    expect(lineBasis(L({ serviceName: 'Company Constitution', billing: 'one_time' }), null)).toBe('one_time');
    expect(lineBasis(L({ unitPrice: null, rates: [{ label: 'Commission', percent: 5 }] }), null)).toBe('percentage');
  });
  it('says it in words', () => {
    expect(lineShape(L({ serviceName: 'Workforce' }), WORKFORCE)).toBe('per person per month');
    expect(lineShape(L({ serviceName: 'Recruitment', unitPrice: null, rates: [{ label: 'Managers', percent: 9 }] }), RECRUITMENT)).toBe('9% of the annual package');
    expect(lineShape(L({ serviceName: 'Recruitment', unitPrice: null }), RECRUITMENT)).toBe('10% of the annual package');
    expect(lineShape(L({ serviceName: 'Work visas', billing: 'one_time', quantity: 12 }), null)).toBe('per visa');
    expect(lineShape(L({ serviceName: 'Mobilization', billing: 'one_time' }), MOBILIZATION)).toBe('per country');
    expect(lineShape(L({ serviceName: 'Company Constitution', billing: 'one_time' }), null)).toBe('one-time');
    expect(lineShape(L({ serviceName: 'Accountancy', unitPrice: null, rates: [{ label: 'Startup', price: 1500 }, { label: 'Active', price: 2500 }] }), ACCOUNTANCY)).toBe('2 options');
    expect(lineShape(L({ unitPrice: null, rates: [{ label: '', from: 1, to: 10, price: 900 }, { label: '', from: 11, to: 25, price: 1400 }] }), null)).toBe('by headcount');
  });
});

describe('a proposal\'s pricing shape', () => {
  it('is said only where a monthly figure would be blank', () => {
    expect(pricingShape([L({})], cardFor)).toBeNull();
    expect(pricingShape([], cardFor)).toBeNull();
    expect(pricingShape([L({ serviceName: 'Recruitment', unitPrice: null })], cardFor)).toBe('10% of the annual package');
    expect(pricingShape([L({ serviceName: 'Company Constitution', billing: 'one_time', unitPrice: 55000 })], cardFor)).toBe('one-time');
    expect(pricingShape([L({ serviceName: 'Accountancy', unitPrice: null, rates: [{ label: 'Startup', price: 1500 }, { label: 'Active', price: 2500 }] })], cardFor)).toBe('2 options');
  });
  it('names the first two shapes of a mixed proposal', () => {
    const lines = [L({ serviceName: 'Recruitment', unitPrice: null }), L({ id: 2, serviceName: 'Mobilization', billing: 'one_time', unitPrice: 4000 }), L({ id: 3, serviceName: 'Company Constitution', billing: 'one_time', unitPrice: 55000 })];
    expect(pricingShape(lines, cardFor)).toBe('10% of the annual package + per country + 1 more');
  });
});

describe('an agreement\'s fees by basis', () => {
  it('groups the lines in a fixed order, each with what it costs; a group of several adds up', () => {
    const groups = feeGroups([
      L({ id: 1, serviceName: 'Payroll', unitPrice: 9000 }), L({ id: 2, serviceName: 'PRO', unitPrice: 6000, description: 'Up to 25 employees' }),
      L({ id: 3, serviceName: 'Company Constitution', billing: 'one_time', unitPrice: 55000 }),
      L({ id: 4, serviceName: 'Workforce', unitPrice: 450, quantity: 20 }),
      L({ id: 5, serviceName: 'Recruitment', unitPrice: null, rates: [{ label: 'Managers', percent: 12 }, { label: 'Staff', percent: 9 }] }),
    ], cardFor, 'SAR');
    expect(groups.map((g) => [g.label, g.total, g.rows.map((r) => [r.service, r.amount])])).toEqual([
      ['Monthly', 'SAR 15,000 /mo', [['Payroll', 'SAR 9,000 /mo'], ['PRO', 'SAR 6,000 /mo']]],
      ['Per person per month', null, [['Workforce', '20 × SAR 450 per person /mo']]],
      ['Per hire', null, [['Recruitment', '12% of the annual package']]],
      ['One-time', null, [['Company Constitution', 'SAR 55,000']]],
    ]);
    expect(groups[0].rows[1].detail).toBe('Up to 25 employees');
    expect(groups[2].rows[0].rates).toEqual([{ label: 'Managers', value: '12%' }, { label: 'Staff', value: '9%' }]);
  });
  it('no lines, no groups', () => {
    expect(feeGroups([], cardFor, 'SAR')).toEqual([]);
    expect(feeGroups(undefined, cardFor, 'SAR')).toEqual([]);
  });
});
