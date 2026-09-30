// Offline awareness for Outlook (foundations O3). When Microsoft can't be
// reached — no network, DNS, a timeout — that's "Offline — will retry", not an
// error: a quiet mark where "Last synced" appears, no red, no dialog, and the
// sync that failed is tried again after 1, 2, then every 5 minutes (at once
// when the Mac comes back online). Throttling (429/503) is unchanged: the
// backend already waits those out.

import { S } from './state';

const REACH = /Could not reach Microsoft|error sending request|dns error|failed to lookup|timed out|operation timed out|network is unreachable|connection refused|Internet connection appears to be offline/i;
const BACKOFF_MIN = [1, 2, 5];

/** Is this failure "we're offline" rather than a real error? */
export function isOfflineError(err: unknown): boolean {
  return (typeof navigator !== 'undefined' && navigator.onLine === false) || REACH.test(String(err));
}

/** When the next try goes, in minutes, after `attempt` failed tries. Pure. */
export function backoffMinutes(attempt: number): number {
  return BACKOFF_MIN[Math.min(attempt, BACKOFF_MIN.length - 1)];
}

const retries = new Map<string, () => Promise<unknown>>();
let attempt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function repaint(): void {
  const w = window as any;
  w.paintActionRequired?.();
  w.paintCalendarSyncSub?.();
  w.renderMs365Status?.();
}

function retryAll(): void {
  clearTimeout(timer);
  timer = undefined;
  attempt += 1;
  for (const run of [...retries.values()]) void run();
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(retryAll, backoffMinutes(attempt) * 60_000);
}

/**
 * After a sync: pass the error (or null on success) and how to try again.
 * Returns true when the failure was "offline" and has been handled — the
 * caller then shows nothing else.
 */
export function noteSync(key: string, err: unknown | null, retry: () => Promise<unknown>): boolean {
  if (err == null) {
    retries.delete(key);
    if (!retries.size && S.ms365Offline) { S.ms365Offline = false; attempt = 0; clearTimeout(timer); timer = undefined; repaint(); }
    return false;
  }
  if (!isOfflineError(err)) return false;
  retries.set(key, retry);
  if (!S.ms365Offline) { S.ms365Offline = true; repaint(); }
  schedule();
  return true;
}

/** The quiet mark shown where "Last synced" goes. */
export const OFFLINE_LABEL = 'Offline — will retry';

if (typeof window !== 'undefined') window.addEventListener('online', () => { if (retries.size) retryAll(); });
