import { describe, it, expect } from 'vitest';
import { designOptions } from './generateChoice';

const selected = (o: ReturnType<typeof designOptions>) => o.filter((x) => x.selected).map((x) => x.value);

describe('designOptions', () => {
  it('preselects the current design, with the 2026 master second', () => {
    const o = designOptions({ count: 13 }, true);
    expect(o.map((x) => x.value)).toEqual(['library', 'master']);
    expect(selected(o)).toEqual(['library']);
  });
  it('never preselects the 2026 master', () => {
    expect(selected(designOptions(null, true))).toEqual([]);
  });
});
