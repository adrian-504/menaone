// Opportunities / Pipeline (Core Refinement & Product Maturity, Stage 2) —
// the first-class pre-proposal business object. Board/list mechanics mirror
// the existing Task board (todo.ts) exactly; the workspace/detail view
// mirrors the Project workspace (projects.ts) and reuses the same live-
// editable, autosaving pattern the Meeting detail page already established.
// Notes/Contacts are linked through the existing entity_links Work Graph,
// not new relationship fields — Meetings/Documents use a direct FK, same
// convention Project already uses for those two.
import { addMoney, fmtMoneyByCurrency, type MoneyByCurrency } from '../lib/commercial';
import { opportunityHealth } from '../lib/pipeline';
import { openOutcomeDialog } from '../core/proposals';
import { S } from '../lib/state';
import { skeleton, toast } from '../lib/ui';
import { companyLink, recordLink } from '../lib/links';
import { fmtDate, escHtml, expose, nextNoteId, today, debounce, showConfirm, daysSince, daysUntil, companyRef, inCompany, sameCompany } from '../lib/utils';
import { registerTabRenderer, refreshAll, notifyNavigated } from '../lib/registry';
import { registerDragSource, registerDropTarget } from '../lib/dnd';
import { activityItem, renderFeed } from '../lib/activityFeed';
import { createListNav } from '../lib/listNav';
import { getPipelineFacts, getOpportunities, getOpportunityActivity, getLinksFor, setLinksFrom, getActivity, proposalFolderLookup, filesOpen } from '../lib/db';
import { getAllCompanies } from './companies';
import { openProjectModal } from './projects';
import { persistNotes, persistOpportunity } from '../lib/persist';
import { switchTab } from '../core/nav';
import { openNote } from './notes';
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
  const board = document.getElementById('opp-board');
  if (board && !board.childElementCount) board.innerHTML = skeleton(3, 'cards');
  await loadOpportunities();
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
  return S.opportunities.filter((o) => {
    if (stageFilter && o.stage !== stageFilter) return false;
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
  const h = opportunityHealth(o, S.pipelineFacts.find((f) => f.opportunityId === o.id), today());
  return [
    h.daysSinceActivity != null && h.daysSinceActivity > 14 ? `<span class="rec-badge tone-red" title="Last activity ${h.daysSinceActivity} days ago">Stalled</span>` : '',
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
  el.innerHTML = `<div class="board-columns opp-board">` + OPPORTUNITY_STAGES.map((stage) => {
    const items = filtered.filter((o) => o.stage === stage);
    const totals: MoneyByCurrency = {};
    items.forEach((o) => addMoney(totals, (o.currency || 'SAR').toUpperCase(), o.estimatedValue || null));
    return `<div class="board-column" data-stage="${stage}" data-drop="opp-stage" data-drop-value="${stage}">
      <div class="board-column-hd">${stage}<span class="board-column-count">${items.length}</span></div>
      ${Object.keys(totals).length ? `<div class="board-column-total">${fmtMoneyByCurrency(totals)}</div>` : ''}
      ${items.length === 0 ? `<div class="board-empty">No opportunities</div>` : items.map(oppCardHtml).join('')}
    </div>`;
  }).join('') + `</div>`;
}

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
  if (S.currentOpportunityId != null) {
    const links = await getLinksFor('opportunity', S.currentOpportunityId);
    linkedIds = links.filter((l) => l.fromType === 'contact' && l.toType === 'opportunity').map((l) => l.fromId);
  }
  sel.innerHTML = candidates.length > 0
    ? candidates.map((c) => `<option value="${c.id}" ${linkedIds.includes(c.id) ? 'selected' : ''}>${escHtml(c.name || '—')}${c.role ? ` (${escHtml(c.role)})` : ''}</option>`).join('')
    : `<option value="" disabled>${name ? 'No contacts for this company yet' : 'Type a company to see its contacts'}</option>`;
}
expose('refreshOppModalContacts', refreshOppModalContacts);

export function openOpportunityModal(id: number | null): void {
  S.currentOpportunityId = id;
  const f = document.getElementById('opportunity-form') as HTMLFormElement;
  f.reset();
  const dl = document.getElementById('opp-company-list'); if (dl) dl.innerHTML = getAllCompanies().map((c) => `<option value="${escHtml(c)}">`).join('');
  const companyInput = f.elements.namedItem('oppCompany') as HTMLInputElement | null;
  if (companyInput) attachCompanySelector(companyInput);
  const stageSel = f.elements.namedItem('oppStage') as HTMLSelectElement;
  stageSel.innerHTML = OPPORTUNITY_STAGES.map((s) => `<option value="${s}">${s}</option>`).join('');

  if (id !== null) {
    const o = S.opportunities.find((x) => x.id === id);
    if (!o) return;
    (document.getElementById('opp-modal-title') as HTMLElement).textContent = 'Edit Opportunity';
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
    void refreshOppModalContacts('');
    (document.getElementById('opp-modal-title') as HTMLElement).textContent = 'New Opportunity';
    stageSel.value = 'Lead';
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
  const existing = S.currentOpportunityId != null ? S.opportunities.find((x) => x.id === S.currentOpportunityId) : null;
  const valueEl = f.elements.namedItem('oppValue') as HTMLInputElement;
  const probEl = f.elements.namedItem('oppProbability') as HTMLInputElement;

  const draft: Opportunity = {
    id: existing?.id ?? 0,
    name,
    companyId: null,
    companyName: (f.elements.namedItem('oppCompany') as HTMLInputElement).value.trim() || null,
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
  await openOpportunityDetail(saved.id);
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
    `<span class="rec-badge tone-accent">${escHtml(o.stage)}</span>`,
    o.status && o.status !== 'Open' ? `<span class="rec-badge tone-${o.status === 'Won' ? 'green' : o.status === 'Lost' ? 'red' : 'muted'}">${escHtml(o.status)}</span>` : '',
    indicatorChips(o),
    o.winLossReason && (o.stage === 'Won' || o.stage === 'Lost') ? `<span class="rec-meta">${escHtml(o.winLossReason)}</span>` : '',
  ].filter(Boolean).join('');

  const odCompanyInput = document.getElementById('od-company-inp') as HTMLInputElement;
  odCompanyInput.value = o.companyName || '';
  attachCompanySelector(odCompanyInput);
  const companyList = document.getElementById('od-company-list') as HTMLElement;
  companyList.innerHTML = getAllCompanies().map((c) => `<option value="${escHtml(c)}">`).join('');
  const stageSel = document.getElementById('od-stage-sel') as HTMLSelectElement;
  stageSel.innerHTML = OPPORTUNITY_STAGES.map((s) => `<option value="${s}" ${o.stage === s ? 'selected' : ''}>${s}</option>`).join('');
  (document.getElementById('od-owner-inp') as HTMLInputElement).value = o.owner || '';
  (document.getElementById('od-value-inp') as HTMLInputElement).value = o.estimatedValue != null ? String(o.estimatedValue) : '';
  (document.getElementById('od-probability-inp') as HTMLInputElement).value = o.probability != null ? String(o.probability) : '';
  (document.getElementById('od-close-date-inp') as HTMLInputElement).value = o.expectedCloseDate || '';
  (document.getElementById('od-description') as HTMLTextAreaElement).value = o.description || '';
  (document.getElementById('od-next-action') as HTMLTextAreaElement).value = o.nextAction || '';

  await renderOpportunityContacts(o);
  await renderOpportunityNotes(o.id);
  renderOpportunityMeetings(o.id);
  renderOpportunityProposalSection(o);
  renderOpportunityProjectSection(o);
  void renderOpportunityFiles(o);
  (window as any).fillTeamNames?.();
  await renderOpportunityActivity(o.id);
}

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
  el.innerHTML = `<div class="rec-section-hd"><h2>Notes</h2><span class="rec-count">${notes.length || ''}</span><div class="rec-section-actions"><button class="btn-sm" onclick="createNoteForOpportunity()">+ New</button></div></div>` +
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
  const newNote: Note = {
    id: nextNoteId(), title: o.name, content: '', folder: '', clientName: o.companyName || '',
    tags: [], pinned: false, createdAt: today(), updatedAt: today(),
  };
  S.notes.unshift(newNote);
  persistNotes();
  await setLinksFrom('note', newNote.id, [{ fromType: 'note', fromId: newNote.id, toType: 'opportunity', toId: o.id }]);
  switchTab('notes');
  openNote(newNote.id);
}
expose('createNoteForOpportunity', createNoteForOpportunity);

// ── Meetings / Documents (direct opportunityId FK, same convention as projectId) ───

function renderOpportunityMeetings(oppId: number): void {
  const el = document.getElementById('od-meetings');
  if (!el) return;
  const meetings = S.meetings.filter((m) => m.opportunityId === oppId);
  el.innerHTML = `<div class="rec-section-hd"><h2>Meetings</h2><span class="rec-count">${meetings.length || ''}</span></div>` +
    (meetings.length === 0
      ? `<div class="feed-empty">No meetings linked yet — choose this opportunity when creating or editing a meeting.</div>`
      : `<div class="rec-list">${meetings.map((m) => `<div class="rec-row" onclick="openRecord('meeting', ${m.id})">
          <span class="rec-row-icon">${icon('meeting', 15)}</span>
          <div class="rec-row-main"><div class="rec-row-title">${escHtml(m.title)}</div></div>
          <span class="rec-row-date">${m.meetingDate ? fmtDate(m.meetingDate) : ''}</span>
        </div>`).join('')}</div>`);
}

// ── Proposal / Project lifecycle ─────────────────────────────────────────────────

function renderOpportunityProposalSection(o: Opportunity): void {
  const el = document.getElementById('od-proposal');
  if (!el) return;
  const p = o.proposalId != null ? S.proposals.find((x) => x.id === o.proposalId) : null;
  el.innerHTML = `<div class="rec-section-hd"><h2>Proposal</h2></div>` +
    (p
      ? `<div class="rec-row" onclick="openRecord('proposal', ${p.id})">
          <span class="rec-row-icon">${icon('database', 15)}</span>
          <div class="rec-row-main"><div class="rec-row-title">${recordLink('proposal', p.id, `${p.type || 'Proposal'} · SL#${p.id}`)}</div><div class="rec-row-sub">${escHtml(p.status || '')}</div></div>
        </div>`
      : `<div class="feed-empty">No proposal yet. <a href="#" class="rec-add-link" onclick="event.preventDefault();createProposalForOpportunity()">Create one</a></div>`);
}

function renderOpportunityProjectSection(o: Opportunity): void {
  const el = document.getElementById('od-project');
  if (!el) return;
  const p = o.projectId != null ? S.projects.find((x) => x.id === o.projectId) : null;
  el.innerHTML = `<div class="rec-section-hd"><h2>Project</h2></div>` +
    (p
      ? `<div class="rec-row" onclick="openRecord('project', ${p.id})">
          <span class="rec-row-icon">${icon('target', 15)}</span>
          <div class="rec-row-main"><div class="rec-row-title">${recordLink('project', p.id, p.name)}</div><div class="rec-row-sub">${escHtml(p.status)}</div></div>
        </div>`
      : o.stage === 'Won'
        ? `<div class="feed-empty">Won — ready to deliver. <a href="#" class="rec-add-link" onclick="event.preventDefault();createProjectForOpportunity()">Start a project</a></div>`
        : `<div class="feed-empty">A project can be started once this opportunity is won.</div>`);
}

export function createProposalForOpportunity(): void {
  const o = currentOpportunity();
  if (!o) return;
  (window as any).openProposalBuilder?.({ client: o.companyName || o.name, opportunityId: o.id, currency: o.currency, businessEntityId: o.businessEntityId ?? null });
}
expose('createProposalForOpportunity', createProposalForOpportunity);

export function createProjectForOpportunity(): void {
  const o = currentOpportunity();
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

// ── Activity ─────────────────────────────────────────────────

const ACTIVITY_LABEL: Record<string, string> = {
  created: 'Opportunity created', stage_changed: 'Stage changed',
  proposal_linked: 'Proposal linked', project_created: 'Project linked',
};

async function renderOpportunityActivity(oppId: number): Promise<void> {
  const el = document.getElementById('od-activity');
  if (!el) return;
  const activity = await getOpportunityActivity(oppId);
  if (S.currentOpportunityId !== oppId) return;
  const unified = await getActivity({ entityType: 'opportunity', entityId: oppId, limit: 100 }).catch(() => []);
  if (S.currentOpportunityId !== oppId) return;
  el.innerHTML = `<div class="rec-section-hd"><h2>Activity</h2></div><div class="feed">${renderFeed(unified.map(activityItem), { empty: 'No activity yet.' })}</div>`;

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
    span.textContent = `${daysInStage}d in stage`;
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
      <div class="rec-section-actions">${folder?.exists && folder.path ? `<button class="btn-sm" onclick="msFilesNavigateToPath('${attr(folder.path)}');navToModule('files')">Open client folder</button>` : ''}</div></div>
    ${docRows.length + folderRows.length
      ? `<div class="rec-list">${[...docRows, ...folderRows].join('')}</div>`
      : `<div class="feed-empty">${client ? (folder?.exists ? 'The client folder is empty.' : `No folder for ${escHtml(client)} under Proposals yet.`) : 'Set the company to see its proposal folder.'}</div>`}`;
}

export function oppOpenFile(path: string): void {
  void filesOpen(path).catch((e) => toast('Could not open the file', { tone: 'error', detail: String(e) }));
}
expose('oppOpenFile', oppOpenFile);
