// One shortcut registry (foundations O4). Every keyboard shortcut in the app
// is registered here, with the label and group the shortcut sheet shows, so
// the sheet (core/shortcuts.ts) and the tooltips (lib/tooltip.ts, via
// data-shortcut) can't drift from what the keys actually do. One document
// listener dispatches by scope, in this order:
//   dialog  — the palette, a menu or a dialog is open: only its keys;
//   editor  — you're typing in a field: only keys marked for fields;
//   list    — keys of the page you're on (its list, its page actions);
//   global  — everywhere else.
// Keys typed into an input for editing (Esc to cancel an inline edit, ↑↓ in a
// company picker) stay with that input; they aren't app shortcuts.

import { getActiveTabId } from '../lib/registry';
import { S } from '../lib/state';

export type Scope = 'dialog' | 'editor' | 'list' | 'global';

export interface KeyBinding {
  /** "mod+k", "mod+shift+\\", "?", "escape", "arrowdown", "j", "space", "alt+arrowup"… Alternatives in an array. */
  combo: string | string[];
  run: (e: KeyboardEvent) => boolean | void;
  /** What the sheet says it does; no label = not listed. */
  label?: string;
  group?: string;
  note?: string;
  scope?: Scope;
  /** For list keys (and page keys in general): the tabs where they apply. */
  tabs?: string[];
  /** Extra condition; the key passes through when it's false. */
  when?: () => boolean;
  /** Also while typing in a field (e.g. ⌘K). Dialog keys always are. */
  inInputs?: boolean;
  /** For tooltips: data-shortcut="<id>" shows this binding's keys. */
  id?: string;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const bindings: KeyBinding[] = [];

const combos = (b: Pick<KeyBinding, 'combo'>) => (Array.isArray(b.combo) ? b.combo : [b.combo]);

/** The combo a key event is, in registry spelling. */
export function comboOf(e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): string {
  let key = e.code === 'Backslash' ? '\\' : e.key === ' ' ? 'space' : (e.key || '').toLowerCase();
  if (e.code === 'Period' && (e.metaKey || e.ctrlKey)) key = '.';
  if (e.code === 'Comma' && (e.metaKey || e.ctrlKey)) key = ',';
  if (e.code === 'Slash' && (e.metaKey || e.ctrlKey)) key = '/';
  if (e.altKey && /^Digit\d$/.test(e.code)) key = e.code.slice(5);
  if (e.altKey && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase();
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  // Shift counts for letters and named keys; "?" already is shift+/.
  if (e.shiftKey && (key.length > 1 || /[a-z\\]/.test(key))) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

const CAPS: Record<string, string> = {
  mod: isMac ? '⌘' : 'Ctrl', shift: '⇧', alt: isMac ? '⌥' : 'Alt', escape: 'Esc', enter: 'Enter', space: 'Space',
  arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', backspace: 'Delete', delete: 'Delete', tab: 'Tab',
};
/** "mod+shift+f" → ["⌘", "⇧", "F"]. */
export function capsOf(combo: string): string[] {
  return combo.split('+').map((p) => CAPS[p] ?? (p.length === 1 ? p.toUpperCase() : p));
}

export function registerKey(b: KeyBinding): () => void {
  bindings.push({ scope: 'global', ...b });
  const stored = bindings[bindings.length - 1];
  return () => { const i = bindings.indexOf(stored); if (i >= 0) bindings.splice(i, 1); };
}

/** Everything registered (the sheet, tooltips, tests). */
export function allBindings(): readonly KeyBinding[] {
  return bindings;
}

/** The keys shown for a binding id (tooltips): "⌘\", "⌘[". */
export function keysFor(id: string): string | null {
  const b = bindings.find((x) => x.id === id);
  return b ? capsOf(combos(b)[0]).join('') : null;
}

/** Two bindings answering the same key in the same place with no condition to tell them apart. */
export function duplicateCombos(list: readonly KeyBinding[] = bindings): string[] {
  const seen = new Map<string, KeyBinding>();
  const out: string[] = [];
  for (const b of list) {
    if (b.when) continue;
    for (const c of combos(b)) {
      for (const tab of b.tabs ?? ['*']) {
        const k = `${b.scope ?? 'global'}|${tab}|${c}`;
        if (seen.has(k)) out.push(k); else seen.set(k, b);
      }
    }
  }
  return out;
}

export function dialogOpen(): boolean {
  return !!S.commandPaletteOpen || !!document.querySelector('.modal-ov.open, #ctx-menu.open');
}

export function typingIn(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest?.('.cm-editor'));
}

/** Which bindings may answer, in order: dialog → editor → list → global. */
export function candidates(combo: string, ctx: { dialog: boolean; typing: boolean; tab: string }): KeyBinding[] {
  const match = (b: KeyBinding) => combos(b).includes(combo) && (!b.tabs || b.tabs.includes(ctx.tab)) && (!b.when || b.when());
  const of = (scope: Scope) => bindings.filter((b) => (b.scope ?? 'global') === scope && match(b));
  if (ctx.dialog) return of('dialog');
  if (ctx.typing) return [...of('editor'), ...of('list').filter((b) => b.inInputs), ...of('global').filter((b) => b.inInputs)];
  return [...of('list'), ...of('global')];
}

let started = false;
export function startKeys(): void {
  if (started || typeof document === 'undefined') return;
  started = true;
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    const combo = comboOf(e);
    for (const b of candidates(combo, { dialog: dialogOpen(), typing: typingIn(e.target), tab: getActiveTabId() })) {
      if (b.run(e) !== false) { e.preventDefault(); return; }
    }
  });
}
