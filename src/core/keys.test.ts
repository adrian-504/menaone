// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { candidates, comboOf, capsOf, duplicateCombos, registerKey, allBindings, keysFor } from './keys';
import { APP_KEYS, GOTO, registerAppKeys } from './appKeys';

const ev = (key: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}, code = '') => ({ key, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe('one shortcut registry', () => {
  it('spells key events one way', () => {
    expect(comboOf(ev('k', { metaKey: true }))).toBe('mod+k');
    expect(comboOf(ev('|', { metaKey: true, shiftKey: true }, 'Backslash'))).toBe('mod+shift+\\');
    expect(comboOf(ev('?', { shiftKey: true }))).toBe('?');
    expect(comboOf(ev(' '))).toBe('space');
    expect(comboOf(ev('ArrowDown', { shiftKey: true }))).toBe('shift+arrowdown');
    expect(comboOf(ev('F', { metaKey: true, shiftKey: true }))).toBe('mod+shift+f');
    expect(capsOf('mod+shift+f').slice(1)).toEqual(['⇧', 'F']);
  });

  it('answers in order: the dialog, then the field, then the page list, then everywhere', () => {
    const off: (() => void)[] = [];
    const seen: string[] = [];
    off.push(registerKey({ scope: 'dialog', combo: 'f9', run: () => { seen.push('dialog'); } }));
    off.push(registerKey({ scope: 'editor', combo: 'f9', run: () => { seen.push('editor'); } }));
    off.push(registerKey({ scope: 'list', tabs: ['todo'], combo: 'f9', run: () => { seen.push('list'); } }));
    off.push(registerKey({ scope: 'global', combo: 'f9', run: () => { seen.push('global'); } }));
    off.push(registerKey({ scope: 'global', combo: 'f9', inInputs: true, when: () => true, run: () => { seen.push('global-in-fields'); } }));
    const first = (ctx: { dialog: boolean; typing: boolean; tab: string }) => candidates('f9', ctx).map((b) => { b.run({} as KeyboardEvent); return seen.pop(); });
    expect(first({ dialog: true, typing: true, tab: 'todo' })).toEqual(['dialog']);
    expect(first({ dialog: false, typing: true, tab: 'todo' })).toEqual(['editor', 'global-in-fields']);
    expect(first({ dialog: false, typing: false, tab: 'todo' })).toEqual(['list', 'global', 'global-in-fields']);
    expect(first({ dialog: false, typing: false, tab: 'notes' })).toEqual(['global', 'global-in-fields']);
    off.forEach((f) => f());
  });

  it('has no two keys doing different things in the same place', () => {
    registerAppKeys();
    expect(duplicateCombos()).toEqual([]);
    expect(duplicateCombos([{ combo: 'mod+q', run: () => {} }, { combo: 'mod+q', run: () => {} }])).toEqual(['global|*|mod+q']);
  });

  it('tooltips read the real keys', () => {
    registerAppKeys();
    expect(keysFor('toggle-sidebar')).toMatch(/\\$/);
    expect(keysFor('nav-back')).toMatch(/\[$/);
    expect(allBindings().length).toBeGreaterThan(20);
  });

  it('the native menu (lib.rs) uses the same keys', () => {
    const lib = Object.values(import.meta.glob('../../src-tauri/src/lib.rs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0];
    const menu = [...lib.matchAll(/with_id\("([a-z_]+)", "[^"]*"\)\.accelerator\("([^"]+)"\)/g)].map((m) => [m[1], m[2]]);
    expect(menu.length).toBeGreaterThan(10);
    // lib.rs writes a backslash as \\ (a Rust string escape).
    const toCombo = (acc: string) => acc.replace(/\\\\/g, '\\').replace('CmdOrCtrl', 'mod').replace('Shift', 'shift').toLowerCase();
    const ids: Record<string, string> = { new_task: 'new-task', new_note: 'new-note', toggle_sidebar: 'toggle-sidebar', command_palette: 'palette', help_shortcuts: 'shortcuts' };
    for (const [id, acc] of menu) {
      const bindingId = id.startsWith('goto_') ? `goto-${id.slice(5)}` : ids[id];
      const b = APP_KEYS.find((x) => x.id === bindingId);
      expect(b, `${id} has a registered key`).toBeTruthy();
      expect((Array.isArray(b!.combo) ? b!.combo : [b!.combo]), `${id} ${acc}`).toContain(toCombo(acc));
    }
    expect(GOTO.map(([tab]) => tab)).toEqual(menu.filter(([id]) => id.startsWith('goto_')).map(([id]) => id.slice(5)));
  });
});
