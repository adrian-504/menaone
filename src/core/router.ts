// The app shell's sense of place: which module and which record you're on,
// back/forward history across modules, the location bar, the window title,
// per-place scroll memory, and one `openRecord()` entry point every link in
// the app goes through.
//
// Modules keep their existing open/close functions (openCompanyDetail,
// openProjectDetail, …); each calls `notifyNavigated()` and the router reads
// the resulting place back from state. That lets navigation move onto the
// router without rewriting every inline `onclick` handler in one go.

import { S } from '../lib/state';
import { escHtml, expose } from '../lib/utils';
import { onNavigated } from '../lib/registry';
import { NavHistory, placeKey, samePlace, type Place, type RecordKind } from '../lib/navHistory';
import { onChange } from '../lib/changes';
import { updateRecordRail } from './recordRail';
import { syncBulkBars } from '../lib/bulkBar';

const w = window as any;

interface RecordPage {
  tab: string;
  /** The record open in this module right now, if any. */
  current(): number | string | null;
  open(key: number | string): void | Promise<void>;
  /** Back to the module's list. */
  close(): void;
  label(key: number | string): string | null;
  /** Whether the record still exists (a page can stay open in a module you left while the record is deleted elsewhere). */
  exists(key: number | string): boolean;
  /** Whether Escape should leave the record (not for editors like Notes). */
  escapeCloses: boolean;
}

const isOpen = (id: string) => !!document.getElementById(id)?.classList.contains('open');

function companyByKey(key: number | string) {
  return typeof key === 'number' ? S.companies.find((c) => c.id === key) : S.companies.find((c) => c.name === key);
}

/** Record kinds that open inside their module (a page, or a panel beside the list). */
const PAGES: Partial<Record<RecordKind, RecordPage>> = {
  company: {
    tab: 'companies',
    current: () => (isOpen('co-detail') && S.currentCompany ? S.companies.find((c) => c.name === S.currentCompany)?.id ?? S.currentCompany : null),
    open: (key) => { const name = companyByKey(key)?.name ?? (typeof key === 'string' ? key : null); if (name) w.openCompanyDetail(name); },
    close: () => w.closeCompanyDetail(),
    label: (key) => companyByKey(key)?.name ?? (typeof key === 'string' ? key : null),
    // Companies can also be opened by a name only known from proposals.
    exists: (key) => !!companyByKey(key) || typeof key === 'string',
    escapeCloses: true,
  },
  project: {
    tab: 'projects',
    current: () => (isOpen('proj-detail') ? S.currentProjectId : null),
    open: (key) => w.openProjectDetail(Number(key)),
    close: () => w.closeProjectDetail(),
    label: (key) => S.projects.find((p) => p.id === Number(key))?.name ?? null,
    exists: (key) => S.projects.some((p) => p.id === Number(key)),
    escapeCloses: true,
  },
  opportunity: {
    tab: 'opportunities',
    current: () => (isOpen('opp-detail') ? S.currentOpportunityId : null),
    open: (key) => w.openOpportunityDetail(Number(key)),
    close: () => w.closeOpportunityDetail(),
    label: (key) => S.opportunities.find((o) => o.id === Number(key))?.name ?? null,
    exists: (key) => S.opportunities.some((o) => o.id === Number(key)),
    escapeCloses: true,
  },
  meeting: {
    tab: 'meetings',
    current: () => (isOpen('meeting-detail') ? S.meetingEditId : null),
    open: (key) => w.openMeetingDetail(Number(key)),
    close: () => w.closeMeetingDetail(),
    label: (key) => S.meetings.find((m) => m.id === Number(key))?.title ?? null,
    exists: (key) => S.meetings.some((m) => m.id === Number(key)),
    escapeCloses: true,
  },
  contact: {
    tab: 'contacts',
    current: () => (isOpen('ct-detail') ? S.currentContactId : null),
    open: (key) => w.openContactPage(Number(key)),
    close: () => w.closeContactPage(),
    label: (key) => S.contacts.find((c) => c.id === Number(key))?.name || 'Unnamed contact',
    exists: (key) => S.contacts.some((c) => c.id === Number(key)),
    escapeCloses: true,
  },
  task: {
    tab: 'todo',
    current: () => S.taskDetailId,
    open: (key) => w.openTaskDetail(Number(key)),
    close: () => w.closeTaskDetail(),
    label: (key) => S.todos.find((t) => t.id === Number(key))?.title ?? null,
    exists: (key) => S.todos.some((t) => t.id === Number(key)),
    escapeCloses: true,
  },
  proposal: {
    tab: 'database',
    current: () => (isOpen('pr-detail') ? S.currentProposalId : isOpen('pr-builder') ? 'new' : null),
    open: (key) => (key === 'new' ? w.openProposalBuilder() : w.openProposalPage(Number(key))),
    close: () => w.closeProposalPage(),
    label: (key) => {
      if (key === 'new') return 'New proposal';
      const p = S.proposals.find((x) => x.id === Number(key));
      return p ? `${p.client} — SL# ${p.id}` : null;
    },
    exists: (key) => key === 'new' || S.proposals.some((p) => p.id === Number(key)),
    escapeCloses: true,
  },
  agreement: {
    tab: 'agreements',
    current: () => (isOpen('agr-detail') ? S.currentAgreementId : null),
    open: (key) => w.openAgreementPage(Number(key)),
    close: () => w.closeAgreementPage(),
    label: (key) => { const a = S.agreements.find((x) => x.id === Number(key)); return a ? a.agrRef || `${a.client} agreement` : null; },
    exists: (key) => S.agreements.some((a) => a.id === Number(key)),
    escapeCloses: true,
  },
  note: {
    tab: 'notes',
    current: () => S.currentNoteId,
    open: (key) => w.openNote(Number(key)),
    close: () => { /* Notes always shows its list beside the editor */ },
    label: (key) => S.notes.find((n) => n.id === Number(key))?.title || 'Untitled note',
    exists: (key) => S.notes.some((n) => n.id === Number(key)),
    escapeCloses: false,
  },
};

const DIALOGS: Partial<Record<RecordKind, { tab: string; open: (id: number) => void; label: (id: number) => string | null }>> = {};

const history = new NavHistory();
let restoring = false;
let pending = false;
/** While >0, a multi-step move (switch module, then open a record that loads
 * asynchronously) is in progress and is recorded once when it finishes. */
let batchDepth = 0;
const scrollMemory = new Map<string, number>();

function moduleLabel(tab: string): string {
  const el = document.querySelector(`.sb-item[data-tab="${tab}"] .sb-label`);
  if (el?.textContent) return el.textContent.trim();
  return tab === 'settings' ? 'Settings' : tab === 'gallery' ? 'Component Gallery' : tab;
}

function pageForTab(tab: string): [RecordKind, RecordPage] | null {
  for (const [kind, page] of Object.entries(PAGES) as [RecordKind, RecordPage][]) {
    if (page.tab === tab) return [kind, page];
  }
  return null;
}

/** Closes a module's open page when its record no longer exists; true if it did. */
function closeMissingRecord(): boolean {
  const entry = pageForTab(S.currentTab);
  if (!entry) return false;
  const [kind, page] = entry;
  const key = page.current();
  if (key == null || page.exists(key) || kind === 'note') return false;
  page.close();
  return true;
}

export function currentPlace(): Place {
  const tab = S.currentTab;
  const entry = pageForTab(tab);
  const key = entry?.[1].current();
  return entry && key != null ? { tab, kind: entry[0], key } : { tab };
}

function recordLabel(p: Place): string | null {
  if (p.kind == null || p.key == null) return null;
  return PAGES[p.kind]?.label(p.key) ?? null;
}

// ── Chrome: location bar + window title ─────────────────────────────────────

let tauriSetTitle: ((title: string) => void) | null | undefined;
async function setWindowTitle(title: string): Promise<void> {
  document.title = title;
  if (tauriSetTitle === undefined) {
    tauriSetTitle = null;
    if (w.__TAURI_INTERNALS__?.invoke) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        tauriSetTitle = (t) => { void win.setTitle(t).catch(() => { /* not permitted: document.title still set */ }); };
      } catch { tauriSetTitle = null; }
    }
  }
  tauriSetTitle?.(title);
}

/** The company fields of a record: its company link and its company text. */
function companyFieldsOf(kind: RecordKind, id: number): { companyId?: number | null; name?: string | null } | null {
  const pick = <T extends { companyId?: number | null }>(r: T | undefined, name: (r: T) => string | null | undefined) =>
    (r ? { companyId: r.companyId, name: name(r) } : null);
  switch (kind) {
    case 'project': return pick(S.projects.find((x) => x.id === id), (r) => r.companyName);
    case 'opportunity': return pick(S.opportunities.find((x) => x.id === id), (r) => r.companyName);
    case 'meeting': return pick(S.meetings.find((x) => x.id === id), (r) => r.companyName);
    case 'note': return pick(S.notes.find((x) => x.id === id), (r) => r.clientName);
    case 'task': return pick(S.todos.find((x) => x.id === id), (r) => r.client);
    case 'proposal': return pick(S.proposals.find((x) => x.id === id), (r) => r.client);
    case 'agreement': return pick(S.agreements.find((x) => x.id === id), (r) => r.client);
    case 'contact': return pick(S.contacts.find((x) => x.id === id), (r) => r.clientName);
    default: return null;
  }
}

/** Company a record belongs to, shown as a link beside the record in the
 * location bar. The linked company (`companyId`) is authoritative and shown
 * under its current name; the record's company text is only used for a
 * record whose company link hasn't been saved yet. */
export function placeCompany(p: Place): { id: number | null; name: string } | null {
  if (p.key == null || p.kind == null || p.kind === 'company') return null;
  const ref = companyFieldsOf(p.kind, Number(p.key));
  if (!ref) return null;
  const linked = ref.companyId != null ? S.companies.find((c) => c.id === ref.companyId) : undefined;
  if (linked) return { id: linked.id, name: linked.name };
  const name = (ref.name || '').trim();
  return name ? { id: ref.companyId ?? null, name } : null;
}

function renderChrome(): void {
  const place = currentPlace();
  const module = moduleLabel(place.tab);
  const label = recordLabel(place);
  const crumbs = document.getElementById('loc-crumbs');
  if (crumbs) {
    const parts: string[] = [];
    if (label != null) {
      parts.push(`<button class="loc-crumb" onclick="navToModuleList('${place.tab}')">${escHtml(module)}</button>`);
      parts.push(`<span class="loc-sep" aria-hidden="true">›</span>`);
      parts.push(`<span class="loc-crumb current" aria-current="page">${escHtml(label)}</span>`);
      const company = placeCompany(place);
      if (company) {
        parts.push(`<span class="loc-context">in <a class="rlink" href="#" data-rkind="company" ${company.id != null ? `data-rid="${company.id}"` : `data-rname="${escHtml(company.name)}"`} onclick="return openRecordLink(event,this)">${escHtml(company.name)}</a></span>`);
      }
    } else {
      parts.push(`<span class="loc-crumb current" aria-current="page">${escHtml(module)}</span>`);
    }
    crumbs.innerHTML = parts.join('');
  }
  const back = document.getElementById('loc-back') as HTMLButtonElement | null;
  const fwd = document.getElementById('loc-fwd') as HTMLButtonElement | null;
  if (back) back.disabled = !history.canGoBack;
  if (fwd) fwd.disabled = !history.canGoForward;
  updateRecordRail(place.kind, place.key);
  syncBulkBars();
  void setWindowTitle(label != null ? `${label} — ${module} — MENA One` : `${module} — MENA One`);
}

// ── Recording where we are ──────────────────────────────────────────────────

const RECENTS_KEY = 'menaone.recentRecords';
export interface RecentRecord { kind: RecordKind; key: number | string; label: string }

export function recentRecords(): RecentRecord[] {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); } catch { return []; }
}

function rememberRecent(p: Place): void {
  const label = recordLabel(p);
  if (p.kind == null || p.key == null || label == null) return;
  const next = [{ kind: p.kind, key: p.key, label }, ...recentRecords().filter((r) => !(r.kind === p.kind && String(r.key) === String(p.key)))].slice(0, 8);
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* recents just won't persist */ }
}

/** Remember where the current place is scrolled before leaving it (scroll
 * events alone can lag behind a click that navigates). */
function saveScroll(): void {
  const current = history.current;
  if (current && samePlace(current, currentPlace())) scrollMemory.set(placeKey(current), window.scrollY);
}

function restoreScroll(p: Place): void {
  const y = scrollMemory.get(placeKey(p)) ?? 0;
  const apply = () => { if (samePlace(currentPlace(), p)) window.scrollTo(0, y); };
  apply();
  requestAnimationFrame(apply);
  // Async views (projects, opportunities, meetings) finish rendering a moment later.
  window.setTimeout(apply, 120);
}

function settle(): void {
  pending = false;
  // Arriving in a module whose open page shows a record deleted meanwhile: show its list.
  if (!restoring && closeMissingRecord()) return;
  const place = currentPlace();
  if (restoring) { renderChrome(); return; }
  if (history.visit(place)) {
    rememberRecent(place);
    restoreScroll(place);
  }
  renderChrome();
}

onNavigated(() => {
  // switchTab followed by openXDetail in the same click is one move, not two.
  if (pending || batchDepth > 0) return;
  pending = true;
  queueMicrotask(settle);
});

window.addEventListener('scroll', () => {
  scrollMemory.set(placeKey(currentPlace()), window.scrollY);
  document.getElementById('loc-bar')?.classList.toggle('scrolled', window.scrollY > 4);
}, { passive: true });

// ── Moving around ───────────────────────────────────────────────────────────

async function goTo(place: Place): Promise<void> {
  restoring = true;
  try {
    if (S.currentTab !== place.tab) w.switchTab(place.tab);
    const entry = pageForTab(place.tab);
    if (entry) {
      const [, page] = entry;
      const now = page.current();
      if (place.key != null) {
        if (String(now) !== String(place.key)) await page.open(place.key);
      } else if (now != null) {
        page.close();
      }
    }
    closeMissingRecord();
  } finally {
    restoring = false;
  }
  const landed = currentPlace();
  history.replaceCurrent(landed);
  restoreScroll(landed);
  renderChrome();
}

export function navBack(): void {
  saveScroll();
  const p = history.back();
  if (p) void goTo(p);
}
expose('navBack', navBack);

export function navForward(): void {
  saveScroll();
  const p = history.forward();
  if (p) void goTo(p);
}
expose('navForward', navForward);

/** Sidebar click: another module opens as you left it; the module you're
 * already in goes back to its list. */
export function navToModule(tab: string): void {
  saveScroll();
  if (S.currentTab === tab) { navToModuleList(tab); return; }
  w.switchTab(tab);
}
expose('navToModule', navToModule);

export function navToModuleList(tab: string): void {
  if (S.currentTab !== tab) w.switchTab(tab);
  const entry = pageForTab(tab);
  if (entry && entry[1].current() != null) entry[1].close();
}
expose('navToModuleList', navToModuleList);

/** "← Back" on a record page: return to wherever you came from — another
 * record, another module — or to the module's list if this is where you started. */
export function navBackFromRecord(): void {
  if (history.canGoBack) navBack();
  else closeCurrentRecord();
}
expose('navBackFromRecord', navBackFromRecord);

/** Leaves the open record for its module's list (Escape). */
export function closeCurrentRecord(opts: { fromEscape?: boolean } = {}): boolean {
  const entry = pageForTab(S.currentTab);
  if (!entry || entry[1].current() == null) return false;
  if (opts.fromEscape && !entry[1].escapeCloses) return false;
  entry[1].close();
  return true;
}
expose('closeCurrentRecord', closeCurrentRecord);

/** Opens any record from anywhere — link chips, search results, previews. */
export function openRecord(kind: RecordKind, key: number | string): void {
  saveScroll();
  const page = PAGES[kind];
  if (page) {
    batchDepth++;
    let opened: void | Promise<void>;
    try {
      if (S.currentTab !== page.tab) w.switchTab(page.tab);
      opened = page.open(key);
    } catch (err) {
      batchDepth--;
      throw err;
    }
    void Promise.resolve(opened).finally(() => { batchDepth--; settle(); });
    return;
  }
  const dialog = DIALOGS[kind];
  if (dialog) {
    if (S.currentTab !== dialog.tab) w.switchTab(dialog.tab);
    dialog.open(Number(key));
  }
}
expose('openRecord', openRecord);

/** `onclick` target for `.rlink` anchors built by lib/links.ts. */
export function openRecordLink(e: Event, el: HTMLElement): boolean {
  e.preventDefault();
  e.stopPropagation();
  const kind = el.dataset.rkind as RecordKind | undefined;
  const key = el.dataset.rid != null ? Number(el.dataset.rid) : el.dataset.rname;
  if (kind && key != null && key !== '') openRecord(kind, key);
  return false;
}
expose('openRecordLink', openRecordLink);

export function recordTitle(kind: RecordKind, key: number | string): string | null {
  return PAGES[kind]?.label(key) ?? DIALOGS[kind]?.label(Number(key)) ?? null;
}

// ── Input: keyboard and mouse back/forward ──────────────────────────────────

function inEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !!el.closest?.('.cm-editor'));
}

document.addEventListener('keydown', (e) => {
  if (S.commandPaletteOpen || document.querySelector('.modal-ov.open')) return;
  const mod = e.metaKey || e.ctrlKey;
  // ⌘[ / ⌘] (Ctrl on Windows) like Finder and browsers; Alt+←/→ like Windows Explorer.
  const back = (mod && !e.altKey && e.key === '[') || (e.altKey && !mod && e.key === 'ArrowLeft');
  const fwd = (mod && !e.altKey && e.key === ']') || (e.altKey && !mod && e.key === 'ArrowRight');
  if (!back && !fwd) return;
  if (inEditable(e.target)) return;
  e.preventDefault();
  if (back) navBack(); else navForward();
});

// Any click may navigate (list row → record page): note the scroll position first.
document.addEventListener('click', saveScroll, true);

// Mouse side buttons (button 3 = back, 4 = forward).
window.addEventListener('mouseup', (e) => {
  if (e.button === 3) { e.preventDefault(); navBack(); }
  if (e.button === 4) { e.preventDefault(); navForward(); }
});

// Record titles in the location bar follow renames made anywhere.
onChange(() => renderChrome());

expose('refreshLocationChrome', () => renderChrome());

// ── Sidebar groups: collapsible, remembered; a collapsed group still shows the page you're on ──

const GROUPS_KEY = 'menaone.sidebarCollapsed';

function collapsedGroups(): string[] {
  try { return JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]'); } catch { return []; }
}

export function applySidebarGroups(): void {
  const collapsed = new Set(collapsedGroups());
  document.querySelectorAll<HTMLElement>('.sb-group[data-group]').forEach((g) => {
    const on = collapsed.has(g.dataset.group!);
    g.classList.toggle('collapsed', on);
    g.querySelector('.sb-group-toggle')?.setAttribute('aria-expanded', String(!on));
  });
}

export function toggleSidebarGroup(key: string): void {
  const set = new Set(collapsedGroups());
  if (set.has(key)) set.delete(key); else set.add(key);
  try { localStorage.setItem(GROUPS_KEY, JSON.stringify([...set])); } catch { /* not remembered */ }
  applySidebarGroups();
}
expose('toggleSidebarGroup', toggleSidebarGroup);
applySidebarGroups();
