// Pending's order (tabs/pending.ts): proposals requested together stay side by
// side and sort by their oldest member's age, so none hides behind a newer
// sibling. Each keeps its own age. Pure.

import { groupRequestedTogether } from './companyRecords';
import type { Proposal } from './types';

export type PendingSort = 'age' | 'age-desc' | 'client';

const received = (p: Pick<Proposal, 'dateAdded' | 'sentDate'>) => p.dateAdded || p.sentDate || '';

/** One status section's rows as runs: a lone proposal, or those requested together. */
export function pendingRuns<T extends Pick<Proposal, 'id' | 'client' | 'dateAdded' | 'sentDate' | 'requestGroup'>>(list: T[], sort: PendingSort | string) {
  const runs = groupRequestedTogether(list, received, { groupDate: 'earliest', order: sort === 'age-desc' ? 'desc' : 'asc' });
  if (sort === 'client') runs.sort((a, b) => a.items[0].client.localeCompare(b.items[0].client));
  return runs;
}
