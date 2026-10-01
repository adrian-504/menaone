// Proposals requested together: the others sent with one.
import { describe, expect, it } from 'vitest';

import { requestGroupIds, requestSiblings } from './proposalGroups';

const P = (id: number, requestGroup: string | null, archived = false) => ({ id, requestGroup, archived });
const all = [P(1, 'g1'), P(2, 'g1'), P(3, null), P(4, 'g1', true), P(5, 'g2'), P(6, 'g1')];

describe('sent with', () => {
  it('the other proposals in the same request, in id order, without archived ones', () => {
    expect(requestSiblings(all[0], all).map((p) => p.id)).toEqual([2, 6]);
    expect(requestSiblings(all[5], all).map((p) => p.id)).toEqual([1, 2]);
  });
  it('a proposal requested on its own has none', () => {
    expect(requestSiblings(all[2], all)).toEqual([]);
    expect(requestSiblings(all[4], all)).toEqual([]);
  });
  it('the whole set, for selecting it at once', () => {
    expect(requestGroupIds(all[1], all)).toEqual([1, 2, 6]);
    expect(requestGroupIds(all[2], all)).toEqual([3]);
  });
});
