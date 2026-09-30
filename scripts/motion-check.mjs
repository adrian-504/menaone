#!/usr/bin/env node
// Motion and craft check (docs/ux-conventions.md, "Motion" and "Craft"; owner,
// 30-Sep-2026: "premium apps make every single click feel nicer" — and "the
// motion thing extends to how the elements look as well as how they react").
// Reads src/styles.css and fails on:
//   motion  — a transition/animation with a literal duration or curve instead of
//             the tokens, an animated property outside the allowed set, any
//             --ease-spring, and interactive classes missing hover / pressed /
//             focus-visible rules;
//   craft   — radii off the scale, control heights off the grid, font weights
//             outside {450, 500, 600}, status dots not 7 px, borders in literal
//             colours.
// `node scripts/motion-check.mjs [--json]`; exits 1 when anything fails.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(root, 'src/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));

/** Every `selector { declarations }` with its line, @media wrappers skipped (their inner rules still match). */
function rules(text) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const selector = m[1].trim();
    if (selector.startsWith('@keyframes') || /^(from|to|\d+%)(\s*,\s*(from|to|\d+%))*$/.test(selector)) continue;
    const line = text.slice(0, m.index + m[0].indexOf(m[1].trimStart())).split('\n').length;
    const decls = m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const i = d.indexOf(':');
      return { prop: d.slice(0, i).trim().toLowerCase(), value: d.slice(i + 1).trim() };
    });
    out.push({ selector, line, decls });
  }
  return out;
}

export const ALLOWED_PROPS = new Set(['transform', 'opacity', 'color', 'background-color', 'border-color', 'box-shadow', 'outline-color', 'text-decoration-color', 'fill', 'stroke', 'visibility', 'grid-template-rows']);
export const RADII = new Set(['0', '6px', '9px', '13px', '18px', '50%', 'inherit']);
export const WEIGHTS = new Set(['450', '500', '600', 'inherit']);
export const HEIGHTS = new Set(['18px', '24px', '26px', '30px', '32px', '40px']);
const CONTROL = /(^|[\s,>+~])(\.btn-(primary|secondary|ghost|danger)|\.seg-btn|\.chip|\.rlink-chip|\.sb-item|\.ctx-menu-item|\.rec-badge|input|select|\.fsel|\.finp)(?![\w-])/;
const STATUS_DOT = /(^|[\s,.])(status-dot|pq-dot|sb-dot|ar-dot|mdy-dot-mark|dot)(?![\w-])/;

/** Values inside var(...) are tokens; strip them before looking for literals. */
const withoutVars = (v) => v.replace(/var\([^()]*(\([^()]*\))?[^()]*\)/g, '').replace(/!important/g, '');

export function checkMotion(all) {
  const problems = [];
  for (const r of all) {
    for (const d of r.decls) {
      if (!/^(transition|animation)(-duration|-timing-function)?$/.test(d.prop)) continue;
      if (/^(none|unset|initial)$/.test(d.value)) continue;
      // The reduced-motion switch: everything to 1ms.
      if (/^1ms\s*!important$/.test(d.value)) continue;
      const bare = withoutVars(d.value);
      if (/--ease-spring/.test(d.value)) problems.push({ line: r.line, selector: r.selector, why: 'uses --ease-spring' });
      if (/(^|[\s,(])\d*\.?\d+m?s\b/.test(bare)) problems.push({ line: r.line, selector: r.selector, why: `literal duration in ${d.prop}: ${d.value}` });
      if (/\b(ease|ease-in|ease-out|ease-in-out|linear)\b|cubic-bezier\(|steps\(/.test(bare)) problems.push({ line: r.line, selector: r.selector, why: `literal curve in ${d.prop}: ${d.value}` });
      if (d.prop === 'transition' || d.prop === 'transition-property') {
        for (const part of d.value.split(/,(?![^(]*\))/)) {
          const prop = part.trim().split(/\s+/)[0];
          if (prop && !ALLOWED_PROPS.has(prop)) problems.push({ line: r.line, selector: r.selector, why: `animates ${prop}` });
        }
      }
    }
  }
  return problems;
}

export const INTERACTIVE = ['btn-primary', 'btn-secondary', 'btn-ghost', 'btn-danger', 'seg-btn', 'chip', 'rlink-chip', 'rec-icon-btn', 'loc-nav',
  'rec-row', 'pq-row', 'mt-row', 'meeting-row', 'note-item', 'task-row', 'sb-item', 'cmdk-item', 'ctx-menu-item'];

/** "a, :is(.x,.y):hover" → ["a", ".x:hover", ".y:hover"] (one level of :is/:where). */
export function expandSelectors(selector) {
  const top = [];
  let depth = 0, cur = '';
  for (const ch of selector) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { top.push(cur.trim()); cur = ''; } else cur += ch;
  }
  top.push(cur.trim());
  return top.flatMap((sel) => {
    const m = /:(is|where)\(([^()]*)\)/.exec(sel);
    if (!m) return [sel];
    return m[2].split(',').map((alt) => sel.slice(0, m.index) + alt.trim() + sel.slice(m.index + m[0].length)).flatMap(expandSelectors);
  });
}

export function checkStates(all) {
  const selectors = all.flatMap((r) => expandSelectors(r.selector));
  const has = (cls, state) => selectors.some((s) => new RegExp(`\\.${cls}(?![\\w-])[^\\s]*${state.replace(/[.:()]/g, (c) => `\\${c}`)}`).test(s));
  return INTERACTIVE.flatMap((cls) => {
    const missing = [];
    if (!has(cls, ':hover')) missing.push(':hover');
    if (!has(cls, ':active') && !has(cls, '.is-pressed')) missing.push(':active');
    if (!has(cls, ':focus-visible')) missing.push(':focus-visible');
    return missing.length ? [{ selector: `.${cls}`, why: `no ${missing.join(', ')}` }] : [];
  });
}

export function checkCraft(all) {
  const problems = [];
  for (const r of all) {
    for (const d of r.decls) {
      const bare = withoutVars(d.value).trim();
      if (d.prop === 'border-radius' && bare) {
        for (const v of bare.split(/\s+/)) if (!RADII.has(v)) problems.push({ line: r.line, selector: r.selector, why: `radius ${d.value}` });
      }
      if (d.prop === 'font-weight' && bare && !WEIGHTS.has(bare)) problems.push({ line: r.line, selector: r.selector, why: `weight ${d.value}` });
      if ((d.prop === 'height' || d.prop === 'min-height') && bare && /px$/.test(bare) && CONTROL.test(r.selector) && !/::(before|after)|checkbox|radio|range/.test(r.selector) && !HEIGHTS.has(bare)) {
        problems.push({ line: r.line, selector: r.selector, why: `${d.prop} ${d.value} off the grid` });
      }
      if ((d.prop === 'width' || d.prop === 'height') && STATUS_DOT.test(r.selector) && /^\d+px$/.test(bare) && parseInt(bare, 10) <= 12 && bare !== '7px') {
        problems.push({ line: r.line, selector: r.selector, why: `status dot ${d.prop} ${d.value}` });
      }
      if (/^border(-(top|right|bottom|left))?(-color)?$/.test(d.prop) && /#[0-9a-f]{3,8}\b|rgba?\(|\b(gray|grey|silver|black|white)\b/i.test(bare)) {
        problems.push({ line: r.line, selector: r.selector, why: `literal border colour ${d.value}` });
      }
    }
  }
  return problems;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const all = rules(css);
  const result = { motion: checkMotion(all), states: checkStates(all), craft: checkCraft(all) };
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 1));
  else {
    for (const [pass, list] of Object.entries(result)) {
      console.log(`${list.length ? '✗' : '✓'} ${pass.padEnd(7)} ${list.length} problem${list.length === 1 ? '' : 's'}`);
      for (const p of list.slice(0, 400)) console.log(`   ${p.line ? `styles.css:${p.line} ` : ''}${p.selector.slice(0, 70)} — ${p.why}`);
    }
  }
  process.exit(Object.values(result).some((l) => l.length) ? 1 : 0);
}
export { rules };
