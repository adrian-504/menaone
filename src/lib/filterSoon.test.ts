// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { filterSoon } from './utils';

afterEach(() => vi.useRealTimers());

describe('list search debounce (filterSoon)', () => {
  it('redraws once, 150 ms after the last keystroke, with the newest query', () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const input = document.createElement('input');
    (window as any).renderThings = () => seen.push(input.value);
    for (const q of ['a', 'ac', 'acm', 'acme']) { input.value = q; filterSoon('renderThings'); vi.advanceTimersByTime(60); }
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(150);
    expect(seen).toEqual(['acme']);
  });

  it('keeps one timer per list', () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    (window as any).renderA = () => calls.push('a');
    (window as any).renderB = () => calls.push('b');
    filterSoon('renderA'); filterSoon('renderB'); filterSoon('renderA');
    vi.advanceTimersByTime(200);
    expect(calls.sort()).toEqual(['a', 'b']);
  });

  it('every list search in index.html goes through it (or its own debounce)', () => {
    const html = Object.values(import.meta.glob('../../index.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0];
    const searches = [...html.matchAll(/<input[^>]*class="f-search[^"]*"[^>]*>/g)].map((m) => m[0]);
    expect(searches.length).toBeGreaterThan(8);
    const direct = searches.filter((s) => /oninput="render\w+\(\)"/.test(s));
    expect(direct).toEqual([]);
  });
});
