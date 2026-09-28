// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../lib/persist', async (orig) => ({ ...(await orig<typeof import('../lib/persist')>()), persistProposals: vi.fn() }));
vi.mock('../lib/ui', async (orig) => ({ ...(await orig<typeof import('../lib/ui')>()), toast: vi.fn() }));

import { S } from '../lib/state';
import { PS } from '../lib/commercial';
import { persistProposals } from '../lib/persist';
import { recordReview, undoReview } from './proposals';
import type { Proposal } from '../lib/types';

const proposal = (over: Partial<Proposal>): Proposal => ({
  id: 1, status: PS.REVIEW, reviewerId: null, reviewStatus: 'pending', reviewRequestedAt: '2026-09-20',
  reviewedAt: null, reviewNote: null, dateSentToHassan: '2026-09-20', lines: [], notes: [], documents: [],
  ...over,
} as Proposal);

describe('undoing a review recorded by mistake', () => {
  beforeEach(() => { S.proposals = []; vi.mocked(persistProposals).mockClear(); });

  it('an approval goes back to pending, its date cleared and its note kept', () => {
    S.proposals = [proposal({})];
    recordReview(1, 'approved', 'Looks good');
    undoReview(1);
    const p = S.proposals[0];
    expect(p.status).toBe(PS.REVIEW);
    expect(p.reviewStatus).toBe('pending');
    expect(p.reviewedAt).toBeNull();
    expect(p.reviewNote).toBe('Looks good');
    expect(p.reviewRequestedAt).toBe('2026-09-20');
    expect(persistProposals).toHaveBeenCalledTimes(2);
  });

  it('changes requested: the proposal leaves Drafting for In Internal Review, pending again', () => {
    S.proposals = [proposal({})];
    recordReview(1, 'changes_requested', 'Fix the fees');
    expect(S.proposals[0].status).toBe(PS.DRAFTING);
    undoReview(1);
    const p = S.proposals[0];
    expect(p.status).toBe(PS.REVIEW);
    expect(p.reviewStatus).toBe('pending');
    expect(p.reviewedAt).toBeNull();
    expect(p.reviewNote).toBe('Fix the fees');
  });

  it('does nothing when there is no recorded review', () => {
    S.proposals = [proposal({})];
    undoReview(1);
    expect(S.proposals[0].reviewStatus).toBe('pending');
    expect(persistProposals).not.toHaveBeenCalled();
  });
});
