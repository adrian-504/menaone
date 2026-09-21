// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./registry', () => ({ refreshAll: vi.fn() }));
const calls: string[] = [];
vi.mock('./db', () => ({
  persist: async (_label: string, fn: () => Promise<unknown>) => { try { await fn(); } catch { /* toast in the real app */ } },
  persistReturning: async (_label: string, fn: () => Promise<unknown>) => { try { return await fn(); } catch { return undefined; } },
  saveCompanyNote: vi.fn(async (name: string, text: string) => { calls.push(`${name}=${text}`); }),
  saveNoteFolders: vi.fn(async (items: string[]) => { await new Promise((r) => setTimeout(r, items.length === 1 ? 20 : 0)); calls.push(`folders:${items.join('|')}`); }),
  saveContactLists: vi.fn(async () => {}),
  upsertProposals: vi.fn(async () => []), deleteProposals: vi.fn(), upsertContacts: vi.fn(async () => []), deleteContacts: vi.fn(),
  upsertAgreements: vi.fn(async () => []), deleteAgreements: vi.fn(), upsertTodos: vi.fn(async () => []), deleteTodos: vi.fn(),
  upsertCommitments: vi.fn(async () => []), deleteCommitments: vi.fn(),
  upsertNotes: vi.fn(async () => []), deleteNotes: vi.fn(), getCompanies: vi.fn(async () => []), saveProject: vi.fn(),
  saveMilestones: vi.fn(), saveOpportunity: vi.fn(), saveMeeting: vi.fn(), createCompany: vi.fn(),
}));

import { S } from './state';
import { markLoadedAsSaved, persistCompanyNotes, persistNoteFolders } from './persist';

describe('company notes and small lists', () => {
  beforeEach(() => {
    calls.length = 0;
    S.proposals = []; S.contacts = []; S.agreements = []; S.todos = []; S.notes = [];
    S.companyNotes = { 'Alpha Test Co': 'Prefers email', 'Beta Test Co': 'Call Sundays' };
    markLoadedAsSaved();
  });

  it('writes only the company whose notes changed, and clears removed notes', async () => {
    S.companyNotes['Alpha Test Co'] = 'Prefers email and WhatsApp';
    await persistCompanyNotes();
    expect(calls).toEqual(['Alpha Test Co=Prefers email and WhatsApp']);
    calls.length = 0;
    delete S.companyNotes['Beta Test Co'];
    await persistCompanyNotes();
    expect(calls).toEqual(['Beta Test Co=']);
    calls.length = 0;
    await persistCompanyNotes();
    expect(calls).toEqual([]);
  });

  it('keeps list saves in the order they were made', async () => {
    S.noteFolders = ['Only'];
    const first = persistNoteFolders();
    S.noteFolders = ['Only', 'Second'];
    const second = persistNoteFolders();
    await Promise.all([first, second]);
    expect(calls).toEqual(['folders:Only', 'folders:Only|Second']);
  });
});
