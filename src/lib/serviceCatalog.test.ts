import { describe, it, expect } from 'vitest';
import { pendingDecisions, decisionSummary, CATALOGUE_DECISIONS } from './serviceCatalog';
import type { Service } from './types';

const svc = (id: number, name: string, extra: Partial<Service> = {}): Service => ({
  id, name, category: null, description: null, agreementType: null, billing: 'monthly',
  defaultPrice: null, rateCardId: null, templateKey: null, active: true, sortOrder: null, mergedInto: null, ...extra,
});

describe('service catalogue decisions', () => {
  it('only offers what still applies to this catalogue', () => {
    const services = [svc(1, 'Company Constitution'), svc(2, 'Workforce'), svc(3, 'Payroll'), svc(4, 'Payroll and GOSI')];
    const pending = pendingDecisions(services);
    expect(pending.map((p) => p.from)).toEqual(['Company Constitution', 'Workforce', 'Payroll and GOSI']);
    expect(pending.find((p) => p.from === 'Payroll and GOSI')!.target!.id).toBe(3);
  });

  it('drops a decision once it has been carried out', () => {
    const renamed = [svc(1, 'Business Setup'), svc(2, 'Employer of Record')];
    expect(pendingDecisions(renamed)).toEqual([]);
    const merged = [svc(3, 'Payroll'), svc(4, 'Payroll and GOSI', { active: false, mergedInto: 3 })];
    expect(pendingDecisions(merged)).toEqual([]);
  });

  it('turns a rename into a merge when both names already exist', () => {
    const both = [svc(1, 'Company Constitution'), svc(2, 'Business Setup')];
    const [d] = pendingDecisions(both);
    expect(d.action).toBe('merge');
    expect(d.target!.id).toBe(2);
  });

  it('flags a merge whose target is missing rather than inventing one', () => {
    const [d] = pendingDecisions([svc(1, 'Company Constitution & Maintenance Package')]);
    expect(d.blocked).toBe(true);
    expect(decisionSummary(d)).toContain('not in the catalogue yet');
  });

  it('renames Admin PRO before PRO merges into it', () => {
    const rename = CATALOGUE_DECISIONS.findIndex((d) => d.from === 'Admin PRO');
    const merge = CATALOGUE_DECISIONS.findIndex((d) => d.from === 'PRO');
    expect(rename).toBeLessThan(merge);
  });

  it('leaves the two-services-in-one-line case to a human', () => {
    const [d] = pendingDecisions([svc(1, 'Admin PRO and Payroll')]);
    expect(d.action).toBe('review');
    expect(decisionSummary(d)).toContain('needs splitting');
  });
});
