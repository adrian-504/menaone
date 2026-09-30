// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = [];
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => {
    calls.push(cmd);
    if (cmd === 'company_dossier') {
      return { activity: [{ id: 1 }], noteEntries: [{ id: 2 }], links: [{ fromType: 'msfile', fromId: 5, toType: 'company', toId: 7 }], files: [{ path: '/x.pptx' }], emails: [{ id: 9 }] };
    }
    return [];
  }),
}));

import { primeCompanyDossier, getActivity, companyNoteEntries, getLinksFor, filesGetByIds, ms365GetEmailsByCompany } from './db';

beforeEach(() => { calls.length = 0; });

describe('the company page in one round trip', () => {
  it('every section takes its part from one call', async () => {
    primeCompanyDossier(7, 'Contoso Test');
    const [a1, a2, n, l, f, e] = await Promise.all([
      getActivity({ companyId: 7, limit: 400 }), getActivity({ companyId: 7, limit: 400 }),
      companyNoteEntries(7, 'Contoso Test'), getLinksFor('company', 7), filesGetByIds([5]), ms365GetEmailsByCompany(7),
    ]);
    expect(calls).toEqual(['company_dossier']);
    expect([a1.length, a2.length, n.length, l.length, f.length, e.length]).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('a later reload (an edit) or another company reads fresh', async () => {
    primeCompanyDossier(7, 'Contoso Test');
    await companyNoteEntries(7, 'Contoso Test');
    await companyNoteEntries(7, 'Contoso Test');
    await getLinksFor('company', 8);
    await filesGetByIds([6]);
    expect(calls).toEqual(['company_dossier', 'company_note_entries', 'get_links_for', 'files_get_by_ids']);
  });
});
