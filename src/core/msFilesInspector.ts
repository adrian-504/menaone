// Microsoft Files — the "Show Info" inspector (Section 13): a focused view of
// one file/folder's MENA One business context — what it's linked to, and any
// notes attached to it. The file itself is never touched; everything here is
// MENA One's own data, reached the same way Company/Project already resolve
// their linked notes/emails (getLinksFor + a small render function), just
// keyed off this one msfile row instead of a whole entity's id.
//
// Notes on a file are real MENA One Notes (Markdown-first, same editor,
// same tab) linked via entity_links — not a second note-storage system.
import { S } from '../lib/state';
import { escHtml, expose, nextNoteId, today, fmtDateFromIso } from '../lib/utils';
import { icon } from '../lib/icons';
import { getLinksFor, setLinksFrom, filesGetOrCreateMsfile, filesOpen, filesRevealInFinder } from '../lib/db';
import { persistNotes } from '../lib/persist';
import type { Note } from '../lib/types';

interface InspectorItem { path: string; name: string; isFolder: boolean }
let current: InspectorItem | null = null;
let currentMsfileId: number | null = null;

function formatBytes(n: number | null): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function openMsFilesInspector(path: string, name: string, isFolder: boolean, size: number | null, modifiedAt: string | null): Promise<void> {
  current = { path, name, isFolder };
  document.getElementById('msfi-name')!.textContent = name;
  const metaParts = [isFolder ? 'Folder' : 'File', !isFolder && size != null ? formatBytes(size) : '', modifiedAt ? `Modified ${fmtDateFromIso(modifiedAt)}` : ''].filter(Boolean);
  document.getElementById('msfi-meta')!.textContent = metaParts.join(' · ');
  document.getElementById('modal-msfiles-inspector')?.classList.add('open');

  currentMsfileId = await filesGetOrCreateMsfile(path, name, isFolder ? 'folder' : 'file');
  await refreshInspector();
}
expose('openMsFilesInspector', openMsFilesInspector);

export function closeMsFilesInspector(): void {
  document.getElementById('modal-msfiles-inspector')?.classList.remove('open');
  current = null;
  currentMsfileId = null;
}
expose('closeMsFilesInspector', closeMsFilesInspector);

export function msFilesInspectorOpen(): void {
  if (current) void filesOpen(current.path);
}
expose('msFilesInspectorOpen', msFilesInspectorOpen);

export function msFilesInspectorReveal(): void {
  if (current) void filesRevealInFinder(current.path);
}
expose('msFilesInspectorReveal', msFilesInspectorReveal);

async function refreshInspector(): Promise<void> {
  if (currentMsfileId == null) return;
  const msfileId = currentMsfileId;
  const links = await getLinksFor('msfile', msfileId);
  if (currentMsfileId !== msfileId) return; // inspector moved on to a different item mid-fetch

  // Linked Company/Project — this msfile row is the "from" side (same
  // convention as Note/Contact -> Opportunity established earlier).
  const linkedEl = document.getElementById('msfi-linked')!;
  const companyLink = links.find((l) => l.fromType === 'msfile' && l.fromId === msfileId && l.toType === 'company');
  const projectLink = links.find((l) => l.fromType === 'msfile' && l.fromId === msfileId && l.toType === 'project');
  const chips: string[] = [];
  if (companyLink) {
    const c = S.companies.find((x) => x.id === companyLink.toId);
    chips.push(`<span class="chip inline-center">${icon('building', 11)} ${escHtml(c?.name || 'Company')}<span class="t-muted clickable" onclick="msFilesInspectorUnlink('company')">&times;</span></span>`);
  }
  if (projectLink) {
    const p = S.projects.find((x) => x.id === projectLink.toId);
    chips.push(`<span class="chip inline-center">${icon('target', 11)} ${escHtml(p?.name || 'Project')}<span class="t-muted clickable" onclick="msFilesInspectorUnlink('project')">&times;</span></span>`);
  }
  linkedEl.innerHTML = chips.length > 0
    ? `<div class="chip-row">${chips.join('')}</div>`
    : `<div class="empty feed-empty">Not linked yet. Right-click this item in the file list to link it.</div>`;

  // Notes — real MENA One Notes linked note -> msfile.
  const notesEl = document.getElementById('msfi-notes')!;
  const noteIds = links.filter((l) => l.fromType === 'note' && l.toType === 'msfile' && l.toId === msfileId).map((l) => l.fromId);
  const notes = S.notes.filter((n) => noteIds.includes(n.id)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  notesEl.innerHTML = notes.length > 0
    ? notes.map((n) => `<div class="rec-row" onclick="msFilesInspectorOpenNote(${n.id})">
        <div class="note-item-title">${escHtml(n.title || 'Untitled')}</div>
        <div class="note-item-meta"><span>${fmtDateFromIso(n.updatedAt)}</span></div>
      </div>`).join('')
    : `<div class="empty feed-empty">No notes on this item yet.</div>`;
}

export async function msFilesInspectorUnlink(kind: 'company' | 'project'): Promise<void> {
  if (currentMsfileId == null) return;
  const existing = await getLinksFor('msfile', currentMsfileId);
  const remaining = existing.filter((l) => l.fromType === 'msfile' && l.fromId === currentMsfileId && l.toType !== kind);
  await setLinksFrom('msfile', currentMsfileId, remaining);
  await refreshInspector();
}
expose('msFilesInspectorUnlink', msFilesInspectorUnlink);

export async function msFilesInspectorAddNote(): Promise<void> {
  if (!current || currentMsfileId == null) return;
  const msfileId = currentMsfileId;
  const newNote: Note = {
    id: nextNoteId(), title: current.name, content: '', folder: '', clientName: '',
    tags: [], pinned: false, createdAt: today(), updatedAt: today(),
  };
  S.notes.unshift(newNote);
  persistNotes();
  await setLinksFrom('note', newNote.id, [{ fromType: 'note', fromId: newNote.id, toType: 'msfile', toId: msfileId }]);
  closeMsFilesInspector();
  (window as any).switchTab('notes');
  (window as any).openNote(newNote.id);
}
expose('msFilesInspectorAddNote', msFilesInspectorAddNote);

export function msFilesInspectorOpenNote(id: number): void {
  closeMsFilesInspector();
  (window as any).switchTab('notes');
  (window as any).openNote(id);
}
expose('msFilesInspectorOpenNote', msFilesInspectorOpenNote);
