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
