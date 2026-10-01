// Files: a Finder-style browser for the user's OneDrive, read directly from
// this Mac's Finder-synced ~/Library/CloudStorage/OneDrive-* folders — not via
// the Microsoft Graph API, so no Microsoft 365 connection is needed. "Open"
// hands off to the native app exactly like double-clicking in Finder. Files
// are never copied into MENA One; only references and business context
// (Company/Project links, Notes) live in its database, via entity_links and
// the modals in core/msFilesSetup.ts and core/msFilesInspector.ts.
//
// Layout: a rail (locations, library, clients) · the page head with Grid/List ·
// a toolbar (up, path, search, sort) · items · an info panel for the selected
// item. Single click selects, double-click or Enter opens. In Grid a folder is
// a tile in its company's colour and a file is a card with a cover by type
// (lib/filesPage.ts); List keeps the table.

import { registerKey } from '../core/keys';
import { S } from '../lib/state';
import { escHtml, expose, fmtDateFromIso, fmtDateShort, strColor, today } from '../lib/utils';
import { initialsOf } from '../lib/appearance';
import { tileHtml } from '../lib/pageKit';
import { coverLabel } from '../lib/recordOpportunity';
import { classifyFolders, clientPlaces, companyForPath, coverKind, extBadge, folderLine, matchProgress, type ClientFolder } from '../lib/filesPage';
import { registerTabRenderer, getActiveTabId } from '../lib/registry';
import { showContextMenu } from '../lib/contextMenu';
import { quickLook } from '../lib/quickLook';
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
interface RowItem { path: string; name: string; isFolder: boolean; size: number | null; modifiedAt: string | null; exists: boolean; fileCount?: number | null; folderCount?: number | null; linkedTo?: { type: 'company' | 'project'; name: string } }
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
/** The client folders under the proposals folder (read when Files opens), for the banner and the rail. */
let proposalFolders: ClientFolder[] = [];
/** The files last opened from here, for the Recent cards on the first screens. */
let recentTop: LocalFileItem[] = [];
let pinnedItems: LocalFileItem[] = [];
let pinnedEntries: PathEntry[] = [];
let loading = false;
let errorMsg: string | null = null;
let searchQuery = '';
let showSetupBanner = false;
let selectedPath: string | null = null;
// Grid until a choice is made: folders as tiles in their company's colour, files as cards.
let prefs: { sort: SortKey; dir: 'asc' | 'desc'; layout: 'list' | 'icons' } = { sort: 'name', dir: 'asc', layout: 'icons' };

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

/** The small type icon of the list and the info panel: a folder glyph, or a tile in the type's cover colour. */
function fileIcon(it: { name: string; isFolder: boolean }, size = 18): string {
  if (it.isFolder) return `<span class="fx-icon kind-folder">${icon('folder', size)}</span>`;
  return `<span class="fx-ic k-${coverKind(it.name)}${size > 30 ? ' lg' : ''}">${icon('document', size > 30 ? 26 : 13)}</span>`;
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

/** What the banner, the rail and the tiles read beside the open folder: the links, the client folders, the recent files. */
async function loadContext(): Promise<void> {
  linkedItems = await filesListLinked().catch(() => []);
  const root = S.proposalsRoot;
  proposalFolders = root ? classifyFolders(await filesListFolder(root).catch(() => []), linkedItems) : [];
  try {
    const entries: PathEntry[] = JSON.parse((await getAppMeta(RECENT_KEY)) || '[]');
    const files = entries.filter((e) => !e.isFolder).slice(0, 5);
    const stated = await filesStatPaths(files.map((e) => e.path));
    recentTop = files.map((e) => stated.find((x) => x.path === e.path)).filter((f): f is LocalFileItem => !!f && f.exists);
  } catch { recentTop = []; }
}

async function renderFilesTab(): Promise<void> {
  showSetupBanner = !(await getAppMeta('msfiles_setup_done'));
  await loadPinnedEntries();
  roots = await filesListRoots().catch(() => []);
  await loadContext();
  await loadForCurrentView();
}

/** A folder or file was linked or unlinked elsewhere (the link dialog, the matching wizard): read the links again. */
export async function msFilesLinksChanged(): Promise<void> {
  if (getActiveTabId() !== 'files') return;
  await loadContext();
  render();
}
expose('msFilesLinksChanged', msFilesLinksChanged);
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

/** The folder open in Files (a drop from Finder lands here), or null. */
export function msFilesCurrentFolder(): string | null {
  return view === 'browse' ? crumbs[crumbs.length - 1].path : null;
}

/** Reads the open folder again (after files were dropped into it). */
export async function msFilesReloadCurrent(): Promise<void> {
  await loadCurrentLevel();
  render();
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
  openMsFilesSetupWizard(() => { showSetupBanner = false; void loadContext().then(() => loadForCurrentView()); });
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
    ...(item.isFolder ? [] : [{ label: 'Quick Look', iconName: 'eye', run: () => { void quickLookRow(item.path); } }]),
    { label: 'Reveal in Finder', iconName: 'folder', run: () => { void filesRevealInFinder(item.path); } },
    { label: 'Copy path', iconName: 'copy', run: () => msFilesCopyPath(item.path) },
    { label: 'Show info and notes', iconName: 'note', run: () => { void openMsFilesInspector(item.path, item.name, item.isFolder, item.size, item.modifiedAt); } },
    { label: pinned ? 'Remove from Favourites' : 'Add to Favourites', iconName: 'pin', run: () => { void togglePin(item.path, item.name, item.isFolder); } },
    { label: 'Link to company…', iconName: 'building', run: () => openMsFilesLinkModal(item.path, item.name, item.isFolder, 'company') },
    { label: 'Link to project…', iconName: 'target', run: () => openMsFilesLinkModal(item.path, item.name, item.isFolder, 'project') },
  ];
}

/** Quick Look on a row; the row keeps the selection and the keyboard after. */
async function quickLookRow(path: string): Promise<void> {
  const row = () => [...document.querySelectorAll<HTMLElement>('#msf-body [data-item-path]')].find((el) => el.dataset.itemPath === path) ?? null;
  await quickLook(path, row);
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

const jsPath = (p: string) => escHtml(p).replace(/'/g, "\\'");
const currentPath = () => (view === 'browse' ? crumbs[crumbs.length - 1]?.path ?? null : null);
const atProposalsRoot = () => !!S.proposalsRoot && currentPath() === S.proposalsRoot;

function renderPlaces(): void {
  const el = document.getElementById('msf-places');
  if (!el) return;
  const atRoot = view === 'browse' && crumbs.length === 1;
  const proposals = S.proposalsRoot;
  const here = currentPath();
  const inProposals = !!proposals && !!here && (here === proposals || here.startsWith(`${proposals}/`));
  const place = (active: boolean, onclick: string, lead: string, label: string, count?: number | null) =>
    `<button class="ws-side-item${active ? ' active' : ''}" onclick="${onclick}">${lead}<span class="ws-side-label">${escHtml(label)}</span><span class="ws-side-count">${count || ''}</span></button>`;
  const tile = (name: string, tint: string) => `<span class="ws-side-tile" style="--c:${tint}">${icon(name, 13)}</span>`;
  const clients = clientPlaces(linkedItems, proposalFolders);
  const favFolders = pinnedEntries.filter((e) => e.isFolder).slice(0, 8);
  // One marker at a time: inside a client's own folder, the client is where you are.
  const inClient = clients.some((c) => c.path === here) || favFolders.some((e) => e.path === here);
  el.innerHTML = `<div class="ws-side-scroll">
    <div class="ws-side-section-hd fx-rail-hd">Locations</div>
    <div class="ws-side-group">
      ${place(atRoot || (view === 'browse' && !inProposals && !inClient && crumbs.length > 1), "msFilesPlace('root')", tile('cloud', 'var(--blue)'), 'OneDrive')}
      ${proposals ? place(inProposals && !inClient, `msFilesPlace('proposals', '${jsPath(proposals)}')`, tile('database', 'var(--coral-text)'), 'Proposals', proposalFolders.length) : ''}
    </div>
    <div class="ws-side-section-hd fx-rail-hd">Library</div>
    <div class="ws-side-group">
      ${place(view === 'pinned', "msFilesPlace('pinned')", tile('pin', 'var(--amber)'), 'Favourites', pinnedEntries.length)}
      ${place(view === 'recent', "msFilesPlace('recent')", tile('clock', 'var(--sub)'), 'Recent')}
      ${place(view === 'linked', "msFilesPlace('linked')", tile('link', 'var(--green)'), 'Linked to records', linkedItems.length)}
    </div>
    ${clients.length ? `<div class="ws-side-section-hd fx-rail-hd">Clients</div><div class="ws-side-group">
      ${clients.map((c) => place(here === c.path, `msFilesNavigateToPath('${jsPath(c.path)}')`, tileHtml(c.company, 'pk-tile mini'), c.company, c.files)).join('')}</div>` : ''}
    ${favFolders.length ? `<div class="ws-side-section-hd fx-rail-hd">Favourite folders</div><div class="ws-side-group">
      ${favFolders.map((e) => place(here === e.path, `msFilesNavigateToPath('${jsPath(e.path)}')`, `<span class="ws-side-icon">${icon('folder', 14)}</span>`, e.name)).join('')}</div>` : ''}
  </div>`;
}

function renderToolbar(): void {
  const up = document.getElementById('msf-back-btn') as HTMLButtonElement | null;
  if (up) up.disabled = view !== 'browse' || crumbs.length <= 1;
  const crumbEl = document.getElementById('msf-breadcrumb');
  const label = view === 'linked' ? 'Linked to records' : view === 'recent' ? 'Recent' : view === 'pinned' ? 'Favourites' : null;
  if (crumbEl) {
    // A library view is one name; a folder is its path, the last part being where you are.
    crumbEl.innerHTML = label
      ? `<span class="fx-crumb current" aria-current="page">${escHtml(label)}</span>`
      : crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return `${i ? `<span class="fx-crumb-sep">${icon('chevronRight', 11)}</span>` : ''}<button class="fx-crumb${last ? ' current' : ''}" ${last ? 'aria-current="page"' : `onclick="msFilesGoToCrumb(${i})"`}>${escHtml(c.name)}</button>`;
        }).join('');
    crumbEl.scrollLeft = crumbEl.scrollWidth;
  }
  document.querySelectorAll<HTMLElement>('#msf-layout-btns .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.layout === prefs.layout));
  const sort = document.getElementById('msf-sort-label');
  if (sort) sort.textContent = { name: 'Name', modified: 'Modified', size: 'Size', kind: 'Kind' }[prefs.sort];
}

/** The matching banner: at the proposals folder it says how far the matching got; before any folder is known as the
 * proposals folder, it offers the set-up. Gone once dismissed or done. */
function banner(): string {
  // Where the client folders are: the proposals folder, and the first screen that leads to it.
  if (!showSetupBanner || view !== 'browse' || !(crumbs.length === 1 || atProposalsRoot() || !S.proposalsRoot)) return '';
  const progress = S.proposalsRoot ? matchProgress(proposalFolders, S.proposalsRoot.split('/').pop() || 'Proposals') : null;
  if (S.proposalsRoot && !progress) return '';
  const head = progress ? progress.headline : 'Match your OneDrive folders to companies';
  const body = progress ? progress.body : 'Pick a folder like "Proposals" and MENA One suggests the company for each client subfolder.';
  return `<div class="fx-banner"><span class="fx-banner-ic" aria-hidden="true">${icon('building', 14)}</span>
    <div><strong>${escHtml(head)}</strong><span>${escHtml(body)}</span></div>
    <button class="btn-secondary btn-sm" onclick="msFilesDismissSetupBanner()">Not now</button><button class="btn-primary btn-sm" onclick="msFilesOpenSetupWizard()">${escHtml(progress ? progress.action : 'Set up')}</button>
  </div>`;
}

/** A folder as a tile: the glyph in its company's colour with the initials (a grey "?" for a client folder with no
 * company yet), its name, what is in it, and the company it is matched to. */
function folderTile(r: RowItem, clientFolders: boolean): string {
  const company = r.linkedTo?.type === 'company' ? r.linkedTo.name : linkedItems.find((l) => l.path === r.path && l.linkedToType === 'company')?.linkedToName ?? null;
  const p = jsPath(r.path);
  const glyph = company ? `<span class="fx-fglyph" style="--c:${strColor(company)}">${escHtml(initialsOf(company))}</span>`
    : clientFolders ? '<span class="fx-fglyph is-unmatched">?</span>' : `<span class="fx-fglyph is-plain">${icon('folder', 16)}</span>`;
  const match = company ? `<span class="fx-match is-on">${icon('link', 10)}${escHtml(company)}</span>`
    : clientFolders ? `<span class="fx-match">no company yet · <button class="fx-match-btn" onclick="event.stopPropagation();openMsFilesLinkModal('${p}','${jsPath(r.name)}',true,'company')">Match</button></span>` : '';
  return `<div class="fx-folder msf-row${r.path === selectedPath ? ' sel' : ''}${r.exists ? '' : ' is-missing'}" data-item-path="${escHtml(r.path)}" tabindex="-1"
      onclick="msFilesSelect('${p}')" ondblclick="msFilesOpenItem('${p}')" oncontextmenu="msFilesContextMenu(event,'${p}')">
    ${glyph}
    <div class="fx-folder-t"><b>${escHtml(r.name)}</b><span>${escHtml(folderLine({ fileCount: r.fileCount ?? null, folderCount: r.folderCount ?? null, modifiedAt: r.modifiedAt }, today()) || 'Folder')}</span>${match}</div>
    ${isPinned(r.path) ? `<span class="fx-tile-pin">${icon('pin', 10)}</span>` : ''}
  </div>`;
}

/** A file as a card: a cover in its type's colour (a deck's wears the bars) with the extension badge, then the name,
 * its company's tile and the day it changed. `open` makes a single click open it (the Recent cards). */
function fileCard(r: { path: string; name: string; modifiedAt: string | null; exists?: boolean }, open = false): string {
  const p = jsPath(r.path);
  const kind = coverKind(r.name);
  const company = companyForPath(r.path, linkedItems);
  const cover = `<div class="fx-cover k-${kind}">${kind === 'deck' ? '<span class="bars" aria-hidden="true"><i></i><i></i><i></i></span>' : ''}<em>${escHtml(extBadge(r.name))}</em><span>${escHtml(coverLabel(r.name))}</span></div>`;
  const meta = `<div class="fx-card-m">${company ? tileHtml(company, 'pk-tile mini') : ''}<span>${r.modifiedAt ? escHtml(fmtDateShort(r.modifiedAt.slice(0, 10), true)) : ''}</span></div>`;
  const attrs = open
    ? `class="fx-card is-recent" role="button" tabindex="0" onclick="msFilesOpenRecent('${p}','${jsPath(r.name)}')" onkeydown="if(event.key==='Enter')this.click()"`
    : `class="fx-card msf-row${r.path === selectedPath ? ' sel' : ''}${r.exists === false ? ' is-missing' : ''}" data-item-path="${escHtml(r.path)}" tabindex="-1" onclick="msFilesSelect('${p}')" ondblclick="msFilesOpenItem('${p}')" oncontextmenu="msFilesContextMenu(event,'${p}')"`;
  return `<div ${attrs} data-tip="${escHtml(r.name)}">${cover}<div class="fx-card-n">${escHtml(r.name)}</div>${meta}${!open && isPinned(r.path) ? `<span class="fx-tile-pin">${icon('pin', 10)}</span>` : ''}</div>`;
}

const sectionHead = (title: string, n: number, right = '') => `<div class="rk-sh fx-sh"><h2 class="hd-major">${escHtml(title)}</h2><span class="rk-cnt">${n}</span>${right}</div>`;

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
  // On the first screens (OneDrive, the proposals folder) the files last opened follow the folders.
  const firstScreen = view === 'browse' && !searchQuery && (crumbs.length === 1 || atProposalsRoot());
  const recent = firstScreen && prefs.layout === 'icons' && recentTop.length
    ? `${sectionHead('Recent', recentTop.length, `<a href="#" class="rlink rk-sh-r" onclick="event.preventDefault();msFilesPlace('recent')">All recent</a>`)}<div class="fx-cards">${recentTop.map((f) => fileCard(f, true)).join('')}</div>` : '';
  const dropHint = currentPath() ? `<div class="fx-drop">Drop files from Finder here to copy them in${companyForPath(currentPath()!, linkedItems) ? ' — <b>they’re linked to that company</b>' : ''}. Space previews any file.</div>` : '';
  if (!rows.length) {
    const empty = searchQuery ? { icon: 'search', title: 'No matches', body: `No items named "${searchQuery}" here.` }
      : view === 'linked' ? { icon: 'link', title: 'No linked folders yet', body: 'Right-click a file or folder and choose "Link to company…", or match your client folders to companies.' }
      : view === 'recent' ? { icon: 'clock', title: 'No recent files', body: 'Files you open from MENA One show up here.' }
      : view === 'pinned' ? { icon: 'pin', title: 'No favourites yet', body: 'Right-click a file or folder and choose "Add to Favourites".' }
      : crumbs.length === 1 ? { icon: 'folder', title: 'No OneDrive folders on this Mac', body: 'Make sure OneDrive is installed, signed in and has synced at least one folder.' }
      : { icon: 'folder', title: 'This folder is empty', body: '' };
    body.innerHTML = banner() + emptyState(empty) + dropHint;
    renderIcons(body);
    return;
  }
  if (selectedPath && !rows.some((r) => r.path === selectedPath)) selectedPath = null;
  const attr = jsPath;
  const count = `<div class="fx-count">${rows.length} item${rows.length === 1 ? '' : 's'}${searchQuery ? ' found' : ''}</div>`;
  if (prefs.layout === 'icons') {
    const folders = rows.filter((r) => r.isFolder), files = rows.filter((r) => !r.isFolder);
    const clientFolders = atProposalsRoot();
    body.innerHTML = banner()
      + (folders.length ? `${sectionHead(clientFolders ? 'Client folders' : 'Folders', folders.length)}<div class="fx-folders">${folders.map((r) => folderTile(r, clientFolders)).join('')}</div>` : '')
      + (files.length ? `${sectionHead('Files', files.length)}<div class="fx-cards">${files.map((r) => fileCard(r)).join('')}</div>` : '')
      + recent + dropHint;
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
          ? `<span class="fx-cell">${r.linkedTo ? `<span class="pk-mini-co">${r.linkedTo.type === 'company' ? tileHtml(r.linkedTo.name, 'pk-tile mini') : icon('target', 12)}${escHtml(r.linkedTo.name)}</span>` : ''}</span>`
          : `<span class="fx-cell">${r.modifiedAt ? escHtml(fmtDateFromIso(r.modifiedAt)) : '—'}</span><span class="fx-cell num">${r.isFolder ? '—' : formatBytes(r.size)}</span><span class="fx-cell">${escHtml(kindOf(r).label)}</span>`}
      </div>`).join('')}
    </div>` + count + dropHint;
  }
  renderIcons(body);
}

/** A Recent card: opens the file where it lives. */
export async function msFilesOpenRecent(path: string, name: string): Promise<void> {
  try {
    await filesOpen(path);
    void recordRecent(path, name, false);
  } catch (e) {
    toast('Could not open the file', { tone: 'error', detail: String(e) });
  }
}
expose('msFilesOpenRecent', msFilesOpenRecent);

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
      <button class="${banner() ? 'btn-secondary' : 'btn-primary'} btn-sm" onclick="msFilesOpenItem('${attr}')">${item.isFolder ? 'Open folder' : 'Open'}</button>
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

// Files' keys (core/keys.ts).
registerKey({ scope: 'list', tabs: ['files'], combo: 'mod+f', inInputs: true, label: 'Search this folder', group: 'Files', run: () => { (document.getElementById('msf-search') as HTMLInputElement | null)?.focus(); } });
registerKey({ scope: 'list', tabs: ['files'], combo: ['mod+arrowup', 'backspace'], label: 'Up one folder', group: 'Files', id: 'files-up', run: () => msFilesGoBack() });
const fileStep = (key: 'down' | 'up' | 'left' | 'right') => {
  const rows = currentRows();
  if (!rows.length) return false;
  const idx = rows.findIndex((r) => r.path === selectedPath);
  let next = -1;
  if (prefs.layout === 'icons' && idx >= 0 && (key === 'down' || key === 'up')) {
    // Tiles and cards sit in rows of different widths: step to the nearest one in the row below or above.
    const els = [...document.querySelectorAll<HTMLElement>('#msf-body [data-item-path]')];
    const at = els.find((el) => el.dataset.itemPath === selectedPath)?.getBoundingClientRect();
    if (!at) return false;
    const rects = els.map((el) => ({ path: el.dataset.itemPath!, r: el.getBoundingClientRect() }));
    const beyond = rects.filter((x) => (key === 'down' ? x.r.top > at.top + 4 : x.r.top < at.top - 4));
    if (!beyond.length) return true;
    const rowTop = key === 'down' ? Math.min(...beyond.map((x) => x.r.top)) : Math.max(...beyond.map((x) => x.r.top));
    const target = beyond.filter((x) => Math.abs(x.r.top - rowTop) < 4).sort((a, b) => Math.abs(a.r.left - at.left) - Math.abs(b.r.left - at.left))[0];
    next = rows.findIndex((r) => r.path === target.path);
    if (next < 0) return true;
  } else if (key === 'down') next = idx < 0 ? 0 : Math.min(rows.length - 1, idx + 1);
  else if (key === 'up') next = idx < 0 ? 0 : Math.max(0, idx - 1);
  else if (prefs.layout !== 'icons') return false;
  else if (key === 'right') next = Math.min(rows.length - 1, idx + 1);
  else next = Math.max(0, idx - 1);
  msFilesSelect(rows[next].path);
  document.querySelector(`#msf-body [data-item-path="${CSS.escape(rows[next].path)}"]`)?.scrollIntoView({ block: 'nearest' });
  return true;
};
registerKey({ scope: 'list', tabs: ['files'], combo: ['arrowdown', 'j'], label: 'Select', group: 'Files', run: () => fileStep('down') });
registerKey({ scope: 'list', tabs: ['files'], combo: ['arrowup', 'k'], run: () => fileStep('up') });
registerKey({ scope: 'list', tabs: ['files'], combo: 'arrowright', run: () => fileStep('right') });
registerKey({ scope: 'list', tabs: ['files'], combo: 'arrowleft', run: () => fileStep('left') });
registerKey({ scope: 'list', tabs: ['files'], combo: 'space', label: 'Quick Look', group: 'Files', when: () => currentRows().some((r) => r.path === selectedPath && !r.isFolder), run: () => { void quickLookRow(selectedPath!); } });
registerKey({ scope: 'list', tabs: ['files'], combo: 'enter', label: 'Open', group: 'Files', when: () => currentRows().some((r) => r.path === selectedPath), run: () => { void msFilesOpenItem(selectedPath!); } });
