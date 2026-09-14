// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { S } from './state';
import { companyRef, inCompany, sameCompany } from './utils';

describe('matching records to companies', () => {
  it('matches by company id when both sides are linked, whatever the names say', () => {
    expect(sameCompany(3, 'Globex', 3, 'Globex Solutions')).toBe(true);
    expect(sameCompany(3, 'Globex', 4, 'Globex')).toBe(false);
  });

  it('falls back to the name only for a record not linked yet', () => {
    expect(sameCompany(null, 'Globex', 3, 'Globex')).toBe(true);
    expect(sameCompany(null, 'Globex', 3, 'Acme')).toBe(false);
    expect(sameCompany(null, null, null, null)).toBe(false);
  });

  it('resolves a company name to its canonical id', () => {
    S.companies = [{ id: 9, name: 'Acme Test Co' } as (typeof S.companies)[number]];
    const ref = companyRef('Acme Test Co');
    expect(ref.id).toBe(9);
    expect(inCompany(ref, 9, 'Old Acme name')).toBe(true);
    expect(inCompany(companyRef('Unknown Co'), null, 'Unknown Co')).toBe(true);
  });
});
