import { S } from '../lib/state';
import { expose } from '../lib/utils';
import { icon } from '../lib/icons';

/** Renders every `[data-icon]` placeholder in the current DOM using the
 * shared icon set (src/lib/icons.ts) — keeps SVG path data in one place
 * instead of duplicating it into index.html's static markup. Safe to call
 * repeatedly (e.g. after a view re-render introduces new placeholders). */
export function renderIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    const name = el.getAttribute('data-icon');
    if (!name || el.dataset.iconRendered === name) return;
    const size = el.dataset.iconSize ? Number(el.dataset.iconSize) : 18;
    el.innerHTML = icon(name, size);
    el.dataset.iconRendered = name;
  });
}

/** Every `.ms365-hidden` element (Calendar, Action Required, the Settings
 * shortcut button) is meant to appear once Microsoft 365 is connected — but
 * nothing ever removed the class, so those stayed permanently hidden
 * regardless of connection status. Call this whenever S.ms365Status is set
 * or changes (app startup, connect/disconnect) to keep the sidebar honest. */
export function applyMs365SidebarVisibility(): void {
  const connected = S.ms365Status?.status === 'connected';
  // Queried by the stable data-attribute rather than the .ms365-hidden class
  // itself — once an element's class is removed it would no longer match a
  // `.ms365-hidden` selector, so a later disconnect could never re-hide it.
  document.querySelectorAll<HTMLElement>('[data-ms365-gated]').forEach((el) => {
    el.classList.toggle('ms365-hidden', !connected);
  });
}

// The sidebar's "+ New" menu is core/newMenu.ts.

const SIDEBAR_COLLAPSED_KEY = 'menabig.sidebarCollapsed';

export function applySidebarCollapsed(): void {
  const sidebar = document.getElementById('sidebar');
  const main = document.getElementById('app-main');
  sidebar?.classList.toggle('collapsed', S.sidebarCollapsed);
  main?.classList.toggle('sidebar-collapsed', S.sidebarCollapsed);
}

export function toggleSidebar(): void {
  S.sidebarCollapsed = !S.sidebarCollapsed;
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, S.sidebarCollapsed ? '1' : '0');
  } catch {
    /* localStorage unavailable — collapse state just won't persist across launches */
  }
  applySidebarCollapsed();
}
expose('toggleSidebar', toggleSidebar);

export function initSidebarCollapsed(): void {
  try {
    S.sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    S.sidebarCollapsed = false;
  }
  applySidebarCollapsed();
}


// macOS-conventional shortcut: ⌘\ toggles the sidebar (matches Mail, Notes, Xcode, etc.);
// ⇧⌘\ the list beside a record (closed unless you open it).
// ⌘\ and ⇧⌘\ are registered keys (core/appKeys.ts).
