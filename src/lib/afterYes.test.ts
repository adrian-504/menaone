import { describe, it, expect } from 'vitest';
import { PAPERWORK_PENDING, afterYes, paperworkPending, showsAfterYes } from './afterYes';
import type { Proposal } from './types';

const P = (over: Partial<Proposal>) => ({ id: 7, status: 'Sent to Client', ...over }) as Proposal;
const rows = (p: Proposal, agreements: { id: number; proposalId: number | null; datePrepared?: string | null; createdAt?: string | null }[] = []) =>
  afterYes(p, agreements as never).map((x) => [x.key, x.done, x.date, x.mark]);

describe('after the yes', () => {
  it('with the client: nothing done, the first four can be marked; agreement and service start wait for both signatures', () => {
    expect(rows(P({}))).toEqual([
      ['accepted', false, null, 'Mark'], ['letter', false, null, 'Mark'], ['client_signed', false, null, 'Mark'], ['both_signed', false, null, 'Mark'],
      ['agreement', false, null, null], ['started', false, null, null],
    ]);
  });

  it('each step says its day once recorded', () => {
    const p = P({ status: 'Signed by Both Parties', acceptedAt: '2026-09-20', engagementLetterSentAt: '2026-09-21', dateSigned: '2026-09-24', dblSignedDate: '2026-09-26', serviceStartedAt: '2026-10-01' });
    expect(rows(p, [{ id: 3, proposalId: 7, datePrepared: '2026-09-27' }])).toEqual([
      ['accepted', true, '2026-09-20', null], ['letter', true, '2026-09-21', null], ['client_signed', true, '2026-09-24', null], ['both_signed', true, '2026-09-26', null],
      ['agreement', true, '2026-09-27', null], ['started', true, '2026-10-01', null],
    ]);
    expect(afterYes(p, [{ id: 3, proposalId: 7, datePrepared: '2026-09-27', createdAt: null }])[4].agreementId).toBe(3);
  });

  it('a signature implies the yes: accepted reads done with no day, and can still be given one', () => {
    const signed = rows(P({ status: 'Signed by Client', dateSigned: '2026-09-24' }));
    expect(signed[0]).toEqual(['accepted', true, null, 'Mark']);
    expect(signed[2]).toEqual(['client_signed', true, '2026-09-24', null]);
    expect(signed[3]).toEqual(['both_signed', false, null, 'Mark']);
  });

  it('signed by both: the agreement can be drafted and the service started', () => {
    const won = rows(P({ status: 'Signed by Both Parties', dblSignedDate: '2026-09-26' }));
    expect(won[4]).toEqual(['agreement', false, null, 'Draft']);
    expect(won[5]).toEqual(['started', false, null, 'Mark']);
    // An agreement of another proposal is not this one's.
    expect(rows(P({ status: 'Signed by Both Parties' }), [{ id: 3, proposalId: 8 }])[4]).toEqual(['agreement', false, null, 'Draft']);
  });

  it('shows from "with the client" on; a lost one only when the client had accepted, and with nothing to mark', () => {
    expect(['Proposal Request Received', 'Drafting', 'In Internal Review', 'Sent to Client', 'Signed by Client', 'Signed by Both Parties', 'Lost'].map((status) => showsAfterYes({ status, acceptedAt: null })))
      .toEqual([false, false, false, true, true, true, false]);
    expect(showsAfterYes({ status: 'Lost', acceptedAt: '2026-09-20' })).toBe(true);
    expect(rows(P({ status: 'Lost', acceptedAt: '2026-09-20' })).map((r) => r[3])).toEqual([null, null, null, null, null, null]);
  });

  it('accepted but unsigned reads "Accepted · paperwork pending" on lists', () => {
    expect(PAPERWORK_PENDING).toBe('Accepted · paperwork pending');
    expect(paperworkPending({ status: 'Sent to Client', acceptedAt: '2026-09-20' })).toBe(true);
    expect(paperworkPending({ status: 'Sent to Client', acceptedAt: null })).toBe(false);
    expect(paperworkPending({ status: 'Signed by Client', acceptedAt: '2026-09-20' })).toBe(false);
  });
});
