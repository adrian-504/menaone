// Notes → Clients (owner, 29-Sep-2026): what Ahmad remembers is the client, not
// where a note was written. Each company with notes gets one list of all of
// them: Notes-module notes linked to it, the company page's note entries, and
// meetings with notes. Each row says where it lives and opens there. Pure:
// tabs/notes.ts renders it.

import { meetingNotesList } from './meetingNotesList';
import type { Meeting, Note } from './types';

export interface ClientKey { id: number | null; name: string }

/** A company page note (company_note_entries). */
export interface CompanyEntry { id: number; companyId: number | null; companyName: string | null; body: string; createdAt: string; updatedAt: string | null; pinned?: boolean }

export type ClientNoteSource = 'note' | 'company' | 'meeting';
export const SOURCE_LABEL: Record<ClientNoteSource, string> = { note: 'Note', company: 'Company page', meeting: 'Meeting' };

export interface ClientNoteRow {
  source: ClientNoteSource;
  id: number;
  title: string;
  excerpt: string;
  /** YYYY-MM-DD. */
  date: string | null;
  pinned: boolean;
}

type NoteLike = Pick<Note, 'id' | 'title' | 'content' | 'clientName' | 'companyId' | 'updatedAt' | 'createdAt' | 'pinned'>;
type MeetingLike = Parameters<typeof meetingNotesList>[0][number] & Pick<Meeting, 'companyId'>;

const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase();
const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);

/** Belongs to the client: the same company id, or no id and the same name. */
function belongs(key: ClientKey, id: number | null | undefined, name: string | null | undefined): boolean {
  if (key.id != null && id != null) return id === key.id;
  return !!name && norm(name) === norm(key.name);
}

/** Markdown down to a one-line preview. */
function plain(md: string): string {
  return md.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#{1,6}|>|[-*+]\s\[[ xX]\]|[-*+]|\d+\.)\s+/gm, '').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Every note about one client, newest first; `query` matches the title or the text (every word). */
export function clientNotesList(key: ClientKey, notes: NoteLike[], entries: CompanyEntry[], meetings: MeetingLike[], query = ''): ClientNoteRow[] {
  const rows: ClientNoteRow[] = [];
  for (const n of notes) {
    if (!belongs(key, n.companyId, n.clientName)) continue;
    // A note usually opens with its own title as a heading: the excerpt starts after it.
    const title = n.title || 'Untitled';
    const text = plain(n.content || '');
    const body = text.toLowerCase().startsWith(title.toLowerCase()) ? text.slice(title.length).trim() : text;
    rows.push({ source: 'note', id: n.id, title, excerpt: clip(body, 160), date: day(n.updatedAt || n.createdAt), pinned: !!n.pinned });
  }
  for (const e of entries) {
    if (!belongs(key, e.companyId, e.companyName)) continue;
    const [first, ...rest] = e.body.trim().split('\n');
    rows.push({ source: 'company', id: e.id, title: clip(plain(first || '') || 'Note', 80), excerpt: clip(plain(rest.join('\n')), 160), date: day(e.updatedAt || e.createdAt), pinned: !!e.pinned });
  }
  for (const m of meetingNotesList(meetings.filter((x) => belongs(key, x.companyId, x.companyName)))) {
    rows.push({ source: 'meeting', id: m.id, title: m.title, excerpt: m.excerpt, date: m.date, pinned: false });
  }
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows
    .filter((r) => !terms.length || terms.every((t) => `${r.title} ${r.excerpt}`.toLowerCase().includes(t)))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.source.localeCompare(b.source) || b.id - a.id);
}

export interface ClientWithNotes { key: ClientKey; count: number; latest: string | null }

/** The companies that have notes anywhere, most recent note first, with how many. */
export function clientsWithNotes(notes: NoteLike[], entries: CompanyEntry[], meetings: MeetingLike[], companies: { id: number; name: string }[]): ClientWithNotes[] {
  const byId = new Map(companies.map((c) => [c.id, c.name]));
  const byName = new Map(companies.map((c) => [norm(c.name), c.id]));
  const found = new Map<string, ClientWithNotes>();
  const add = (id: number | null | undefined, name: string | null | undefined, date: string | null) => {
    // Something kept by name only still joins its company when the name is known.
    const cid = id ?? byName.get(norm(name)) ?? null;
    const label = (cid != null ? byId.get(cid) : null) || (name || '').trim();
    if (!label) return;
    const k = cid != null ? `id:${cid}` : `name:${norm(label)}`;
    const cur = found.get(k) ?? { key: { id: cid, name: label }, count: 0, latest: null };
    cur.count += 1;
    if ((date || '') > (cur.latest || '')) cur.latest = date;
    found.set(k, cur);
  };
  for (const n of notes) if (n.companyId != null || n.clientName) add(n.companyId, n.clientName, day(n.updatedAt || n.createdAt));
  for (const e of entries) add(e.companyId, e.companyName, day(e.updatedAt || e.createdAt));
  for (const m of meetingNotesList(meetings)) {
    const src = meetings.find((x) => x.id === m.id);
    if (src && (src.companyId != null || src.companyName)) add(src.companyId, src.companyName, m.date);
  }
  return [...found.values()].sort((a, b) => (b.latest || '').localeCompare(a.latest || '') || a.key.name.localeCompare(b.key.name));
}

/** The Notes folder value for a client, and back. */
export const clientFolder = (k: ClientKey): string => (k.id != null ? `co:${k.id}` : `co:name:${k.name}`);
export function parseClientFolder(folder: string, companies: { id: number; name: string }[]): ClientKey | null {
  if (!folder.startsWith('co:')) return null;
  if (folder.startsWith('co:name:')) return { id: null, name: folder.slice(8) };
  const id = Number(folder.slice(3));
  return Number.isFinite(id) ? { id, name: companies.find((c) => c.id === id)?.name || '' } : null;
}
