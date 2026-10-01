import { bandSource, renderMe, setBandSource, setTint, setYourName, tint, yourName, type BandSource, type Tint } from '../lib/appearance';
import { icon } from '../lib/icons';
import { getActiveTabId } from '../lib/registry';
import { OPTIONAL_MODULES, applySidebarModules, moduleShown, setModuleShown } from '../lib/sidebarModules';
import { collapseRow, settleNew } from '../lib/motion';
import { OFFLINE_LABEL } from '../lib/offline';
import { allSaved } from '../lib/persist';
import { savedTick } from '../lib/motion';
import { S } from '../lib/state';
import { toast } from '../lib/ui';
import { escHtml, expose, showConfirm, fmtDateTime } from '../lib/utils';
import { registerTabRenderer } from '../lib/registry';
import { rebuildSearchIndex, revealLogsFolder, ms365GetClientId, ms365SetClientId, ms365GetTenantId, ms365SetTenantId, ms365Status, ms365Connect, ms365Disconnect, runCompanyMigration, getCompanies, listLocalBackups, backupDatabaseNow, revealBackupsFolder } from '../lib/db';
import { THEMES } from '../core/theme';
import { applyMs365SidebarVisibility } from '../core/chrome';
import { renderTab } from '../lib/registry';
import { loadReviewQueue } from './companies';
import { renderCommercialSettings } from './settingsCommercial';
import { renderTemplatesSettings } from './settingsTemplates';
import { renderDataStatus, APP_VERSION } from './settingsData';
import { PANES, settingsNavHints, settingsSubtitle } from '../lib/settingsPage';

async function loadStatus(): Promise<void> {
  S.ms365Status = await ms365Status();
  renderMe();
}

// setTheme() (core/theme.ts) is expose()d on window and, once it applies the
// theme, calls renderActiveTab() — which re-runs renderSettingsTab() and thus
// this picker — so the swatch onclick can call it directly with no local
// wrapper needed to move the active ring.
function renderThemePicker(): void {
  const el = document.getElementById('theme-picker');
  if (!el) return;
  el.innerHTML = THEMES.map((t) => `
    <button class="theme-swatch${t.id === S.theme ? ' active' : ''}" onclick="setTheme('${t.id}')" data-tip="${escHtml(t.name)}" aria-label="${escHtml(t.name)}">
      <span class="theme-swatch-preview" style="background:${t.swatchSurface}">
        <span class="theme-swatch-preview-strip" style="background:${t.swatchSidebar}"></span>
        <span class="theme-swatch-preview-body">
          <span class="theme-swatch-preview-dot" style="background:${t.swatchAccent}"></span>
        </span>
      </span>
      <span class="theme-swatch-label">${escHtml(t.name)}</span>
    </button>`).join('');
}

// ── Appearance (brand slice) ──
async function renderAppearance(): Promise<void> {
  document.querySelectorAll<HTMLElement>('#tint-picker .seg-btn').forEach((b) => { const on = b.dataset.tint === tint(); b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); });
  document.querySelectorAll<HTMLElement>('#band-picker .seg-btn').forEach((b) => { const on = b.dataset.band === bandSource(); b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); });
  const name = document.getElementById('appearance-name') as HTMLInputElement | null;
  if (name && document.activeElement !== name) name.value = yourName();
  renderSidebarSwitches();
  const count = document.getElementById('band-count');
  if (count && (window as any).__TAURI_INTERNALS__?.invoke) {
    const { invoke } = await import('@tauri-apps/api/core');
    const n = ((await invoke<string[] | null>('band_photos_list').catch(() => null)) ?? []).length;
    count.textContent = n ? `${n} photo${n === 1 ? '' : 's'} chosen` : 'No photos chosen yet';
  }
}
function renderSidebarSwitches(): void {
  const el = document.getElementById('sidebar-switches');
  if (!el) return;
  el.innerHTML = OPTIONAL_MODULES.map((m) => {
    const iconName = document.querySelector<HTMLElement>(`#sidebar .sb-item[data-tab="${m.tab}"] [data-icon]`)?.dataset.icon || m.icon;
    const on = moduleShown(m.tab);
    return `<label class="sb-switch-row"><span class="sb-switch-icon">${icon(iconName, 15)}</span><span class="sb-switch-name">${escHtml(m.name)}</span><input type="checkbox" class="switch" ${on ? 'checked' : ''} onchange="appearanceToggleModule('${m.tab}', this.checked)" aria-label="Show ${escHtml(m.name)} in the sidebar"></label>`;
  }).join('');
}
expose('appearanceToggleModule', (tab: string, on: boolean) => {
  setModuleShown(tab, on);
  const item = document.querySelector<HTMLElement>(`#sidebar .sb-item[data-tab="${tab}"]`);
  const apply = () => applySidebarModules(getActiveTabId());
  if (on) { apply(); settleNew(item); return; }
  // Leaving: the row closes, then it's hidden (unless it's the page you're on).
  if (item && !item.hidden && getActiveTabId() !== tab) void collapseRow(item).then(apply); else apply();
});

expose('appearanceSetTint', (t: Tint) => { setTint(t); void renderAppearance(); renderSettingsNav(); });
expose('appearanceSetBand', (b: BandSource) => { setBandSource(b); void renderAppearance(); });
expose('appearanceSetName', (v: string) => { setYourName(v); renderMe(); toast(v.trim() ? 'Name saved' : 'Name cleared', { tone: 'success' }); });
expose('appearanceChoosePhotos', async () => {
  if (!(window as any).__TAURI_INTERNALS__?.invoke) { toast('Choosing photos works in the app, not in this preview'); return; }
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ multiple: true, directory: false, filters: [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png', 'heic', 'webp'] }], title: 'Choose photos for My Day' });
  const paths = Array.isArray(picked) ? picked : typeof picked === 'string' ? [picked] : [];
  if (!paths.length) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke<string[]>('band_photos_add', { paths });
    setBandSource('mine');
    toast(`${paths.length} photo${paths.length === 1 ? '' : 's'} added to My Day`, { tone: 'success' });
  } catch (err) {
    toast("Couldn't add the photos", { tone: 'error', detail: String(err) });
  }
  void renderAppearance();
});

const PANE_KEY = 'menaone.settingsPane';

export function setSettingsPane(pane: string): void {
  try { localStorage.setItem(PANE_KEY, pane); } catch { /* not remembered */ }
  showSettingsPane();
}
expose('setSettingsPane', setSettingsPane);

function currentPane(): string {
  let pane = 'general';
  try { pane = localStorage.getItem(PANE_KEY) || 'general'; } catch { /* default */ }
  return document.querySelector(`.settings-pane[data-pane="${pane}"]`) ? pane : 'general';
}

/** The navigation: an icon tile per pane, a coral marker on the open one, and what each has to say on the right
 * (lib/settingsPage.ts). Drawn again when what it says changes. */
function renderSettingsNav(): void {
  const nav = document.getElementById('settings-nav');
  if (!nav) return;
  const pane = currentPane();
  const hints = settingsNavHints({
    tint: tint(), teamCount: S.team.filter((t) => t.active).length, signatureEmpty, now: new Date(),
    outlookConnected: S.ms365Status ? S.ms365Status.status === 'connected' : null, dailyBackupAt: S.housekeeping?.dailyLast ?? null,
  });
  nav.innerHTML = PANES.map((p) => {
    const h = hints[p.key];
    return `<button class="settings-nav-item${p.key === pane ? ' active' : ''}" data-pane="${p.key}" aria-current="${p.key === pane ? 'page' : 'false'}" onclick="setSettingsPane('${p.key}')">
      <span class="settings-nav-ic" style="--c:${p.tint}">${icon(p.icon, 14)}</span><span class="settings-nav-name">${escHtml(p.title)}</span>
      ${h ? `<span class="settings-nav-hint${h.tone ? ` t-${h.tone}` : ''}">${escHtml(h.text)}${h.dot ? `<i class="is-${h.dot}"></i>` : ''}</span>` : ''}</button>`;
  }).join('');
  const sub = document.getElementById('settings-subtitle'); if (sub) sub.textContent = settingsSubtitle(APP_VERSION);
  document.querySelectorAll<HTMLElement>('.settings-pane').forEach((el) => {
    const info = PANES.find((p) => p.key === el.dataset.pane);
    const desc = el.querySelector('.settings-pane-desc');
    if (info && desc) desc.textContent = info.description;
  });
}
expose('renderSettingsNav', renderSettingsNav);

/** No signature written yet (the Templates pane says so when it reads or saves them); null until then. */
let signatureEmpty: boolean | null = null;
expose('settingsSignature', (empty: boolean) => { signatureEmpty = empty; renderSettingsNav(); });

function showSettingsPane(): void {
  const pane = currentPane();
  document.querySelectorAll<HTMLElement>('.settings-pane').forEach((el) => { el.hidden = el.dataset.pane !== pane; });
  renderSettingsNav();
  window.scrollTo(0, 0);
}

async function renderSettingsTab(): Promise<void> {
  showSettingsPane();
  (window as any).renderReminderSettings?.();
  (window as any).renderOfficeStripSettings?.();
  renderThemePicker();
  void renderAppearance();
  renderCommercialSettings();
  void renderTemplatesSettings();
  void renderDataStatus().then(renderSettingsNav);
  await loadStatus();
  renderSettingsNav();
  const clientIdInput = document.getElementById('ms365-client-id-input') as HTMLInputElement | null;
  if (clientIdInput && !clientIdInput.value) {
    const clientId = await ms365GetClientId();
    if (clientId) clientIdInput.value = clientId;
  }
  const tenantIdInput = document.getElementById('ms365-tenant-id-input') as HTMLInputElement | null;
  if (tenantIdInput && !tenantIdInput.value) {
    const tenantId = await ms365GetTenantId();
    if (tenantId) tenantIdInput.value = tenantId;
  }
  renderMs365Status();
  void renderLocalBackups();
}
registerTabRenderer('settings', () => { void renderSettingsTab(); });

async function renderLocalBackups(): Promise<void> {
  const el = document.getElementById('local-backups-status');
  if (!el) return;
  let backups;
  try { backups = await listLocalBackups(); } catch { return; }
  const latest = backups.find((b) => b.kind !== 'other');
  if (!latest) return;
  const when = fmtDateTime(new Date(latest.modifiedAt * 1000));
  const daily = backups.filter((b) => b.kind === 'daily').length;
  el.textContent = `Saved every day on this computer (last 14 kept) and before every app upgrade. Latest: ${when} · ${daily} daily cop${daily === 1 ? 'y' : 'ies'} kept.`;
}

async function backupDatabaseNowFromSettings(): Promise<void> {
  const btn = document.getElementById('backup-now-btn') as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = 'Backing up…'; }
  try {
    await backupDatabaseNow();
    if (btn) btn.textContent = 'Backed Up';
    await renderLocalBackups();
  } catch (err) {
    console.error('[backups] manual backup failed:', err);
    if (btn) btn.textContent = 'Backup Failed';
  } finally {
    setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = 'Back Up Now'; } }, 2000);
  }
}
expose('backupDatabaseNowFromSettings', backupDatabaseNowFromSettings);
expose('revealBackupsFolderFromSettings', () => { void revealBackupsFolder(); });
expose('revealLogsFolder', () => { void revealLogsFolder().catch((e) => toast("Couldn't open the logs folder", { tone: 'error', detail: String(e) })); });

/** Settings → Data: rebuild search on demand (foundations P1). */
async function rebuildSearchIndexFromSettings(): Promise<void> {
  const btn = document.getElementById('rebuild-index-btn') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  try {
    await rebuildSearchIndex();
    toast('Search index rebuilt', { tone: 'success' });
  } catch (err) {
    toast("Couldn't rebuild the search index", { tone: 'error', detail: String(err) });
  } finally {
    if (btn) btn.disabled = false;
  }
}
expose('rebuildSearchIndexFromSettings', rebuildSearchIndexFromSettings);

function renderMs365Status(): void {
  applyMs365SidebarVisibility();
  const st = S.ms365Status;
  const dot = document.getElementById('ms365-status-dot');
  const text = document.getElementById('ms365-status-text');
  const sub = document.getElementById('ms365-status-sub');
  const connectBtn = document.getElementById('ms365-connect-btn') as HTMLElement;
  const reconnectBtn = document.getElementById('ms365-reconnect-btn') as HTMLElement;
  const disconnectBtn = document.getElementById('ms365-disconnect-btn') as HTMLElement;
  if (!st || !dot || !text || !sub) return;

  connectBtn.style.display = 'none';
  reconnectBtn.style.display = 'none';
  disconnectBtn.style.display = 'none';

  if (S.ms365Connecting) {
    dot.style.background = 'var(--amber)';
    text.textContent = 'Connecting…';
    sub.textContent = 'Complete sign-in in your browser, then return here.';
    return;
  }

  if (st.status === 'connected') {
    dot.style.background = 'var(--green)';
    text.textContent = `Connected${st.displayName ? ` as ${st.displayName}` : ''}`;
    sub.textContent = [st.accountEmail, S.ms365Offline ? OFFLINE_LABEL : st.lastSyncAt ? `Last synced ${st.lastSyncAt}` : null].filter(Boolean).join(' · ');
    disconnectBtn.style.display = '';
  } else if (st.status === 'expired' || st.status === 'error') {
    dot.style.background = 'var(--red)';
    text.textContent = st.status === 'expired' ? 'Sign-in expired' : 'Connection error';
    sub.textContent = st.errorMessage || 'Reconnect to restore Outlook access.';
    reconnectBtn.style.display = '';
    disconnectBtn.style.display = '';
  } else {
    dot.style.background = 'var(--muted)';
    text.textContent = 'Not connected';
    sub.textContent = st.hasClientId ? 'Ready to connect.' : 'Set up a Client ID below first.';
    connectBtn.style.display = '';
  }
}

export async function ms365SaveClientIdClick(): Promise<void> {
  const input = document.getElementById('ms365-client-id-input') as HTMLInputElement | null;
  const value = input?.value.trim();
  if (!value) return;
  const tenantInput = document.getElementById('ms365-tenant-id-input') as HTMLInputElement | null;
  const tenantValue = tenantInput?.value.trim() ?? '';
  await ms365SetClientId(value);
  await ms365SetTenantId(tenantValue);
  await loadStatus();
  renderMs365Status();
}
expose('ms365SaveClientIdClick', ms365SaveClientIdClick);

export async function ms365ConnectClick(): Promise<void> {
  S.ms365Connecting = true;
  renderMs365Status();
  try {
    S.ms365Status = await ms365Connect();
    renderMe();
  } catch (e) {
    toast('Could not connect to Microsoft 365', { tone: 'error', detail: String(e) });
    await loadStatus();
  }
  S.ms365Connecting = false;
  renderMs365Status();
}
expose('ms365ConnectClick', ms365ConnectClick);

export async function ms365DisconnectClick(): Promise<void> {
  if (!(await showConfirm('Disconnect Microsoft 365? Action Required, Calendar, and Teams meeting features will stop working until you reconnect.', { confirmLabel: 'Disconnect' }))) return;
  S.ms365Status = await ms365Disconnect();
  renderMs365Status();
}
expose('ms365DisconnectClick', ms365DisconnectClick);

// ═══════════════ Company Master Data migration ═══════════════

function showCompanyMigrationReport(report: import('../lib/types').CompanyMigrationReport): void {
  const body = document.getElementById('company-migration-report-body');
  if (!body) return;
  body.innerHTML = [
    `<p><strong>${report.companiesCreated}</strong> new companies created, <strong>${report.fuzzyMatchesLinked}</strong> legacy names linked to an existing company instead of duplicating it, and <strong>${report.queuedForReview}</strong> sent to the Needs Review queue on the Companies page (nothing ambiguous was guessed).</p>`,
    `<p>Relationships linked: <strong>${report.proposalsLinked}</strong> proposals, <strong>${report.contactsLinked}</strong> contacts, <strong>${report.agreementsLinked}</strong> agreements, <strong>${report.projectsLinked}</strong> projects.</p>`,
    `<p><strong>${report.industriesMigrated}</strong> industry values moved onto the controlled taxonomy. Of ${report.companiesTotal} companies total, <strong>${report.companiesMissingIndustry}</strong> still have no industry set and <strong>${report.companiesWithoutContacts}</strong> have no contacts yet.</p>`,
    `<p class="t-meta t-muted">A full database backup (from before this migration) was saved to:<br><code class="path-code">${escHtml(report.backupPath)}</code></p>`,
  ].join('');
  document.getElementById('modal-company-migration')?.classList.add('open');
}

export function closeCompanyMigrationReport(): void {
  document.getElementById('modal-company-migration')?.classList.remove('open');
}
expose('closeCompanyMigrationReport', closeCompanyMigrationReport);

export async function runCompanyMigrationClick(): Promise<void> {
  const statusEl = document.getElementById('company-migration-status');
  if (statusEl) statusEl.textContent = 'Running…';
  try {
    const report = await runCompanyMigration();
    S.companies = await getCompanies();
    await loadReviewQueue(true);
    renderTab('companies');
    if (statusEl) statusEl.textContent = 'Last run: just now.';
    showCompanyMigrationReport(report);
  } catch (e) {
    if (statusEl) statusEl.textContent = '';
    toast('Company migration failed', { tone: 'error', detail: String(e) });
  }
}
expose('runCompanyMigrationClick', runCompanyMigrationClick);

// A Settings field that saved shows a brief tick at its edge (delight 9).
document.addEventListener('change', (e) => {
  const field = e.target as HTMLElement | null;
  if (!field?.closest?.('.settings-panes') || !field.matches('input, select, textarea')) return;
  void allSaved().then(() => savedTick(field));
});

// Repainted when Outlook goes offline or comes back (lib/offline.ts).
expose('renderMs365Status', renderMs365Status);
