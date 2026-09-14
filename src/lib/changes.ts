// Change bus: one place that announces "these records changed", whoever
// changed them — a save on this device today, a colleague's change arriving
// through sync later (Sprint 5). Views and chrome subscribe instead of every
// mutation site having to know which screens depend on it.
//
// Changes raised in the same tick are delivered together, once.

import type { EntityKind } from './types';

export interface Change {
  kind: EntityKind;
  /** Omitted when many or unknown records of this kind changed (e.g. a restore). */
  ids?: number[];
}

type Listener = (changes: Change[]) => void;

const listeners = new Set<Listener>();
let queued: Change[] = [];

export function onChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitChange(change: Change): void {
  if (queued.length === 0) queueMicrotask(flush);
  queued.push(change);
}

function flush(): void {
  const batch = queued;
  queued = [];
  for (const fn of listeners) {
    try { fn(batch); } catch (err) { console.error('[changes] listener failed:', err); }
  }
}

/** Whether a batch touches a given record (or any record of that kind). */
export function touches(changes: Change[], kind: EntityKind, id?: number): boolean {
  return changes.some((c) => c.kind === kind && (id == null || c.ids == null || c.ids.includes(id)));
}
