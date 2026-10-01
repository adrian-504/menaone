// Files in the app's look (1.63 "chrome"): which client folders are matched to
// a company, the matching banner as progress, what a folder tile and a file
// card say, and the cover a file wears by its type. The Finder feel — path,
// search, sort, Grid/List, Quick Look, drop — stays. Pure: tabs/files.ts draws it.

import type { LinkedFileEntry, LocalFileItem } from './types';
import { fmtDateShort } from './dates';
import { daysBetween } from './pipeline';
import { plural } from './pageKit';

// ── Covers by type ──────────────────────────────────────────────────────────

/** deck: navy with the bars · sheet: green · pdf: red · doc: blue · image and anything else: grey. */
export type CoverKind = 'deck' | 'sheet' | 'pdf' | 'doc' | 'image' | 'file';

const COVERS: [RegExp, CoverKind][] = [
  [/\.(pptx?|key)$/i, 'deck'],
  [/\.(xlsx?|csv|numbers|ods)$/i, 'sheet'],
  [/\.pdf$/i, 'pdf'],
  [/\.(docx?|pages|rtf|odt|txt|md)$/i, 'doc'],
  [/\.(png|jpe?g|gif|heic|webp|svg|tiff?)$/i, 'image'],
];

export const coverKind = (name: string): CoverKind => COVERS.find(([re]) => re.test(name))?.[1] ?? 'file';

/** The badge on a cover: the extension in capitals, four letters at most ("PPTX"); "FILE" without one. */
export function extBadge(name: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1];
  return ext ? ext.slice(0, 4).toUpperCase() : 'FILE';
}

// ── Client folders ──────────────────────────────────────────────────────────

export interface ClientFolder {
  path: string;
  name: string;
  /** The company the folder is matched to, or null while it has none. */
  company: string | null;
  fileCount: number | null;
  folderCount: number | null;
  modifiedAt: string | null;
}

type Linked = Pick<LinkedFileEntry, 'path' | 'linkedToType' | 'linkedToName'>;

/** The folders of a listing, each with the company it is matched to (a link from that very folder to a company). Pure. */
export function classifyFolders(items: Pick<LocalFileItem, 'path' | 'name' | 'isFolder' | 'fileCount' | 'folderCount' | 'modifiedAt'>[], linked: Linked[]): ClientFolder[] {
  const company = new Map(linked.filter((l) => l.linkedToType === 'company').map((l) => [l.path, l.linkedToName]));
  return items.filter((i) => i.isFolder).map((i) => ({ path: i.path, name: i.name, company: company.get(i.path) ?? null, fileCount: i.fileCount ?? null, folderCount: i.folderCount ?? null, modifiedAt: i.modifiedAt }));
}

export interface MatchProgress { matched: number; total: number; left: number; headline: string; body: string; action: string }

/** The matching banner, as progress: "5 of 7 client folders are matched to companies" and what is left. Null when
 * there are no client folders or every one is matched. Pure. */
export function matchProgress(folders: Pick<ClientFolder, 'company'>[], rootName = 'Proposals'): MatchProgress | null {
  const total = folders.length;
  const matched = folders.filter((f) => !!f.company).length;
  const left = total - matched;
  if (!total || !left) return null;
  return {
    matched, total, left,
    headline: `${matched} of ${plural(total, 'client folder')} ${matched === 1 ? 'is' : 'are'} matched to ${matched === 1 ? 'a company' : 'companies'}`,
    body: `Folders under ${rootName} become the company's files automatically. ${left} still ${left === 1 ? 'needs' : 'need'} a match.`,
    action: `Match ${plural(left, 'folder')}`,
  };
}

/** Under a folder's name: "9 files · today", "4 files · 2 Sept"; folders only: "2 folders · 2 Sept"; nothing in it:
 * "empty". The count is left out when it is not known. Pure. */
export function folderLine(f: Pick<ClientFolder, 'fileCount' | 'folderCount' | 'modifiedAt'>, today: string): string {
  const what = f.fileCount == null ? '' : f.fileCount > 0 ? plural(f.fileCount, 'file') : (f.folderCount ?? 0) > 0 ? plural(f.folderCount!, 'folder') : 'empty';
  const day = f.modifiedAt ? f.modifiedAt.slice(0, 10) : '';
  const age = day ? daysBetween(day, today) ?? 0 : null;
  const when = age == null ? '' : age <= 0 ? 'today' : age === 1 ? 'yesterday' : fmtDateShort(day, true);
  return [what, when].filter(Boolean).join(' · ');
}

/** The company a file belongs to: the nearest folder above it that is matched to one. Null when none is. Pure. */
export function companyForPath(path: string, linked: Linked[]): string | null {
  const above = linked.filter((l) => l.linkedToType === 'company' && (path === l.path || path.startsWith(`${l.path}/`)));
  return above.sort((a, b) => b.path.length - a.path.length)[0]?.linkedToName ?? null;
}

/** The companies with a matched folder, by name, each with the files in it when the listing on screen knows. Pure. */
export function clientPlaces(linked: (Linked & Pick<LinkedFileEntry, 'isFolder' | 'exists'>)[], known: Pick<ClientFolder, 'path' | 'fileCount'>[]): { company: string; path: string; files: number | null }[] {
  const seen = new Set<string>();
  const out: { company: string; path: string; files: number | null }[] = [];
  for (const l of [...linked].sort((a, b) => a.linkedToName.localeCompare(b.linkedToName) || a.path.length - b.path.length)) {
    if (l.linkedToType !== 'company' || !l.isFolder || !l.exists || seen.has(l.linkedToName)) continue;
    seen.add(l.linkedToName);
    out.push({ company: l.linkedToName, path: l.path, files: known.find((k) => k.path === l.path)?.fileCount ?? null });
  }
  return out;
}
