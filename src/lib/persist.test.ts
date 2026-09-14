// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./registry', () => ({ refreshAll: vi.fn() }));

vi.mock('./db', () => {
  const ok = () => vi.fn(async () => {});
  const links = () => vi.fn(async (): Promise<{ id: number; companyId: number | null }[]> => []);
  return {
    persist: async (_label: string, fn: () => Promise<unknown>) => { try { await fn(); } catch { /* toast in the real app */ } },
    persistReturning: async (_label: string, fn: () => Promise<unknown>) => { try { return await fn(); } catch { return undefined; } },
    upsertProposals: links(), deleteProposals: ok(), upsertContacts: links(), deleteContacts: ok(),
    upsertAgreements: links(), deleteAgreements: ok(), upsertTodos: links(), deleteTodos: ok(),
    upsertNotes: links(), deleteNotes: ok(), getCompanies: vi.fn(async () => [{ id: 7, name: 'Acme Test Co' }]), saveNoteFolders: ok(), saveContactLists: ok(),
    saveCompanyNotes: ok(), saveCompanyIndustries: ok(), saveProject: ok(), saveMilestones: ok(),
    saveOpportunity: ok(), saveMeeting: ok(), createCompany: ok(),
  };
});

import * as db from './db';
import { S } from './state';
import { markLoadedAsSaved, persistProposals, proposalsAndAgreementsSaved } from './persist';
import type { Proposal } from './types';

const proposal = (id: number, status = 'Proposal Request Received'): Proposal => ({
  id, client: 'Acme Test Co', type: 'Workforce', status, sentDate: null, dblSignedDate: null, kickoffDate: null,
  finance: null, hubspot: null, owner: null, remarks: null, dateAdded: null, monthlyFee: null, contractMonths: null,
  winLossReason: null, docLink: null, archived: false, archivedAt: null, snoozedUntil: null, dateSentToHassan: null,
  dateSentToClient: null, dateSigned: null, notes: [],
});

async function save(): Promise<void> {
  persistProposals();
  await proposalsAndAgreementsSaved();
}

describe('persisting only what changed', () => {
  beforeEach(() => {
    S.proposals = [proposal(1), proposal(2)];
    markLoadedAsSaved();
    vi.clearAllMocks();
  });

  it('writes nothing when nothing changed', async () => {
    await save();
    expect(db.upsertProposals).not.toHaveBeenCalled();
    expect(db.deleteProposals).not.toHaveBeenCalled();
  });

  it('sends only the edited record', async () => {
    S.proposals[1].status = 'Sent to Client';
    await save();
    expect(db.upsertProposals).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.upsertProposals).mock.calls[0][0].map((p) => p.id)).toEqual([2]);
    await save();
    expect(db.upsertProposals).toHaveBeenCalledTimes(1);
  });

  it('deletes records removed from the list and inserts new ones', async () => {
    S.proposals = S.proposals.filter((p) => p.id !== 1);
    S.proposals.push(proposal(3));
    await save();
    expect(db.deleteProposals).toHaveBeenCalledWith([1]);
    expect(vi.mocked(db.upsertProposals).mock.calls[0][0].map((p) => p.id)).toEqual([3]);
  });

  it('retries a failed save on the next one', async () => {
    vi.mocked(db.upsertProposals).mockRejectedValueOnce(new Error('disk busy'));
    S.proposals[0].remarks = 'call back Sunday';
    await save();
    await save();
    expect(db.upsertProposals).toHaveBeenCalledTimes(2);
    expect(vi.mocked(db.upsertProposals).mock.calls[1][0].map((p) => p.id)).toEqual([1]);
  });

  it('keeps saves in order when triggered back to back', async () => {
    S.proposals[0].status = 'Sent to Client';
    persistProposals();
    S.proposals[0].status = 'Signed by Both Parties';
    persistProposals();
    await proposalsAndAgreementsSaved();
    const sent = vi.mocked(db.upsertProposals).mock.calls.map((c) => c[0][0].status);
    expect(sent[sent.length - 1]).toBe('Signed by Both Parties');
  });

  it('adopts the company the backend linked, without re-saving the record', async () => {
    S.companies = [];
    vi.mocked(db.upsertProposals).mockResolvedValueOnce([{ id: 1, companyId: 7 }]);
    S.proposals[0].remarks = 'new client';
    await save();
    expect(S.proposals[0].companyId).toBe(7);
    expect(S.companies.map((c) => c.id)).toEqual([7]);
    await save();
    expect(db.upsertProposals).toHaveBeenCalledTimes(1);
  });
});
