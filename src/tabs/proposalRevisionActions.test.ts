// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { S } from '../lib/state';
import { renderActions, renderContact } from './proposalPage';
import type { Proposal, ProposalRevision } from '../lib/types';

const proposal = (status: string, over: Partial<Proposal> = {}) => ({
  id: 7, client: 'Contoso Test', companyId: 1, status, reviewStatus: null, revisions: [], lines: [], notes: [], ...over,
}) as unknown as Proposal;
const header = () => document.getElementById('prd-actions')!;

describe('asking for changes and sending a revision from the proposal page', () => {
  it("a sent proposal's Follow-up header: two matched small buttons, no link", () => {
    document.body.innerHTML = '<section id="prd-contact"></section>';
    S.touches = [];
    renderContact(proposal('Sent to Client', { dateSentToClient: '2026-09-29' }));
    const actions = document.querySelector('#prd-contact .rec-section-actions')!;
    const buttons = [...actions.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent!.trim())).toEqual(['Client asked for changes', 'Followed up']);
    expect(buttons.every((b) => b.className === 'btn-secondary btn-sm')).toBe(true);
    expect(buttons[0].getAttribute('onclick')).toBe('openRevisionDialog(7)');
    expect(actions.querySelector('a, .rlink')).toBeNull();
    expect(document.querySelector('#prd-contact .pr-review-note')?.textContent).toBe('Sent 29 Sept 2026 · nothing logged since.');
  });

  it('drafting a revision: one primary, Mark revision sent, with Submit for review as a secondary', () => {
    document.body.innerHTML = '<div id="prd-actions"></div>';
    S.agreements = [];
    renderActions(proposal('Drafting', { revisions: [{ id: 1, number: 2, requestedAt: '2026-09-20', sentAt: null } as ProposalRevision] }));
    expect([...header().querySelectorAll('.btn-primary')].map((b) => b.textContent)).toEqual(['Mark revision sent']);
    expect([...header().querySelectorAll('.btn-secondary')].map((b) => b.textContent)).toEqual(['Generate proposal', 'Submit for review']);
  });

  it('signed by the client: one primary, the request for changes as a secondary', () => {
    document.body.innerHTML = '<div id="prd-actions"></div>';
    renderActions(proposal('Signed by Client'));
    expect([...header().querySelectorAll('.btn-primary')].map((b) => b.textContent)).toEqual(['Signed by both parties']);
    expect([...header().querySelectorAll('.btn-secondary')].map((b) => b.textContent)).toEqual(['Client asked for changes…']);
  });
});
