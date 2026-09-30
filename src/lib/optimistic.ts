// Optimistic saves (owner, 30-Sep-2026: "it's the small things"): show the
// result at once, save in the background, and only if the save fails put things
// back and say so. Animate "done", never "processing" — no spinners.
//
// The tracked entities (tasks, commitments, proposals) are already saved this
// way by lib/persist.ts, with a retry on the next save instead of a revert; this
// helper is for the actions that wrote to the database first (follow-up touches,
// Inbox dismiss).

import { toast } from './ui';

export interface OptimisticStep<T> {
  /** Change the state and the page now. */
  apply: () => void;
  /** Write it; resolves with what the database returned. */
  commit: () => Promise<T>;
  /** Undo `apply` if the write failed. */
  revert: () => void;
}

export async function optimistic<T>({ apply, commit, revert }: OptimisticStep<T>): Promise<T | undefined> {
  apply();
  try {
    return await commit();
  } catch (err) {
    revert();
    toast("Couldn't save — try again", { tone: 'error', detail: String(err) });
    return undefined;
  }
}
