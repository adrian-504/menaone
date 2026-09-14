import { describe, it, expect } from 'vitest';
import { rowKind, rowPresets, defaultRates, trancheInvoice, lineValue, presetFor, parseRange, singleRange, checkPrice } from './pricing';
import type { PricingService } from './constants';

const admin: PricingService = {
  name: 'Administration & PRO', cat: 'Administration & PRO', hasTranches: true, showBands: 3,
  tranches: [
    { label: '1–5 employees', noCommMin: 1750, noCommMax: 2000, commMin: 2250, commMax: 2500 },
    { label: '6–15 employees', noCommMin: 3300, noCommMax: 3750, commMin: 4425, commMax: 4875 },
    { label: '16–25 employees', noCommMin: 4625, noCommMax: 5000, commMin: 5875, commMax: 6125 },
    { label: '26–50 employees', noCommMin: 8250, noCommMax: 8750, commMin: 9750, commMax: 11000 },
    { label: '51–75 employees', noCommMin: 10500, noCommMax: 11250, commMin: null, commMax: null },
  ],
};
const workforce: PricingService = {
  name: 'Workforce Services', cat: 'Workforce Services', hasTranches: true, perPerson: true,
  tranches: [
    { label: 'Nationalized (Engineers & Managers)', noCommMin: 3250, noCommMax: 3550, commMin: 3650, commMax: 3850 },
    { label: 'Nationalized (Technicians & Supervisors)', noCommMin: 2450, noCommMax: 2650, commMin: 2750, commMax: 2950 },
    { label: 'Non-Nationalized (Unskilled)', noCommMin: 1350, noCommMax: 1650, commMin: 1700, commMax: 1850 },
  ],
};
const accountancy: PricingService = {
  name: 'Accountancy & VAT', cat: 'Accountancy & VAT', hasPackages: true, packages: [{ name: 'x', min: 1, max: 2 }],
  rows: [
    { label: 'Accountancy (No Projects)', min: 2250, standard: 2250, max: 2750, counts: true },
    { label: 'Accountancy (Projects)', min: 4750, standard: 4750, max: 6250 },
  ],
};
const recruitment: PricingService = { name: 'Recruitment', cat: '', rows: [{ label: 'Professional Staff', min: 9, standard: 10, max: 12, percent: true }, { label: 'Blue Collar Staff', min: 9, standard: 10, max: 12, percent: true }] };
const constitution: PricingService = { name: 'Company Constitution', cat: '', oneTime: true, noCommMin: 45000, standard: 55000, noCommMax: 66000, commMin: 70000, commMax: 75000 };

describe('pricing rows', () => {
  it('knows how each service is priced', () => {
    expect([admin, workforce, accountancy, recruitment, { name: 'Mobilization', cat: '', perCountry: true }, constitution].map(rowKind)).toEqual(['tranche', 'category', 'row', 'percent', 'country', null]);
    expect(parseRange('Tranche 1 – PRO Services (25 Employees and Below)')).toEqual({ from: 1, to: 25 });
    expect(rowPresets(admin, true).map((p) => p.label)).not.toContain('51–75 employees');
  });

  it('starts new lines with the rows the team usually quotes', () => {
    expect(defaultRates(admin).map((r) => [r.label, r.price])).toEqual([['1–5 employees', 1900], ['6–15 employees', 3550], ['16–25 employees', 4800]]);
    expect(defaultRates(admin, false, 30).map((r) => r.to)).toEqual([25, 50, 75]);
    expect(defaultRates(workforce)).toHaveLength(3);
    expect(defaultRates(accountancy).map((r) => r.counts)).toEqual([true, false]);
    expect(defaultRates(recruitment)).toEqual([{ label: 'Professional Staff', from: null, to: null, price: null, percent: 10, counts: false }]);
    expect(defaultRates({ name: 'Mobilization', cat: '', perCountry: true })).toEqual([{ label: '', price: null, counts: false }]);
  });

  it('invoices tranches cumulatively', () => {
    const rates = [{ label: 'a', from: 1, to: 5, price: 2000 }, { label: 'b', from: 6, to: 15, price: 3000 }, { label: 'c', from: 16, to: 25, price: 5000 }];
    expect(trancheInvoice(rates, 3)).toBe(2000);
    expect(trancheInvoice(rates, 9)).toBe(2800);
    expect(trancheInvoice(rates, 15)).toBe(4000);
    expect(trancheInvoice(rates, 16)).toBe(4200);
    expect(trancheInvoice(rates, 19)).toBe(4800);
    expect(trancheInvoice(rates, 30)).toBe(4000 + 200 * 10 + 200 * 5);
  });

  it('works out the value a line adds to totals', () => {
    const rates = defaultRates(admin);
    expect(lineValue({ rates, employeeCount: null, unitPrice: null, quantity: 1 }, admin)).toEqual({ value: 1900, basis: 'minimum' });
    expect(lineValue({ rates, employeeCount: 9, unitPrice: null, quantity: 1 }, admin).basis).toBe('employees');
    expect(lineValue({ rates: defaultRates(workforce), employeeCount: null, unitPrice: 3000, quantity: 1 }, workforce)).toEqual({ value: null, basis: 'rates' });
    expect(lineValue({ rates: defaultRates(accountancy), employeeCount: null, unitPrice: null, quantity: 1 }, accountancy)).toEqual({ value: 2250, basis: 'rows' });
    expect(lineValue({ rates: [], employeeCount: null, unitPrice: 7500, quantity: 1 }, null)).toEqual({ value: 7500, basis: 'price' });
  });

  it('matches rows to their preset and checks single ranges', () => {
    const presets = rowPresets(admin);
    expect(presetFor(presets, { label: 'Tranche 2 (6–15 employees)', from: 6, to: 15 })?.standard).toBe(3550);
    expect(presetFor(rowPresets(accountancy), { label: 'accountancy (projects)' })?.max).toBe(6250);
    expect(singleRange(constitution)).toEqual({ label: '', min: 45000, standard: 55000, max: 66000, unit: 'one_time' });
    expect(singleRange(admin)).toBeNull();
    expect(checkPrice(singleRange(constitution), 70000)).toBe('above');
  });
});
