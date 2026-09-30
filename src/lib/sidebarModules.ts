// Sidebar modules on/off (identity slice, Settings → Appearance → Sidebar).
// Ahmad: "hide them in the sidebar, not remove the modules". An optional
// module can leave the sidebar; it still opens from the palette, record links,
// deep links and the Navigate menu, and while it is the page you're on its
// item shows in its group (so the selection has somewhere to land). A group
// with nothing left in it goes too. Remembered on this computer, like the tint.

export interface OptionalModule { tab: string; name: string; icon: string }

/** Modules that can be hidden; everything else in the sidebar is core and always shown. */
export const OPTIONAL_MODULES: OptionalModule[] = [
  { tab: 'action-required', name: 'Action Required', icon: 'mail' },
  { tab: 'agreements', name: 'Agreements', icon: 'document' },
  { tab: 'pricing', name: 'Services', icon: 'dollar' },
  { tab: 'intelligence', name: 'Watch', icon: 'bolt' },
  { tab: 'dashboard', name: 'Dashboard', icon: 'board' },
  { tab: 'reports', name: 'Reports', icon: 'export' },
  { tab: 'analytics', name: 'Analytics', icon: 'chartLine' },
];
const OPTIONAL = new Set(OPTIONAL_MODULES.map((m) => m.tab));
/** Off until you switch them on. */
const DEFAULT_SHOWN = false;
const KEY = 'menabig.sidebarModules';

type Choices = Record<string, boolean>;

function readChoices(): Choices {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

export function isOptional(tab: string): boolean { return OPTIONAL.has(tab); }

/** Whether a module is switched on in the sidebar (core modules always are). */
export function moduleShown(tab: string, choices: Choices = readChoices()): boolean {
  if (!OPTIONAL.has(tab)) return true;
  return choices[tab] ?? DEFAULT_SHOWN;
}

export function setModuleShown(tab: string, shown: boolean): void {
  const c = readChoices();
  c[tab] = shown;
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* not remembered */ }
}

/** Whether a sidebar item shows now: switched on, or it's the page you're on. Pure. */
export function itemVisible(tab: string, activeTab: string | null, choices: Choices): boolean {
  return moduleShown(tab, choices) || tab === activeTab;
}

/** Applies the switches to the sidebar: items, then groups with nothing visible, then their badges. */
export function applySidebarModules(activeTab: string | null = null): void {
  if (typeof document === 'undefined') return;
  const choices = readChoices();
  document.querySelectorAll<HTMLElement>('#sidebar .sb-item[data-tab]').forEach((el) => {
    const tab = el.dataset.tab!;
    if (!OPTIONAL.has(tab)) return;
    const show = itemVisible(tab, activeTab, choices);
    if (el.hidden === !show) return;
    el.hidden = !show;
  });
  document.querySelectorAll<HTMLElement>('#sidebar .sb-group').forEach((g) => {
    const any = [...g.querySelectorAll<HTMLElement>('.sb-item[data-tab]')].some((i) => !i.hidden && !i.classList.contains('ms365-hidden'));
    if (g.hidden === !any) return;
    g.hidden = !any;
  });
}

/** Before the first paint, and again whenever you move: the page you're on keeps its item. */
export function startSidebarModules(activeTab: () => string | null): void {
  applySidebarModules(null);
  if (typeof document !== 'undefined') document.addEventListener('app:navigated', () => applySidebarModules(activeTab()));
}
