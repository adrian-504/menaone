import { describe, it, expect } from 'vitest';
import { LINE_UNITS, customPrice, customPriceText, isCustomLine, normalizeCustomLine, unitCounts } from './customLine';
import { lineTotals } from './commercial';
import type { CommercialLine, LineUnit } from './types';

const line = (over: Partial<CommercialLine>): CommercialLine => ({ id: 1, serviceId: null, serviceName: 'Site supervision', description: 'Scope', billing: 'monthly', quantity: 1, unitPrice: 4000, commission: false, sortOrder: 0, ...over });

describe('a custom line: its unit decides its billing', () => {
  it('the five units, in the order they are offered', () => {
    expect(LINE_UNITS.map(([u, label]) => `${u}: ${label}`)).toEqual([
      'per_month: Per month', 'per_person_per_month: Per person per month', 'per_visa: Per visa', 'one_time: One-time', 'percent_of_annual_package: % of annual package',
    ]);
  });

  it('per month is monthly and one-time is one-time, whatever billing it came with; the amount counts', () => {
    expect(normalizeCustomLine(line({ unit: 'per_month', billing: 'one_time' }))).toMatchObject({ billing: 'monthly', unitPrice: 4000 });
    expect(normalizeCustomLine(line({ unit: 'one_time', billing: 'monthly', unitPrice: 9000 }))).toMatchObject({ billing: 'one_time', unitPrice: 9000 });
    expect([unitCounts('per_month'), unitCounts('one_time'), unitCounts('per_visa'), unitCounts(null)]).toEqual([true, true, false, false]);
  });

  it('the other three are not a sum: the price moves to the priced row and no total can count it', () => {
    const cases: [LineUnit, string, object][] = [
      ['per_person_per_month', 'monthly', { label: 'Per person per month', price: 150 }],
      ['per_visa', 'one_time', { label: 'Per visa', price: 150 }],
      ['percent_of_annual_package', 'one_time', { label: '% of annual package', percent: 150 }],
    ];
    for (const [unit, billing, row] of cases) {
      const n = normalizeCustomLine(line({ unit, billing: unit === 'per_person_per_month' ? 'one_time' : 'monthly', unitPrice: 150, quantity: 3 }));
      expect([n.unit, n.billing, n.unitPrice, n.quantity, n.rates]).toEqual([unit, billing, null, 1, [row]]);
      expect(customPrice(n)).toBe(150);
      // A second pass changes nothing.
      expect(normalizeCustomLine(n)).toEqual(n);
    }
    const lines = [line({ id: 1, unit: 'per_month', unitPrice: 4000 }), line({ id: 2, unit: 'one_time', unitPrice: 9000 }), line({ id: 3, unit: 'per_person_per_month', unitPrice: 150 }),
      line({ id: 4, unit: 'per_visa', unitPrice: 1200 }), line({ id: 5, unit: 'percent_of_annual_package', unitPrice: 12 }), line({ id: 6, unit: undefined, unitPrice: 3000, quantity: 2 })].map(normalizeCustomLine);
    const t = lineTotals(lines, 12);
    expect([t.monthly, t.oneTime]).toEqual([10000, 9000]);
  });

  it('a catalogue line is left exactly as it is; a unit it does not know is dropped', () => {
    const catalogue = line({ serviceId: 15, unit: undefined, rates: [{ label: 'Engineers', price: 500 }] });
    expect(normalizeCustomLine(catalogue)).toBe(catalogue);
    expect(isCustomLine(catalogue)).toBe(false);
    expect(normalizeCustomLine(line({ unit: 'per_fortnight' as never })).unit).toBeNull();
  });

  it('reads as its price and unit', () => {
    const sar = (n: number) => `SAR ${n.toLocaleString('en-US')}`;
    expect(customPriceText(normalizeCustomLine(line({ unit: 'per_month' })), sar)).toBe('SAR 4,000 per month');
    expect(customPriceText(normalizeCustomLine(line({ unit: 'per_person_per_month', unitPrice: 150 })), sar)).toBe('SAR 150 per person per month');
    expect(customPriceText(normalizeCustomLine(line({ unit: 'percent_of_annual_package', unitPrice: 12 })), sar)).toBe('12% of annual package');
    expect(customPriceText(normalizeCustomLine(line({ unit: 'per_visa', unitPrice: null })), sar)).toBe('per visa');
    expect(customPriceText(line({ unit: undefined }), sar)).toBe('');
  });
});
