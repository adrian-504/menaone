import { S } from '../lib/state';
import { toast } from '../lib/ui';
import { expose, today, showConfirm } from '../lib/utils';
import { importBackupJson, importLegacyBackupJson, loadAllData, exportFullBackup, inspectFullBackup, restoreFullBackup, type FullBackupSummary } from '../lib/db';
import { refreshAll } from '../lib/registry';
import { markLoadedAsSaved } from '../lib/persist';

/** Full backup: a complete copy of the database (every record, list and
 * setting), saved where the user chooses. See full_backup.rs. */
export async function backupAllData(): Promise<void> {
  try {
    const path = await exportFullBackup(`MENA One backup ${today()}.sqlite3`);
    if (path) toast('Backup saved', { tone: 'success', duration: 10000, detail: `Everything in MENA One, in ${path.split('/').pop()}. It includes client correspondence (cached Outlook mail and meetings): keep it in the MENA BIG OneDrive only.` });
  } catch (err) {
    toast('Could not save the backup', { tone: 'error', detail: String(err) });
  }
}
expose('backupAllData', backupAllData);

async function reloadStateFromDb(): Promise<void> {
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
  refreshAll();
}

/** Restore from a backup file. Detects whether it's this app's own (v2, SQLite-backed)
 * format or the original HTML tracker's legacy (v1, localStorage-backed) format,
 * and routes to the matching import command — this is also the primary
 * one-time migration path for bringing data over from the old tracker. */
function fullSummaryLines(s: FullBackupSummary): string {
  return [
    `${s.companies} companies`, `${s.contacts} contacts`, `${s.opportunities} opportunities`, `${s.proposals} proposals`,
    `${s.agreements} agreements`, `${s.projects} projects`, `${s.meetings} meetings`, `${s.tasks} tasks`, `${s.notes} notes`, `${s.commitments} commitments`,
  ].map((x) => `• ${x}`).join('\n');
}

/** A full backup (.sqlite3): checked first, then everything is replaced and the app reloads. */
async function restoreFullBackupFile(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let summary: FullBackupSummary;
  try {
    summary = await inspectFullBackup(bytes);
  } catch (err) {
    toast('Could not restore the backup', { tone: 'error', detail: String(err) });
    return;
  }
  const msg = `Restore "${file.name}"?\n\nEverything in MENA One will be REPLACED with what the backup holds:\n${fullSummaryLines(summary)}\n\nA copy of your current data is saved first, in the automatic backups folder.`;
  if (!(await showConfirm(msg, { title: 'Restore backup?', confirmLabel: 'Restore' }))) return;
  try {
    await restoreFullBackup(bytes);
    toast('Backup restored — reloading', { tone: 'success' });
    // Every module reads fresh from the restored database.
    setTimeout(() => window.location.reload(), 600);
  } catch (err) {
    toast('Could not restore the backup', { tone: 'error', detail: String(err) });
  }
}

export async function restoreFromBackup(file: File): Promise<void> {
  if (/\.(sqlite3?|db)$/i.test(file.name)) { await restoreFullBackupFile(file); return; }
  const text = await file.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (err: any) {
    toast('Could not read the backup file', { tone: 'error', detail: err.message });
    return;
  }
  if (!parsed.data) {
    toast('This is not a MENA One backup file', { tone: 'error' });
    return;
  }
  const isLegacy = parsed.version === 1;
  const summary = isLegacy
    ? {
        proposals: (parsed.data['menabig_v5'] || []).length,
        contacts: (parsed.data['menabig_contacts_v1'] || []).length,
        agreements: (parsed.data['menabig_agreements_v1'] || []).length,
        todos: (parsed.data['menabig_todos_v1'] || []).length,
        notes: (parsed.data['menabig_notes_v1'] || []).length,
      }
    : parsed.summary || {};
  const when = parsed.exportedAtReadable || parsed.exportedAtEpochMs ? new Date(parsed.exportedAtEpochMs).toLocaleString('en-GB') : 'unknown date';
  const msg = `Restore backup from ${when}?\n\nThis will REPLACE all current data with:\n• ${summary.proposals || 0} proposals\n• ${summary.contacts || 0} contacts\n• ${summary.agreements || 0} agreements\n• ${summary.todos || 0} tasks\n• ${summary.notes || 0} notes\n\nYour current data will be overwritten. Are you sure?`;
  if (!(await showConfirm(msg, { title: 'Restore backup?', confirmLabel: 'Restore' }))) return;
  try {
    const result = isLegacy ? await importLegacyBackupJson(text) : await importBackupJson(text);
    await reloadStateFromDb();
    const restored = `${result.proposals} proposals, ${result.contacts} contacts, ${result.agreements} agreements, ${result.todos} tasks, ${result.notes} notes, ${result.noteFolders} note folders, ${result.contactLists} contact lists, ${result.companyNotes} company notes`;
    if (result.warnings.length > 0) {
      toast(`Backup restored — ${result.warnings.length} malformed record${result.warnings.length === 1 ? ' was' : 's were'} skipped`, { tone: 'error', duration: 0, detail: `${restored}.\nSkipped: ${result.warnings.slice(0, 10).join('; ')}` });
    } else {
      toast('Backup restored', { tone: 'success', duration: 8000, detail: restored });
    }
  } catch (err: any) {
    toast('Could not restore the backup', { tone: 'error', detail: String(err) });
  }
}
expose('restoreFromBackup', (file: File) => { void restoreFromBackup(file); });
