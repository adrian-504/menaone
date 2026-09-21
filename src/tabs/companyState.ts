// Company 360's state block, shared by the company page, the meeting page's
// Client brief and the printable Brief: the clauses from lib/companyBrief.ts,
// fed from the loaded data, rendered with links.

import { S } from '../lib/state';
import { escHtml, expose, today } from '../lib/utils';
import { recordLink } from '../lib/links';
import { icon } from '../lib/icons';
import { companyNoteEntries } from '../lib/db';
import { buildCompanyState, type BriefClause, type CompanyBriefInput, type PinnedNote } from '../lib/companyBrief';

type CompanyKey = { id: number | null; name: string };

/** A value for a single-quoted JS string inside an HTML attribute. */
export const jsString = (s: string) => escHtml(s.replace(/\\/g, '\\\\').replace(/'/g, "\\'"));

// Pinned notes live in the company's note log, which is read on demand; the
// last read is kept here so every view of the company shows the same pins.
const pinnedCache = new Map<string, PinnedNote[]>();
const cacheKey = (c: CompanyKey) => (c.id != null ? `id:${c.id}` : `name:${c.name}`);

export function setCompanyNotesCache(c: CompanyKey, notes: PinnedNote[]): void {
  pinnedCache.set(cacheKey(c), notes.filter((n) => n.pinned));
}

/** Reads the company's pinned notes once; `then` runs if they weren't known yet. */
export function ensurePinnedNotes(c: CompanyKey, then: () => void): void {
  if (pinnedCache.has(cacheKey(c))) return;
  pinnedCache.set(cacheKey(c), []);
  void companyNoteEntries(c.id, c.name).then((entries) => { setCompanyNotesCache(c, entries); if (entries.some((e) => e.pinned)) then(); }).catch(() => undefined);
}

export function briefInputFor(c: CompanyKey): CompanyBriefInput {
  return {
    company: c, today: today(), now: new Date().toISOString(),
    companies: S.companies, opportunities: S.opportunities, projects: S.projects, meetings: S.meetings, proposals: S.proposals,
    agreements: S.agreements, contacts: S.contacts, todos: S.todos, commitments: S.commitments, emails: S.emails,
    notes: pinnedCache.get(cacheKey(c)) || [],
  };
}

export function companyStateFor(c: CompanyKey): BriefClause[] {
  return buildCompanyState(briefInputFor(c));
}

/** A clause with its links: records open, sections jump to Company 360. */
export function clauseHtml(c: BriefClause, company: CompanyKey): string {
  const link = (i: number) => {
    const l = c.links[i];
    if (!l) return '';
    if (l.kind === 'section') {
      return `<a href="#" class="rlink" onclick="event.preventDefault();companyJump(${company.id ?? 'null'}, '${jsString(company.name)}', '${l.id}')">${escHtml(l.label)}</a>`;
    }
    return recordLink(l.kind, l.id as number, l.label);
  };
  // Text is escaped piece by piece around the {n} placeholders.
  const body = c.text.split(/(\{\d+\})/).map((part) => {
    const m = /^\{(\d+)\}$/.exec(part);
    return m ? link(+m[1]) : escHtml(part);
  }).join('');
  const quotes = c.quotes?.length
    ? `<div class="cs-quotes">${c.quotes.map((q) => `<blockquote class="cs-quote">${icon('pin', 12)}<span>${escHtml(q)}</span></blockquote>`).join('')}</div>`
    : '';
  return `<div class="cs-clause${c.tone ? ` tone-${c.tone}` : ''}" data-key="${c.key}"><span class="cs-dot" aria-hidden="true"></span><div class="cs-text">${quotes}${body ? `<p>${body}</p>` : ''}</div></div>`;
}

export function clausesHtml(clauses: BriefClause[], company: CompanyKey): string {
  return `<div class="cs-block">${clauses.map((c) => clauseHtml(c, company)).join('')}</div>`;
}

/** Opens Company 360 at a section (from a clause on any page). */
export function companyJump(id: number | null, name: string, section: string): void {
  const w = window as any;
  const open = S.currentCompany === name && document.getElementById('co-detail')?.classList.contains('open');
  if (!open) {
    if (id != null) w.openRecord('company', id);
    else w.openCompanyDetail?.(name);
  }
  setTimeout(() => w.scrollToCompanySection?.(section), open ? 0 : 150);
}
expose('companyJump', companyJump);
