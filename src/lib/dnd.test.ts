// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { reorder } from './dnd';

describe('reordering', () => {
  const items = [1, 2, 3, 4, 5].map((id) => ({ id }));
  const ids = (xs: { id: number }[]) => xs.map((x) => x.id);

  it('moves one or several items before a target, keeping their order', () => {
    expect(ids(reorder(items, [5], 2))).toEqual([1, 5, 2, 3, 4]);
    expect(ids(reorder(items, [1, 3], 5))).toEqual([2, 4, 1, 3, 5]);
  });

  it('drops at the end when there is no target, or the target is one of the moved items', () => {
    expect(ids(reorder(items, [2], null))).toEqual([1, 3, 4, 5, 2]);
    expect(ids(reorder(items, [2, 3], 3))).toEqual([1, 4, 5, 2, 3]);
  });
});

describe('making room while dragging (shiftOffsets)', () => {
  it('moving down: the items passed slide up; moving up: they slide down; in place: nothing', async () => {
    const { shiftOffsets } = await import('./dnd');
    expect(shiftOffsets(4, 0, 3, 40)).toEqual([0, -40, -40, 0]);
    expect(shiftOffsets(4, 0, 4, 40)).toEqual([0, -40, -40, -40]);
    expect(shiftOffsets(4, 3, 1, 40)).toEqual([0, 40, 40, 0]);
    expect(shiftOffsets(4, 2, 2, 40)).toEqual([0, 0, 0, 0]);
    expect(shiftOffsets(4, 2, 3, 40)).toEqual([0, 0, 0, 0]);
  });
});
