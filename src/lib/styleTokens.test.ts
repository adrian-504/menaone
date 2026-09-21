import { describe, expect, it } from 'vitest';
// @ts-ignore -- Node's fs, in a test only (the app itself has no Node types).
import { readFileSync } from 'node:fs';

// Read from disk: Vitest turns CSS imports, even ?raw ones, into empty modules.
const css: string = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

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

  it('keeps --muted at 4.5:1 or more on every background, in every theme', () => {
    const block = (selector: string) => {
      const start = css.indexOf(`${selector}{`);
      return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
    };
    const tokens = (text: string) => Object.fromEntries([...text.matchAll(/(--[a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\b/g)].map((m) => [m[1], m[2]]));
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const light = tokens(block(':root'));
    for (const theme of [':root', ':root[data-theme="dark"]', ':root[data-theme="graphite"]']) {
      const t = { ...light, ...tokens(block(theme)) };
      for (const bg of ['--bg', '--surface', '--surface-2', '--sidebar-bg', '--surface-flat']) {
        expect(contrast(t['--muted'], t[bg]), `${theme} --muted on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
