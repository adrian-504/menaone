// The proposal page's header action: the next step where the proposal stands.
// A revision (lib/revisions.ts) changes it (owner, 30-Sep-2026: "I should be
// able to log that the client requested changes, or that we are sending an
// updated proposal, from the proposal page itself"): while one is being
// drafted, the step is sending it, with review as the second choice. Pure.

import { PS } from './commercial';
import { openRevision } from './revisions';
import type { Agreement, Proposal } from './types';

export interface Step { label: string; run: string }
export interface NextStep { primary: Step | null; secondary?: Step }

const send = (label: string): Step => ({ label, run: `proposalStep('${PS.SENT}')` });

export function proposalNextStep(p: Pick<Proposal, 'id' | 'status' | 'reviewStatus' | 'revisions' | 'serviceStartedAt'>, agreements: Pick<Agreement, 'id' | 'proposalId'>[]): NextStep {
  const revising = !!openRevision(p);
  switch (p.status) {
    case PS.REQUEST: return { primary: { label: 'Start drafting', run: `proposalStep('${PS.DRAFTING}')` } };
    case PS.DRAFTING: return revising
      // A revision goes back to the client; review stays optional, as on the first send.
      ? { primary: send('Mark revision sent'), secondary: { label: 'Submit for review', run: `proposalStep('${PS.REVIEW}')` } }
      : { primary: { label: 'Submit for review', run: `proposalStep('${PS.REVIEW}')` } };
    case PS.REVIEW: return p.reviewStatus === 'approved'
      ? { primary: send(revising ? 'Mark revision sent' : 'Mark sent to client') }
      : { primary: { label: 'Record review', run: `document.getElementById('prd-review')?.scrollIntoView({behavior:'smooth',block:'center'})` } };
    case PS.SENT: return { primary: { label: 'Record signature', run: 'proposalSignatureMenu(event)' } };
    case PS.CLIENT_SIGNED: return {
      primary: { label: 'Signed by both parties', run: `proposalStep('${PS.WON}')` },
      // No Follow-up section once the client has signed: the request for changes is a header button.
      secondary: { label: 'Client asked for changes…', run: `openRevisionDialog(${p.id})` },
    };
    case PS.WON: {
      const agr = agreements.find((a) => a.proposalId === p.id);
      const open = agr ? { label: 'Open agreement', run: `openRecord('agreement', ${agr.id})` } : undefined;
      // Signed with no start date: the last step is still to take.
      if (!p.serviceStartedAt) return { primary: { label: 'Mark service started', run: 'proposalMarkServiceStarted()' }, secondary: open };
      return { primary: open ?? null };
    }
    default: return { primary: { label: 'Reopen', run: 'proposalReopenMenu(event)' } };
  }
}

/** Is "Generate proposal" the page's featured action? While the proposal is requested or being drafted and has no
 * deck yet: then it is the header's one blue button and a feature card in Proposal documents; the status step sits
 * beside it as a secondary button. Once there is a deck it is a secondary button again. Pure. */
export function generateIsFeatured(p: Pick<Proposal, 'status'>, hasDeck: boolean): boolean {
  return !hasDeck && (p.status === PS.REQUEST || p.status === PS.DRAFTING);
}
