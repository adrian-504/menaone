import { describe, it, expect } from 'vitest';
import { designOptions } from './generateChoice';

const selected = (o: ReturnType<typeof designOptions>) => o.filter((x) => x.selected).map((x) => x.value);

describe('designOptions', () => {
  it('preselects the current design, with the 2026 master second', () => {
    const o = designOptions({ count: 13 }, true, [{ id: 4, name: 'Standard deck' }], 4);
    expect(o.map((x) => x.value)).toEqual(['library', 'master', '4']);
    expect(selected(o)).toEqual(['library']);
  });
  it('never preselects the 2026 master', () => {
    expect(selected(designOptions(null, true, [], null))).toEqual([]);
    expect(selected(designOptions(null, true, [{ id: 4, name: 'Standard deck' }], 4))).toEqual(['4']);
  });
  it('keeps the saved default for single templates when there is no library', () => {
    expect(selected(designOptions(null, false, [{ id: 3, name: 'A' }, { id: 4, name: 'B' }], 4))).toEqual(['4']);
  });
});
