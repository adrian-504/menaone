import { S } from '../lib/state';
import { expose } from '../lib/utils';
import { renderActiveTab } from '../lib/registry';
import type { ThemeId } from '../lib/types';

// ═══════════════ Theme ═══════════════
// Light, Dark, Auto and Graphite. Light is :root in styles.css; Dark and
// Graphite are [data-theme="id"] blocks. Auto follows the Mac's appearance
// (prefers-color-scheme): it has no palette of its own, the page gets
// data-theme="light" or "dark" and switches when the system does. This
// module holds picker metadata and applies/persists the choice.

export type { ThemeId };

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  kind: 'light' | 'dark';
  /** Small preview colors for the Settings swatch button — not the full palette. */
  swatchBg: string;
  swatchSurface: string;
  swatchAccent: string;
}

export const THEMES: ThemeMeta[] = [
  { id: 'light', name: 'Light', kind: 'light', swatchBg: '#F5F4FB', swatchSurface: '#FFFFFF', swatchAccent: '#2A5FE0' },
  { id: 'dark', name: 'Dark', kind: 'dark', swatchBg: '#19191B', swatchSurface: '#212123', swatchAccent: '#5B8AF0' },
  { id: 'auto', name: 'Auto', kind: 'light', swatchBg: '#19191B', swatchSurface: '#FFFFFF', swatchAccent: '#2A5FE0' },
  { id: 'graphite', name: 'Graphite', kind: 'dark', swatchBg: '#1C1C1E', swatchSurface: '#242426', swatchAccent: '#8E8E93' },
];

/** Themes that were retired (Sepia, Ocean, Forest): anyone on one moves to Light. */
const RETIRED_THEMES = new Set(['sepia', 'ocean', 'forest']);

const THEME_KEY = 'menabig.theme';
const LEGACY_APPEARANCE_KEY = 'menabig.appearance';
const DEFAULT_THEME: ThemeId = 'light';

function isThemeId(v: string | null): v is ThemeId {
  return !!v && THEMES.some((t) => t.id === v);
}

const systemDark = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

/** The palette actually shown: Auto resolves to Light or Dark. */
export function resolvedTheme(id: ThemeId = S.theme): Exclude<ThemeId, 'auto'> {
  return id === 'auto' ? (systemDark?.matches ? 'dark' : 'light') : id;
}

function updateThemeIndicator(): void {
  document.documentElement.setAttribute('data-theme', resolvedTheme());
}

// Auto follows the system as it changes (e.g. macOS switching at sunset).
systemDark?.addEventListener?.('change', () => { if (S.theme === 'auto') applyTheme(); });

export function applyTheme(): void {
  updateThemeIndicator();
  // Charts resolve CSS var colors only at creation time (see themeColor() in
  // lib/utils.ts) — re-render the active tab so any visible canvas picks up
  // the new palette immediately instead of waiting for the next tab switch.
  renderActiveTab();
}

/** Direct setter — used by the Settings theme picker and the native menu bar. */
export function setTheme(id: ThemeId): void {
  if (!isThemeId(id)) return;
  S.theme = id;
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch {
    /* ignore */
  }
  applyTheme();
}
expose('setTheme', setTheme);

/** Called synchronously before first paint (src/main.ts), so this only sets
 * the DOM attribute/indicator directly rather than going through applyTheme()
 * — at this point in boot no tab has rendered yet, so triggering a chart
 * re-render here would be pointless (and would run against still-empty
 * S.proposals/etc, before the async data load completes). */
export function initTheme(): void {
  try {
    let stored = localStorage.getItem(THEME_KEY);
    if (stored && RETIRED_THEMES.has(stored)) {
      stored = DEFAULT_THEME;
      localStorage.setItem(THEME_KEY, stored);
    }
    if (isThemeId(stored)) {
      S.theme = stored;
    } else {
      // One-time migration from the old 3-state appearance toggle.
      const legacy = localStorage.getItem(LEGACY_APPEARANCE_KEY);
      S.theme = legacy === 'dark' ? 'dark' : DEFAULT_THEME;
      localStorage.setItem(THEME_KEY, S.theme);
      localStorage.removeItem(LEGACY_APPEARANCE_KEY);
    }
  } catch {
    S.theme = DEFAULT_THEME;
  }
  updateThemeIndicator();
}
