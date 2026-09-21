import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Read from disk: Vitest turns CSS imports into empty modules.
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

/** The stylesheet without its token blocks (`:root{…}` and `[data-theme]{…}`),
 * which are the only places a colour value may be written down. */
function outsideTokenBlocks(source: string): string {
  let out = '';
  let pos = 0;
  const head = /(^|\n)([^{}\n]*(?::root|\[data-theme[^\]]*\])[^{}\n]*)\{/g;
  let m: RegExpExecArray | null;
  while ((m = head.exec(source))) {
    const start = m.index + m[1].length;
    if (start < pos) continue;
    out += source.slice(pos, start);
    let depth = 0;
    let i = source.indexOf('{', start);
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) { i++; break; }
    }
    pos = i;
    head.lastIndex = i;
  }
  return out + source.slice(pos);
}

describe('styles.css colours', () => {
  it('writes colours only as tokens: no raw hex outside :root and the themes', () => {
    const rules = outsideTokenBlocks(css).replace(/\/\*[\s\S]*?\*\//g, '');
    const hex = rules.split('\n').filter((line) => /#[0-9A-Fa-f]{3,8}\b/.test(line));
    expect(hex).toEqual([]);
  });

  it('reads the stylesheet', () => {
    expect(css.length).toBeGreaterThan(10_000);
  });

  it('has one :root block', () => {
    expect(css.match(/(^|\n)\s*:root\s*\{/g)?.length).toBe(1);
  });
});
