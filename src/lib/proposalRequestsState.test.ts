// @vitest-environment jsdom
// A `>>` promise to send a proposal, as the app receives it back from the
// backend: the request gets its services as fee lines (the create form's
// defaults), and only meetings and notes announce it (quick capture words its own).
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./ui', async (importOriginal) => ({ ...(await importOriginal<typeof import('./ui')>()), toast: vi.fn() }));
vi.mock('./db', () => {
  const ok = () => vi.fn(async () => {});
  const links = () => vi.fn(async (): Promise<{ id: number; companyId: number | null }[]> => []);
  return {
    persist: async (_label: string, fn: () => Promise<unknown>) => { try { await fn(); } catch { /* toast in the real app */ } },
    persistReturning: async (_label: string, fn: () => Promise<unknown>) => { try { return await fn(); } catch { return undefined; } },
    upsertProposals: links(), deleteProposals: ok(), upsertContacts: links(), deleteContacts: ok(),
    upsertAgreements: links(), deleteAgreements: ok(), upsertTodos: links(), deleteTodos: ok(),
    upsertCommitments: links(), deleteCommitments: ok(), commitmentsAdd: vi.fn(),
    upsertNotes: links(), deleteNotes: ok(), getCompanies: vi.fn(async () => []), saveNoteFolders: ok(), saveContactLists: ok(),
    saveCompanyNote: ok(), saveProject: ok(), saveMilestones: ok(), saveOpportunity: ok(), saveMeeting: ok(), createCompany: ok(),
  };
});

import * as db from './db';
import * as ui from './ui';
import { S } from './state';
import { markLoadedAsSaved } from './persist';
import { readCommitmentsFrom } from '../tabs/commitments';
import { EMPTY_CONTEXT } from './workGraph';
import type { Commitment, Proposal, Service } from './types';

const service = (id: number, name: string, defaultPrice: number): Service => ({ id, name, category: null, description: null, agreementType: null, billing: 'monthly',
  defaultPrice, rateCardId: null, templateKey: null, active: true, sortOrder: id, mergedInto: null });
const request = (over: Partial<Proposal> = {}): Proposal => ({ id: 30, client: 'Contoso Logistics', companyId: 7, type: 'Payroll', status: 'Proposal Request Received',
  sentDate: null, dblSignedDate: null, kickoffDate: null, finance: null, hubspot: null, owner: null, remarks: null, dateAdded: '2026-09-27', monthlyFee: null,
  contractMonths: null, winLossReason: null, docLink: null, archived: false, archivedAt: null, snoozedUntil: null, dateSentToHassan: null, dateSentToClient: null,
  dateSigned: null, notes: [], promisedBy: '2026-10-02', lines: [], documents: [], ...over });
const promise = (over: Partial<Commitment> = {}): Commitment => ({ id: 50, direction: 'ours', text: 'Proposal for Payroll', contactId: null, dueDate: '2026-10-02',
  status: 'open', closedAt: null, dropReason: null, companyId: 7, opportunityId: null, projectId: null, sourceType: 'meeting', sourceId: 3,
  sourceKey: 'proposal for payroll', todoId: null, proposalId: 30, createdAt: null, updatedAt: null, ...over });
const settle = () => new Promise((r) => setTimeout(r, 0));
const ctx = { ...EMPTY_CONTEXT, companyId: 7, companyName: 'Contoso Logistics', meetingId: 3 };

beforeEach(() => {
  S.proposals = []; S.commitments = []; S.todos = []; S.contacts = []; S.companies = []; S.meetings = []; S.notes = [];
  S.services = [service(1, 'Payroll', 1250), service(2, 'Recruitment', 0)];
  S.rateCards = [];
  markLoadedAsSaved();
  vi.clearAllMocks();
});

describe('a proposal request from a >> line', () => {
  it('gets a fee line for each service it names, with the catalogue default, and is saved', async () => {
    vi.mocked(db.commitmentsAdd).mockResolvedValue({ commitments: [promise()], tasks: [], proposals: [request()] });
    const added = await readCommitmentsFrom('meeting', 3, ['>> Proposal for Payroll by 2 Oct'], ctx);
    await settle();
    const p = S.proposals.find((x) => x.id === 30)!;
    expect((p.lines ?? []).map((l) => [l.serviceName, l.unitPrice])).toEqual([['Payroll', 1250]]);
    expect(p.type).toBe('Payroll');
    expect(added.proposals.map((x) => x.id)).toEqual([30]);
    expect(vi.mocked(db.upsertProposals)).toHaveBeenCalled();
    // The backend is asked for a request, with the lines the source has now.
    expect(vi.mocked(db.commitmentsAdd).mock.calls[0][0][0]).toMatchObject({ proposal: true, liveKeys: ['proposal for payroll'] });
  });

  it('a meeting announces it; quick capture leaves the wording to its caller', async () => {
    vi.mocked(db.commitmentsAdd).mockResolvedValue({ commitments: [promise()], tasks: [], proposals: [request()] });
    await readCommitmentsFrom('meeting', 3, ['>> Proposal for Payroll'], ctx);
    expect(vi.mocked(ui.toast)).toHaveBeenCalledTimes(1);
    vi.mocked(ui.toast).mockClear();
    S.proposals = [];
    vi.mocked(db.commitmentsAdd).mockResolvedValue({ commitments: [promise({ id: 51, sourceType: 'capture', sourceId: null })], tasks: [], proposals: [request({ id: 31 })] });
    const added = await readCommitmentsFrom('capture', null, ['>> Proposal for Payroll'], ctx);
    expect(vi.mocked(ui.toast)).not.toHaveBeenCalled();
    expect(added.proposals[0].id).toBe(31);
  });

  it('an edited line that joined its request brings the new date and services', async () => {
    S.proposals = [request({ lines: [] })];
    markLoadedAsSaved();
    // Existing request with a Payroll line already; the edit names Recruitment too.
    S.proposals[0].lines = [{ id: 1, serviceId: 1, serviceName: 'Payroll', description: null, billing: 'monthly', quantity: 1, unitPrice: 1250, commission: false, sortOrder: 0, rates: [], employeeCount: null }];
    vi.mocked(db.commitmentsAdd).mockResolvedValue({ commitments: [promise({ id: 52, text: 'Proposal for Payroll and Recruitment', sourceKey: 'proposal for payroll and recruitment' })], tasks: [],
      proposals: [request({ type: 'Payroll, Recruitment', promisedBy: '2026-10-05' })] });
    await readCommitmentsFrom('meeting', 3, ['>> Proposal for Payroll and Recruitment by 5 Oct'], ctx);
    const p = S.proposals.find((x) => x.id === 30)!;
    expect(S.proposals).toHaveLength(1);
    expect(p.promisedBy).toBe('2026-10-05');
    expect((p.lines ?? []).map((l) => l.serviceName)).toEqual(['Payroll', 'Recruitment']);
  });
});
