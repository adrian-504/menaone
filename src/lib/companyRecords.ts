// Company 360, below Company notes: every record section that has something
// in it is open on the page, in a fixed order (owner, 23-Sep-2026: "Anything
// that has content I should see"). Only empty sections collapse, to their one
// quiet line with "+ New", after the populated ones. Linked emails has no
// "+ New", so with none it is hidden rather than collapsed.

import { collapseEmptySections } from './sectionLayout';

/** Section ids (co-sec-<id>) and their labels, in page order. */
export const COMPANY_RECORD_SECTIONS: [string, string][] = [
  ['proposals', 'Proposals'], ['agreements', 'Agreements'], ['opportunities', 'Opportunities'], ['projects', 'Projects'],
  // Commitments are in Next and the Owed line (the Promises view has them all); linked notes are in Notes.
  ['meetings', 'Meetings'], ['tasks', 'Tasks'],
  ['files', 'Files'], ['emails', 'Linked emails'],
];

/** The fixed part of the section bar. */
// People and the timeline are no longer in the page's flow (the left column, and "All activity").
export const COMPANY_NAV_FIXED: [string, string][] = [['overview', 'Overview'], ['notes-log', 'Notes']];

/** A count of null means "not known yet" (files and emails load later): the
 * section stays where it is, open, until the count arrives. */
export type RecordCounts = Record<string, number | null | undefined>;

/**
 * Orders the record sections inside `host`: populated ones in the fixed
 * order, then the empty ones as collapsed lines. Returns the populated ids.
 */
export function layoutCompanyRecords(host: HTMLElement, counts: RecordCounts): string[] {
  const sections = COMPANY_RECORD_SECTIONS
    .map(([id]) => ({ id, el: host.querySelector<HTMLElement>(`#co-sec-${id}`) }))
    .filter((s): s is { id: string; el: HTMLElement } => !!s.el);
  const emails = sections.find((s) => s.id === 'emails');
  if (emails) emails.el.hidden = counts.emails === 0 || counts.emails == null;
  const laid = sections.filter((s) => s.id !== 'emails' || !s.el.hidden);
  collapseEmptySections(host, laid.map(({ el, id }) => ({ el, empty: counts[id] === 0 })));
  if (emails?.el.hidden) host.append(emails.el);
  return laid.filter(({ id }) => (counts[id] ?? 0) > 0).map(({ id }) => id);
}

/** The section bar: the fixed items, then each populated record section with its count. */
export function companyNavItems(counts: RecordCounts): { id: string; label: string; count: number | null }[] {
  return [
    ...COMPANY_NAV_FIXED.map(([id, label]) => ({ id, label, count: id === 'contacts' ? (counts.contacts || null) : null })),
    ...COMPANY_RECORD_SECTIONS.filter(([id]) => (counts[id] ?? 0) > 0).map(([id, label]) => ({ id, label, count: counts[id] as number })),
  ];
}

/** Proposals requested together stay side by side, sorted as one item. Company
 * 360: by the latest of their dates, newest first (the default). Pending: by
 * the oldest member (`groupDate: 'earliest'`), so nothing hides behind a newer
 * sibling, in either order. Everything else keeps its own date. `group` is set
 * for a run of two or more. */
export function groupRequestedTogether<T extends { id: number; requestGroup?: string | null }>(
  list: T[], dateOf: (p: T) => string, opts: { groupDate?: 'latest' | 'earliest'; order?: 'desc' | 'asc' } = {},
): { group: string | null; date: string; items: T[] }[] {
  const asc = opts.order === 'asc';
  const earliest = opts.groupDate === 'earliest';
  const byDate = (a: T, b: T) => (asc ? dateOf(a).localeCompare(dateOf(b)) || a.id - b.id : dateOf(b).localeCompare(dateOf(a)) || b.id - a.id);
  const counts = new Map<string, number>();
  for (const p of list) if (p.requestGroup) counts.set(p.requestGroup, (counts.get(p.requestGroup) || 0) + 1);
  const out: { group: string | null; date: string; items: T[] }[] = [];
  const seen = new Map<string, { group: string | null; date: string; items: T[] }>();
  for (const p of list) {
    const g = p.requestGroup && (counts.get(p.requestGroup) || 0) > 1 ? p.requestGroup : null;
    if (!g) { out.push({ group: null, date: dateOf(p), items: [p] }); continue; }
    let item = seen.get(g);
    if (!item) { item = { group: g, date: dateOf(p), items: [] }; seen.set(g, item); out.push(item); }
    item.items.push(p);
    if (earliest ? dateOf(p) < item.date : dateOf(p) > item.date) item.date = dateOf(p);
  }
  for (const item of out) item.items.sort(byDate);
  return out.sort((a, b) => (asc ? a.date.localeCompare(b.date) || a.items[0].id - b.items[0].id : b.date.localeCompare(a.date) || b.items[0].id - a.items[0].id));
}
