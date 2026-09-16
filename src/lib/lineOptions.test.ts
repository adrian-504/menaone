// @vitest-environment jsdom
// GOSI on Payroll and VAT on Accountancy are options on the line, not separate
// services: switching one changes the name the client reads on the proposal.
import { describe, it, expect, beforeEach } from 'vitest';
import { S } from './state';
import { renderLinesEditor, linesEdit } from './linesEditor';
import type { CommercialLine } from './types';

const line = (id: number, serviceName: string): CommercialLine =>
  ({ id, serviceId: null, serviceName, description: null, billing: 'monthly', quantity: 1, unitPrice: 1000, commission: false, sortOrder: id, rates: [], employeeCount: null, withRecruitment: false }) as CommercialLine;

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
    expect(html).toContain('Includes VAT');
    expect(html.match(/Includes (GOSI|VAT)/g)).toHaveLength(2); // not on Recruitment
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

  it('switching VAT on renames Accountancy the same way', () => {
    linesEdit('test', 2, 'serviceOption', '1');
    expect(lines.find((l) => l.id === 2)!.serviceName).toBe('Accountancy and VAT');
  });
});
