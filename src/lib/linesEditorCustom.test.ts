// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { linesEdit, renderLinesEditor } from './linesEditor';
import { lineTotals } from './commercial';
import { cardLine } from './studio';
import type { CommercialLine } from './types';

let lines: CommercialLine[] = [];
const ctx = { lines: () => lines, setLines: (l: CommercialLine[]) => { lines = l; }, currency: () => 'SAR', contractMonths: () => 12, editable: true, onChange: () => {} };
const row = () => document.querySelector<HTMLTableRowElement>('#box tr.le-custom')!;

describe('a custom line in the lines editor (1.66)', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="box"></div>';
    lines = [{ id: 50, serviceId: 15, serviceName: 'Payroll', description: null, billing: 'monthly', quantity: 1, unitPrice: 4000, commission: false, sortOrder: 0 }];
    renderLinesEditor('t', 'box', ctx);
  });

  it('is added with a name to type, a unit, a price and a short scope', () => {
    expect(document.querySelector('#box .le-footer')!.textContent).toContain('Add custom line');
    linesEdit('t', 0, 'addCustom', '');
    expect(lines).toHaveLength(2);
    const id = lines[1].id;
    expect(lines[1]).toMatchObject({ serviceId: null, serviceName: '', unit: 'per_month', billing: 'monthly', unitPrice: null });
    expect(row().querySelector<HTMLInputElement>('.le-custom-name')!.placeholder).toBe('Name of the service');
    expect([...row().querySelectorAll('.le-billing-sel option')].map((o) => o.textContent)).toEqual(['Per month', 'Per person per month', 'Per visa', 'One-time', '% of annual package']);
    linesEdit('t', id, 'customName', '  Market study ');
    linesEdit('t', id, 'customPrice', '3000');
    linesEdit('t', id, 'description', 'Competitor review\nSalary benchmark');
    expect(lines[1]).toMatchObject({ serviceName: 'Market study', unitPrice: 3000, billing: 'monthly', description: 'Competitor review\nSalary benchmark' });
    // A monthly sum counts in the totals like any line.
    expect(lineTotals(lines, 12)).toMatchObject({ monthly: 7000, contractValue: 84000 });
    expect(row().querySelector('.le-amount')!.textContent).toBe('SAR 3,000');
    expect(row().querySelector<HTMLTextAreaElement>('.le-custom-scope')!.value).toBe('Competitor review\nSalary benchmark');
  });

  it('a unit that is not a sum keeps its price out of every total', () => {
    linesEdit('t', 0, 'addCustom', '');
    const id = lines[1].id;
    linesEdit('t', id, 'customName', 'Visa processing');
    linesEdit('t', id, 'customPrice', '1500');
    linesEdit('t', id, 'unit', 'per_visa');
    // The price moved to the line's one priced row; the unit price is empty, and the billing follows the unit.
    expect(lines[1]).toMatchObject({ unit: 'per_visa', billing: 'one_time', unitPrice: null, rates: [{ label: 'Per visa', price: 1500 }] });
    expect(lineTotals(lines, 12)).toMatchObject({ monthly: 4000, oneTime: null, contractValue: 48000 });
    expect(row().querySelector<HTMLInputElement>('.le-price')!.value).toBe('1500');
    expect(row().querySelector('.le-amount')!.textContent).toBe('SAR 1,500 per visa');
    expect(row().querySelector('.le-qty')).toBeNull();
    expect(cardLine(lines[1], 'SAR')).toBe('Visa processing · SAR 1,500 per visa');
    // A percentage, then back to a monthly sum: the figure follows the unit both ways.
    linesEdit('t', id, 'unit', 'percent_of_annual_package');
    linesEdit('t', id, 'customPrice', '12.5');
    expect(lines[1]).toMatchObject({ billing: 'one_time', unitPrice: null, rates: [{ label: '% of annual package', percent: 12.5 }] });
    expect(row().querySelector('.le-amount')!.textContent).toBe('12.5% of annual package');
    linesEdit('t', id, 'unit', 'per_month');
    expect(lines[1]).toMatchObject({ billing: 'monthly', unitPrice: 12.5, rates: [] });
    expect(lineTotals(lines, 12).monthly).toBe(4012.5);
  });

  it('reads plainly where the lines are not editable', () => {
    lines.push({ id: 51, serviceId: null, serviceName: 'Visa processing', description: 'Work visas\nFamily visas', billing: 'one_time', quantity: 1, unitPrice: null, commission: false, sortOrder: 1, unit: 'per_visa', rates: [{ label: 'Per visa', price: 1500 }] });
    renderLinesEditor('t', 'box', { ...ctx, editable: false });
    const cells = [...document.querySelectorAll('#box tbody tr')][1].querySelectorAll('td');
    expect(cells[0].querySelector('.le-service')!.textContent).toBe('Visa processing');
    expect([...cells[0].querySelectorAll('.le-desc-text')].map((d) => d.textContent)).toEqual(['Work visas', 'Family visas']);
    expect([...cells].slice(1).map((c) => c.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['Per visa', '—', 'SAR 1,500', '—']);
    expect(document.querySelector('#box .le-footer')!.textContent).not.toContain('Add custom line');
  });
});
