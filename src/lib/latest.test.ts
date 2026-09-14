import { describe, it, expect } from 'vitest';
import { latestOnly } from './latest';

/** A request whose answer arrives when the test says so. */
function controllable() {
  const pending = new Map<string, (v: string[]) => void>();
  const request = (q: string) => new Promise<string[]>((resolve) => pending.set(q, resolve));
  return { request, answer: (q: string) => pending.get(q)!([`result for ${q}`]) };
}

describe('latest request only', () => {
  it('ignores older searches that finish after a newer one', async () => {
    const { request, answer } = controllable();
    const search = latestOnly(request);
    const a = search.run('A');
    const ab = search.run('AB');
    const abc = search.run('ABC');
    answer('ABC');
    expect(await abc).toEqual({ current: true, value: ['result for ABC'] });
    answer('A');
    answer('AB');
    expect(await a).toEqual({ current: false });
    expect(await ab).toEqual({ current: false });
  });

  it('makes in-flight searches stale when cancelled', async () => {
    const { request, answer } = controllable();
    const search = latestOnly(request);
    const a = search.run('A');
    search.cancel();
    answer('A');
    expect(await a).toEqual({ current: false });
  });

  it('reports errors only for the current request', async () => {
    const search = latestOnly(async (q: string) => { if (q === 'bad') throw new Error('boom'); return q; });
    const stale = search.run('bad');
    const fresh = search.run('good');
    expect(await stale).toEqual({ current: false });
    expect(await fresh).toEqual({ current: true, value: 'good' });
    await expect(search.run('bad')).rejects.toThrow('boom');
  });
});
