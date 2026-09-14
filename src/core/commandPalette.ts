import { S } from '../lib/state';
import { escHtml, expose } from '../lib/utils';
import { icon } from '../lib/icons';
import { searchWorkspace } from '../lib/db';
import { switchTab } from './nav';
import { openRecord, recentRecords, currentPlace, recordTitle } from './router';
import type { RecordKind } from '../lib/navHistory';
import { getActiveTabId } from '../lib/registry';
import { createTodoForCurrentProject } from '../tabs/todo';
import { createProposalForOpportunity, createProjectForOpportunity, createNoteForOpportunity } from '../tabs/opportunities';
import type { EntityKind, SearchResult } from '../lib/types';

type Action = { id: string; label: string; group: string; iconName: string; run: () => void };

/** Static, always-available actions (navigation + fast-create). Filtered by
 * substring match against the query alongside live FTS results from the
 * backend — this is the "universal search + command palette" combined into
 * one input, per Part 8 (macOS convention: Spotlight/Alfred/Raycast all
 * merge navigation and search rather than splitting them). */
/** Context-scoped actions, prepended ahead of the generic list when the
 * palette opens while a Project or Opportunity workspace is open — per the
 * doc's "if I'm inside a Project, the palette should prioritize Project-
 * related commands" example. Calls functions that already exist (built in
 * Stage 2) — this only adds a new entry point, not new logic. */
function contextualActions(): Action[] {
  const tab = getActiveTabId();
  const place = currentPlace();
  if (place.kind === 'company' && S.currentCompany) {
    const name = S.currentCompany;
    const w = window as any;
    return [
      { id: 'ctx-co-task', label: `New Task for ${name}`, group: 'This Company', iconName: 'plus', run: () => w.createTodoForCompany(name) },
      { id: 'ctx-co-note', label: `New Note for ${name}`, group: 'This Company', iconName: 'plus', run: () => w.createNoteForCompany(name) },
      { id: 'ctx-co-meeting', label: `New Meeting for ${name}`, group: 'This Company', iconName: 'plus', run: () => w.createMeetingForCurrentCompany() },
      { id: 'ctx-co-project', label: `New Project for ${name}`, group: 'This Company', iconName: 'plus', run: () => w.createProjectForCurrentCompany() },
      { id: 'ctx-co-edit', label: `Edit ${name}`, group: 'This Company', iconName: 'edit', run: () => w.openEditCompanyModal() },
    ];
  }
  if (tab === 'projects' && S.currentProjectId != null) {
    return [
      { id: 'ctx-new-task', label: 'New Task in this Project', group: 'This Project', iconName: 'plus', run: () => createTodoForCurrentProject() },
    ];
  }
  if (tab === 'opportunities' && S.currentOpportunityId != null) {
    return [
      { id: 'ctx-new-proposal', label: 'Create Proposal for this Opportunity', group: 'This Opportunity', iconName: 'plus', run: () => createProposalForOpportunity() },
      { id: 'ctx-new-project', label: 'Create Project for this Opportunity', group: 'This Opportunity', iconName: 'plus', run: () => createProjectForOpportunity() },
      { id: 'ctx-new-note', label: 'New Note for this Opportunity', group: 'This Opportunity', iconName: 'plus', run: () => { void createNoteForOpportunity(); } },
    ];
  }
  return [];
}

function quickActions(): Action[] {
  const goTo = (label: string, tab: string, iconName: string): Action => ({
    id: `goto-${tab}`, label: `Go to ${label}`, group: 'Navigate', iconName,
    run: () => switchTab(tab),
  });
  return [
    ...contextualActions(),
    goTo('Dashboard', 'dashboard', 'home'),
    goTo('Tasks', 'todo', 'check'),
    goTo('Opportunities', 'opportunities', 'briefcase'),
    goTo('Projects', 'projects', 'target'),
    goTo('Pending', 'pending', 'clock'),
    goTo('Notes', 'notes', 'note'),
    goTo('Companies', 'companies', 'building'),
    goTo('Contacts', 'contacts', 'people'),
    goTo('Follow-Up', 'followup', 'warning'),
    goTo('Proposals', 'database', 'database'),
    goTo('Agreements', 'agreements', 'document'),
    goTo('Services and pricing', 'pricing', 'dollar'),
    goTo('Files', 'files', 'folder'),
    goTo('Reports', 'reports', 'chartBar'),
    goTo('Analytics', 'analytics', 'chartLine'),
    goTo('Settings', 'settings', 'gear'),
    ...(import.meta.env.DEV ? [goTo('Component Gallery', 'gallery', 'board')] : []),
    {
      id: 'new-task', label: 'New Task', group: 'Create', iconName: 'plus',
      run: () => { switchTab('todo'); (window as any).openTodoModal(null); },
    },
    {
      id: 'new-opportunity', label: 'New Opportunity', group: 'Create', iconName: 'plus',
      run: () => { switchTab('opportunities'); (window as any).openOpportunityModal(null); },
    },
    {
      id: 'new-project', label: 'New Project', group: 'Create', iconName: 'plus',
      run: () => { switchTab('projects'); (window as any).openProjectModal(null); },
    },
    {
      id: 'new-note', label: 'New Note', group: 'Create', iconName: 'plus',
      run: () => { switchTab('notes'); (window as any).createNewNote(); },
    },
    {
      id: 'new-proposal', label: 'New Proposal', group: 'Create', iconName: 'plus',
      run: () => (window as any).openAddModal(),
    },
  ];
}

function entityIcon(t: EntityKind): string {
  switch (t) {
    case 'note': return 'note';
    case 'project': return 'target';
    case 'task': return 'check';
    case 'company': return 'building';
    case 'contact': return 'people';
    case 'proposal': return 'database';
    case 'agreement': return 'document';
    case 'meeting': return 'meeting';
    case 'intelligence': return 'bolt';
    case 'opportunity': return 'briefcase';
    default: return 'search';
  }
}

const RECORD_KINDS = new Set<EntityKind>(['company', 'contact', 'proposal', 'agreement', 'opportunity', 'project', 'meeting', 'note', 'task']);

function openSearchResult(r: SearchResult): void {
  // Companies are indexed by name (entity_id 0), everything else by id.
  if (r.entityType === 'company') { openRecord('company', r.entityId || r.title); return; }
  if (RECORD_KINDS.has(r.entityType)) { openRecord(r.entityType as RecordKind, r.entityId); return; }
  if (r.entityType === 'intelligence') { switchTab('intelligence'); (window as any).openIntelModal(r.entityId); }
}

let selIndex = 0;
let currentItems: Array<{ kind: 'action'; action: Action } | { kind: 'result'; result: SearchResult }> = [];
let searchTimer: number | undefined;

export function openCommandPalette(): void {
  S.commandPaletteOpen = true;
  S.searchQuery = '';
  document.getElementById('cmdk-ov')?.classList.add('open');
  const input = document.getElementById('cmdk-input') as HTMLInputElement | null;
  if (input) { input.value = ''; setTimeout(() => input.focus(), 0); }
  renderPalette([]);
}
expose('openCommandPalette', openCommandPalette);

export function closeCommandPalette(): void {
  S.commandPaletteOpen = false;
  document.getElementById('cmdk-ov')?.classList.remove('open');
}
expose('closeCommandPalette', closeCommandPalette);

export function onPaletteInput(value: string): void {
  S.searchQuery = value;
  selIndex = 0;
  window.clearTimeout(searchTimer);
  if (!value.trim()) { renderPalette([]); return; }
  searchTimer = window.setTimeout(async () => {
    const results = await searchWorkspace(value.trim());
    renderPalette(results);
  }, 150);
}
expose('onPaletteInput', onPaletteInput);

/** Fixed, sensible display order for grouped search results — roughly
 * "business objects first, then work items, then reference material" —
 * rather than whatever order the backend's relevance ranking happens to
 * interleave entity types in. */
const ENTITY_GROUP_ORDER: EntityKind[] = ['company', 'opportunity', 'project', 'contact', 'task', 'note', 'meeting', 'proposal', 'agreement', 'intelligence'];
const ENTITY_GROUP_LABEL: Partial<Record<EntityKind, string>> = {
  company: 'Companies', opportunity: 'Opportunities', project: 'Projects', contact: 'Contacts',
  task: 'Tasks', note: 'Notes', meeting: 'Meetings', proposal: 'Proposals',
  agreement: 'Agreements', intelligence: 'Intelligence',
};

function renderPalette(results: SearchResult[]): void {
  const q = S.searchQuery.trim().toLowerCase();
  const actions = quickActions().filter((a) => !q || a.label.toLowerCase().includes(q));

  // Group actions by their own `group` field (contextual group first, since
  // contextualActions() is prepended in quickActions(), then Navigate/Create
  // in the order they're defined) — first-seen order, not alphabetical.
  const actionGroups: { label: string; items: Action[] }[] = [];
  for (const a of actions) {
    let g = actionGroups.find((x) => x.label === a.group);
    if (!g) { g = { label: a.group, items: [] }; actionGroups.push(g); }
    g.items.push(a);
  }

  // Group search results by entity type, in the fixed order above; anything
  // outside that list (shouldn't happen, but don't silently drop results if
  // a new entity type is ever indexed without updating this list) goes last.
  const resultGroups: { label: string; items: SearchResult[] }[] = [];
  for (const type of ENTITY_GROUP_ORDER) {
    const items = results.filter((r) => r.entityType === type);
    if (items.length > 0) resultGroups.push({ label: ENTITY_GROUP_LABEL[type] || type, items });
  }
  const known = new Set<string>(ENTITY_GROUP_ORDER);
  const rest = results.filter((r) => !known.has(r.entityType));
  if (rest.length > 0) resultGroups.push({ label: 'Other', items: rest });

  // With nothing typed, recently opened records come first.
  if (!q) {
    const recents: Action[] = recentRecords()
      .map((r) => ({ ...r, label: recordTitle(r.kind, r.key) ?? null }))
      .filter((r): r is typeof r & { label: string } => r.label != null)
      .map((r) => ({ id: `recent-${r.kind}-${r.key}`, label: r.label, group: 'Recent', iconName: entityIcon(r.kind), run: () => openRecord(r.kind, r.key) }));
    if (recents.length) actionGroups.unshift({ label: 'Recent', items: recents.slice(0, 5) });
  }

  currentItems = [
    ...actionGroups.flatMap((g) => g.items.map((action) => ({ kind: 'action' as const, action }))),
    ...resultGroups.flatMap((g) => g.items.map((result) => ({ kind: 'result' as const, result }))),
  ];
  selIndex = 0;

  const list = document.getElementById('cmdk-list');
  if (!list) return;
  if (currentItems.length === 0) {
    list.innerHTML = `<div class="cmdk-empty">No matches for "${escHtml(S.searchQuery)}"</div>`;
    return;
  }

  let html = '';
  let idx = 0;
  for (const g of actionGroups) {
    html += `<div class="cmdk-group-label">${escHtml(g.label)}</div>`;
    html += g.items.map((a) => cmdkItemHtml(idx++, a.iconName, a.label, '')).join('');
  }
  for (const g of resultGroups) {
    html += `<div class="cmdk-group-label">${escHtml(g.label)}</div>`;
    html += g.items.map((r) => cmdkItemHtml(idx++, entityIcon(r.entityType), r.title, '')).join('');
  }
  list.innerHTML = html;
  list.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    const name = el.getAttribute('data-icon');
    if (name) el.innerHTML = icon(name, 16);
  });
}

function cmdkItemHtml(idx: number, iconName: string, label: string, sub: string): string {
  return `<div class="cmdk-item${idx === selIndex ? ' sel' : ''}" data-idx="${idx}" onmouseenter="setPaletteSel(${idx})" onclick="activatePaletteItem(${idx})">
    <span data-icon="${iconName}"></span><span>${escHtml(label)}</span>${sub ? `<span class="cmdk-sub">${escHtml(sub)}</span>` : ''}
  </div>`;
}

export function setPaletteSel(idx: number): void {
  selIndex = idx;
  document.querySelectorAll('#cmdk-list .cmdk-item').forEach((el, i) => el.classList.toggle('sel', i === idx));
}
expose('setPaletteSel', setPaletteSel);

export function activatePaletteItem(idx: number): void {
  const item = currentItems[idx];
  if (!item) return;
  closeCommandPalette();
  if (item.kind === 'action') item.action.run();
  else openSearchResult(item.result);
}
expose('activatePaletteItem', activatePaletteItem);

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (S.commandPaletteOpen) closeCommandPalette(); else openCommandPalette();
    return;
  }
  if (!S.commandPaletteOpen) return;
  if (e.key === 'Escape') { e.preventDefault(); closeCommandPalette(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteSel(Math.min(selIndex + 1, currentItems.length - 1)); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); setPaletteSel(Math.max(selIndex - 1, 0)); return; }
  if (e.key === 'Enter') { e.preventDefault(); activatePaletteItem(selIndex); return; }
});
