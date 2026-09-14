// Overlapping async requests where only the newest answer matters (search as
// you type): an older request that finishes late is reported as stale, so it
// can't overwrite what the newer one shows.

export type Latest<R> = { current: true; value: R } | { current: false };

export function latestOnly<A extends unknown[], R>(request: (...args: A) => Promise<R>) {
  let seq = 0;
  return {
    async run(...args: A): Promise<Latest<R>> {
      const mine = ++seq;
      try {
        const value = await request(...args);
        return mine === seq ? { current: true, value } : { current: false };
      } catch (err) {
        if (mine !== seq) return { current: false };
        throw err;
      }
    },
    /** Makes every request still in flight stale (e.g. the input was cleared). */
    cancel(): void {
      seq++;
    },
  };
}
