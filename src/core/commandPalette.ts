import { keyTravel } from '../lib/motion';
import { registerKey } from './keys';
import { S } from '../lib/state';
import { briefCommandMatches } from '../lib/companyBrief';
import { escHtml, expose, strColor, today } from '../lib/utils';
import { initialsOf } from '../lib/appearance';
import { tileHtml } from '../lib/pageKit';
import { contextLine, doActions, groupResults, previewOf, type ActionKey, type DoAction, type PaletteData, type Preview } from '../lib/palette';
import { icon } from '../lib/icons';
import { searchWorkspace } from '../lib/db';
import { latestOnly } from '../lib/latest';
import { hitSubtitle } from '../lib/searchHit';
import { switchTab } from './nav';
import { openRecord, recentRecords, currentPlace, recordTitle } from './router';
import type { RecordKind } from '../lib/navHistory';
import { contextCreateActions } from './contextActions';
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
  const actions: Action[] = contextCreateActions();
  if (currentPlace().kind === 'company' && S.currentCompany) {
    const name = S.currentCompany;
    actions.push({ id: 'ctx-co-brief', label: `Brief ${name}`, group: 'This Company', iconName: 'document', run: () => (window as any).openCompanyBrief(name) });
    actions.push({ id: 'ctx-co-edit', label: `Edit ${name}`, group: 'This Company', iconName: 'edit', run: () => (window as any).openEditCompanyModal() });
  }
  return actions;
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
    { id: 'goto-promises-owe', label: 'What do I owe', group: 'Navigate', iconName: 'flag', run: () => { switchTab('todo'); (window as any).setTodoFilter('promises'); } },
    {
      id: 'goto-promises-owed', label: 'Owed to me', group: 'Navigate', iconName: 'flag',
      run: () => { switchTab('todo'); (window as any).setTodoFilter('promises'); setTimeout(() => document.getElementById('pm-owed')?.scrollIntoView({ block: 'start' }), 50); },
    },
    goTo('Opportunities', 'opportunities', 'briefcase'),
    goTo('Projects', 'projects', 'target'),
    goTo('Pending', 'pending', 'clock'),
    goTo('Notes', 'notes', 'note'),
    goTo('Companies', 'companies', 'building'),
    goTo('Contacts', 'contacts', 'people'),
    goTo('Follow-up', 'followup', 'warning'),
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
      id: 'new-commitment', label: 'New Commitment', group: 'Create', iconName: 'plus',
      run: () => (window as any).openCommitmentModal(),
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
    case 'commitment': return 'flag';
    default: return 'search';
  }
}

const RECORD_KINDS = new Set<EntityKind>(['company', 'contact', 'proposal', 'agreement', 'opportunity', 'project', 'meeting', 'note', 'task']);

function openSearchResult(r: SearchResult): void {
  // Companies are indexed by name (entity_id 0), everything else by id.
  if (r.entityType === 'company') { openRecord('company', r.entityId || r.title); return; }
  if (RECORD_KINDS.has(r.entityType)) { openRecord(r.entityType as RecordKind, r.entityId); return; }
  if (r.entityType === 'intelligence') { switchTab('intelligence'); (window as any).openIntelModal(r.entityId); }
  // A commitment opens where it lives: its meeting or note, else its opportunity, project or company.
  if (r.entityType === 'commitment') (window as any).openCommitmentSource?.(r.entityId);
}

let selIndex = 0;
type Item = { kind: 'action'; action: Action; sub?: string; shortcut?: string } | { kind: 'result'; result: SearchResult };
let currentItems: Item[] = [];
/** Where each group starts in the list, for ⌘1–9. */
let groupStarts: number[] = [];
let searchTimer: number | undefined;
/** Only the newest search may show its results (an older one can finish later). */
const search = latestOnly(searchWorkspace);

/** The records in memory, as the palette reads them: the context lines and the preview come from here, so moving
 * the selection never asks the backend for anything. */
const paletteData = (): PaletteData => ({
  today: today(), now: new Date(), companies: S.companies.map((c) => ({ id: c.id, name: c.name })), agreements: S.agreements, proposals: S.proposals, contacts: S.contacts,
  opportunities: S.opportunities, projects: S.projects, meetings: S.meetings, todos: S.todos, notes: S.notes, commitments: S.commitments,
});

export function openCommandPalette(): void {
  S.commandPaletteOpen = true;
  S.searchQuery = '';
  window.clearTimeout(searchTimer);
  search.cancel();
  const ov = document.getElementById('cmdk-ov');
  ov?.classList.remove('closing');
  ov?.classList.add('open');
  const input = document.getElementById('cmdk-input') as HTMLInputElement | null;
  if (input) { input.value = ''; setTimeout(() => input.focus(), 0); }
  renderPalette([]);
}
expose('openCommandPalette', openCommandPalette);

export function closeCommandPalette(): void {
  S.commandPaletteOpen = false;
  window.clearTimeout(searchTimer);
  search.cancel();
  const ov = document.getElementById('cmdk-ov');
  if (!ov?.classList.contains('open')) return;
  ov.classList.remove('open');
  // It leaves the way it came, faster (--dur-fast, --ease-in).
  if (!(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    ov.classList.add('closing');
    window.setTimeout(() => ov.classList.remove('closing'), 130);
  }
}
expose('closeCommandPalette', closeCommandPalette);

export function onPaletteInput(value: string): void {
  S.searchQuery = value;
  selIndex = 0;
  window.clearTimeout(searchTimer);
  search.cancel();
  if (!value.trim()) { renderPalette([]); return; }
  searchTimer = window.setTimeout(async () => {
    let answer;
    try {
      answer = await search.run(value.trim());
    } catch (err) {
      console.error('[palette] search failed:', err);
      answer = { current: true as const, value: [] as SearchResult[] };
    }
    if (!answer.current || !S.commandPaletteOpen) return;
    renderPalette(answer.value);
  }, 150);
}
expose('onPaletteInput', onPaletteInput);

const ICON_TINT: Partial<Record<EntityKind, string>> = { meeting: 'var(--blue)', project: 'var(--sub)', task: 'var(--blue)', note: 'var(--sub)', commitment: 'var(--coral-text)', intelligence: 'var(--amber)' };
const iconTile = (name: string, tint = 'var(--sub)', cls = 'cmdk-tile') => `<span class="${cls}" style="--c:${tint}">${icon(name, 15)}</span>`;
const personTile = (name: string, cls = 'cmdk-pav') => `<span class="${cls}" style="background:${strColor(name || '?')}" aria-hidden="true">${escHtml(initialsOf(name) || '·')}</span>`;

/** A result's tile: its company's (square), a person's (round), or its kind's icon. */
function tileFor(r: SearchResult, p: Preview | null, size: 'sm' | 'xl'): string {
  const t = p?.tile;
  if (t && 'name' in t) return t.round ? personTile(t.name, size === 'xl' ? 'cmdk-pav xl' : 'cmdk-pav') : tileHtml(t.name, size === 'xl' ? 'pk-tile xl' : 'pk-tile sm');
  return iconTile(t && 'icon' in t ? t.icon : entityIcon(r.entityType), ICON_TINT[r.entityType], size === 'xl' ? 'cmdk-tile xl' : 'cmdk-tile');
}

function renderPalette(results: SearchResult[]): void {
  const q = S.searchQuery.trim().toLowerCase();
  const data = paletteData();
  const actions = quickActions().filter((a) => !q || a.label.toLowerCase().includes(q));
  // "brief acme" from anywhere: the Brief of each matching company.
  for (const name of briefCommandMatches(S.searchQuery, S.companies.filter((c) => !c.archived).map((c) => c.name))) {
    if (!actions.some((a) => a.label === `Brief ${name}`)) actions.unshift({ id: `brief-${name}`, label: `Brief ${name}`, group: 'Brief', iconName: 'document', run: () => (window as any).openCompanyBrief(name) });
  }

  // Actions by their own group, first seen first (the open record's, then Navigate and Create).
  const actionGroups: { label: string; note?: string; items: Item[] }[] = [];
  for (const a of actions) {
    let g = actionGroups.find((x) => x.label === a.group);
    if (!g) { g = { label: a.group, items: [] }; actionGroups.push(g); }
    g.items.push({ kind: 'action', action: a });
  }
  // What the query suggests doing leads the actions: a new proposal for the company it found.
  const dos: Item[] = doActions(results, data).map((d: DoAction) => ({
    kind: 'action' as const, sub: d.sub, shortcut: d.shortcut,
    action: { id: `do-${d.key}`, label: d.label, group: 'Do', iconName: 'plus', run: () => (window as any).openAddModal?.(null, { client: d.company }) },
  }));
  if (dos.length) actionGroups.unshift({ label: 'Do', note: 'actions', items: dos });

  const resultGroups = groupResults(results).map((g) => ({ label: g.label, note: String(g.items.length), items: g.items.map((result): Item => ({ kind: 'result', result })) }));

  // With nothing typed, recently opened records come first.
  if (!q) {
    const recents: Item[] = recentRecords()
      .map((r) => ({ ...r, label: recordTitle(r.kind, r.key) ?? null }))
      .filter((r): r is typeof r & { label: string } => r.label != null)
      .map((r) => ({ kind: 'action' as const, action: { id: `recent-${r.kind}-${r.key}`, label: r.label, group: 'Recent', iconName: entityIcon(r.kind), run: () => openRecord(r.kind, r.key) } }));
    if (recents.length) actionGroups.unshift({ label: 'Recent', items: recents.slice(0, 5) });
  }

  // Typed: what was found, then what can be done. Nothing typed: where you were, then where you can go.
  const groups = [...resultGroups, ...actionGroups];
  currentItems = groups.flatMap((g) => g.items);
  groupStarts = [];
  selIndex = 0;

  // The preview pane is there while there are results to preview; with none, the list has the width.
  document.getElementById('cmdk-preview')?.parentElement?.classList.toggle('no-preview', results.length === 0);
  const count = document.getElementById('cmdk-count');
  if (count) count.textContent = q ? `in everything · ${results.length === 1 ? '1 result' : `${results.length} results`}` : '';
  const list = document.getElementById('cmdk-list');
  if (!list) return;
  if (currentItems.length === 0) {
    list.innerHTML = `<div class="cmdk-empty">No matches for "${escHtml(S.searchQuery)}"</div>`;
    renderPreview();
    return;
  }

  let html = '';
  let idx = 0;
  for (const g of groups) {
    groupStarts.push(idx);
    html += `<div class="cmdk-group-label"><span>${escHtml(g.label)}</span>${g.note ? `<em>${escHtml(g.note)}</em>` : ''}</div>`;
    html += g.items.map((it) => {
      const at = idx++;
      if (it.kind === 'action') return cmdkItemHtml(at, iconTile(it.action.iconName, it.action.group === 'Do' ? 'var(--navy)' : 'var(--sub)'), it.action.label, it.sub ? escHtml(it.sub) : '', it.shortcut || '');
      const line = contextLine(it.result, data);
      // Where the words were found inside a meeting or a note says why it is here; otherwise, where the record stands.
      const excerpt = hitSubtitle(it.result, S.meetings, S.searchQuery);
      const text = (it.result.entityType === 'meeting' || it.result.entityType === 'note') ? excerpt || line.text : line.text || excerpt;
      const sub = line.chip ? `<span class="pk-chip is-text t-${line.chip.tone}">${escHtml(line.chip.text)}</span>` : escHtml(text);
      return cmdkItemHtml(at, tileFor(it.result, previewOf(it.result, data), 'sm'), it.result.title, sub, '');
    }).join('');
  }
  list.innerHTML = html;
  renderPreview();
}

function cmdkItemHtml(idx: number, tile: string, label: string, subHtml: string, shortcut: string): string {
  return `<div class="cmdk-item${idx === selIndex ? ' sel' : ''}" data-idx="${idx}" role="option" aria-selected="${idx === selIndex}" onmousemove="setPaletteSel(${idx})" onclick="activatePaletteItem(${idx})">
    ${tile}<span class="cmdk-text"><span class="cmdk-label">${escHtml(label)}</span>${subHtml ? `<span class="cmdk-sub">${subHtml}</span>` : ''}</span>
    <span class="cmdk-kbd">${shortcut ? escHtml(shortcut) : '↵ open'}</span>
  </div>`;
}

/** The pane on the right: the selected result's tile, name, status, up to four figures and its quick actions. All
 * of it from the records in memory. An action (a page, a "New …") has nothing to preview. */
function renderPreview(): void {
  const el = document.getElementById('cmdk-preview');
  if (!el) return;
  const item = currentItems[selIndex];
  const p = item?.kind === 'result' ? previewOf(item.result, paletteData()) : null;
  if (!item || item.kind !== 'result' || !p) {
    el.innerHTML = `<div class="cmdk-pv-none">${item?.kind === 'action' ? escHtml(item.sub || item.action.group) : ''}</div>`;
    return;
  }
  el.innerHTML = `${tileFor(item.result, p, 'xl')}
    <h3 class="cmdk-pv-name">${escHtml(p.name)}</h3>
    ${p.status ? `<span class="cmdk-pv-status t-${p.status.tone}"><i></i>${escHtml(p.status.text)}</span>` : ''}
    ${p.figures.length ? `<div class="cmdk-pv-figs">${p.figures.map((f) => `<div class="cmdk-pv-fig"><b${f.tone && f.tone !== 'muted' ? ` class="t-${f.tone}"` : ''}>${escHtml(f.value)}</b><span>${escHtml(f.label)}</span></div>`).join('')}</div>` : ''}
    <div class="cmdk-pv-acts">${p.actions.map((a) => `<button type="button" class="btn-secondary btn-sm cmdk-pv-act" data-act="${a.key}" onclick="paletteAct('${a.key}')"><span>${escHtml(a.label)}</span>${a.shortcut ? `<kbd>${escHtml(a.shortcut)}</kbd>` : ''}</button>`).join('')}</div>`;
}

export function setPaletteSel(idx: number): void {
  if (idx === selIndex) return;
  selIndex = idx;
  document.querySelectorAll('#cmdk-list .cmdk-item').forEach((el, i) => { el.classList.toggle('sel', i === idx); el.setAttribute('aria-selected', String(i === idx)); });
  renderPreview();
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

/** A quick action on the selected result. False when it has no such action (the key then does nothing). */
export function paletteAct(key: ActionKey): boolean {
  const item = currentItems[selIndex];
  const p = item?.kind === 'result' ? previewOf(item.result, paletteData()) : null;
  if (!item || item.kind !== 'result' || !p || !p.actions.some((a) => a.key === key)) return false;
  const w = window as any;
  closeCommandPalette();
  if (key === 'open') openSearchResult(item.result);
  else if (key === 'email' && p.email) w.openExternalUrl?.(`mailto:${p.email}`);
  else if (key === 'proposal' && p.company) w.openAddModal?.(null, { client: p.company });
  else if (key === 'brief' && p.company) w.openCompanyBrief?.(p.company);
  else if (key === 'company' && p.company) openRecord('company', S.companies.find((c) => c.name === p.company)?.id ?? p.company);
  return true;
}
expose('paletteAct', paletteAct);

// The palette's own keys (⌘K and Esc are in core/appKeys.ts).
const palette = () => !!S.commandPaletteOpen;
const inActions = () => !!(document.activeElement as HTMLElement | null)?.closest?.('#cmdk-preview');
const move = (delta: number) => {
  // In the preview's actions the arrows move between them; in the list, between results.
  if (inActions()) {
    const acts = [...document.querySelectorAll<HTMLElement>('#cmdk-preview .cmdk-pv-act')];
    acts[Math.max(0, Math.min(acts.indexOf(document.activeElement as HTMLElement) + delta, acts.length - 1))]?.focus();
    return;
  }
  setPaletteSel(Math.max(0, Math.min(selIndex + delta, currentItems.length - 1)));
  keyTravel(document.querySelectorAll('#cmdk-list .cmdk-item')[selIndex], document.getElementById('cmdk-list'));
};
registerKey({ scope: 'dialog', combo: 'arrowdown', when: palette, run: () => move(1) });
registerKey({ scope: 'dialog', combo: 'arrowup', when: palette, run: () => move(-1) });
registerKey({ scope: 'dialog', combo: 'enter', when: palette, run: () => { if (inActions()) (document.activeElement as HTMLElement).click(); else activatePaletteItem(selIndex); } });
// ⇥ goes into the selected result's actions; ⇧⇥ comes back to the search box.
registerKey({ scope: 'dialog', combo: 'tab', when: palette, run: () => {
  const acts = [...document.querySelectorAll<HTMLElement>('#cmdk-preview .cmdk-pv-act')];
  if (!acts.length) return;
  const at = acts.indexOf(document.activeElement as HTMLElement);
  if (at === acts.length - 1) document.getElementById('cmdk-input')?.focus(); else acts[at + 1].focus();
} });
registerKey({ scope: 'dialog', combo: 'shift+tab', when: palette, run: () => { document.getElementById('cmdk-input')?.focus(); } });
registerKey({ scope: 'dialog', combo: 'mod+e', when: palette, run: () => { paletteAct('email'); } });
registerKey({ scope: 'dialog', combo: 'mod+b', when: palette, run: () => { paletteAct('brief'); } });
// ⌘↵: a new proposal for the selected company or opportunity; else what "Do" offers.
registerKey({ scope: 'dialog', combo: 'mod+enter', when: palette, run: () => {
  if (paletteAct('proposal')) return;
  const at = currentItems.findIndex((it) => it.kind === 'action' && it.action.group === 'Do');
  if (at >= 0) activatePaletteItem(at);
} });
// ⌘1–9: to the first row of that group.
for (let n = 1; n <= 9; n++) {
  registerKey({ scope: 'dialog', combo: `mod+${n}`, when: palette, run: () => {
    const at = groupStarts[n - 1];
    if (at == null) return;
    document.getElementById('cmdk-input')?.focus();
    setPaletteSel(at);
    keyTravel(document.querySelectorAll('#cmdk-list .cmdk-item')[at], document.getElementById('cmdk-list'));
  } });
}
