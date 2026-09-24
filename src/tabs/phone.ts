// Phone sync over OneDrive, the app side (docs/phone-sync.md): builds the
// snapshot from the loaded data (lib/phoneSnapshot.ts), writes it on the
// schedule in lib/phoneSync.ts, imports the phone's captures on window focus
// (the backend also scans at launch and every minute), and refetches what an
// import changed. Its only screen is the Phone block in Settings → Connections:
// no sidebar entry, no My Day block, no badges — captures arrive as ordinary
// records.

import { S } from '../lib/state';
import { escHtml, expose, today } from '../lib/utils';
import { toast } from '../lib/ui';
import { refreshAll } from '../lib/registry';
import { markCommitmentsSaved } from '../lib/persist';
import {
  getAppMeta, getInboxItems, getPipelineFacts, loadAllData, ms365GetCachedEmails,
  phoneGetStatus, phoneImportInbox, phonePinnedNotes, phoneReveal, phoneSetRoot, phoneWriteSnapshot,
  type PhoneImportResult, type PhoneStatus,
} from '../lib/db';
import { ownDomains } from '../lib/clientMatch';
import { defaultReviewer, teamMember } from '../lib/commercial';
import { buildPhoneSnapshot, isoWithOffset, type PhoneSnapshot } from '../lib/phoneSnapshot';
import { createPhoneSync, type PhoneSync } from '../lib/phoneSync';
import { unprocessedInboxItems } from './inbox';
import { refreshCommitmentViews } from './commitments';

let sync: PhoneSync | null = null;
let status: PhoneStatus | null = null;
let factsLoadedAt = 0;
let emailsLoaded = false;

async function snoozed(): Promise<Record<string, string>> {
  try {
    const v = await getAppMeta('myday_snoozed');
    const all: Record<string, string> = v ? JSON.parse(v) : {};
    const t = today();
    return Object.fromEntries(Object.entries(all).filter(([, until]) => until > t));
  } catch { return {}; }
}

/** The snapshot from what the app has loaded; null until the data is in. */
async function build(): Promise<PhoneSnapshot | null> {
  if (!S.companies.length && !S.todos.length && !S.proposals.length) return null;
  const jobs: Promise<unknown>[] = [];
  if (Date.now() - factsLoadedAt > 5 * 60_000) {
    factsLoadedAt = Date.now();
    jobs.push(getPipelineFacts().then((f) => { S.pipelineFacts = f; }).catch(() => undefined));
  }
  if (!emailsLoaded && S.ms365Status?.status === 'connected' && !S.emails.length) {
    emailsLoaded = true;
    jobs.push(ms365GetCachedEmails().then((e) => { S.emails = e; }).catch(() => undefined));
  }
  const [st, pinned, snooze] = await Promise.all([phoneGetStatus(), phonePinnedNotes().catch(() => []), snoozed(), ...jobs]);
  status = st;
  const reviewer = defaultReviewer()?.name || 'the reviewer';
  const now = new Date();
  return buildPhoneSnapshot({
    generatedAt: isoWithOffset(now), today: today(), now, mac: st.mac,
    proposals: S.proposals, opportunities: S.opportunities, pipelineFacts: S.pipelineFacts, agreements: S.agreements,
    meetings: S.meetings, todos: S.todos, projects: S.projects, commitments: S.commitments, companies: S.companies,
    contacts: S.contacts, emails: S.emails, inboxCount: unprocessedInboxItems().length,
    reviewerName: (p) => teamMember(p.reviewerId)?.name || reviewer,
    ownDomains: ownDomains(), snoozed: snooze,
    pinnedNotes: pinned.map((n) => ({ id: n.id, companyId: n.companyId, companyName: n.companyName, body: n.body, createdAt: n.createdAt })),
    importedCaptureIds: st.importedCaptureIds, failedCaptures: st.failed,
  });
}

/** Brings in what an import changed, then rewrites the snapshot so the phone
 * sees its captures confirmed. */
async function applyImported(r: PhoneImportResult): Promise<void> {
  if (r.imported === 0 && r.failed === 0) return;
  const kinds = new Set(r.touched.map((t) => t.kind));
  if (kinds.has('task') || kinds.has('commitment')) {
    const data = await loadAllData();
    const ids = (kind: string) => new Set(r.touched.filter((t) => t.kind === kind).map((t) => t.id));
    const taskIds = ids('task');
    const commitmentIds = ids('commitment');
    const tasks = data.todos.filter((t) => taskIds.has(t.id));
    const commitments = (data.commitments || []).filter((c) => commitmentIds.has(c.id));
    S.todos = [...S.todos.filter((t) => !taskIds.has(t.id)), ...tasks];
    S.commitments = [...S.commitments.filter((c) => !commitmentIds.has(c.id)), ...commitments];
    markCommitmentsSaved(commitments, tasks);
  }
  if (kinds.has('inbox')) S.inboxItems = await getInboxItems();
  refreshAll();
  refreshCommitmentViews();
  if (r.imported) toast(r.imported === 1 ? 'Added 1 item from your phone' : `Added ${r.imported} items from your phone`);
  await sync?.flush();
  if (document.getElementById('phone-settings')) void renderPhoneSettings();
}

let lastFocusScan = 0;
async function scanInbox(): Promise<void> {
  if (Date.now() - lastFocusScan < 5000) return;
  lastFocusScan = Date.now();
  try { await applyImported(await phoneImportInbox()); } catch (err) { console.warn('[phone] import failed', err); }
}

/** Starts phone sync once the data is loaded (called from main.ts). */
export async function startPhoneSync(): Promise<void> {
  if (sync) return;
  sync = createPhoneSync({ build, write: phoneWriteSnapshot });
  sync.start();
  window.addEventListener('focus', () => { void scanInbox(); });
  if ((window as any).__TAURI_INTERNALS__?.invoke) {
    const { listen } = await import('@tauri-apps/api/event');
    // The backend's own scans (launch, every minute) announce what they applied.
    await listen<PhoneImportResult>('phone-captures-applied', (e) => { void applyImported(e.payload); });
  }
}

// ── Settings → Connections → Phone ──────────────────────────────────────────

function ago(iso: string | null): string {
  if (!iso) return '';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (isNaN(mins)) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function size(bytes: number | null): string {
  if (bytes == null) return '';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export async function renderPhoneSettings(): Promise<void> {
  const el = document.getElementById('phone-settings');
  if (!el) return;
  try { status = await phoneGetStatus(); } catch (err) { status = null; el.innerHTML = `<div class="phone-panel"><h3 class="phone-eyebrow">Phone</h3><p class="phone-line">${escHtml(String(err))}</p></div>`; return; }
  const st = status;
  const problem = sync?.state().lastError;
  const written = st.snapshotWrittenAt ? `Snapshot written ${ago(st.snapshotWrittenAt)} · ${size(st.snapshotBytes)}` : 'No snapshot written yet';
  const failed = st.failedCount
    ? `<a href="#" class="rlink t-red" onclick="event.preventDefault();revealPhoneFolder(true)">${st.failedCount} failed</a>`
    : '0 failed';
  el.innerHTML = `<div class="phone-panel">
    <h3 class="phone-eyebrow">Phone</h3>
    <p class="phone-desc">The iPhone app reads a summary from this OneDrive folder and leaves what you capture there; it is added here as ordinary records.</p>
    <div class="phone-path"><code class="path-code">${escHtml(st.root || 'No OneDrive folder on this Mac')}</code></div>
    <div class="phone-actions">
      <button class="btn-secondary btn-sm" onclick="choosePhoneFolder()">Change…</button>
      <button class="btn-secondary btn-sm" onclick="revealPhoneFolder(false)" ${st.exists ? '' : 'disabled'}>Reveal in Finder</button>
    </div>
    <p class="phone-line">${escHtml(written)}</p>
    <p class="phone-line">Captures: ${st.importedToday} imported today · ${failed}</p>
    ${problem ? `<p class="phone-line t-red">${escHtml(problem)}</p>` : ''}
  </div>`;
}
expose('renderPhoneSettings', renderPhoneSettings);

export async function choosePhoneFolder(): Promise<void> {
  let picked: string | null = null;
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({ directory: true, multiple: false, defaultPath: status?.root || undefined, title: 'Choose the phone folder (inside OneDrive)' });
    picked = typeof result === 'string' ? result : null;
  } catch (err) {
    toast('Could not open the folder picker', { tone: 'error', detail: String(err) });
    return;
  }
  if (!picked) return;
  try {
    status = await phoneSetRoot(picked);
    await sync?.flush();
    toast('Phone folder saved', { tone: 'success' });
  } catch (err) {
    toast('That folder can’t be used', { tone: 'error', detail: String(err) });
  }
  void renderPhoneSettings();
}
expose('choosePhoneFolder', choosePhoneFolder);

export async function revealPhoneFolder(failed: boolean): Promise<void> {
  try { await phoneReveal(failed); } catch (err) { toast('Could not show the folder', { tone: 'error', detail: String(err) }); }
}
expose('revealPhoneFolder', revealPhoneFolder);
