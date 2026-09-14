// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { S } from '../lib/state';
import { genAgrRef } from './agreements';
import type { Agreement } from '../lib/types';

const agreement = (id: number, agrRef: string): Agreement => ({
  id, agrRef, client: 'Acme Test Co', type: 'Workforce', status: 'Signed', preparedBy: null, datePrepared: null,
  dateSentToClient: null, dateClientSigned: null, dateMenaSigned: null, dateFiled: null, monthlyFee: null,
  contractMonths: null, proposalId: null, hubspot: null, docLink: null, actionDate: null, remarks: null, createdAt: null,
});

describe('agreement references', () => {
  beforeEach(() => { S.agreements = []; });

  it('starts at 001 with the month and year of the given date', () => {
    expect(genAgrRef('Acme Test Co', 'Workforce', '2026-09-10')).toBe('ACME_WF_001_0926');
  });

  it('follows the highest existing number, so a deleted agreement never frees up its reference', () => {
    S.agreements = [agreement(1, 'ACME_WF_001_0126'), agreement(3, 'ACME_WF_003_0526')];
    expect(genAgrRef('Acme Test Co', 'Workforce', '2026-09-10')).toBe('ACME_WF_004_0926');
  });

  it('numbers each service type separately', () => {
    S.agreements = [agreement(1, 'ACME_WF_002_0126')];
    expect(genAgrRef('Acme Test Co', 'Administration', '2026-09-10')).toBe('ACME_ADM_001_0926');
  });
});
