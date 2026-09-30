// @vitest-environment jsdom
// Notes flicker (owner, 29-Sep-2026): "flipping quickly between notes makes the
// app weird — the notes flicker, unselect, then select a different note." The
// cause: loading a note into the editor counted as an edit, so 600 ms later it
// was "saved" with today's date and jumped up the list under the pointer.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => []) }));
// jsdom has no layout: CodeMirror and scrollIntoView get stand-ins.
Element.prototype.scrollIntoView = () => {};
Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect;

vi.mock('../lib/persist', async (orig) => ({ ...(await orig<typeof import('../lib/persist')>()), persistNotes: vi.fn() }));
vi.mock('../lib/db', async (orig) => ({ ...(await orig<typeof import('../lib/db')>()), getLinksFor: vi.fn(async () => []) }));

import { S } from '../lib/state';
import { persistNotes } from '../lib/persist';
import { openNote, autoSaveNote, notesEditorReady } from './notes';
import type { Note } from '../lib/types';

const note = (id: number, title: string, updatedAt: string): Note => ({
  id, title, content: `${title} body`, folder: null, clientName: null, tags: [], pinned: false, createdAt: '2026-09-01', updatedAt,
} as unknown as Note);

// One page for the file: the editor is created once and reused, as in the app.
document.body.innerHTML = `<div id="notes-list"></div><div id="notes-empty"></div>
  <div id="notes-editor-panel"><textarea id="notes-title-inp"></textarea><div id="notes-props"></div><div id="notes-editor"></div><footer id="notes-relations"></footer></div>
  <span id="notes-ts"></span><span id="notes-save-status"></span>`;

// The editor is its own chunk (foundations P2): load it once, as opening Notes does.
beforeAll(async () => { await notesEditorReady(); });

beforeEach(() => {
  document.getElementById('notes-list')!.innerHTML = '';
  S.notes = [note(1, 'Alpha', '2026-09-03'), note(2, 'Bravo', '2026-09-02'), note(3, 'Charlie', '2026-09-01')];
  S.currentNoteFolder = 'all';
  S.currentNoteId = null;
  S.noteChanged = false;
  vi.mocked(persistNotes).mockClear();
});

const rows = () => [...document.querySelectorAll<HTMLElement>('#notes-list .note-item')];
const editorText = () => document.querySelector('#notes-editor .cm-content')?.textContent;

describe('flipping quickly between notes', () => {
  it('opening a note is not an edit: no save, no new date, the list stays put', async () => {
    openNote(3);
    const order = rows().map((r) => r.dataset.noteId);
    await new Promise((r) => setTimeout(r, 700));
    expect(persistNotes).not.toHaveBeenCalled();
    expect(S.notes.find((n) => n.id === 3)!.updatedAt).toBe('2026-09-01');
    expect(rows().map((r) => r.dataset.noteId)).toEqual(order);
  });

  it('A with a pending edit, then B, then C within 10 ms: A saved once, C selected and shown', async () => {
    openNote(1);
    (document.getElementById('notes-title-inp') as HTMLTextAreaElement).value = 'Alpha edited';
    autoSaveNote();
    const list = document.getElementById('notes-list')!;
    let rebuilds = 0;
    new MutationObserver((m) => { rebuilds += m.filter((x) => x.type === 'childList').length; }).observe(list, { childList: true });
    openNote(2);
    await new Promise((r) => setTimeout(r, 5));
    openNote(3);
    await new Promise((r) => setTimeout(r, 700));
    expect(S.currentNoteId).toBe(3);
    expect(rows().filter((r) => r.classList.contains('active')).map((r) => r.dataset.noteId)).toEqual(['3']);
    expect(editorText()).toBe('Charlie body');
    expect(persistNotes).toHaveBeenCalledTimes(1);
    expect(S.notes.find((n) => n.id === 1)!.title).toBe('Alpha edited');
    expect(S.notes.find((n) => n.id === 2)!.updatedAt).toBe('2026-09-02');
    expect(S.notes.find((n) => n.id === 3)!.updatedAt).toBe('2026-09-01');
    expect(rebuilds).toBeLessThanOrEqual(1); // only A's real save may rebuild the rows
  });
});
