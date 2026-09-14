// One-time HTML → Markdown migration for the Phase 3 Notes rebuild (Part 18).
// Safety first, matching this codebase's established migration convention:
// back up before touching anything, convert with a real HTML-to-Markdown
// library (not tag-stripping), flag anything that didn't convert cleanly for
// manual review, and never delete the original — the backup file is the
// undo path. Gated by an app_meta flag so it runs exactly once.
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { S } from './state';
import { getAppMeta, setAppMeta, updateNoteTemplate, backupDatabaseNow } from './db';
import { persistNotes } from './persist';
import { today } from './utils';

const MIGRATION_FLAG = 'notes_markdown_migrated_v1';

export interface MigrationReport {
  ran: boolean;
  totalNotes: number;
  convertedNotes: number;
  needsReviewNotes: { id: number; title: string }[];
  convertedTemplates: number;
  backupPath: string | null;
  error?: string;
}

/** Heuristic for "this still looks like HTML, not Markdown" — used both to
 * decide what needs converting and, after conversion, to flag anything
 * turndown couldn't cleanly turn into plain text (leftover tags usually mean
 * a construct turndown didn't recognize, e.g. inline styles or a stray
 * custom element). */
function looksLikeHtml(s: string): boolean {
  return /<\/?[a-z][a-z0-9]*[\s\S]*?>/i.test(s);
}

function buildTurndown(): TurndownService {
  const svc = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
  svc.use(gfm);
  return svc;
}

async function writeBackup(): Promise<string | null> {
  try {
    // A database snapshot in the app's backups folder (Settings → Backups).
    const backup = await backupDatabaseNow();
    return backup.fileName;
  } catch (e) {
    console.error('Pre-migration backup failed:', e);
    return null;
  }
}

/** Runs once (ever) per database. Returns null if there was nothing to do
 * (already migrated, or a fresh install with no HTML content in the first
 * place) — the caller only needs to show a report when this resolves to a
 * real MigrationReport. */
export async function migrateNotesToMarkdownIfNeeded(): Promise<MigrationReport | null> {
  if ((await getAppMeta(MIGRATION_FLAG)) === '1') return null;

  const notesToConvert = S.notes.filter((n) => looksLikeHtml(n.content || ''));
  const templatesToConvert = S.noteTemplates.filter((t) => looksLikeHtml(t.content || ''));

  if (notesToConvert.length === 0 && templatesToConvert.length === 0) {
    await setAppMeta(MIGRATION_FLAG, '1');
    return null;
  }

  const backupPath = await writeBackup();
  if (!backupPath) {
    // Do not proceed without a backup — surfaced to the user as an error;
    // the flag is NOT set, so migration will be retried on next launch.
    return { ran: false, totalNotes: S.notes.length, convertedNotes: 0, needsReviewNotes: [], convertedTemplates: 0, backupPath: null, error: 'Could not write a backup file, so the migration was skipped for safety. It will be retried next time the app opens.' };
  }

  const turndown = buildTurndown();
  const needsReview: { id: number; title: string }[] = [];
  let convertedNotes = 0;
  for (const n of notesToConvert) {
    try {
      const md = turndown.turndown(n.content || '');
      n.content = md;
      n.updatedAt = n.updatedAt || today();
      convertedNotes++;
      if (looksLikeHtml(md)) needsReview.push({ id: n.id, title: n.title || 'Untitled' });
    } catch {
      needsReview.push({ id: n.id, title: n.title || 'Untitled' });
    }
  }
  if (convertedNotes > 0) persistNotes();

  let convertedTemplates = 0;
  for (const t of templatesToConvert) {
    try {
      const md = turndown.turndown(t.content || '');
      await updateNoteTemplate(t.id, t.name, md);
      t.content = md;
      convertedTemplates++;
    } catch {
      // Templates are low-stakes (reusable starting points, not user data) —
      // an individual failure here doesn't need to block the whole migration
      // or appear in the note-level review list.
    }
  }

  await setAppMeta(MIGRATION_FLAG, '1');
  return { ran: true, totalNotes: S.notes.length, convertedNotes, needsReviewNotes: needsReview, convertedTemplates, backupPath };
}
