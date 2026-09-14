// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { S } from './state';
import { recordLink, companyLink, previewContent } from './links';

describe('record links', () => {
  beforeEach(() => {
    S.companies = [{ id: 7, name: 'Acme Test Co', industries: ['Logistics'], owner: 'Sam' } as (typeof S.companies)[number]];
    S.contacts = [];
    S.opportunities = [];
    S.proposals = [{ id: 3, client: 'Acme Test Co', companyId: 7, type: 'Workforce', status: 'Signed by Both Parties', monthlyFee: 12000 } as (typeof S.proposals)[number]];
    S.agreements = [{ id: 4, client: 'Acme Test Co', companyId: 7, status: 'Signed', serviceStatus: 'Active', currency: 'SAR', monthlyFee: 12000, lines: [] } as unknown as (typeof S.agreements)[number]];
  });

  it('renders an escaped link keyed by id, or plain text without a key', () => {
    const html = recordLink('project', 12, 'Payroll <phase 2>');
    expect(html).toContain('data-rkind="project"');
    expect(html).toContain('data-rid="12"');
    expect(html).toContain('Payroll &lt;phase 2&gt;');
    expect(recordLink('project', null, 'No key')).toBe('No key');
  });

  it('links a company by id when it has a Company record, by name otherwise', () => {
    expect(companyLink(null, 'Acme Test Co')).toContain('data-rid="7"');
    expect(companyLink(null, 'Unknown "Co"')).toContain('data-rname="Unknown &quot;Co&quot;"');
    expect(companyLink(5, null)).toBe('');
  });

  it('previews key facts, and nothing for a record that no longer exists', () => {
    const p = previewContent('company', 7);
    expect(p?.title).toBe('Acme Test Co');
    expect(p?.body).toContain('Logistics');
    expect(p?.body).toContain('SAR 12,000');
    expect(previewContent('project', 999)).toBeNull();
  });
});
