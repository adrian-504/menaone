// The backend only lets the interface write the app_meta keys listed in
// UI_META_KEYS (src-tauri/src/commands.rs). A key written here but missing
// there would fail at runtime, usually behind a `.catch(() => undefined)`
// that hides it — so this test reads both sides and compares.
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob(['../**/*.ts', '!../**/*.test.ts', '!../lib/devMock.ts'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;
const rust = import.meta.glob('../../src-tauri/src/commands.rs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function allowedKeys(): string[] {
  const src = Object.values(rust)[0] ?? '';
  const block = src.match(/pub const UI_META_KEYS: &\[&str\] = &\[([\s\S]*?)\];/);
  return block ? [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
}

/** Every key passed to setAppMeta, resolving `const NAME = '...'` in the same file. */
function writtenKeys(): { file: string; key: string | null; arg: string }[] {
  const out: { file: string; key: string | null; arg: string }[] = [];
  for (const [file, text] of Object.entries(sources)) {
    for (const m of text.matchAll(/setAppMeta\(\s*([^,)]+)\s*,/g)) {
      const arg = m[1].trim();
      if (/^key\s*:/.test(arg)) continue; // the definition in lib/db.ts
      const literal = arg.match(/^['"`]([^'"`$]+)['"`]$/);
      const constant = !literal && text.match(new RegExp(`const\\s+${arg}\\s*=\\s*['"]([^'"]+)['"]`));
      out.push({ file, key: literal?.[1] ?? (constant ? constant[1] : null), arg });
    }
  }
  return out;
}

describe('app_meta keys written by the interface', () => {
  it('finds both sides', () => {
    expect(allowedKeys().length).toBeGreaterThan(5);
    expect(writtenKeys().length).toBeGreaterThan(5);
  });

  it('are all allowed by the backend', () => {
    const allowed = new Set(allowedKeys());
    const problems = writtenKeys()
      .filter(({ key }) => key === null || !allowed.has(key))
      .map(({ file, key, arg }) => `${file}: ${key ?? `unresolvable key ${arg}`}`);
    expect(problems).toEqual([]);
  });
});
