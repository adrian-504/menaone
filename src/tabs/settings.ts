import { S } from '../lib/state';
import { toast } from '../lib/ui';
import { escHtml, expose, showConfirm } from '../lib/utils';
import { registerTabRenderer } from '../lib/registry';
import { ms365GetClientId, ms365SetClientId, ms365GetTenantId, ms365SetTenantId, ms365Status, ms365Connect, ms365Disconnect, runCompanyMigration, getCompanies, listLocalBackups, backupDatabaseNow, revealBackupsFolder } from '../lib/db';
import { THEMES } from '../core/theme';
import { applyMs365SidebarVisibility } from '../core/chrome';
import { renderTab } from '../lib/registry';
import { loadReviewQueue } from './companies';
import { renderCommercialSettings } from './settingsCommercial';

async function loadStatus(): Promise<void> {
  S.ms365Status = await ms365Status();
}

// setTheme() (core/theme.ts) is expose()d on window and, once it applies the
// theme, calls renderActiveTab() — which re-runs renderSettingsTab() and thus
// this picker — so the swatch onclick can call it directly with no local
// wrapper needed to move the active ring.
function renderThemePicker(): void {
  const el = document.getElementById('theme-picker');
  if (!el) return;
  el.innerHTML = THEMES.map((t) => `
    <button class="theme-swatch${t.id === S.theme ? ' active' : ''}" onclick="setTheme('${t.id}')" title="${escHtml(t.name)}">
      <span class="theme-swatch-preview" style="background:${t.swatchSurface}">
        <span class="theme-swatch-preview-strip" style="background:${t.swatchBg}"></span>
        <span class="theme-swatch-preview-body">
          <span class="theme-swatch-preview-dot" style="background:${t.swatchAccent}"></span>
        </span>
      </span>
      <span class="theme-swatch-label">${escHtml(t.name)}</span>
    </button>`).join('');
}

const PANE_KEY = 'menaone.settingsPane';

export function setSettingsPane(pane: string): void {
  try { localStorage.setItem(PANE_KEY, pane); } catch { /* not remembered */ }
  showSettingsPane();
}
expose('setSettingsPane', setSettingsPane);

function showSettingsPane(): void {
  let pane = 'general';
  try { pane = localStorage.getItem(PANE_KEY) || 'general'; } catch { /* default */ }
  if (!document.querySelector(`.settings-pane[data-pane="${pane}"]`)) pane = 'general';
  document.querySelectorAll<HTMLElement>('.settings-pane').forEach((el) => { el.hidden = el.dataset.pane !== pane; });
  document.querySelectorAll<HTMLElement>('.settings-nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.pane === pane);
    el.setAttribute('aria-current', el.dataset.pane === pane ? 'page' : 'false');
  });
  window.scrollTo(0, 0);
}

async function renderSettingsTab(): Promise<void> {
  showSettingsPane();
  (window as any).renderReminderSettings?.();
  renderThemePicker();
  renderCommercialSettings();
  await loadStatus();
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
  const when = new Date(latest.modifiedAt * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
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
    sub.textContent = [st.accountEmail, st.lastSyncAt ? `Last synced ${st.lastSyncAt}` : null].filter(Boolean).join(' · ');
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
