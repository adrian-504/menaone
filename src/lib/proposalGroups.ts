// Proposals requested together (the same `requestGroup`): the others sent with
// one, for the "sent with" line on its page and for selecting the whole set in
// a list. Pure.

import type { Proposal } from './types';

type P = Pick<Proposal, 'id' | 'requestGroup' | 'archived'>;

/** The other proposals requested together with this one, in id order; none when it stands alone. */
export function requestSiblings<T extends P>(p: P, all: T[]): T[] {
  if (!p.requestGroup) return [];
  return all.filter((x) => x.id !== p.id && x.requestGroup === p.requestGroup && !x.archived).sort((a, b) => a.id - b.id);
}

/** The ids of a proposal and everything sent with it. */
export function requestGroupIds(p: P, all: P[]): number[] {
  return [p.id, ...requestSiblings(p, all).map((x) => x.id)].sort((a, b) => a - b);
}
