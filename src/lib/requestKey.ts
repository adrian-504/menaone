// What ties proposals into one request (1.65), on its own so the pure rules
// that only need this (My Day's rail) do not pull in the page kit.

import type { Proposal } from './types';
import { PS, proposalSentDate } from './commercial';

const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : '');

type KeyProposal = Pick<Proposal, 'id' | 'client' | 'companyId' | 'requestGroup' | 'lastSentAt' | 'dateSentToClient' | 'sentDate'>;

/** What ties proposals into one request: their request group; without one, the client and the day they were sent. */
export function requestKey(p: KeyProposal): string {
  if (p.requestGroup) return `g:${p.requestGroup}`;
  const who = p.companyId != null ? `c${p.companyId}` : `n:${(p.client || '').trim().toLowerCase()}`;
  return `${who}:${day(proposalSentDate(p)) || 'unsent'}`;
}

/** The other proposals with the client that were sent with this one (same request), by SL#. */
export function sentWith<T extends KeyProposal & Pick<Proposal, 'status' | 'archived'>>(p: T, all: T[]): T[] {
  const key = requestKey(p);
  return all.filter((x) => x.id !== p.id && !x.archived && x.status === PS.SENT && requestKey(x) === key).sort((a, b) => a.id - b.id);
}
