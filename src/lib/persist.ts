import { S } from './state';
import {
  persist, persistReturning, upsertProposals, deleteProposals, upsertContacts, deleteContacts,
  upsertAgreements, deleteAgreements, upsertTodos, deleteTodos, upsertNotes, deleteNotes, saveNoteFolders,
  saveContactLists, saveCompanyNote, saveProject, saveMilestones, saveOpportunity, saveMeeting,
  createCompany, getCompanies,
} from './db';
import type { Project, Milestone, Opportunity, Meeting, Company, RecordCompanyLink } from './types';
import { refreshAll } from './registry';
import { emitChange } from './changes';
import type { EntityKind } from './types';

// Call after mutating the corresponding S.<entity> array. Only records that
// changed since the last successful save are written, and records that
// disappeared from the array are deleted — so a save never touches rows this
// device didn't change. Fire-and-forget from the caller's perspective; errors
// surface via a toast, and a failed batch is retried by the next save.

interface ChangeTracker<T extends { id: number }> {
  label: string;
  kind: EntityKind;
  current: () => T[];
  upsert: (items: T[]) => Promise<RecordCompanyLink[]>;
  remove: (ids: number[]) => Promise<void>;
  saved: Map<number, string>;
  queue: Promise<void>;
}

function tracker<T extends { id: number }>(
  label: string, kind: EntityKind, current: () => T[], upsert: (items: T[]) => Promise<RecordCompanyLink[]>, remove: (ids: number[]) => Promise<void>,
): ChangeTracker<T> {
  return { label, kind, current, upsert, remove, saved: new Map(), queue: Promise.resolve() };
}

const trackers = {
  proposals: tracker('proposals', 'proposal', () => S.proposals, upsertProposals, deleteProposals),
  contacts: tracker('contacts', 'contact', () => S.contacts, upsertContacts, deleteContacts),
  agreements: tracker('agreements', 'agreement', () => S.agreements, upsertAgreements, deleteAgreements),
  todos: tracker('tasks', 'task', () => S.todos, upsertTodos, deleteTodos),
  notes: tracker('notes', 'note', () => S.notes, upsertNotes, deleteNotes),
};

function saveChanges<T extends { id: number }>(t: ChangeTracker<T>): Promise<void> {
  // Chained so two quick saves can't land in the database out of order.
  t.queue = t.queue.then(async () => {
    const snapshot = new Map<number, string>();
    const changed: T[] = [];
    for (const item of t.current()) {
      const json = JSON.stringify(item);
      snapshot.set(item.id, json);
      if (t.saved.get(item.id) !== json) changed.push(item);
    }
    const removed = [...t.saved.keys()].filter((id) => !snapshot.has(id));
    if (changed.length === 0 && removed.length === 0) return;
    const links = await persistReturning(t.label, async () => {
      if (removed.length) await t.remove(removed);
      return changed.length ? t.upsert(changed) : [];
    });
    if (!links) return;
    for (const id of removed) t.saved.delete(id);
    for (const item of changed) t.saved.set(item.id, snapshot.get(item.id)!);
    emitChange({ kind: t.kind, ids: [...removed, ...changed.map((i) => i.id)] });
    await applyCompanyLinks(t, links);
  }).catch((err) => console.error(`[persist] ${t.label} change tracking failed:`, err));
  return t.queue;
}

/** The backend decides which company a record belongs to on save; copy that
 * onto the in-memory record so company views match by id straight away. */
async function applyCompanyLinks<T extends { id: number }>(t: ChangeTracker<T>, links: RecordCompanyLink[]): Promise<void> {
  let linkChanged = false;
  let unknownCompany = false;
  for (const link of links) {
    const item = t.current().find((x) => x.id === link.id) as (T & { companyId?: number | null }) | undefined;
    if (!item || (item.companyId ?? null) === link.companyId) continue;
    const savedJson = t.saved.get(item.id);
    const untouchedSinceSave = savedJson === JSON.stringify(item);
    item.companyId = link.companyId;
    if (untouchedSinceSave) t.saved.set(item.id, JSON.stringify(item));
    linkChanged = true;
    if (link.companyId != null && !S.companies.some((c) => c.id === link.companyId)) unknownCompany = true;
  }
  if (unknownCompany) S.companies = await getCompanies();
  if (linkChanged) refreshAll();
}

/** Record the in-memory arrays as matching the database — call right after
 * loading them from it (startup, restore). */
export function markLoadedAsSaved(): void {
  const mark = <T extends { id: number }>(t: ChangeTracker<T>) => {
    t.saved = new Map(t.current().map((item) => [item.id, JSON.stringify(item)]));
  };
  mark(trackers.proposals); mark(trackers.contacts); mark(trackers.agreements); mark(trackers.todos); mark(trackers.notes);
  savedCompanyNotes = new Map(Object.entries(S.companyNotes).filter(([, v]) => (v || '').trim()));
}

/** Resolves once every queued proposal/agreement save has reached the database. */
export function proposalsAndAgreementsSaved(): Promise<void> {
  return Promise.all([trackers.proposals.queue, trackers.agreements.queue]).then(() => undefined);
}

/** Agreements the backend created itself are already stored; record them as saved. */
export function markAgreementsSaved(items: { id: number }[]): void {
  for (const a of items) trackers.agreements.saved.set(a.id, JSON.stringify(a));
}

export function persistProposals(): void { void saveChanges(trackers.proposals); }
export function persistContacts(): void { void saveChanges(trackers.contacts); }
export function persistAgreements(): void { void saveChanges(trackers.agreements); }
export function persistTodos(): void { void saveChanges(trackers.todos); }
export function persistNotes(): void { void saveChanges(trackers.notes); }
/** Saves pending task / note changes and resolves once they are in the
 * database — for writes that refer to a record just created (entity links). */
export function saveTodosNow(): Promise<void> { return saveChanges(trackers.todos); }
export function saveNotesNow(): Promise<void> { return saveChanges(trackers.notes); }
// Folder and contact-list names are small lists saved whole; queued so a
// quicker second save can never be overtaken by the first.
let listsQueue: Promise<void> = Promise.resolve();
function queued(label: string, save: () => Promise<void>): Promise<void> {
  listsQueue = listsQueue.then(() => persist(label, save));
  return listsQueue;
}
export function persistNoteFolders(): Promise<void> { const items = [...S.noteFolders]; return queued('note folders', () => saveNoteFolders(items)); }
export function persistContactLists(): Promise<void> { const items = [...S.contactLists]; return queued('contact lists', () => saveContactLists(items)); }

/** Company notes as last saved, by company name — so only changed companies are written. */
let savedCompanyNotes = new Map<string, string>();
let companyNotesQueue: Promise<void> = Promise.resolve();
export function persistCompanyNotes(): Promise<void> {
  companyNotesQueue = companyNotesQueue.then(async () => {
    const current = new Map(Object.entries(S.companyNotes).filter(([, v]) => (v || '').trim()));
    const names = new Set([...current.keys(), ...savedCompanyNotes.keys()]);
    for (const name of names) {
      const text = current.get(name) || '';
      if ((savedCompanyNotes.get(name) || '') === text) continue;
      let ok = false;
      await persist('company notes', async () => { await saveCompanyNote(name, text); ok = true; });
      if (!ok) continue;
      if (text) savedCompanyNotes.set(name, text); else savedCompanyNotes.delete(name);
    }
  });
  return companyNotesQueue;
}

// Projects/Opportunities/Meetings save a single row and need the server-assigned
// result back (new id, computed fields) — persistReturning() surfaces failures
// via the same toast while still resolving to that row on success.
function emitSaved<T extends { id: number }>(kind: EntityKind, saved: T | undefined): T | undefined {
  if (saved) emitChange({ kind, ids: [saved.id] });
  return saved;
}

export function persistProject(p: Project): Promise<Project | undefined> { return persistReturning('project', () => saveProject(p)).then((r) => emitSaved('project', r)); }
export function persistMilestones(projectId: number, items: Milestone[]): Promise<void> { return persist('milestones', () => saveMilestones(projectId, items)).then(() => emitChange({ kind: 'project', ids: [projectId] })); }
export function persistOpportunity(o: Opportunity): Promise<Opportunity | undefined> { return persistReturning('opportunity', () => saveOpportunity(o)).then((r) => emitSaved('opportunity', r)); }
export function persistMeeting(m: Meeting): Promise<Meeting | undefined> { return persistReturning('meeting', () => saveMeeting(m)).then((r) => emitSaved('meeting', r)); }
export function persistCreateCompany(name: string): Promise<Company | undefined> { return persistReturning('company', () => createCompany(name)).then((r) => emitSaved('company', r)); }
