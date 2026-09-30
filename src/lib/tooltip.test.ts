// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { tipFor, tipPlacement } from './tooltip';
import { checkMarkup } from '../../scripts/motion-check.mjs';

const html = (s: string) => { const d = document.createElement('div'); d.innerHTML = s; return d.firstElementChild!; };
const bounds = { top: 0, bottom: 900, width: 1440 };

describe('tooltips', () => {
  it('reads data-tip and data-key; an icon-only button falls back to its aria-label', () => {
    expect(tipFor(html('<button data-tip="Collapse sidebar" data-key="⌘\\">x</button>'))).toEqual({ tip: 'Collapse sidebar', key: '⌘\\' });
    expect(tipFor(html('<button aria-label="More"><svg></svg></button>'))).toEqual({ tip: 'More', key: null });
    expect(tipFor(html('<button aria-label="Save">Save</button>'))).toBeNull();
  });

  it('sits below, centred; above when there is no room below; inside the window', () => {
    expect(tipPlacement({ top: 100, bottom: 130, left: 200, right: 230 }, { width: 80, height: 24 }, bounds)).toEqual({ top: 136, left: 175, above: false });
    expect(tipPlacement({ top: 860, bottom: 890, left: 200, right: 230 }, { width: 80, height: 24 }, bounds)).toEqual({ top: 830, left: 175, above: true });
    expect(tipPlacement({ top: 100, bottom: 130, left: 0, right: 20 }, { width: 80, height: 24 }, bounds).left).toBe(6);
  });

  it('no button keeps a native title (the markup check)', () => {
    const sources = Object.entries(import.meta.glob(['../**/*.ts', '!../**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>);
    const index = Object.entries(import.meta.glob('../../index.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>);
    expect(checkMarkup([...sources, ...index])).toEqual([]);
    expect(checkMarkup([['x.ts', '<button class="a" title="Hi">']]).map((p) => p.why)).toEqual(['title on a button (use data-tip)']);
  });
});
