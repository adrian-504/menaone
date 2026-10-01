// Notes in the app's look (1.62 "tools"): what kind of note the editor's
// eyebrow says it is, and the two-line excerpt a list row shows. The three
// columns, the editor, autosave and links stay as they were. Pure:
// tabs/notes.ts draws it.

import type { Note } from './types';

export type NoteKind = 'Meeting note' | 'Client note' | 'Note';

/** A note a meeting points at is a meeting note; else one linked to a client is a client note; else a note. Pure. */
export function noteKind(n: Pick<Note, 'id' | 'clientName'>, meetingNoteIds: Set<number>): NoteKind {
  if (meetingNoteIds.has(n.id)) return 'Meeting note';
  return n.clientName?.trim() ? 'Client note' : 'Note';
}

/** Markdown as plain words: images dropped, links and wikilinks as their text, list and heading marks gone. */
function plain(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#{1,6}|[-*+]\s\[[ xX]\]|[-*+]|\d+\.)\s+/gm, '')
    // A promise mark (">>" we owe, "<<" they owe) and a quote mark, after any list mark.
    .replace(/^\s*(>>|<<|>)\s*/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The excerpt under a note's title in the list: its text as plain words, without the title when the note opens by
 * repeating it (a first heading that is the title), cut at 160 characters. Pure. */
export function noteExcerpt(content: string | null | undefined, title: string | null | undefined): string {
  const text = plain(content || '');
  const t = plain(title || '');
  const rest = t && text.toLowerCase().startsWith(t.toLowerCase()) ? text.slice(t.length).trim() : text;
  return rest.slice(0, 160);
}
