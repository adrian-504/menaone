// Files: a Finder-style browser for the user's OneDrive, read directly from
// this Mac's Finder-synced ~/Library/CloudStorage/OneDrive-* folders — not via
// the Microsoft Graph API, so no Microsoft 365 connection is needed. "Open"
// hands off to the native app exactly like double-clicking in Finder. Files
// are never copied into MENA One; only references and business context
// (Company/Project links, Notes) live in its database, via entity_links and
// the modals in core/msFilesSetup.ts and core/msFilesInspector.ts.
//
// Layout: places sidebar (locations, favourites, recent, linked) · toolbar
// (up, path bar, search, sort, list/icons) · items · info panel for the
// selected item. Single click selects, double-click or Enter opens.

import { S } from '../lib/state';
import { escHtml, expose, fmtDateFromIso } from '../lib/utils';
import { registerTabRenderer, getActiveTabId } from '../lib/registry';
import { showContextMenu } from '../lib/contextMenu';
import { icon } from '../lib/icons';
import { emptyState, skeleton, toast } from '../lib/ui';
import { renderIcons } from '../core/chrome';
import { filesListRoots, filesListFolder, filesOpen, filesRevealInFinder, filesListLinked, filesStatPaths, getAppMeta, setAppMeta } from '../lib/db';
import { openMsFilesSetupWizard, openMsFilesLinkModal } from '../core/msFilesSetup';
import { openMsFilesInspector } from '../core/msFilesInspector';
import type { LocalFileItem, LinkedFileEntry } from '../lib/types';

interface Crumb { path: string | null; name: string }
type FilesView = 'browse' | 'linked' | 'recent' | 'pinned';
type SortKey = 'name' | 'modified' | 'size' | 'kind';
interface RowItem { path: string; name: string; isFolder: boolean; size: number | null; modifiedAt: string | null; exists: boolean; linkedTo?: { type: 'company' | 'project'; name: string } }
interface PathEntry { path: string; name: string; isFolder: boolean }

const RECENT_KEY = 'msfiles_recent';
const RECENT_MAX = 20;
const PINNED_KEY = 'msfiles_pinned';
const PREFS_KEY = 'menaone.filesPrefs';

let view: FilesView = 'browse';
let crumbs: Crumb[] = [{ path: null, name: 'OneDrive' }];
let items: LocalFileItem[] = [];
let roots: LocalFileItem[] = [];
let linkedItems: LinkedFileEntry[] = [];
let recentItems: LocalFileItem[] = [];
let pinnedItems: LocalFileItem[] = [];
let pinnedEntries: PathEntry[] = [];
let loading = false;
let errorMsg: string | null = null;
let searchQuery = '';
let showSetupBanner = false;
let selectedPath: string | null = null;
let prefs: { sort: SortKey; dir: 'asc' | 'desc'; layout: 'list' | 'icons' } = { sort: 'name', dir: 'asc', layout: 'list' };

try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { /* defaults */ }
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* not remembered */ } };

// ── File kinds ──────────────────────────────────────────────────────────────

const KINDS: [RegExp, string, string][] = [
  [/\.(pptx?|key)$/i, 'Presentation', 'kind-slides'],
  [/\.(docx?|pages|rtf|odt)$/i, 'Document', 'kind-doc'],
  [/\.(xlsx?|csv|numbers|ods)$/i, 'Spreadsheet', 'kind-sheet'],
  [/\.pdf$/i, 'PDF', 'kind-pdf'],
  [/\.(png|jpe?g|gif|heic|webp|svg|tiff?)$/i, 'Image', 'kind-image'],
  [/\.(zip|rar|7z|gz)$/i, 'Archive', 'kind-archive'],
  [/\.(txt|md)$/i, 'Text', 'kind-doc'],
  [/\.(mp4|mov|m4v|mp3|m4a|wav)$/i, 'Media', 'kind-media'],
];

function kindOf(it: { name: string; isFolder: boolean }): { label: string; cls: string; ext: string } {
  const ext = it.name.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toUpperCase() || '';
  if (it.isFolder) return { label: 'Folder', cls: 'kind-folder', ext: '' };
  const k = KINDS.find(([re]) => re.test(it.name));
  return { label: k ? k[1] : ext ? `${ext} file` : 'File', cls: k ? k[2] : 'kind-file', ext };
}

function fileIcon(it: { name: string; isFolder: boolean }, size = 18): string {
  const k = kindOf(it);
  return `<span class="fx-icon ${k.cls}">${icon(it.isFolder ? 'folder' : 'document', size)}</span>`;
}

function formatBytes(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ── Data ────────────────────────────────────────────────────────────────────

function currentRows(): RowItem[] {
  let rows: RowItem[];
  if (view === 'linked') rows = linkedItems.map((f) => ({ path: f.path, name: f.name, isFolder: f.isFolder, size: null, modifiedAt: null, exists: f.exists, linkedTo: { type: f.linkedToType, name: f.linkedToName } }));
  else if (view === 'recent') rows = recentItems.map((f) => ({ ...f }));
  else if (view === 'pinned') rows = pinnedItems.map((f) => ({ ...f }));
  else rows = items.map((f) => ({ ...f }));
  if (searchQuery) rows = rows.filter((r) => r.name.toLowerCase().includes(searchQuery) || r.linkedTo?.name.toLowerCase().includes(searchQuery));
  if (view === 'browse' || view === 'pinned') {
    const dir = prefs.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      let cmp = 0;
      if (prefs.sort === 'modified') cmp = (a.modifiedAt || '').localeCompare(b.modifiedAt || '');
      else if (prefs.sort === 'size') cmp = (a.size ?? -1) - (b.size ?? -1);
      else if (prefs.sort === 'kind') cmp = kindOf(a).label.localeCompare(kindOf(b).label);
      return (cmp || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })) * (prefs.sort === 'name' ? dir : cmp ? dir : 1);
    });
  }
  return rows;
}

const isPinned = (path: string) => pinnedEntries.some((e) => e.path === path);

async function loadPinnedEntries(): Promise<void> {
  try { pinnedEntries = JSON.parse((await getAppMeta(PINNED_KEY)) || '[]'); } catch { pinnedEntries = []; }
}

async function togglePin(path: string, name: string, isFolder: boolean): Promise<void> {
  pinnedEntries = isPinned(path) ? pinnedEntries.filter((e) => e.path !== path) : [{ path, name, isFolder }, ...pinnedEntries];
  try { await setAppMeta(PINNED_KEY, JSON.stringify(pinnedEntries)); } catch { /* losing a pin isn't worth an error */ }
  if (view === 'pinned') void loadPinned(); else render();
}

async function renderFilesTab(): Promise<void> {
  showSetupBanner = !(await getAppMeta('msfiles_setup_done'));
  await loadPinnedEntries();
  roots = await filesListRoots().catch(() => []);
  await loadForCurrentView();
}
registerTabRenderer('files', () => { void renderFilesTab(); });

export function msFilesSetView(next: FilesView): void {
  view = next;
  selectedPath = null;
  searchQuery = '';
  const input = document.getElementById('msf-search') as HTMLInputElement | null;
  if (input) input.value = '';
  void loadForCurrentView();
}
expose('msFilesSetView', msFilesSetView);

async function withLoading(load: () => Promise<void>): Promise<void> {
  loading = true;
  errorMsg = null;
  render();
  try { await load(); } catch (e) { errorMsg = String(e); }
  loading = false;
  render();
}

function loadForCurrentView(): Promise<void> {
  if (view === 'linked') return withLoading(async () => { linkedItems = await filesListLinked(); });
  if (view === 'recent') return loadRecent();
  if (view === 'pinned') return loadPinned();
  return loadCurrentLevel();
}

function loadRecent(): Promise<void> {
  return withLoading(async () => {
    const entries: PathEntry[] = JSON.parse((await getAppMeta(RECENT_KEY)) || '[]');
    const stated = await filesStatPaths(entries.map((e) => e.path));
    recentItems = entries.map((e) => stated.find((s) => s.path === e.path)).filter((f): f is LocalFileItem => !!f);
  });
}

async function recordRecent(path: string, name: string, isFolder: boolean): Promise<void> {
  try {
    const entries: PathEntry[] = JSON.parse((await getAppMeta(RECENT_KEY)) || '[]');
    await setAppMeta(RECENT_KEY, JSON.stringify([{ path, name, isFolder }, ...entries.filter((e) => e.path !== path)].slice(0, RECENT_MAX)));
  } catch { /* one lost recent entry isn't worth an error */ }
}

function loadPinned(): Promise<void> {
  return withLoading(async () => {
    await loadPinnedEntries();
    const stated = await filesStatPaths(pinnedEntries.map((e) => e.path));
    pinnedItems = pinnedEntries.map((e) => stated.find((s) => s.path === e.path)).filter((f): f is LocalFileItem => !!f);
  });
}

function loadCurrentLevel(): Promise<void> {
  const current = crumbs[crumbs.length - 1];
  return withLoading(async () => {
    items = [];
    items = current.path == null ? await filesListRoots() : await filesListFolder(current.path);
  });
}

/** Jumps straight to a folder, rebuilding the path from the OneDrive root —
 * used by a company's Files section and by the places sidebar. */
export async function msFilesNavigateToPath(fullPath: string): Promise<void> {
  const allRoots = roots.length ? roots : await filesListRoots();
  const root = allRoots.find((r) => fullPath === r.path || fullPath.startsWith(`${r.path}/`));
  view = 'browse';
  selectedPath = null;
  if (!root) {
    crumbs = [{ path: null, name: 'OneDrive' }];
    errorMsg = 'This folder could not be found — it may have been moved, renamed, or is no longer synced.';
    render();
    return;
  }
  const rel = fullPath === root.path ? '' : fullPath.slice(root.path.length + 1);
  const next: Crumb[] = [{ path: null, name: 'OneDrive' }, { path: root.path, name: root.name }];
  let acc = root.path;
  for (const part of rel ? rel.split('/') : []) { acc = `${acc}/${part}`; next.push({ path: acc, name: part }); }
  crumbs = next;
  searchQuery = '';
  await loadCurrentLevel();
}
expose('msFilesNavigateToPath', msFilesNavigateToPath);

export function msFilesOpenSetupWizard(): void {
  openMsFilesSetupWizard(() => { showSetupBanner = false; void loadForCurrentView(); });
}
expose('msFilesOpenSetupWizard', msFilesOpenSetupWizard);

export async function msFilesDismissSetupBanner(): Promise<void> {
  showSetupBanner = false;
  render();
  await setAppMeta('msfiles_setup_done', '1');
}
expose('msFilesDismissSetupBanner', msFilesDismissSetupBanner);

export function msFilesOpenFolder(path: string, name: string): void {
  searchQuery = '';
  selectedPath = null;
  const input = document.getElementById('msf-search') as HTMLInputElement | null;
  if (input) input.value = '';
  view = 'browse';
  crumbs.push({ path, name });
  void loadCurrentLevel();
}
expose('msFilesOpenFolder', msFilesOpenFolder);

/** Up one folder. */
export function msFilesGoBack(): void {
  if (view !== 'browse' || crumbs.length <= 1) return;
  const left = crumbs.pop();
  selectedPath = left?.path ?? null;
  void loadCurrentLevel();
}
expose('msFilesGoBack', msFilesGoBack);

export function msFilesGoToCrumb(index: number): void {
  if (index >= crumbs.length - 1) return;
  selectedPath = crumbs[index + 1]?.path ?? null;
  crumbs = crumbs.slice(0, index + 1);
  view = 'browse';
  void loadCurrentLevel();
}
expose('msFilesGoToCrumb', msFilesGoToCrumb);

export function msFilesSearchChanged(): void {
  searchQuery = (document.getElementById('msf-search') as HTMLInputElement | null)?.value.trim().toLowerCase() || '';
  renderItems();
}
expose('msFilesSearchChanged', msFilesSearchChanged);

export async function msFilesOpenItem(path: string): Promise<void> {
  const item = currentRows().find((i) => i.path === path);
  if (!item) return;
  if (item.isFolder) {
    if (view === 'browse') msFilesOpenFolder(item.path, item.name);
    else void msFilesNavigateToPath(item.path);
    return;
  }
  try {
    await filesOpen(item.path);
    void recordRecent(item.path, item.name, false);
  } catch (e) {
    toast('Could not open the file', { tone: 'error', detail: String(e) });
  }
}
expose('msFilesOpenItem', msFilesOpenItem);

export function msFilesSelect(path: string): void {
  selectedPath = path;
  document.querySelectorAll<HTMLElement>('#msf-body [data-item-path]').forEach((el) => el.classList.toggle('sel', el.dataset.itemPath === path));
  renderInfo();
}
expose('msFilesSelect', msFilesSelect);

export function msFilesSort(key: SortKey): void {
  if (prefs.sort === key) prefs.dir = prefs.dir === 'asc' ? 'desc' : 'asc';
  else { prefs.sort = key; prefs.dir = key === 'modified' || key === 'size' ? 'desc' : 'asc'; }
  savePrefs();
  render();
}
expose('msFilesSort', msFilesSort);

export function msFilesSortMenu(e: MouseEvent): void {
  const opts: [SortKey, string][] = [['name', 'Name'], ['modified', 'Date modified'], ['size', 'Size'], ['kind', 'Kind']];
  showContextMenu(e, opts.map(([k, l]) => ({ label: `${l}${prefs.sort === k ? (prefs.dir === 'asc' ? '  ↑' : '  ↓') : ''}`, run: () => msFilesSort(k) })));
}
expose('msFilesSortMenu', msFilesSortMenu);

export function msFilesLayout(layout: 'list' | 'icons'): void {
  prefs.layout = layout;
  savePrefs();
  render();
}
expose('msFilesLayout', msFilesLayout);

export function msFilesCopyPath(path: string): void {
  (window as any).copyText?.(path, 'Path copied');
}
expose('msFilesCopyPath', msFilesCopyPath);

function contextItems(item: RowItem) {
  const pinned = isPinned(item.path);
  return [
    { label: item.isFolder ? 'Open folder' : 'Open', iconName: 'document', run: () => { void msFilesOpenItem(item.path); } },
    { label: 'Reveal in Finder', iconName: 'folder', run: () => { void filesRevealInFinder(item.path); } },
    { label: 'Copy path', iconName: 'copy', run: () => msFilesCopyPath(item.path) },
    { label: 'Show info and notes', iconName: 'note', run: () => { void openMsFilesInspector(item.path, item.name, item.isFolder, item.size, item.modifiedAt); } },
    { label: pinned ? 'Remove from Favourites' : 'Add to Favourites', iconName: 'pin', run: () => { void togglePin(item.path, item.name, item.isFolder); } },
    { label: 'Link to company…', iconName: 'building', run: () => openMsFilesLinkModal(item.path, item.name, item.isFolder, 'company') },
    { label: 'Link to project…', iconName: 'target', run: () => openMsFilesLinkModal(item.path, item.name, item.isFolder, 'project') },
  ];
}

export function msFilesContextMenu(e: MouseEvent, path: string): void {
  const item = currentRows().find((i) => i.path === path);
  if (!item) return;
  msFilesSelect(path);
  showContextMenu(e, contextItems(item));
}
expose('msFilesContextMenu', msFilesContextMenu);

export function msFilesPlace(kind: 'root' | 'proposals' | FilesView, path?: string): void {
  if (kind === 'root') { crumbs = [{ path: null, name: 'OneDrive' }]; msFilesSetView('browse'); return; }
  if (kind === 'proposals' && path) { void msFilesNavigateToPath(path); return; }
  if (kind === 'browse' || kind === 'linked' || kind === 'recent' || kind === 'pinned') msFilesSetView(kind);
}
expose('msFilesPlace', msFilesPlace);

export async function msFilesTogglePinSelected(): Promise<void> {
  const item = currentRows().find((i) => i.path === selectedPath);
  if (item) await togglePin(item.path, item.name, item.isFolder);
}
expose('msFilesTogglePinSelected', msFilesTogglePinSelected);

// ── Render ──────────────────────────────────────────────────────────────────

function render(): void {
  renderPlaces();
  renderToolbar();
  renderItems();
  renderInfo();
}

function renderPlaces(): void {
  const el = document.getElementById('msf-places');
  if (!el) return;
  const atRoot = view === 'browse' && crumbs.length === 1;
  const proposals = S.proposalsRoot;
  const inProposals = view === 'browse' && !!proposals && crumbs[crumbs.length - 1]?.path?.startsWith(proposals);
  const place = (active: boolean, onclick: string, iconName: string, label: string, count?: number) =>
    `<button class="fx-place${active ? ' active' : ''}" onclick="${onclick}">${icon(iconName, 14)}<span>${escHtml(label)}</span>${count ? `<span class="fx-place-count">${count}</span>` : ''}</button>`;
  el.innerHTML = `<div class="fx-places-label">Locations</div>
    ${place(atRoot || (view === 'browse' && !inProposals && crumbs.length > 1), "msFilesPlace('root')", 'folder', 'OneDrive')}
    ${proposals ? place(!!inProposals, `msFilesPlace('proposals', '${escHtml(proposals).replace(/'/g, "\\'")}')`, 'database', 'Proposals') : ''}
    <div class="fx-places-label">Library</div>
    ${place(view === 'pinned', "msFilesPlace('pinned')", 'pin', 'Favourites', pinnedEntries.length)}
    ${place(view === 'recent', "msFilesPlace('recent')", 'clock', 'Recent')}
    ${place(view === 'linked', "msFilesPlace('linked')", 'link', 'Linked to records')}
    ${pinnedEntries.filter((e) => e.isFolder).slice(0, 8).length ? `<div class="fx-places-label">Favourite folders</div>
      ${pinnedEntries.filter((e) => e.isFolder).slice(0, 8).map((e) => place(view === 'browse' && crumbs[crumbs.length - 1]?.path === e.path, `msFilesNavigateToPath('${escHtml(e.path).replace(/'/g, "\\'")}')`, 'folder', e.name)).join('')}` : ''}`;
}

function renderToolbar(): void {
  const up = document.getElementById('msf-back-btn') as HTMLButtonElement | null;
  if (up) up.disabled = view !== 'browse' || crumbs.length <= 1;
  const crumbEl = document.getElementById('msf-breadcrumb');
  const label = view === 'linked' ? 'Linked to records' : view === 'recent' ? 'Recent' : view === 'pinned' ? 'Favourites' : null;
  const title = document.getElementById('msf-folder-title');
  if (title) title.textContent = label || crumbs[crumbs.length - 1].name;
  if (crumbEl) {
    crumbEl.hidden = !!label || crumbs.length <= 1;
    crumbEl.innerHTML = label
      ? ''
      : crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return `${i ? `<span class="fx-crumb-sep">${icon('chevronRight', 11)}</span>` : ''}<button class="fx-crumb${last ? ' current' : ''}" ${last ? 'aria-current="page"' : `onclick="msFilesGoToCrumb(${i})"`}>${i === 0 ? icon('folder', 12) : ''}${escHtml(c.name)}</button>`;
        }).join('');
    crumbEl.scrollLeft = crumbEl.scrollWidth;
  }
  document.querySelectorAll<HTMLElement>('#msf-layout-btns .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.layout === prefs.layout));
  const sort = document.getElementById('msf-sort-label');
  if (sort) sort.textContent = { name: 'Name', modified: 'Date modified', size: 'Size', kind: 'Kind' }[prefs.sort];
}

function banner(): string {
  if (!showSetupBanner) return '';
  return `<div class="fx-banner">${icon('building', 16)}
    <div><strong>Match your OneDrive folders to companies</strong><span>Pick a folder like "Proposals" and MENA One suggests the company for each client subfolder.</span></div>
    <button class="btn-secondary btn-sm" onclick="msFilesDismissSetupBanner()">Not now</button><button class="btn-primary btn-sm" onclick="msFilesOpenSetupWizard()">Set up</button>
  </div>`;
}

function renderItems(): void {
  const body = document.getElementById('msf-body');
  if (!body) return;
  if (loading) { body.innerHTML = banner() + skeleton(6); return; }
  if (errorMsg) {
    body.innerHTML = banner() + emptyState({ icon: 'warning', title: "Couldn't open this folder", body: errorMsg, action: { label: 'Try again', onclick: 'renderFilesTabRetry()' } });
    renderIcons(body);
    return;
  }
  const rows = currentRows();
  if (!rows.length) {
    const empty = searchQuery ? { icon: 'search', title: 'Nothing matches', body: `No items named "${searchQuery}" here.` }
      : view === 'linked' ? { icon: 'link', title: 'Nothing linked yet', body: 'Right-click a file or folder and choose "Link to company…", or match your client folders to companies.' }
      : view === 'recent' ? { icon: 'clock', title: 'No recent files', body: 'Files you open from MENA One show up here.' }
      : view === 'pinned' ? { icon: 'pin', title: 'No favourites yet', body: 'Right-click a file or folder and choose "Add to Favourites".' }
      : crumbs.length === 1 ? { icon: 'folder', title: 'No OneDrive folders on this Mac', body: 'Make sure OneDrive is installed, signed in and has synced at least one folder.' }
      : { icon: 'folder', title: 'This folder is empty', body: '' };
    body.innerHTML = banner() + emptyState(empty);
    renderIcons(body);
    return;
  }
  if (selectedPath && !rows.some((r) => r.path === selectedPath)) selectedPath = null;
  const attr = (p: string) => escHtml(p).replace(/'/g, "\\'");
  const count = `<div class="fx-count">${rows.length} item${rows.length === 1 ? '' : 's'}${searchQuery ? ' found' : ''}</div>`;
  if (prefs.layout === 'icons') {
    body.innerHTML = banner() + `<div class="fx-grid">${rows.map((r) => `<div class="fx-tile msf-row${r.path === selectedPath ? ' sel' : ''}${r.exists ? '' : ' is-missing'}" data-item-path="${escHtml(r.path)}" tabindex="-1"
        onclick="msFilesSelect('${attr(r.path)}')" ondblclick="msFilesOpenItem('${attr(r.path)}')" oncontextmenu="msFilesContextMenu(event,'${attr(r.path)}')" title="${escHtml(r.name)}">
        ${fileIcon(r, 40)}<span class="fx-tile-name">${escHtml(r.name)}</span>${isPinned(r.path) ? `<span class="fx-tile-pin">${icon('pin', 10)}</span>` : ''}
      </div>`).join('')}</div>` + count;
  } else {
    const th = (key: SortKey, label: string, cls = '') => view === 'browse' || view === 'pinned'
      ? `<button class="fx-th ${cls}${prefs.sort === key ? ' sorted' : ''}" onclick="msFilesSort('${key}')">${label}${prefs.sort === key ? `<span class="fx-sort-dir">${prefs.dir === 'asc' ? '↑' : '↓'}</span>` : ''}</button>`
      : `<span class="fx-th ${cls}">${label}</span>`;
    const linkedCol = view === 'linked';
    body.innerHTML = banner() + `<div class="fx-table${linkedCol ? ' with-linked' : ''}">
      <div class="fx-head">${th('name', 'Name')}${linkedCol ? '<span class="fx-th">Linked to</span>' : `${th('modified', 'Date modified')}${th('size', 'Size', 'num')}${th('kind', 'Kind')}`}</div>
      ${rows.map((r) => `<div class="fx-tr msf-row${r.path === selectedPath ? ' sel' : ''}${r.exists ? '' : ' is-missing'}" data-item-path="${escHtml(r.path)}" tabindex="-1"
          onclick="msFilesSelect('${attr(r.path)}')" ondblclick="msFilesOpenItem('${attr(r.path)}')" oncontextmenu="msFilesContextMenu(event,'${attr(r.path)}')">
        <span class="fx-name">${fileIcon(r)}<span class="fx-name-text">${escHtml(r.name)}</span>${isPinned(r.path) ? `<span class="fx-pin" title="In Favourites">${icon('pin', 11)}</span>` : ''}${r.exists ? '' : '<span class="rec-badge tone-red">Missing</span>'}</span>
        ${linkedCol
          ? `<span class="fx-cell">${r.linkedTo ? `<span class="chip">${icon(r.linkedTo.type === 'company' ? 'building' : 'target', 11)} ${escHtml(r.linkedTo.name)}</span>` : ''}</span>`
          : `<span class="fx-cell">${r.modifiedAt ? escHtml(fmtDateFromIso(r.modifiedAt)) : '—'}</span><span class="fx-cell num">${r.isFolder ? '—' : formatBytes(r.size)}</span><span class="fx-cell">${escHtml(kindOf(r).label)}</span>`}
      </div>`).join('')}
    </div>` + count;
  }
  renderIcons(body);
}

function renderInfo(): void {
  const el = document.getElementById('msf-info');
  if (!el) return;
  const item = currentRows().find((r) => r.path === selectedPath);
  el.hidden = !item;
  if (!item) { el.innerHTML = ''; return; }
  const attr = escHtml(item.path).replace(/'/g, "\\'");
  const k = kindOf(item);
  const where = item.path.replace(/^.*?\/OneDrive-[^/]+\//, 'OneDrive/').split('/').slice(0, -1).join(' › ');
  el.innerHTML = `<div class="fx-info-preview">${fileIcon(item, 56)}</div>
    <div class="fx-info-name">${escHtml(item.name)}</div>
    <div class="fx-info-kind">${escHtml(k.label)}${item.isFolder ? '' : ` · ${formatBytes(item.size)}`}</div>
    <div class="fx-info-actions">
      <button class="btn-primary btn-sm" onclick="msFilesOpenItem('${attr}')">${item.isFolder ? 'Open folder' : 'Open'}</button>
      <button class="btn-secondary btn-sm" onclick="filesRevealInFinderClick('${attr}')">Show in Finder</button>
    </div>
    <dl class="fx-info-props">
      ${item.modifiedAt ? `<dt>Modified</dt><dd>${escHtml(fmtDateFromIso(item.modifiedAt))}</dd>` : ''}
      <dt>Where</dt><dd class="fx-info-where">${escHtml(where || 'OneDrive')}</dd>
      ${item.linkedTo ? `<dt>Linked to</dt><dd>${escHtml(item.linkedTo.name)}</dd>` : ''}
    </dl>
    <div class="fx-info-links">
      <button class="fx-link-btn" onclick="msFilesCopyPath('${attr}')">${icon('copy', 13)} Copy path</button>
      <button class="fx-link-btn" onclick="msFilesTogglePinSelected()">${icon('pin', 13)} ${isPinned(item.path) ? 'Remove from Favourites' : 'Add to Favourites'}</button>
      <button class="fx-link-btn" onclick="msFilesLinkSelected('company')">${icon('building', 13)} Link to company…</button>
      <button class="fx-link-btn" onclick="msFilesLinkSelected('project')">${icon('target', 13)} Link to project…</button>
      <button class="fx-link-btn" onclick="msFilesInfoSelected()">${icon('note', 13)} Notes and links…</button>
    </div>`;
  renderIcons(el);
}

export function filesRevealInFinderClick(path: string): void {
  void filesRevealInFinder(path).catch((e) => toast('Could not show it in Finder', { tone: 'error', detail: String(e) }));
}
expose('filesRevealInFinderClick', filesRevealInFinderClick);

export function msFilesLinkSelected(kind: 'company' | 'project'): void {
  const item = currentRows().find((r) => r.path === selectedPath);
  if (item) openMsFilesLinkModal(item.path, item.name, item.isFolder, kind);
}
expose('msFilesLinkSelected', msFilesLinkSelected);

export function msFilesInfoSelected(): void {
  const item = currentRows().find((r) => r.path === selectedPath);
  if (item) void openMsFilesInspector(item.path, item.name, item.isFolder, item.size, item.modifiedAt);
}
expose('msFilesInfoSelected', msFilesInfoSelected);

export function renderFilesTabRetry(): void { void loadForCurrentView(); }
expose('renderFilesTabRetry', renderFilesTabRetry);

// ── Keyboard: ↑/↓ (←/→ in icons) select, Enter opens, ⌘↑ goes up, ⌘F searches ──

document.addEventListener('keydown', (e) => {
  if (getActiveTabId() !== 'files' || document.querySelector('.modal-ov.open')) return;
  const t = e.target as HTMLElement;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); (document.getElementById('msf-search') as HTMLInputElement | null)?.focus(); return; }
  if (typing) { if (e.key === 'Escape') t.blur(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowUp') { e.preventDefault(); msFilesGoBack(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const rows = currentRows();
  if (!rows.length) return;
  const idx = rows.findIndex((r) => r.path === selectedPath);
  const perRow = prefs.layout === 'icons' ? Math.max(1, Math.floor((document.querySelector('.fx-grid')?.clientWidth || 1) / 120)) : 1;
  let next = -1;
  if (e.key === 'ArrowDown') next = idx < 0 ? 0 : Math.min(rows.length - 1, idx + perRow);
  else if (e.key === 'ArrowUp') next = idx < 0 ? 0 : Math.max(0, idx - perRow);
  else if (prefs.layout === 'icons' && e.key === 'ArrowRight') next = Math.min(rows.length - 1, idx + 1);
  else if (prefs.layout === 'icons' && e.key === 'ArrowLeft') next = Math.max(0, idx - 1);
  else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); void msFilesOpenItem(rows[idx].path); return; }
  else if (e.key === 'Backspace') { e.preventDefault(); msFilesGoBack(); return; }
  if (next < 0) return;
  e.preventDefault();
  msFilesSelect(rows[next].path);
  document.querySelector(`#msf-body [data-item-path="${CSS.escape(rows[next].path)}"]`)?.scrollIntoView({ block: 'nearest' });
});
