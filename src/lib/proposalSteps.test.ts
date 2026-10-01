import { describe, it, expect } from 'vitest';
import { generateIsFeatured, proposalNextStep } from './proposalSteps';
import type { Proposal, ProposalRevision } from './types';

const rev = (over: Partial<ProposalRevision> = {}) => ({ id: 1, number: 2, requestedAt: '2026-09-20', sentAt: null, reason: 'Price on three people', ...over }) as ProposalRevision;
const p = (status: string, over: Partial<Proposal> = {}) => ({ id: 7, status, reviewStatus: null, revisions: [], ...over }) as unknown as Proposal;
const labels = (s: ReturnType<typeof proposalNextStep>) => [s.secondary?.label ?? null, s.primary?.label ?? null];

describe('the proposal header step', () => {
  it('drafting a first version: Submit for review, nothing beside it', () => {
    expect(labels(proposalNextStep(p('Drafting'), []))).toEqual([null, 'Submit for review']);
  });

  it('drafting a revision: Mark revision sent, with Submit for review beside it', () => {
    const s = proposalNextStep(p('Drafting', { revisions: [rev()] }), []);
    expect(s.primary).toEqual({ label: 'Mark revision sent', run: "proposalStep('Sent to Client')" });
    expect(s.secondary).toEqual({ label: 'Submit for review', run: "proposalStep('In Internal Review')" });
  });

  it('a revision already sent is not open: back to the first-version step', () => {
    expect(labels(proposalNextStep(p('Drafting', { revisions: [rev({ sentAt: '2026-09-22' })] }), []))).toEqual([null, 'Submit for review']);
  });

  it('in review: Record review until approved, then Mark revision sent when revising', () => {
    expect(proposalNextStep(p('In Internal Review', { revisions: [rev()] }), []).primary?.label).toBe('Record review');
    expect(proposalNextStep(p('In Internal Review', { reviewStatus: 'approved' }), []).primary?.label).toBe('Mark sent to client');
    const s = proposalNextStep(p('In Internal Review', { reviewStatus: 'approved', revisions: [rev()] }), []);
    expect(s.primary).toEqual({ label: 'Mark revision sent', run: "proposalStep('Sent to Client')" });
    expect(s.secondary).toBeUndefined();
  });

  it('signed by the client: the request for changes sits beside the primary', () => {
    const s = proposalNextStep(p('Signed by Client'), []);
    expect(s.primary?.label).toBe('Signed by both parties');
    expect(s.secondary).toEqual({ label: 'Client asked for changes…', run: 'openRevisionDialog(7)' });
  });

  it('sent: Record signature only (the request for changes is in the Follow-up section)', () => {
    expect(labels(proposalNextStep(p('Sent to Client'), []))).toEqual([null, 'Record signature']);
  });

  it('signed by both: Mark service started until it has a start date, with the agreement beside it; then the agreement', () => {
    const agreements = [{ id: 4, proposalId: 7 }];
    expect(labels(proposalNextStep(p('Signed by Both Parties'), agreements))).toEqual(['Open agreement', 'Mark service started']);
    expect(proposalNextStep(p('Signed by Both Parties'), []).primary).toEqual({ label: 'Mark service started', run: 'proposalMarkServiceStarted()' });
    expect(labels(proposalNextStep(p('Signed by Both Parties', { serviceStartedAt: '2026-10-12' }), agreements))).toEqual([null, 'Open agreement']);
    expect(labels(proposalNextStep(p('Signed by Both Parties', { serviceStartedAt: '2026-10-12' }), []))).toEqual([null, null]);
  });
});

describe('Generate proposal as the featured action (1.64)', () => {
  it('is featured while requested or drafting with no deck, and only then', () => {
    expect(generateIsFeatured(p('Proposal Request Received'), false)).toBe(true);
    expect(generateIsFeatured(p('Drafting'), false)).toBe(true);
    expect(generateIsFeatured(p('Drafting'), true)).toBe(false);
    expect(generateIsFeatured(p('In Internal Review'), false)).toBe(false);
    expect(generateIsFeatured(p('Sent to Client'), false)).toBe(false);
  });
});
