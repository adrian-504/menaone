// The company page as a dossier (owner, 29-Sep-2026, Concept B). Left column,
// staying while you scroll: Details, People, Remember. Right: Where we stand as
// labelled lines, Next · Recent, Notes, then the records as short lists capped
// at three rows ("All N" opens the rest in place). The full timeline sits
// behind "All activity". What goes where: lib/companyDossier.ts.

import { S } from '../lib/state';
import { escHtml, expose, today } from '../lib/utils';
import { recordLink } from '../lib/links';
import { entityById } from '../lib/commercial';
import { getActivity } from '../lib/db';
import { liveThreads, type BriefClause } from '../lib/companyBrief';
import { buildRecordTimeline, type FutureRow } from '../lib/recordTimeline';
import { dossierNext, dossierRecent, STAND_LABEL, whenLabel, type RecentRow } from '../lib/companyDossier';
import { COMPANY_RECORD_SECTIONS } from '../lib/companyRecords';
import { briefInputFor, clauseBodyHtml, companyStateFor } from './companyState';
import { companyTimelineRecords } from './recordThread';
import { renderIcons } from '../core/chrome';
import type { Agreement, Company, Proposal } from '../lib/types';

type Key = { id: number | null; name: string };

// ── Where we stand, and what to remember ──

/** The state clauses as labelled lines; the pinned notes go to the Remember panel. */
export function renderDossierState(key: Key): void {
  const el = document.getElementById('co-state');
  if (!el) return;
  const clauses = companyStateFor(key);
  const dormant = liveThreads(briefInputFor(key)).filter((t) => t.dormant);
  const queues = [...new Set(dormant.map((t) => t.cleanupQueue))];
  const dormantLine = dormant.length
    ? ` <button class="co-stand-dormant" onclick="openCleanup(${queues.length === 1 && queues[0] ? `'${queues[0]}'` : ''})">${dormant.length} dormant — review in Clean-up</button>`
    : '';
  const line = (c: BriefClause) => {
    const label = STAND_LABEL[c.key];
    if (!label) return '';
    return `<div class="co-stand-line${c.tone ? ` is-${c.tone}` : ''}" data-key="${c.key}"><span class="co-stand-label">${label}</span><span class="co-stand-text">${clauseBodyHtml(c, key)}${c.key === 'inflight' ? dormantLine : ''}</span></div>`;
  };
  const lines = clauses.map(line).filter(Boolean);
  if (dormant.length && !clauses.some((c) => c.key === 'inflight')) lines.push(`<div class="co-stand-line" data-key="inflight"><span class="co-stand-label">In flight</span><span class="co-stand-text">${dormantLine.trim()}</span></div>`);
  el.innerHTML = lines.length ? `<div class="co-stand">${lines.join('')}</div>` : '<div class="co-stand"><div class="co-stand-line"><span class="co-stand-label">Relationship</span><span class="co-stand-text rec-muted">Nothing recorded yet.</span></div></div>';
  renderIcons(el);
  const quotes = clauses.find((c) => c.key === 'pinned')?.quotes || [];
  const remember = document.getElementById('co-remember');
  const panel = document.getElementById('co-panel-remember');
  if (panel) panel.hidden = !quotes.length;
  if (remember) remember.innerHTML = quotes.map((q) => `<p>${escHtml(q)}</p>`).join('');
}

// ── Details ──

export function renderDossierDetails(co: Company | undefined, d: { proposals: Proposal[]; agreements: Agreement[]; clientAgreements: Agreement[] }, listsHtml: string): void {
  const el = document.getElementById('co-details');
  if (!el) return;
  const entityId = d.clientAgreements.find((a) => a.businessEntityId != null)?.businessEntityId
    ?? [...d.proposals].sort((a, b) => b.id - a.id).find((p) => p.businessEntityId != null)?.businessEntityId;
  const website = co?.website?.trim();
  const facts: [string, string][] = [
    ['Industry', escHtml((co?.industries || []).join(', '))],
    ['City', escHtml([co?.city, co?.country].filter(Boolean).join(', '))],
    ['Entity', escHtml(entityById(entityId)?.name || '')],
    ['Owner', escHtml(co?.owner || '')],
    ['Website', website ? `<a class="rlink" href="#" onclick="event.preventDefault();openExternalUrl('${escHtml(/^https?:/.test(website) ? website : `https://${website}`)}')">${escHtml(website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : ''],
    ['Lists', listsHtml],
  ];
  el.innerHTML = facts.filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('') || '<div><dt></dt><dd class="rec-muted">Add details with Edit.</dd></div>';
}

// ── Next · Recent ──

function nextRow(r: FutureRow, todayIso: string): string {
  const when = r.date ? `${whenLabel(r.date, todayIso)}${r.time ? ` ${r.time}` : ''}` : '';
  const mark = r.action && (r.action.kind === 'complete_task' || r.action.kind === 'mark_kept')
    ? `<button class="co-nr-box" onclick="event.stopPropagation();timelineAct('${r.action.kind}', ${r.action.id})" data-tip="${r.action.kind === 'complete_task' ? 'Mark done' : 'Mark kept'}" aria-label="${r.action.kind === 'complete_task' ? 'Mark done' : 'Mark kept'}"></button>`
    : `<span class="co-nr-dot tone-${r.kind === 'meeting' ? 'accent' : 'muted'}"></span>`;
  const title = r.record ? recordLink(r.record.kind, r.record.id, r.label) : escHtml(r.label);
  return `<div class="co-nr-row"><span class="co-nr-when${r.overdue ? ' is-late' : ''}">${escHtml(when)}</span>${mark}<span class="co-nr-main">${title}${r.sub ? `<span class="co-nr-sub">${escHtml(r.sub)}</span>` : ''}</span></div>`;
}

function recentRow(r: RecentRow, todayIso: string): string {
  const title = r.record ? recordLink(r.record.kind, r.record.id, r.label) : escHtml(r.label);
  return `<div class="co-nr-row"><span class="co-nr-when">${escHtml(whenLabel(r.date, todayIso))}</span><span class="co-nr-dot tone-${r.tone}"></span><span class="co-nr-main">${title}${r.sub ? `<span class="co-nr-sub">${escHtml(r.sub)}</span>` : ''}</span></div>`;
}

let nextRecentFor = '';

export async function renderDossierNextRecent(key: Key): Promise<void> {
  const next = document.getElementById('co-next');
  const recent = document.getElementById('co-recent');
  if (!next || !recent) return;
  const token = `${key.id ?? ''}|${key.name}|${Date.now()}`;
  nextRecentFor = token;
  const todayIso = today();
  const records = companyTimelineRecords(key);
  const activity = await getActivity({ companyId: key.id ?? undefined, limit: 400 }).catch(() => []);
  if (nextRecentFor !== token) return;
  const tl = buildRecordTimeline(records, {
    today: todayIso, activity, meetings: S.meetings, todos: S.todos, commitments: S.commitments, opportunities: S.opportunities,
    proposals: S.proposals, agreements: S.agreements, projects: S.projects, company: key,
  });
  const of = (id: number | null | undefined, name: string | null | undefined) => (id != null && key.id != null ? id === key.id : !!name && name === key.name);
  const nextRows = dossierNext(tl.future);
  const recentRows = dossierRecent(activity, S.meetings.filter((m) => of(m.companyId, m.companyName)), todayIso);
  next.innerHTML = nextRows.length ? nextRows.map((r) => nextRow(r, todayIso)).join('') : '<p class="co-nr-none">Nothing dated ahead.</p>';
  recent.innerHTML = recentRows.length ? recentRows.map((r) => recentRow(r, todayIso)).join('') : '<p class="co-nr-none">Nothing yet.</p>';
  renderIcons(next);
}

// ── Records: three rows each, the rest in place ──

/** Sections opened in full on this visit (reset when another company opens). */
const expanded = new Set<string>();
let expandedFor = '';
const CAP = 3;

/** The rows of a record section, whatever it renders them as. */
function sectionRows(sec: HTMLElement): HTMLElement[] {
  return [...sec.querySelectorAll<HTMLElement>(':scope tbody > tr, :scope .rec-list > .rec-row, :scope .project-grid > *, :scope .task-group > *, :scope .cm-list > .cm-group > .cm-row, :scope .cm-list > .cm-row')]
    .filter((el) => !el.closest('details'));
}

export function capCompanyRecords(company: string): void {
  if (expandedFor !== company) { expanded.clear(); expandedFor = company; }
  for (const [id] of COMPANY_RECORD_SECTIONS) {
    const sec = document.getElementById(`co-sec-${id}`);
    if (!sec) continue;
    const rows = sectionRows(sec);
    const open = expanded.has(id);
    rows.forEach((r, i) => r.classList.toggle('co-row-capped', !open && i >= CAP));
    const hd = sec.querySelector('.rec-section-hd');
    let all = hd?.querySelector<HTMLAnchorElement>('.co-rec-all');
    const want = rows.length > CAP ? (open ? 'Fewer' : `All ${rows.length}`) : '';
    if (!want) { all?.remove(); continue; }
    if (!all && hd) {
      all = document.createElement('a');
      all.href = '#';
      all.className = 'rlink co-rec-all';
      all.setAttribute('onclick', `event.preventDefault();toggleCompanyRecordSection('${id}')`);
      const cnt = hd.querySelector('.rec-count');
      if (cnt) cnt.after(all); else hd.append(all);
    }
    if (all && all.textContent !== want) all.textContent = want;
  }
}

export function toggleCompanyRecordSection(id: string): void {
  if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
  if (S.currentCompany) capCompanyRecords(S.currentCompany);
}
expose('toggleCompanyRecordSection', toggleCompanyRecordSection);

let observing = false;
/** Record sections render at different times (files, emails, meetings later): cap them whenever they change. */
export function watchCompanyRecords(): void {
  const host = document.getElementById('co-records');
  if (!host || observing) return;
  observing = true;
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => { pending = false; if (S.currentCompany) capCompanyRecords(S.currentCompany); });
  }).observe(host, { childList: true, subtree: true });
}

// ── Notes: the list first, the input when asked for ──

export function openCompanyNoteComposer(): void {
  const box = document.getElementById('co-notes-composer');
  if (box) box.hidden = false;
  const add = document.getElementById('co-notes-add'); if (add) add.hidden = true;
  (document.getElementById('co-notes-text') as HTMLTextAreaElement | null)?.focus();
}
expose('openCompanyNoteComposer', openCompanyNoteComposer);

export function closeCompanyNoteComposer(): void {
  const box = document.getElementById('co-notes-composer');
  if (box) box.hidden = true;
  const add = document.getElementById('co-notes-add'); if (add) add.hidden = false;
  const t = document.getElementById('co-notes-text') as HTMLTextAreaElement | null;
  if (t) t.value = '';
}
expose('closeCompanyNoteComposer', closeCompanyNoteComposer);

/** A fresh page: the composer and the full timeline closed. */
export function resetDossierFolds(): void {
  closeCompanyNoteComposer();
  const act = document.getElementById('co-sec-activity');
  if (act) act.hidden = true;
  const t = document.getElementById('co-activity-toggle'); if (t) t.textContent = 'All activity';
}

