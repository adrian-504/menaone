import { S } from '../lib/state';
import { toast } from '../lib/ui';
import { expose, today, showConfirm } from '../lib/utils';
import { exportBackupJson, importBackupJson, importLegacyBackupJson, loadAllData } from '../lib/db';
import { saveTextFileAs } from '../lib/files';
import { refreshAll } from '../lib/registry';
import { markLoadedAsSaved } from '../lib/persist';

/** Full backup — downloads everything in the SQLite database as one JSON file
 * the user chooses a location for. Replaces the original app's Blob+anchor
 * download (which doesn't map cleanly onto a desktop "Save As" flow). */
export async function backupAllData(): Promise<void> {
  const json = await exportBackupJson();
  const path = await saveTextFileAs(`MENABIG_Backup_${today()}.json`, json, ['json']);
  if (!path) return;
  const btn = document.querySelector<HTMLButtonElement>('.sb-add-btn[onclick="backupAllData()"]');
  if (btn) {
    const orig = btn.innerHTML;
    btn.innerHTML = '<span>Backed up</span>';
    btn.classList.add('success');
    setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('success'); }, 2500);
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
export async function restoreFromBackup(file: File): Promise<void> {
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
