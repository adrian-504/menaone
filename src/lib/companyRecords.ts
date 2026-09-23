// Company 360, below Company notes: every record section that has something
// in it is open on the page, in a fixed order (owner, 23-Sep-2026: "Anything
// that has content I should see"). Only empty sections collapse, to their one
// quiet line with "+ New", after the populated ones. Linked emails has no
// "+ New", so with none it is hidden rather than collapsed.

import { collapseEmptySections } from './sectionLayout';

/** Section ids (co-sec-<id>) and their labels, in page order. */
export const COMPANY_RECORD_SECTIONS: [string, string][] = [
  ['proposals', 'Proposals'], ['agreements', 'Agreements'], ['opportunities', 'Opportunities'], ['projects', 'Projects'],
  ['meetings', 'Meetings'], ['tasks', 'Tasks'], ['commitments', 'Commitments'], ['notes', 'Linked notes'],
  ['files', 'Files'], ['emails', 'Linked emails'],
];

/** The fixed part of the section bar. */
export const COMPANY_NAV_FIXED: [string, string][] = [['overview', 'Overview'], ['contacts', 'People'], ['activity', 'Timeline'], ['notes-log', 'Notes']];

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
