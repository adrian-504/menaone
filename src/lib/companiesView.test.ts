import { describe, expect, it } from 'vitest';
import { initialCompaniesView } from './companiesView';

describe('initialCompaniesView', () => {
  it('opens in List unless this device chose Grid', () => {
    expect(initialCompaniesView(null)).toBe('list');
    expect(initialCompaniesView(undefined)).toBe('list');
    expect(initialCompaniesView('table')).toBe('list');
    expect(initialCompaniesView('')).toBe('list');
    expect(initialCompaniesView('list')).toBe('list');
    expect(initialCompaniesView('grid')).toBe('grid');
  });
});
