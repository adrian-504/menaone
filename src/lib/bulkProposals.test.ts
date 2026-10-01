// Changing several proposals at once: what a status sets, the one date for the batch, shift-click ranges.
import { describe, expect, it } from 'vitest';

import { applyStatus, batchStartDate, BULK_STATUSES, rangeIds, statusDateLabel, statusNeedsDate, unreviewedNote } from './bulkProposals';
import { PS } from './commercial';
import type { Proposal } from './types';

const P = (over: Partial<Proposal> = {}): Proposal => ({
  id: 1, client: 'Sample Client', type: 'Payroll', status: 'In Internal Review', sentDate: null, dblSignedDate: null, kickoffDate: null, finance: null, hubspot: null, owner: 'Ahmad',
  remarks: null, dateAdded: '2026-09-01', monthlyFee: 5000, contractMonths: 12, winLossReason: null, docLink: null, archived: false, archivedAt: null, snoozedUntil: null,
  dateSentToHassan: '2026-09-05', dateSentToClient: null, dateSigned: null, notes: [], ...over,
});

describe('the statuses a batch can move to', () => {
  it('include Signed by Both Parties; three of them ask for a date', () => {
    expect(BULK_STATUSES).toContain('Signed by Both Parties');
    expect(BULK_STATUSES.filter(statusNeedsDate)).toEqual(['Sent to Client', 'Signed by Client', 'Signed by Both Parties']);
    expect(statusDateLabel('Sent to Client', 3)).toBe('The day they were sent to the client');
    expect(statusDateLabel('Signed by Both Parties', 1)).toBe('The day it was signed by both parties');
  });
});

describe('one date for the batch', () => {
  it('three proposals sent on the same back-dated day: each takes it as its sent date', () => {
    const batch = [P({ id: 1 }), P({ id: 2 }), P({ id: 3 })];
    batch.forEach((p) => applyStatus(p, 'Sent to Client', '2026-09-28', { explicit: true }));
    expect(batch.map((p) => [p.status, p.dateSentToClient, p.sentDate])).toEqual([1, 2, 3].map(() => ['Sent to Client', '2026-09-28', '2026-09-28']));
  });
  it('signed by both on one day: the signature date is that day for all, and the service is not started', () => {
    const batch = [P({ id: 1, status: 'Sent to Client', dateSentToClient: '2026-09-15' }), P({ id: 2, status: 'Signed by Client', dateSentToClient: '2026-09-15', dateSigned: '2026-09-20' })];
    batch.forEach((p) => applyStatus(p, 'Signed by Both Parties', '2026-09-22', { explicit: true }));
    expect(batch.map((p) => [p.status, p.dblSignedDate, p.dateSigned, p.serviceStartedAt ?? null])).toEqual([
      ['Signed by Both Parties', '2026-09-22', '2026-09-22', null],
      // The client's own signature date is kept.
      ['Signed by Both Parties', '2026-09-22', '2026-09-20', null],
    ]);
  });
  it('signed by the client: the chosen day replaces one already there; without a chosen day an existing date stays', () => {
    const a = P({ status: 'Sent to Client', dateSigned: '2026-09-18' });
    applyStatus(a, 'Signed by Client', '2026-09-20', { explicit: true });
    expect(a.dateSigned).toBe('2026-09-20');
    const b = P({ status: 'Sent to Client', dateSigned: '2026-09-18' });
    applyStatus(b, 'Signed by Client', '2026-10-01');
    expect(b.dateSigned).toBe('2026-09-18');
  });
});

describe('sending several without the review question', () => {
  const m = (status: string, reviewStatus: Proposal['reviewStatus'] = null) => ({ status, reviewStatus });
  it('the date question says how many have not been reviewed', () => {
    expect(unreviewedNote([m(PS.DRAFTING), m(PS.REVIEW, 'pending'), m(PS.REVIEW, 'approved')], PS.SENT)).toBe('2 of these haven’t been reviewed');
    expect(unreviewedNote([m(PS.DRAFTING), m(PS.REVIEW, 'approved')], PS.SENT)).toBe('1 of these hasn’t been reviewed');
    expect(unreviewedNote([m(PS.REVIEW, 'changes_requested')], PS.SENT)).toBe('This one hasn’t been reviewed');
  });
  it('says nothing when all were reviewed, for one already past sending, or for another status', () => {
    expect(unreviewedNote([m(PS.REVIEW, 'approved'), m(PS.REVIEW, 'approved')], PS.SENT)).toBeNull();
    expect(unreviewedNote([m(PS.CLIENT_SIGNED)], PS.SENT)).toBeNull();
    expect(unreviewedNote([m(PS.DRAFTING)], PS.WON)).toBeNull();
  });
});

describe('the same fields as one at a time', () => {
  it('sent: the first send stays, and an open revision is sent that day', () => {
    const p = P({ status: 'Drafting', dateSentToClient: '2026-09-02', sentDate: '2026-09-02', revision: 2, revisions: [{ id: 7, number: 2, requestedAt: '2026-09-20', sentAt: null } as never] });
    const r = applyStatus(p, 'Sent to Client', '2026-09-28', { explicit: true });
    expect([p.dateSentToClient, p.lastSentAt, p.revisions?.[0].sentAt, r.revisionSent?.number]).toEqual(['2026-09-02', '2026-09-28', '2026-09-28', 2]);
  });
  it('review: asked that day of the default reviewer, pending, with any earlier answer cleared', () => {
    const p = P({ status: 'Drafting', dateSentToHassan: null, reviewStatus: 'approved', reviewedAt: '2026-08-01', reviewNote: 'fine' });
    applyStatus(p, 'In Internal Review', '2026-10-01', { defaultReviewerId: 2 });
    expect([p.dateSentToHassan, p.reviewerId, p.reviewStatus, p.reviewRequestedAt, p.reviewedAt, p.reviewNote]).toEqual(['2026-10-01', 2, 'pending', '2026-10-01', null, null]);
  });
  it('a proposal already in that status is left alone', () => {
    const p = P({ status: 'Sent to Client', dateSentToClient: '2026-09-02' });
    applyStatus(p, 'Sent to Client', '2026-09-28', { explicit: true });
    expect(p.dateSentToClient).toBe('2026-09-02');
  });
});

describe('selecting', () => {
  it('shift-click takes the rows between the last one ticked and this one, either way round', () => {
    const order = [9, 4, 7, 2, 5];
    expect(rangeIds(order, 4, 2)).toEqual([4, 7, 2]);
    expect(rangeIds(order, 5, 7)).toEqual([7, 2, 5]);
    expect(rangeIds(order, 7, 7)).toEqual([7]);
    // The earlier row is no longer in the list: just this one.
    expect(rangeIds(order, 99, 2)).toEqual([2]);
  });
  it('"Service started" for a batch is pre-filled with the latest signature date, else today', () => {
    expect(batchStartDate([{ dblSignedDate: '2026-09-22', dateSigned: '2026-09-20' }, { dblSignedDate: null, dateSigned: '2026-09-25' }], '2026-10-01')).toBe('2026-09-25');
    expect(batchStartDate([{ dblSignedDate: null, dateSigned: null }], '2026-10-01')).toBe('2026-10-01');
  });
});
