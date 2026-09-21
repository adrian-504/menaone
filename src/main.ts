import './styles.css';

// macOS app window: the title bar is transparent and overlays the page
// (tauri.conf.json titleBarStyle "Overlay"), so the sidebar and location bar
// run to the top edge with the native traffic lights over them. The class
// makes room for the lights; the strip keeps the whole top edge draggable.
// Not applied in a plain browser preview.
if ('__TAURI_INTERNALS__' in window && /Mac/i.test(navigator.platform)) {
  document.documentElement.classList.add('mac-window-chrome');
  const strip = document.createElement('div');
  strip.id = 'window-drag-strip';
  strip.setAttribute('data-tauri-drag-region', '');
  strip.setAttribute('aria-hidden', 'true');
  document.body.prepend(strip);
}
import { S } from './lib/state';
import { STATUSES } from './lib/constants';
import { escHtml, getClients, expose } from './lib/utils';
import { loadAllData, getCommercialSetup, getProjects, getAreas, getNoteTemplates, getAllTags, getInboxItems, getMeetings, getCompanies, getOpportunities, ms365Status, getSavedLists, identityCurrentUser } from './lib/db';
import { registerPeriodChangeHandler, populatePeriodSelector } from './lib/period';
import { refreshAll, refreshBadges, getActiveTabId, renderTab } from './lib/registry';
import { markLoadedAsSaved } from './lib/persist';
import { ownerName } from './lib/commercial';

// Retry buttons in "couldn't load" states re-run a view's renderer.
expose('renderTab', renderTab);

// Core / cross-cutting logic
import { switchTab } from './core/nav';
import { renderIcons, initSidebarCollapsed, applyMs365SidebarVisibility } from './core/chrome';
import { initTheme } from './core/theme';
import './core/router';
import './lib/links';
import './core/commandPalette';
import { backfillMilestoneDates, registerPopulateAllSelects } from './core/proposals';
import './core/backup';
import { populateAgrFilters } from './core/agreements';
import { populateCtListFilter, populateCtTypeFilter } from './core/contacts';

// Tabs (each registers its renderer with the registry on import)
import './tabs/dashboard';
import './tabs/followup';
import { populateWqOwnerFilter } from './tabs/pending';
import './tabs/database';
import './tabs/reports';
import './tabs/analytics';
import './tabs/notes';
import './tabs/todo';
import './tabs/pricing';
import './tabs/companies';
import './tabs/contactPage';
import './tabs/proposalPage';
import './tabs/agreementPage';
import { loadClientMatchSettings, autoLinkMeetings } from './tabs/meetingClient';
import './tabs/opportunities';
import './tabs/projects';
import './tabs/myday';
import './tabs/cleanup';
import './core/shortcuts';
import { startReminders } from './tabs/reminders';
import { rememberFilters } from './lib/rememberFilters';
import './tabs/inbox';
import './tabs/meetings';
import './tabs/commitments';
import './tabs/files';
import './tabs/settings';
import './tabs/actionRequired';
import './tabs/calendar';
import './tabs/intelligence';
import { renderStageMappingTable } from './tabs/hubspot';

// Sidebar chrome (icons, collapse state, color theme) is static markup
// already in the DOM by the time this module runs — set it up before the
// async data load so there's no flash of the wrong theme/icons.
initTheme();
initSidebarCollapsed();
renderIcons();

/** Populate every filter/select that isn't already refreshed by its own tab's
 * registered render function (Pending/Agreements populate their own filters
 * on switchTab; these don't have an obvious "current tab" hook so we just do
 * them all on load and after every proposal add/edit). */
function populateAllSelects(): void {
  ['db-status', 'r-status'].forEach((id) => {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">All statuses</option>` + STATUSES.map((s) => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
    el.value = cur;
  });
  ['db-type', 'r-type'].forEach((id) => {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (!el) return;
    const cur = el.value;
    const services = id === 'db-type'
      ? [...new Set(S.proposals.flatMap((p) => (p.lines?.length ? p.lines.map((l) => l.serviceName) : [p.type || ''])).filter((t) => t && t !== '—'))].sort()
      : [...new Set(S.proposals.map((p) => p.type).filter((t) => t && t !== '—'))].sort() as string[];
    el.innerHTML = `<option value="">${id === 'db-type' ? 'All services' : 'All types'}</option>` + services.map((t) => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('');
    el.value = cur;
  });
  const ownerSel = document.getElementById('db-owner') as HTMLSelectElement | null;
  if (ownerSel) {
    const cur = ownerSel.value;
    const owners = [...new Set(S.proposals.map(ownerName).filter(Boolean))].sort();
    ownerSel.innerHTML = `<option value="">All owners</option>` + owners.map((o) => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join('');
    ownerSel.value = cur;
  }
  const entitySel = document.getElementById('db-entity') as HTMLSelectElement | null;
  if (entitySel) {
    const cur = entitySel.value;
    entitySel.innerHTML = `<option value="">All entities</option>` + S.businessEntities.map((e) => `<option value="${e.id}">${escHtml(e.name)}</option>`).join('');
    entitySel.value = cur;
  }
  const ctSel = document.getElementById('ct-client') as HTMLSelectElement | null;
  if (ctSel) {
    const cur = ctSel.value;
    ctSel.innerHTML = `<option value="">All Clients</option>` + getClients().map((c) => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
    ctSel.value = cur;
  }
  const stSel = document.getElementById('status-modal-sel') as HTMLSelectElement | null;
  if (stSel) stSel.innerHTML = STATUSES.map((s) => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
  populateCtListFilter();
  populateCtTypeFilter();
  populateAgrFilters();
  populateWqOwnerFilter();
}
registerPopulateAllSelects(populateAllSelects);

/** Service catalog, rate cards, entities, team and rates — loaded at start
 * and again whenever Settings or the catalog change them. */
export function applyCommercialSetup(setup: import('./lib/types').CommercialSetup): void {
  S.services = setup.services;
  S.rateCards = setup.rateCards;
  S.businessEntities = setup.businessEntities;
  S.team = setup.teamMembers;
  S.fxRates = setup.fxRates;
  S.proposalsRoot = setup.proposalsRoot;
  (window as any).fillTeamNames?.();
}
expose('applyCommercialSetup', applyCommercialSetup);
expose('populateAllSelects', populateAllSelects);

registerPeriodChangeHandler(() => {
  refreshAll();
});

function showMigrationReport(report: import('./lib/migrateNotesMarkdown').MigrationReport): void {
  const body = document.getElementById('migration-report-body');
  if (!body) return;
  if (report.error) {
    body.innerHTML = `<p class="t-red">${escHtml(report.error)}</p>`;
  } else {
    const parts = [
      `<p>Notes now store their content as Markdown instead of rich HTML — a cleaner, more portable format that works with the new writing experience.</p>`,
      `<p><strong>${report.convertedNotes}</strong> of ${report.totalNotes} notes converted` + (report.convertedTemplates > 0 ? `, plus ${report.convertedTemplates} template${report.convertedTemplates === 1 ? '' : 's'}.` : '.') + `</p>`,
      report.backupPath ? `<p class="t-meta t-muted">A full backup of your data (from before this conversion) was saved to:<br><code class="path-code">${escHtml(report.backupPath)}</code></p>` : '',
    ];
    if (report.needsReviewNotes.length > 0) {
      parts.push(`<p class="mt-8"><strong>${report.needsReviewNotes.length} note${report.needsReviewNotes.length === 1 ? '' : 's'} may need a quick look</strong> — some formatting didn't convert perfectly:</p>`);
      parts.push(`<ul class="report-list">${report.needsReviewNotes.map((n) => `<li><a href="#" onclick="event.preventDefault();closeMigrationReport();openRecord('note', ${n.id})">${escHtml(n.title)}</a></li>`).join('')}</ul>`);
    }
    body.innerHTML = parts.join('');
  }
  document.getElementById('modal-md-migration')?.classList.add('open');
}

export function closeMigrationReport(): void {
  document.getElementById('modal-md-migration')?.classList.remove('open');
}
expose('closeMigrationReport', closeMigrationReport);

function showOpportunityBackfillReport(report: import('./lib/migrateOpportunitiesBackfill').OpportunityBackfillReport): void {
  const body = document.getElementById('opp-backfill-report-body');
  if (!body) return;
  if (report.error) {
    body.innerHTML = `<p class="t-red">${escHtml(report.error)}</p>`;
  } else {
    body.innerHTML = [
      `<p>Opportunities are now a first-class part of the app. The <strong>${report.migratedCount}</strong> proposal${report.migratedCount === 1 ? '' : 's'} sitting at "Lead" status — nothing else filled in yet — became your first Opportunities. The original proposal records are untouched.</p>`,
      report.backupPath ? `<p class="t-meta t-muted">A full backup of your data (from before this) was saved to:<br><code class="path-code">${escHtml(report.backupPath)}</code></p>` : '',
    ].join('');
  }
  document.getElementById('modal-opp-backfill')?.classList.add('open');
}

export function closeOpportunityBackfillReport(): void {
  document.getElementById('modal-opp-backfill')?.classList.remove('open');
}
expose('closeOpportunityBackfillReport', closeOpportunityBackfillReport);

async function init(): Promise<void> {
  const data = await loadAllData();
  S.proposals = data.proposals;
  S.contacts = data.contacts;
  S.agreements = data.agreements;
  S.todos = data.todos;
  S.commitments = data.commitments || [];
  S.notes = data.notes;
  S.noteFolders = data.noteFolders.length ? data.noteFolders : ['Meeting Notes', 'Client Notes', 'Internal'];
  S.contactLists = data.contactLists;
  S.companyNotes = data.companyNotes;
  markLoadedAsSaved();
  applyCommercialSetup(await getCommercialSetup());
  [S.projects, S.areas, S.noteTemplates, S.allTags, S.inboxItems, S.meetings, S.companies, S.opportunities, S.ms365Status, S.savedLists] = await Promise.all([
    getProjects(true), getAreas(), getNoteTemplates(), getAllTags(), getInboxItems(), getMeetings(), getCompanies(), getOpportunities(), ms365Status(), getSavedLists(),
  ]);
  // Calendar/Action Required/the Settings shortcut are gated behind an active
  // Microsoft 365 connection (data-ms365-gated in index.html) — previously
  // nothing ever fetched the status at startup or applied it, so they stayed
  // hidden even when already connected.
  applyMs365SidebarVisibility();
  await loadClientMatchSettings();
  void autoLinkMeetings();

  backfillMilestoneDates();

  populateAllSelects();
  populatePeriodSelector();
  renderStageMappingTable();
  refreshBadges();

  // One-time Notes HTML→Markdown migration (Phase 3) — safe to call on every
  // launch, it no-ops once the app_meta flag is set. Runs after S.notes is
  // loaded but before the user can open Notes.
  const { migrateNotesToMarkdownIfNeeded } = await import('./lib/migrateNotesMarkdown');
  const report = await migrateNotesToMarkdownIfNeeded();
  if (report) showMigrationReport(report);

  // One-time backfill: Proposals sitting at "Lead" status (pre-proposal,
  // nothing else filled in) become the first real Opportunities — same
  // gated-by-app_meta-flag pattern as the Notes migration above.
  const { migrateLeadsToOpportunitiesIfNeeded } = await import('./lib/migrateOpportunitiesBackfill');
  const oppReport = await migrateLeadsToOpportunitiesIfNeeded();
  if (oppReport) showOpportunityBackfillReport(oppReport);

  // My Day — not Dashboard — is the landing view: "what needs my attention
  // today" is a more useful first screen than a KPI wall. Dashboard is still
  // fully intact, just no longer the default (see Insights in the sidebar).
  rememberFilters({ ids: ['co-filter-status', 'co-filter-industry', 'co-filter-service', 'co-filter-location', 'co-filter-owner', 'co-filter-contacts'], clear: 'clearCompanyFilters' });
  rememberFilters({ ids: ['ct-client', 'ct-list-filter', 'ct-type-filter'] });
  rememberFilters({ ids: ['agr-status', 'agr-service', 'agr-type', 'agr-prep'], clear: 'agrClear' });
  rememberFilters({ ids: ['db-status', 'db-type', 'db-owner', 'db-entity'], clear: 'dbClear' });
  rememberFilters({ ids: ['wq-filter-status', 'wq-filter-owner', 'wq-sort'], clear: 'wqClear' });
  rememberFilters({ ids: ['opp-stage-filter', 'opp-owner-filter'] });
  rememberFilters({ ids: ['proj-status-filter', 'proj-owner-filter', 'proj-sort'] });
  startReminders();
  // Who is using this device. Needs the Microsoft connection, so it runs in the
  // background and never holds up the start.
  void identityCurrentUser().then((id) => { S.currentUserId = id; }).catch(() => undefined);
  switchTab('myday');

  // Native-only wiring (no-op in browser dev-preview — no Tauri event bridge):
  // the native menu
  // bar (File/Edit/View/Window) emits `menu-action` with the clicked item's
  // id, routed here to the same functions the UI already calls.
  if ((window as any).__TAURI_INTERNALS__?.invoke) {
    const { listen } = await import('@tauri-apps/api/event');
    const w = window as any;
    await listen<string>('menu-action', async (e) => {
      const id = e.payload;
      if (id.startsWith('goto_')) { switchTab(id.slice('goto_'.length)); return; }
      if (id.startsWith('theme_')) { w.setTheme(id.slice('theme_'.length)); return; }
      switch (id) {
        case 'new_task': w.openTodoModal(null); break;
        case 'new_note': switchTab('notes'); w.createNewNote(null); break;
        case 'new_proposal': w.openAddModal(); break;
        case 'toggle_sidebar': w.toggleSidebar(); break;
        case 'command_palette': w.openCommandPalette(); break;
        case 'help_shortcuts': w.openShortcutSheet(); break;
        case 'help_user_guide': {
          const { invoke } = await import('@tauri-apps/api/core');
          try {
            await invoke('open_user_guide');
          } catch (err) {
            console.error('Could not open User Guide:', err);
          }
          break;
        }
      }
    });
  }
}

// In DEV builds without a real Tauri backend (plain browser preview), install
// a sample-data IPC mock before init() issues its first `invoke` call. The
// `import.meta.env.DEV` guard is a Vite compile-time constant, so `vite build`
// drops this whole branch (and never emits the devMock chunk) in production —
// the shipped app's real Tauri IPC bridge is completely untouched by this file.
const devMockReady = import.meta.env.DEV
  ? Promise.all([import('./lib/devMock').then(({ installDevMockIfNeeded }) => installDevMockIfNeeded()), import('./tabs/gallery')])
  : Promise.resolve();

devMockReady.finally(() => {
  init().catch((err) => {
    console.error('Failed to initialize MENA One:', err);
    document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif;color:firebrick"><h2>Failed to load the tracker database</h2><pre style="white-space:pre-wrap">${String(err)}</pre></div>`;
  });
});

// Exposed for debugging in devtools only.
(window as any).__menabig = { S, getActiveTabId };
