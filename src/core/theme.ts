import { S } from '../lib/state';
import { expose } from '../lib/utils';
import { renderActiveTab } from '../lib/registry';
import type { ThemeId } from '../lib/types';

// ═══════════════ Theme (named color palettes, Bear-style) ═══════════════
// Every palette is a plain CSS [data-theme="id"] block in styles.css — this
// module only holds picker metadata (name/kind/swatch colors) plus the small
// amount of logic needed to apply/persist a choice. No theme follows system
// prefers-color-scheme; each is a fixed, explicitly-picked palette.

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
  { id: 'graphite', name: 'Graphite', kind: 'dark', swatchBg: '#1C1C1E', swatchSurface: '#242426', swatchAccent: '#8E8E93' },
  { id: 'sepia', name: 'Sepia', kind: 'light', swatchBg: '#F4EEE2', swatchSurface: '#FBF7EE', swatchAccent: '#A9662A' },
  { id: 'ocean', name: 'Ocean', kind: 'dark', swatchBg: '#0F1B2B', swatchSurface: '#16273C', swatchAccent: '#3FA7E0' },
  { id: 'forest', name: 'Forest', kind: 'light', swatchBg: '#F3F6F1', swatchSurface: '#FFFFFF', swatchAccent: '#2F7D4F' },
];

const THEME_KEY = 'menabig.theme';
const LEGACY_APPEARANCE_KEY = 'menabig.appearance';
const DEFAULT_THEME: ThemeId = 'light';

function isThemeId(v: string | null): v is ThemeId {
  return !!v && THEMES.some((t) => t.id === v);
}

function updateThemeIndicator(): void {
  document.documentElement.setAttribute('data-theme', S.theme);
}

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
    const stored = localStorage.getItem(THEME_KEY);
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
