import { collapseRow, collapseRows, settleNew } from '../lib/motion';
import { optimistic } from '../lib/optimistic';
import { S } from '../lib/state';
import { emptyState, undoToast } from '../lib/ui';
import { today, escHtml, expose, nextNoteId, showConfirm } from '../lib/utils';
import { registerTabRenderer, registerBadgeUpdater } from '../lib/registry';
import { addInboxItem, resolveInboxItem, deleteInboxItem, getAppMeta, setAppMeta } from '../lib/db';
import { persistTodos, persistNotes } from '../lib/persist';
import type { InboxItem, Todo, Note } from '../lib/types';
import { icon } from '../lib/icons';
import { showContextMenu } from '../lib/contextMenu';
import { toast } from '../lib/ui';
import { persistContacts, persistOpportunity } from '../lib/persist';
import { parseTaskInput, friendlyDate, type ParsedTask } from '../lib/taskParse';
import { companyLink } from '../lib/links';
import { plural, tileHtml } from '../lib/pageKit';
import { capturedWhen, inboxDestinations, inboxSummary, kindLook, offerChip, parseZeroDays, withZeroDay, zeroDaysThisMonth, zeroHeadline, type DestinationKey } from '../lib/inboxPage';
import { nextCtId } from '../lib/utils';
import { nameFromEmail } from '../lib/clientMatch';
import { addTaskFromText } from './todo';

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

// The days the inbox was seen empty, kept as a list of dates in app_meta (read once, then held here).
const ZERO_DAYS_KEY = 'inbox_zero_days';
let zeroDays: string[] | null = null;

/** The inbox is at zero: today joins the list (once a day), and the panel says how many days this month. */
function noteZeroDay(): void {
  const record = (list: string[]) => {
    const next = withZeroDay(list, today());
    if (next.length !== list.length) void setAppMeta(ZERO_DAYS_KEY, JSON.stringify(next)).catch(() => undefined);
    zeroDays = next;
    const h = document.getElementById('inbox-zero-h');
    if (h) h.textContent = zeroHeadline(zeroDaysThisMonth(next, today()));
  };
  if (zeroDays) { record(zeroDays); return; }
  void getAppMeta(ZERO_DAYS_KEY).then((raw) => record(parseZeroDays(raw))).catch(() => record([]));
}

const parse = (text: string): ParsedTask => parseTaskInput(text, { today: new Date(), projects: [], companies: S.companies.map((c) => ({ id: c.id, name: c.name })) });

export function renderInbox(): void {
  const list = document.getElementById('inbox-list');
  if (!list) return;
  const items = unprocessedInboxItems();
  const summary = document.getElementById('inbox-summary'); if (summary) summary.textContent = inboxSummary(items, new Date());
  if (items.length === 0) {
    // All there is to see at zero: a green line and the count of days it was reached.
    list.innerHTML = `<div class="inbox-zero"><span class="bars" aria-hidden="true"><i></i><i></i><i></i></span><div><b id="inbox-zero-h">${escHtml(zeroHeadline(zeroDays ? zeroDaysThisMonth(zeroDays, today()) : 0))}</b><span>Capture anything above; sort it out later.</span></div></div>`;
    noteZeroDay();
    return;
  }
  list.innerHTML = `<div class="task-group-hd inbox-hd"><i style="--c:var(--blue)" aria-hidden="true"></i><b>To sort</b><span class="task-group-count">${items.length}</span>${items.length > 1 ? '<button class="task-group-link" onclick="inboxSortAll()">Sort all…</button>' : ''}</div>
    ${items.map(inboxRow).join('')}`;
}
registerTabRenderer('inbox', renderInbox);
expose('renderInbox', renderInbox);

function inboxRow(i: InboxItem): string {
  const look = kindLook(i.itemType);
  const parsed = parse(i.content);
  const company = parsed.companyName ? S.companies.find((c) => c.name === parsed.companyName) : null;
  const d = inboxDestinations(i.itemType, parsed.companyName);
  const offer = i.itemType === 'followup' ? offerChip(parsed.companyName, S.proposals, today()) : null;
  const chips = [
    parsed.dueDate ? `<span class="task-chip t-amber">${escHtml(`${friendlyDate(parsed.dueDate, new Date()).toLowerCase()}${parsed.dueTime ? ` ${parsed.dueTime}` : ''}`)}</span>` : '',
    offer ? `<span class="task-chip t-${offer.tone}">${escHtml(offer.text)}</span>` : '',
    ...parsed.tags.slice(0, 3).map((t) => `<span class="task-chip"># ${escHtml(t)}</span>`),
    parsed.companyName ? `<span class="pk-mini-co task-co">${tileHtml(parsed.companyName, 'pk-tile mini')}${companyLink(company?.id ?? null, parsed.companyName)}</span>` : '',
  ].filter(Boolean).join('');
  const when = capturedWhen(i.createdAt, new Date());
  const go = (key: DestinationKey) => `inboxSend(${i.id},'${key}')`;
  return `<div class="inbox-item" data-inbox-id="${i.id}" oncontextmenu="inboxItemMenu(event, ${i.id})">
    <div class="inbox-item-type t-${look.tone}" aria-hidden="true">${look.glyph}</div>
    <div class="inbox-item-main">
      <div class="inbox-item-content" title="${escHtml(i.content)}">${escHtml(parsed.title.trim() || i.content)}</div>
      <div class="inbox-item-meta"><span class="inbox-item-kind">→ ${look.label}</span>${chips}${when ? `<span class="inbox-item-when">${escHtml(when)}</span>` : ''}</div>
    </div>
    <div class="inbox-item-actions">
      <button class="btn-secondary btn-sm inbox-go" onclick="${go(d.best.key)}">${escHtml(d.best.label)}</button>
      ${d.others.map((o) => `<button class="btn-secondary btn-sm" onclick="${go(o.key)}">${escHtml(o.label)}</button>`).join('')}
      <button class="rec-icon-btn" onclick="inboxItemMenu(event, ${i.id})" data-tip="More" aria-label="More">${icon('more', 14)}</button>
      <button class="rec-icon-btn" onclick="dismissInboxItem(${i.id})" data-tip="Dismiss" aria-label="Dismiss">${icon('close', 14)}</button>
    </div>
  </div>`;
}

/** Sends a captured line where a button says. */
export async function inboxSend(id: number, key: DestinationKey): Promise<void> {
  const item = S.inboxItems.find((i) => i.id === id);
  if (!item) return;
  if (key === 'task') await convertInboxToTask(id, false);
  else if (key === 'followup') await convertInboxToTask(id, true);
  else if (key === 'note') await convertInboxToNote(id);
  else if (key === 'client_note') await convertInboxToNote(id, parse(item.content).companyName);
  else await convertInboxToOpportunity(id);
}
expose('inboxSend', inboxSend);

/** "Sort all…": each line goes to its first choice, after one question that lists them. */
export async function inboxSortAll(): Promise<void> {
  const items = unprocessedInboxItems();
  if (!items.length) return;
  const plan = items.map((i) => ({ i, to: inboxDestinations(i.itemType, parse(i.content).companyName).best }));
  const lines = plan.slice(0, 8).map(({ i, to }) => `${to.label.replace(/^Make /, '').replace(/^./, (c) => c.toUpperCase())} · ${i.content.length > 60 ? `${i.content.slice(0, 59)}…` : i.content}`);
  const ok = await showConfirm(`${lines.join('\n')}${plan.length > 8 ? `\n… and ${plan.length - 8} more` : ''}`, { title: `Sort ${plural(plan.length, 'item')} to their first choice?`, confirmLabel: 'Sort all' });
  if (!ok) return;
  // An opportunity opens its page, so those are left for a click of their own.
  for (const { i, to } of plan) if (to.key !== 'opportunity') await inboxSend(i.id, to.key);
}
expose('inboxSortAll', inboxSortAll);

export async function captureInboxItem(e: Event): Promise<void> {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  const itemType = (f.elements.namedItem('inboxType') as HTMLSelectElement).value;
  const content = (f.elements.namedItem('inboxContent') as HTMLInputElement).value.trim();
  if (!content) return;
  // ">> …" / "<< …" is a commitment, not something to sort later.
  if (/^(>>|<<)/.test(content)) {
    if (await (window as any).captureCommitment?.(content)) (f.elements.namedItem('inboxContent') as HTMLInputElement).value = '';
    return;
  }
  const created = await addInboxItem(itemType, content);
  S.inboxItems.unshift(created);
  (f.elements.namedItem('inboxContent') as HTMLInputElement).value = '';
  (f.elements.namedItem('inboxContent') as HTMLInputElement).focus();
  updateInboxBadge();
  renderInbox();
  settleNew(document.querySelector(`.inbox-item[data-inbox-id="${created.id}"]`));
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
export async function convertInboxToTask(id: number, followUp?: boolean): Promise<void> {
  const item = S.inboxItems.find((i) => i.id === id);
  if (!item) return;
  // A follow-up is a task tagged follow-up: by its kind, or because the button said so.
  const t = addTaskFromText(item.content, (followUp ?? item.itemType === 'followup') ? { tags: ['follow-up'] } : {});
  if (!t) return;
  await resolveAndRemove(id, 'task', t.id);
  toast(`Task added${t.dueDate ? ` for ${t.dueDate}` : ''}${t.client ? ` · ${t.client}` : ''}`, { action: { label: 'Open', run: () => (window as any).openRecord('task', t.id) } });
}
expose('convertInboxToTask', convertInboxToTask);

export async function convertInboxToNote(id: number, clientName?: string | null): Promise<void> {
  const item = S.inboxItems.find((i) => i.id === id);
  if (!item) return;
  // Notes are Markdown: the line goes in as it was written. With a client it is that client's note.
  const n: Note = {
    id: nextNoteId(), title: item.content.slice(0, 60), content: item.content, folder: '',
    clientName: clientName || '', tags: [], pinned: false, createdAt: today(), updatedAt: today(),
  };
  S.notes.unshift(n);
  persistNotes();
  await resolveAndRemove(id, 'note', n.id);
  toast(clientName ? `Added to ${clientName} notes` : 'Note added', { action: { label: 'Open', run: () => (window as any).openRecord('note', n.id) } });
}
expose('convertInboxToNote', convertInboxToNote);

export async function dismissInboxItem(id: number): Promise<void> {
  const item = S.inboxItems.find((i) => i.id === id);
  if (!item) return;
  const redraw = () => { updateInboxBadge(); renderInbox(); (window as any).renderMyDay?.(); };
  await collapseRow(document.querySelector(`.inbox-item[data-inbox-id="${id}"]`));
  await optimistic({
    apply: () => { S.inboxItems = S.inboxItems.filter((i) => i.id !== id); redraw(); },
    commit: () => deleteInboxItem(id),
    revert: () => { if (!S.inboxItems.some((i) => i.id === id)) S.inboxItems = [...S.inboxItems, item]; redraw(); },
  });
  undoToast('Dismissed', () => {
    void addInboxItem(item.itemType, item.content).then((back) => { S.inboxItems = [back, ...S.inboxItems]; redraw(); });
  });
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
