// Lists across Companies and Contacts: hand-picked company lists, smart lists
// (saved filters) for both, contact lists by name (contacts.ts), and the
// ActiveCampaign export any list or selection can use.

import { S } from '../lib/state';
import { escHtml, expose, showConfirm, showTextPrompt, companyRef, inCompany, sameCompany } from '../lib/utils';
import { toast } from '../lib/ui';
import { saveCsv } from '../lib/files';
import { deleteSavedList, saveSavedList, setSavedListCompanies } from '../lib/db';
import { persistContacts, persistContactLists, persistCreateCompany } from '../lib/persist';
import { refreshAll } from '../lib/registry';
import type { Contact, SavedList } from '../lib/types';

export type ListEntity = SavedList['entity'];

export const companyLists = (): SavedList[] => S.savedLists.filter((l) => l.entity === 'company');
export const smartContactLists = (): SavedList[] => S.savedLists.filter((l) => l.entity === 'contact');
export const isSmart = (l: SavedList): boolean => l.filters != null;
export const listById = (id: number): SavedList | undefined => S.savedLists.find((l) => l.id === id);

/** Filters with empty values dropped, so two sets compare by what they filter on. */
export function cleanFilters(f: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v).sort(([a], [b]) => a.localeCompare(b)));
}

export function sameFilters(a: Record<string, string>, b: Record<string, string> | null): boolean {
  return b != null && JSON.stringify(cleanFilters(a)) === JSON.stringify(cleanFilters(b));
}

function keepLocal(list: SavedList): SavedList {
  const i = S.savedLists.findIndex((l) => l.id === list.id);
  if (i > -1) S.savedLists[i] = list; else S.savedLists.push(list);
  S.savedLists.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return list;
}

function failed(e: unknown): null {
  toast(String((e as Error)?.message || e), { tone: 'error' });
  return null;
}

// ═══════════════ Company lists ═══════════════

/** Company names in a list: its hand-picked companies, or the companies its filters match today. */
export function companyNamesInList(list: SavedList): string[] {
  if (list.filters) return (window as any).matchingCompanyNames?.(list.filters) || [];
  const ids = new Set(list.companyIds);
  return S.companies.filter((c) => ids.has(c.id) && !c.archived).map((c) => c.name);
}

/** Contacts working at the companies in a company list. */
export function contactsInCompanyList(list: SavedList): Contact[] {
  const refs = companyNamesInList(list).map((n) => companyRef(n));
  return S.contacts.filter((c) => refs.some((r) => inCompany(r, c.companyId, c.clientName)));
}

/** Company lists a company is in (hand-picked or matched by a smart list). */
export function listsForCompany(name: string): SavedList[] {
  return companyLists().filter((l) => companyNamesInList(l).includes(name));
}

async function askName(title: string, defaultValue = ''): Promise<string | null> {
  const name = await showTextPrompt({ title, label: 'List name', defaultValue, placeholder: 'e.g. Q4 campaign' });
  return name ? name.trim() || null : null;
}

/** Creates a list after asking for its name; smart when `filters` are given. */
export async function createSavedList(entity: ListEntity, filters: Record<string, string> | null, title?: string): Promise<SavedList | null> {
  const name = await askName(title || (filters ? 'New smart list' : 'New company list'));
  if (!name) return null;
  try {
    const saved = keepLocal(await saveSavedList({ id: 0, name, entity, filters: filters ? cleanFilters(filters) : null, companyIds: [] }));
    toast(`Created ${saved.name}`, { tone: 'success' });
    return saved;
  } catch (e) { return failed(e); }
}

export async function renameSavedList(id: number): Promise<void> {
  const list = listById(id);
  if (!list) return;
  const name = await askName('Rename list', list.name);
  if (!name || name === list.name) return;
  try { keepLocal(await saveSavedList({ ...list, name })); refreshAll(); } catch (e) { failed(e); }
}
expose('renameSavedList', renameSavedList);

export async function updateSmartListFilters(id: number, filters: Record<string, string>): Promise<void> {
  const list = listById(id);
  if (!list?.filters) return;
  try {
    keepLocal(await saveSavedList({ ...list, filters: cleanFilters(filters) }));
    toast(`${list.name} now uses these filters`, { tone: 'success' });
    refreshAll();
  } catch (e) { failed(e); }
}

export async function removeSavedList(id: number): Promise<boolean> {
  const list = listById(id);
  if (!list) return false;
  const what = list.filters ? 'This only removes the saved filters.' : 'The companies stay; only the list goes.';
  if (!(await showConfirm(`Delete the list "${list.name}"? ${what}`, { title: 'Delete list', confirmLabel: 'Delete' }))) return false;
  try {
    await deleteSavedList(id);
    S.savedLists = S.savedLists.filter((l) => l.id !== id);
    refreshAll();
    return true;
  } catch (e) { failed(e); return false; }
}
expose('removeSavedList', removeSavedList);

/** Adds companies to a hand-picked list, creating company records for names only known from proposals. */
export async function addCompaniesToList(listId: number, names: string[]): Promise<void> {
  const list = listById(listId);
  if (!list || list.filters) return;
  const ids: number[] = [];
  for (const name of names) {
    let co = S.companies.find((c) => c.name === name);
    if (!co) {
      co = await persistCreateCompany(name);
      if (co && !S.companies.some((c) => c.id === co!.id)) S.companies.push(co);
    }
    if (co) ids.push(co.id);
  }
  const before = new Set(list.companyIds);
  try {
    const saved = keepLocal(await setSavedListCompanies(listId, ids, []));
    const added = saved.companyIds.filter((id) => !before.has(id)).length;
    toast(added ? `Added ${added === 1 ? names[0] : `${added} companies`} to ${saved.name}` : `Already in ${saved.name}`, { tone: added ? 'success' : undefined });
    refreshAll();
  } catch (e) { failed(e); }
}

export async function removeCompaniesFromList(listId: number, names: string[]): Promise<void> {
  const list = listById(listId);
  if (!list || list.filters) return;
  const ids = S.companies.filter((c) => names.includes(c.name)).map((c) => c.id);
  try {
    const saved = keepLocal(await setSavedListCompanies(listId, [], ids));
    toast(`Removed ${ids.length === 1 ? names[0] : `${ids.length} companies`} from ${saved.name}`);
    refreshAll();
  } catch (e) { failed(e); }
}

/** Menu choices for "Add to list": every hand-picked company list, then a new one. */
export function addToCompanyListChoices(names: () => string[]): { label: string; run: () => void; iconName?: string; separator?: boolean }[] {
  const lists = companyLists().filter((l) => !l.filters);
  return [
    ...lists.map((l) => ({ label: l.name, iconName: 'tag', run: () => { void addCompaniesToList(l.id, names()); } })),
    ...(lists.length ? [{ label: '', run: () => {}, separator: true }] : []),
    { label: 'New list…', iconName: 'plus', run: () => { void createSavedList('company', null).then((l) => { if (l) void addCompaniesToList(l.id, names()); }); } },
  ];
}

// ═══════════════ Contact lists (by name) ═══════════════

export async function newContactList(): Promise<string | null> {
  const name = await askName('New contact list');
  if (!name) return null;
  if (S.contactLists.some((l) => l.toLowerCase() === name.toLowerCase()) || smartContactLists().some((l) => l.name.toLowerCase() === name.toLowerCase())) {
    toast(`There is already a list called "${name}".`, { tone: 'error' });
    return null;
  }
  S.contactLists.push(name);
  S.contactLists.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  persistContactLists();
  return name;
}

export async function renameContactList(oldName: string): Promise<void> {
  const name = await askName('Rename list', oldName);
  if (!name || name === oldName) return;
  if (S.contactLists.some((l) => l !== oldName && l.toLowerCase() === name.toLowerCase())) { toast(`There is already a list called "${name}".`, { tone: 'error' }); return; }
  S.contactLists = S.contactLists.map((l) => (l === oldName ? name : l));
  // Save the new list name before contacts reference it.
  persistContactLists();
  S.contacts.forEach((c) => { if ((c.lists || []).includes(oldName)) c.lists = c.lists.map((l) => (l === oldName ? name : l)); });
  persistContacts();
  const sel = document.getElementById('ct-list-filter') as HTMLSelectElement | null;
  if (sel?.value === oldName) { (window as any).populateCtListFilter?.(); sel.value = name; }
  refreshAll();
}
expose('renameContactList', renameContactList);

export function addContactsToList(list: string, ids: number[]): void {
  let added = 0;
  for (const id of ids) {
    const c = S.contacts.find((x) => x.id === id);
    if (c && !(c.lists || []).includes(list)) { c.lists = [...(c.lists || []), list]; added++; }
  }
  if (!added) { toast(`Already in ${list}`); return; }
  persistContacts();
  refreshAll();
  toast(`Added ${added === 1 ? S.contacts.find((x) => x.id === ids[0])?.name || '1 contact' : `${added} contacts`} to ${list}`, { tone: 'success' });
}

export function removeContactsFromList(list: string, ids: number[]): void {
  let removed = 0;
  for (const id of ids) {
    const c = S.contacts.find((x) => x.id === id);
    if (c && (c.lists || []).includes(list)) { c.lists = c.lists.filter((l) => l !== list); removed++; }
  }
  if (!removed) return;
  persistContacts();
  refreshAll();
  toast(`Removed ${removed === 1 ? '1 contact' : `${removed} contacts`} from ${list}`);
}

// ═══════════════ ActiveCampaign export ═══════════════

const csvCell = (v: string | null | undefined) => `"${(v || '').replace(/"/g, '""')}"`;
/** ActiveCampaign splits the Tags column on commas, so a tag can't contain one. */
const tagText = (t: string) => t.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

export function splitName(full: string | null | undefined): { first: string; last: string } {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { first: parts[0] || '', last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

export interface AcRow {
  email: string; firstName: string; lastName: string; phone: string; jobTitle: string;
  organization: string; industry: string; owner: string; country: string; relationship: string; tags: string[];
}

export const AC_HEADERS = ['Email', 'First Name', 'Last Name', 'Phone', 'Job Title', 'Organization', 'Industry', 'Account Owner', 'Country', 'Relationship', 'Tags'];

/** One row per email address; a person listed twice keeps every tag. */
export function activeCampaignRows(contacts: Contact[], extraTags: string[] = []): AcRow[] {
  const w = window as any;
  const byEmail = new Map<string, AcRow>();
  const companyCache = new Map<string, { industry: string; owner: string; country: string; relationship: string; lists: string[] }>();
  const members = companyLists().map((l) => [l.name, new Set(companyNamesInList(l))] as const);
  for (const c of contacts) {
    const email = (c.email || '').trim();
    if (!email) continue;
    const company = c.clientName || '';
    let info = companyCache.get(company);
    if (!info) {
      const co = S.companies.find((x) => (c.companyId != null ? x.id === c.companyId : x.name === company));
      const name = co?.name || company;
      info = {
        industry: co?.industries.join(', ') || '',
        owner: co?.owner || '',
        country: co?.country || '',
        relationship: name && w.companyRelationship ? w.companyRelationship(name)?.label || '' : '',
        lists: name ? members.filter(([, set]) => set.has(name)).map(([n]) => n) : [],
      };
      companyCache.set(company, info);
    }
    const services = (c.service || '').split(',').map((s) => s.trim()).filter(Boolean);
    const tags = [...(c.lists || []), ...info.lists, ...services, ...(info.relationship ? [info.relationship] : []), ...extraTags].map(tagText).filter(Boolean);
    const key = email.toLowerCase();
    const existing = byEmail.get(key);
    if (existing) { existing.tags = [...new Set([...existing.tags, ...tags])]; continue; }
    const { first, last } = splitName(c.name);
    byEmail.set(key, {
      email, firstName: first, lastName: last, phone: c.phone || c.whatsapp || '', jobTitle: c.role || '',
      organization: company, industry: info.industry, owner: info.owner, country: info.country, relationship: info.relationship,
      tags: [...new Set(tags)],
    });
  }
  return [...byEmail.values()];
}

export function activeCampaignCsv(rows: AcRow[]): string {
  return [AC_HEADERS.join(','), ...rows.map((r) => [r.email, r.firstName, r.lastName, r.phone, r.jobTitle, r.organization, r.industry, r.owner, r.country, r.relationship, r.tags.join(', ')].map(csvCell).join(','))].join('\n');
}

/** Exports contacts as an ActiveCampaign import file, after saying what's included. */
export async function exportToActiveCampaign(contacts: Contact[], source: string, opts: { tag?: string } = {}): Promise<void> {
  const rows = activeCampaignRows(contacts, opts.tag ? [opts.tag] : []);
  const noEmail = contacts.filter((c) => !(c.email || '').trim()).length;
  const duplicates = contacts.length - noEmail - rows.length;
  if (!rows.length) {
    await showConfirm(contacts.length ? 'None of these contacts has an email address, which ActiveCampaign requires.' : `There are no contacts in ${source}.`, { title: 'Nothing to export', confirmLabel: 'OK' });
    return;
  }
  const notes = [
    noEmail ? `${noEmail} without an email address will be left out.` : '',
    duplicates > 0 ? `${duplicates} duplicate email address${duplicates === 1 ? '' : 'es'} will be merged.` : '',
    'Tags: contact lists, company lists, services and relationship.',
  ].filter(Boolean).join(' ');
  const ok = await showConfirm(`Export ${rows.length} contact${rows.length === 1 ? '' : 's'} from ${source} for ActiveCampaign? ${notes}`, { title: 'Export to ActiveCampaign', confirmLabel: 'Export' });
  if (!ok) return;
  const slug = source.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  const path = await saveCsv(`MENA_BIG_ActiveCampaign_${slug || 'Contacts'}`, activeCampaignCsv(rows));
  if (path) toast(`Exported ${rows.length} contact${rows.length === 1 ? '' : 's'}`, { tone: 'success' });
}

/** Contacts at the named companies (for exports from Companies). */
export function contactsAtCompanies(names: string[]): Contact[] {
  const refs = names.map((n) => companyRef(n));
  return S.contacts.filter((c) => refs.some((r) => sameCompany(r.id, r.name, c.companyId, c.clientName)));
}

export const listChipLabel = (name: string, count: number, smart: boolean) =>
  `${smart ? '<span class="list-chip-smart" title="Smart list — updates from its filters">⚡</span>' : ''}${escHtml(name)}<span>${count}</span>`;
