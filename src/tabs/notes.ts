// Notes — three calm panes (library, note list, editor), a document-style
// editor with a large title and a readable column, properties as quiet chips
// under the title, formatting on demand (slash menu and a floating toolbar
// on selection), links and backlinks at the foot of the note, and a focus
// mode that hides everything but the writing.

import { S } from '../lib/state';
import { toast, emptyState } from '../lib/ui';
import { companyLink, recordLink } from '../lib/links';
import { today, fmtDate, escHtml, nextNoteId, expose, positionFloatingPopup, showTextPrompt, showConfirm, debounce, inCompany } from '../lib/utils';
import { showContextMenu, showMenuAt, type ContextMenuItem } from '../lib/contextMenu';
import { persistNotes, persistNoteFolders, persistTodos, saveNotesNow, saveTodosNow } from '../lib/persist';
import { contextFromNote, replaceLinks, taskFields, unconvertedActionItems, actionItems } from '../lib/workGraph';
import { blankTask } from './todo';
import { registerTabRenderer, refreshProjectViewIfOpen, notifyNavigated, getActiveTabId } from '../lib/registry';
import {
  getNoteBacklinks, getLinksFor, setLinksFrom, saveNoteTemplate, updateNoteTemplate, deleteNoteTemplate,
  saveAttachment, getAttachmentDataUrl,
} from '../lib/db';
import { icon } from '../lib/icons';
import { renderTagChips } from '../lib/tagChips';
import { attachCompanySelector } from '../lib/companySelector';
import { registerDragSource, registerDropTarget } from '../lib/dnd';
import { saveTextFileAs } from '../lib/files';
import { renderIcons } from '../core/chrome';
import {
  createNoteEditor, setEditorDoc, insertAtCursor, wrapSelection, insertLink,
  insertLinePrefix, insertCodeBlock, insertDivider,
} from '../lib/markdownEditor';
import type { EditorView } from '@codemirror/view';
import type { Note, EntityLink, Todo } from '../lib/types';

// ── Nested folders: "/"-delimited path strings (e.g. "Clients/Acme Holdings")
// in the flat noteFolders list — the tree is derived here.

interface FolderNode { name: string; path: string; children: FolderNode[] }

function buildFolderTree(paths: string[]): FolderNode[] {
  const root: FolderNode[] = [];
  for (const full of [...paths].sort((a, b) => a.localeCompare(b))) {
    const parts = full.split('/').filter(Boolean);
    let level = root;
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      let node = level.find((n) => n.name === part);
      if (!node) { node = { name: part, path: acc, children: [] }; level.push(node); }
      level = node.children;
    }
  }
  return root;
}

const jsArg = (s: string) => escHtml(s).replace(/'/g, "\\'");

function renderFolderNode(node: FolderNode, depth = 0): string {
  const cnt = S.notes.filter((n) => n.folder === node.path).length;
  const hasChildren = node.children.length > 0;
  const collapsed = S.noteFolderCollapsed.has(node.path);
  const toggle = hasChildren
    ? `<span class="notes-folder-toggle${collapsed ? ' collapsed' : ''}" onclick="event.stopPropagation();toggleNoteFolderCollapse('${jsArg(node.path)}')">${icon('chevronDown', 11)}</span>`
    : `<span class="notes-folder-toggle-spacer"></span>`;
  const childrenHtml = hasChildren && !collapsed ? node.children.map((c) => renderFolderNode(c, depth + 1)).join('') : '';
  return `<div class="ws-side-item notes-folder-item${S.currentNoteFolder === node.path ? ' active' : ''}" style="padding-left:${6 + depth * 14}px" data-folder="${escHtml(node.path)}" data-drop="note-folder" data-drop-value="${escHtml(node.path)}" data-drag-kind="folder" data-drag-id="${folderIndex(node.path)}" onclick="setNoteFolder('${jsArg(node.path)}')" oncontextmenu="noteFolderMenu(event,'${jsArg(node.path)}')">
      ${toggle}<span class="ws-side-icon">${icon('folder', 14)}</span><span class="ws-side-label">${escHtml(node.name)}</span><span class="ws-side-count">${cnt || ''}</span>
    </div>${childrenHtml}`;
}

function flattenFolderOptions(nodes: FolderNode[], depth = 0): { path: string; label: string }[] {
  let out: { path: string; label: string }[] = [];
  for (const n of nodes) {
    out.push({ path: n.path, label: `${'   '.repeat(depth)}${n.name}` });
    out = out.concat(flattenFolderOptions(n.children, depth + 1));
  }
  return out;
}

export function noteFolderMenu(e: MouseEvent, path: string): void {
  showContextMenu(e, [
    { label: 'New subfolder', iconName: 'plus', run: () => { void addNoteFolder(path); } },
    { label: 'Remove folder', iconName: 'trash', danger: true, run: () => { void deleteNoteFolder(path); } },
  ]);
}
expose('noteFolderMenu', noteFolderMenu);

// ── Drag and drop: notes onto folders, tags and Pinned; folders into folders ─

/** Folders are paths, but drag items need numeric ids: use their index. */
function folderIndex(path: string): number {
  return S.noteFolders.indexOf(path);
}

registerDragSource('note', { label: (ids) => { const n = S.notes.find((x) => x.id === ids[0]); return n?.title || 'Untitled'; } });
registerDragSource('folder', { label: (ids) => S.noteFolders[ids[0]]?.split('/').pop() || 'Folder' });

function moveNotes(ids: number[], change: (n: Note) => boolean, message: string): void {
  let changed = 0;
  for (const id of ids) {
    const n = S.notes.find((x) => x.id === id);
    if (n && change(n)) { n.updatedAt = today(); changed++; }
  }
  if (!changed) return;
  persistNotes();
  renderNotesTab();
  const cur = currentNote();
  if (cur && ids.includes(cur.id)) { renderNoteProps(cur); updatePinButton(cur); }
  toast(message);
}

registerDropTarget('note-folder', {
  accepts: ['note', 'folder'],
  canDrop: (p, value) => p.kind !== 'folder' || (() => { const from = S.noteFolders[p.ids[0]]; return !!from && value !== from && !value.startsWith(`${from}/`); })(),
  onDrop: (p, { value }) => {
    if (p.kind === 'note') { moveNotes(p.ids, (n) => (n.folder === value ? false : ((n.folder = value), true)), `Moved to ${value.split('/').pop()}`); return; }
    moveFolder(S.noteFolders[p.ids[0]], value);
  },
});

registerDropTarget('note-library', {
  accepts: ['note', 'folder'],
  onDrop: (p, { value }) => {
    if (p.kind === 'folder') { if (value === 'all') moveFolder(S.noteFolders[p.ids[0]], ''); return; }
    if (value === 'pinned') moveNotes(p.ids, (n) => (n.pinned ? false : ((n.pinned = true), true)), 'Pinned');
    else if (value === 'all') moveNotes(p.ids, (n) => (!n.folder ? false : ((n.folder = ''), true)), 'Removed from folder');
    else if (value.startsWith('tag:')) {
      const tag = value.slice(4);
      moveNotes(p.ids, (n) => ((n.tags || []).includes(tag) ? false : ((n.tags = [...(n.tags || []), tag]), true)), `Tagged #${tag}`);
    }
  },
});

/** Moves a folder (and everything inside it) under `parent`, or to the top level. */
function moveFolder(from: string | undefined, parent: string): void {
  if (!from) return;
  const name = from.split('/').pop()!;
  const to = parent ? `${parent}/${name}` : name;
  if (to === from || parent === from || parent.startsWith(`${from}/`)) return;
  if (S.noteFolders.includes(to)) { toast(`There's already a folder called ${name} there`, { tone: 'error' }); return; }
  const rename = (path: string) => (path === from ? to : path.startsWith(`${from}/`) ? to + path.slice(from.length) : path);
  S.noteFolders = S.noteFolders.map(rename);
  S.notes.forEach((n) => { if (n.folder) n.folder = rename(n.folder); });
  if (S.currentNoteFolder) S.currentNoteFolder = rename(S.currentNoteFolder);
  if (parent) S.noteFolderCollapsed.delete(parent);
  persistNoteFolders();
  persistNotes();
  renderNotesTab();
  toast(parent ? `Moved ${name} into ${parent.split('/').pop()}` : `Moved ${name} to the top level`);
}

export function toggleNoteFolderCollapse(path: string): void {
  if (S.noteFolderCollapsed.has(path)) S.noteFolderCollapsed.delete(path);
  else S.noteFolderCollapsed.add(path);
  renderNotesSidebar();
}
expose('toggleNoteFolderCollapse', toggleNoteFolderCollapse);

export function setNoteFolder(folder: string): void {
  S.currentNoteFolder = folder;
  renderNotesSidebar();
  renderNotesList();
  document.getElementById('notes-list')?.scrollTo(0, 0);
}
expose('setNoteFolder', setNoteFolder);

// ── Library sidebar ─────────────────────────────────────────────────────────

const RECENT_DAYS = 7;
function isRecent(n: Note): boolean {
  const d = n.updatedAt || n.createdAt;
  if (!d) return false;
  const [y, m, day] = d.split('-').map(Number);
  return (Date.now() - new Date(y, m - 1, day).getTime()) / 86400000 <= RECENT_DAYS;
}

function renderNotesSidebar(): void {
  const set = (id: string, n: number) => { const el = document.getElementById(id); if (el) el.textContent = n ? String(n) : ''; };
  set('nf-all', S.notes.length);
  set('nf-pinned', S.notes.filter((n) => n.pinned).length);
  set('nf-recent', S.notes.filter(isRecent).length);
  set('nf-client', S.notes.filter((n) => n.clientName).length);
  document.querySelectorAll<HTMLElement>('.notes-side .ws-side-group .notes-folder-item').forEach((el) => el.classList.toggle('active', el.dataset.folder === S.currentNoteFolder));
  const fi = document.getElementById('notes-folder-items');
  if (fi) {
    const tree = buildFolderTree(S.noteFolders);
    fi.innerHTML = tree.length ? tree.map((n) => renderFolderNode(n)).join('') : `<div class="notes-side-hint">No folders yet</div>`;
  }
  const tagCounts = new Map<string, number>();
  for (const n of S.notes) for (const t of n.tags || []) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  const tagEl = document.getElementById('notes-tag-items');
  const tagSection = document.getElementById('notes-tags-section');
  if (tagSection) tagSection.hidden = tagCounts.size === 0;
  if (tagEl) {
    tagEl.innerHTML = [...tagCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([t, c]) => `<button class="ws-side-item notes-folder-item${S.currentNoteFolder === `tag:${t}` ? ' active' : ''}" data-drop="note-library" data-drop-value="tag:${escHtml(t)}" onclick="setNoteFolder('tag:${jsArg(t)}')"><span class="ws-side-icon">${icon('tag', 13)}</span><span class="ws-side-label">${escHtml(t)}</span><span class="ws-side-count">${c}</span></button>`).join('');
  }
}

export function renderNotesTab(): void {
  renderNotesSidebar();
  renderNotesList();
  applyNotesLayout();
  if (S.currentNoteId == null) renderNotesEmpty();
}
registerTabRenderer('notes', renderNotesTab);
expose('renderNotesTab', renderNotesTab);

// ── Note list ───────────────────────────────────────────────────────────────

function previewText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#{1,6}|>|[-*+]\s\[[ xX]\]|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function folderLabel(folder: string): string {
  if (folder === 'all') return 'All Notes';
  if (folder === 'pinned') return 'Pinned';
  if (folder === 'recent') return 'Recent';
  if (folder === 'client') return 'Linked to clients';
  if (folder.startsWith('tag:')) return `#${folder.slice(4)}`;
  return folder.split('/').pop() || folder;
}

export function renderNotesList(): void {
  const search = ((document.getElementById('notes-search') as HTMLInputElement | null)?.value || '').trim().toLowerCase();
  const folder = S.currentNoteFolder;
  let filtered = S.notes.filter((n) => {
    if (folder === 'pinned') return n.pinned;
    if (folder === 'recent') return isRecent(n);
    if (folder === 'client') return !!n.clientName;
    if (folder.startsWith('tag:')) return (n.tags || []).includes(folder.slice(4));
    if (folder !== 'all') return n.folder === folder;
    return true;
  });
  if (search) filtered = filtered.filter((n) => (n.title || '').toLowerCase().includes(search) || (n.content || '').toLowerCase().includes(search) || (n.clientName || '').toLowerCase().includes(search) || (n.tags || []).some((t) => t.toLowerCase().includes(search)));
  filtered.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.updatedAt || '').localeCompare(a.updatedAt || '') || b.id - a.id;
  });
  const title = document.getElementById('notes-list-title'); if (title) title.textContent = folderLabel(folder);
  const count = document.getElementById('notes-list-count'); if (count) count.textContent = `${filtered.length} note${filtered.length === 1 ? '' : 's'}`;
  const list = document.getElementById('notes-list');
  if (!list) return;
  if (filtered.length === 0) {
    list.innerHTML = search
      ? emptyState({ icon: 'search', title: 'No matching notes', body: `Nothing in ${folderLabel(folder)} mentions “${search}”.`, compact: true })
      : emptyState({ icon: 'note', title: folder === 'all' ? 'No notes yet' : `Nothing in ${folderLabel(folder)}`, compact: true, action: { label: 'New note', onclick: 'createNewNote(null)' } });
    renderIcons(list);
    return;
  }
  list.innerHTML = filtered.map((n) => {
    const preview = previewText(n.content || '');
    const meta = [
      `<span>${fmtDate(n.updatedAt || n.createdAt)}</span>`,
      n.clientName ? companyLink(n.companyId, n.clientName, { className: 'note-item-client' }) : '',
      ...(n.tags || []).slice(0, 2).map((t) => `<span class="note-item-tag">#${escHtml(t)}</span>`),
    ].filter(Boolean).join('');
    return `<div class="note-item${n.id === S.currentNoteId ? ' active' : ''}" data-note-id="${n.id}" data-drag-kind="note" data-drag-id="${n.id}" onclick="openNote(${n.id})" oncontextmenu="noteContextMenu(event,${n.id})">
      <div class="note-item-title">${n.pinned ? `<span class="note-pin">${icon('pin', 11)}</span>` : ''}${escHtml(n.title || 'Untitled')}</div>
      <div class="note-item-preview">${preview ? escHtml(preview) : '<span class="note-item-empty">No additional text</span>'}</div>
      <div class="note-item-meta">${meta}</div>
    </div>`;
  }).join('');
}
expose('renderNotesList', renderNotesList);

const debouncedNotesSearch = debounce(renderNotesList, 150);
export function notesSearchChanged(): void { debouncedNotesSearch(); }
expose('notesSearchChanged', notesSearchChanged);

function renderNotesEmpty(): void {
  const el = document.getElementById('notes-empty');
  if (!el) return;
  el.innerHTML = emptyState({ icon: 'note', title: S.notes.length ? 'No note selected' : 'Start your first note', body: S.notes.length ? 'Pick a note from the list, or start a new one.' : 'Meeting notes, client research, ideas — link them to clients and projects as you go.', action: { label: 'New note', onclick: 'createNewNote(null)' } });
  renderIcons(el);
}

// ── Layout: library, focus mode, formatting bar ─────────────────────────────

const LAYOUT_KEY = 'menaone.notesLayout';
const layout = (() => {
  try { return { sidebar: true, formatBar: false, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') } as { sidebar: boolean; formatBar: boolean }; }
  catch { return { sidebar: true, formatBar: false }; }
})();
let focusMode = false;

function saveLayout(): void {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* per-session only */ }
}

function applyNotesLayout(): void {
  const ws = document.getElementById('notes-ws');
  ws?.classList.toggle('no-library', !layout.sidebar);
  ws?.classList.toggle('focus', focusMode);
  const bar = document.getElementById('notes-toolbar');
  if (bar) bar.hidden = !layout.formatBar || S.currentNoteId == null;
  document.getElementById('notes-format-btn')?.classList.toggle('active', layout.formatBar);
  document.getElementById('notes-focus-btn')?.classList.toggle('active', focusMode);
}

export function toggleNotesSidebar(): void {
  if (focusMode) { focusMode = false; layout.sidebar = true; }
  else layout.sidebar = !layout.sidebar;
  saveLayout();
  applyNotesLayout();
}
expose('toggleNotesSidebar', toggleNotesSidebar);

export function toggleNotesFocus(): void {
  focusMode = !focusMode;
  applyNotesLayout();
  if (focusMode) noteEditorView?.focus();
}
expose('toggleNotesFocus', toggleNotesFocus);

export function toggleNotesFormatBar(): void {
  layout.formatBar = !layout.formatBar;
  saveLayout();
  applyNotesLayout();
}
expose('toggleNotesFormatBar', toggleNotesFormatBar);

document.addEventListener('keydown', (e) => {
  if (getActiveTabId() !== 'notes' || S.commandPaletteOpen || document.querySelector('.modal-ov.open')) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === '.') { e.preventDefault(); toggleNotesFocus(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); if (focusMode) toggleNotesFocus(); (document.getElementById('notes-search') as HTMLInputElement | null)?.focus(); return; }
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); createNewNote(null); return; }
  if (e.key === 'Escape' && focusMode) { e.preventDefault(); toggleNotesFocus(); }
});

// ── Editor lifecycle: one CodeMirror instance reused across notes ───────────

let noteEditorView: EditorView | null = null;
const attachmentUrlCache = new Map<string, string>();

function resolveWikilinkTitle(title: string): number | null {
  const n = S.notes.find((x) => (x.title || 'Untitled').toLowerCase() === title.toLowerCase());
  return n ? n.id : null;
}

function resolveAttachmentUrl(id: string, img: HTMLImageElement): void {
  const cached = attachmentUrlCache.get(id);
  if (cached) { img.src = cached; return; }
  void getAttachmentDataUrl(Number(id)).then((url) => {
    attachmentUrlCache.set(id, url);
    img.src = url;
  }).catch(() => { img.alt = 'Attachment unavailable'; });
}

async function onImageFile(file: File): Promise<void> {
  if (!S.currentNoteId || !noteEditorView) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result as string;
    const att = await saveAttachment(S.currentNoteId!, file.name || 'image.png', dataUrl);
    if (noteEditorView) insertAtCursor(noteEditorView, `![](attachment://${att.id})`);
  };
  reader.readAsDataURL(file);
}

function getOrCreateEditor(): EditorView {
  if (noteEditorView) return noteEditorView;
  const container = document.getElementById('notes-editor');
  if (!container) throw new Error('notes-editor container missing');
  noteEditorView = createNoteEditor(container, {
    doc: '',
    onChange: () => autoSaveNote(),
    resolveWikilink: resolveWikilinkTitle,
    onWikilinkClick: (id) => openNote(id),
    onImageFile: (file) => void onImageFile(file),
    resolveAttachmentUrl,
    onCursorActivity: (view) => { updateWikilinkMenu(view); updateSlashMenu(view); updateFloatingToolbar(view); },
    onKeyDown: (e) => handleEditorMenuKey(e),
    placeholder: 'Start writing, or type / for headings, lists and more…',
  });
  noteEditorView.contentDOM.addEventListener('blur', () => setTimeout(hideFloatingToolbar, 120));
  return noteEditorView;
}

export function autoGrowNoteTitle(): void {
  const el = document.getElementById('notes-title-inp') as HTMLTextAreaElement | null;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}
expose('autoGrowNoteTitle', autoGrowNoteTitle);

/** Enter or ↓ at the end of the title moves into the note body. */
export function noteTitleKey(e: KeyboardEvent): void {
  const el = e.target as HTMLTextAreaElement;
  if (e.key === 'Enter' || (e.key === 'ArrowDown' && el.selectionStart === el.value.length)) {
    e.preventDefault();
    noteEditorView?.focus();
  }
}
expose('noteTitleKey', noteTitleKey);

function currentNote(): Note | undefined {
  return S.notes.find((x) => x.id === S.currentNoteId);
}

export function openNote(id: number): void {
  const n = S.notes.find((x) => x.id === id);
  if (!n) return;
  if (S.noteChanged && S.currentNoteId) saveCurrentNote();
  S.currentNoteId = id;
  notifyNavigated();
  const emptyEl = document.getElementById('notes-empty'); if (emptyEl) emptyEl.style.display = 'none';
  const panel = document.getElementById('notes-editor-panel');
  if (panel) { panel.style.display = ''; panel.scrollTop = 0; }
  const actions = document.getElementById('notes-doc-actions'); if (actions) actions.hidden = false;
  const titleEl = document.getElementById('notes-title-inp') as HTMLTextAreaElement;
  titleEl.value = n.title && n.title !== 'Untitled' ? n.title : '';
  autoGrowNoteTitle();
  const view = getOrCreateEditor();
  setEditorDoc(view, n.content || '');
  if (noteProjectLoadedFor !== id) noteProjectId = null;
  renderNoteProps(n);
  updatePinButton(n);
  const ts = document.getElementById('notes-ts');
  if (ts) ts.textContent = `Edited ${fmtDate(n.updatedAt || n.createdAt)}`;
  updateNoteWordCount();
  S.noteChanged = false;
  const status = document.getElementById('notes-save-status'); if (status) status.textContent = '';
  applyNotesLayout();
  renderNotesList();
  document.querySelector(`.note-item[data-note-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  void renderRelationsPanel(n);
}
expose('openNote', openNote);

function closeNoteEditor(): void {
  S.currentNoteId = null;
  S.noteChanged = false;
  notifyNavigated();
  const emptyEl = document.getElementById('notes-empty'); if (emptyEl) emptyEl.style.display = '';
  const panel = document.getElementById('notes-editor-panel'); if (panel) panel.style.display = 'none';
  const actions = document.getElementById('notes-doc-actions'); if (actions) actions.hidden = true;
  ['notes-ts', 'notes-word-count', 'notes-save-status'].forEach((id) => { const el = document.getElementById(id); if (el) el.textContent = ''; });
  hideFloatingToolbar();
  renderNotesEmpty();
  applyNotesLayout();
}

function updatePinButton(n: Note): void {
  const pinBtn = document.getElementById('notes-pin-btn');
  if (pinBtn) { pinBtn.classList.toggle('active', !!n.pinned); pinBtn.title = n.pinned ? 'Unpin' : 'Pin'; }
}

// ── Properties under the title ──────────────────────────────────────────────

let noteProjectId: number | null = null;
/** The open note's entity links, both directions (project, opportunity, tasks from it…). */
let noteLinks: EntityLink[] = [];

function renderNoteProps(n: Note): void {
  const el = document.getElementById('notes-props');
  if (!el) return;
  const project = noteProjectId != null ? S.projects.find((p) => p.id === noteProjectId) : null;
  el.innerHTML = `
    <button class="note-prop${n.folder ? ' set' : ''}" onclick="event.stopPropagation();noteFolderPicker(this)">${icon('folder', 12)}<span>${escHtml(n.folder ? n.folder.split('/').pop()! : 'Folder')}</span></button>
    <button class="note-prop${n.clientName ? ' set' : ''}" onclick="event.stopPropagation();noteClientPicker(this)">${icon('building', 12)}<span>${escHtml(n.clientName || 'Client')}</span></button>
    <button class="note-prop${project ? ' set' : ''}" id="note-prop-project" onclick="event.stopPropagation();noteProjectPicker(this)">${icon('target', 12)}<span>${escHtml(project?.name || 'Project')}</span></button>
    <div id="notes-tags-chips" class="tag-chip-input note-prop-tags"></div>`;
  const tagsContainer = document.getElementById('notes-tags-chips');
  if (tagsContainer) renderTagChips(tagsContainer, n.tags || [], (tags) => { n.tags = tags; n.updatedAt = today(); persistNotes(); renderNotesSidebar(); renderNotesList(); }, { placeholder: '#tag', suggestions: S.allTags });
  if (noteProjectLoadedFor !== n.id) void loadNoteProjectLink(n.id);
}

let noteProjectLoadedFor: number | null = null;
async function loadNoteProjectLink(noteId: number): Promise<void> {
  const links = await getLinksFor('note', noteId);
  if (S.currentNoteId !== noteId) return;
  noteProjectLoadedFor = noteId;
  noteLinks = links;
  noteProjectId = links.find((l) => l.fromType === 'note' && l.fromId === noteId && l.toType === 'project')?.toId ?? null;
  const n = currentNote();
  if (n) { renderNoteProps(n); void renderRelationsPanel(n); }
}

function setNoteField(fn: (n: Note) => void): void {
  const n = currentNote();
  if (!n) return;
  fn(n);
  n.updatedAt = today();
  persistNotes();
  renderNoteProps(n);
  renderNotesSidebar();
  renderNotesList();
  void renderRelationsPanel(n);
}

export function noteFolderPicker(anchor: HTMLElement): void {
  const n = currentNote();
  if (!n) return;
  const items: ContextMenuItem[] = [
    { label: `${!n.folder ? '✓ ' : ''}No folder`, run: () => setNoteField((x) => { x.folder = ''; }) },
    ...flattenFolderOptions(buildFolderTree(S.noteFolders)).map((o) => ({ label: `${n.folder === o.path ? '✓ ' : ''}${o.label}`, iconName: 'folder', run: () => setNoteField((x) => { x.folder = o.path; }) })),
    { label: '', run: () => {}, separator: true },
    { label: 'New folder…', iconName: 'plus', run: () => { void addNoteFolder().then((path) => { if (path) setNoteField((x) => { x.folder = path; }); }); } },
  ];
  showMenuAt(anchor, items);
}
expose('noteFolderPicker', noteFolderPicker);

export function noteProjectPicker(anchor: HTMLElement): void {
  const n = currentNote();
  if (!n) return;
  const setProject = async (projectId: number | null) => {
    // Replaces only the project link: the note's opportunity and other links stay.
    const links = await getLinksFor('note', n.id);
    const outgoing = replaceLinks(links, 'note', n.id, 'project', projectId != null ? [projectId] : []);
    await setLinksFrom('note', n.id, outgoing);
    noteLinks = [...links.filter((l) => !(l.fromType === 'note' && l.fromId === n.id)), ...outgoing];
    noteProjectId = projectId;
    renderNoteProps(n);
    void renderRelationsPanel(n);
    refreshProjectViewIfOpen();
  };
  showMenuAt(anchor, [
    { label: `${noteProjectId == null ? '✓ ' : ''}No project`, run: () => { void setProject(null); } },
    ...S.projects.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ label: `${noteProjectId === p.id ? '✓ ' : ''}${p.name}`, iconName: 'target', run: () => { void setProject(p.id); } })),
  ]);
}
expose('noteProjectPicker', noteProjectPicker);

export function noteClientPicker(anchor: HTMLElement): void {
  const n = currentNote();
  if (!n) return;
  let pop = document.getElementById('note-client-pop');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'note-client-pop';
    pop.className = 'note-client-pop';
    pop.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(pop);
    document.addEventListener('click', () => pop?.classList.remove('open'));
  }
  pop.innerHTML = `<input id="note-client-input" placeholder="Search companies" value="${escHtml(n.clientName || '')}">
    ${n.clientName ? `<button class="task-date-opt" id="note-client-clear">${icon('close', 13)}<span>Remove client</span></button>` : ''}`;
  pop.classList.add('open');
  positionFloatingPopup(pop, anchor);
  const input = document.getElementById('note-client-input') as HTMLInputElement;
  const commit = (name: string) => {
    pop?.classList.remove('open');
    // An explicit reassignment: the backend resolves the new name to a company.
    if ((n.clientName || '') !== name) setNoteField((x) => { x.clientName = name; x.companyId = null; });
  };
  attachCompanySelector(input, { onSelect: (name) => commit(name) });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(input.value.trim()); }
    if (e.key === 'Escape') { e.stopPropagation(); pop?.classList.remove('open'); }
  });
  document.getElementById('note-client-clear')?.addEventListener('click', () => commit(''));
  input.focus();
  input.select();
}
expose('noteClientPicker', noteClientPicker);

// ── Create, save, delete ────────────────────────────────────────────────────

export function createNewNote(templateId?: number | null): void {
  if (S.noteChanged && S.currentNoteId) saveCurrentNote();
  const tpl = templateId != null ? S.noteTemplates.find((t) => t.id === templateId) : null;
  const special = ['all', 'pinned', 'client', 'recent'].includes(S.currentNoteFolder) || S.currentNoteFolder.startsWith('tag:');
  const newNote: Note = {
    id: nextNoteId(),
    title: tpl ? tpl.name : '',
    content: tpl ? tpl.content : '',
    folder: special ? '' : S.currentNoteFolder,
    clientName: '',
    tags: S.currentNoteFolder.startsWith('tag:') ? [S.currentNoteFolder.slice(4)] : [],
    pinned: false,
    createdAt: today(),
    updatedAt: today(),
  };
  S.notes.unshift(newNote);
  persistNotes();
  if (getActiveTabId() !== 'notes') (window as any).switchTab('notes');
  if (focusMode) toggleNotesFocus();
  renderNotesSidebar();
  noteProjectId = null;
  noteLinks = [];
  noteProjectLoadedFor = newNote.id;
  openNote(newNote.id);
  closeNewNoteMenu();
  setTimeout(() => document.getElementById('notes-title-inp')?.focus(), 50);
}
expose('createNewNote', createNewNote);

export function toggleNewNoteMenu(e: Event): void {
  e.stopPropagation();
  const menu = document.getElementById('new-note-menu');
  if (!menu) return;
  if (menu.classList.contains('open')) { closeNewNoteMenu(); return; }
  menu.innerHTML = `<div class="wikilink-menu-item" onclick="createNewNote(null)">Blank note</div>` +
    (S.noteTemplates.length ? `<div class="menu-sep"></div><div class="menu-label">Templates</div>` : '') +
    S.noteTemplates.map((t) => `<div class="wikilink-menu-item row-center">
      <span class="flex-fill clickable" onclick="createNewNote(${t.id})">${escHtml(t.name)}</span>
      <button onclick="event.stopPropagation();renameNoteTemplate(${t.id})" title="Rename" class="menu-inline-btn">${icon('edit', 12)}</button>
      <button onclick="event.stopPropagation();removeNoteTemplate(${t.id})" title="Delete" class="menu-inline-btn">${icon('trash', 12)}</button>
    </div>`).join('') +
    (S.currentNoteId ? `<div class="menu-sep"></div><div class="wikilink-menu-item" onclick="saveCurrentNoteAsTemplate()">Save current note as template…</div>` : '');
  menu.classList.add('open');
  document.addEventListener('click', closeNewNoteMenu, { once: true });
}
expose('toggleNewNoteMenu', toggleNewNoteMenu);

export function closeNewNoteMenu(): void {
  document.getElementById('new-note-menu')?.classList.remove('open');
}
expose('closeNewNoteMenu', closeNewNoteMenu);

export async function saveCurrentNoteAsTemplate(): Promise<void> {
  if (!S.currentNoteId) { toast('Open a note first to save it as a template'); return; }
  if (S.noteChanged) saveCurrentNote();
  const n = currentNote();
  if (!n) return;
  const name = await showTextPrompt({ title: 'Template name', defaultValue: n.title || 'Untitled' });
  if (!name) return;
  const tpl = await saveNoteTemplate(name, n.content || '');
  S.noteTemplates.push(tpl);
  S.noteTemplates.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  toast(`Saved template "${name}"`, { tone: 'success' });
}
expose('saveCurrentNoteAsTemplate', saveCurrentNoteAsTemplate);

export async function renameNoteTemplate(id: number): Promise<void> {
  const tpl = S.noteTemplates.find((t) => t.id === id);
  if (!tpl) return;
  const name = await showTextPrompt({ title: 'Rename template', defaultValue: tpl.name });
  if (!name || name === tpl.name) return;
  await updateNoteTemplate(id, name, tpl.content);
  tpl.name = name;
}
expose('renameNoteTemplate', renameNoteTemplate);

export async function removeNoteTemplate(id: number): Promise<void> {
  const tpl = S.noteTemplates.find((t) => t.id === id);
  if (!tpl || !(await showConfirm(`Delete template "${tpl.name}"?`, { confirmLabel: 'Delete' }))) return;
  await deleteNoteTemplate(id);
  S.noteTemplates = S.noteTemplates.filter((t) => t.id !== id);
}
expose('removeNoteTemplate', removeNoteTemplate);

export function autoSaveNote(): void {
  S.noteChanged = true;
  updateNoteWordCount();
  const status = document.getElementById('notes-save-status');
  if (status) status.textContent = 'Editing…';
  if (S.noteAutoSaveTimer) window.clearTimeout(S.noteAutoSaveTimer);
  S.noteAutoSaveTimer = window.setTimeout(() => { saveCurrentNote(); }, 600);
}
expose('autoSaveNote', autoSaveNote);

/** Title and body come from the editor; folder, client and tags are set on
 * the note directly by their pickers. */
export function saveCurrentNote(): void {
  const n = currentNote();
  if (!n) return;
  n.title = (document.getElementById('notes-title-inp') as HTMLTextAreaElement | null)?.value.replace(/\n/g, ' ').trim() || 'Untitled';
  n.content = noteEditorView?.state.doc.toString() || '';
  n.updatedAt = today();
  persistNotes();
  // A checklist line added or removed changes the "Create tasks" offer.
  if (renderedActionItems.noteId === n.id && actionItems(n.content).length !== renderedActionItems.count) void renderRelationsPanel(n);
  S.noteChanged = false;
  const status = document.getElementById('notes-save-status');
  if (status) { status.textContent = 'Saved'; setTimeout(() => { if (status.textContent === 'Saved') status.textContent = ''; }, 1500); }
  const ts = document.getElementById('notes-ts'); if (ts) ts.textContent = `Edited ${fmtDate(n.updatedAt)}`;
  renderNotesList();
}
expose('saveCurrentNote', saveCurrentNote);

export async function deleteCurrentNote(): Promise<void> {
  if (S.currentNoteId) await deleteNote(S.currentNoteId);
}
expose('deleteCurrentNote', deleteCurrentNote);

export async function renameNote(id: number): Promise<void> {
  const n = S.notes.find((x) => x.id === id);
  if (!n) return;
  const title = await showTextPrompt({ title: 'Rename note', defaultValue: n.title || 'Untitled' });
  if (title === null) return;
  n.title = title || 'Untitled';
  n.updatedAt = today();
  persistNotes();
  if (id === S.currentNoteId) {
    const inp = document.getElementById('notes-title-inp') as HTMLTextAreaElement | null;
    if (inp) { inp.value = n.title; autoGrowNoteTitle(); }
  }
  renderNotesList();
}
expose('renameNote', renameNote);

export function duplicateNote(id: number): void {
  const n = S.notes.find((x) => x.id === id);
  if (!n) return;
  const copy = { ...n, id: nextNoteId(), title: `${n.title || 'Untitled'} (copy)`, pinned: false, createdAt: today(), updatedAt: today(), tags: [...(n.tags || [])] };
  S.notes.unshift(copy);
  persistNotes();
  renderNotesTab();
  openNote(copy.id);
}
expose('duplicateNote', duplicateNote);

/** Deleting still asks first: a note's attachments go with it and can't be restored by Undo. */
export async function deleteNote(id: number): Promise<void> {
  const n = S.notes.find((x) => x.id === id);
  if (!(await showConfirm(`"${n?.title || 'Untitled'}" and any images in it will be deleted.`, { title: 'Delete note?', confirmLabel: 'Delete' }))) return;
  S.notes = S.notes.filter((x) => x.id !== id);
  persistNotes();
  if (id === S.currentNoteId) closeNoteEditor();
  renderNotesTab();
}
expose('deleteNote', deleteNote);

export function noteContextMenu(e: MouseEvent, id: number): void {
  const n = S.notes.find((x) => x.id === id);
  if (!n) return;
  showContextMenu(e, [
    { label: 'Open', iconName: 'note', run: () => openNote(id) },
    { label: n.pinned ? 'Unpin' : 'Pin', iconName: 'pin', run: () => { n.pinned = !n.pinned; persistNotes(); renderNotesTab(); if (id === S.currentNoteId) updatePinButton(n); } },
    { label: 'Rename', iconName: 'edit', run: () => { void renameNote(id); } },
    { label: 'Duplicate', iconName: 'copy', run: () => duplicateNote(id) },
    { label: '', run: () => {}, separator: true },
    { label: 'Delete', iconName: 'trash', danger: true, run: () => { void deleteNote(id); } },
  ]);
}
expose('noteContextMenu', noteContextMenu);

export function noteMoreMenu(e: MouseEvent): void {
  e.stopPropagation();
  const n = currentNote();
  if (!n) return;
  showMenuAt(e.currentTarget as HTMLElement, [
    { label: n.pinned ? 'Unpin' : 'Pin to top', iconName: 'pin', run: () => toggleNotePin() },
    { label: 'Duplicate', iconName: 'copy', run: () => duplicateNote(n.id) },
    { label: 'Save as template…', iconName: 'document', run: () => { void saveCurrentNoteAsTemplate(); } },
    { label: 'Export as Markdown…', iconName: 'archive', run: () => { void exportCurrentNote(); } },
    { label: `${layout.formatBar ? 'Hide' : 'Show'} formatting bar`, iconName: 'bold', run: () => toggleNotesFormatBar() },
    { label: '', run: () => {}, separator: true },
    { label: 'Delete', iconName: 'trash', danger: true, run: () => { void deleteNote(n.id); } },
  ]);
}
expose('noteMoreMenu', noteMoreMenu);

async function exportCurrentNote(): Promise<void> {
  if (S.noteChanged) saveCurrentNote();
  const n = currentNote();
  if (!n) return;
  const safe = (n.title || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
  try {
    const path = await saveTextFileAs(`${safe}.md`, `# ${n.title || 'Untitled'}\n\n${n.content || ''}`, ['md']);
    if (path) toast('Note exported', { tone: 'success', detail: path });
  } catch (err) {
    toast('Could not export the note', { tone: 'error', detail: String(err) });
  }
}

export function toggleNotePin(): void {
  const n = currentNote();
  if (!n) return;
  n.pinned = !n.pinned;
  persistNotes();
  updatePinButton(n);
  renderNotesSidebar();
  renderNotesList();
}
expose('toggleNotePin', toggleNotePin);

function updateNoteWordCount(): void {
  const text = noteEditorView?.state.doc.toString() || '';
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const wc = document.getElementById('notes-word-count');
  if (wc) { wc.textContent = `${words} word${words !== 1 ? 's' : ''}`; wc.title = `${text.length} characters`; }
}

// ── Links and backlinks at the foot of the note ─────────────────────────────

function outgoingWikilinkTitles(content: string): string[] {
  const out = new Set<string>();
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) out.add(m[1].trim());
  return [...out];
}

async function renderRelationsPanel(n: Note): Promise<void> {
  const el = document.getElementById('notes-relations');
  if (!el || S.currentNoteId !== n.id) return;
  const outNotes = outgoingWikilinkTitles(n.content || '').map((t) => S.notes.find((x) => x.title === t)).filter(Boolean) as Note[];
  const backlinks = await getNoteBacklinks(n.id);
  if (S.currentNoteId !== n.id) return;
  const meetings = S.meetings.filter((m) => m.noteId === n.id);
  const project = noteProjectId != null ? S.projects.find((p) => p.id === noteProjectId) : null;
  const links = noteProjectLoadedFor === n.id ? noteLinks : [];
  const opportunities = links.filter((l) => l.fromType === 'note' && l.fromId === n.id && l.toType === 'opportunity')
    .map((l) => S.opportunities.find((o) => o.id === l.toId)).filter((o): o is NonNullable<typeof o> => !!o);
  const tasks = noteTasks(n, links);
  const pending = noteProjectLoadedFor === n.id ? unconvertedActionItems(n.content, tasks) : [];
  renderedActionItems = { noteId: n.id, count: actionItems(n.content).length };
  const group = (label: string, chips: string[]) => chips.length ? `<div class="relations-group"><div class="relations-group-label">${label}</div><div class="relations-chips">${chips.join('')}</div></div>` : '';
  const html = [
    group('Client', n.clientName ? [companyLink(n.companyId, n.clientName, { chip: true })] : []),
    group('Project', project ? [recordLink('project', project.id, project.name, { chip: true })] : []),
    group('Opportunity', opportunities.map((o) => recordLink('opportunity', o.id, o.name, { chip: true }))),
    group('Meetings', meetings.map((m) => recordLink('meeting', m.id, m.title || 'Untitled meeting', { chip: true }))),
    group('Tasks', tasks.map((t) => recordLink('task', t.id, `${t.status === 'Done' ? '✓ ' : ''}${t.title}`, { chip: true }))),
    group('Links to', outNotes.map((o) => recordLink('note', o.id, o.title || 'Untitled', { chip: true }))),
    group('Linked from', backlinks.map((b) => recordLink('note', b.id, b.title || 'Untitled', { chip: true }))),
  ].join('');
  const convert = pending.length
    ? `<div class="relations-group"><div class="relations-group-label">Action items</div><div class="relations-chips"><button class="btn-sm" onclick="createTasksFromNoteActionItems()" title="${escHtml(pending.join('\n'))}">Create ${pending.length === 1 ? 'a task' : `${pending.length} tasks`} from action items</button></div></div>`
    : '';
  el.innerHTML = html || convert ? `<div class="relations-title">Connections</div>${html}${convert}` : '';
}

let renderedActionItems = { noteId: 0, count: 0 };

/** Tasks that came from a note: linked to it (task → note), or added in the
 * meeting whose notes it holds. */
function noteTasks(n: Note, links: EntityLink[]): Todo[] {
  const linked = new Set(links.filter((l) => l.fromType === 'task' && l.toType === 'note' && l.toId === n.id).map((l) => l.fromId));
  const meetingIds = new Set(S.meetings.filter((m) => m.noteId === n.id).map((m) => m.id));
  return S.todos.filter((t) => linked.has(t.id) || (t.meetingId != null && meetingIds.has(t.meetingId)));
}

/** Turns the note's unchecked action items ("- [ ] Send the model") into
 * tasks that belong to the note's company, project, opportunity and meeting,
 * each linked back to the note. Items that already have a task are skipped. */
export async function createTasksFromNoteActionItems(): Promise<void> {
  const n = currentNote();
  if (!n) return;
  if (S.noteChanged) saveCurrentNote();
  await saveNotesNow();
  const links = await getLinksFor('note', n.id);
  if (S.currentNoteId !== n.id) return;
  noteLinks = links; noteProjectLoadedFor = n.id;
  const existing = noteTasks(n, links);
  const titles = unconvertedActionItems(n.content, existing);
  if (!titles.length) { toast(actionItems(n.content).length ? 'Every action item already has a task' : 'No open action items — add lines like “- [ ] Send the proposal”'); return; }
  const ctx = contextFromNote(S, n, links);
  const created: Todo[] = [];
  for (const title of titles) {
    // blankTask numbers from S.todos, so each is added before the next is made.
    const t = blankTask({ ...taskFields(ctx), title, description: `From note: ${n.title || 'Untitled'}` });
    S.todos.push(t);
    created.push(t);
  }
  persistTodos();
  await saveTodosNow();
  for (const t of created) await setLinksFrom('task', t.id, [{ fromType: 'task', fromId: t.id, toType: 'note', toId: n.id }]);
  noteLinks = [...links, ...created.map((t) => ({ fromType: 'task' as const, fromId: t.id, toType: 'note' as const, toId: n.id }))];
  refreshProjectViewIfOpen();
  (window as any).updateTodoBadge?.();
  toast(created.length === 1 ? `Task created: ${created[0].title}` : `${created.length} tasks created`, { detail: [ctx.companyName, ctx.projectId != null ? S.projects.find((p) => p.id === ctx.projectId)?.name : null].filter(Boolean).join(' · ') || undefined });
  void renderRelationsPanel(n);
}
expose('createTasksFromNoteActionItems', createTasksFromNoteActionItems);

/** New task from a note: the note's company, project, opportunity and meeting,
 * linked back to the note once saved. */
export async function createTodoForNote(noteId: number | null = S.currentNoteId): Promise<void> {
  const n = noteId != null ? S.notes.find((x) => x.id === noteId) : undefined;
  if (!n) return;
  const links = await getLinksFor('note', n.id);
  (window as any).openTodoModal?.(null, contextFromNote(S, n, links));
}
expose('createTodoForNote', createTodoForNote);

// ── Floating toolbar on selection ───────────────────────────────────────────

function updateFloatingToolbar(view: EditorView): void {
  const bar = document.getElementById('md-float-toolbar');
  if (!bar) return;
  const sel = view.state.selection.main;
  if (sel.empty || !view.hasFocus || isSlashMenuOpen() || isWikilinkMenuOpen()) { hideFloatingToolbar(); return; }
  const start = view.coordsAtPos(sel.from);
  const end = view.coordsAtPos(sel.to);
  if (!start || !end) return;
  bar.classList.add('open');
  const width = bar.offsetWidth;
  const mid = start.top === end.top ? (start.left + end.right) / 2 : start.left + 80;
  bar.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, mid - width / 2))}px`;
  const top = start.top - bar.offsetHeight - 8;
  bar.style.top = `${top < 52 ? end.bottom + 8 : top}px`;
}

function hideFloatingToolbar(): void {
  document.getElementById('md-float-toolbar')?.classList.remove('open');
}

// ── [[Wikilink]] autocomplete ───────────────────────────────────────────────

function positionAtCoords(menu: HTMLElement, coords: { left: number; right: number; top: number; bottom: number }): void {
  const fakeAnchor = { getBoundingClientRect: () => ({ ...coords, width: coords.right - coords.left, height: coords.bottom - coords.top, x: coords.left, y: coords.top, toJSON() { return this; } }) };
  positionFloatingPopup(menu, fakeAnchor as unknown as HTMLElement);
}

function textBeforeCursorOnLine(view: EditorView): string {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  return view.state.sliceDoc(line.from, pos);
}

let wikilinkCandidates: number[] = [];
let wikilinkSelIndex = 0;

function updateWikilinkMenu(view: EditorView): void {
  const menu = document.getElementById('wikilink-menu');
  if (!menu) return;
  const m = /\[\[([^\]]{0,60})$/.exec(textBeforeCursorOnLine(view));
  if (!m) { closeWikilinkMenu(); return; }
  const query = m[1].toLowerCase();
  const candidates = S.notes.filter((n) => n.id !== S.currentNoteId && (n.title || '').toLowerCase().includes(query)).slice(0, 8);
  if (candidates.length === 0) { closeWikilinkMenu(); return; }
  wikilinkCandidates = candidates.map((n) => n.id);
  wikilinkSelIndex = 0;
  menu.innerHTML = candidates.map((n, i) => `<div class="wikilink-menu-item${i === 0 ? ' sel' : ''}" onmousedown="event.preventDefault();insertWikilink(${n.id})">${escHtml(n.title || 'Untitled')}</div>`).join('');
  const coords = view.coordsAtPos(view.state.selection.main.head);
  if (coords) positionAtCoords(menu, coords);
  menu.classList.add('open');
}

function closeWikilinkMenu(): void {
  document.getElementById('wikilink-menu')?.classList.remove('open');
  wikilinkCandidates = [];
}

export function insertWikilink(noteId: number): void {
  const target = S.notes.find((n) => n.id === noteId);
  const view = noteEditorView;
  if (!target || !view) return;
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const idx = view.state.sliceDoc(line.from, pos).lastIndexOf('[[');
  closeWikilinkMenu();
  if (idx === -1) return;
  const from = line.from + idx;
  const insert = `[[${target.title || 'Untitled'}]] `;
  view.dispatch({ changes: { from, to: pos, insert }, selection: { anchor: from + insert.length } });
  view.focus();
}
expose('insertWikilink', insertWikilink);

// ── Slash-command menu ──────────────────────────────────────────────────────

interface SlashCmd { id: string; label: string; hint: string; keywords: string; glyph: string; run: (view: EditorView) => void }

const SLASH_COMMANDS: SlashCmd[] = [
  { id: 'h1', label: 'Heading 1', hint: 'Big section heading', keywords: 'h1 heading title big', glyph: 'H1', run: (v) => insertLinePrefix(v, '# ') },
  { id: 'h2', label: 'Heading 2', hint: 'Medium section heading', keywords: 'h2 heading subtitle', glyph: 'H2', run: (v) => insertLinePrefix(v, '## ') },
  { id: 'h3', label: 'Heading 3', hint: 'Small section heading', keywords: 'h3 heading', glyph: 'H3', run: (v) => insertLinePrefix(v, '### ') },
  { id: 'checklist', label: 'Checklist', hint: 'Track to-dos with checkboxes', keywords: 'todo check checkbox task', glyph: '☑', run: (v) => insertLinePrefix(v, '- [ ] ') },
  { id: 'bullet', label: 'Bulleted list', hint: 'Simple bullet list', keywords: 'ul bullet list unordered', glyph: '•', run: (v) => insertLinePrefix(v, '- ') },
  { id: 'numbered', label: 'Numbered list', hint: 'List with numbering', keywords: 'ol number list ordered', glyph: '1.', run: (v) => insertLinePrefix(v, '1. ') },
  { id: 'quote', label: 'Quote', hint: 'Capture a quote', keywords: 'quote blockquote', glyph: '❝', run: (v) => insertLinePrefix(v, '> ') },
  { id: 'code', label: 'Code block', hint: 'Monospaced snippet', keywords: 'code pre block', glyph: '{ }', run: (v) => insertCodeBlock(v) },
  { id: 'link', label: 'Link', hint: 'Insert a web link', keywords: 'link url href', glyph: '↗', run: (v) => insertLink(v) },
  { id: 'note', label: 'Link to note', hint: 'Connect another note', keywords: 'wikilink note backlink', glyph: '[[', run: (v) => insertAtCursor(v, '[[') },
  { id: 'divider', label: 'Divider', hint: 'Break between sections', keywords: 'hr divider rule line separator', glyph: '—', run: (v) => insertDivider(v) },
  { id: 'bold', label: 'Bold', hint: 'Emphasize text', keywords: 'b bold strong', glyph: 'B', run: (v) => wrapSelection(v, '**') },
  { id: 'italic', label: 'Italic', hint: 'Italicize text', keywords: 'i italic em', glyph: 'I', run: (v) => wrapSelection(v, '*') },
];

let slashCandidates: SlashCmd[] = [];
let slashSelIndex = 0;

function updateSlashMenu(view: EditorView): void {
  const menu = document.getElementById('slash-menu');
  if (!menu) return;
  const m = /(?:^|\s)\/([a-zA-Z0-9]{0,24})$/.exec(textBeforeCursorOnLine(view));
  if (!m) { closeSlashMenu(); return; }
  const query = m[1].toLowerCase();
  slashCandidates = SLASH_COMMANDS.filter((c) => !query || c.keywords.includes(query) || c.label.toLowerCase().includes(query));
  if (slashCandidates.length === 0) { closeSlashMenu(); return; }
  slashSelIndex = 0;
  renderSlashMenu();
  const coords = view.coordsAtPos(view.state.selection.main.head);
  if (coords) positionAtCoords(menu, coords);
  menu.classList.add('open');
}

function renderSlashMenu(): void {
  const menu = document.getElementById('slash-menu');
  if (!menu) return;
  menu.innerHTML = slashCandidates.map((c, i) => `<div class="wikilink-menu-item slash-item${i === slashSelIndex ? ' sel' : ''}" onmousedown="event.preventDefault();runSlashCommand('${c.id}')">
    <span class="slash-glyph">${escHtml(c.glyph)}</span>
    <span class="slash-text"><span class="slash-label">${escHtml(c.label)}</span><span class="slash-hint">${escHtml(c.hint)}</span></span>
  </div>`).join('');
}

function closeSlashMenu(): void {
  document.getElementById('slash-menu')?.classList.remove('open');
  slashCandidates = [];
}

function isSlashMenuOpen(): boolean {
  return !!document.getElementById('slash-menu')?.classList.contains('open');
}
function isWikilinkMenuOpen(): boolean {
  return !!document.getElementById('wikilink-menu')?.classList.contains('open');
}

function moveSlashSel(delta: number): void {
  if (slashCandidates.length === 0) return;
  slashSelIndex = (slashSelIndex + delta + slashCandidates.length) % slashCandidates.length;
  renderSlashMenu();
  document.querySelector('#slash-menu .slash-item.sel')?.scrollIntoView({ block: 'nearest' });
}

function moveWikilinkSel(delta: number): void {
  if (wikilinkCandidates.length === 0) return;
  wikilinkSelIndex = (wikilinkSelIndex + delta + wikilinkCandidates.length) % wikilinkCandidates.length;
  document.querySelectorAll('#wikilink-menu .wikilink-menu-item').forEach((el, i) => el.classList.toggle('sel', i === wikilinkSelIndex));
  document.querySelector('#wikilink-menu .sel')?.scrollIntoView({ block: 'nearest' });
}

export function runSlashCommand(id: string): void {
  const cmd = SLASH_COMMANDS.find((c) => c.id === id);
  const view = noteEditorView;
  closeSlashMenu();
  if (!cmd || !view) return;
  const m = /(?:^|\s)\/([a-zA-Z0-9]{0,24})$/.exec(textBeforeCursorOnLine(view));
  if (m) {
    const pos = view.state.selection.main.head;
    const from = pos - m[0].length + (m[0].startsWith(' ') ? 1 : 0);
    view.dispatch({ changes: { from, to: pos, insert: '' } });
  }
  cmd.run(view);
}
expose('runSlashCommand', runSlashCommand);

/** Menu keyboard navigation — intercepts only while a menu is open. */
function handleEditorMenuKey(e: KeyboardEvent): boolean {
  if (!isSlashMenuOpen() && !isWikilinkMenuOpen()) return false;
  const activate = () => {
    if (isSlashMenuOpen()) { const c = slashCandidates[slashSelIndex]; if (c) runSlashCommand(c.id); }
    else { const id = wikilinkCandidates[wikilinkSelIndex]; if (id != null) insertWikilink(id); }
  };
  switch (e.key) {
    case 'ArrowDown': isSlashMenuOpen() ? moveSlashSel(1) : moveWikilinkSel(1); return true;
    case 'ArrowUp': isSlashMenuOpen() ? moveSlashSel(-1) : moveWikilinkSel(-1); return true;
    case 'Enter': case 'Tab': activate(); return true;
    case 'Escape': closeSlashMenu(); closeWikilinkMenu(); return true;
    default: return false;
  }
}

// ── Formatting commands (toolbar, floating toolbar, slash menu) ─────────────

function withEditor(fn: (view: EditorView) => void): void {
  if (noteEditorView) fn(noteEditorView);
}
export function mdBold(): void { withEditor((v) => wrapSelection(v, '**')); }
expose('mdBold', mdBold);
export function mdItalic(): void { withEditor((v) => wrapSelection(v, '*')); }
expose('mdItalic', mdItalic);
export function mdStrike(): void { withEditor((v) => wrapSelection(v, '~~')); }
expose('mdStrike', mdStrike);
export function mdInlineCode(): void { withEditor((v) => wrapSelection(v, '`')); }
expose('mdInlineCode', mdInlineCode);
export function mdHeading(level: number): void { withEditor((v) => insertLinePrefix(v, '#'.repeat(level) + ' ')); }
expose('mdHeading', mdHeading);
export function mdBulletList(): void { withEditor((v) => insertLinePrefix(v, '- ')); }
expose('mdBulletList', mdBulletList);
export function mdNumberedList(): void { withEditor((v) => insertLinePrefix(v, '1. ')); }
expose('mdNumberedList', mdNumberedList);
export function mdChecklist(): void { withEditor((v) => insertLinePrefix(v, '- [ ] ')); }
expose('mdChecklist', mdChecklist);
export function mdQuote(): void { withEditor((v) => insertLinePrefix(v, '> ')); }
expose('mdQuote', mdQuote);
export function mdCode(): void { withEditor((v) => insertCodeBlock(v)); }
expose('mdCode', mdCode);
export function mdLink(): void { withEditor((v) => insertLink(v)); }
expose('mdLink', mdLink);
export function mdDivider(): void { withEditor((v) => insertDivider(v)); }
expose('mdDivider', mdDivider);

// ── Folders ─────────────────────────────────────────────────────────────────

/** `parentPath` creates a subfolder "parent/child". Resolves to the new path. */
export async function addNoteFolder(parentPath?: string): Promise<string | null> {
  const name = await showTextPrompt({ title: parentPath ? `New folder inside "${parentPath}"` : 'New folder', placeholder: 'Folder name' });
  if (!name) return null;
  const path = parentPath ? `${parentPath}/${name}` : name;
  if (!S.noteFolders.includes(path)) {
    S.noteFolders.push(path);
    if (parentPath) S.noteFolderCollapsed.delete(parentPath);
    persistNoteFolders();
  }
  renderNotesSidebar();
  return path;
}
expose('addNoteFolder', addNoteFolder);

/** Removing a folder moves its notes and subfolders up one level. */
export async function deleteNoteFolder(path: string): Promise<void> {
  if (!(await showConfirm(`Notes and subfolders inside "${path}" will move up one level.`, { title: 'Remove folder?', confirmLabel: 'Remove' }))) return;
  const prefix = `${path}/`;
  S.notes.forEach((n) => {
    if (n.folder === path) n.folder = '';
    else if (n.folder && n.folder.startsWith(prefix)) n.folder = n.folder.slice(prefix.length);
  });
  S.noteFolders = S.noteFolders
    .filter((f) => f !== path)
    .map((f) => (f.startsWith(prefix) ? f.slice(prefix.length) : f));
  persistNotes();
  persistNoteFolders();
  if (S.currentNoteFolder === path) S.currentNoteFolder = 'all';
  renderNotesTab();
  const n = currentNote();
  if (n) renderNoteProps(n);
}
expose('deleteNoteFolder', deleteNoteFolder);

// ── Company page section ────────────────────────────────────────────────────

export function renderCoNotesSection(d: { name: string; companyId: number | null }): void {
  const ref = { id: d.companyId, name: d.name };
  const companyNotes = S.notes.filter((n) => inCompany(ref, n.companyId, n.clientName)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const container = document.getElementById('cosub-notes-inner');
  if (!container) return;
  const cnt = document.getElementById('co-notes-tab-count');
  if (cnt) cnt.textContent = String(companyNotes.length);
  if (companyNotes.length === 0) {
    container.innerHTML = emptyState({ icon: 'note', title: `No notes for ${d.name} yet`, compact: true, action: { label: 'New note', onclick: `createNoteForCompany('${jsArg(d.name)}')` } });
    renderIcons(container);
    return;
  }
  container.innerHTML = `<div class="notes-list notes-list-embedded">${companyNotes.map((n) => `<div class="note-item" onclick="openNoteFromCompany(${n.id})">
    <div class="note-item-title">${n.pinned ? `<span class="note-pin">${icon('pin', 11)}</span>` : ''}${escHtml(n.title || 'Untitled')}</div>
    <div class="note-item-preview">${escHtml(previewText(n.content || '')) || '<span class="note-item-empty">No additional text</span>'}</div>
    <div class="note-item-meta"><span>${fmtDate(n.updatedAt)}</span>${(n.tags || []).map((t) => `<span class="note-item-tag">#${escHtml(t)}</span>`).join('')}</div>
  </div>`).join('')}</div>`;
}
expose('renderCoNotesSection', renderCoNotesSection);

export function createNoteForCompany(clientName: string): void {
  createNewNote(null);
  const n = currentNote();
  if (!n) return;
  n.clientName = clientName;
  n.companyId = S.companies.find((c) => c.name === clientName)?.id ?? null;
  persistNotes();
  renderNoteProps(n);
  void renderRelationsPanel(n);
}
expose('createNoteForCompany', createNoteForCompany);

export function openNoteFromCompany(id: number): void {
  (window as any).openRecord('note', id);
}
expose('openNoteFromCompany', openNoteFromCompany);
