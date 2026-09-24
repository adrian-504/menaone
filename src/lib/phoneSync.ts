// When the Mac writes the phone's snapshot (docs/phone-sync.md, "Timing"):
// at start, ten seconds after the last data change, after every import, and
// at least hourly. A write whose content (everything but its timestamp) is
// the same as the last one is skipped — except once an hour, so the phone's
// "Updated on the Mac …" stays true while nothing changes.
//
// Never blocks the UI and never shows a toast: a failure is kept for the
// Settings → Phone block and logged. The app wiring (what to build it from,
// the Tauri calls) is in tabs/phone.ts.

import { onChange as onDataChange } from './changes';
import { snapshotContent, stableJson, type PhoneSnapshot } from './phoneSnapshot';

export const DEBOUNCE_MS = 10_000;
export const HEARTBEAT_MS = 60 * 60_000;

export interface PhoneSyncDeps {
  /** The snapshot as of now, or null when there is nothing to write yet (data still loading). */
  build: () => Promise<PhoneSnapshot | null>;
  /** Writes the JSON to the phone folder; resolves with the bytes written. */
  write: (json: string) => Promise<number>;
  onChange?: (fn: () => void) => () => void;
  now?: () => number;
  log?: (message: string, err: unknown) => void;
}

export interface PhoneSyncState {
  lastWriteAt: number | null;
  lastBytes: number | null;
  lastError: string | null;
  writes: number;
  skipped: number;
}

export interface PhoneSync {
  /** A data change: write ten seconds after the last one. */
  schedule(): void;
  /** Write now (at start, after an import, hourly). Skips unchanged content within the hour. */
  flush(): Promise<void>;
  start(): void;
  stop(): void;
  state(): PhoneSyncState;
}

export function createPhoneSync(deps: PhoneSyncDeps): PhoneSync {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? ((m, e) => console.warn(`[phone] ${m}`, e));
  const subscribe = deps.onChange ?? ((fn) => onDataChange(() => fn()));
  const st: PhoneSyncState = { lastWriteAt: null, lastBytes: null, lastError: null, writes: 0, skipped: 0 };
  let lastContent: string | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let hourly: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  // One write at a time; a flush asked for during one runs once after it.
  let running: Promise<void> | null = null;
  let again = false;

  async function writeOnce(): Promise<void> {
    let snap: PhoneSnapshot | null;
    try { snap = await deps.build(); } catch (err) { st.lastError = `Could not build the snapshot: ${String(err)}`; log('build failed', err); return; }
    if (!snap) return;
    const content = snapshotContent(snap);
    const fresh = st.lastWriteAt != null && now() - st.lastWriteAt < HEARTBEAT_MS;
    if (content === lastContent && fresh) { st.skipped++; return; }
    try {
      st.lastBytes = await deps.write(stableJson(snap));
      st.lastWriteAt = now();
      st.lastError = null;
      st.writes++;
      lastContent = content;
    } catch (err) {
      st.lastError = String(err);
      log('write failed', err);
    }
  }

  function flush(): Promise<void> {
    if (running) { again = true; return running; }
    running = (async () => {
      do { again = false; await writeOnce(); } while (again);
    })().finally(() => { running = null; });
    return running;
  }

  function schedule(): void {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { debounce = null; void flush(); }, DEBOUNCE_MS);
  }

  return {
    schedule,
    flush,
    start() {
      if (unsubscribe) return;
      unsubscribe = subscribe(schedule);
      hourly = setInterval(() => { void flush(); }, HEARTBEAT_MS);
      void flush();
    },
    stop() {
      unsubscribe?.(); unsubscribe = null;
      if (debounce) clearTimeout(debounce); debounce = null;
      if (hourly) clearInterval(hourly); hourly = null;
    },
    state: () => ({ ...st }),
  };
}
