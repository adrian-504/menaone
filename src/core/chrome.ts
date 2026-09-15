import { S } from '../lib/state';
import { expose } from '../lib/utils';
import { icon } from '../lib/icons';
import { showMenuAt, type ContextMenuItem } from '../lib/contextMenu';
import { contextCreateActions, contextRecordCompany } from './contextActions';

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

/** The sidebar's universal "+ New" button — replaces the old single-purpose
 * "+ Add Proposal" CTA with a quick-create menu covering every entity type
 * in the app. Routed through `window` rather than static imports (each
 * opener lives in its own tab module) — the same cross-module convention
 * the rest of the app already uses to avoid pulling every tab module into
 * this foundational, early-loaded file. Reuses the shared #ctx-menu popover
 * (showMenuAt) so it gets the exact same look, positioning, and
 * Escape/outside-click dismissal as every right-click menu in the app for
 * free — genuinely the same component, not a lookalike. */
const NEW_ITEM_TYPES: { label: string; iconName: string; run: () => void }[] = [
  { label: 'Task', iconName: 'check', run: () => (window as any).openTodoModal?.(null) },
  { label: 'Project', iconName: 'target', run: () => (window as any).openProjectModal?.(null) },
  { label: 'Meeting', iconName: 'meeting', run: () => (window as any).openMeetingModal?.(null) },
  { label: 'Opportunity', iconName: 'briefcase', run: () => (window as any).openOpportunityModal?.(null) },
  { label: 'Company', iconName: 'building', run: () => (window as any).openNewCompanyModal?.() },
  { label: 'Contact', iconName: 'people', run: () => (window as any).openContactModal?.(null) },
  { label: 'Proposal', iconName: 'database', run: () => (window as any).openAddModal?.(null) },
  { label: 'Agreement', iconName: 'document', run: () => (window as any).openAgrModal?.(null) },
  { label: 'Note', iconName: 'note', run: () => { (window as any).switchTab?.('notes'); (window as any).createNewNote?.(null); } },
];

/** "+ New" starts from where you are: the open record's own create actions
 * (a meeting from a project, a task from a meeting…), each inheriting its
 * context — then, inside a company's record, a contact or opportunity for
 * that company. */
function contextNewItems(): ContextMenuItem[] {
  const w = window as any;
  const items: ContextMenuItem[] = contextCreateActions().map((a) => ({ label: a.label.replace(/^New /, ''), iconName: a.iconName, run: a.run }));
  const company = contextRecordCompany();
  if (company) {
    const ctx = { companyId: company.id, companyName: company.name, projectId: null, opportunityId: null, meetingId: null, noteId: null };
    items.push(
      { label: `Opportunity for ${company.name}`, iconName: 'briefcase', run: () => w.openOpportunityModal?.(null, ctx) },
      { label: `Contact at ${company.name}`, iconName: 'people', run: () => w.openContactModal?.(company.name, company.id) },
    );
  }
  if (items.length) items.push({ label: '', run: () => {}, separator: true });
  return items;
}

export function toggleNewMenu(e: Event): void {
  e.stopPropagation();
  const menu = document.getElementById('ctx-menu');
  if (menu?.classList.contains('open')) { menu.classList.remove('open'); return; }
  const btn = document.getElementById('sb-new-btn') as HTMLElement | null;
  if (!btn) return;
  const items: ContextMenuItem[] = [...contextNewItems(), ...NEW_ITEM_TYPES.map((t) => ({ label: t.label, iconName: t.iconName, run: t.run }))];
  showMenuAt(btn, items);
}
expose('toggleNewMenu', toggleNewMenu);

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


// macOS-conventional shortcut: ⌘\ toggles the sidebar (matches Mail, Notes, Xcode, etc.)
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
    e.preventDefault();
    toggleSidebar();
  }
});
