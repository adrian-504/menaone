// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { registerAppKeys } from './appKeys';
import { sheetGroups } from './shortcuts';

describe('the shortcut sheet', () => {
  it('is drawn from the registry', () => {
    registerAppKeys();
    const everywhere = sheetGroups().find((g) => g.title === 'Everywhere')!;
    const does = everywhere.items.map((i) => i.does);
    expect(does).toEqual(expect.arrayContaining(['Search and commands', 'Show or hide the sidebar', 'Settings', 'This list']));
    expect(everywhere.items.find((i) => i.does === 'This list')!.keys.map((k) => k.join(''))).toEqual(['?', expect.stringMatching(/\/$/)]);
  });
});
