// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { breadcrumb, feeLine, fillLabel, fillList, slideGroups } from './studio';

describe('the studio in plain words', () => {
  it('a path is a breadcrumb from OneDrive, never a Unix path', () => {
    expect(breadcrumb('/Users/ahmad/Library/CloudStorage/OneDrive-MENABusinessInvestmentGroup/MENA BD 2026/Proposals/Acme Holdings')).toBe('OneDrive › MENA BD 2026 › Proposals › Acme Holdings');
    expect(breadcrumb('/Users/ahmad/Documents/Decks')).toBe('Home › Documents › Decks');
    expect(breadcrumb(null)).toBe('');
  });
  it('placeholders are named, never shown as keys', () => {
    expect(fillLabel('client_name')).toBe('Client name');
    expect(fillLabel('monthly_total')).toBe('Monthly fee');
    expect(fillLabel('line.unit_price')).toBe('Fee row unit price');
    expect(fillLabel('some_new_token')).toBe('Some new token');
    expect(fillList({ client_name: 'Acme', proposal_date: '14 September 2026', proposal_date_short: '14.09.2026', contact_name: '' }))
      .toEqual([{ label: 'Client name', value: 'Acme' }, { label: 'Date', value: '14 September 2026' }]);
  });
  it('an amount left as in the template names the slide and the amount', () => {
    expect(feeLine('Slide 9: SAR 3,500 — Fees breakdown')).toBe("Slide 9 · Fees breakdown keeps the template's amount (SAR 3,500) — check it in PowerPoint");
    expect(feeLine('Slide 4: SAR 12,000')).toBe("Slide 4 keeps the template's amount (SAR 12,000) — check it in PowerPoint");
    expect(feeLine('Slide 7: 15% of salary — a percentage; set it by hand')).toBe('Slide 7 · 15% of salary is a percentage — set it by hand in PowerPoint');
    expect(feeLine('something else')).toBe('something else');
  });
  it('slides group where the source template changes, numbered as they will be in the deck', () => {
    const slides = [
      { index: 1, title: 'Cover', reason: 'always', source: 'Payroll Template' },
      { index: 2, title: 'Agenda', reason: 'always', source: 'Payroll Template' },
      { index: 3, title: 'VAT scope', reason: 'VAT line', source: 'Accountancy & VAT Template' },
      { index: 4, title: 'VAT fees', reason: 'VAT line', source: 'Accountancy & VAT Template' },
    ];
    const g = slideGroups(slides, new Set([1, 3, 4]), 'Payroll Template', (n) => n.replace(/ Template$/, ''));
    expect(g.map((x) => x.label)).toEqual(['Standard', 'Accountancy & VAT']);
    expect(g.flatMap((x) => x.slides.map((s) => s.number))).toEqual(['01', '—', '02', '03']);
  });
});
