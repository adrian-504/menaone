import { describe, it, expect } from 'vitest';
// @ts-ignore -- Node's fs and process, in a test only.
import { readFileSync } from 'node:fs';

// @ts-ignore
const root = process.cwd();
const html: string = readFileSync(`${root}/index.html`, 'utf8');
const css: string = readFileSync(`${root}/src/styles.css`, 'utf8');
const sectionIds = (block: string) => [...block.matchAll(/<section[^>]*id="(myday-[a-z]+-sec)"/g)].map((m) => m[1]);
const between = (a: string, b: string) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));

describe('My Day order (1.58, owner)', () => {
  it('main column: Now, Today, Needs your attention', () => {
    expect(sectionIds(between('<div class="mdy-main">', '<aside class="mdy-rail">'))).toEqual(['myday-now-sec', 'myday-today-sec', 'myday-attention-sec']);
  });
  it('rail: Coming up, Proposals in play, Regulatory', () => {
    expect(sectionIds(between('<aside class="mdy-rail">', '</aside>'))).toEqual(['myday-upcoming-sec', 'myday-inplay-sec', 'myday-reg-sec']);
  });
  it('stacked under 1,101px: Now, Today, attention, coming up, proposals, regulatory', () => {
    const orders = [...css.matchAll(/#(myday-[a-z]+-sec)\{order:(\d+)\}/g)].map((m) => [m[1], Number(m[2])] as const);
    expect(orders.sort((a, b) => a[1] - b[1]).map(([id]) => id)).toEqual(['myday-now-sec', 'myday-today-sec', 'myday-attention-sec', 'myday-upcoming-sec', 'myday-inplay-sec', 'myday-reg-sec']);
  });
});
