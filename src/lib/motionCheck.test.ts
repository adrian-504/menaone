import { describe, it, expect } from 'vitest';
// @ts-ignore -- Node's fs, in a test only (the app itself has no Node types).
import { readFileSync } from 'node:fs';
import { checkCraft, checkMotion, checkStates, expandSelectors, rules } from '../../scripts/motion-check.mjs';

const css: string = readFileSync(new URL('../styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c: string) => c.replace(/[^\n]/g, ' '));
const all = rules(css);

describe('motion and craft (scripts/motion-check.mjs)', () => {
  it('every transition and animation uses the tokens and allowed properties', () => {
    expect(checkMotion(all)).toEqual([]);
  });
  it('every interactive control has hover, pressed and focus-visible', () => {
    expect(checkStates(all)).toEqual([]);
  });
  it('radii, weights, control heights, dots and borders are on the scale', () => {
    expect(checkCraft(all)).toEqual([]);
  });
  it('catches what it should', () => {
    const bad = rules('.a{transition:width .3s ease}.b{border-radius:7px;font-weight:700}.c{animation:x 1s var(--ease-spring)}');
    expect(checkMotion(bad).map((p) => p.why)).toEqual(expect.arrayContaining(['animates width', 'literal duration in transition: width .3s ease', 'uses --ease-spring']));
    expect(checkCraft(bad).map((p) => p.why)).toEqual(['radius 7px', 'weight 700']);
    expect(expandSelectors(':is(.x,.y):hover, .z')).toEqual(['.x:hover', '.y:hover', '.z']);
  });
});
