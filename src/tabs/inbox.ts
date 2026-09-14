import { S } from '../lib/state';
import { emptyState } from '../lib/ui';
import { today, escHtml, expose, nextNoteId } from '../lib/utils';
import { registerTabRenderer, registerBadgeUpdater } from '../lib/registry';
import { addInboxItem, resolveInboxItem, deleteInboxItem } from '../lib/db';
import { persistTodos, persistNotes } from '../lib/persist';
import type { InboxItem, Todo, Note } from '../lib/types';
import { icon } from '../lib/icons';
import { showContextMenu } from '../lib/contextMenu';
import { toast } from '../lib/ui';
import { persistContacts, persistOpportunity } from '../lib/persist';
import { parseTaskInput } from '../lib/taskParse';
import { nextCtId } from '../lib/utils';
import { nameFromEmail } from '../lib/clientMatch';
import { addTaskFromText } from './todo';

const TYPE_ICON: Record<string, string> = { task: 'check', note: 'note', idea: 'bolt', followup: 'warning' };
const TYPE_LABEL: Record<string, string> = { task: 'Task', note: 'Note', idea: 'Idea', followup: 'Follow-up' };

export function updateInboxBadge(): void {
  const n = S.inboxItems.filter((i) => !i.processed).length;
  const el = document.getElementById('inbox-badge');
  if (el) { el.textContent = String(n); el.style.display = n > 0 ? '' : 'none'; }
}
registerBadgeUpdater(updateInboxBadge);
expose('updateInboxBadge', updateInboxBadge);

export function unprocessedInboxItems(): InboxItem[] {
  return S.inboxItems.filter((i) => !i.processed).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export function renderInbox(): void {
  const list = document.getElementById('inbox-list');
  if (!list) return;
  const items = unprocessedInboxItems();
  if (items.length === 0) {
    list.innerHTML = `<div class="card">${emptyState({ icon: 'inbox', title: 'Inbox zero', body: 'Capture anything above — sort it out later.' })}</div>`;
    return;
  }
  list.innerHTML = `<div class="card inbox-card">${items.map(inboxRow).join('')}</div>`;
}
registerTabRenderer('inbox', renderInbox);
expose('renderInbox', renderInbox);

function inboxRow(i: InboxItem): string {
  return `<div class="inbox-item">
    <div class="inbox-item-type" title="${TYPE_LABEL[i.itemType] || i.itemType}">${icon(TYPE_ICON[i.itemType] || 'inbox', 15)}</div>
    <div class="inbox-item-content">${escHtml(i.content)}</div>
    <div class="inbox-item-actions">
      <button class="btn-sm" onclick="convertInboxToTask(${i.id})" title="Turn into a task — dates, times, !priority and company names are picked up">&rarr; Task</button>
      <button class="btn-sm" onclick="convertInboxToNote(${i.id})" title="Turn into a note">&rarr; Note</button>
      <button class="rec-icon-btn" onclick="inboxItemMenu(event, ${i.id})" title="More" aria-label="More">${icon('more', 14)}</button>
    </div>
  </div>`;
}

export async function captureInboxItem(e: Event): Promise<void> {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  const itemType = (f.elements.namedItem('inboxType') as HTMLSelectElement).value;
  const content = (f.elements.namedItem('inboxContent') as HTMLInputElement).value.trim();
  if (!content) return;
  const created = await addInboxItem(itemType, content);
  S.inboxItems.unshift(created);
  (f.elements.namedItem('inboxContent') as HTMLInputElement).value = '';
  (f.elements.namedItem('inboxContent') as HTMLInputElement).focus();
  updateInboxBadge();
  renderInbox();
  (window as any).renderMyDay?.();
}
expose('captureInboxItem', captureInboxItem);

async function resolveAndRemove(id: number, convertedToType: string | null, convertedToId: number | null): Promise<void> {
  await resolveInboxItem(id, convertedToType, convertedToId);
  S.inboxItems = S.inboxItems.filter((i) => i.id !== id);
  updateInboxBadge();
  renderInbox();
  (window as any).renderMyDay?.();
}

/** A task, with any date, time, priority or company in the text picked up. */
export async function convertInboxToTask(id: number): Promise<void> {
  const item = S.inboxItems.find((i) => i.id === id);
  if (!item) return;
  const t = addTaskFromText(item.content, item.itemType === 'followup' ? { tags: ['follow-up'] } : {});
  if (!t) return;
  await resolveAndRemove(id, 'task', t.id);
  toast(`Task added${t.dueDate ? ` for ${t.dueDate}` : ''}${t.client ? ` · ${t.client}` : ''}`, { action: { label: 'Open', run: () => (window as any).openRecord('task', t.id) } });
}
expose('convertInboxToTask', convertInboxToTask);

export async function convertInboxToNote(id: number): Promise<void> {
  const item = S.inboxItems.find((i) => i.id === id);
  if (!item) return;
  const n: Note = {
    id: nextNoteId(), title: item.content.slice(0, 60), content: `<p>${escHtml(item.content)}</p>`, folder: '',
    clientName: '', tags: [], pinned: false, createdAt: today(), updatedAt: today(),
  };
  S.notes.unshift(n);
  persistNotes();
  await resolveAndRemove(id, 'note', n.id);
}
expose('convertInboxToNote', convertInboxToNote);

export async function dismissInboxItem(id: number): Promise<void> {
  await deleteInboxItem(id);
  S.inboxItems = S.inboxItems.filter((i) => i.id !== id);
  updateInboxBadge();
  renderInbox();
  (window as any).renderMyDay?.();
}
expose('dismissInboxItem', dismissInboxItem);

/** A new opportunity, linked to the company named in the text when there is one. */
export async function convertInboxToOpportunity(id: number): Promise<void> {
  const item = S.inboxItems.find((i) => i.id === id);
  if (!item) return;
  const parsed = parseTaskInput(item.content, { today: new Date(), projects: [], companies: S.companies.map((c) => ({ id: c.id, name: c.name })) });
  const saved = await persistOpportunity({
    id: 0, name: parsed.title || item.content, companyId: null, companyName: parsed.companyName, owner: null, stage: 'Lead', status: 'Open',
    estimatedValue: null, currency: 'SAR', probability: null, expectedCloseDate: parsed.dueDate, description: item.content, nextAction: null,
    proposalId: null, projectId: null, sortOrder: null, archived: false, createdAt: null, updatedAt: null, tags: [],
  });
  if (!saved) return;
  S.opportunities.push(saved);
  await resolveAndRemove(id, 'opportunity', saved.id);
  (window as any).openRecord('opportunity', saved.id);
}
expose('convertInboxToOpportunity', convertInboxToOpportunity);

/** A new contact: an email address in the text becomes the contact's email and name. */
export async function convertInboxToContact(id: number): Promise<void> {
  const item = S.inboxItems.find((i) => i.id === id);
  if (!item) return;
  const email = item.content.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] || null;
  const phone = item.content.match(/\+?\d[\d\s-]{7,}\d/)?.[0]?.trim() || null;
  const parsed = parseTaskInput(item.content, { today: new Date(), projects: [], companies: S.companies.map((c) => ({ id: c.id, name: c.name })) });
  const rest = item.content.replace(email || '', '').replace(phone || '', '').replace(parsed.companyName || '', '').replace(/[,;|·-]+/g, ' ').trim();
  const name = rest && rest.split(/\s+/).length <= 4 ? rest : email ? nameFromEmail(email) : item.content.slice(0, 60);
  const contact = { id: nextCtId(), clientName: parsed.companyName, name, role: null, email, phone, whatsapp: null, service: null, lists: [] as string[] };
  S.contacts.push(contact);
  persistContacts();
  await resolveAndRemove(id, 'contact', contact.id);
  (window as any).openRecord('contact', contact.id);
}
expose('convertInboxToContact', convertInboxToContact);

export function inboxItemMenu(e: MouseEvent, id: number): void {
  showContextMenu(e, [
    { label: 'Turn into an opportunity', iconName: 'briefcase', run: () => { void convertInboxToOpportunity(id); } },
    { label: 'Turn into a contact', iconName: 'people', run: () => { void convertInboxToContact(id); } },
    { label: '', run: () => {}, separator: true },
    { label: 'Dismiss', iconName: 'trash', danger: true, run: () => { void dismissInboxItem(id); } },
  ]);
}
expose('inboxItemMenu', inboxItemMenu);

export function setInboxKind(kind: string): void {
  const input = document.querySelector<HTMLInputElement>('.inbox-composer input[name="inboxType"]');
  if (input) input.value = kind;
  document.querySelectorAll<HTMLElement>('.inbox-kind').forEach((b) => b.classList.toggle('active', b.dataset.kind === kind));
  document.getElementById('inbox-capture-input')?.focus();
}
expose('setInboxKind', setInboxKind);
