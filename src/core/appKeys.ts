// The app-wide shortcuts (foundations O4), as one table. Page keys are
// registered by their pages (Tasks, Notes, Files, Clean-up, lists); these are
// the ones that work everywhere. The native menu's accelerators (src-tauri
// lib.rs) must be the same keys — appKeys.test.ts reads lib.rs and checks.

import { registerKey, type KeyBinding } from './keys';
import { S } from '../lib/state';
import { pendingUndo } from '../lib/ui';

const w = () => window as any;

/** ⌘1–⌘9: the same pages, in the same order, as the native Go menu. */
export const GOTO: [string, string][] = [
  ['myday', 'My Day'], ['todo', 'Tasks'], ['opportunities', 'Opportunities'], ['projects', 'Projects'], ['pending', 'Pending'],
  ['notes', 'Notes'], ['companies', 'Companies'], ['contacts', 'Contacts'], ['followup', 'Follow-up'],
];

const pageSearch = (): HTMLInputElement | null =>
  [...document.querySelectorAll<HTMLInputElement>('.tab.active .f-search, .tab.active input[placeholder^="Search"]')].find((el) => el.offsetParent !== null) ?? null;

export const APP_KEYS: KeyBinding[] = [
  // Dialogs first: the topmost one answers.
  { scope: 'dialog', combo: 'mod+k', when: () => !!S.commandPaletteOpen, run: () => w().closeCommandPalette?.() },
  { scope: 'dialog', combo: ['?', 'mod+/'], when: () => !!document.getElementById('modal-shortcuts')?.classList.contains('open'), run: () => w().closeShortcutSheet?.() },
  { scope: 'dialog', combo: 'escape', label: 'Close a dialog or the open record', group: 'Everywhere', id: 'close', run: () => {
    if (S.commandPaletteOpen) { w().closeCommandPalette?.(); return; }
    if (document.getElementById('ctx-menu')?.classList.contains('open')) { w().closeContextMenu?.(); return; }
    return w().closeTopmostModal?.() ? undefined : false;
  } },
  // Typing in a field: Esc leaves the field.
  { scope: 'editor', combo: 'escape', run: (e) => { (e.target as HTMLElement).blur(); } },
  // Everywhere.
  { combo: 'mod+k', inInputs: true, label: 'Search and commands', group: 'Everywhere', id: 'palette', run: () => w().openCommandPalette?.() },
  { combo: ['mod+[', 'alt+arrowleft'], label: 'Back', group: 'Everywhere', id: 'nav-back', run: () => w().navBack?.() },
  { combo: ['mod+]', 'alt+arrowright'], label: 'Forward', group: 'Everywhere', id: 'nav-forward', run: () => w().navForward?.() },
  { combo: 'mod+\\', inInputs: true, label: 'Show or hide the sidebar', group: 'Everywhere', id: 'toggle-sidebar', run: () => w().toggleSidebar?.() },
  { combo: 'mod+shift+\\', inInputs: true, label: 'Show or hide the list beside a record', group: 'Everywhere', id: 'toggle-rail', run: () => w().toggleRecordRail?.() },
  ...GOTO.map(([tab, name], i): KeyBinding => ({
    combo: `mod+${i + 1}`, inInputs: true, id: `goto-${tab}`, run: () => w().navToModule?.(tab),
    ...(i === 0 ? { label: 'Go to My Day, Tasks, Opportunities, Projects, Pending, Notes, Companies, Contacts, Follow-up', group: 'Everywhere', note: `${name} is 1, the rest in that order to 9` } : {}),
  })),
  { combo: 'mod+t', inInputs: true, label: 'New task', group: 'Everywhere', id: 'new-task', run: () => w().openTodoModal?.(null) },
  { combo: 'mod+n', inInputs: true, label: 'New note', group: 'Everywhere', id: 'new-note', run: () => { w().switchTab?.('notes'); w().createNewNote?.(null); } },
  { combo: 'mod+,', inInputs: true, label: 'Settings', group: 'Everywhere', id: 'settings', run: () => w().navToModule?.('settings') },
  { combo: 'mod+f', inInputs: true, label: "Search this page (or everything, if it has no search)", group: 'Everywhere', id: 'find', run: () => {
    const field = pageSearch();
    if (field) { field.focus(); field.select(); } else w().openCommandPalette?.();
  } },
  { combo: 'mod+z', label: 'Undo the last action', group: 'Everywhere', id: 'undo', when: () => !!pendingUndo(), run: () => { pendingUndo()?.(); } },
  { combo: ['?', 'mod+/'], label: 'This list', group: 'Everywhere', id: 'shortcuts', run: () => w().openShortcutSheet?.() },
  { combo: 'escape', run: () => { if (w().closeIntelRow?.()) return; return w().closeCurrentRecord?.({ fromEscape: true }) ? undefined : false; } },
];

let registered = false;
export function registerAppKeys(): void {
  if (registered) return;
  registered = true;
  for (const b of APP_KEYS) registerKey(b);
}
