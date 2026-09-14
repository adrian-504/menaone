import { describe, it, expect } from 'vitest';
import { buildCleanupQueues, totalToClean, type CleanupInput } from './cleanup';
import type { Agreement, Company, Opportunity, Proposal, Todo } from './types';

const proposal = (over: Partial<Proposal>): Proposal => ({
  id: 1, client: 'Co', type: 'Payroll', status: 'Sent to Client', sentDate: null, dblSignedDate: null, kickoffDate: null, finance: null, hubspot: null,
  owner: null, remarks: null, dateAdded: null, monthlyFee: 5000, contractMonths: null, winLossReason: null, docLink: null, archived: false,
  archivedAt: null, snoozedUntil: null, dateSentToHassan: null, dateSentToClient: null, dateSigned: null, notes: [], ...over,
});
const agreement = (over: Partial<Agreement>): Agreement => ({
  id: 1, agrRef: 'AGR-1', client: 'Co', type: null, status: 'Filed', preparedBy: null, datePrepared: null, dateSentToClient: null, dateClientSigned: null,
  dateMenaSigned: null, dateFiled: null, monthlyFee: null, contractMonths: null, proposalId: null, hubspot: null, docLink: null, actionDate: null,
  remarks: null, createdAt: null, ...over,
});
const opp = (over: Partial<Opportunity>): Opportunity => ({
  id: 1, name: 'Deal', companyId: 1, companyName: 'Co', owner: null, stage: 'Lead', status: 'Open', estimatedValue: null, currency: 'SAR',
  probability: null, expectedCloseDate: null, description: null, nextAction: null, proposalId: null, projectId: null, sortOrder: null,
  archived: false, createdAt: '2026-08-01', updatedAt: null, tags: [], ...over,
});
const company = (id: number, over: Partial<Company> = {}): Company => ({
  id, name: `Co ${id}`, legalName: null, industries: [], website: null, country: null, city: null, companyType: null, status: null, owner: null, description: null, archived: false, createdAt: null, updatedAt: null, ...over,
});
const todo = (over: Partial<Todo>): Todo => ({
  id: 1, title: 'Task', type: 'general', client: null, priority: 'Medium', dueDate: null, status: 'Pending', description: null, createdAt: '2026-01-01',
  completedAt: null, projectId: null, parentId: null, areaId: null, section: null, sortOrder: null, recurrenceRule: null, tags: [], meetingId: null, ...over,
});
const input = (over: Partial<CleanupInput>): CleanupInput => ({
  today: '2026-09-14', proposals: [], agreements: [], opportunities: [], companies: [], todos: [], companiesWithIndustry: new Set(), kept: {}, ...over,
});
const queue = (qs: ReturnType<typeof buildCleanupQueues>, id: string) => qs.find((q) => q.id === id)!;

describe('clean-up queues', () => {
  it('finds stale proposals, oldest first, and honours snoozes and keeps', () => {
    const qs = buildCleanupQueues(input({
      proposals: [
        proposal({ id: 1, dateSentToClient: '2026-07-01' }),
        proposal({ id: 2, dateSentToClient: '2026-03-01' }),
        proposal({ id: 3, dateSentToClient: '2026-09-01' }),
        proposal({ id: 4, dateSentToClient: '2026-03-01', snoozedUntil: '2026-10-01' }),
        proposal({ id: 5, status: 'Signed by Client', dateSigned: '2025-06-01' }),
        proposal({ id: 6, status: 'In Internal Review', reviewRequestedAt: '2026-07-22', reviewStatus: 'pending' }),
        proposal({ id: 7, status: 'Drafting', dateAdded: '2026-07-01' }),
      ],
      kept: { 'stale-sent|proposal:1': '2026-10-14' },
    }));
    expect(queue(qs, 'stale-sent').items.map((x) => x.record.id)).toEqual([2]);
    expect(queue(qs, 'client-signed').items.map((x) => x.record.id)).toEqual([5]);
    expect(queue(qs, 'long-review').items.map((x) => x.record.id)).toEqual([6]);
    expect(queue(qs, 'stale-drafting').items.map((x) => x.record.id)).toEqual([7]);
    expect(queue(qs, 'stale-sent').items[0].facts[1]).toEqual(['Sent', '1 Mar 2026 (197 days ago)']);
  });

  it('covers agreements, opportunities, companies and tasks', () => {
    const qs = buildCleanupQueues(input({
      agreements: [
        agreement({ id: 1, serviceStatus: 'Kickoff scheduled', startDate: '2025-08-05' }),
        agreement({ id: 2, serviceStatus: 'Active', endDate: '2026-08-01' }),
        agreement({ id: 3, serviceStatus: 'Active', endDate: '2026-09-10' }),
      ],
      opportunities: [opp({ id: 1 }), opp({ id: 2, estimatedValue: 1, nextAction: 'Call', expectedCloseDate: '2026-10-01' })],
      companies: [company(1), company(2, { owner: 'Ahmad' }), company(3, { archived: true })],
      companiesWithIndustry: new Set([2]),
      todos: [todo({ id: 1 }), todo({ id: 2, createdAt: '2026-09-01' }), todo({ id: 3, dueDate: '2026-07-01' }), todo({ id: 4, someday: true })],
    }));
    expect(queue(qs, 'kickoff-passed').items.map((x) => x.record.id)).toEqual([1]);
    expect(queue(qs, 'ended-still-active').items.map((x) => x.record.id)).toEqual([2]);
    expect(queue(qs, 'opportunity-incomplete').items[0].facts[0]).toEqual(['Missing', 'value, next step, close date']);
    expect(queue(qs, 'company-industry').items.map((x) => x.record.id)).toEqual([1]);
    expect(queue(qs, 'company-owner').items.map((x) => x.record.id)).toEqual([1]);
    expect(queue(qs, 'old-tasks').items.map((x) => x.record.id)).toEqual([1, 3]);
    expect(totalToClean(qs)).toBe(7);
  });
});
