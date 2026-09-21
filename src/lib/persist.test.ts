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
    upsertCommitments: links(), deleteCommitments: ok(),
    upsertNotes: links(), deleteNotes: ok(), getCompanies: vi.fn(async () => [{ id: 7, name: 'Acme Test Co' }]), saveNoteFolders: ok(), saveContactLists: ok(),
    saveCompanyNote: ok(), saveProject: ok(), saveMilestones: ok(),
    saveOpportunity: ok(), saveMeeting: ok(), createCompany: ok(),
  };
});

import * as db from './db';
import { S } from './state';
import { markLoadedAsSaved, persistProposals, proposalsAndAgreementsSaved, persistTodos, persistCommitments, saveTodosNow } from './persist';
import type { Commitment, Proposal, Todo } from './types';

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

describe('a commitment and its task move together in memory', () => {
  const task = (over: Partial<Todo> = {}): Todo => ({ id: 5, title: 'Send the quote', type: 'general', client: null, priority: 'Medium', dueDate: '2026-09-24', status: 'Pending', description: null,
    createdAt: null, completedAt: null, projectId: null, parentId: null, areaId: null, section: null, sortOrder: null, recurrenceRule: null, tags: [], meetingId: null, ...over });
  const promise = (over: Partial<Commitment> = {}): Commitment => ({ id: 1, direction: 'ours', text: 'Send the quote', contactId: null, dueDate: '2026-09-24', status: 'open', closedAt: null,
    dropReason: null, companyId: null, opportunityId: null, projectId: null, sourceType: 'manual', sourceId: null, sourceKey: null, todoId: 5, createdAt: null, updatedAt: null, ...over });
  const settle = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    S.proposals = [];
    S.todos = [task()];
    S.commitments = [promise()];
    markLoadedAsSaved();
    vi.clearAllMocks();
  });

  it('completing the task keeps the commitment, and both are saved', async () => {
    S.todos[0].status = 'Done';
    persistTodos();
    await saveTodosNow(); await settle();
    expect(S.commitments[0].status).toBe('kept');
    expect(vi.mocked(db.upsertCommitments).mock.calls[0][0][0].status).toBe('kept');
  });

  it('marking the commitment kept completes the task; reopening reopens it', async () => {
    S.commitments[0].status = 'kept';
    persistCommitments();
    await settle();
    expect(S.todos[0].status).toBe('Done');
    S.commitments[0].status = 'open';
    persistCommitments();
    await settle();
    expect(S.todos[0].status).toBe('Pending');
  });

  it('a new due date on either one moves the other', async () => {
    S.todos[0].dueDate = '2026-09-30';
    persistTodos();
    expect(S.commitments[0].dueDate).toBe('2026-09-30');
    S.commitments[0].dueDate = '2026-10-02';
    persistCommitments();
    expect(S.todos[0].dueDate).toBe('2026-10-02');
  });

  it('deleting the task leaves the commitment open, without a task', () => {
    S.todos = [];
    persistTodos();
    expect(S.commitments[0]).toMatchObject({ status: 'open', todoId: null });
  });

  it('a dropped commitment leaves its task alone', () => {
    S.commitments[0].status = 'dropped';
    S.todos[0].status = 'Done';
    persistTodos();
    expect(S.commitments[0].status).toBe('dropped');
  });
});
