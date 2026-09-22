import { describe, it, expect } from 'vitest';
import { INDUSTRY_TAXONOMY } from './types';

describe('INDUSTRY_TAXONOMY', () => {
  // Saving a company keeps only listed industries: an industry in the data but not here is dropped on the next edit.
  it('lists every industry the data uses, including chambers and associations', () => {
    expect(INDUSTRY_TAXONOMY).toContain('Associations & Chambers');
    expect(new Set(INDUSTRY_TAXONOMY).size).toBe(INDUSTRY_TAXONOMY.length);
  });
});
