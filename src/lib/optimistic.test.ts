// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { optimistic } from './optimistic';

describe('optimistic saves', () => {
  it('applies before the write and keeps it when the write succeeds', async () => {
    const log: string[] = [];
    const out = await optimistic({ apply: () => log.push('apply'), commit: async () => { log.push('commit'); return 7; }, revert: () => log.push('revert') });
    expect(log).toEqual(['apply', 'commit']);
    expect(out).toBe(7);
  });

  it('reverts and says so when the write fails', async () => {
    document.body.innerHTML = '';
    let state = 'before';
    const out = await optimistic({ apply: () => { state = 'after'; }, commit: async () => { throw new Error('disk full'); }, revert: () => { state = 'before'; } });
    expect(out).toBeUndefined();
    expect(state).toBe('before');
    expect(document.querySelector('.toast-msg')?.textContent).toBe("Couldn't save — try again");
  });
});
