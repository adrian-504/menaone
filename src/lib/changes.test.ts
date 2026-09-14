import { describe, it, expect } from 'vitest';
import { emitChange, onChange, touches, type Change } from './changes';

describe('change bus', () => {
  it('delivers changes raised together in one batch', async () => {
    const batches: Change[][] = [];
    const off = onChange((b) => batches.push(b));
    emitChange({ kind: 'task', ids: [1] });
    emitChange({ kind: 'company', ids: [3] });
    await Promise.resolve();
    off();
    expect(batches).toHaveLength(1);
    expect(touches(batches[0], 'company', 3)).toBe(true);
    expect(touches(batches[0], 'company', 4)).toBe(false);
    expect(touches([{ kind: 'note' }], 'note', 99)).toBe(true);
  });
});

describe('change bus listeners', () => {
  it('stops delivering after unsubscribe, and one failing listener does not block the others', async () => {
    const seen: string[] = [];
    const offA = onChange(() => { throw new Error('broken view'); });
    const offB = onChange((b) => seen.push(b.map((c) => c.kind).join(',')));
    const errors = console.error;
    console.error = () => {};
    emitChange({ kind: 'project', ids: [11] });
    await Promise.resolve();
    offB();
    emitChange({ kind: 'meeting', ids: [13] });
    await Promise.resolve();
    offA();
    console.error = errors;
    expect(seen).toEqual(['project']);
  });

  it('keeps separate ticks as separate batches', async () => {
    const batches: Change[][] = [];
    const off = onChange((b) => batches.push(b));
    emitChange({ kind: 'task', ids: [1] });
    await Promise.resolve();
    emitChange({ kind: 'task', ids: [2] });
    await Promise.resolve();
    off();
    expect(batches.map((b) => b[0].ids)).toEqual([[1], [2]]);
  });
});
