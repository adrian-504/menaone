import type { Proposal } from './types';
import { matchesProposalPeriod } from './period';

/** Shared by the Database and Reports tabs — identical filter predicate to the
 * original app's applyFilters(). */
export function applyFilters(
  arr: Proposal[],
  search: string,
  status: string,
  type: string,
  df: string,
  dt: string,
  showArchived: boolean
): Proposal[] {
  return arr.filter((p) => {
    if (!showArchived && p.archived) return false;
    if (!matchesProposalPeriod(p)) return false;
    if (status && p.status !== status) return false;
    if (type && p.type !== type) return false;
    if (search) {
      const s = search.toLowerCase();
      if (
        !p.client.toLowerCase().includes(s) &&
        !(p.type || '').toLowerCase().includes(s) &&
        !p.status.toLowerCase().includes(s) &&
        !(p.remarks || '').toLowerCase().includes(s) &&
        !String(p.id).includes(s)
      )
        return false;
    }
    if (df && p.sentDate && p.sentDate < df) return false;
    if (dt && p.sentDate && p.sentDate > dt) return false;
    return true;
  });
}
