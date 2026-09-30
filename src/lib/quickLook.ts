// Quick Look (foundations F3): Space on a file, or "Quick Look" in its
// right-click menu, shows it in macOS Quick Look as Finder does — for a file
// on this Mac (OneDrive's copies included), not a web link. When the preview
// closes, the keyboard goes back to the row it came from. Files registers its
// own Space (its rows are selected, not focused); anywhere else, a row marked
// data-ql-path="…" — a proposal's decks and documents, its folder list — gets
// Space and the menu from here.

import { filesOpen, filesQuickLook, filesRevealInFinder } from './db';
import { toast } from './ui';
import { showContextMenu } from './contextMenu';
import { registerKey } from '../core/keys';

/** The file a row stands for, if it is one Quick Look can show. */
export function qlPathOf(el: Element | null): string | null {
  const row = el?.closest?.<HTMLElement>('[data-ql-path]');
  return row?.dataset.qlPath || null;
}

export async function quickLook(path: string, returnTo?: () => HTMLElement | null): Promise<void> {
  try {
    await filesQuickLook(path);
  } catch (err) {
    toast("Couldn't preview this file", { tone: 'error', detail: String(err) });
  }
  const el = returnTo?.();
  if (el?.isConnected) el.focus({ preventScroll: true });
}

function rowFor(path: string): () => HTMLElement | null {
  return () => [...document.querySelectorAll<HTMLElement>('[data-ql-path]')].find((el) => el.dataset.qlPath === path) ?? null;
}

let started = false;
export function startQuickLook(): void {
  if (started) return;
  started = true;
  registerKey({
    combo: 'space', label: 'Quick Look the file', group: 'Everywhere',
    when: () => !!qlPathOf(document.activeElement),
    run: () => { const path = qlPathOf(document.activeElement)!; void quickLook(path, rowFor(path)); },
  });
  document.addEventListener('contextmenu', (e) => {
    const target = e.target as Element | null;
    const path = qlPathOf(target);
    if (!path || target?.closest('button, a, input')) return;
    showContextMenu(e, [
      { label: 'Quick Look', iconName: 'eye', run: () => { void quickLook(path, rowFor(path)); } },
      { label: 'Open', iconName: 'document', run: () => { filesOpen(path).catch((err) => toast("Couldn't open the file", { tone: 'error', detail: String(err) })); } },
      { label: 'Show in Finder', iconName: 'folder', run: () => { filesRevealInFinder(path).catch((err) => toast("Couldn't show the file", { tone: 'error', detail: String(err) })); } },
    ]);
  });
}
