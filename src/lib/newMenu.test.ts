// The New menu: its groups, the filter, and the arrows.
import { describe, expect, it } from 'vitest';

import { NEW_ITEMS, filterNewItems, flatNewItems, groupNewItems, stepSelection, type NewItem } from './newMenu';

describe('the New menu', () => {
  it('lists Work, Clients and Sales, in that order', () => {
    expect(groupNewItems(NEW_ITEMS).map((g) => [g.group, g.items.map((i) => i.label)])).toEqual([
      ['Work', ['Task', 'Meeting', 'Note', 'Promise']],
      ['Clients', ['Company', 'Contact']],
      ['Sales', ['Opportunity', 'Proposal', 'Agreement', 'Project']],
    ]);
  });
  it('what the open record offers comes first', () => {
    const here: NewItem = { key: 'here:0', label: 'Contact at Sample Client', group: 'Here', icon: 'people', tint: 'var(--green)' };
    expect(flatNewItems([...NEW_ITEMS, here])[0]).toBe(here);
  });
  it('only Task, Promise and Proposal carry a helper; Task and Note a shortcut', () => {
    expect(NEW_ITEMS.filter((i) => i.helper).map((i) => i.key)).toEqual(['task', 'promise', 'proposal']);
    expect(NEW_ITEMS.filter((i) => i.shortcutId).map((i) => [i.key, i.shortcutId])).toEqual([['task', 'new-task'], ['note', 'new-note']]);
  });
  it('typing filters by the start of a word: of the label, the helper or the group', () => {
    expect(filterNewItems(NEW_ITEMS, 'pro').map((i) => i.key)).toEqual(['promise', 'proposal', 'project']);
    expect(filterNewItems(NEW_ITEMS, 'con').map((i) => i.key)).toEqual(['contact']);
    expect(filterNewItems(NEW_ITEMS, 'owe').map((i) => i.key)).toEqual(['promise']);
    expect(filterNewItems(NEW_ITEMS, 'sales').map((i) => i.key)).toEqual(['opportunity', 'proposal', 'agreement', 'project']);
    expect(filterNewItems(NEW_ITEMS, 'ask')).toEqual([]);
    expect(filterNewItems(NEW_ITEMS, '  ')).toBe(NEW_ITEMS);
  });
  it('a group with nothing left is not shown', () => {
    expect(groupNewItems(filterNewItems(NEW_ITEMS, 'con')).map((g) => g.group)).toEqual(['Clients']);
  });
  it('the arrows wrap around', () => {
    expect([stepSelection(0, 1, 3), stepSelection(2, 1, 3), stepSelection(0, -1, 3), stepSelection(0, 1, 0)]).toEqual([1, 0, 2, -1]);
  });
});
