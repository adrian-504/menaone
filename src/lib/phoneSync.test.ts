import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPhoneSync, DEBOUNCE_MS, HEARTBEAT_MS } from './phoneSync';
import { buildPhoneSnapshot, snapshotShapeErrors, type PhoneSnapshot } from './phoneSnapshot';
import { phoneFixture } from './__fixtures__/phoneFixture';

function harness(initial = phoneFixture()) {
  let input = initial;
  let clock = 0;
  const writes: string[] = [];
  let listener: (() => void) | null = null;
  const sync = createPhoneSync({
    build: async () => buildPhoneSnapshot({ ...input, generatedAt: `t${clock}` }),
    write: async (json) => { writes.push(json); return json.length; },
    onChange: (fn) => { listener = fn; return () => { listener = null; }; },
    now: () => clock,
    log: () => undefined,
  });
  return {
    sync, writes,
    change: (next = input) => { input = next; listener?.(); },
    advance: async (ms: number) => { clock += ms; await vi.advanceTimersByTimeAsync(ms); },
    setInput: (next: typeof input) => { input = next; },
  };
}

describe('phoneSync', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('writes at start, as valid JSON of the contract shape', async () => {
    const h = harness();
    h.sync.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.writes).toHaveLength(1);
    const parsed = JSON.parse(h.writes[0]) as PhoneSnapshot;
    expect(snapshotShapeErrors(parsed)).toEqual([]);
    h.sync.stop();
  });

  it('a burst of changes writes once, ten seconds after the last', async () => {
    const h = harness();
    h.sync.start();
    await vi.advanceTimersByTimeAsync(0);
    const f = phoneFixture();
    f.todos[0] = { ...f.todos[0], title: 'Renamed' };
    h.change(f);
    await h.advance(DEBOUNCE_MS - 1000);
    h.change(f);
    await h.advance(DEBOUNCE_MS - 1000);
    expect(h.writes).toHaveLength(1);
    await h.advance(1000);
    expect(h.writes).toHaveLength(2);
    expect(h.writes[1]).toContain('Renamed');
    h.sync.stop();
  });

  it('skips a write when only the timestamp would change', async () => {
    const h = harness();
    h.sync.start();
    await vi.advanceTimersByTimeAsync(0);
    h.change();
    await h.advance(DEBOUNCE_MS);
    expect(h.writes).toHaveLength(1);
    expect(h.sync.state().skipped).toBe(1);
    h.sync.stop();
  });

  it('still writes hourly when nothing changed, so the phone knows the Mac is alive', async () => {
    const h = harness();
    h.sync.start();
    await vi.advanceTimersByTimeAsync(0);
    await h.advance(HEARTBEAT_MS);
    expect(h.writes).toHaveLength(2);
    h.sync.stop();
  });

  it('a failed write is kept for Settings and retried next time', async () => {
    let fail = true;
    const sync = createPhoneSync({
      build: async () => buildPhoneSnapshot(phoneFixture()),
      write: async (json) => { if (fail) throw new Error('disk full'); return json.length; },
      onChange: () => () => undefined, log: () => undefined,
    });
    await sync.flush();
    expect(sync.state()).toMatchObject({ lastError: 'Error: disk full', writes: 0 });
    fail = false;
    await sync.flush();
    expect(sync.state()).toMatchObject({ lastError: null, writes: 1 });
  });

  it('nothing to build yet: no write, no error', async () => {
    const write = vi.fn(async () => 0);
    const sync = createPhoneSync({ build: async () => null, write, onChange: () => () => undefined });
    await sync.flush();
    expect(write).not.toHaveBeenCalled();
    expect(sync.state().lastError).toBeNull();
  });
});
