// Opportunities / Pipeline (Core Refinement & Product Maturity, Stage 2) —
// the first-class pre-proposal business object. Board/list mechanics mirror
// the existing Task board (todo.ts) exactly; the workspace/detail view
// mirrors the Project workspace (projects.ts) and reuses the same live-
// editable, autosaving pattern the Meeting detail page already established.
// Notes/Contacts are linked through the existing entity_links Work Graph,
// not new relationship fields — Meetings/Documents use a direct FK, same
// convention Project already uses for those two.
import { statusBadge } from '../lib/statusTone';
import { addMoney, fmtMoneyByCurrency, currentUser, matchesOwnerFilter, ownerFilterOptions, type MoneyByCurrency } from '../lib/commercial';
import { opportunityHealth } from '../lib/pipeline';
import { hasOpenWork } from '../lib/myday';
import { stampWaiting, waitingFromCommitments, type WaitingOn } from '../lib/commitments';
import { renderCommitmentSection } from './commitments';
import { openOutcomeDialog } from '../core/proposals';
import { S } from '../lib/state';
import { loadInto, toast } from '../lib/ui';
import { companyLink, recordLink } from '../lib/links';
import { fmtDate, escHtml, expose, nextNoteId, today, debounce, showConfirm, daysSince, daysUntil, companyRef, inCompany, sameCompany } from '../lib/utils';
import { registerTabRenderer, refreshAll, notifyNavigated } from '../lib/registry';
import { onChange, touches } from '../lib/changes';
import { registerDragSource, registerDropTarget } from '../lib/dnd';
import { renderRecordTimeline, renderThreadStrip } from './recordThread';
import { sinkEmptySections } from '../lib/sectionLayout';
import { createListNav } from '../lib/listNav';
import { getPipelineFacts, getOpportunities, getOpportunityActivity, getLinksFor, setLinksFrom, proposalFolderLookup, filesOpen } from '../lib/db';
import { getAllCompanies } from './companies';
import { openProjectModal } from './projects';
import { persistNotes, persistOpportunity, saveNotesNow } from '../lib/persist';
import { companyFromForm, contextFromOpportunity, opportunityTasks, type WorkContext } from '../lib/workGraph';
import { taskRowHtml } from './todo';
import { icon } from '../lib/icons';
import { showContextMenu, type ContextMenuItem } from '../lib/contextMenu';
import { attachCompanySelector } from '../lib/companySelector';
import { OPPORTUNITY_STAGES } from '../lib/types';
import type { Opportunity, Note } from '../lib/types';

let oppAutoSaveTimer: ReturnType<typeof setTimeout> | null = null;

async function loadOpportunities(): Promise<void> {
  const [opps, facts] = await Promise.all([getOpportunities(), getPipelineFacts().catch(() => S.pipelineFacts)]);
  S.opportunities = opps;
  S.pipelineFacts = facts;
}

async function renderOpportunitiesTab(): Promise<void> {
  if (!(await loadInto(document.getElementById('opp-board'), 'opportunities', 'renderTab(\'opportunities\')', loadOpportunities, 'cards'))) return;
  renderOpportunitiesList();
}
registerTabRenderer('opportunities', () => { void renderOpportunitiesTab(); });

createListNav<number>({
  tabId: 'opportunities',
  getItems: () => [...document.querySelectorAll<HTMLElement>('#opp-tbody tr[data-opp-id]')].map((el) => Number(el.dataset.oppId)),
  getEl: (id) => document.querySelector<HTMLElement>(`#opp-tbody tr[data-opp-id="${id}"]`),
  onOpen: (id) => { void openOpportunityDetail(id); },
});

function computeFilteredOpportunities(): Opportunity[] {
  const search = (document.getElementById('opp-search') as HTMLInputElement | null)?.value.trim().toLowerCase() || '';
  const stageFilter = (document.getElementById('opp-stage-filter') as HTMLSelectElement | null)?.value || '';
  const ownerSel = document.getElementById('opp-owner-filter') as HTMLSelectElement | null;
  const ownerFilter = ownerSel?.value || '';
  if (ownerSel) ownerSel.innerHTML = ownerFilterOptions(S.opportunities.map((o) => o.owner), ownerFilter);
  return S.opportunities.filter((o) => {
    if (stageFilter && o.stage !== stageFilter) return false;
    if (!matchesOwnerFilter(o, ownerFilter)) return false;
    if (search && !`${o.name} ${o.companyName || ''} ${o.owner || ''}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

export function setOpportunityView(v: 'board' | 'list'): void {
  S.opportunityView = v;
  renderOpportunitiesList();
}
expose('setOpportunityView', setOpportunityView);

export function opportunityFilterChanged(): void { renderOpportunitiesList(); }
expose('opportunityFilterChanged', opportunityFilterChanged);

// The stage-filter <select> above calls opportunityFilterChanged() directly
// (fires once, should stay instant); the search box debounces separately so
// typing doesn't re-filter/re-render on every keystroke.
const debouncedOppSearch = debounce(renderOpportunitiesList, 150);
export function opportunitySearchChanged(): void { debouncedOppSearch(); }
expose('opportunitySearchChanged', opportunitySearchChanged);

function renderOpportunitiesList(): void {
  const filtered = computeFilteredOpportunities();
  const cnt = document.getElementById('opp-cnt');
  if (cnt) cnt.textContent = `${filtered.length} opportunit${filtered.length === 1 ? 'y' : 'ies'}`;
  document.getElementById('opp-view-board')?.classList.toggle('active', S.opportunityView === 'board');
  document.getElementById('opp-view-list')?.classList.toggle('active', S.opportunityView === 'list');
  const boardEl = document.getElementById('opp-board');
  const listEl = document.getElementById('opp-list-table-wrap');
  if (boardEl) boardEl.style.display = S.opportunityView === 'board' ? '' : 'none';
  if (listEl) listEl.style.display = S.opportunityView === 'list' ? '' : 'none';
  if (S.opportunityView === 'board') renderOpportunityBoard(filtered); else renderOpportunityListTable(filtered);
}

// ── Board (kanban) ─────────────────────────────────────────────────

// Indicators none of the board/list/detail views had before — derived from
// data already loaded client-side (Opportunity.updatedAt as the "last
// activity" proxy, no extra fetch needed for these three; "days in stage"
// needs the activity log and is computed separately, see
// renderOpportunityActivity below, since only the detail page has that
// fetched already).
const STALLED_DAYS = 14;
const APPROACHING_CLOSE_DAYS = 7;
/** Health chips from real activity (pipeline facts), not the last edit. */
function indicatorChips(o: Opportunity): string {
  if (o.status !== 'Open') return '';
  const h = opportunityHealth(o, S.pipelineFacts.find((f) => f.opportunityId === o.id), today(), { openWork: hasOpenWork(o, S) });
  const d = h.waiting?.days;
  return [
    h.waiting?.on === 'them' ? `<span class="rec-badge tone-${d != null && d > 14 ? 'red' : 'amber'}" title="${escHtml(o.waitingNote || 'Waiting on the client')}">Waiting on client${d != null ? ` · ${d}d` : ''}</span>` : '',
    h.waiting?.on === 'us' ? `<span class="rec-badge tone-accent" title="${escHtml(o.waitingNote || 'The next move is ours')}">With us${d != null ? ` · ${d}d` : ''}</span>` : '',
    h.stalled ? `<span class="rec-badge tone-red" title="Last activity ${h.daysSinceActivity} days ago">Stalled</span>` : '',
    h.closeOverdue ? `<span class="rec-badge tone-red">Close date passed</span>` : '',
    h.noNextAction ? `<span class="rec-badge tone-amber">No next action</span>` : '',
    h.closingSoon ? `<span class="rec-badge tone-amber">Closing soon</span>` : '',
  ].filter(Boolean).join('');
}

function oppCardHtml(o: Opportunity): string {
  const value = o.estimatedValue ? `${o.currency || 'SAR'} ${Number(o.estimatedValue).toLocaleString()}` : '';
  const flags = indicatorChips(o);
  return `<div class="board-card" data-opp-id="${o.id}" data-drag-kind="opportunity" data-drag-id="${o.id}" onclick="openOpportunityDetail(${o.id})" oncontextmenu="opportunityContextMenu(event,${o.id})">
    <div class="board-card-title">${escHtml(o.name)}</div>
    <div class="board-card-meta">
      ${o.companyName ? companyLink(o.companyId, o.companyName, { chip: true }) : ''}
      ${value ? `<span class="board-card-value">${value}</span>` : ''}
      ${o.probability != null ? `<span class="board-card-sub">${o.probability}%</span>` : ''}
    </div>
    ${o.expectedCloseDate || o.owner ? `<div class="board-card-foot">${[o.expectedCloseDate ? `Close ${fmtDate(o.expectedCloseDate)}` : '', o.owner ? escHtml(o.owner) : ''].filter(Boolean).join(' · ')}</div>` : ''}
    ${flags ? `<div class="board-card-flags">${flags}</div>` : ''}
  </div>`;
}

function renderOpportunityBoard(filtered: Opportunity[]): void {
  const el = document.getElementById('opp-board');
  if (!el) return;
  // A stage with nothing in it is hidden rather than shown as an empty column,
  // so the board shows where the work actually is. Hidden columns stay in the
  // DOM (CSS hides them) so they reappear while a card is being dragged and can
  // still be dropped into.
  const hideEmpty = !showAllStages && filtered.length > 0;
  let hidden = 0;
  const columns = OPPORTUNITY_STAGES.map((stage) => {
    const items = filtered.filter((o) => o.stage === stage);
    const totals: MoneyByCurrency = {};
    items.forEach((o) => addMoney(totals, (o.currency || 'SAR').toUpperCase(), o.estimatedValue || null));
    const empty = hideEmpty && items.length === 0;
    if (empty) hidden += 1;
    return `<div class="board-column${empty ? ' stage-hidden' : ''}" data-stage="${stage}" data-drop="opp-stage" data-drop-value="${stage}">
      <div class="board-column-hd">${stage}<span class="board-column-count">${items.length}</span></div>
      ${Object.keys(totals).length ? `<div class="board-column-total">${fmtMoneyByCurrency(totals)}</div>` : ''}
      ${items.length === 0 ? `<div class="board-empty">No opportunities</div>` : items.map(oppCardHtml).join('')}
    </div>`;
  }).join('');
  const bar = hidden || showAllStages
    ? `<div class="board-stages-bar">
        <span>${hidden ? `${hidden} empty stage${hidden === 1 ? '' : 's'} hidden` : 'All stages shown'}</span>
        <button type="button" class="board-stages-btn" onclick="toggleAllStages()">${showAllStages ? 'Hide empty stages' : 'Show all stages'}</button>
      </div>`
    : '';
  el.innerHTML = bar + `<div class="board-columns opp-board">` + columns + `</div>`;
}

/** Empty stages are hidden by default; this shows them for the rest of the session. */
let showAllStages = false;

export function toggleAllStages(): void {
  showAllStages = !showAllStages;
  renderOpportunitiesList();
}
expose('toggleAllStages', toggleAllStages);

registerDragSource('opportunity');
registerDropTarget('opp-stage', {
  accepts: ['opportunity'],
  canDrop: ({ ids }, stage) => S.opportunities.find((x) => x.id === ids[0])?.stage !== stage,
  onDrop: ({ ids }, { value: stage }) => { void updateOpportunityStage(ids[0], stage); },
});

export async function changeCurrentOpportunityStage(stage: string): Promise<void> {
  if (S.currentOpportunityId == null) return;
  await updateOpportunityStage(S.currentOpportunityId, stage);
}
expose('changeCurrentOpportunityStage', changeCurrentOpportunityStage);

// Single choke point for saving an Opportunity row and keeping S.opportunities
// in sync — used by every write path below so the persist()/toast-on-failure
// wiring only lives in one place.
async function saveAndSyncOpportunity(o: Opportunity): Promise<Opportunity | undefined> {
  const saved = await persistOpportunity(o);
  if (saved) {
    const idx = S.opportunities.findIndex((x) => x.id === saved.id);
    if (idx > -1) S.opportunities[idx] = saved; else S.opportunities.push(saved);
  }
  return saved;
}

export async function updateOpportunityStage(id: number, stage: string, reason?: string | null): Promise<void> {
  const o = S.opportunities.find((x) => x.id === id);
  if (!o || o.stage === stage) return;
  if ((stage === 'Won' || stage === 'Lost') && reason === undefined) {
    openOutcomeDialog({
      mode: stage === 'Won' ? 'won' : 'lost',
      title: stage === 'Won' ? 'Opportunity won' : 'Opportunity lost',
      subtitle: `${o.name}${o.companyName ? ` — ${o.companyName}` : ''}`,
      withDate: false,
      onConfirm: ({ reason: r, note }) => { void updateOpportunityStage(id, stage, [r, note].filter(Boolean).join(' — ') || null); },
    });
    renderOpportunitiesList();
    if (S.currentOpportunityId === id) void renderOpportunityDetail();
    return;
  }
  const prevStage = o.stage;
  o.stage = stage;
  if (reason !== undefined) o.winLossReason = reason;
  const saved = await saveAndSyncOpportunity(o);
  if (!saved) { o.stage = prevStage; return; }
  renderOpportunitiesList();
  if (S.currentOpportunityId === id) await renderOpportunityDetail();
}
expose('updateOpportunityStage', updateOpportunityStage);

export function opportunityContextMenu(e: MouseEvent, id: number): void {
  const o = S.opportunities.find((x) => x.id === id);
  if (!o) return;
  const stageItems: ContextMenuItem[] = OPPORTUNITY_STAGES.filter((s) => s !== o.stage).map((s) => ({
    label: `Move to ${s}`, run: () => { void updateOpportunityStage(id, s); },
  }));
  showContextMenu(e, [
    { label: 'Open', iconName: 'briefcase', run: () => { void openOpportunityDetail(id); } },
    { label: 'Edit', iconName: 'edit', run: () => openOpportunityModal(id) },
    ...stageItems,
    { label: 'Archive', iconName: 'archive', danger: true, run: () => { S.currentOpportunityId = id; void archiveOpportunity(); } },
  ]);
}
expose('opportunityContextMenu', opportunityContextMenu);

// ── List view ─────────────────────────────────────────────────

function renderOpportunityListTable(filtered: Opportunity[]): void {
  const tbody = document.getElementById('opp-tbody');
  if (!tbody) return;
  if (filtered.length === 0) { tbody.innerHTML = `<tr><td colspan="7" class="empty">No opportunities match these filters — try adjusting or clearing them.</td></tr>`; return; }
  tbody.innerHTML = filtered.map((o) => {
    const stageOpts = OPPORTUNITY_STAGES.map((s) => `<option value="${s}" ${o.stage === s ? 'selected' : ''}>${s}</option>`).join('');
    const value = o.estimatedValue ? `${o.currency || 'SAR'} ${Number(o.estimatedValue).toLocaleString()}` : '—';
    const flags = indicatorChips(o);
    return `<tr class="rec-tr" data-opp-id="${o.id}" onclick="openOpportunityDetail(${o.id})" oncontextmenu="opportunityContextMenu(event,${o.id})">
      <td class="strong">${escHtml(o.name)}${flags ? `<div class="board-card-flags">${flags}</div>` : ''}</td>
      <td>${o.companyName ? companyLink(o.companyId, o.companyName) : '—'}</td>
      <td onclick="event.stopPropagation()"><select class="ssel" onchange="updateOpportunityStage(${o.id},this.value)">${stageOpts}</select></td>
      <td class="td-fee">${value}</td>
      <td>${o.probability != null ? `${o.probability}%` : '—'}</td>
      <td class="td-d">${o.expectedCloseDate ? fmtDate(o.expectedCloseDate) : '—'}</td>
      <td class="muted">${escHtml(o.owner || '—')}</td>
    </tr>`;
  }).join('');
}

// ── Create/Edit modal ─────────────────────────────────────────────────

/** Repopulates the create/edit modal's Contacts multi-select with whichever
 * contacts already belong to the typed company (matching `Contact.clientName`
 * — the same free-text join every other entity uses), pre-selecting any
 * already linked to the opportunity being edited. */
export async function refreshOppModalContacts(companyName: string): Promise<void> {
  const sel = document.getElementById('opp-contacts-sel') as HTMLSelectElement | null;
  if (!sel) return;
  const name = companyName.trim();
  const ref = name ? companyRef(name) : null;
  const candidates = ref ? S.contacts.filter((c) => inCompany(ref, c.companyId, c.clientName)) : [];
  let linkedIds: number[] = [];
  // Only the opportunity being edited has contacts to pre-select (not the one open behind a new-opportunity dialog).
  if (oppModalEditId != null) {
    const links = await getLinksFor('opportunity', oppModalEditId);
    linkedIds = links.filter((l) => l.fromType === 'contact' && l.toType === 'opportunity').map((l) => l.fromId);
  }
  sel.innerHTML = candidates.length > 0
    ? candidates.map((c) => `<option value="${c.id}" ${linkedIds.includes(c.id) ? 'selected' : ''}>${escHtml(c.name || '—')}${c.role ? ` (${escHtml(c.role)})` : ''}</option>`).join('')
    : `<option value="" disabled>${name ? 'No contacts for this company yet' : 'Type a company to see its contacts'}</option>`;
}
expose('refreshOppModalContacts', refreshOppModalContacts);

/** For a new opportunity: the company it was started from. */
let oppModalContext: WorkContext | null = null;
let oppModalEditId: number | null = null;

export function openOpportunityModal(id: number | null, ctx: WorkContext | null = null): void {
  // A new opportunity leaves the open one (if any) as it is.
  if (id !== null) S.currentOpportunityId = id;
  oppModalEditId = id;
  oppModalContext = id === null ? ctx : null;
  const f = document.getElementById('opportunity-form') as HTMLFormElement;
  f.reset();
  const companyInput = f.elements.namedItem('oppCompany') as HTMLInputElement | null;
  if (companyInput) attachCompanySelector(companyInput);
  const stageSel = f.elements.namedItem('oppStage') as HTMLSelectElement;
  stageSel.innerHTML = OPPORTUNITY_STAGES.map((s) => `<option value="${s}">${s}</option>`).join('');

  if (id !== null) {
    const o = S.opportunities.find((x) => x.id === id);
    if (!o) return;
    (document.getElementById('opp-modal-title') as HTMLElement).textContent = 'Edit opportunity';
    (document.getElementById('opp-submit-btn') as HTMLElement).textContent = 'Save changes';
    (f.elements.namedItem('oppName') as HTMLInputElement).value = o.name;
    (f.elements.namedItem('oppCompany') as HTMLInputElement).value = o.companyName || '';
    stageSel.value = o.stage;
    (f.elements.namedItem('oppOwner') as HTMLInputElement).value = o.owner || '';
    (f.elements.namedItem('oppValue') as HTMLInputElement).value = o.estimatedValue != null ? String(o.estimatedValue) : '';
    (f.elements.namedItem('oppProbability') as HTMLInputElement).value = o.probability != null ? String(o.probability) : '';
    (f.elements.namedItem('oppCloseDate') as HTMLInputElement).value = o.expectedCloseDate || '';
    (f.elements.namedItem('oppDescription') as HTMLTextAreaElement).value = o.description || '';
    void refreshOppModalContacts(o.companyName || '');
  } else {
    (f.elements.namedItem('oppCompany') as HTMLInputElement).value = ctx?.companyName || '';
    void refreshOppModalContacts(ctx?.companyName || '');
    (document.getElementById('opp-modal-title') as HTMLElement).textContent = 'New opportunity';
    (document.getElementById('opp-submit-btn') as HTMLElement).textContent = 'Create opportunity';
    stageSel.value = 'Lead';
    (f.elements.namedItem('oppOwner') as HTMLInputElement).value = currentUser()?.name || '';
  }
  document.getElementById('modal-opportunity')?.classList.add('open');
}
expose('openOpportunityModal', openOpportunityModal);

export function closeOpportunityModal(): void {
  document.getElementById('modal-opportunity')?.classList.remove('open');
}
expose('closeOpportunityModal', closeOpportunityModal);

export async function submitOpportunity(e: Event): Promise<void> {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  const name = (f.elements.namedItem('oppName') as HTMLInputElement).value.trim();
  if (!name) return;
  const existing = oppModalEditId != null ? S.opportunities.find((x) => x.id === oppModalEditId) : null;
  const known = existing ? { companyId: existing.companyId, companyName: existing.companyName } : oppModalContext;
  const company = companyFromForm(known, (f.elements.namedItem('oppCompany') as HTMLInputElement).value);
  const valueEl = f.elements.namedItem('oppValue') as HTMLInputElement;
  const probEl = f.elements.namedItem('oppProbability') as HTMLInputElement;

  const draft: Opportunity = {
    id: existing?.id ?? 0,
    name,
    companyId: company.companyId,
    companyName: company.companyName,
    owner: (f.elements.namedItem('oppOwner') as HTMLInputElement).value.trim() || null,
    stage: (f.elements.namedItem('oppStage') as HTMLSelectElement).value,
    status: existing?.status ?? 'Open',
    estimatedValue: valueEl.value ? +valueEl.value : null,
    currency: existing?.currency ?? 'SAR',
    probability: probEl.value ? +probEl.value : null,
    expectedCloseDate: (f.elements.namedItem('oppCloseDate') as HTMLInputElement).value || null,
    description: (f.elements.namedItem('oppDescription') as HTMLTextAreaElement).value.trim() || null,
    nextAction: existing?.nextAction ?? null,
    proposalId: existing?.proposalId ?? null,
    projectId: existing?.projectId ?? null,
    sortOrder: existing?.sortOrder ?? null,
    archived: existing?.archived ?? false,
    createdAt: existing?.createdAt ?? null,
    updatedAt: null,
    tags: existing?.tags ?? [],
  };

  const saved = await saveAndSyncOpportunity(draft);
  if (!saved) return;

  const contactsSel = f.elements.namedItem('oppContacts') as HTMLSelectElement;
  const selectedContactIds = [...contactsSel.selectedOptions].map((opt) => +opt.value).filter((id) => !isNaN(id));
  for (const contactId of selectedContactIds) {
    await setLinksFrom('contact', contactId, [{ fromType: 'contact', fromId: contactId, toType: 'opportunity', toId: saved.id }]);
  }

  closeOpportunityModal();
  renderOpportunitiesList();
  refreshAll();
  // Through the router, so it opens in Opportunities from wherever it was created.
  (window as any).openRecord('opportunity', saved.id);
}
expose('submitOpportunity', submitOpportunity);

// ── Workspace / detail view ─────────────────────────────────────────────────

export async function openOpportunityDetail(id: number): Promise<void> {
  const o = S.opportunities.find((x) => x.id === id);
  // A deleted opportunity (an old link or history entry) must not leave the
  // page showing the previous one under a missing id: go to the list instead.
  if (!o) { if (S.currentOpportunityId != null) closeOpportunityDetail(); return; }
  S.currentOpportunityId = id;
  document.getElementById('opp-list-view')?.classList.add('hidden');
  document.getElementById('opp-detail')?.classList.add('open');
  notifyNavigated();
  await renderOpportunityDetail();
}
expose('openOpportunityDetail', openOpportunityDetail);

export function closeOpportunityDetail(): void {
  S.currentOpportunityId = null;
  document.getElementById('opp-detail')?.classList.remove('open');
  document.getElementById('opp-list-view')?.classList.remove('hidden');
  notifyNavigated();
}
expose('closeOpportunityDetail', closeOpportunityDetail);

function currentOpportunity(): Opportunity | undefined {
  if (S.currentOpportunityId == null) return undefined;
  return S.opportunities.find((x) => x.id === S.currentOpportunityId);
}

async function renderOpportunityDetail(): Promise<void> {
  const o = currentOpportunity();
  if (!o) { closeOpportunityDetail(); return; }

  (document.getElementById('od-name') as HTMLElement).textContent = o.name;
  (document.getElementById('od-badges') as HTMLElement).innerHTML = [
    // One lifecycle badge: the stage, coloured by the outcome it means (the status is derived from the stage).
    statusBadge('opportunity', o.status, o.stage),
    indicatorChips(o),
    o.winLossReason && (o.stage === 'Won' || o.stage === 'Lost') ? `<span class="rec-meta">${escHtml(o.winLossReason)}</span>` : '',
  ].filter(Boolean).join('');

  const odCompanyInput = document.getElementById('od-company-inp') as HTMLInputElement;
  odCompanyInput.value = o.companyName || '';
  attachCompanySelector(odCompanyInput);
  const stageSel = document.getElementById('od-stage-sel') as HTMLSelectElement;
  stageSel.innerHTML = OPPORTUNITY_STAGES.map((s) => `<option value="${s}" ${o.stage === s ? 'selected' : ''}>${s}</option>`).join('');
  (document.getElementById('od-owner-inp') as HTMLInputElement).value = o.owner || '';
  (document.getElementById('od-value-inp') as HTMLInputElement).value = o.estimatedValue != null ? String(o.estimatedValue) : '';
  (document.getElementById('od-probability-inp') as HTMLInputElement).value = o.probability != null ? String(o.probability) : '';
  (document.getElementById('od-close-date-inp') as HTMLInputElement).value = o.expectedCloseDate || '';
  (document.getElementById('od-description') as HTMLTextAreaElement).value = o.description || '';
  (document.getElementById('od-next-action') as HTMLTextAreaElement).value = o.nextAction || '';

  renderThreadStrip('od-thread', { kind: 'opportunity', id: o.id });
  renderOpportunityNextAction(o);
  await renderOpportunityContacts(o);
  await renderOpportunityNotes(o.id);
  renderOpportunityMeetings(o.id);
  renderOpportunityTasks(o.id);
  renderCommitmentSection('od-commitments', { opportunityId: o.id }, contextFromOpportunity(S, o));
  renderOpportunityWaiting(o);
  (window as any).fillTeamNames?.();
  await Promise.all([renderOpportunityFiles(o), renderOpportunityActivity(o.id)]);
  if (S.currentOpportunityId === o.id) layoutOpportunitySections();
}

/** Sections with nothing in them collapse and sink below the ones that have
 * content; Description and Next action stay first, the timeline last. */
function layoutOpportunitySections(): void {
  const host = document.getElementById('od-main');
  if (!host) return;
  const el = (id: string) => document.getElementById(id);
  sinkEmptySections(host, ['od-tasks', 'od-meetings', 'od-commitments', 'od-contacts', 'od-notes', 'od-files'].map(el), el('od-activity'));
}

/** The next open task, as a link; the free-text box only when there is none. */
function renderOpportunityNextAction(o: Opportunity): void {
  const box = document.getElementById('od-next-task');
  const text = document.getElementById('od-next-action') as HTMLTextAreaElement | null;
  if (!box || !text) return;
  const open = opportunityTasks(S, o.id).filter((t) => t.status !== 'Done' && t.parentId == null)
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const t = open[0];
  text.hidden = !!t;
  box.innerHTML = t
    ? `<div class="rec-row od-next-row" onclick="openRecord('task', ${t.id})">
        <span class="rec-row-icon">${icon('check', 15)}</span>
        <div class="rec-row-main"><div class="rec-row-title"><a href="#" class="rlink" onclick="event.preventDefault()">${escHtml(t.title)}</a></div>
          <div class="rec-row-sub">${[t.owner, open.length > 1 ? `${open.length - 1} more open` : ''].filter(Boolean).map((x) => escHtml(x!)).join(' · ')}</div></div>
        <span class="rec-row-date${t.dueDate && t.dueDate < today() ? ' is-overdue' : ''}">${t.dueDate ? fmtDate(t.dueDate) : 'No date'}</span>
      </div>`
    : '';
}

// ── Waiting on ──────────────────────────────────────────────────────────────

/** Us / Them / —, since when, and what for. When the client has an open
 * promise and nothing is set, it's offered as a suggestion — never set by itself. */
function renderOpportunityWaiting(o: Opportunity): void {
  const el = document.getElementById('od-waiting');
  if (!el) return;
  const cur = o.waitingOn ?? null;
  const seg = ([['us', 'Us'], ['them', 'Them'], ['', '—']] as const).map(([v, label]) =>
    `<button class="${(cur ?? '') === v ? 'active' : ''}" onclick="setOpportunityWaiting('${v}')">${label}</button>`).join('');
  const suggestion = !cur ? waitingFromCommitments(S.commitments.filter((c) => c.opportunityId === o.id)) : null;
  const promised = suggestion ? S.commitments.find((c) => c.id === suggestion.commitmentId) : undefined;
  el.innerHTML = `<div class="segmented od-wait-seg" role="group" aria-label="Waiting on">${seg}</div>
    ${cur && o.waitingSince ? `<div class="od-wait-since">since ${escHtml(fmtDate(o.waitingSince))}</div>` : ''}
    ${cur ? `<textarea class="td-input od-wait-note" rows="1" placeholder="What for?" title="${escHtml(o.waitingNote || '')}" oninput="autoGrow(this)" onchange="setOpportunityWaitingNote(this.value)">${escHtml(o.waitingNote || '')}</textarea>` : ''}
    ${suggestion && promised ? `<div class="od-wait-suggest">The client promised “${escHtml(promised.text)}” on ${escHtml(fmtDate(suggestion.since))}.
      <button class="btn-ghost btn-sm" onclick="acceptWaitingSuggestion()">Waiting on them since then</button></div>` : ''}`;
  const note = el.querySelector<HTMLTextAreaElement>('.od-wait-note');
  if (note) (window as any).autoGrow?.(note);
}

export function setOpportunityWaiting(value: string): void {
  const o = currentOpportunity();
  if (!o) return;
  Object.assign(o, stampWaiting(o, (value || null) as WaitingOn | null, today()));
  if (!o.waitingOn) o.waitingNote = null;
  void saveAndSyncOpportunity(o).then(() => { void renderOpportunityDetail(); renderOpportunitiesList(); });
}
expose('setOpportunityWaiting', setOpportunityWaiting);

export function setOpportunityWaitingNote(value: string): void {
  const o = currentOpportunity();
  if (!o) return;
  o.waitingNote = value.replace(/\s*\n\s*/g, ' ').trim() || null;
  const note = document.querySelector<HTMLTextAreaElement>('#od-waiting .od-wait-note');
  if (note) note.title = o.waitingNote || '';
  void saveAndSyncOpportunity(o);
}
expose('setOpportunityWaitingNote', setOpportunityWaitingNote);

export function acceptWaitingSuggestion(): void {
  const o = currentOpportunity();
  if (!o) return;
  const s = waitingFromCommitments(S.commitments.filter((c) => c.opportunityId === o.id));
  if (!s) return;
  const promised = S.commitments.find((c) => c.id === s.commitmentId);
  o.waitingOn = 'them';
  o.waitingSince = s.since;
  o.waitingNote = promised?.text ?? null;
  void saveAndSyncOpportunity(o).then(() => { void renderOpportunityDetail(); renderOpportunitiesList(); });
}
expose('acceptWaitingSuggestion', acceptWaitingSuggestion);

function debounceOppSave(fn: () => void): void {
  if (oppAutoSaveTimer) clearTimeout(oppAutoSaveTimer);
  oppAutoSaveTimer = setTimeout(fn, 500);
}

type OppTextField = 'description' | 'nextAction' | 'owner' | 'companyName' | 'expectedCloseDate';

export function autoSaveOpportunityField(field: OppTextField, value: string): void {
  const o = currentOpportunity();
  if (!o) return;
  o[field] = value.trim() || null;
  debounceOppSave(() => { void saveAndSyncOpportunity(o); });
}
expose('autoSaveOpportunityField', autoSaveOpportunityField);

export function autoSaveOpportunityNumber(field: 'estimatedValue' | 'probability', value: string): void {
  const o = currentOpportunity();
  if (!o) return;
  o[field] = value ? +value : null;
  debounceOppSave(() => { void saveAndSyncOpportunity(o); });
}
expose('autoSaveOpportunityNumber', autoSaveOpportunityNumber);

// ── Contacts (linked via entity_links, contact → opportunity) ───────────

async function renderOpportunityContacts(o: Opportunity): Promise<void> {
  const el = document.getElementById('od-contacts');
  if (!el) return;
  const links = await getLinksFor('opportunity', o.id);
  if (S.currentOpportunityId !== o.id) return;
  const contactIds = links.filter((l) => l.fromType === 'contact' && l.toType === 'opportunity').map((l) => l.fromId);
  const linked = S.contacts.filter((c) => contactIds.includes(c.id));
  const candidates = o.companyName ? S.contacts.filter((c) => sameCompany(c.companyId, c.clientName, o.companyId, o.companyName) && !contactIds.includes(c.id)) : [];
  el.innerHTML = `<div class="rec-section-hd"><h2>Contacts</h2><span class="rec-count">${linked.length || ''}</span></div>` +
    (linked.length === 0
      ? `<div class="feed-empty">No contacts linked yet.</div>`
      : `<div class="rec-list">${linked.map((c) => `<div class="rec-row" onclick="openRecord('contact', ${c.id})">
          <span class="rec-row-icon">${icon('people', 15)}</span>
          <div class="rec-row-main"><div class="rec-row-title">${recordLink('contact', c.id, c.name || 'Unnamed contact')}</div><div class="rec-row-sub">${escHtml(c.role || c.email || '')}</div></div>
          <button class="rec-icon-btn" title="Remove from this opportunity" aria-label="Remove" onclick="event.stopPropagation();removeOpportunityContact(${c.id})">${icon('close', 13)}</button>
        </div>`).join('')}</div>`) +
    (candidates.length > 0 ? `<select class="td-select rec-add-select" onchange="if(this.value)addOpportunityContact(+this.value);this.value=''"><option value="">+ Link a contact from ${escHtml(o.companyName || 'this company')}…</option>${candidates.map((c) => `<option value="${c.id}">${escHtml(c.name || '—')}</option>`).join('')}</select>` : '');
}

export async function addOpportunityContact(contactId: number): Promise<void> {
  if (S.currentOpportunityId == null) return;
  await setLinksFrom('contact', contactId, [{ fromType: 'contact', fromId: contactId, toType: 'opportunity', toId: S.currentOpportunityId }]);
  await renderOpportunityDetail();
}
expose('addOpportunityContact', addOpportunityContact);

export async function removeOpportunityContact(contactId: number): Promise<void> {
  await setLinksFrom('contact', contactId, []);
  await renderOpportunityDetail();
}
expose('removeOpportunityContact', removeOpportunityContact);

// ── Notes (linked via entity_links, note → opportunity — same convention as Note → Project) ───

async function renderOpportunityNotes(oppId: number): Promise<void> {
  const el = document.getElementById('od-notes');
  if (!el) return;
  const links = await getLinksFor('opportunity', oppId);
  if (S.currentOpportunityId !== oppId) return;
  const noteIds = links.filter((l) => l.fromType === 'note' && l.toType === 'opportunity').map((l) => l.fromId);
  const notes = S.notes.filter((n) => noteIds.includes(n.id));
  el.innerHTML = `<div class="rec-section-hd"><h2>Notes</h2><span class="rec-count">${notes.length || ''}</span><div class="rec-section-actions"><button class="btn-secondary btn-sm" onclick="createNoteForOpportunity()">+ New</button></div></div>` +
    (notes.length === 0
      ? `<div class="feed-empty">No notes yet.</div>`
      : `<div class="rec-list">${notes.map((n) => `<div class="rec-row" onclick="openRecord('note', ${n.id})">
          <span class="rec-row-icon">${icon('note', 15)}</span>
          <div class="rec-row-main"><div class="rec-row-title">${escHtml(n.title || 'Untitled')}</div></div>
          <span class="rec-row-date">${n.updatedAt ? fmtDate(n.updatedAt) : ''}</span>
        </div>`).join('')}</div>`);
}

export async function createNoteForOpportunity(): Promise<void> {
  const o = currentOpportunity();
  if (!o) return;
  const ctx = contextFromOpportunity(S, o);
  const newNote: Note = {
    id: nextNoteId(), title: o.name, content: '', folder: '', clientName: ctx.companyName || '', companyId: ctx.companyId,
    tags: [], pinned: false, createdAt: today(), updatedAt: today(),
  };
  S.notes.unshift(newNote);
  persistNotes();
  await saveNotesNow();
  await setLinksFrom('note', newNote.id, [{ fromType: 'note', fromId: newNote.id, toType: 'opportunity', toId: o.id }]);
  (window as any).openRecord('note', newNote.id);
}
expose('createNoteForOpportunity', createNoteForOpportunity);

// ── Meetings / Documents (direct opportunityId FK, same convention as projectId) ───

function renderOpportunityMeetings(oppId: number): void {
  const el = document.getElementById('od-meetings');
  if (!el) return;
  const meetings = S.meetings.filter((m) => m.opportunityId === oppId);
  el.innerHTML = `<div class="rec-section-hd"><h2>Meetings</h2><span class="rec-count">${meetings.length || ''}</span><div class="rec-section-actions"><button class="btn-secondary btn-sm" onclick="createMeetingForOpportunity()">+ New</button></div></div>` +
    (meetings.length === 0
      ? `<div class="feed-empty">No meetings yet.</div>`
      : `<div class="rec-list">${meetings.map((m) => `<div class="rec-row" onclick="openRecord('meeting', ${m.id})">
          <span class="rec-row-icon">${icon('meeting', 15)}</span>
          <div class="rec-row-main"><div class="rec-row-title">${escHtml(m.title)}</div></div>
          <span class="rec-row-date">${m.meetingDate ? fmtDate(m.meetingDate) : ''}</span>
        </div>`).join('')}</div>`);
}

// Tasks and meetings saved anywhere (a task completed in this section, a
// meeting created from here) show on the open opportunity straight away.
onChange((changes) => {
  const id = S.currentOpportunityId;
  if (id == null || !document.getElementById('opp-detail')?.classList.contains('open')) return;
  const o = S.opportunities.find((x) => x.id === id);
  if (touches(changes, 'task')) { renderOpportunityTasks(id); if (o) renderOpportunityNextAction(o); }
  if (touches(changes, 'meeting')) renderOpportunityMeetings(id);
  if (touches(changes, 'task') || touches(changes, 'meeting')) layoutOpportunitySections();
});

/** Tasks for the opportunity: linked to it directly or from one of its meetings. */
function renderOpportunityTasks(oppId: number): void {
  const el = document.getElementById('od-tasks');
  if (!el) return;
  const tasks = opportunityTasks(S, oppId).filter((t) => t.parentId == null)
    .sort((a, b) => Number(a.status === 'Done') - Number(b.status === 'Done') || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const open = tasks.filter((t) => t.status !== 'Done').length;
  el.innerHTML = `<div class="rec-section-hd"><h2>Tasks</h2><span class="rec-count">${open || ''}</span><div class="rec-section-actions"><button class="btn-secondary btn-sm" onclick="createTodoForOpportunity()">+ New</button></div></div>` +
    (tasks.length === 0 ? `<div class="feed-empty">No tasks yet.</div>` : `<div class="task-group">${tasks.map((t) => taskRowHtml(t, { compact: true })).join('')}</div>`);
}

// ── Creating the next record (the thread strip's next step) ─────────────────

export function createProposalForOpportunity(id?: number): void {
  const o = id != null ? S.opportunities.find((x) => x.id === id) : currentOpportunity();
  if (!o) return;
  (window as any).openProposalBuilder?.({ client: o.companyName || o.name, opportunityId: o.id, currency: o.currency, businessEntityId: o.businessEntityId ?? null });
}
expose('createProposalForOpportunity', createProposalForOpportunity);

export function createProjectForOpportunity(id?: number): void {
  const o = id != null ? S.opportunities.find((x) => x.id === id) : currentOpportunity();
  if (!o) return;
  S.opportunityLinkPending = o.id;
  S.opportunityLinkPendingKind = 'project';
  openProjectModal(null);
  setTimeout(() => {
    const nameEl = document.querySelector('#project-form [name=pjName]') as HTMLInputElement | null;
    if (nameEl) nameEl.value = o.name;
    const typeEl = document.querySelector('#project-form [name=pjType]') as HTMLSelectElement | null;
    if (typeEl) { typeEl.value = o.companyName ? 'client' : 'internal'; typeEl.dispatchEvent(new Event('change')); }
    const companyEl = document.querySelector('#project-form [name=pjCompany]') as HTMLInputElement | null;
    if (companyEl && o.companyName) companyEl.value = o.companyName;
  }, 0);
}
expose('createProjectForOpportunity', createProjectForOpportunity);

// ── Timeline (replaces Activity) ────────────────────────────

const ACTIVITY_LABEL: Record<string, string> = {
  created: 'Opportunity created', stage_changed: 'Stage changed',
  proposal_linked: 'Proposal linked', project_created: 'Project linked',
};

async function renderOpportunityActivity(oppId: number): Promise<void> {
  const el = document.getElementById('od-activity');
  if (!el) return;
  const activity = await getOpportunityActivity(oppId);
  if (S.currentOpportunityId !== oppId) return;
  await renderRecordTimeline({ elId: 'od-activity', record: { kind: 'opportunity', id: oppId }, scopeToggle: true,
    header: '<button class="btn-secondary btn-sm" onclick="createNoteForOpportunity()">+ Log note</button>' });

  // "Days in stage" needs the activity log (to find when the current stage
  // was entered) — appended to the badges row here, once this fetch
  // resolves, rather than duplicating the fetch in the synchronous badges
  // render above.
  const stageStart = activity.find((a) => a.kind === 'stage_changed')?.createdAt
    ?? activity.find((a) => a.kind === 'created')?.createdAt
    ?? null;
  const daysInStage = daysSince(stageStart ? stageStart.slice(0, 10) : null);
  const badgesEl = document.getElementById('od-badges');
  if (badgesEl && daysInStage != null) {
    const span = document.createElement('span');
    span.className = 'rec-meta';
    span.textContent = daysInStage <= 0 ? 'Entered this stage today' : `${daysInStage} day${daysInStage === 1 ? '' : 's'} in this stage`;
    badgesEl.appendChild(span);
  }
}

// ── Archive ─────────────────────────────────────────────────

export async function editCurrentOpportunity(): Promise<void> {
  if (S.currentOpportunityId != null) openOpportunityModal(S.currentOpportunityId);
}
expose('editCurrentOpportunity', editCurrentOpportunity);

export async function archiveOpportunity(): Promise<void> {
  const o = currentOpportunity();
  if (!o || !(await showConfirm(`Archive "${o.name}"? It will no longer appear in the pipeline.`, { confirmLabel: 'Archive' }))) return;
  o.archived = true;
  const saved = await persistOpportunity(o);
  if (!saved) { o.archived = false; return; }
  S.opportunities = S.opportunities.filter((x) => x.id !== o.id);
  closeOpportunityDetail();
  renderOpportunitiesList();
  refreshAll();
}
expose('archiveOpportunity', archiveOpportunity);

// ── Duplicate ─────────────────────────────────────────────────

/** A copy to work a similar deal (another service, another site) — open, unlinked. */
export async function duplicateOpportunity(id: number): Promise<void> {
  const o = S.opportunities.find((x) => x.id === id);
  if (!o) return;
  const saved = await saveAndSyncOpportunity({
    ...o, id: 0, name: `${o.name} (copy)`, status: 'Open', stage: o.stage === 'Won' || o.stage === 'Lost' ? 'Lead' : o.stage,
    proposalId: null, projectId: null, winLossReason: null, sortOrder: null, archived: false, createdAt: null, updatedAt: null, tags: [...(o.tags || [])],
  });
  if (!saved) return;
  (window as any).openRecord('opportunity', saved.id);
  toast('Duplicated — rename it and adjust the details');
}
expose('duplicateOpportunity', duplicateOpportunity);

export function opportunityMoreMenu(e: MouseEvent): void {
  const id = S.currentOpportunityId;
  if (id == null) return;
  showContextMenu(e, [
    { label: 'Duplicate', iconName: 'copy', run: () => { void duplicateOpportunity(id); } },
    { label: 'Archive', iconName: 'archive', danger: true, run: () => { void archiveOpportunity(); } },
  ]);
}
expose('opportunityMoreMenu', opportunityMoreMenu);

// ── Files ─────────────────────────────────────────────────────

/** The client's proposal folder and the linked proposal's documents. */
async function renderOpportunityFiles(o: Opportunity): Promise<void> {
  const el = document.getElementById('od-files');
  if (!el) return;
  const proposal = o.proposalId != null ? S.proposals.find((p) => p.id === o.proposalId) : undefined;
  const client = o.companyName || proposal?.client || '';
  const docs = proposal?.documents || [];
  const folder = client ? await proposalFolderLookup(client, proposal?.folderPath ?? null).catch(() => null) : null;
  if (S.currentOpportunityId !== o.id) return;
  const files = (folder?.files || []).filter((f) => !f.isFolder).sort((a, b) => (b.modifiedAt || '').localeCompare(a.modifiedAt || '')).slice(0, 8);
  const attr = (v: string) => escHtml(v).replace(/'/g, "\\'");
  const row = (name: string, path: string | null, sub: string) => `<div class="rec-row" ${path ? `onclick="oppOpenFile('${attr(path)}')"` : ''}>
    <span class="rec-row-icon">${icon('document', 15)}</span>
    <div class="rec-row-main"><div class="rec-row-title">${escHtml(name)}</div><div class="rec-row-sub">${escHtml(sub)}</div></div>
    ${path ? `<div class="rec-row-actions"><button class="rec-icon-btn" onclick="event.stopPropagation();filesRevealInFinderClick('${attr(path)}')" title="Show in Finder" aria-label="Show in Finder">${icon('folder', 13)}</button></div>` : ''}
  </div>`;
  const docRows = docs.map((d) => row(d.fileName, d.path, `${d.kind === 'proposal' ? 'Proposal' : d.kind === 'commercials' ? 'Commercials' : 'Supporting document'}${d.version ? ` · V${d.version}` : ''}`));
  const docPaths = new Set(docs.map((d) => d.path));
  const folderRows = files.filter((f) => !docPaths.has(f.path)).map((f) => row(f.name, f.path, f.modifiedAt ? `Modified ${fmtDate(f.modifiedAt.slice(0, 10))}` : 'In the client folder'));
  el.innerHTML = `<div class="rec-section-hd"><h2>Files</h2><span class="rec-count">${docRows.length + folderRows.length || ''}</span>
      <div class="rec-section-actions">${folder?.exists && folder.path ? `<button class="btn-secondary btn-sm" onclick="msFilesNavigateToPath('${attr(folder.path)}');navToModule('files')">Open client folder</button>` : ''}</div></div>
    ${docRows.length + folderRows.length
      ? `<div class="rec-list">${[...docRows, ...folderRows].join('')}</div>`
      : `<div class="feed-empty">${client ? (folder?.exists ? 'The client folder is empty.' : `No folder for ${escHtml(client)} under Proposals yet.`) : 'Set the company to see its proposal folder.'}</div>`}`;
}

export function oppOpenFile(path: string): void {
  void filesOpen(path).catch((e) => toast('Could not open the file', { tone: 'error', detail: String(e) }));
}
expose('oppOpenFile', oppOpenFile);
