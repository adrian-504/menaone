import { describe, it, expect } from 'vitest';
import { proposalSentDate } from './commercial';
import { applyRevisionRequest, applyRevisionSent, draftingSince, lineWasNote, openRevision, parseSnapshot, removedServices, revisionDiff, revisionFact } from './revisions';
import { lastTouch } from './followup';
import { buildAttention, type MyDayInput } from './myday';
import { threadStand } from './companyBrief';
import { engagementThread } from './workGraph';
import type { CommercialLine, Proposal } from './types';

const line = (serviceName: string, unitPrice: number | null, quantity = 1, billing: CommercialLine['billing'] = 'monthly'): CommercialLine => ({
  id: serviceName.length, serviceId: null, serviceName, description: null, billing, quantity, unitPrice, commission: false, sortOrder: 0,
});
const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: 7, client: 'Contoso Test', type: 'Payroll', status: 'Sent to Client', sentDate: '2026-09-10', dblSignedDate: null, kickoffDate: null, finance: null,
  hubspot: null, owner: null, remarks: null, dateAdded: '2026-09-01', monthlyFee: 7000, contractMonths: 12, winLossReason: null, docLink: null,
  archived: false, archivedAt: null, snoozedUntil: null, dateSentToHassan: null, dateSentToClient: '2026-09-10', dateSigned: null, notes: [],
  reviewStatus: 'approved', reviewedAt: '2026-09-09', reviewNote: 'Fine', lines: [line('Payroll', 7000), line('Recruitment', 3000, 1, 'one_time')], ...over,
});

describe('the latest send', () => {
  it('is the latest revision sent, else the first send, else the old sent date', () => {
    expect(proposalSentDate({ lastSentAt: '2026-09-25', dateSentToClient: '2026-09-10', sentDate: '2026-09-10' })).toBe('2026-09-25');
    expect(proposalSentDate({ lastSentAt: null, dateSentToClient: '2026-09-10', sentDate: '2026-09-01' })).toBe('2026-09-10');
    expect(proposalSentDate({ lastSentAt: null, dateSentToClient: null, sentDate: '2026-09-01' })).toBe('2026-09-01');
    expect(proposalSentDate({ dateSentToClient: null, sentDate: null })).toBeNull();
  });
});

describe('starting and sending a revision', () => {
  it('records what they asked for and the commercials before, back to drafting with the review cleared', () => {
    const p = proposal();
    const row = applyRevisionRequest(p, { id: 3, reason: ' Price on three people ', contactId: 12, today: '2026-09-20' });
    expect(row).toMatchObject({ id: 3, number: 2, requestedAt: '2026-09-20', requestedByContactId: 12, reason: 'Price on three people', sentAt: null });
    expect(parseSnapshot(row.linesBeforeJson)).toMatchObject({ contractMonths: 12, monthlyFee: 7000, lines: [{ serviceName: 'Payroll', unitPrice: 7000 }, { serviceName: 'Recruitment' }] });
    expect(p).toMatchObject({ revision: 2, status: 'Drafting', reviewStatus: null, reviewedAt: null, reviewNote: null, dateSentToClient: '2026-09-10' });
    expect(openRevision(p)?.number).toBe(2);
    // A second request is number 3.
    applyRevisionSent(p, '2026-09-25');
    expect(applyRevisionRequest(p, { id: 4, reason: 'Add GOSI', contactId: null, today: '2026-09-27' }).number).toBe(3);
  });

  it('sending it sets the latest send and that revision, not the first send', () => {
    const p = proposal();
    expect(applyRevisionSent(p, '2026-09-25')).toBeNull();
    applyRevisionRequest(p, { id: 3, reason: 'Price', contactId: null, today: '2026-09-20' });
    expect(applyRevisionSent(p, '2026-09-25')?.number).toBe(2);
    expect(p).toMatchObject({ lastSentAt: '2026-09-25', dateSentToClient: '2026-09-10' });
    expect(p.revisions![0].sentAt).toBe('2026-09-25');
    expect(openRevision(p)).toBeNull();
  });

  it('the header fact says the revision and the sends', () => {
    const p = proposal();
    expect(revisionFact(p)).toBeNull();
    applyRevisionRequest(p, { id: 3, reason: 'Price', contactId: null, today: '2026-09-20' });
    expect(revisionFact(p)).toBe('Revision 2 · first sent 10 Sept');
    applyRevisionSent(p, '2026-09-25');
    expect(revisionFact(p)).toBe('Revision 2 · sent 25 Sept · first sent 10 Sept');
  });
});

describe('what a revision changed', () => {
  const before = { lines: [line('Payroll', 7000, 4), line('Recruitment', 3000, 1, 'one_time'), line('PRO', 1500)], contractMonths: 12, monthlyFee: null, oneTimeFee: null };

  it('lists added, removed and changed services, and the term', () => {
    const after = [line('Payroll', 6500, 3), line('PRO', 1500), line('GOSI', 800)];
    expect(revisionDiff(before, { lines: after, contractMonths: 6 })).toEqual({
      lines: [
        { kind: 'changed', service: 'Payroll', price: [7000, 6500], quantity: [4, 3] },
        { kind: 'added', service: 'GOSI' },
        { kind: 'removed', service: 'Recruitment' },
      ],
      term: [12, 6],
    });
    expect(revisionDiff(before, { lines: before.lines, contractMonths: 12 })).toEqual({ lines: [] });
  });

  it('writes the "was" line under a changed service, nothing under an unchanged one', () => {
    expect(lineWasNote(line('Payroll', 6500, 4), before, 'SAR')).toBe('was SAR 7,000 / month');
    expect(lineWasNote(line('Payroll', 7000, 3), before, 'SAR')).toBe('was 4 × SAR 7,000 / month');
    expect(lineWasNote(line('Recruitment', 3500, 1, 'one_time'), before, 'SAR')).toBe('was SAR 3,000 one-time');
    expect(lineWasNote(line('PRO', 1500), before, 'SAR')).toBeNull();
    expect(lineWasNote(line('GOSI', 800), before, 'SAR')).toBe('New in this revision');
    expect(removedServices(before, [line('Payroll', 7000)])).toEqual(['Recruitment', 'PRO']);
  });
});

describe('drafting a revision', () => {
  it('counts from the client\'s request, in My Day and Clean-up', () => {
    const p = proposal({ dateAdded: '2026-08-01' });
    applyRevisionRequest(p, { id: 3, reason: 'Price', contactId: null, today: '2026-09-28' });
    expect(draftingSince(p)).toBe('2026-09-28');
    const input: MyDayInput = {
      today: '2026-09-30', now: new Date('2026-09-30T11:00:00'), proposals: [p], opportunities: [], pipelineFacts: [], agreements: [], meetings: [],
      todos: [], projects: [], emails: [], inboxCount: 0, reviewerName: () => 'Reviewer', ownDomains: new Set(), snoozed: {},
    };
    expect(buildAttention(input).some((a) => a.key === 'proposal:7:drafting')).toBe(false);
    const later = buildAttention({ ...input, today: '2026-10-09', now: new Date('2026-10-09T11:00:00') }).find((a) => a.key === 'proposal:7:drafting');
    expect(later?.reason).toBe('Revision 2 in drafting · Payroll');
  });
});

describe('follow-up counts from the latest send', () => {
  const revised = proposal({ revision: 2, lastSentAt: '2026-09-25', revisions: [{ id: 1, number: 2, requestedAt: '2026-09-20', requestedByContactId: null, reason: 'Price', linesBeforeJson: '{"lines":[]}', sentAt: '2026-09-25' }] });

  it('lastTouch starts at the revision sent, so older notes no longer count', () => {
    const p = { ...revised, notes: [{ id: 1, date: '2026-09-15', text: 'Called' }] };
    expect(lastTouch(p, { emails: [], meetings: [], today: '2026-09-30' })).toEqual({ date: '2026-09-25', kind: 'sent', days: 5 });
  });

  it('My Day does not ask to follow up on a revision sent five days ago', () => {
    const input = (p: Proposal): MyDayInput => ({
      today: '2026-09-30', now: new Date('2026-09-30T11:00:00'), proposals: [p], opportunities: [], pipelineFacts: [], agreements: [], meetings: [],
      todos: [], projects: [], emails: [], inboxCount: 0, reviewerName: () => 'Reviewer', ownDomains: new Set(), snoozed: {},
    });
    expect(buildAttention(input(proposal())).some((a) => a.key === 'proposal:7:followup')).toBe(true);
    expect(buildAttention(input(revised)).some((a) => a.key === 'proposal:7:followup')).toBe(false);
  });

  it('the company thread says which revision went out and when', () => {
    const data = { proposals: [revised], opportunities: [], agreements: [], projects: [], meetings: [], todos: [], commitments: [] } as never;
    const t = engagementThread({ kind: 'proposal', id: 7 }, data, '2026-09-30');
    expect(t.nodes[t.nodes.length - 1]).toMatchObject({ dateLabel: 'Rev 2 sent', date: '2026-09-25' });
    expect(threadStand(t, '2026-09-30')).toBe('proposal revision 2 sent 5 days ago');
  });
});
