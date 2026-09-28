// @vitest-environment jsdom
// GOSI on Payroll is an option on the line, not a separate service: switching it
// changes the name the client reads. Accountancy has none since 28-Sep (VAT is in both packages).
import { describe, it, expect, beforeEach } from 'vitest';
import { S } from './state';
import { renderLinesEditor, linesEdit } from './linesEditor';
import type { CommercialLine } from './types';

const line = (id: number, serviceName: string): CommercialLine =>
  ({ id, serviceId: null, serviceName, description: null, billing: 'monthly', quantity: 1, unitPrice: 1000, commission: false, sortOrder: id, rates: [], employeeCount: null }) as CommercialLine;

describe('service options on a proposal line', () => {
  let lines: CommercialLine[];
  beforeEach(() => {
    document.body.innerHTML = '<div id="lines-host"></div>';
    lines = [line(1, 'Payroll and GOSI'), line(2, 'Accountancy'), line(3, 'Recruitment')];
    S.services = [];
    S.rateCards = [];
    renderLinesEditor('test', 'lines-host', {
      lines: () => lines,
      setLines: (next) => { lines = next; },
      currency: () => 'SAR',
      contractMonths: () => 12,
      editable: true,
      onChange: () => {},
    });
  });

  it('offers the option only on the services that have one', () => {
    const html = document.getElementById('lines-host')!.innerHTML;
    expect(html).toContain('Includes GOSI');
    expect(html).not.toContain('Includes VAT'); // Accountancy: VAT is in both packages
    expect(html.match(/Includes (GOSI|VAT)/g)).toHaveLength(1); // not on Recruitment either
  });

  it('is on by default when the line was written with it', () => {
    const html = document.getElementById('lines-host')!.innerHTML;
    const gosiBlock = html.slice(html.indexOf('Includes GOSI') - 200, html.indexOf('Includes GOSI'));
    expect(gosiBlock).toContain('checked');
  });

  it('switching it off renames the line to what the client reads', () => {
    linesEdit('test', 1, 'serviceOption', '');
    expect(lines.find((l) => l.id === 1)!.serviceName).toBe('Payroll');
    linesEdit('test', 1, 'serviceOption', '1');
    expect(lines.find((l) => l.id === 1)!.serviceName).toBe('Payroll and GOSI');
  });

  it('leaves an Accountancy line as it is', () => {
    linesEdit('test', 2, 'serviceOption', '1');
    expect(lines.find((l) => l.id === 2)!.serviceName).toBe('Accountancy');
  });
});
