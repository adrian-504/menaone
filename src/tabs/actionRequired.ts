import { S } from '../lib/state';
import { emptyState } from '../lib/ui';
import { renderIcons } from '../core/chrome';
import { showContextMenu } from '../lib/contextMenu';
import { toast, undoToast } from '../lib/ui';
import { companyLink, recordLink } from '../lib/links';
import { escHtml, expose, today, fmtDate, nextTodoId, nextNoteId, localIsoDate } from '../lib/utils';
import { registerTabRenderer, registerBadgeUpdater } from '../lib/registry';
import {
  ms365Status, ms365GetCachedEmails, ms365SyncFlaggedEmails, ms365UpdateEmailFlag,
  ms365OpenEmail, ms365SetEmailCompany, ms365GetCompletedEmails, ms365ReflagEmail, getLinksFor, setLinksFrom,
} from '../lib/db';
import { persistTodos, persistNotes } from '../lib/persist';
import { taskFields, companyOf, EMPTY_CONTEXT } from '../lib/workGraph';
import { attachCompanySelector } from '../lib/companySelector';
import { openRecord } from '../core/router';
import type { EmailRecord, Todo, Note, EntityLink } from '../lib/types';
import { icon } from '../lib/icons';

// Per-email link cache (email id -> its entity_links), populated lazily on
// demand rather than N upfront queries on every render — Action Required is
// re-rendered often (filter/sort changes, sync completion) and most emails'
// link popovers are never opened in a given session.
const linkCache = new Map<number, EntityLink[]>();
let loadedOnce = false;

function sameDay(iso: string, d: Date): boolean {
  const x = new Date(iso);
  return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth() && x.getDate() === d.getDate();
}

export function updateActionRequiredBadge(): void {
  const el = document.getElementById('ar-badge');
  if (!el) return;
  const now = Date.now();
  const n = S.emails.filter((e) => !e.flagDueAt || new Date(e.flagDueAt).getTime() <= now).length;
  el.textContent = String(n);
  el.style.display = n > 0 ? '' : 'none';
}
registerBadgeUpdater(updateActionRequiredBadge);

async function ensureLoaded(): Promise<void> {
  if (!S.ms365Status) S.ms365Status = await ms365Status();
  if (S.ms365Status.status !== 'connected') return;
  if (loadedOnce) return;
  loadedOnce = true;
  S.emails = await ms365GetCachedEmails();
  paintActionRequired();
  void syncNow(true);
}

export async function arSyncNow(): Promise<void> {
  await syncNow(false);
}
expose('arSyncNow', arSyncNow);

async function syncNow(silent: boolean): Promise<void> {
  if (!S.ms365Status || S.ms365Status.status !== 'connected') return;
  S.ms365Syncing = true;
  if (!silent) paintActionRequired();
  try {
    S.emails = await ms365SyncFlaggedEmails();
  } catch (e) {
    if (!silent) toast('Could not sync with Outlook', { tone: 'error', detail: String(e) });
  }
  S.ms365Syncing = false;
  updateActionRequiredBadge();
  paintActionRequired();
}

export function setArFilter(f: string): void {
  S.arFilter = f as typeof S.arFilter;
  if (f === 'completed' && S.emailCompletedLog.length === 0) {
    void ms365GetCompletedEmails().then((log) => { S.emailCompletedLog = log; paintActionRequired(); });
  }
  paintActionRequired();
}
expose('setArFilter', setArFilter);

export function setArSort(v: string): void {
  S.arSort = v as typeof S.arSort;
  paintActionRequired();
}
expose('setArSort', setArSort);

function filteredEmails(): EmailRecord[] {
  const now = Date.now();
  let list = S.emails.slice();
  if (S.arFilter === 'due-today') {
    list = list.filter((e) => e.flagDueAt && sameDay(e.flagDueAt, new Date()));
  } else if (S.arFilter === 'overdue') {
    list = list.filter((e) => e.flagDueAt && new Date(e.flagDueAt).getTime() < now && !sameDay(e.flagDueAt, new Date()));
  } else if (S.arFilter === 'recent') {
    list = list.filter((e) => e.receivedAt && now - new Date(e.receivedAt).getTime() < 48 * 3600_000);
  }
  if (S.arSort === 'due') list.sort((a, b) => (a.flagDueAt || '9999').localeCompare(b.flagDueAt || '9999'));
  else if (S.arSort === 'sender') list.sort((a, b) => (a.senderName || a.senderEmail || '').localeCompare(b.senderName || b.senderEmail || ''));
  else list.sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));
  return list;
}

export function renderActionRequired(): void {
  const root = document.getElementById('ar-root');
  if (!root) return;
  void ensureLoaded().then(() => {
    if (document.getElementById('ar-root')) paintActionRequired();
  });
  paintActionRequired();
}
registerTabRenderer('action-required', renderActionRequired);
expose('renderActionRequired', renderActionRequired);

function paintActionRequired(): void {
  const root = document.getElementById('ar-root');
  const syncBtn = document.getElementById('ar-sync-btn');
  const syncedSub = document.getElementById('ar-synced-sub');
  if (!root) return;

  if (syncBtn) (syncBtn as HTMLButtonElement).disabled = S.ms365Syncing;
  if (syncBtn) syncBtn.textContent = S.ms365Syncing ? 'Syncing…' : 'Sync Now';
  if (syncedSub) syncedSub.textContent = S.ms365Status?.lastSyncAt ? `Last synced ${fmtDate(S.ms365Status.lastSyncAt)}` : '';

  document.querySelectorAll('.ar-fbtn').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.filter === S.arFilter));

  if (!S.ms365Status || S.ms365Status.status !== 'connected') {
    root.innerHTML = `<div class="card">${emptyState({ icon: 'mail', title: 'Not connected to Microsoft 365', body: 'Connect Outlook in Settings to see your flagged emails here.', action: { label: 'Open settings', onclick: "navToModule('settings')" } })}</div>`;
    renderIcons(root);
    return;
  }

  if (S.arFilter === 'completed') {
    const log = S.emailCompletedLog;
    root.innerHTML = log.length === 0
      ? `<div class="card">${emptyState({ icon: 'check', title: 'No completed emails yet', compact: true })}</div>`
      : `<div class="card ar-list">${log.map((e) => `<div class="ar-row done">
          <span class="task-check checked" aria-hidden="true"></span>
          <div class="ar-main">
            <div class="ar-subject">${escHtml(e.subject || '(No subject)')}</div>
            <div class="ar-meta">${escHtml(e.senderName || e.senderEmail || 'Unknown sender')} · completed ${fmtDate(e.completedAt)}</div>
          </div>
          <div class="ar-actions">
            <button class="task-hover-btn" onclick="arReflagEmail('${escHtml(e.messageId).replace(/'/g, "\\'")}')" title="Flag again in Outlook" aria-label="Flag ${escHtml(e.subject || 'this email')} again">${icon('flag', 14)}</button>
          </div>
        </div>`).join('')}</div>`;
    renderIcons(root);
    return;
  }

  const list = filteredEmails();
  if (list.length === 0) {
    root.innerHTML = `<div class="card">${emptyState({ icon: 'check', title: 'All caught up', body: 'No flagged emails match this view.' })}</div>`;
    renderIcons(root);
    return;
  }
  root.innerHTML = `<div class="card ar-list">${list.map(emailRow).join('')}</div>`;
}

function dueBadge(e: EmailRecord): { label: string; tone: string } {
  if (!e.flagDueAt) return { label: '', tone: 'muted' };
  const now = new Date();
  const due = new Date(e.flagDueAt);
  if (sameDay(e.flagDueAt, now)) return { label: 'Due today', tone: 'amber' };
  if (due.getTime() < now.getTime()) return { label: 'Overdue', tone: 'red' };
  const days = Math.ceil((due.getTime() - now.getTime()) / 86400_000);
  return { label: `Due in ${days}d`, tone: 'muted' };
}

function emailRow(e: EmailRecord): string {
  const b = dueBadge(e);
  const links = linkCache.get(e.id);
  const chips: string[] = [];
  if (e.companyName) chips.push(companyLink(e.companyId, e.companyName, { chip: true }));
  if (links) {
    for (const l of links) {
      if (l.toType === 'project') {
        const p = S.projects.find((x) => x.id === l.toId);
        if (p) chips.push(recordLink('project', p.id, p.name, { chip: true }));
      } else if (l.toType === 'contact') {
        const c = S.contacts.find((x) => x.id === l.toId);
        if (c) chips.push(recordLink('contact', c.id, c.name, { chip: true }));
      }
    }
  }
  return `<div class="ar-row${e.isRead ? '' : ' unread'}" oncontextmenu="arEmailMenu(event, ${e.id})">
    <button class="task-check" onclick="arCompleteEmail(${e.id})" title="Mark complete in Outlook" aria-label="Complete"></button>
    <div class="ar-main" onclick="arOpenEmail(${e.id})">
      <div class="ar-top">
        <span class="ar-subject">${escHtml(e.subject || '(No subject)')}</span>
        ${b.label ? `<span class="rec-badge tone-${b.tone}">${b.label}</span>` : ''}
      </div>
      <div class="ar-meta">${escHtml(e.senderName || e.senderEmail || 'Unknown sender')}${e.receivedAt ? ` · ${fmtDate(e.receivedAt.slice(0, 10))}` : ''}</div>
      ${e.preview ? `<div class="ar-preview">${escHtml(e.preview)}</div>` : ''}
      ${chips.length ? `<div class="ar-chips" onclick="event.stopPropagation()">${chips.join('')}</div>` : ''}
      <div class="ar-link-popover" id="ar-link-pop-${e.id}" style="display:none" onclick="event.stopPropagation()"></div>
      ${taskDraft?.emailId === e.id ? taskDraftRow(e) : ''}
    </div>
    <div class="ar-actions">
      <button class="task-hover-btn" onclick="event.stopPropagation();arCreateTask(${e.id})" title="Create a task from this email" aria-label="Create task">${icon('task', 14)}</button>
      <button class="task-hover-btn" onclick="arOpenEmail(${e.id})" title="Open in Outlook" aria-label="Open in Outlook">${icon('link', 14)}</button>
      <button class="task-hover-btn" onclick="event.stopPropagation();arEmailMenu(event, ${e.id})" title="More" aria-label="More">${icon('more', 14)}</button>
    </div>
  </div>`;
}

export function arEmailMenu(ev: MouseEvent, id: number): void {
  showContextMenu(ev, [
    { label: 'Open in Outlook', iconName: 'link', run: () => { void arOpenEmail(id); } },
    { label: 'Mark complete', iconName: 'check', run: () => { void arCompleteEmail(id); } },
    { label: 'Remove flag', iconName: 'flag', run: () => { void arUnflagEmail(id); } },
    { label: '', run: () => {}, separator: true },
    { label: 'Create task', iconName: 'check', run: () => { void arCreateTask(id); } },
    { label: 'Create note', iconName: 'note', run: () => { void arCreateNote(id); } },
    { label: 'Create follow-up', iconName: 'clock', run: () => { void arCreateFollowUp(id); } },
    { label: 'Link to company, project or contact…', iconName: 'link', run: () => { void arToggleLinkPopover(id); } },
  ]);
}
expose('arEmailMenu', arEmailMenu);

export async function arOpenEmail(id: number): Promise<void> {
  await ms365OpenEmail(id);
}
expose('arOpenEmail', arOpenEmail);

async function removeEmailLocally(id: number): Promise<void> {
  S.emails = S.emails.filter((e) => e.id !== id);
  linkCache.delete(id);
  updateActionRequiredBadge();
  renderActionRequired();
}

export async function arCompleteEmail(id: number): Promise<void> {
  const messageId = S.emails.find((e) => e.id === id)?.messageId;
  try {
    await ms365UpdateEmailFlag(id, true);
  } catch (e) {
    toast('Could not update the flag in Outlook', { tone: 'error', detail: String(e) });
    return;
  }
  S.emailCompletedLog = [];
  await removeEmailLocally(id);
  if (messageId) undoToast('Marked complete in Outlook', () => { void arReflagEmail(messageId); });
}
expose('arCompleteEmail', arCompleteEmail);

export async function arUnflagEmail(id: number): Promise<void> {
  const messageId = S.emails.find((e) => e.id === id)?.messageId;
  try {
    await ms365UpdateEmailFlag(id, false);
  } catch (e) {
    toast('Could not update the flag in Outlook', { tone: 'error', detail: String(e) });
    return;
  }
  await removeEmailLocally(id);
  if (messageId) undoToast('Flag removed in Outlook', () => { void arReflagEmail(messageId); });
}
expose('arUnflagEmail', arUnflagEmail);

/**
 * Puts an email back: the flag lives in Outlook, so undo has to reach it
 * there. Works from the Outlook message id because completing an email
 * usually deletes the local row.
 */
export async function arReflagEmail(messageId: string): Promise<void> {
  try {
    S.emails = await ms365ReflagEmail(messageId);
  } catch (e) {
    toast('Could not flag this email again in Outlook', { tone: 'error', detail: String(e) });
    return;
  }
  S.emailCompletedLog = [];
  if (S.arFilter === 'completed') S.emailCompletedLog = await ms365GetCompletedEmails();
  updateActionRequiredBadge();
  renderActionRequired();
  toast('Flagged again — back in Action Required');
}
expose('arReflagEmail', arReflagEmail);

async function linkEmailTo(emailId: number, toType: 'task' | 'note', toId: number): Promise<void> {
  const existing = linkCache.get(emailId) ?? (await getLinksFor('email', emailId));
  const next = [...existing, { fromType: 'email' as const, fromId: emailId, toType, toId }];
  linkCache.set(emailId, next);
  await setLinksFrom('email', emailId, next);
}

/** The task just made from an email, kept open inline underneath it so the
 * company, project and date can be set without leaving the list. */
let taskDraft: { emailId: number; taskId: number } | null = null;

export async function arCreateTask(id: number): Promise<void> {
  const e = S.emails.find((x) => x.id === id);
  if (!e) return;
  const t: Todo = {
    id: nextTodoId(), title: e.subject || '(No subject)', priority: 'Medium',
    dueDate: e.flagDueAt ? e.flagDueAt.slice(0, 10) : today(), status: 'Pending',
    description: e.preview ? `From: ${e.senderName || e.senderEmail}\n\n${e.preview}` : null,
    createdAt: today(), completedAt: null, parentId: null, areaId: null, section: null, sortOrder: null, recurrenceRule: null, tags: ['from-email'],
    // The email's company travels by id, so the task shows up on that
    // company's page rather than only matching by name.
    ...taskFields({ ...EMPTY_CONTEXT, ...companyOf(S, e.companyId, e.companyName) }),
  } as Todo;
  S.todos.push(t);
  persistTodos();
  (window as any).updateTodoBadge?.();
  await linkEmailTo(id, 'task', t.id);
  taskDraft = { emailId: id, taskId: t.id };
  renderActionRequired();
  document.getElementById(`ar-task-company-${id}`)?.focus();
}
expose('arCreateTask', arCreateTask);

function draftTask(): Todo | undefined {
  return taskDraft ? S.todos.find((t) => t.id === taskDraft!.taskId) : undefined;
}

function saveDraft(): void {
  persistTodos();
  (window as any).updateTodoBadge?.();
}

/** The inline strip under an email: what the new task is linked to. */
function taskDraftRow(e: EmailRecord): string {
  const t = draftTask();
  if (!t) return '';
  const projects = S.projects.filter((p) => !p.archived && (t.companyId == null || p.companyId === t.companyId || p.companyId == null));
  const projectOpts = projects.map((p) => `<option value="${p.id}"${p.id === t.projectId ? ' selected' : ''}>${escHtml(p.name)}</option>`).join('');
  return `<div class="ar-task-draft" onclick="event.stopPropagation()">
    <div class="ar-task-draft-hd">${icon('check', 13)} Task created<span class="ar-task-draft-title">${escHtml(t.title)}</span></div>
    <div class="ar-task-draft-fields">
      <label>Company<input type="text" class="td-input" id="ar-task-company-${e.id}" value="${escHtml(t.client || '')}" placeholder="None" oninput="arTaskDraftCompany(this)"></label>
      <label>Project<select class="td-select" id="ar-task-project-${e.id}" onchange="arTaskDraftProject(this)"><option value="">None</option>${projectOpts}</select></label>
      <label>Due<input type="date" class="td-input" value="${escHtml(t.dueDate || '')}" onchange="arTaskDraftDue(this)"></label>
    </div>
    <div class="ar-task-draft-actions">
      <button class="btn-secondary" onclick="arTaskDraftUndo()">Undo</button>
      <button class="btn-secondary" onclick="arOpenDraftTask()">Open task</button>
      <button class="btn-primary" onclick="arTaskDraftDone()">Done</button>
    </div>
  </div>`;
}

export function arTaskDraftCompany(input: HTMLInputElement): void {
  const t = draftTask();
  if (!t) return;
  // Resolve what was typed to a real company, so the task links by id.
  const typed = input.value.trim();
  const match = S.companies.find((c) => c.name.trim().toLowerCase() === typed.toLowerCase());
  t.client = typed || null;
  t.companyId = match ? match.id : null;
  t.type = t.client ? 'client' : 'general';
  saveDraft();
}
expose('arTaskDraftCompany', arTaskDraftCompany);

export function arTaskDraftProject(sel: HTMLSelectElement): void {
  const t = draftTask();
  if (!t) return;
  t.projectId = sel.value ? Number(sel.value) : null;
  // A project carries its own company, so linking one fills a blank company.
  const p = S.projects.find((x) => x.id === t.projectId);
  if (p && !t.companyId && p.companyId) { t.companyId = p.companyId; t.client = p.companyName; t.type = 'client'; }
  saveDraft();
  renderActionRequired();
}
expose('arTaskDraftProject', arTaskDraftProject);

export function arTaskDraftDue(input: HTMLInputElement): void {
  const t = draftTask();
  if (!t) return;
  t.dueDate = input.value || null;
  saveDraft();
}
expose('arTaskDraftDue', arTaskDraftDue);

export function arTaskDraftDone(): void {
  const t = draftTask();
  taskDraft = null;
  renderActionRequired();
  if (t) toast(`Task added${t.client ? ` for ${t.client}` : ''}`);
}
expose('arTaskDraftDone', arTaskDraftDone);

export function arTaskDraftUndo(): void {
  const t = draftTask();
  if (t) {
    S.todos = S.todos.filter((x) => x.id !== t.id);
    saveDraft();
  }
  taskDraft = null;
  renderActionRequired();
  toast('Task removed');
}
expose('arTaskDraftUndo', arTaskDraftUndo);

export function arOpenDraftTask(): void {
  const id = taskDraft?.taskId;
  taskDraft = null;
  if (id != null) openRecord('task', id);
}
expose('arOpenDraftTask', arOpenDraftTask);

export async function arCreateFollowUp(id: number): Promise<void> {
  const e = S.emails.find((x) => x.id === id);
  if (!e) return;
  const due = localIsoDate(new Date(Date.now() + 3 * 86400_000));
  const t: Todo = {
    id: nextTodoId(), title: `Follow up: ${e.subject || '(No subject)'}`, type: 'general', client: e.companyName,
    priority: 'Medium', dueDate: due, status: 'Pending',
    description: e.preview ? `From: ${e.senderName || e.senderEmail}\n\n${e.preview}` : null,
    createdAt: today(), completedAt: null, projectId: null, parentId: null, areaId: null, section: null, sortOrder: null, recurrenceRule: null, meetingId: null, tags: ['from-email', 'follow-up'],
  };
  S.todos.push(t);
  persistTodos();
  (window as any).updateTodoBadge?.();
  await linkEmailTo(id, 'task', t.id);
  renderActionRequired();
}
expose('arCreateFollowUp', arCreateFollowUp);

export async function arCreateNote(id: number): Promise<void> {
  const e = S.emails.find((x) => x.id === id);
  if (!e) return;
  const n: Note = {
    id: nextNoteId(), title: e.subject || '(No subject)',
    content: `<p><strong>From:</strong> ${escHtml(e.senderName || e.senderEmail || 'Unknown')}${e.receivedAt ? ` &bull; ${escHtml(fmtDate(e.receivedAt))}` : ''}</p>${e.preview ? `<p>${escHtml(e.preview)}</p>` : ''}${e.webLink ? `<p><a href="${escHtml(e.webLink)}" target="_blank" rel="noopener">Open in Outlook</a></p>` : ''}`,
    folder: '', clientName: e.companyName, tags: ['from-email'], pinned: false, createdAt: today(), updatedAt: today(),
  };
  S.notes.unshift(n);
  persistNotes();
  await linkEmailTo(id, 'note', n.id);
  renderActionRequired();
}
expose('arCreateNote', arCreateNote);

export function arToggleLinkPopover(id: number): void {
  const wasOpen = S.arLinkPopoverId === id;
  S.arLinkPopoverId = wasOpen ? null : id;
  document.querySelectorAll('.ar-link-popover').forEach((el) => { (el as HTMLElement).style.display = 'none'; el.innerHTML = ''; });
  if (wasOpen) return;
  const pop = document.getElementById(`ar-link-pop-${id}`);
  if (!pop) return;
  pop.style.display = 'block';
  pop.innerHTML = `<div class="feed-empty">Loading…</div>`;
  void openLinkPopover(id, pop);
}
expose('arToggleLinkPopover', arToggleLinkPopover);

async function openLinkPopover(id: number, pop: HTMLElement): Promise<void> {
  const e = S.emails.find((x) => x.id === id);
  if (!e) return;
  let links = linkCache.get(id);
  if (!links) {
    links = await getLinksFor('email', id);
    linkCache.set(id, links);
  }
  const projectId = links.find((l) => l.toType === 'project')?.toId ?? null;
  const contactId = links.find((l) => l.toType === 'contact')?.toId ?? null;
  const opportunityId = links.find((l) => l.toType === 'opportunity')?.toId ?? null;

  // Once an email has a company, the pickers only offer that company's
  // records — the whole list is noise when you already know whose email it is.
  // Anything already linked stays listed even if it belongs elsewhere.
  const co = e.companyId;
  const mine = <T extends { companyId?: number | null }>(x: T, linked: boolean) => linked || co == null || x.companyId === co;
  const projectOpts = S.projects.filter((p) => !p.archived && mine(p, p.id === projectId))
    .map((p) => `<option value="${p.id}" ${p.id === projectId ? 'selected' : ''}>${escHtml(p.name)}</option>`).join('');
  const contactOpts = S.contacts.filter((c) => mine(c, c.id === contactId))
    .map((c) => `<option value="${c.id}" ${c.id === contactId ? 'selected' : ''}>${escHtml(c.name)}${c.clientName ? ` (${escHtml(c.clientName)})` : ''}</option>`).join('');
  const opportunityOpts = S.opportunities.filter((o) => !o.archived && mine(o, o.id === opportunityId))
    .map((o) => `<option value="${o.id}" ${o.id === opportunityId ? 'selected' : ''}>${escHtml(o.name)}</option>`).join('');

  if (S.arLinkPopoverId !== id) return; // closed while awaiting
  pop.innerHTML = `<div class="ar-link-form">
    <dl class="rec-inline-props">
      <div><dt>Company</dt><dd><input type="text" class="td-input" id="ar-company-${id}" value="${escHtml(e.companyName || '')}" placeholder="None"></dd></div>
      <div><dt>Opportunity</dt><dd><select class="td-select" id="ar-opportunity-${id}"><option value="">None</option>${opportunityOpts}</select></dd></div>
      <div><dt>Project</dt><dd><select class="td-select" id="ar-project-${id}"><option value="">None</option>${projectOpts}</select></dd></div>
      <div><dt>Contact</dt><dd><select class="td-select" id="ar-contact-${id}"><option value="">None</option>${contactOpts}</select></dd></div>
    </dl>
    <div class="btn-row ar-link-actions">
      <button class="btn-secondary" onclick="arToggleLinkPopover(${id})">Cancel</button>
      <button class="btn-primary" onclick="arSaveLinks(${id})">Save links</button>
    </div>
  </div>`;
  const companyInput = document.getElementById(`ar-company-${id}`) as HTMLInputElement | null;
  // The same searchable company list used everywhere else, instead of free text.
  if (companyInput) attachCompanySelector(companyInput, { onSelect: () => { void openLinkPopover(id, pop); } });
}

export async function arSaveLinks(id: number): Promise<void> {
  const e = S.emails.find((x) => x.id === id);
  if (!e) return;
  const companyInput = document.getElementById(`ar-company-${id}`) as HTMLInputElement | null;
  const projectSel = document.getElementById(`ar-project-${id}`) as HTMLSelectElement | null;
  const contactSel = document.getElementById(`ar-contact-${id}`) as HTMLSelectElement | null;

  const companyName = companyInput?.value.trim() || null;
  e.companyName = companyName;
  await ms365SetEmailCompany(id, companyName);

  const oppSel = document.getElementById(`ar-opportunity-${id}`) as HTMLSelectElement | null;
  const links: EntityLink[] = [];
  if (oppSel?.value) links.push({ fromType: 'email', fromId: id, toType: 'opportunity', toId: Number(oppSel.value) });
  if (projectSel?.value) links.push({ fromType: 'email', fromId: id, toType: 'project', toId: Number(projectSel.value) });
  if (contactSel?.value) links.push({ fromType: 'email', fromId: id, toType: 'contact', toId: Number(contactSel.value) });
  linkCache.set(id, links);
  await setLinksFrom('email', id, links);

  S.arLinkPopoverId = null;
  renderActionRequired();
}
expose('arSaveLinks', arSaveLinks);
