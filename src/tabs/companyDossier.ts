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
import { liveThreads, companyRecords, companyContact, relationshipStatus, type BriefClause } from '../lib/companyBrief';
import { inFlightRows, standHeadline, STAND_TONE, type StandInput } from '../lib/recordCompany';
import { companyServiceRows } from '../lib/companyServices';
import { teamMember, defaultReviewer } from '../lib/commercial';
import { needsFollowUp } from '../core/proposals';
import { proposalStaleMonths } from '../lib/pagesQueues';
import { followUpCount } from '../lib/followup';
import { opportunityHealth } from '../lib/pipeline';
import { hasOpenWork } from '../lib/myday';
import { buildRecordTimeline, type FutureRow } from '../lib/recordTimeline';
import { dossierNext, dossierRecent, STAND_LABEL, whenLabel, type RecentRow } from '../lib/companyDossier';
import { COMPANY_RECORD_SECTIONS } from '../lib/companyRecords';
import { briefInputFor, clauseBodyHtml, companyStateFor } from './companyState';
import { companyTimelineRecords } from './recordThread';
import { renderIcons } from '../core/chrome';
import type { Agreement, Company, Proposal } from '../lib/types';

type Key = { id: number | null; name: string };

// ── Where we stand, and what to remember ──

/** Where we stand as four cards (relationship, in flight, last contact, owed), each a headline and the clause's
 * sentence with its links; the pinned notes go to the Remember panel. */
export function renderDossierState(key: Key): void {
  const el = document.getElementById('co-state');
  if (!el) return;
  const input = briefInputFor(key);
  const clauses = companyStateFor(key);
  const threads = liveThreads(input);
  const dormant = threads.filter((t) => t.dormant);
  const queues = [...new Set(dormant.map((t) => t.cleanupQueue))];
  const dormantLine = dormant.length
    ? ` <button class="co-stand-dormant" onclick="openCleanup(${queues.length === 1 && queues[0] ? `'${queues[0]}'` : ''})">${dormant.length} dormant — review in Clean-up</button>`
    : '';
  const r = companyRecords(input);
  const stand: StandInput = {
    today: input.today, clientAgreements: r.clientAgreements, proposals: r.proposals, opportunities: r.opportunities, commitments: r.commitments,
    relationship: relationshipStatus(r).label, lastContact: companyContact(input, r).lastContact, threads: threads.filter((t) => !t.dormant).length,
  };
  const card = (c: BriefClause) => {
    const label = STAND_LABEL[c.key];
    if (!label) return '';
    return `<div class="rk-stand t-${STAND_TONE[c.key] || 'blue'}" data-key="${c.key}"><div class="rk-stand-k">${label}</div><div class="rk-stand-h">${escHtml(standHeadline(c.key, stand))}</div><div class="rk-stand-t">${clauseBodyHtml(c, key)}${c.key === 'inflight' ? dormantLine : ''}</div></div>`;
  };
  const cards = clauses.map(card).filter(Boolean);
  if (dormant.length && !clauses.some((c) => c.key === 'inflight')) cards.splice(1, 0, `<div class="rk-stand t-amber" data-key="inflight"><div class="rk-stand-k">In flight</div><div class="rk-stand-h">Nothing open</div><div class="rk-stand-t">${dormantLine.trim()}</div></div>`);
  el.innerHTML = cards.length ? `<div class="rk-stands" style="--n:${cards.length}">${cards.join('')}</div>` : '<div class="rk-stands" style="--n:1"><div class="rk-stand t-blue"><div class="rk-stand-k">Relationship</div><div class="rk-stand-h">New company</div><div class="rk-stand-t rec-muted">Nothing recorded yet.</div></div></div>';
  renderIcons(el);
  const quotes = clauses.find((c) => c.key === 'pinned')?.quotes || [];
  const remember = document.getElementById('co-remember');
  const panel = document.getElementById('co-panel-remember');
  if (panel) panel.hidden = !quotes.length;
  if (remember) remember.innerHTML = quotes.map((q) => `<p>${escHtml(q)}</p>`).join('');
}

// ── In flight ──

/** The services the company is getting, one line each: what it costs a month, the agreement, when that expires and
 * where it stands — Live, Past term · still active, No agreement, One-time work (lib/companyServices.ts). */
export function renderDossierServices(key: Key): void {
  const el = document.getElementById('co-services');
  const sec = document.getElementById('co-sec-services');
  if (!el || !sec) return;
  const mine = <T extends { companyId?: number | null }>(x: T, name: string | null | undefined) => (key.id != null && x.companyId != null ? x.companyId === key.id : !!name && name === key.name);
  const rows = companyServiceRows({ today: today(), agreements: S.agreements.filter((a) => mine(a, a.client)), proposals: S.proposals.filter((p) => mine(p, p.client)) });
  sec.hidden = !rows.length;
  const cnt = document.getElementById('co-services-count'); if (cnt) cnt.textContent = rows.length ? String(rows.length) : '';
  el.innerHTML = rows.length ? `<div class="rk-svc-h"><span>Service</span><span>Per month</span><span>Agreement</span><span>Expires</span><span>Status</span></div>${rows.map((r) => `<div class="rk-svc" onclick="if(!event.target.closest('a,button'))openRecord('${r.agreement ? 'agreement' : 'proposal'}', ${r.agreement ? r.agreement.id : r.proposalId})">
      <b>${escHtml(r.service)}</b>
      <span class="rk-svc-m">${escHtml(r.monthly)}</span>
      <span>${r.agreement ? recordLink('agreement', r.agreement.id, r.agreement.ref) : r.proposalId != null ? `<span class="rec-muted">from </span>${recordLink('proposal', r.proposalId, `SL# ${r.proposalId}`)}` : '—'}</span>
      <span${r.expires.known ? '' : ' class="rec-muted"'}>${escHtml(r.expires.text)}</span>
      <span class="pk-stage t-${r.tone}"><i></i>${escHtml(r.status)}</span>
    </div>`).join('')}` : '';
}

/** Open proposals and opportunities as rows: a kind tile, what it is, where it stands, how long, one action. */
export function renderDossierFlight(key: Key): void {
  const el = document.getElementById('co-flight');
  const sec = document.getElementById('co-sec-flight');
  if (!el || !sec) return;
  const t = today();
  const mine = <T extends { companyId?: number | null }>(x: T, name: string | null | undefined) => (key.id != null && x.companyId != null ? x.companyId === key.id : !!name && name === key.name);
  const rows = inFlightRows({
    today: t,
    proposals: S.proposals.filter((p) => mine(p, p.client)),
    opportunities: S.opportunities.filter((o) => mine(o, o.companyName)),
    reviewer: (p) => teamMember(p.reviewerId)?.name || defaultReviewer()?.name || 'the reviewer',
    due: (p) => needsFollowUp(p),
    stale: (p) => proposalStaleMonths(p, S.touches, followUpCount(p, S.touches), t) != null,
    followUps: (p) => followUpCount(p, S.touches),
    health: (o) => opportunityHealth(o, S.pipelineFacts.find((f) => f.opportunityId === o.id), t, { openWork: hasOpenWork(o, S) }),
  });
  sec.hidden = !rows.length;
  const cnt = document.getElementById('co-flight-count'); if (cnt) cnt.textContent = rows.length ? String(rows.length) : '';
  el.innerHTML = rows.map((r) => `<div class="rk-row rec-row" tabindex="0" onclick="if(!event.target.closest('a,button'))openRecord('${r.kind}', ${r.id})" onkeydown="if(event.key==='Enter'&&event.target===this)this.click()">
    <span class="rk-k t-${r.glyphTone}" aria-hidden="true">${r.glyph}</span>
    <div class="rk-row-main"><div class="rk-row-t">${escHtml(r.title)}</div><div class="rk-row-s">${escHtml(r.sub)}</div></div>
    <span class="pk-stage t-${r.chip.tone}"><i></i>${escHtml(r.chip.text)}</span>
    <span class="pk-age-sm t-${r.tone}">${r.days == null ? '' : `${r.days} ${r.days === 1 ? 'day' : 'days'}`}</span>
    <button class="btn-secondary btn-sm" onclick="event.stopPropagation();${r.kind === 'proposal' && r.action.kind !== 'open' ? `dbAct(event, ${r.id}, '${r.action.kind}')` : `openRecord('${r.kind}', ${r.id})`}">${escHtml(r.action.label)}</button>
  </div>`).join('');
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

const NEXT_KIND: Record<FutureRow['kind'], [string, string]> = { meeting: ['◉', 'blue'], task: ['☑', 'grey'], commitment: ['⚑', 'red'], date: ['§', 'amber'] };

/** One thing ahead: a date medallion (red when late), a kind tile, what it is, and its one action. */
function nextRow(r: FutureRow, todayIso: string): string {
  const d = r.date ? new Date(`${r.date}T12:00:00`) : null;
  const sameYear = d && d.getFullYear() === new Date(`${todayIso}T12:00:00`).getFullYear();
  const days = r.date ? Math.round((Date.parse(`${r.date}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86_400_000) : null;
  // This week: the weekday; further off or behind us: the month.
  const under = !d ? '' : days != null && days >= 0 && days < 7 ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] : `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'][d.getMonth()]}${sameYear ? '' : ` ${String(d.getFullYear()).slice(2)}`}`;
  const [glyph, tone] = NEXT_KIND[r.kind];
  const title = r.record ? recordLink(r.record.kind, r.record.id, r.label) : escHtml(r.label);
  const late = r.overdue && days != null ? `${-days} ${days === -1 ? 'day' : 'days'} late` : '';
  const sub = [r.time || '', r.sub || '', late].filter(Boolean).join(' · ');
  const act = r.action?.kind === 'mark_kept' ? `<button class="btn-secondary btn-sm" onclick="event.stopPropagation();timelineAct('mark_kept', ${r.action.id})">Mark kept</button>`
    : r.action?.kind === 'complete_task' ? `<button class="btn-secondary btn-sm" onclick="event.stopPropagation();timelineAct('complete_task', ${r.action.id})">Done</button>`
    : r.kind === 'meeting' && r.record ? `<button class="btn-secondary btn-sm" onclick="openRecord('meeting', ${r.record.id})">Prepare</button>`
    : r.record?.kind === 'agreement' && /notice/i.test(r.label) ? `<a href="#" class="rlink rk-link" onclick="event.preventDefault();openRecord('agreement', ${r.record.id})">Start renewal</a>` : '';
  return `<div class="rk-next"><div class="rk-med${r.overdue ? ' is-late' : ''}"><b>${d ? d.getDate() : '—'}</b><span>${escHtml(under)}</span></div><span class="rk-k sm t-${r.overdue && r.kind !== 'meeting' ? 'red' : tone}" aria-hidden="true">${glyph}</span><div class="rk-row-main"><div class="rk-row-t">${title}</div>${sub ? `<div class="rk-row-s${r.overdue ? ' is-late' : ''}">${escHtml(sub)}</div>` : ''}</div>${act}</div>`;
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
  recent.innerHTML = recentRows.length ? recentRows.map((r) => recentRow(r, todayIso)).join('') : '';
  const sec = document.getElementById('co-sec-next'); if (sec) sec.classList.toggle('is-empty', !nextRows.length);
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

