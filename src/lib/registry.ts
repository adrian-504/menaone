// Central dispatch so core mutation logic (status changes, deletes, imports...)
// never needs to import individual tab modules directly (which would create
// circular imports, since tab modules import core logic). Each tab module
// registers its render function on load; badge-updaters register too.
//
// After any data mutation, callers use `refreshAll()` rather than hand-picking
// which renderX()/updateYBadge() calls apply — the original app did this
// selectively and inconsistently (a real source of stale-UI bugs); re-rendering
// the active tab + all badges on every mutation is cheap at this data scale and
// removes that whole bug class.

type RenderFn = () => void;

const tabRenderers = new Map<string, RenderFn>();
const badgeUpdaters: RenderFn[] = [];

export function registerTabRenderer(tabId: string, fn: RenderFn): void {
  tabRenderers.set(tabId, fn);
}

export function registerBadgeUpdater(fn: RenderFn): void {
  badgeUpdaters.push(fn);
}

export function renderTab(tabId: string): void {
  tabRenderers.get(tabId)?.();
}

let currentTabId = 'dashboard';
export function setActiveTabId(tabId: string): void {
  currentTabId = tabId;
}
export function getActiveTabId(): string {
  return currentTabId;
}

export function renderActiveTab(): void {
  renderTab(currentTabId);
}

export function refreshBadges(): void {
  for (const fn of badgeUpdaters) fn();
}

export function refreshAll(): void {
  refreshBadges();
  renderActiveTab();
}

// Companies tab renders a derived, cross-entity view (proposals + contacts +
// agreements + notes + todos for one client). Rather than have proposals.ts /
// contacts.ts / agreements.ts import companies.ts directly (which would create
// an import cycle, since companies.ts needs openNotesModal/openAgrModal/etc
// from those same modules), they call this hook instead; companies.ts
// registers its own refresh logic here on load.
let companyViewRefresher: RenderFn | null = null;
export function registerCompanyViewRefresher(fn: RenderFn): void {
  companyViewRefresher = fn;
}
export function refreshCompanyViewIfOpen(): void {
  companyViewRefresher?.();
}

// Same pattern as the company view refresher above, for the Project workspace
// (todo.ts mutates tasks that a project's progress/task-list depends on, but
// can't import projects.ts directly — see companyViewRefresher comment).
let projectViewRefresher: RenderFn | null = null;
export function registerProjectViewRefresher(fn: RenderFn): void {
  projectViewRefresher = fn;
}
export function refreshProjectViewIfOpen(): void {
  projectViewRefresher?.();
}

// Navigation hook: switchTab and every open/close-record function call
// `notifyNavigated()` once the app is somewhere new, and the router (which
// imports tab modules indirectly via window) listens here — the same
// cycle-avoiding pattern as the view refreshers above.
let navigatedListener: RenderFn | null = null;
export function onNavigated(fn: RenderFn): void {
  navigatedListener = fn;
}
export function notifyNavigated(): void {
  navigatedListener?.();
}
