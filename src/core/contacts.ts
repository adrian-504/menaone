import { S } from '../lib/state';
import { companyLink, recordLink } from '../lib/links';
import { registerDragSource, registerDropTarget } from '../lib/dnd';
import { toast } from '../lib/ui';
import { escHtml, nextCtId, getClients, expose, showConfirm, companyRef, inCompany, sameCompany, type CompanyRef } from '../lib/utils';
import { icon } from '../lib/icons';
import { persistContacts, persistContactLists } from '../lib/persist';
import { registerTabRenderer, refreshCompanyViewIfOpen } from '../lib/registry';
import { renderBulkBar } from '../lib/bulkBar';
import { showContextMenu, showMenuAt } from '../lib/contextMenu';
import { shownColumns, sortState, setSort, sortRows, headerCells, openColumnPicker, agoLabel, type Column, type SortState } from '../lib/tableColumns';
import { companyLists, smartContactLists, companyNamesInList, contactsInCompanyList, createSavedList, renameSavedList, removeSavedList, updateSmartListFilters, exportToActiveCampaign, listById, sameFilters, cleanFilters, listChipLabel, newContactList, renameContactList, addContactsToList, removeContactsFromList } from './lists';
import { attachCompanySelector } from '../lib/companySelector';
import { companyFromForm } from '../lib/workGraph';
import type { Contact, SavedList } from '../lib/types';

// ═══════════════ CONTACT MODAL ═══════════════

function refreshClientDatalistAndSelector(): void {
  const dl = document.getElementById('ct-client-list'); if (dl) dl.innerHTML = getClients().map((c) => `<option value="${escHtml(c)}">`).join('');
  const input = document.getElementById('ct-modal-client') as HTMLInputElement | null;
  if (input) attachCompanySelector(input);
}

/** The company a new contact was started from (a company page). */
let contactModalCompany: { companyId: number | null; companyName: string | null } | null = null;

export function openContactModal(clientName?: string | null, companyId?: number | null): void {
  S.ctEditId = null;
  contactModalCompany = clientName ? { companyId: companyId ?? S.companies.find((c) => c.name === clientName)?.id ?? null, companyName: clientName } : null;
  const t = document.getElementById('ct-modal-title'); if (t) t.textContent = 'Add Contact';
  const f = document.getElementById('contact-form') as HTMLFormElement;
  f.reset();
  if (clientName) (document.getElementById('ct-modal-client') as HTMLInputElement).value = clientName;
  document.getElementById('modal-contact')?.classList.add('open');
  refreshClientDatalistAndSelector();
}
expose('openContactModal', openContactModal);

/** Contacts are edited on their page. */
export function editContact(id: number): void {
  (window as any).openRecord('contact', id);
}
expose('editContact', editContact);

export function closeContactModal(): void {
  document.getElementById('modal-contact')?.classList.remove('open');
}
expose('closeContactModal', closeContactModal);

export function submitContact(e: Event): void {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  const obj = {
    name: (f.elements.namedItem('ct-name') as HTMLInputElement).value.trim(),
    clientName: (f.elements.namedItem('ct-client') as HTMLInputElement).value.trim(),
    role: (f.elements.namedItem('ct-role') as HTMLInputElement).value.trim(),
    email: (f.elements.namedItem('ct-email') as HTMLInputElement).value.trim(),
    phone: (f.elements.namedItem('ct-phone') as HTMLInputElement).value.trim(),
    whatsapp: (f.elements.namedItem('ct-wa') as HTMLInputElement).value.trim(),
  };
  if (!obj.name || !obj.clientName) return;
  if (S.ctEditId) {
    const idx = S.contacts.findIndex((c) => c.id === S.ctEditId);
    if (idx > -1) S.contacts[idx] = { ...S.contacts[idx], ...obj };
  } else {
    // Kept by id while the field still shows the company it was started from.
    const { companyId } = companyFromForm(contactModalCompany, obj.clientName);
    S.contacts.push({ id: nextCtId(), ...obj, companyId, service: '', lists: [] });
  }
  persistContacts();
  closeContactModal();
  renderContacts();
  refreshCompanyViewIfOpen();
}
expose('submitContact', submitContact);

export async function deleteContact(id: number): Promise<void> {
  if (await showConfirm('Delete this contact?', { confirmLabel: 'Delete' })) {
    S.contacts = S.contacts.filter((c) => c.id !== id);
    persistContacts();
    renderContacts();
  }
}
expose('deleteContact', deleteContact);

// ═══════════════ CONTACT LISTS ═══════════════

export function openCtListsModal(): void {
  renderCtListsPanel();
  document.getElementById('modal-ct-lists')?.classList.add('open');
}
expose('openCtListsModal', openCtListsModal);

export function closeCtListsModal(): void {
  document.getElementById('modal-ct-lists')?.classList.remove('open');
}
expose('closeCtListsModal', closeCtListsModal);

/** Every list in one place: contact lists, smart contact lists and company lists. */
export function renderCtListsPanel(): void {
  const panel = document.getElementById('ct-lists-panel');
  if (!panel) return;
  const row = (name: string, meta: string, actions: string) => `<div class="settings-list-row">
      <div><span class="fw-600">${escHtml(name)}</span> <span class="t-meta t-muted">${meta}</span></div>
      <div class="row-actions nowrap">${actions}</div>
    </div>`;
  const q = (s: string) => escHtml(s).replace(/'/g, "\\'");
  const group = (title: string, hint: string, rows: string[]) => `<div class="lists-group"><div class="lists-group-hd">${title}<span>${hint}</span></div>${rows.length ? rows.join('') : '<div class="rec-muted lists-group-empty">None yet</div>'}</div>`;
  panel.innerHTML = [
    group('Contact lists', 'People you add by hand', S.contactLists.map((l) => {
      const cnt = S.contacts.filter((c) => (c.lists || []).includes(l)).length;
      return row(l, `${cnt} contact${cnt !== 1 ? 's' : ''}`, `<button class="btn-sm" onclick="renameContactList('${q(l)}').then(renderCtListsPanel)">Rename</button><button class="btn-sm t-danger-outline" onclick="deleteContactListByName('${q(l)}')">Remove</button>`);
    })),
    group('Smart lists', 'Saved Contacts filters', smartContactLists().map((l) =>
      row(l.name, `${contactsInSmartList(l).length} contacts now`, `<button class="btn-sm" onclick="renameSavedList(${l.id}).then(renderCtListsPanel)">Rename</button><button class="btn-sm t-danger-outline" onclick="removeSavedList(${l.id}).then(renderCtListsPanel)">Remove</button>`))),
    group('Company lists', 'Contacts at the companies in a list — managed in Companies', companyLists().map((l) =>
      row(l.name, `${companyNamesInList(l).length} companies · ${contactsInCompanyList(l).length} contacts${l.filters ? ' · smart' : ''}`, `<button class="btn-sm" onclick="renameSavedList(${l.id}).then(renderCtListsPanel)">Rename</button>`))),
  ].join('');
}
expose('renderCtListsPanel', renderCtListsPanel);

export function addContactList(): void {
  const inp = document.getElementById('new-list-name') as HTMLInputElement | null;
  const name = inp?.value.trim();
  if (!name) return;
  if (S.contactLists.some((l) => l.toLowerCase() === name.toLowerCase()) || smartContactLists().some((l) => l.name.toLowerCase() === name.toLowerCase())) {
    toast(`There is already a list called "${name}".`, { tone: 'error' });
    return;
  }
  S.contactLists.push(name);
  persistContactLists();
  if (inp) inp.value = '';
  renderCtListsPanel();
  populateCtListFilter();
  renderContacts();
}
expose('addContactList', addContactList);

export async function deleteContactListByName(name: string): Promise<void> {
  if (!S.contactLists.includes(name)) return;
  if (!(await showConfirm(`Remove list "${name}"? Contacts assigned to it will keep their other lists.`, { confirmLabel: 'Remove' }))) return;
  S.contacts.forEach((c) => { if (c.lists) c.lists = c.lists.filter((l) => l !== name); });
  S.contactLists = S.contactLists.filter((l) => l !== name);
  persistContacts();
  persistContactLists();
  const sel = document.getElementById('ct-list-filter') as HTMLSelectElement | null;
  if (sel?.value === name) sel.value = '';
  renderCtListsPanel();
  populateCtListFilter();
  renderContacts();
}
expose('deleteContactListByName', deleteContactListByName);

export async function deleteContactList(i: number): Promise<void> {
  const name = S.contactLists[i];
  if (name) await deleteContactListByName(name);
}
expose('deleteContactList', deleteContactList);

/** Services a proposal covers: its lines, or its type for older one-service proposals. */
function proposalServices(p: { type: string | null; lines?: { serviceName: string }[] }): string[] {
  return p.lines?.length ? p.lines.map((l) => l.serviceName) : p.type ? [p.type] : [];
}

/** Service filter, built from the services actually proposed (no hard-coded list to drift). */
export function populateCtTypeFilter(): void {
  const sel = document.getElementById('ct-type-filter') as HTMLSelectElement | null;
  if (!sel) return;
  const cur = sel.value;
  const services = [...new Set(S.proposals.flatMap(proposalServices).map((x) => x.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (cur && !services.includes(cur)) services.push(cur);
  sel.innerHTML = `<option value="">All services</option>` + services.map((x) => `<option value="${escHtml(x)}" ${x === cur ? 'selected' : ''}>${escHtml(x)}</option>`).join('');
}

/** List filter: contact lists by name, company lists as `company:<id>`. */
export function populateCtListFilter(): void {
  const sel = document.getElementById('ct-list-filter') as HTMLSelectElement | null;
  if (!sel) return;
  const cur = sel.value;
  const opt = (value: string, label: string) => `<option value="${escHtml(value)}" ${value === cur ? 'selected' : ''}>${escHtml(label)}</option>`;
  const cos = companyLists();
  sel.innerHTML = `<option value="">All lists</option>`
    + (S.contactLists.length ? `<optgroup label="Contact lists">${S.contactLists.map((l) => opt(l, l)).join('')}</optgroup>` : '')
    + (cos.length ? `<optgroup label="Company lists">${cos.map((l) => opt(`company:${l.id}`, l.name)).join('')}</optgroup>` : '');
}
expose('populateCtListFilter', populateCtListFilter);

export function openAssignListModal(ctId: number): void {
  S.assignListContactId = ctId;
  const c = S.contacts.find((x) => x.id === ctId);
  if (!c) return;
  const lbl = document.getElementById('assign-list-contact'); if (lbl) lbl.textContent = `${c.name} — ${c.clientName || ''}`;
  const checks = document.getElementById('assign-list-checks');
  const cLists = c.lists || [];
  if (checks) {
    checks.innerHTML = S.contactLists.length === 0
      ? `<div class="t-secondary t-muted">No lists yet. Create one with <strong>+ New list</strong> above the table.</div>`
      : S.contactLists.map((l) => `<label class="check-label"><input type="checkbox" class="ct-chk" value="${escHtml(l)}" ${cLists.includes(l) ? 'checked' : ''}> ${escHtml(l)}</label>`).join('');
  }
  document.getElementById('modal-assign-list')?.classList.add('open');
}
expose('openAssignListModal', openAssignListModal);

export function closeAssignListModal(): void {
  document.getElementById('modal-assign-list')?.classList.remove('open');
}
expose('closeAssignListModal', closeAssignListModal);

export function saveAssignLists(): void {
  const c = S.contacts.find((x) => x.id === S.assignListContactId);
  if (!c) return;
  const checked = [...document.querySelectorAll<HTMLInputElement>('#assign-list-checks input:checked')].map((el) => el.value);
  c.lists = checked;
  persistContacts();
  closeAssignListModal();
  renderContacts();
}
expose('saveAssignLists', saveAssignLists);

// ═══════════════ CONTACTS TAB RENDER ═══════════════

/** Filter controls, by the key a smart list saves them under. */
const CONTACT_FILTER_IDS: Record<string, string> = { search: 'ct-search', client: 'ct-client', list: 'ct-list-filter', type: 'ct-type-filter' };

function readContactFilters(): Record<string, string> {
  const f: Record<string, string> = {};
  for (const [key, id] of Object.entries(CONTACT_FILTER_IDS)) f[key] = ((document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value || '').trim();
  return cleanFilters(f);
}

function applyContactFilters(f: Record<string, string>): void {
  for (const [key, id] of Object.entries(CONTACT_FILTER_IDS)) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) continue;
    const value = f[key] || '';
    if (el instanceof HTMLSelectElement && value && ![...el.options].some((o) => o.value === value || o.text === value)) el.add(new Option(value, value));
    el.value = value;
  }
  // Remember them like any filter change.
  document.getElementById('ct-client')?.dispatchEvent(new Event('change'));
}

/** Contacts a set of filters matches — used by the table and by smart lists. */
export function contactsMatching(f: Record<string, string>): Contact[] {
  const search = (f.search || '').toLowerCase();
  const clientRef = f.client ? companyRef(f.client) : null;
  let companyRefs: CompanyRef[] | null = null;
  if (f.list?.startsWith('company:')) {
    const list = listById(Number(f.list.slice(8)));
    companyRefs = list ? companyNamesInList(list).map((n) => companyRef(n)) : [];
  }
  return S.contacts.filter((c) => {
    if (clientRef && !inCompany(clientRef, c.companyId, c.clientName)) return false;
    if (companyRefs) { if (!companyRefs.some((r) => inCompany(r, c.companyId, c.clientName))) return false; }
    else if (f.list && !(c.lists || []).includes(f.list)) return false;
    // Derived from the company's proposal types, not the contact's own Services field.
    if (f.type && !S.proposals.some((p) => proposalServices(p).includes(f.type) && sameCompany(p.companyId, p.client, c.companyId, c.clientName))) return false;
    if (search) {
      if (![c.name, c.clientName, c.email, c.phone, c.role, c.service].some((v) => (v || '').toLowerCase().includes(search))) return false;
    }
    return true;
  });
}
expose('contactsMatching', contactsMatching);

export function contactsInSmartList(list: SavedList): Contact[] {
  return list.filters ? contactsMatching(list.filters) : [];
}

/** The filter predicate used by both the render below and "Select All", so
 * Select All only selects the rows on screen. */
export function filteredContacts(): Contact[] {
  return contactsMatching(readContactFilters());
}

/** List chips above the table: click to filter, drop contacts on a contact list to add them. */
function renderListsBar(filters: Record<string, string>): void {
  const bar = document.getElementById('ct-lists-bar');
  if (!bar) return;
  const q = (s: string) => escHtml(s).replace(/'/g, "\\'");
  const smartOpen = smartContactLists().find((l) => sameFilters(filters, l.filters));
  const more = (onclick: string) => `<button class="list-chip-more" onclick="${onclick}" aria-label="List actions">${icon('more', 13)}</button>`;
  const contactChips = S.contactLists.map((l) => {
    const on = filters.list === l && !smartOpen;
    const n = S.contacts.filter((c) => (c.lists || []).includes(l)).length;
    return `<span class="list-chip-wrap${on ? ' active' : ''}"><button class="list-chip ct-list-drop${on ? ' active' : ''}" data-drop="contact-list" data-drop-value="${escHtml(l)}" onclick="filterContactsByList('${q(l)}')" oncontextmenu="contactListMenu(event,'${q(l)}')">${icon('tag', 11)}${escHtml(l)}<span>${n}</span></button>${on ? more(`contactListMenu(event,'${q(l)}')`) : ''}</span>`;
  });
  const smartChips = smartContactLists().map((l) => {
    const on = l === smartOpen;
    return `<span class="list-chip-wrap${on ? ' active' : ''}"><button class="list-chip${on ? ' active' : ''}" onclick="openSmartContactList(${l.id})" oncontextmenu="smartContactListMenu(event, ${l.id})">${listChipLabel(l.name, contactsInSmartList(l).length, true)}</button>${on ? more(`smartContactListMenu(event, ${l.id})`) : ''}</span>`;
  });
  const companyChips = companyLists().map((l) => {
    const on = filters.list === `company:${l.id}` && !smartOpen;
    return `<span class="list-chip-wrap${on ? ' active' : ''}"><button class="list-chip list-chip-company${on ? ' active' : ''}" onclick="filterContactsByList('company:${l.id}')" oncontextmenu="companyListContactsMenu(event, ${l.id})" title="Contacts at the companies in this list">${icon('building', 11)}${escHtml(l.name)}<span>${contactsInCompanyList(l).length}</span></button>${on ? more(`companyListContactsMenu(event, ${l.id})`) : ''}</span>`;
  });
  // Only a list chosen isn't worth saving as a smart list.
  const canSave = Object.keys(filters).some((k) => k !== 'list') && !smartOpen;
  bar.innerHTML = `<span class="list-bar-label">Lists</span>${[...contactChips, ...smartChips].join('')}`
    + (companyChips.length ? `<span class="list-bar-sep" aria-hidden="true"></span><span class="list-bar-label">Company lists</span>${companyChips.join('')}` : '')
    + `<button class="list-chip list-chip-add" onclick="newContactListMenu(event)">${icon('plus', 11)} New list</button>`
    + (canSave ? `<button class="list-bar-link" onclick="saveContactFiltersAsList()">Save these filters as a smart list</button>` : '')
    + (S.contactLists.length ? `<span class="ct-lists-hint">Drag contacts onto a list to add them</span>` : '');
}

registerDragSource('contact', {
  ids: (id) => (S.selectedContactIds.has(id) && S.selectedContactIds.size > 1 ? [...S.selectedContactIds] : [id]),
  label: (ids) => ids.length > 1 ? `${ids.length} contacts` : S.contacts.find((x) => x.id === ids[0])?.name || 'Contact',
});
registerDropTarget('contact-list', {
  accepts: ['contact'],
  onDrop: ({ ids }, { value: list }) => addContactsToList(list, ids),
});

export function filterContactsByList(list: string): void {
  populateCtListFilter();
  const sel = document.getElementById('ct-list-filter') as HTMLSelectElement | null;
  if (sel) { sel.value = sel.value === list ? '' : list; sel.dispatchEvent(new Event('change')); }
  S.selectedContactIds.clear();
  renderContacts();
}
expose('filterContactsByList', filterContactsByList);

/** From Companies: the contacts at a company list's companies. */
export function showContactsOfCompanyList(id: number): void {
  (window as any).switchTab?.('contacts');
  (window as any).closeContactPage?.();
  applyContactFilters({ list: `company:${id}` });
  populateCtListFilter();
  const sel = document.getElementById('ct-list-filter') as HTMLSelectElement | null;
  if (sel) sel.value = `company:${id}`;
  S.selectedContactIds.clear();
  renderContacts();
}
expose('showContactsOfCompanyList', showContactsOfCompanyList);

export function openSmartContactList(id: number): void {
  const list = listById(id);
  if (!list?.filters) return;
  populateCtListFilter();
  applyContactFilters(sameFilters(readContactFilters(), list.filters) ? {} : list.filters);
  S.selectedContactIds.clear();
  renderContacts();
}
expose('openSmartContactList', openSmartContactList);

export function newContactListMenu(e: MouseEvent): void {
  e.stopPropagation();
  const filters = readContactFilters();
  const selected = [...S.selectedContactIds];
  showMenuAt(e.currentTarget as HTMLElement, [
    { label: 'Contact list', iconName: 'tag', run: () => { void newContactList().then((name) => { if (!name) return; if (selected.length) addContactsToList(name, selected); else toast('Drag contacts onto the list, or select them and choose Add to list.'); populateCtListFilter(); renderContacts(); }); } },
    { label: Object.keys(filters).length ? 'Smart list from these filters' : 'Smart list (set filters first)', iconName: 'bolt', run: () => { if (Object.keys(filters).length) void saveContactFiltersAsList(); else toast('Choose some filters first — a smart list keeps them.'); } },
    { label: 'Company list', iconName: 'building', run: () => { (window as any).switchTab?.('companies'); toast('Company lists are made in Companies — select companies, then Add to list.'); } },
  ]);
}
expose('newContactListMenu', newContactListMenu);

export async function saveContactFiltersAsList(): Promise<void> {
  const list = await createSavedList('contact', readContactFilters());
  if (list) renderContacts();
}
expose('saveContactFiltersAsList', saveContactFiltersAsList);

function menuFor(e: MouseEvent, items: Parameters<typeof showMenuAt>[1]): void {
  if (e.type === 'contextmenu') { showContextMenu(e, items); return; }
  e.stopPropagation();
  showMenuAt(e.currentTarget as HTMLElement, items);
}

export function contactListMenu(e: MouseEvent, name: string): void {
  menuFor(e, [
    { label: 'Export to ActiveCampaign', iconName: 'mail', run: () => { void exportToActiveCampaign(S.contacts.filter((c) => (c.lists || []).includes(name)), name); } },
    { label: 'Rename…', iconName: 'edit', run: () => { void renameContactList(name); } },
    { label: 'Delete list', iconName: 'trash', danger: true, run: () => { void deleteContactListByName(name); } },
  ]);
}
expose('contactListMenu', contactListMenu);

export function smartContactListMenu(e: MouseEvent, id: number): void {
  const list = listById(id);
  if (!list) return;
  const filters = readContactFilters();
  menuFor(e, [
    { label: 'Export to ActiveCampaign', iconName: 'mail', run: () => { void exportToActiveCampaign(contactsInSmartList(list), list.name, { tag: list.name }); } },
    { label: 'Rename…', iconName: 'edit', run: () => { void renameSavedList(id); } },
    ...(Object.keys(filters).length && !sameFilters(filters, list.filters) ? [{ label: 'Use the current filters', iconName: 'bolt', run: () => { void updateSmartListFilters(id, filters); } }] : []),
    { label: 'Delete list', iconName: 'trash', danger: true, run: () => { void removeSavedList(id); } },
  ]);
}
expose('smartContactListMenu', smartContactListMenu);

export function companyListContactsMenu(e: MouseEvent, id: number): void {
  const list = listById(id);
  if (!list) return;
  menuFor(e, [
    { label: 'Export to ActiveCampaign', iconName: 'mail', run: () => { void exportToActiveCampaign(contactsInCompanyList(list), list.name, { tag: list.name }); } },
    { label: 'Open in Companies', iconName: 'building', run: () => { (window as any).switchTab?.('companies'); (window as any).closeCompanyDetail?.(); (window as any).openCompanyList?.(id); } },
  ]);
}
expose('companyListContactsMenu', companyListContactsMenu);

// ── Rows and columns ──

interface CtRow { c: Contact; relationship: { label: string; tone: string } | null; industry: string; services: string[]; lastTouch: string | null }

const muted = '<span class="t-muted">—</span>';
const copyBtn = (v: string, what: string) => `<button class="rec-icon-btn ct-copy" onclick="copyText('${escHtml(v).replace(/'/g, '&#39;')}','${what} copied')" title="Copy ${what.toLowerCase()}" aria-label="Copy ${what.toLowerCase()}">${icon('copy', 12)}</button>`;

const CONTACT_COLUMNS: Column<CtRow>[] = [
  { key: 'name', label: 'Name', shown: true, fixed: true, sort: (r) => (r.c.name || '').toLowerCase(),
    cell: (r) => `<div class="tbl-primary">${recordLink('contact', r.c.id, r.c.name || 'Unnamed')}</div>${r.c.role ? `<div class="tbl-secondary">${escHtml(r.c.role)}</div>` : ''}` },
  { key: 'company', label: 'Company', shown: true, sort: (r) => (r.c.clientName || '').toLowerCase(),
    cell: (r) => (r.c.clientName ? `<div class="tbl-primary fw-500">${companyLink(r.c.companyId, r.c.clientName)}</div>${r.relationship ? `<div class="tbl-secondary tone-text-${r.relationship.tone}">${escHtml(r.relationship.label)}</div>` : ''}` : muted) },
  { key: 'email', label: 'Email', shown: true, sort: (r) => (r.c.email || '').toLowerCase(),
    cell: (r) => (r.c.email ? `<a href="mailto:${escHtml(r.c.email)}" class="ct-mail-link">${escHtml(r.c.email)}</a>${copyBtn(r.c.email, 'Email')}` : '<span class="t-amber">No email</span>') },
  { key: 'services', label: 'Services', shown: true, sort: (r) => r.services.join(', '),
    cell: (r) => (r.services.length ? `<div class="co-type-chips">${r.services.slice(0, 3).map((s) => `<span class="chip chip-quiet">${escHtml(s)}</span>`).join('')}${r.services.length > 3 ? `<span class="chip chip-quiet" title="${escHtml(r.services.slice(3).join(', '))}">+${r.services.length - 3}</span>` : ''}</div>` : muted) },
  { key: 'lists', label: 'Lists', shown: true, sort: (r) => (r.c.lists || []).join(', '),
    cell: (r) => (r.c.lists || []).map((l) => `<span class="ct-list-tag">${escHtml(l)}</span>`).join(' ') || muted },
  { key: 'touch', label: 'Last in touch', shown: true, sort: (r) => r.lastTouch, descFirst: true, cell: (r) => agoLabel(r.lastTouch) },
  { key: 'phone', label: 'Phone', shown: false, sort: (r) => r.c.phone || r.c.whatsapp || '',
    cell: (r) => (r.c.phone ? `${escHtml(r.c.phone)}${copyBtn(r.c.phone, 'Phone')}` : r.c.whatsapp ? `${escHtml(r.c.whatsapp)} <span class="t-muted">WhatsApp</span>` : muted) },
  { key: 'industry', label: 'Industry', shown: false, sort: (r) => r.industry, cell: (r) => escHtml(r.industry) || muted },
  { key: 'actions', label: '', shown: true, fixed: true, className: 'nowrap row-actions',
    cell: (r) => {
      const wa = (r.c.whatsapp || r.c.phone || '').replace(/[^0-9]/g, '');
      return [
        r.c.phone ? `<button class="rec-icon-btn" onclick="openExternalUrl('tel:${escHtml(r.c.phone.replace(/[^+0-9]/g, ''))}')" title="Call" aria-label="Call">☎</button>` : '',
        wa ? `<a href="https://wa.me/${wa}" target="_blank" class="rec-icon-btn ct-wa-link" title="WhatsApp" aria-label="WhatsApp">WA</a>` : '',
        `<button class="rec-icon-btn" onclick="openAssignListModal(${r.c.id})" title="Add to lists" aria-label="Add to lists">${icon('tag', 13)}</button>`,
        `<button class="rec-icon-btn danger" onclick="deleteContactWithUndo(${r.c.id})" title="Delete" aria-label="Delete">${icon('trash', 13)}</button>`,
      ].join('');
    } },
];

const CONTACT_SORT_DEFAULT: SortState = { key: 'name', dir: 'asc' };

export function sortContacts(key: string): void {
  setSort('contacts', CONTACT_COLUMNS, key, CONTACT_SORT_DEFAULT);
  renderContacts();
}
expose('sortContacts', sortContacts);

export function openContactColumns(e: MouseEvent): void {
  e.stopPropagation();
  openColumnPicker(e.currentTarget as HTMLElement, 'contacts', CONTACT_COLUMNS, () => renderContacts());
}
expose('openContactColumns', openContactColumns);

/** Latest meeting or email with each email address. */
function lastTouchByEmail(): Map<string, string> {
  const map = new Map<string, string>();
  const todayIso = new Date().toISOString().slice(0, 10);
  const note = (email: string | null | undefined, date: string | null | undefined) => {
    const e = (email || '').trim().toLowerCase();
    const d = (date || '').slice(0, 10);
    if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(d) || d > todayIso) return;
    if ((map.get(e) || '') < d) map.set(e, d);
  };
  for (const m of S.meetings) {
    if (m.isCancelled) continue;
    const date = m.startAt || m.meetingDate;
    note(m.organizerEmail, date);
    (m.attendeeEmails || []).forEach((a) => note(a, date));
  }
  for (const em of S.emails) note(em.senderEmail, em.receivedAt);
  return map;
}

export function renderContacts(): void {
  populateCtListFilter();
  populateCtTypeFilter();
  const filters = readContactFilters();
  renderListsBar(filters);
  void (window as any).updatePeopleBanner?.();
  const data = contactsMatching(filters);
  const cntEl = document.getElementById('ct-cnt'); if (cntEl) cntEl.textContent = `${data.length} contact${data.length !== 1 ? 's' : ''}`;
  const tbody = document.getElementById('ct-tbody');
  if (!tbody) return;
  const columns = shownColumns('contacts', CONTACT_COLUMNS);
  const sort = sortState('contacts', CONTACT_COLUMNS, CONTACT_SORT_DEFAULT);
  const thead = document.getElementById('ct-thead');
  if (thead) thead.innerHTML = `<tr><th class="td-chk"><input type="checkbox" id="ct-select-all" class="ct-chk" onchange="toggleSelectAllContacts(this.checked)" title="Select all" aria-label="Select all"></th>${headerCells(columns, sort, 'sortContacts')}</tr>`;
  updateCtBulkBar();
  if (data.length === 0) {
    const listName = filters.list?.startsWith('company:') ? listById(Number(filters.list.slice(8)))?.name : filters.list;
    tbody.innerHTML = `<tr><td colspan="${columns.length + 1}" class="empty">${listName && Object.keys(filters).length === 1 ? `No contacts in ${escHtml(listName)} yet.` : 'No contacts found.'}</td></tr>`;
    return;
  }
  const touches = lastTouchByEmail();
  const w = window as any;
  const companyInfo = new Map<string, { relationship: { label: string; tone: string } | null; industry: string }>();
  const rows = data.map((c): CtRow => {
    const key = c.companyId != null ? `id:${c.companyId}` : `name:${c.clientName || ''}`;
    let info = companyInfo.get(key);
    if (!info) {
      const co = S.companies.find((x) => (c.companyId != null ? x.id === c.companyId : x.name === c.clientName));
      const name = co?.name || c.clientName || '';
      info = { relationship: name && w.companyRelationship ? w.companyRelationship(name) : null, industry: co?.industries.join(', ') || '' };
      companyInfo.set(key, info);
    }
    return { c, ...info, services: (c.service || '').split(',').map((s) => s.trim()).filter(Boolean), lastTouch: touches.get((c.email || '').trim().toLowerCase()) || null };
  });
  tbody.innerHTML = sortRows(rows, CONTACT_COLUMNS, sort).map((r) => {
    const isSel = S.selectedContactIds.has(r.c.id);
    return `<tr class="ct-row${isSel ? ' ct-sel-row' : ''}" data-contact-id="${r.c.id}" data-drag-kind="contact" data-drag-id="${r.c.id}" onclick="if(!event.target.closest('a,button,input'))openRecord('contact', ${r.c.id})">
      <td class="td-chk"><input type="checkbox" class="ct-chk" ${isSel ? 'checked' : ''} onchange="toggleContactSelect(${r.c.id},this.checked)" aria-label="Select"></td>
      ${columns.map((col) => `<td class="${col.className || ''}">${col.cell(r)}</td>`).join('')}
    </tr>`;
  }).join('');
  updateCtSelectAll();
}
registerTabRenderer('contacts', () => {
  if (S.currentContactId != null && document.getElementById('ct-detail')?.classList.contains('open')) (window as any).renderContactPage?.();
  else renderContacts();
});
expose('renderContacts', renderContacts);

export function toggleContactSelect(id: number, checked: boolean): void {
  if (checked) S.selectedContactIds.add(id); else S.selectedContactIds.delete(id);
  document.querySelector(`#ct-tbody tr[data-contact-id="${id}"]`)?.classList.toggle('ct-sel-row', checked);
  updateCtSelectAll();
  updateCtBulkBar();
}
expose('toggleContactSelect', toggleContactSelect);

export function toggleSelectAllContacts(checked: boolean): void {
  if (checked) filteredContacts().forEach((c) => S.selectedContactIds.add(c.id));
  else filteredContacts().forEach((c) => S.selectedContactIds.delete(c.id));
  renderContacts();
}
expose('toggleSelectAllContacts', toggleSelectAllContacts);

export function clearContactSelection(): void {
  S.selectedContactIds.clear();
  renderContacts();
}
expose('clearContactSelection', clearContactSelection);

function updateCtSelectAll(): void {
  const all = document.getElementById('ct-select-all') as HTMLInputElement | null;
  if (!all) return;
  const visible = filteredContacts();
  const selVisible = visible.filter((c) => S.selectedContactIds.has(c.id)).length;
  all.checked = visible.length > 0 && selVisible === visible.length;
  all.indeterminate = selVisible > 0 && selVisible < visible.length;
}

function updateCtBulkBar(): void {
  const list = (document.getElementById('ct-list-filter') as HTMLSelectElement | null)?.value || '';
  const selected = () => [...S.selectedContactIds];
  renderBulkBar('ct-bulk', S.selectedContactIds.size, ['contact', 'contacts'], [
    { label: 'Add to list', choices: () => [
      ...S.contactLists.map((l) => ({ label: l, iconName: 'tag', run: () => addContactsToList(l, selected()) })),
      ...(S.contactLists.length ? [{ label: '', run: () => {}, separator: true }] : []),
      { label: 'New list…', iconName: 'plus', run: () => { void newContactList().then((name) => { if (name) addContactsToList(name, selected()); }); } },
    ] },
    ...(list && S.contactLists.includes(list) ? [{ label: `Remove from ${list}`, run: () => removeContactsFromList(list, selected()) }] : []),
    { label: 'Export to ActiveCampaign', run: () => { const ids = new Set(selected()); void exportToActiveCampaign(S.contacts.filter((c) => ids.has(c.id)), `${ids.size} selected contact${ids.size === 1 ? '' : 's'}`); } },
  ], 'clearContactSelection()', () => S.currentTab === 'contacts' && !document.getElementById('ct-detail')?.classList.contains('open'));
}

// ═══════════════ ACTIVECAMPAIGN CSV EXPORT ═══════════════

/** Header button: the selected contacts, or everyone the current filters show. */
export async function exportAcContacts(): Promise<void> {
  if (S.selectedContactIds.size > 0) {
    const ids = S.selectedContactIds;
    await exportToActiveCampaign(S.contacts.filter((c) => ids.has(c.id)), `${ids.size} selected contact${ids.size === 1 ? '' : 's'}`);
    return;
  }
  const filters = readContactFilters();
  const smart = smartContactLists().find((l) => sameFilters(filters, l.filters));
  const listName = filters.list?.startsWith('company:') ? listById(Number(filters.list.slice(8)))?.name : filters.list;
  const source = smart?.name || (listName && Object.keys(filters).length === 1 ? listName : Object.keys(filters).length ? 'the current view' : 'all contacts');
  await exportToActiveCampaign(contactsMatching(filters), source, { tag: smart?.name || (listName && Object.keys(filters).length === 1 && filters.list?.startsWith('company:') ? listName : undefined) });
}
expose('exportAcContacts', exportAcContacts);
