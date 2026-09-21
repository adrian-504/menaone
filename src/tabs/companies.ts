import { suggestWebsites } from '../lib/clientMatch';
import { isAgreementActive, isOpenProposal, isLost, isWon, activeMrr as computeActiveMrr, fmtMoney, fmtMoneyByCurrency, toReporting, currencyOf, agreementMonthly, activeTeam, matchesOwnerFilter, ownerFilterOptions, type MoneyByCurrency } from '../lib/commercial';
import { S } from '../lib/state';
import { toast, undoToast } from '../lib/ui';
import { renderBulkBar } from '../lib/bulkBar';
import { STATUSES, ST, AGR_ST } from '../lib/constants';
import { today, fmtDate, escHtml, expose, showConfirm, statusDot, showTextPrompt, getClients, companyRef, inCompany, daysSince, daysUntil, strColor, type CompanyRef } from '../lib/utils';
import { shownColumns, sortState, setSort, sortRows, headerCells, openColumnPicker, agoLabel, type Column, type SortState } from '../lib/tableColumns';
import { companyLists, companyNamesInList, contactsInCompanyList, contactsAtCompanies, createSavedList, renameSavedList, removeSavedList, updateSmartListFilters, addCompaniesToList, removeCompaniesFromList, addToCompanyListChoices, exportToActiveCampaign, listById, sameFilters, cleanFilters, listChipLabel, listsForCompany } from '../core/lists';
import { emptyState } from '../lib/ui';
import { recordLink } from '../lib/links';
import { activityItem, renderFeed, type FeedItem } from '../lib/activityFeed';
import { renderIcons } from '../core/chrome';
import { icon } from '../lib/icons';
import { persistProposals, persistContacts, persistAgreements, persistTodos, persistNotes, persistCompanyNotes, persistCreateCompany } from '../lib/persist';
import { registerTabRenderer, registerCompanyViewRefresher, refreshBadges, notifyNavigated, refreshAll } from '../lib/registry';
import { showContextMenu, showMenuAt } from '../lib/contextMenu';
import { renderTagChips } from '../lib/tagChips';
import { openContactModal } from '../core/contacts';
import { openAgrModal } from '../core/agreements';
import { openNotesModal } from '../core/proposals';
import { renderCoNotesSection, createNoteForCompany } from './notes';
import { renderCoTodosSection, createTodoForCompany } from './todo';
import { renderLinkedEmailsForCompany } from '../core/emailLinks';
import { getLinksFor, filesGetByIds, getCompanies, mergeCompanyLinks, saveMeeting, saveProject, saveCompany, getReviewQueue, resolveReviewQueueEntry, renameCompany, getActivity, companyNoteEntries, addCompanyNoteEntryDb, updateCompanyNoteEntryDb, deleteCompanyNoteEntryDb, moveCompanyNoteEntries, type CompanyNoteEntry} from '../lib/db';
import { switchTab } from '../core/nav';
import { normalizeCompanyNameForMatch } from '../lib/companySelector';
import { INDUSTRY_TAXONOMY } from '../lib/types';
import type { Proposal, Contact, Agreement, ActivityNote, Company, Opportunity, SavedList } from '../lib/types';


// ═══════════════ COMPANY EDIT / RENAME ═══════════════

/** Draft state for the Industry chip editor in the Edit Company modal — a
 * company can span more than one industry, so this mirrors the same
 * tag-chip-input pattern already used for Note/Task tags (renderTagChips,
 * lib/tagChips.ts) rather than a plain text field. Committed to
 * the company record only on Save, same as the name/notes fields. */
let editCoIndustriesDraft: string[] = [];

/** The canonical Company row for the company currently being viewed/edited —
 * `S.currentCompany` is still a name (the display/URL identity throughout
 * this file), but every field beyond name/notes now lives on the real
 * `companies` table row, found by that name. */
function currentCompanyRecord(): Company | undefined {
  return S.currentCompany ? S.companies.find((c) => c.name === S.currentCompany) : undefined;
}

/** Edits the company's details in place, in the Key facts card of its page. */
export function openEditCompanyModal(): void {
  if (!S.currentCompany) return;
  if (!document.getElementById('co-detail')?.classList.contains('open')) openCompanyDetail(S.currentCompany);
  const co = currentCompanyRecord();
  (document.getElementById('edit-co-name') as HTMLInputElement).value = S.currentCompany;
  (document.getElementById('edit-co-legal-name') as HTMLInputElement).value = co?.legalName || '';
  (document.getElementById('edit-co-website') as HTMLInputElement).value = co?.website || '';
  (document.getElementById('edit-co-country') as HTMLInputElement).value = co?.country || '';
  (document.getElementById('edit-co-city') as HTMLInputElement).value = co?.city || '';
  (document.getElementById('edit-co-type') as HTMLSelectElement).value = co?.companyType || '';
  (document.getElementById('edit-co-status') as HTMLSelectElement).value = co?.status || '';
  (document.getElementById('edit-co-owner') as HTMLInputElement).value = co?.owner || '';
  (document.getElementById('edit-co-description') as HTMLTextAreaElement).value = co?.description || '';
  (document.getElementById('edit-co-archived') as HTMLInputElement).checked = !!co?.archived;
  const owners = document.getElementById('edit-co-owner-options');
  if (owners) owners.innerHTML = activeTeam().map((t) => `<option value="${escHtml(t.name)}">`).join('');
  editCoIndustriesDraft = [...(co?.industries || [])];
  const chipsEl = document.getElementById('edit-co-industries');
  if (chipsEl) renderTagChips(chipsEl, editCoIndustriesDraft, (next) => { editCoIndustriesDraft = next; }, { placeholder: 'Add an industry…', suggestions: [...INDUSTRY_TAXONOMY] });
  setCompanyEditing(true);
  const card = document.getElementById('co-facts-card');
  card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  (document.getElementById('edit-co-name') as HTMLInputElement | null)?.focus();
}
expose('openEditCompanyModal', openEditCompanyModal);

function setCompanyEditing(on: boolean): void {
  const form = document.getElementById('co-facts-edit');
  const facts = document.getElementById('co-facts');
  const btn = document.getElementById('co-facts-edit-btn');
  if (form) form.hidden = !on;
  if (facts) facts.hidden = on;
  if (btn) btn.hidden = on;
  document.getElementById('co-facts-card')?.closest('.rec-overview-grid')?.classList.toggle('is-editing', on);
}

export function closeEditCompanyModal(): void {
  setCompanyEditing(false);
}
expose('closeEditCompanyModal', closeEditCompanyModal);

/** Reassigns every free-text company column from `oldName` to `newName`
 * across all 7 relation tables — proposals/contacts/agreements/todos/notes
 * are bulk in-memory arrays (mutate in place + one persistX() call each);
 * meetings/projects are the only true per-record entities, so those are
 * looped and saved individually. Shared by both the rename flow
 * (saveEditCompany) and merge (confirmMergeCompanies) — previously only
 * saveEditCompany existed, and only touched 3 of these 7 tables, silently
 * orphaning any tasks/notes/meetings/projects left tagged with the old name. */
async function reassignCompanyName(oldName: string, newName: string): Promise<void> {
  const ref = companyRef(oldName);
  S.proposals.forEach((p) => { if (inCompany(ref, p.companyId, p.client)) p.client = newName; });
  S.contacts.forEach((c) => { if (inCompany(ref, c.companyId, c.clientName)) c.clientName = newName; });
  S.agreements.forEach((a) => { if (inCompany(ref, a.companyId, a.client)) a.client = newName; });
  S.todos.forEach((t) => { if (inCompany(ref, t.companyId, t.client)) t.client = newName; });
  S.notes.forEach((n) => { if (inCompany(ref, n.companyId, n.clientName)) n.clientName = newName; });
  persistProposals(); persistContacts(); persistAgreements(); persistTodos(); persistNotes();
  // Opportunities carry the company's name for display only (the backend keeps their link by id).
  S.opportunities.forEach((o) => { if (inCompany(ref, o.companyId, o.companyName)) o.companyName = newName; });
  S.emails.forEach((e) => { if (inCompany(ref, e.companyId, e.companyName)) e.companyName = newName; });

  for (const m of S.meetings.filter((x) => inCompany(ref, x.companyId, x.companyName))) {
    m.companyName = newName;
    const saved = await saveMeeting(m);
    const idx = S.meetings.findIndex((x) => x.id === saved.id);
    if (idx > -1) S.meetings[idx] = saved;
  }
  for (const p of S.projects.filter((x) => inCompany(ref, x.companyId, x.companyName))) {
    p.companyName = newName;
    const saved = await saveProject(p);
    const idx = S.projects.findIndex((x) => x.id === saved.id);
    if (idx > -1) S.projects[idx] = saved;
  }
}

export async function saveEditCompany(): Promise<void> {
  const newName = (document.getElementById('edit-co-name') as HTMLInputElement).value.trim();
  if (!newName) return;
  const oldName = S.currentCompany;
  if (oldName !== newName && oldName) {
    // Rename the company record itself first, keeping its id, so every record
    // linked to it stays linked; the free-text names then follow.
    const record = S.companies.find((c) => c.name === oldName);
    if (record) {
      try {
        const renamed = await renameCompany(record.id, newName);
        Object.assign(record, { name: renamed.name, updatedAt: renamed.updatedAt });
      } catch (e) {
        toast(String(e), { tone: 'error', action: { label: 'Merge instead', run: () => { closeEditCompanyModal(); openMergeCompanyModal(oldName); } } });
        return;
      }
    }
    await reassignCompanyName(oldName, newName);
    // Notes are dated entries now: they follow the company, each keeping its date.
    try { await moveCompanyNoteEntries(oldName, newName, S.companies.find((c) => c.name === newName)?.id ?? null); } catch (e) { console.error('[company rename] notes follow-up failed:', e); }
    if (!record) {
      try { await mergeCompanyLinks(oldName, newName); } catch (e) { console.error('[company rename] link reconciliation failed:', e); }
    }
    S.currentCompany = newName;
  }
  persistCompanyNotes();

  // Ensure a canonical companies row exists for this name (find-or-create,
  // safe to call even if one already does), then save every Company-entity
  // field onto it — industries constrained to the controlled taxonomy so a
  // stray typed value in the chip editor can't silently reintroduce
  // free-text industry drift.
  const created = await persistCreateCompany(newName);
  if (created) {
    const validIndustries = editCoIndustriesDraft.filter((i) => (INDUSTRY_TAXONOMY as readonly string[]).includes(i));
    const updated: Company = {
      ...created,
      industries: validIndustries,
      legalName: (document.getElementById('edit-co-legal-name') as HTMLInputElement).value.trim() || null,
      website: (document.getElementById('edit-co-website') as HTMLInputElement).value.trim() || null,
      country: (document.getElementById('edit-co-country') as HTMLInputElement).value.trim() || null,
      city: (document.getElementById('edit-co-city') as HTMLInputElement).value.trim() || null,
      companyType: (document.getElementById('edit-co-type') as HTMLSelectElement).value || null,
      status: (document.getElementById('edit-co-status') as HTMLSelectElement).value || null,
      owner: (document.getElementById('edit-co-owner') as HTMLInputElement).value.trim() || null,
      description: (document.getElementById('edit-co-description') as HTMLTextAreaElement).value.trim() || null,
      archived: (document.getElementById('edit-co-archived') as HTMLInputElement).checked,
    };
    try {
      const saved = await saveCompany(updated);
      const idx = S.companies.findIndex((c) => c.id === saved.id);
      if (idx > -1) S.companies[idx] = saved; else S.companies.push(saved);
    } catch (e) {
      console.error('[company edit] save_company failed:', e);
    }
  }

  closeEditCompanyModal();
  openCompanyDetail(newName);
}
expose('saveEditCompany', saveEditCompany);

// ═══════════════ NEW COMPANY (bare, no proposal/contact yet) ═══════════════

let newCoIndustriesDraft: string[] = [];

export function openNewCompanyModal(): void {
  (document.getElementById('new-co-name') as HTMLInputElement).value = '';
  newCoIndustriesDraft = [];
  const chipsEl = document.getElementById('new-co-industries');
  if (chipsEl) renderTagChips(chipsEl, newCoIndustriesDraft, (next) => { newCoIndustriesDraft = next; }, { placeholder: 'Add an industry…' });
  document.getElementById('modal-new-company')?.classList.add('open');
  setTimeout(() => (document.getElementById('new-co-name') as HTMLInputElement)?.focus(), 0);
}
expose('openNewCompanyModal', openNewCompanyModal);

export function closeNewCompanyModal(): void {
  document.getElementById('modal-new-company')?.classList.remove('open');
}
expose('closeNewCompanyModal', closeNewCompanyModal);

export async function submitNewCompany(e: Event): Promise<void> {
  e.preventDefault();
  const name = (document.getElementById('new-co-name') as HTMLInputElement).value.trim();
  if (!name) return;
  const created = await persistCreateCompany(name);
  if (!created) return;
  if (!S.companies.some((c) => c.id === created.id)) S.companies.push(created);
  // Industries belong to the company record (they used to go to a legacy list the app no longer reads).
  const industries = newCoIndustriesDraft.filter((i) => (INDUSTRY_TAXONOMY as readonly string[]).includes(i));
  if (industries.length > 0) {
    try {
      const saved = await saveCompany({ ...created, industries: [...new Set([...(created.industries || []), ...industries])] });
      const idx = S.companies.findIndex((c) => c.id === saved.id);
      if (idx > -1) S.companies[idx] = saved; else S.companies.push(saved);
    } catch (e) {
      toast(`Couldn't save the industries for ${name}`, { tone: 'error', detail: String(e) });
    }
  }
  closeNewCompanyModal();
  switchTab('companies');
  openCompanyDetail(name);
}
expose('submitNewCompany', submitNewCompany);

// ═══════════════ COMPANY MERGE ═══════════════

let mergeSourceCompany: string | null = null;

/** All distinct company names across every proposal/contact/agreement,
 * ignoring the current date-period filter — unlike getAllCompanies() (which
 * is deliberately period-gated for the Companies grid/autocomplete-elsewhere
 * use cases), a merge TARGET must always be pickable regardless of the
 * period currently selected. */
function allCompanyNamesUnfiltered(): string[] {
  const names = new Set<string>();
  S.proposals.forEach((p) => { if (p.client) names.add(p.client); });
  S.agreements.forEach((a) => { if (a.client) names.add(a.client); });
  S.contacts.forEach((c) => { if (c.clientName) names.add(c.clientName); });
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function openMergeCompanyModal(sourceName: string): void {
  mergeSourceCompany = sourceName;
  const srcEl = document.getElementById('merge-co-source');
  if (srcEl) srcEl.textContent = sourceName;
  const targetInp = document.getElementById('merge-co-target') as HTMLInputElement | null;
  if (targetInp) targetInp.value = '';
  const dl = document.getElementById('merge-co-target-list');
  if (dl) dl.innerHTML = allCompanyNamesUnfiltered().filter((n) => n !== sourceName).map((n) => `<option value="${escHtml(n)}">`).join('');
  const summaryEl = document.getElementById('merge-co-summary');
  if (summaryEl) summaryEl.innerHTML = '';
  const btn = document.getElementById('merge-co-confirm-btn') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  document.getElementById('modal-merge-company')?.classList.add('open');
}
expose('openMergeCompanyModal', openMergeCompanyModal);

export function openMergeCompanyForCurrent(): void {
  if (S.currentCompany) openMergeCompanyModal(S.currentCompany);
}
expose('openMergeCompanyForCurrent', openMergeCompanyForCurrent);

export function closeMergeCompanyModal(): void {
  document.getElementById('modal-merge-company')?.classList.remove('open');
  mergeSourceCompany = null;
}
expose('closeMergeCompanyModal', closeMergeCompanyModal);

export function previewCompanyMerge(): void {
  const target = (document.getElementById('merge-co-target') as HTMLInputElement).value.trim();
  const btn = document.getElementById('merge-co-confirm-btn') as HTMLButtonElement;
  const summaryEl = document.getElementById('merge-co-summary')!;
  const source = mergeSourceCompany;
  if (!source || !target || target === source) { summaryEl.innerHTML = ''; btn.disabled = true; return; }
  const ref = companyRef(source);
  const counts = {
    proposals: S.proposals.filter((p) => inCompany(ref, p.companyId, p.client)).length,
    contacts: S.contacts.filter((c) => inCompany(ref, c.companyId, c.clientName)).length,
    agreements: S.agreements.filter((a) => inCompany(ref, a.companyId, a.client)).length,
    notes: S.notes.filter((n) => inCompany(ref, n.companyId, n.clientName)).length,
    todos: S.todos.filter((t) => inCompany(ref, t.companyId, t.client)).length,
    meetings: S.meetings.filter((m) => inCompany(ref, m.companyId, m.companyName)).length,
    projects: S.projects.filter((p) => inCompany(ref, p.companyId, p.companyName)).length,
  };
  summaryEl.innerHTML = `This will move <strong>${counts.proposals}</strong> proposals, <strong>${counts.contacts}</strong> contacts, <strong>${counts.agreements}</strong> agreements, <strong>${counts.notes}</strong> notes, <strong>${counts.todos}</strong> tasks, <strong>${counts.meetings}</strong> meetings and <strong>${counts.projects}</strong> projects (plus any linked OneDrive folders) into "${escHtml(target)}". <span style="color:var(--red);font-weight:600">This cannot be undone.</span>`;
  btn.disabled = false;
}
expose('previewCompanyMerge', previewCompanyMerge);

export async function confirmMergeCompanies(): Promise<void> {
  const source = mergeSourceCompany;
  const target = (document.getElementById('merge-co-target') as HTMLInputElement).value.trim();
  if (!source || !target || target === source) return;

  await reassignCompanyName(source, target);

  // Both companies' notes end up in one log, each entry keeping its own date —
  // better than the old behaviour, which glued two blobs of text together.
  try { await moveCompanyNoteEntries(source, target, S.companies.find((c) => c.name === target)?.id ?? null); } catch (e) { console.error('[merge] notes follow-up failed:', e); }


  try {
    await mergeCompanyLinks(source, target);
  } catch (e) {
    console.error('[merge] company/entity_links reconciliation failed:', e);
    toast('Companies merged — check linked opportunities and OneDrive folders', { tone: 'error', detail: 'Proposals, contacts, agreements, notes, tasks, meetings and projects were moved, but the opportunity and folder links could not be updated.' });
  }
  S.companies = await getCompanies();

  const wasViewingSource = S.currentCompany === source;
  closeMergeCompanyModal();
  refreshBadges();
  if (wasViewingSource) openCompanyDetail(target);
  else renderCompanyList();
}
expose('confirmMergeCompanies', confirmMergeCompanies);

export function companyContextMenu(e: MouseEvent, name: string): void {
  showContextMenu(e, [
    { label: 'Open', iconName: 'briefcase', run: () => openCompanyDetail(name) },
    { label: 'Edit', iconName: 'edit', run: () => { S.currentCompany = name; openEditCompanyModal(); } },
    { label: 'Add to list…', iconName: 'tag', run: () => { const anchor = document.querySelector<HTMLElement>(`#co-tbody tr[data-company="${CSS.escape(name)}"]`) || (e.target as HTMLElement); showMenuAt(anchor, addToCompanyListChoices(() => [name])); } },
    { label: 'Merge into…', iconName: 'repeat', run: () => openMergeCompanyModal(name) },
  ]);
}
expose('companyContextMenu', companyContextMenu);

// ═══════════════ NEEDS REVIEW QUEUE (Company Master Data migration) ═══════════════
//
// company_review_queue holds legacy names the migration found genuinely
// ambiguous (more than one existing company fuzzy-matched) or placeholder-
// like ("No Client Name") — never guessed automatically. Integrated directly
// into the Companies list rather than a separate page, per spec.

let reviewQueueLoaded = false;

export async function loadReviewQueue(force = false): Promise<void> {
  if (reviewQueueLoaded && !force) { renderReviewQueue(); return; }
  try {
    S.reviewQueue = await getReviewQueue();
    reviewQueueLoaded = true;
  } catch (e) {
    console.error('[review queue] load failed:', e);
  }
  renderReviewQueue();
}

function renderReviewQueue(): void {
  const el = document.getElementById('co-review-queue');
  if (!el) return;
  if (S.reviewQueue.length === 0) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = '';
  el.innerHTML = `
    <div class="co-review-queue-hd">${icon('warning', 14)} <strong>${S.reviewQueue.length}</strong> company name${S.reviewQueue.length === 1 ? '' : 's'} need${S.reviewQueue.length === 1 ? 's' : ''} review — more than one existing company could match (or the value looks like a placeholder), so nothing was linked automatically.</div>
    <div class="co-review-queue-rows">
      ${S.reviewQueue.map((q) => `
        <div class="co-review-row">
          <div class="co-review-name">"${escHtml(q.rawName)}"</div>
          <div class="co-review-actions">
            ${q.suggestedCompanyName ? `<button class="btn-secondary btn-sm" onclick="resolveReviewEntry(${q.id},'confirm')">Confirm: ${escHtml(q.suggestedCompanyName)}</button>` : ''}
            <input type="text" class="finp co-review-pick" list="co-review-companies-list" placeholder="Pick another company…" data-qid="${q.id}">
            <button class="btn-secondary btn-sm" onclick="resolveReviewEntry(${q.id},'create')">+ Create new</button>
            <button class="btn-secondary btn-sm" onclick="resolveReviewEntry(${q.id},'ignore')">Leave unresolved</button>
          </div>
        </div>
      `).join('')}
    </div>
    <datalist id="co-review-companies-list">${getClients().map((c) => `<option value="${escHtml(c)}">`).join('')}</datalist>
  `;
  el.querySelectorAll<HTMLInputElement>('.co-review-pick').forEach((inp) => {
    inp.addEventListener('change', () => {
      const name = inp.value.trim();
      const co = S.companies.find((c) => c.name === name);
      const qid = Number(inp.dataset.qid);
      if (co) void resolveReviewEntry(qid, 'select', co.id);
    });
  });
}

export async function resolveReviewEntry(id: number, action: 'confirm' | 'select' | 'create' | 'ignore', companyId?: number): Promise<void> {
  try {
    await resolveReviewQueueEntry(id, action, companyId ?? null);
  } catch (e) {
    console.error('[review queue] resolve failed:', e);
    toast('Could not resolve this entry', { tone: 'error' });
    return;
  }
  S.reviewQueue = S.reviewQueue.filter((q) => q.id !== id);
  if (action === 'create' || action === 'select') S.companies = await getCompanies();
  renderReviewQueue();
  renderCompanyList();
}
expose('resolveReviewEntry', resolveReviewEntry);

// ═══════════════ COMPANIES TAB ═══════════════


/** @deprecated Use `getClients` from `lib/utils` directly — both names now
 * resolve to the same canonical, non-period-gated company list. Kept as an
 * alias so existing call sites don't need to change. */
export function getAllCompanies(): string[] {
  return getClients();
}

export interface CompanyData {
  name: string; companyId: number | null; proposals: Proposal[]; agreements: Agreement[]; contacts: Contact[];
  notes: (ActivityNote & { proposalType?: string | null; source?: string })[];
  /** Monthly fees of agreements whose service is active, per currency. */
  activeMrr: MoneyByCurrency; clientSince: string | null; latestDate: string | null;
  activeAgreements: Agreement[]; signedAgreements: Agreement[];
  /** Agreements that make this company a client today (service active, or signed and not ended). */
  clientAgreements: Agreement[]; latestStatus: string | null;
}

export function buildCompanyData(name: string): CompanyData {
  const ref = companyRef(name);
  const cp = S.proposals.filter((p) => inCompany(ref, p.companyId, p.client));
  const ca = S.agreements.filter((a) => inCompany(ref, a.companyId, a.client));
  const cc = S.contacts.filter((c) => inCompany(ref, c.companyId, c.clientName));
  const allNotes: (ActivityNote & { proposalType?: string | null; source?: string })[] = [];
  cp.forEach((p) => { (p.notes || []).forEach((n) => allNotes.push({ ...n, proposalType: p.type, source: `Proposal SL#${p.id} — ${p.type}` })); });
  allNotes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const activeMrr = computeActiveMrr(ca);
  const allDates = cp.map((p) => p.sentDate || p.dateAdded).filter(Boolean).sort() as string[];
  const clientSince = allDates[0] || null;
  const latestDate = allDates[allDates.length - 1] || null;
  const activeAgreements = ca.filter((a) => !['Signed', 'Canceled'].includes(a.status || ''));
  const signedAgreements = ca.filter((a) => a.status === 'Signed');
  const todayIso = today();
  const clientAgreements = ca.filter((a) => isAgreementActive(a) || (a.status === 'Signed' && a.serviceStatus !== 'Ended' && !(a.endDate && a.endDate < todayIso)));
  const latestStatus = cp.length > 0 ? [...cp].sort((a, b) => (b.sentDate || '').localeCompare(a.sentDate || ''))[0].status : null;

  return { name, companyId: ref.id, proposals: cp, agreements: ca, contacts: cc, notes: allNotes, activeMrr, clientSince, latestDate, activeAgreements, signedAgreements, clientAgreements, latestStatus };
}

export function setCoListView(v: string): void {
  S.coListView = v as typeof S.coListView;
  document.querySelectorAll('.co-vbtn').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.view === v));
  const grid = document.getElementById('co-grid');
  const table = document.getElementById('co-list-table');
  if (grid) grid.style.display = v === 'grid' ? '' : 'none';
  if (table) table.style.display = v === 'list' ? '' : 'none';
  const cols = document.getElementById('co-columns-btn');
  if (cols) cols.hidden = v !== 'list';
  updateCoBulkBar();
}
expose('setCoListView', setCoListView);

type QualityFilter = 'missing-industry' | 'missing-contacts' | 'missing-website' | 'missing-owner' | 'duplicates' | 'unmatched';
let qualityFilter: QualityFilter | null = null;

export function setQualityFilter(f: QualityFilter): void {
  qualityFilter = qualityFilter === f ? null : f;
  renderCompanyList();
}
expose('setQualityFilter', setQualityFilter);

/** Company names whose normalized form collides with another company's — a
 * "possible duplicate" signal surfaced directly in the list, using the exact
 * same fuzzy-match logic as the Company Selector and the migration engine so
 * all three never disagree about what counts as a likely duplicate. */
function duplicateCompanyNames(): Set<string> {
  const byNorm = new Map<string, string[]>();
  for (const c of S.companies) {
    const norm = normalizeCompanyNameForMatch(c.name);
    if (!norm) continue;
    if (!byNorm.has(norm)) byNorm.set(norm, []);
    byNorm.get(norm)!.push(c.name);
  }
  const dupes = new Set<string>();
  for (const names of byNorm.values()) if (names.length > 1) names.forEach((n) => dupes.add(n));
  return dupes;
}

function hasContacts(ref: CompanyRef): boolean {
  return S.contacts.some((c) => inCompany(ref, c.companyId, c.clientName));
}

function companyProposals(ref: CompanyRef): Proposal[] {
  return S.proposals.filter((p) => inCompany(ref, p.companyId, p.client));
}

function renderQualityBar(allNames: string[]): void {
  const el = document.getElementById('co-quality-bar');
  if (!el) return;
  const total = allNames.length;
  if (total === 0) { el.innerHTML = ''; return; }
  const dupes = duplicateCompanyNames();
  const byName = new Map(S.companies.map((c) => [c.name, c] as const));
  const counts: Record<QualityFilter, number> = {
    'missing-industry': allNames.filter((n) => (byName.get(n)?.industries.length || 0) === 0).length,
    'missing-contacts': allNames.filter((n) => !hasContacts(companyRef(n))).length,
    'missing-website': allNames.filter((n) => !byName.get(n)?.website).length,
    'missing-owner': allNames.filter((n) => !byName.get(n)?.owner).length,
    duplicates: allNames.filter((n) => dupes.has(n)).length,
    unmatched: S.reviewQueue.length,
  };
  const labels: Record<QualityFilter, string> = {
    'missing-industry': 'missing industry',
    'missing-contacts': 'no contacts',
    'missing-website': 'no website',
    'missing-owner': 'no owner',
    duplicates: 'possible duplicates',
    unmatched: 'unresolved names',
  };
  const websites = suggestWebsites().length;
  el.innerHTML = (Object.keys(counts) as QualityFilter[])
    .filter((k) => counts[k] > 0)
    .map((k) => `<button class="co-quality-chip${qualityFilter === k ? ' active' : ''}" onclick="setQualityFilter('${k}')">${counts[k]} ${labels[k]}</button>`)
    .join('') + (websites ? `<button class="co-quality-chip co-quality-action" onclick="openWebsiteSuggestions()">Fill ${websites} website${websites === 1 ? '' : 's'} from email domains</button>` : '');
}

/** Filter controls, by the key a smart list saves them under. */
const COMPANY_FILTER_IDS: Record<string, string> = {
  search: 'co-search', status: 'co-filter-status', industry: 'co-filter-industry', service: 'co-filter-service',
  location: 'co-filter-location', owner: 'co-filter-owner', contacts: 'co-filter-contacts',
};

function readCompanyFilters(): Record<string, string> {
  const f: Record<string, string> = {};
  for (const [key, id] of Object.entries(COMPANY_FILTER_IDS)) f[key] = ((document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value || '').trim();
  if (qualityFilter) f.quality = qualityFilter;
  return cleanFilters(f);
}

/** Puts a smart list's filters into the controls (and remembers them like any filter change). */
function applyCompanyFilters(f: Record<string, string>): void {
  for (const [key, id] of Object.entries(COMPANY_FILTER_IDS)) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) continue;
    const value = f[key] || '';
    if (el instanceof HTMLSelectElement && value && ![...el.options].some((o) => o.value === value)) el.add(new Option(value, value));
    el.value = value;
  }
  qualityFilter = (f.quality as QualityFilter) || null;
  document.getElementById('co-filter-status')?.dispatchEvent(new Event('change'));
}

export function clearCompanyFilters(): void {
  applyCompanyFilters({});
  setActiveCompanyList(null);
  renderCompanyList();
}
expose('clearCompanyFilters', clearCompanyFilters);

/** Services each company was offered or is on retainer for, by company name. */
function servicesByCompanyName(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (companyName: string | null | undefined, service: string | null | undefined) => {
    const n = (companyName || '').trim();
    const sv = (service || '').trim();
    if (!n || !sv || sv === '—') return;
    if (!map.has(n)) map.set(n, new Set());
    map.get(n)!.add(sv);
  };
  const nameOf = (id: number | null | undefined, fallback: string | null | undefined) => (id != null ? S.companies.find((c) => c.id === id)?.name : null) || fallback;
  S.proposals.forEach((p) => (p.lines?.length ? p.lines.map((l) => l.serviceName) : [p.type]).forEach((sv) => add(nameOf(p.companyId, p.client), sv)));
  S.agreements.forEach((a) => (a.lines?.length ? a.lines.map((l) => l.serviceName) : [a.type]).forEach((sv) => add(nameOf(a.companyId, a.client), sv)));
  return map;
}

const locationOf = (co: Company | undefined) => [co?.city, co?.country].filter(Boolean).join(', ');

const RELATIONSHIP_FILTER: Record<string, string> = { client: 'Active client', discussion: 'In discussion', prospect: 'Prospect', past: 'Past client or prospect' };

/** Names of the companies a set of filters matches — used by the list and by smart lists. */
export function matchingCompanyNames(f: Record<string, string>): string[] {
  const allNames = getAllCompanies();
  const byName = new Map(S.companies.map((c) => [c.name, c] as const));
  const dupes = f.quality === 'duplicates' ? duplicateCompanyNames() : null;
  const reviewQueueNames = new Set(S.reviewQueue.map((q) => q.rawName));
  const services = f.service ? servicesByCompanyName() : null;
  const search = (f.search || '').toLowerCase();
  return allNames.filter((n) => {
    const co = byName.get(n);
    const ref = { id: co?.id ?? null, name: n };
    if (search && !n.toLowerCase().includes(search)) return false;
    if (f.contacts === 'none' && hasContacts(ref)) return false;
    if (f.contacts === 'some' && !hasContacts(ref)) return false;
    if (f.status === 'active' && !companyProposals(ref).some((p) => !p.archived && isOpenProposal(p))) return false;
    if (f.status === 'service' && !S.agreements.some((a) => inCompany(ref, a.companyId, a.client) && isAgreementActive(a))) return false;
    if (f.status === 'open-opp' && !S.opportunities.some((o) => inCompany(ref, o.companyId, o.companyName) && !o.archived && o.status === 'Open')) return false;
    if (f.status === 'signed' && !S.agreements.some((a) => inCompany(ref, a.companyId, a.client) && a.status === 'Signed')) return false;
    if (RELATIONSHIP_FILTER[f.status || ''] && relationshipStatus(buildCompanyData(n)).label !== RELATIONSHIP_FILTER[f.status]) return false;
    if (services && !services.get(n)?.has(f.service)) return false;
    if (f.location) {
      if (f.location === 'none' ? !!(co?.city || co?.country) : f.location.startsWith('country:') ? co?.country !== f.location.slice(8) : locationOf(co) !== f.location.slice(5)) return false;
    }
    if (f.industry && !co?.industries.includes(f.industry)) return false;
    if (f.owner && !matchesOwnerFilter(co ?? {}, f.owner)) return false;
    if (f.quality === 'missing-industry' && (co?.industries.length || 0) > 0) return false;
    if (f.quality === 'missing-contacts' && hasContacts(ref)) return false;
    if (f.quality === 'missing-website' && co?.website) return false;
    if (f.quality === 'missing-owner' && co?.owner) return false;
    if (f.quality === 'duplicates' && !dupes?.has(n)) return false;
    if (f.quality === 'unmatched' && !reviewQueueNames.has(n)) return false;
    return true;
  });
}
expose('matchingCompanyNames', matchingCompanyNames);

// ── Lists bar ──

const ACTIVE_LIST_KEY = 'menaone.companyList';
let activeCompanyListId: number | null = (() => { try { return Number(localStorage.getItem(ACTIVE_LIST_KEY)) || null; } catch { return null; } })();

function setActiveCompanyList(id: number | null): void {
  activeCompanyListId = id;
  try { if (id) localStorage.setItem(ACTIVE_LIST_KEY, String(id)); else localStorage.removeItem(ACTIVE_LIST_KEY); } catch { /* per-device only */ }
}

/** The hand-picked list being viewed, if it still exists. */
function activeCompanyList(): SavedList | undefined {
  const list = activeCompanyListId ? listById(activeCompanyListId) : undefined;
  return list && !list.filters ? list : undefined;
}

/** Opens a list: a hand-picked list narrows the companies shown, a smart list fills in its filters. Clicking the open list closes it. */
export function openCompanyList(id: number): void {
  const list = listById(id);
  if (!list) return;
  if (list.filters) {
    setActiveCompanyList(null);
    applyCompanyFilters(sameFilters(readCompanyFilters(), list.filters) ? {} : list.filters);
  } else {
    setActiveCompanyList(activeCompanyListId === id ? null : id);
  }
  coSelected.clear();
  renderCompanyList();
}
expose('openCompanyList', openCompanyList);

function renderCompanyListsBar(filters: Record<string, string>): void {
  const el = document.getElementById('co-lists-bar');
  if (!el) return;
  const lists = companyLists();
  const smartOpen = lists.find((l) => l.filters && sameFilters(filters, l.filters));
  const active = activeCompanyList();
  const chips = lists.map((l) => {
    const on = l.filters ? l === smartOpen : l === active;
    return `<span class="list-chip-wrap${on ? ' active' : ''}"><button class="list-chip${on ? ' active' : ''}" onclick="openCompanyList(${l.id})" oncontextmenu="companyListMenu(event, ${l.id})" title="${l.filters ? 'Smart list' : 'Hand-picked list'}">${listChipLabel(l.name, companyNamesInList(l).length, !!l.filters)}</button>${on ? `<button class="list-chip-more" onclick="companyListMenu(event, ${l.id})" aria-label="List actions">${icon('more', 13)}</button>` : ''}</span>`;
  }).join('');
  const canSave = Object.keys(filters).length > 0 && !smartOpen;
  el.innerHTML = `<span class="list-bar-label">Lists</span>${chips}<button class="list-chip list-chip-add" onclick="newCompanyListMenu(event)">${icon('plus', 11)} New list</button>${canSave ? `<button class="list-bar-link" onclick="saveCompanyFiltersAsList()">Save these filters as a smart list</button>` : ''}`;
}

export function newCompanyListMenu(e: MouseEvent): void {
  e.stopPropagation();
  const filters = readCompanyFilters();
  const selected = [...coSelected];
  showMenuAt(e.currentTarget as HTMLElement, [
    { label: 'Hand-picked list', iconName: 'tag', run: () => { void createSavedList('company', null).then((l) => { if (l) { setActiveCompanyList(l.id); renderCompanyList(); toast('Add companies from the list view: select them, then Add to list.'); } }); } },
    ...(selected.length ? [{ label: `List of the ${selected.length} selected`, iconName: 'check', run: () => { void createSavedList('company', null).then(async (l) => { if (l) { await addCompaniesToList(l.id, selected); coSelected.clear(); setActiveCompanyList(l.id); renderCompanyList(); } }); } }] : []),
    { label: Object.keys(filters).length ? 'Smart list from these filters' : 'Smart list (set filters first)', iconName: 'bolt', run: () => { if (Object.keys(filters).length) void saveCompanyFiltersAsList(); else toast('Choose some filters first — a smart list keeps them.'); } },
  ]);
}
expose('newCompanyListMenu', newCompanyListMenu);

export async function saveCompanyFiltersAsList(): Promise<void> {
  const list = await createSavedList('company', readCompanyFilters());
  if (list) renderCompanyList();
}
expose('saveCompanyFiltersAsList', saveCompanyFiltersAsList);

export function companyListMenu(e: MouseEvent, id: number): void {
  const list = listById(id);
  if (!list) return;
  const filters = readCompanyFilters();
  const items = [
    { label: 'Show their contacts', iconName: 'people', run: () => (window as any).showContactsOfCompanyList?.(id) },
    { label: 'Export contacts to ActiveCampaign', iconName: 'mail', run: () => { void exportToActiveCampaign(contactsInCompanyList(list), list.name, { tag: list.name }); } },
    { label: '', run: () => {}, separator: true },
    { label: 'Rename…', iconName: 'edit', run: () => { void renameSavedList(id); } },
    ...(list.filters && Object.keys(filters).length && !sameFilters(filters, list.filters) ? [{ label: 'Use the current filters', iconName: 'bolt', run: () => { void updateSmartListFilters(id, filters); } }] : []),
    { label: 'Delete list', iconName: 'trash', danger: true, run: () => { void removeSavedList(id).then((gone) => { if (gone && activeCompanyListId === id) { setActiveCompanyList(null); renderCompanyList(); } }); } },
  ];
  if (e.type === 'contextmenu') showContextMenu(e, items);
  else { e.stopPropagation(); showMenuAt(e.currentTarget as HTMLElement, items); }
}
expose('companyListMenu', companyListMenu);

// ── Rows and columns ──

interface CoRow {
  name: string; co: Company | undefined; d: CompanyData; rel: { label: string; tone: string };
  industry: string | null; activeServices: string[]; otherServices: string[];
  mrr: number | null; mrrStr: string | null; renewal: string | null;
  openOpps: number; openProposals: number; lastActivity: string | null; lists: string[];
  statusCfg: { c: string; bg?: string; br?: string; ch?: string } | null;
  color: string; initials: string; accent: string; opportunityCount: number; projectCount: number;
}

const RELATIONSHIP_RANK: Record<string, number> = { 'Active client': 0, 'In discussion': 1, Prospect: 2, 'Past client or prospect': 3 };

/** Latest dated thing we did with a company: proposals, agreements, meetings, emails, opportunities, projects. */
function lastActivityFor(ref: CompanyRef, d: CompanyData): string | null {
  const todayIso = today();
  const dates: (string | null | undefined)[] = [
    ...d.proposals.flatMap((p) => [p.sentDate, p.dateAdded]),
    ...d.agreements.flatMap((a) => [a.dateClientSigned, a.dateSentToClient, a.datePrepared]),
    ...S.meetings.filter((m) => inCompany(ref, m.companyId, m.companyName)).map((m) => m.meetingDate || m.startAt),
    ...S.emails.filter((m) => inCompany(ref, m.companyId, m.companyName)).map((m) => m.receivedAt),
    ...S.opportunities.filter((o) => inCompany(ref, o.companyId, o.companyName)).map((o) => o.updatedAt),
    ...S.projects.filter((p) => inCompany(ref, p.companyId, p.companyName)).map((p) => p.updatedAt),
  ];
  const valid = dates.map((x) => (x || '').slice(0, 10)).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x) && x <= todayIso).sort();
  return valid.length ? valid[valid.length - 1] : null;
}

function buildCoRow(name: string, byName: Map<string, Company>, listsByName: Map<string, string[]>, services: Map<string, Set<string>>): CoRow {
  const d = buildCompanyData(name);
  const co = byName.get(name);
  const ref = { id: co?.id ?? null, name };
  const statusCfg = d.latestStatus ? ST[d.latestStatus] || { c: 'var(--muted)' } : null;
  const activeServices = [...new Set(d.clientAgreements.flatMap((a) => (a.lines?.length ? a.lines.map((l) => l.serviceName) : [a.type || ''])).filter(Boolean))];
  const otherServices = [...(services.get(name) || [])].filter((s) => !activeServices.includes(s));
  const todayIso = today();
  const renewal = d.clientAgreements.map((a) => a.endDate || '').filter((x) => x && x >= todayIso).sort()[0] || null;
  const opps = S.opportunities.filter((o) => inCompany(ref, o.companyId, o.companyName) && !o.archived);
  return {
    name, co, d, rel: relationshipStatus(d), industry: co?.industries[0] || null, activeServices, otherServices,
    mrr: Object.keys(d.activeMrr).length ? toReporting(d.activeMrr) ?? null : null,
    mrrStr: Object.keys(d.activeMrr).length ? `${fmtMoneyByCurrency(d.activeMrr)}/mo` : null,
    renewal,
    openOpps: opps.filter((o) => o.status === 'Open').length,
    openProposals: d.proposals.filter((p) => !p.archived && isOpenProposal(p)).length,
    lastActivity: lastActivityFor(ref, d),
    lists: listsByName.get(name) || [],
    statusCfg, color: strColor(name),
    initials: name.split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase(),
    accent: statusCfg?.ch || statusCfg?.c || 'var(--border)',
    opportunityCount: opps.length,
    projectCount: S.projects.filter((p) => inCompany(ref, p.companyId, p.companyName) && !p.archived).length,
  };
}

const muted = '<span class="t-muted">—</span>';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const COMPANY_COLUMNS: Column<CoRow>[] = [
  { key: 'company', label: 'Company', shown: true, fixed: true, sort: (r) => r.name.toLowerCase(),
    cell: (r) => `<div class="tbl-primary">${escHtml(r.name)}</div><div class="tbl-secondary">${r.industry ? escHtml(r.co!.industries.join(', ')) : '<span class="t-amber">Industry unknown</span>'}</div>` },
  { key: 'relationship', label: 'Relationship', shown: true, sort: (r) => RELATIONSHIP_RANK[r.rel.label] ?? 9,
    cell: (r) => `<span class="rec-badge tone-${r.rel.tone}">${escHtml(r.rel.label)}</span>` },
  { key: 'services', label: 'Services', shown: true, sort: (r) => r.activeServices.length * 100 + r.otherServices.length, descFirst: true,
    cell: (r) => {
      const chips = [...r.activeServices.map((s) => `<span class="chip chip-on" title="On retainer">${escHtml(s)}</span>`), ...r.otherServices.map((s) => `<span class="chip chip-quiet" title="Proposed">${escHtml(s)}</span>`)];
      return chips.length ? `<div class="co-type-chips">${chips.slice(0, 3).join('')}${chips.length > 3 ? `<span class="chip chip-quiet" title="${escHtml([...r.activeServices, ...r.otherServices].slice(3).join(', '))}">+${chips.length - 3}</span>` : ''}</div>` : muted;
    } },
  { key: 'mrr', label: 'MRR', shown: true, sort: (r) => r.mrr, descFirst: true, className: 'td-num',
    cell: (r) => (r.mrrStr ? `<span class="t-positive fw-600">${r.mrrStr}</span>` : muted) },
  { key: 'renewal', label: 'Agreement ends', shown: true, sort: (r) => r.renewal,
    cell: (r) => {
      if (!r.renewal) return muted;
      const days = daysUntil(r.renewal) ?? 0;
      const tone = days <= 30 ? 't-danger' : days <= 90 ? 't-amber' : 't-sub';
      return `<div>${fmtDate(r.renewal)}</div><div class="tbl-secondary ${tone}">in ${plural(days, 'day', 'days')}</div>`;
    } },
  { key: 'pipeline', label: 'Open deals', shown: true, sort: (r) => r.openOpps + r.openProposals, descFirst: true,
    cell: (r) => (r.openOpps || r.openProposals ? [r.openOpps ? plural(r.openOpps, 'opportunity', 'opportunities') : '', r.openProposals ? plural(r.openProposals, 'proposal', 'proposals') : ''].filter(Boolean).map((t) => `<div>${t}</div>`).join('') : muted) },
  { key: 'contacts', label: 'Contacts', shown: true, sort: (r) => r.d.contacts.length, descFirst: true, className: 'td-num',
    cell: (r) => (r.d.contacts.length ? String(r.d.contacts.length) : '<span class="t-amber">None</span>') },
  { key: 'activity', label: 'Last activity', shown: true, sort: (r) => r.lastActivity, descFirst: true, cell: (r) => agoLabel(r.lastActivity) },
  { key: 'owner', label: 'Owner', shown: false, sort: (r) => r.co?.owner || '', cell: (r) => (r.co?.owner ? escHtml(r.co.owner) : muted) },
  { key: 'location', label: 'Location', shown: false, sort: (r) => locationOf(r.co), cell: (r) => escHtml(locationOf(r.co)) || muted },
  { key: 'website', label: 'Website', shown: false, sort: (r) => r.co?.website || '', cell: (r) => (r.co?.website ? escHtml(r.co.website.replace(/^https?:\/\//, '')) : muted) },
  { key: 'lists', label: 'Lists', shown: false, sort: (r) => r.lists.join(', '), cell: (r) => r.lists.map((l) => `<span class="ct-list-tag">${escHtml(l)}</span>`).join(' ') || muted },
  { key: 'proposals', label: 'Proposals', shown: false, sort: (r) => r.d.proposals.length, descFirst: true, className: 'td-num', cell: (r) => String(r.d.proposals.length) },
  { key: 'agreements', label: 'Agreements', shown: false, sort: (r) => r.d.agreements.length, descFirst: true, className: 'td-num', cell: (r) => String(r.d.agreements.length) },
  { key: 'latest', label: 'Latest proposal', shown: false, sort: (r) => r.d.latestStatus || '', cell: (r) => (r.statusCfg && r.d.latestStatus ? statusDot(r.statusCfg, r.d.latestStatus) : muted) },
  { key: 'since', label: 'First proposal', shown: false, sort: (r) => r.d.clientSince, cell: (r) => (r.d.clientSince ? fmtDate(r.d.clientSince) : muted) },
];

const COMPANY_SORT_DEFAULT: SortState = { key: 'relationship', dir: 'asc' };

export function sortCompanies(key: string): void {
  setSort('companies', COMPANY_COLUMNS, key, COMPANY_SORT_DEFAULT);
  renderCompanyList();
}
expose('sortCompanies', sortCompanies);

/** The sort menu (for the grid) picks a column and its natural direction. */
export function sortCompaniesFromSelect(key: string): void {
  const col = COMPANY_COLUMNS.find((c) => c.key === key);
  const cur = sortState('companies', COMPANY_COLUMNS, COMPANY_SORT_DEFAULT);
  if (col && cur.key !== key) setSort('companies', COMPANY_COLUMNS, key, COMPANY_SORT_DEFAULT);
  renderCompanyList();
}
expose('sortCompaniesFromSelect', sortCompaniesFromSelect);

export function openCompanyColumns(e: MouseEvent): void {
  e.stopPropagation();
  openColumnPicker(e.currentTarget as HTMLElement, 'companies', COMPANY_COLUMNS, () => renderCompanyList());
}
expose('openCompanyColumns', openCompanyColumns);

export function renderCompanyList(): void {
  void loadReviewQueue();
  const filters = readCompanyFilters();
  const industrySel = document.getElementById('co-filter-industry') as HTMLSelectElement | null;
  const ownerSel = document.getElementById('co-filter-owner') as HTMLSelectElement | null;
  const serviceSel = document.getElementById('co-filter-service') as HTMLSelectElement | null;
  const locationSel = document.getElementById('co-filter-location') as HTMLSelectElement | null;

  const allNames = getAllCompanies();
  renderQualityBar(allNames);
  const byName = new Map(S.companies.map((c) => [c.name, c] as const));

  if (industrySel) {
    const industries = [...new Set(S.companies.flatMap((c) => c.industries))].sort((a, b) => a.localeCompare(b));
    industrySel.innerHTML = `<option value="">All industries</option>${industries.map((i) => `<option value="${escHtml(i)}" ${filters.industry === i ? 'selected' : ''}>${escHtml(i)}</option>`).join('')}`;
  }
  if (ownerSel) {
    ownerSel.innerHTML = ownerFilterOptions(S.companies.map((c) => c.owner), filters.owner || '');
  }
  const services = servicesByCompanyName();
  if (serviceSel) {
    const all = [...new Set([...services.values()].flatMap((x) => [...x]))].sort((a, b) => a.localeCompare(b));
    serviceSel.innerHTML = `<option value="">Any service</option>${all.map((sv) => `<option value="${escHtml(sv)}" ${filters.service === sv ? 'selected' : ''}>${escHtml(sv)}</option>`).join('')}`;
  }
  if (locationSel) {
    const countries = [...new Set(S.companies.map((c) => c.country).filter(Boolean) as string[])].sort();
    const cities = [...new Set(S.companies.map((c) => locationOf(c)).filter((l) => l.includes(',')))].sort();
    locationSel.innerHTML = `<option value="">Anywhere</option>`
      + (countries.length ? `<optgroup label="Country">${countries.map((c) => `<option value="country:${escHtml(c)}" ${filters.location === `country:${c}` ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}</optgroup>` : '')
      + (cities.length ? `<optgroup label="City">${cities.map((c) => `<option value="city:${escHtml(c)}" ${filters.location === `city:${c}` ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}</optgroup>` : '')
      + `<option value="none" ${filters.location === 'none' ? 'selected' : ''}>No location</option>`;
  }

  renderCompanyListsBar(filters);
  const list = activeCompanyList();
  if (!list && activeCompanyListId) setActiveCompanyList(null);
  let names = matchingCompanyNames(filters);
  if (list) {
    const inList = new Set(companyNamesInList(list));
    names = names.filter((n) => inList.has(n));
  }

  const listsByName = new Map<string, string[]>();
  for (const l of companyLists()) for (const n of companyNamesInList(l)) listsByName.set(n, [...(listsByName.get(n) || []), l.name]);
  const sort = sortState('companies', COMPANY_COLUMNS, COMPANY_SORT_DEFAULT);
  const sortSel = document.getElementById('co-sort') as HTMLSelectElement | null;
  if (sortSel) sortSel.value = sort.key;
  const rows = sortRows(names.map((n) => buildCoRow(n, byName, listsByName, services)), COMPANY_COLUMNS, sort);

  const cntEl = document.getElementById('co-cnt');
  if (cntEl) cntEl.textContent = `${rows.length} compan${rows.length === 1 ? 'y' : 'ies'}${list ? ` in ${list.name}` : ''}`;
  const grid = document.getElementById('co-grid');
  if (!grid) return;
  const columns = shownColumns('companies', COMPANY_COLUMNS);
  const thead = document.getElementById('co-thead');
  if (thead) thead.innerHTML = `<tr><th class="td-chk"><input type="checkbox" id="co-select-all" onchange="coSelectAll(this.checked)" aria-label="Select all"></th>${headerCells(columns, sort, 'sortCompanies')}</tr>`;
  coVisibleNames = rows.map((r) => r.name);
  if (rows.length === 0) {
    const body = list && !Object.keys(filters).length
      ? { icon: 'tag', title: `${list.name} is empty`, body: 'Switch to the list view, select companies, then choose Add to list.' }
      : { icon: 'building', title: 'No companies match these filters', body: 'Try a different search, or clear the filters.' };
    grid.innerHTML = `<div class="grid-span-all">${emptyState(body)}</div>`;
    const tbody = document.getElementById('co-tbody'); if (tbody) tbody.innerHTML = `<tr><td colspan="${columns.length + 1}" class="empty">${escHtml(body.title)} — ${escHtml(body.body)}</td></tr>`;
    setCoListView(S.coListView);
    return;
  }

  grid.innerHTML = rows.map(({ name, d, rel, color, initials, mrrStr, industry, activeServices, otherServices, opportunityCount, projectCount }) => {
    const escName = escHtml(name).replace(/'/g, "\\'");
    const types = [...activeServices, ...otherServices];
    // Counts read as one quiet line; a zero is greyed rather than boxed, and
    // agreements are left off entirely for a company that has none and isn't
    // a client — a card shouldn't lead with what a company doesn't have.
    const stat = (n: number, one: string, many: string) =>
      `<span class="${n === 0 ? 'co-stat zero' : 'co-stat'}"><b>${n}</b> ${n === 1 ? one : many}</span>`;
    const showAgreements = d.agreements.length > 0 || rel.label === 'Active client';
    // Missing data becomes something to act on, not a blank line.
    const flag = !industry ? 'Needs industry' : d.contacts.length === 0 ? 'Needs contact' : '';
    const record = S.companies.find((c) => c.name === name);
    const place = [record?.city, record?.country].filter(Boolean).join(', ');
    const sub = [industry, place].filter(Boolean).join(' · ') || (d.clientSince ? `Client since ${fmtDate(d.clientSince)}` : 'Added recently');
    return `<div class="co-card" onclick="openCompanyDetail('${escName}')" oncontextmenu="companyContextMenu(event,'${escName}')">
      ${flag ? `<span class="co-flag">${escHtml(flag)}</span>` : ''}
      <div class="co-head">
        <div class="co-avatar" style="background:${color}">${initials}</div>
        <div class="co-id">
          <div class="co-name">${escHtml(name)}</div>
          <div class="co-sub">${escHtml(sub)}</div>
        </div>
        <span class="co-dot tone-${rel.tone}" title="${escHtml(rel.label)}"></span>
      </div>
      <div class="co-type-chips">${types.slice(0, 2).map((t) => `<span class="chip${activeServices.includes(t) ? ' chip-on' : ''}">${escHtml(t)}</span>`).join('')}${types.length > 2 ? `<span class="chip chip-more">+${types.length - 2}</span>` : ''}</div>
      <div class="co-footer">
        <span class="co-stats">
          ${stat(d.contacts.length, 'contact', 'contacts')}
          ${stat(d.proposals.length, 'proposal', 'proposals')}
          ${showAgreements ? stat(d.agreements.length, 'agreement', 'agreements') : ''}
          ${opportunityCount > 0 ? stat(opportunityCount, 'opportunity', 'opportunities') : ''}
          ${projectCount > 0 ? stat(projectCount, 'project', 'projects') : ''}
        </span>
        <span class="co-state tone-${rel.tone}">${escHtml(rel.label)}${mrrStr ? ` · ${mrrStr}` : ''}</span>
      </div>
    </div>`;
  }).join('');

  const tbody = document.getElementById('co-tbody');
  if (tbody) {
    const allBox = document.getElementById('co-select-all') as HTMLInputElement | null;
    if (allBox) allBox.checked = rows.every((r) => coSelected.has(r.name));
    tbody.innerHTML = rows.map((r) => {
      const esc = escHtml(r.name).replace(/'/g, '&#39;');
      return `<tr class="co-row${coSelected.has(r.name) ? ' is-selected' : ''}" data-company="${esc}" onclick="if(!event.target.closest('input'))openCompanyDetail(this.dataset.company)" oncontextmenu="companyContextMenu(event,this.dataset.company)">
      <td class="td-chk"><input type="checkbox" ${coSelected.has(r.name) ? 'checked' : ''} onchange="coSelect(this.closest('tr').dataset.company, this.checked)" aria-label="Select ${esc}"></td>
      ${columns.map((c) => `<td class="${c.className || ''}">${c.cell(r)}</td>`).join('')}
    </tr>`;
    }).join('');
  }
  setCoListView(S.coListView);
  updateCoBulkBar();
}
// With a company open, a refresh re-renders its page (previously only the
// hidden list refreshed, leaving the open page stale until reopened).
registerTabRenderer('companies', () => {
  if (S.currentCompany && document.getElementById('co-detail')?.classList.contains('open')) renderCompanyDetail();
  else renderCompanyList();
});
expose('renderCompanyList', renderCompanyList);

/** For exports: the relationship label the Companies list shows. */
export function companyRelationship(name: string): { label: string; tone: string } {
  return relationshipStatus(buildCompanyData(name));
}
expose('companyRelationship', companyRelationship);

export function openCompanyDetail(name: string): void {
  if (S.currentCompany !== name) setCompanyEditing(false);
  const changed = S.currentCompany !== name;
  S.currentCompany = name;
  document.getElementById('co-list-view')?.classList.add('hidden');
  document.getElementById('co-detail')?.classList.add('open');
  if (changed) window.scrollTo(0, 0);
  renderCompanyDetail();
  notifyNavigated();
}
expose('openCompanyDetail', openCompanyDetail);

export function closeCompanyDetail(): void {
  S.currentCompany = null;
  document.getElementById('co-detail')?.classList.remove('open');
  document.getElementById('co-list-view')?.classList.remove('hidden');
  notifyNavigated();
  // Edits made on the company page (industry, owner, name) show in the list.
  renderCompanyList();
}
expose('closeCompanyDetail', closeCompanyDetail);

// ═══════════════ Company page ═══════════════
// One page per client, in relationship order: who they are, where we stand,
// the people, the pipeline, the paperwork, the work, and everything that
// happened — with a section bar to jump between them.

const money = (v: number, currency = 'SAR') => fmtMoney(Math.round(v), currency);

function companyOpportunities(d: CompanyData) {
  const ref = { id: d.companyId, name: d.name };
  return S.opportunities.filter((o) => inCompany(ref, o.companyId, o.companyName) && !o.archived);
}

function relationshipStatus(d: CompanyData): { label: string; tone: string } {
  if (d.clientAgreements.length > 0) return { label: 'Active client', tone: 'green' };
  const openOpps = companyOpportunities(d).filter((o) => o.status === 'Open').length;
  if (openOpps > 0 || d.proposals.some((p) => !p.archived && isOpenProposal(p))) return { label: 'In discussion', tone: 'amber' };
  if (d.proposals.some((p) => isLost(p) || isWon(p))) return { label: 'Past client or prospect', tone: 'muted' };
  return { label: 'Prospect', tone: 'accent' };
}

function renderCompanyDetail(): void {
  if (!S.currentCompany) return;
  const d = buildCompanyData(S.currentCompany);
  const co = currentCompanyRecord();
  const ref = { id: d.companyId, name: d.name };
  const opps = companyOpportunities(d);
  const projects = S.projects.filter((p) => inCompany(ref, p.companyId, p.companyName) && !p.archived);
  const meetings = S.meetings.filter((m) => inCompany(ref, m.companyId, m.companyName));
  const notes = S.notes.filter((n) => inCompany(ref, n.companyId, n.clientName));
  const tasks = S.todos.filter((t) => inCompany(ref, t.companyId, t.client));

  // Header
  const avatar = document.getElementById('co-avatar');
  if (avatar) {
    avatar.textContent = d.name.split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
    avatar.style.background = strColor(d.name);
  }
  (document.getElementById('co-detail-name') as HTMLElement).textContent = d.name;
  const status = relationshipStatus(d);
  const badges = [
    `<span class="rec-badge tone-${status.tone}">${status.label}</span>`,
    ...(co?.industries || []).map((i) => `<span class="rec-badge">${escHtml(i)}</span>`),
    co?.owner ? `<span class="rec-meta">${icon('people', 12)} ${escHtml(co.owner)}</span>` : '',
    co?.city || co?.country ? `<span class="rec-meta">${escHtml([co?.city, co?.country].filter(Boolean).join(', '))}</span>` : '',
    d.clientSince ? `<span class="rec-meta">Since ${fmtDate(d.clientSince)}</span>` : '',
  ].filter(Boolean);
  (document.getElementById('co-detail-meta') as HTMLElement).innerHTML = badges.join('');

  // Relationship counts — each jumps to its section.
  const openOpps = opps.filter((o) => o.status === 'Open');
  const pipeline = openOpps.reduce((s, o) => s + (o.estimatedValue || 0), 0);
  const activeProposals = d.proposals.filter((p) => !p.archived && isOpenProposal(p));
  // Active MRR is a key fact below; the tiles answer "what's happening" (meetings, open work).
  const todayIso = today();
  const lastMeeting = meetings.filter((m) => !m.isCancelled).map((m) => m.meetingDate || '').filter((x) => x && x <= todayIso).sort().pop() || null;
  const openTasks = tasks.filter((t) => t.status !== 'Done' && t.parentId == null);
  const overdueTasks = openTasks.filter((t) => t.dueDate && t.dueDate < todayIso).length;
  const stat = (section: string, label: string, value: string | number, sub = '') =>
    `<button class="rec-stat" onclick="scrollToCompanySection('${section}')"><span class="rec-stat-val">${value}</span><span class="rec-stat-lbl">${label}</span>${sub ? `<span class="rec-stat-sub">${sub}</span>` : ''}</button>`;
  (document.getElementById('co-detail-kpis') as HTMLElement).innerHTML = [
    stat('contacts', 'Contacts', d.contacts.length),
    stat('opportunities', 'Open opportunities', openOpps.length, pipeline ? money(pipeline) : ''),
    stat('proposals', 'Active proposals', activeProposals.length, `${d.proposals.length} total`),
    stat('projects', 'Active projects', projects.filter((p) => !['Completed', 'Cancelled'].includes(p.status)).length),
    stat('agreements', 'Signed agreements', d.signedAgreements.length, d.activeAgreements.length ? `${d.activeAgreements.length} in progress` : ''),
    stat('meetings', 'Meetings', meetings.length, lastMeeting ? `Last ${fmtDate(lastMeeting)}` : ''),
    stat('tasks', 'Open tasks', openTasks.length, overdueTasks ? `${overdueTasks} overdue` : ''),
  ].join('');

  renderCompanyFacts(d);
  void loadCompanyNoteEntries();
  if (d.companyId != null) void renderLinkedEmailsForCompany(d.companyId, 'co-emails');

  renderCompanySectionNav({
    overview: null, contacts: d.contacts.length, opportunities: opps.length, proposals: d.proposals.length,
    projects: projects.length, agreements: d.agreements.length, meetings: meetings.length, notes: notes.length,
    tasks: tasks.filter((t) => t.status !== 'Done').length, files: null, activity: null,
  });
  renderCoContacts(d);
  renderCoOpportunities(d, opps);
  renderCoProposals(d);
  renderCoAgreements(d);
  renderCoNotesSection(d);
  renderCoTodosSection(d);
  // Projects and meetings render through window to avoid an import cycle.
  (window as any).renderCoProjectsSection?.(d);
  (window as any).renderCoMeetingsSection?.(d);
  void renderCoFiles(d);
  void renderCoActivity(d);
  renderIcons(document.getElementById('co-detail') || document);
}
registerCompanyViewRefresher(() => {
  if (S.currentCompany && document.getElementById('co-detail')?.classList.contains('open')) renderCompanyDetail();
  else renderCompanyList();
});

function renderCompanyFacts(d: CompanyData): void {
  const co = currentCompanyRecord();
  const el = document.getElementById('co-facts');
  if (!el) return;
  const services = [...new Set(d.clientAgreements.flatMap((a) => (a.lines?.length ? a.lines.map((l) => l.serviceName) : [a.type || ''])).filter(Boolean))];
  const nextEnd = d.clientAgreements.map((a) => a.endDate).filter(Boolean).sort()[0] || null;
  const fact = (label: string, value: string) => `<dt>${label}</dt><dd>${value}</dd>`;
  const websiteHint = co && !co.website ? suggestWebsites().find((s) => s.company.id === co.id) : undefined;
  const add = (label: string) => `<a href="#" class="rec-add-link" onclick="event.preventDefault();openEditCompanyModal()">Add ${label}</a>`;
  el.innerHTML = [
    fact('Industry', co?.industries.length ? co.industries.map(escHtml).join(', ') : add('industry')),
    fact('Owner', co?.owner ? escHtml(co.owner) : add('owner')),
    fact('Website', !co?.website && websiteHint ? `<span class="rec-muted">${escHtml(websiteHint.domain)}?</span> <a href="#" class="rec-add-link" onclick="event.preventDefault();useSuggestedWebsite(${co!.id}, '${escHtml(websiteHint.domain)}')">Use it</a>` : co?.website ? `<a class="rlink" href="#" onclick="event.preventDefault();openExternalUrl('${escHtml(/^https?:/.test(co.website) ? co.website : `https://${co.website}`)}')">${escHtml(co.website.replace(/^https?:\/\//, ''))}</a>` : add('website')),
    fact('Location', escHtml([co?.city, co?.country].filter(Boolean).join(', ')) || '<span class="rec-muted">—</span>'),
    fact('Lists', (() => {
      const lists = listsForCompany(d.name);
      const chips = lists.map((l) => `<span class="ct-list-tag" title="${l.filters ? 'Smart list' : 'Hand-picked list'}">${escHtml(l.name)}</span>`).join(' ');
      return `${chips || '<span class="rec-muted">Not in a list</span>'} <a href="#" class="rec-add-link" onclick="event.preventDefault();companyAddToListMenu(event)">Add to list</a>`;
    })()),
    fact('On retainer', services.length ? services.map((sv) => `<span class="chip">${escHtml(sv)}</span>`).join(' ') : '<span class="rec-muted">No active services</span>'),
    fact('Active MRR', Object.keys(d.activeMrr).length ? `<strong>${fmtMoneyByCurrency(d.activeMrr)}</strong>` : '<span class="rec-muted">—</span>'),
    fact('Agreement ends', nextEnd ? fmtDate(nextEnd) : '<span class="rec-muted">—</span>'),
    fact('Client since', d.clientSince ? fmtDate(d.clientSince) : '<span class="rec-muted">—</span>'),
    fact('Latest proposal', d.latestStatus ? escHtml(d.latestStatus) : '<span class="rec-muted">—</span>'),
  ].join('');
}

const COMPANY_SECTIONS: [string, string][] = [
  ['overview', 'Overview'], ['contacts', 'Contacts'], ['opportunities', 'Opportunities'], ['proposals', 'Proposals'],
  ['projects', 'Projects'], ['agreements', 'Agreements'], ['meetings', 'Meetings'], ['notes', 'Notes'],
  ['tasks', 'Tasks'], ['files', 'Files'], ['activity', 'Activity'],
];

function renderCompanySectionNav(counts: Record<string, number | null>): void {
  const nav = document.getElementById('co-section-nav');
  if (!nav) return;
  nav.innerHTML = COMPANY_SECTIONS.map(([id, label]) => {
    const n = counts[id];
    return `<button class="rec-section-link${counts[id] === 0 ? ' is-empty' : ''}" data-target="${id}" onclick="scrollToCompanySection('${id}')">${label}${n ? `<span>${n}</span>` : ''}</button>`;
  }).join('');
  applyCompanySectionLayout(counts);
  updateCompanySectionSpy();
}

/**
 * What this company actually has comes first. A section with nothing in it
 * collapses to a single line and moves below the ones with content, so a
 * client with proposals and agreements isn't two screens of "No opportunities
 * yet" before you reach them.
 *
 * Nothing is removed: the collapsed line keeps its + New button, and clicking
 * it opens the section.
 */
function applyCompanySectionLayout(counts: Record<string, number | null>): void {
  const anchor = document.getElementById('co-sec-files');
  const host = anchor?.parentElement;
  if (!host || !anchor) return;
  const movable = COMPANY_SECTIONS.filter(([id]) => !['overview', 'activity', 'files'].includes(id));
  const empties: HTMLElement[] = [];
  for (const [id] of movable) {
    const el = document.getElementById(`co-sec-${id}`);
    if (!el) continue;
    const empty = counts[id] === 0;
    el.classList.toggle('is-empty', empty);
    const hd = el.querySelector('.rec-section-hd');
    let hint = el.querySelector<HTMLElement>('.rec-empty-hint');
    if (empty && !hint && hd) {
      hint = document.createElement('span');
      hint.className = 'rec-empty-hint';
      hint.textContent = 'None yet';
      hint.title = 'Click to open this section';
      hint.onclick = () => expandCompanySection(id);
      hd.insertBefore(hint, hd.querySelector('.rec-section-actions'));
    } else if (!empty && hint) {
      hint.remove();
    }
    if (empty) empties.push(el);
    else host.insertBefore(el, anchor); // sections with content keep their order, above Files
  }
  for (const el of empties) host.insertBefore(el, anchor); // then the empty ones, together
}

/** Clicking a collapsed section opens it for this visit. */
export function expandCompanySection(id: string): void {
  document.getElementById(`co-sec-${id}`)?.classList.remove('is-empty');
}
expose('expandCompanySection', expandCompanySection);

export function scrollToCompanySection(id: string): void {
  const el = document.getElementById(`co-sec-${id}`);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - 44 - 52;
  window.scrollTo({ top: id === 'overview' ? 0 : top, behavior: 'smooth' });
}
expose('scrollToCompanySection', scrollToCompanySection);

/** Highlights the section currently under the sticky bars. */
function updateCompanySectionSpy(): void {
  if (!document.getElementById('co-detail')?.classList.contains('open')) return;
  let active = 'overview';
  for (const [id] of COMPANY_SECTIONS) {
    const el = document.getElementById(`co-sec-${id}`);
    if (el && el.getBoundingClientRect().top - 110 <= 0) active = id;
  }
  if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) active = 'activity';
  document.querySelectorAll<HTMLElement>('#co-section-nav .rec-section-link').forEach((b) => b.classList.toggle('active', b.dataset.target === active));
}
window.addEventListener('scroll', () => { if (S.currentTab === 'companies') updateCompanySectionSpy(); }, { passive: true });

function autoGrowNotes(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${Math.max(96, el.scrollHeight)}px`;
}

// ── Company notes: a dated log ───────────────────────────────────────────────
// Notes used to be one text box that each edit overwrote. They are entries
// now: write one, press Enter, and it is kept with its date. What was written
// in March is still there after a note added in September.

let noteEntries: CompanyNoteEntry[] = [];
let editingEntryId: number | null = null;

function noteTarget(): { id: number | null; name: string | null } {
  const name = S.currentCompany || null;
  const rec = name ? S.companies.find((c) => c.name === name) : undefined;
  return { id: rec?.id ?? null, name };
}

export async function loadCompanyNoteEntries(): Promise<void> {
  const { id, name } = noteTarget();
  if (!name && id == null) return;
  try {
    noteEntries = await companyNoteEntries(id, name);
  } catch (e) {
    console.error('[company notes] could not load entries:', e);
    noteEntries = [];
  }
  renderCompanyNoteLog();
}

function renderCompanyNoteLog(): void {
  const log = document.getElementById('co-notes-log');
  if (!log) return;
  const count = document.getElementById('co-notes-entry-count');
  if (count) count.textContent = noteEntries.length ? String(noteEntries.length) : '';
  if (noteEntries.length === 0) {
    log.innerHTML = `<div class="conote-none">No notes yet. The first one you write is kept with today's date.</div>`;
    return;
  }
  log.innerHTML = noteEntries.map((n) => {
    const when = n.isLegacy ? 'Written before notes were dated' : fmtDate(n.createdAt.slice(0, 10));
    const edited = n.updatedAt && !n.isLegacy ? ` · edited ${fmtDate(n.updatedAt.slice(0, 10))}` : '';
    if (editingEntryId === n.id) {
      return `<div class="conote-entry editing">
        <textarea class="rec-notes conote-input" id="conote-edit-${n.id}">${escHtml(n.body)}</textarea>
        <div class="conote-entry-actions">
          <button class="btn-secondary btn-sm" onclick="cancelCompanyNoteEdit()">Cancel</button>
          <button class="btn-sm btn-primary" onclick="saveCompanyNoteEdit(${n.id})">Save</button>
        </div>
      </div>`;
    }
    return `<div class="conote-entry">
      <div class="conote-meta"><span>${escHtml(when)}${escHtml(edited)}</span>
        <span class="conote-entry-actions">
          <button class="rec-icon-btn" title="Edit" aria-label="Edit note" onclick="editCompanyNoteEntry(${n.id})">${icon('edit', 13)}</button>
          <button class="rec-icon-btn" title="Delete" aria-label="Delete note" onclick="removeCompanyNoteEntry(${n.id})">${icon('trash', 13)}</button>
        </span>
      </div>
      <div class="conote-body">${escHtml(n.body)}</div>
    </div>`;
  }).join('');
  renderIcons(log);
}

export function companyNoteComposerInput(el: HTMLTextAreaElement): void {
  autoGrowNotes(el);
}
expose('companyNoteComposerInput', companyNoteComposerInput);

/** Enter saves the note; Shift+Enter starts a new line. */
export function companyNoteComposerKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void addCompanyNoteEntry();
  }
}
expose('companyNoteComposerKey', companyNoteComposerKey);

export async function addCompanyNoteEntry(): Promise<void> {
  const el = document.getElementById('co-notes-text') as HTMLTextAreaElement | null;
  const body = (el?.value || '').trim();
  if (!body) return;
  const { id, name } = noteTarget();
  try {
    const entry = await addCompanyNoteEntryDb(id, name, body);
    noteEntries.unshift(entry);
  } catch (err) {
    toast('Could not save the note', { tone: 'error', detail: String(err) });
    return;
  }
  if (el) { el.value = ''; autoGrowNotes(el); }
  renderCompanyNoteLog();
}
expose('addCompanyNoteEntry', addCompanyNoteEntry);

export function editCompanyNoteEntry(id: number): void {
  editingEntryId = id;
  renderCompanyNoteLog();
  document.getElementById(`conote-edit-${id}`)?.focus();
}
expose('editCompanyNoteEntry', editCompanyNoteEntry);

export function cancelCompanyNoteEdit(): void {
  editingEntryId = null;
  renderCompanyNoteLog();
}
expose('cancelCompanyNoteEdit', cancelCompanyNoteEdit);

export async function saveCompanyNoteEdit(id: number): Promise<void> {
  const el = document.getElementById(`conote-edit-${id}`) as HTMLTextAreaElement | null;
  const body = (el?.value || '').trim();
  if (!body) return;
  try {
    const saved = await updateCompanyNoteEntryDb(id, body);
    const i = noteEntries.findIndex((n) => n.id === id);
    if (i > -1) noteEntries[i] = saved;
  } catch (err) {
    toast('Could not save the note', { tone: 'error', detail: String(err) });
    return;
  }
  editingEntryId = null;
  renderCompanyNoteLog();
}
expose('saveCompanyNoteEdit', saveCompanyNoteEdit);

export async function removeCompanyNoteEntry(id: number): Promise<void> {
  const entry = noteEntries.find((n) => n.id === id);
  if (!entry) return;
  if (!(await showConfirm('This note will be removed from the company\'s log.', { title: 'Delete this note?', confirmLabel: 'Delete' }))) return;
  try {
    await deleteCompanyNoteEntryDb(id);
  } catch (err) {
    toast('Could not delete the note', { tone: 'error', detail: String(err) });
    return;
  }
  noteEntries = noteEntries.filter((n) => n.id !== id);
  renderCompanyNoteLog();
}
expose('removeCompanyNoteEntry', removeCompanyNoteEntry);

/** The header's "New" menu — the shared list for the open record (core/contextActions). */
export function companyNewMenu(e: MouseEvent): void {
  (window as any).recordNewMenu(e);
}
expose('companyNewMenu', companyNewMenu);

export function companyMoreMenu(e: MouseEvent): void {
  e.stopPropagation();
  const name = S.currentCompany;
  if (!name) return;
  showMenuAt(e.currentTarget as HTMLElement, [
    { label: 'Edit details', iconName: 'edit', run: () => openEditCompanyModal() },
    { label: 'Log a note on a proposal', iconName: 'note', run: () => { void openActivityNote(); } },
    { label: 'Copy name', iconName: 'copy', run: () => { void navigator.clipboard?.writeText(name).then(() => toast('Company name copied')); } },
    { label: 'Add to list…', iconName: 'tag', run: () => showMenuAt(document.querySelector<HTMLElement>('#co-detail .rec-more') || document.body, addToCompanyListChoices(() => [name])) },
    { label: 'Export contacts to ActiveCampaign', iconName: 'mail', run: () => { void exportToActiveCampaign(contactsAtCompanies([name]), name); } },
    { label: '', run: () => {}, separator: true },
    { label: 'Merge into another company…', iconName: 'repeat', run: () => openMergeCompanyForCurrent() },
  ]);
}
expose('companyMoreMenu', companyMoreMenu);

export function companyAddToListMenu(e: MouseEvent): void {
  e.stopPropagation();
  const name = S.currentCompany;
  if (name) showMenuAt(e.currentTarget as HTMLElement, addToCompanyListChoices(() => [name]));
}
expose('companyAddToListMenu', companyAddToListMenu);

export function createOpportunityForCurrentCompany(): void {
  const name = S.currentCompany;
  if (!name) return;
  const co = S.companies.find((c) => c.name === name);
  (window as any).openOpportunityModal?.(null, { companyId: co?.id ?? null, companyName: name, projectId: null, opportunityId: null, meetingId: null, noteId: null });
}
expose('createOpportunityForCurrentCompany', createOpportunityForCurrentCompany);

export function createProposalForCurrentCompany(): void {
  const name = S.currentCompany;
  if (!name) return;
  (window as any).openProposalBuilder?.({ client: name });
}
expose('createProposalForCurrentCompany', createProposalForCurrentCompany);

export function openExternalUrl(url: string): void {
  void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url)).catch(() => window.open(url, '_blank'));
}
expose('openExternalUrl', openExternalUrl);

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
}

/** Call, email, WhatsApp and copy buttons for a contact. */
export function contactActionButtons(c: Contact, size = 14): string {
  const btn = (iconHtml: string, title: string, js: string) => `<button class="rec-icon-btn" title="${title}" aria-label="${title}" onclick="event.stopPropagation();${js}">${iconHtml}</button>`;
  const wa = c.whatsapp || c.phone;
  return [
    c.email ? btn(icon('mail', size), `Email ${escHtml(c.email)}`, `openExternalUrl('mailto:${escHtml(c.email)}')`) : '',
    c.phone ? btn(`<svg width="${size}" height="${size}" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M4.5 2.8h2.3l1.2 3-1.6 1.1a8.5 8.5 0 0 0 4.7 4.7l1.1-1.6 3 1.2v2.3a1.5 1.5 0 0 1-1.6 1.5A12.6 12.6 0 0 1 3 4.4a1.5 1.5 0 0 1 1.5-1.6Z"/></svg>`, `Call ${escHtml(c.phone)}`, `openExternalUrl('tel:${escHtml(c.phone.replace(/[^+0-9]/g, ''))}')`) : '',
    wa ? btn(`<svg width="${size}" height="${size}" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 15l.9-3A6.5 6.5 0 1 1 6.3 14.3Z"/><path d="M7 6.6c.2 1.6 2.6 4 4.3 4.3l.9-1-1.4-.7-.6.6a3.3 3.3 0 0 1-2-2l.6-.6-.7-1.4Z" fill="currentColor" stroke="none"/></svg>`, 'WhatsApp', `openExternalUrl('https://wa.me/${escHtml(wa.replace(/[^0-9]/g, ''))}')`) : '',
    c.email ? btn(icon('copy', size), 'Copy email', `copyText('${escHtml(c.email)}','Email copied')`) : '',
  ].join('');
}

export function copyText(text: string, message = 'Copied'): void {
  void navigator.clipboard?.writeText(text).then(() => toast(message)).catch(() => toast('Could not copy', { tone: 'error' }));
}
expose('copyText', copyText);

export function renderCoContacts(d: CompanyData): void {
  const cntEl = document.getElementById('co-contacts-count'); if (cntEl) cntEl.textContent = d.contacts.length ? String(d.contacts.length) : '';
  const list = document.getElementById('co-contacts-list');
  if (!list) return;
  if (d.contacts.length === 0) {
    list.innerHTML = emptyState({ icon: 'people', title: 'No contacts yet', body: 'Add the people you deal with here so everyone knows who to call.', compact: true, action: { label: 'New contact', onclick: 'openContactForCompany()' } });
    return;
  }
  list.innerHTML = d.contacts.map((c) => `<div class="rec-row" onclick="openRecord('contact', ${c.id})" data-drag-kind="contact" data-drag-id="${c.id}">
    <span class="rec-row-avatar" style="background:${strColor(c.name || '?')}">${escHtml(initials(c.name || '?'))}</span>
    <div class="rec-row-main">
      <div class="rec-row-title">${recordLink('contact', c.id, c.name || 'Unnamed contact')}</div>
      <div class="rec-row-sub">${escHtml([c.role, c.email].filter(Boolean).join(' · ') || 'No details yet')}</div>
    </div>
    <div class="rec-row-actions">${contactActionButtons(c)}</div>
  </div>`).join('');
}

function renderCoOpportunities(d: CompanyData, opps: Opportunity[]): void {
  const cntEl = document.getElementById('co-opps-count'); if (cntEl) cntEl.textContent = opps.length ? String(opps.length) : '';
  const list = document.getElementById('co-opps-list');
  if (!list) return;
  if (!opps.length) {
    list.innerHTML = emptyState({ icon: 'briefcase', title: 'No opportunities', body: `Track the next piece of business with ${d.name} here.`, compact: true, action: { label: 'New opportunity', onclick: 'createOpportunityForCurrentCompany()' } });
    return;
  }
  const order: Record<string, number> = { Open: 0, 'On Hold': 1, Won: 2, Lost: 3 };
  list.innerHTML = [...opps].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || (a.expectedCloseDate || '9').localeCompare(b.expectedCloseDate || '9')).map((o) => {
    const tone = o.status === 'Won' ? 'green' : o.status === 'Lost' ? 'red' : o.status === 'On Hold' ? 'muted' : 'accent';
    const value = o.estimatedValue ? `${o.currency || 'SAR'} ${Number(o.estimatedValue).toLocaleString()}` : '';
    return `<div class="rec-row" onclick="openRecord('opportunity', ${o.id})">
      <span class="rec-row-icon">${icon('briefcase', 15)}</span>
      <div class="rec-row-main">
        <div class="rec-row-title">${recordLink('opportunity', o.id, o.name)}</div>
        <div class="rec-row-sub">${escHtml([o.nextAction ? `Next: ${o.nextAction}` : '', o.expectedCloseDate ? `Close ${fmtDate(o.expectedCloseDate)}` : ''].filter(Boolean).join(' · ') || 'No next action set')}</div>
      </div>
      <div class="rec-row-end">${value ? `<span class="rec-row-value">${value}${o.probability != null ? ` · ${o.probability}%` : ''}</span>` : ''}<span class="rec-badge tone-${tone}">${escHtml(o.stage)}</span></div>
    </div>`;
  }).join('');
}

export function renderCoProposals(d: CompanyData): void {
  const cntEl = document.getElementById('co-proposals-count'); if (cntEl) cntEl.textContent = d.proposals.length ? String(d.proposals.length) : '';
  const tbody = document.getElementById('co-proposals-tbody');
  if (!tbody) return;
  if (d.proposals.length === 0) { tbody.innerHTML = `<tr><td colspan="8">${emptyState({ icon: 'database', title: 'No proposals yet', compact: true, action: { label: 'New proposal', onclick: 'createProposalForCurrentCompany()' } })}</td></tr>`; return; }
  const sorted = [...d.proposals].sort((a, b) => (b.sentDate || b.dateAdded || '').localeCompare(a.sentDate || a.dateAdded || ''));
  tbody.innerHTML = sorted.map((p) => {
    const cfg = ST[p.status] || { c: 'var(--muted)', ch: 'var(--muted)' };
    const nc = (p.notes || []).length;
    return `<tr class="rec-tr" onclick="openRecord('proposal', ${p.id})">
      <td class="td-id">${p.id}</td>
      <td class="td-t" title="${escHtml(p.type)}">${escHtml(p.type)}</td>
      <td>${statusDot(cfg, p.status)}</td>
      <td class="td-d">${fmtDate(p.sentDate)}</td>
      <td class="td-d">${fmtDate(p.dblSignedDate)}</td>
      <td class="td-fee">${p.monthlyFee ? money(Number(p.monthlyFee), currencyOf(p)) : '—'}</td>
      <td><button class="btn-secondary btn-sm" onclick="event.stopPropagation();openNotesModal(${p.id})" title="Activity log">${nc > 0 ? `${nc} note${nc === 1 ? '' : 's'}` : 'Log'}</button></td>
      <td>${p.docLink ? `<a href="#" onclick="event.stopPropagation();event.preventDefault();openExternalUrl('${escHtml(p.docLink)}')" class="doc-link-btn">Open</a>` : ''}</td>
    </tr>`;
  }).join('');
}

export function renderCoAgreements(d: CompanyData): void {
  const cntEl = document.getElementById('co-agreements-count'); if (cntEl) cntEl.textContent = d.agreements.length ? String(d.agreements.length) : '';
  const tbody = document.getElementById('co-agreements-tbody');
  if (!tbody) return;
  if (d.agreements.length === 0) { tbody.innerHTML = `<tr><td colspan="8">${emptyState({ icon: 'document', title: 'No agreements yet', compact: true, action: { label: 'New agreement', onclick: 'openAgrForCompany()' } })}</td></tr>`; return; }
  tbody.innerHTML = d.agreements.map((a) => {
    const sc = AGR_ST[a.status || ''] || { c: 'var(--muted)', ch: 'var(--muted)' };
    const pending = '<span class="rec-muted">Pending</span>';
    return `<tr class="rec-tr" onclick="openRecord('agreement', ${a.id})">
      <td class="fw-600">${escHtml(a.agrRef || '—')}</td>
      <td class="td-t">${escHtml(a.type || '—')}</td>
      <td>${statusDot(sc, a.status || '')}</td>
      <td class="td-d">${a.dateSentToClient ? fmtDate(a.dateSentToClient) : '<span class="rec-muted">Not sent</span>'}</td>
      <td class="td-d">${a.dateClientSigned ? fmtDate(a.dateClientSigned) : pending}</td>
      <td class="td-d">${a.dateMenaSigned ? fmtDate(a.dateMenaSigned) : pending}</td>
      <td class="td-fee">${agreementMonthly(a) ? money(Number(agreementMonthly(a)), currencyOf(a)) : '—'}</td>
      <td>${a.docLink ? `<a href="#" onclick="event.stopPropagation();event.preventDefault();openExternalUrl('${escHtml(a.docLink)}')" class="doc-link-btn">Open</a>` : ''}</td>
    </tr>`;
  }).join('');
}

/** Folders linked to this Company via the Microsoft Files setup wizard
 * (entity_links: msfile -> company). The Company detail page is keyed by the
 * free-text client name, not the numeric `companies` table id the Work Graph
 * actually links against, so this resolves that id from S.companies first —
 * a company with no real `companies` row yet (never referenced by an
 * Opportunity or the setup wizard) simply has no folders to show, correctly. */
async function renderCoFiles(d: CompanyData): Promise<void> {
  const inner = document.getElementById('cosub-files-inner');
  const cntEl = document.getElementById('co-files-tab-count');
  if (!inner) return;
  const company = S.companies.find((c) => c.name === d.name);
  if (!company) {
    if (cntEl) cntEl.textContent = '0';
    inner.innerHTML = emptyState({ icon: 'folder', title: 'No folders linked', body: 'Use “Match a folder” above to link this company’s OneDrive folder.', compact: true });
    return;
  }
  const links = await getLinksFor('company', company.id);
  const msfileIds = links.filter((l) => l.toType === 'company' && l.toId === company.id && l.fromType === 'msfile').map((l) => l.fromId);
  if (cntEl) cntEl.textContent = String(msfileIds.length);
  if (msfileIds.length === 0) {
    inner.innerHTML = emptyState({ icon: 'folder', title: 'No folders linked', body: 'Use “Match a folder” above to link this company’s OneDrive folder.', compact: true });
    return;
  }
  const folders = await filesGetByIds(msfileIds);
  inner.innerHTML = `<div class="rec-list">${folders.map((f) => `
    <div class="rec-row${f.exists ? '' : ' is-unavailable'}" onclick="switchTab('files');msFilesNavigateToPath('${escHtml(f.path).replace(/'/g, "\\'")}')">
      <span class="rec-row-icon">${icon('folder', 16)}</span>
      <div class="rec-row-main"><div class="rec-row-title">${escHtml(f.name)}</div><div class="rec-row-sub">${escHtml(f.path)}</div></div>
      ${f.exists ? '' : '<span class="rec-badge tone-red">Unavailable</span>'}
    </div>`).join('')}</div>`;
}

/** Everything that happened with this company: the unified activity log,
 * plus the dated milestones on its proposals and agreements (which cover
 * history from before the log existed). */
async function renderCoActivity(d: CompanyData): Promise<void> {
  const container = document.getElementById('co-timeline');
  if (!container) return;
  const name = d.name;
  const entries = d.companyId != null ? await getActivity({ companyId: d.companyId, limit: 300 }).catch(() => []) : [];
  if (S.currentCompany !== name) return;
  const items: FeedItem[] = entries.map(activityItem);
  const milestone = (at: string | null | undefined, iconName: string, tone: FeedItem['tone'], html: string, detail?: string | null) => {
    if (at) items.push({ at, iconName, tone, html, detail });
  };
  for (const p of d.proposals) {
    const link = recordLink('proposal', p.id, `${p.type || 'Proposal'} (SL#${p.id})`);
    milestone(p.sentDate, 'mail', 'amber', `Proposal sent to client · ${link}`);
    milestone(p.dblSignedDate, 'check', 'green', `Proposal signed by both parties · ${link}`, isWon(p) ? p.winLossReason : null);
    milestone(p.kickoffDate, 'target', 'green', `Service kicked off · ${link}`);
    if (isLost(p)) milestone(p.sentDate || p.dateAdded, 'close', 'red', `Proposal closed as lost · ${link}`, p.winLossReason);
  }
  for (const a of d.agreements) {
    const link = recordLink('agreement', a.id, a.agrRef || a.type || 'Agreement');
    milestone(a.dateSentToClient, 'mail', 'amber', `Agreement sent to client · ${link}`);
    milestone(a.dateClientSigned, 'check', 'green', `Client signed · ${link}`);
    milestone(a.dateMenaSigned, 'check', 'green', `MENA BIG signed · ${link}`);
  }
  for (const m of S.meetings.filter((x) => inCompany({ id: d.companyId, name }, x.companyId, x.companyName))) {
    if (!entries.some((e) => e.entityType === 'meeting' && e.entityId === m.id)) milestone(m.meetingDate, 'meeting', 'accent', `Meeting · ${recordLink('meeting', m.id, m.title)}`);
  }
  const cntEl = document.getElementById('co-activity-count'); if (cntEl) cntEl.textContent = items.length ? String(items.length) : '';
  container.innerHTML = renderFeed(items, { empty: 'Nothing recorded yet. Changes to this company’s proposals, tasks, notes and meetings will appear here.' });
}

export function openContactForCompany(): void {
  if (S.currentCompany) openContactModal(S.currentCompany);
}
expose('openContactForCompany', openContactForCompany);

export function openAgrForCompany(): void {
  if (!S.currentCompany) return;
  openAgrModal(null);
  setTimeout(() => { (document.getElementById('agr-client-inp') as HTMLInputElement).value = S.currentCompany || ''; }, 50);
}
expose('openAgrForCompany', openAgrForCompany);

export async function openActivityNote(): Promise<void> {
  if (!S.currentCompany) return;
  const cp = companyProposals(companyRef(S.currentCompany));
  if (cp.length === 0) { toast('This company has no proposals to log a note against'); return; }
  if (cp.length === 1) { openNotesModal(cp[0].id); return; }
  const opts = cp.map((p) => `${p.id}: ${p.type} (${p.status})`).join('\n');
  const choice = await showTextPrompt({ title: 'Multiple proposals found', label: `Enter SL# to log note:\n${opts}`, placeholder: 'SL#' });
  if (choice) {
    const pid = parseInt(choice);
    if (cp.some((p) => p.id === pid)) openNotesModal(pid);
  }
}
expose('openActivityNote', openActivityNote);

// Parameterless wrappers for the company-detail "Notes"/"Tasks" sub-tab buttons,
// which are static markup (no per-render template interpolation) — matching the
// no-arg pattern already used by openContactForCompany()/openAgrForCompany() above.
export function createNoteForCurrentCompany(): void {
  if (S.currentCompany) createNoteForCompany(S.currentCompany);
}
expose('createNoteForCurrentCompany', createNoteForCurrentCompany);

export function createTodoForCurrentCompany(): void {
  if (S.currentCompany) createTodoForCompany(S.currentCompany);
}
expose('createTodoForCurrentCompany', createTodoForCurrentCompany);

// ═══════════════ LIST SELECTION + BULK ACTIONS ═══════════════

const coSelected = new Set<string>();
let coVisibleNames: string[] = [];

export function coSelect(name: string, on: boolean): void {
  if (on) coSelected.add(name); else coSelected.delete(name);
  document.querySelector(`#co-tbody tr[data-company="${CSS.escape(name)}"]`)?.classList.toggle('is-selected', on);
  updateCoBulkBar();
}
expose('coSelect', coSelect);

export function coSelectAll(on: boolean): void {
  coVisibleNames.forEach((n) => { if (on) coSelected.add(n); else coSelected.delete(n); });
  renderCompanyList();
}
expose('coSelectAll', coSelectAll);

export function coClearSelection(): void {
  coSelected.clear();
  renderCompanyList();
}
expose('coClearSelection', coClearSelection);

/** Saves a change to each selected company (creating the company record for
 * names only known from proposals), with one undo for the batch. */
async function coBulkChange(label: string, change: (c: Company) => Company): Promise<void> {
  const names = [...coSelected];
  if (!names.length) return;
  const before: Company[] = [];
  let changed = 0;
  for (const name of names) {
    const existing = S.companies.find((c) => c.name === name) || await persistCreateCompany(name);
    if (!existing) continue;
    before.push(structuredClone(existing));
    try {
      const saved = await saveCompany(change(existing));
      const i = S.companies.findIndex((c) => c.id === saved.id);
      if (i > -1) S.companies[i] = saved; else S.companies.push(saved);
      changed++;
    } catch (e) { console.error('[companies bulk] save failed:', e); }
  }
  coSelected.clear();
  refreshAll();
  undoToast(`${label}: ${changed} compan${changed === 1 ? 'y' : 'ies'}`, () => {
    void Promise.all(before.map((c) => saveCompany(c).then((saved) => {
      const i = S.companies.findIndex((x) => x.id === saved.id);
      if (i > -1) S.companies[i] = saved;
    }))).then(() => refreshAll());
  });
}

function updateCoBulkBar(): void {
  const list = activeCompanyList();
  const selected = () => [...coSelected];
  renderBulkBar('co-bulk', S.coListView === 'list' ? coSelected.size : 0, ['company', 'companies'], [
    { label: 'Add to list', choices: () => addToCompanyListChoices(selected) },
    ...(list ? [{ label: `Remove from ${list.name}`, run: () => { void removeCompaniesFromList(list.id, selected()).then(() => { coSelected.clear(); renderCompanyList(); }); } }] : []),
    { label: 'Export contacts', run: () => { const names = selected(); void exportToActiveCampaign(contactsAtCompanies(names), names.length === 1 ? names[0] : `${names.length} selected companies`); } },
    { label: 'Owner', choices: () => activeTeam().map((t) => ({ label: t.name, run: () => { void coBulkChange(`Owner set to ${t.name}`, (c) => ({ ...c, owner: t.name })); } })) },
    { label: 'Industry', choices: () => INDUSTRY_TAXONOMY.map((ind) => ({ label: ind, run: () => { void coBulkChange(`Industry: ${ind}`, (c) => ({ ...c, industries: [...new Set([...(c.industries || []), ind])] })); } })) },
    { label: 'Archive', danger: true, run: () => { void coBulkChange('Archived', (c) => ({ ...c, archived: true })); } },
  ], 'coClearSelection()', () => S.currentTab === 'companies' && !document.getElementById('co-detail')?.classList.contains('open') && S.coListView === 'list');
}
