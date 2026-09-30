// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { emptyState } from './ui';
import { icon } from './icons';

const sources = import.meta.glob('../**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const code = Object.entries(sources).filter(([p]) => !/\.test\.ts$/.test(p));

describe('empty states', () => {
  it('draw their icon themselves (the Inbox one was blank)', () => {
    const d = document.createElement('div');
    d.innerHTML = emptyState({ icon: 'inbox', title: 'Inbox zero' });
    expect(d.querySelector('.empty-state-icon svg')).not.toBeNull();
  });

  it('every icon an empty state asks for exists', () => {
    const names = code.flatMap(([, src]) => [...src.matchAll(/emptyState\(\{\s*icon:\s*'([a-zA-Z]+)'/g)].map((m) => m[1]));
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((n) => !icon(n))).toEqual([]);
  });

  it('one family: "No … yet", "All clear" as the positive form; no "Nothing …" titles', () => {
    const titles = code.flatMap(([, src]) => [...src.matchAll(/emptyState\(\{[^}]*?title:\s*'([^']+)'/g)].map((m) => m[1]));
    expect(titles.length).toBeGreaterThan(10);
    expect(titles.filter((t) => /^Nothing\b/.test(t))).toEqual([]);
  });
});
