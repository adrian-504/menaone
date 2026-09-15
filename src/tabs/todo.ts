// Tasks — smart lists (Today, Upcoming, Anytime, Someday, Completed) plus
// projects, clients and tags in a sidebar; natural-language quick add; clean
// rows with actions on hover, right-click and keyboard; and a detail panel
// beside the list instead of an edit dialog. Board and Calendar views show
// the same list's tasks.

import { S } from '../lib/state';
import { toast, undoToast, emptyState } from '../lib/ui';
import { companyLink, recordLink } from '../lib/links';
import { fmtDate, escHtml, nextTodoId, getClients, expose, positionFloatingPopup, inCompany } from '../lib/utils';
import { persistTodos, saveTodosNow } from '../lib/persist';
import { getLinksFor, setLinksFrom } from '../lib/db';
import { addLinks, companyFromForm, companyOf, contextFromMeeting, contextFromOpportunity, contextFromProject, inheritCompany, taskFields, EMPTY_CONTEXT, type WorkContext } from '../lib/workGraph';
import { registerTabRenderer, registerBadgeUpdater, refreshProjectViewIfOpen, refreshCompanyViewIfOpen, notifyNavigated, getActiveTabId } from '../lib/registry';
import { renderTagChips } from '../lib/tagChips';
import { icon } from '../lib/icons';
import { showContextMenu, type ContextMenuItem } from '../lib/contextMenu';
import { attachCompanySelector } from '../lib/companySelector';
import { registerDragSource, registerDropTarget, reorder } from '../lib/dnd';
import { renderIcons } from '../core/chrome';
import { parseTaskInput, friendlyDate, isoDate, type ParsedTask } from '../lib/taskParse';
import type { Todo } from '../lib/types';

// ── Dates ───────────────────────────────────────────────────────────────────

/** Today in local time (toISOString would give yesterday in KSA before 3am). */
function todayIso(): string { return isoDate(new Date()); }
function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + n));
}
const isOpenTask = (t: Todo) => t.status !== 'Done';

export function isOverdue(t: Todo): boolean {
  return !!t.dueDate && isOpenTask(t) && t.dueDate < todayIso();
}

/** "Tomorrow · 14 Sept 2026 · 15:00" in the detail panel; plain date when not relative. */
function whenLabel(t: Todo): string {
  if (!t.dueDate) return '';
  const rel = friendlyDate(t.dueDate, new Date());
  const full = fmtDate(t.dueDate);
  const parts = /^\d/.test(rel) ? [full] : [rel, full];
  if (t.dueTime) parts.push(t.dueTime);
  return parts.join(' · ');
}

function dueLabel(t: Todo): string {
  if (!t.dueDate) return '';
  const base = friendlyDate(t.dueDate, new Date());
  return t.dueTime ? `${base} ${t.dueTime}` : base;
}

// ── Badge ───────────────────────────────────────────────────────────────────

export function updateTodoBadge(): void {
  const due = S.todos.filter((t) => isOpenTask(t) && !t.someday && t.dueDate && t.dueDate <= todayIso()).length;
  const el = document.getElementById('todo-badge');
  if (el) { el.textContent = String(due); el.style.display = due > 0 ? '' : 'none'; }
}
registerBadgeUpdater(updateTodoBadge);
expose('updateTodoBadge', updateTodoBadge);

// ── Lists ───────────────────────────────────────────────────────────────────

type SmartList = 'today' | 'upcoming' | 'anytime' | 'someday' | 'completed';
const SMART: { key: SmartList; label: string; icon: string; tint: string }[] = [
  { key: 'today', label: 'Today', icon: 'sun', tint: 'var(--amber)' },
  { key: 'upcoming', label: 'Upcoming', icon: 'calendar', tint: 'var(--red)' },
  { key: 'anytime', label: 'Anytime', icon: 'list', tint: 'var(--accent)' },
  { key: 'someday', label: 'Someday', icon: 'archive', tint: 'var(--amber-deep)' },
  { key: 'completed', label: 'Completed', icon: 'check', tint: 'var(--green)' },
];

/** Older links (dashboard "Overdue", saved state) name lists that no longer exist. */
function currentList(): string {
  const f = S.todoFilter;
  if (f === 'all' || f === 'pending' || f === 'in_progress' || f === 'high') return 'anytime';
  if (f === 'overdue') return 'today';
  if (f === 'done') return 'completed';
  return f;
}

function companyKey(t: Todo): string | null {
  if (!t.client) return null;
  return t.companyId != null ? `id:${t.companyId}` : `name:${t.client}`;
}

function companyRefFromKey(key: string): { id: number | null; name: string } {
  if (key.startsWith('id:')) {
    const id = Number(key.slice(3));
    return { id, name: S.companies.find((c) => c.id === id)?.name ?? S.todos.find((t) => t.companyId === id)?.client ?? 'Client' };
  }
  return { id: null, name: key.slice(5) };
}

function inList(t: Todo, list: string): boolean {
  const open = isOpenTask(t);
  if (list === 'completed') return !open;
  if (!open) return false;
  switch (list) {
    case 'today': return !t.someday && !!t.dueDate && t.dueDate <= todayIso();
    case 'upcoming': return !t.someday && !!t.dueDate && t.dueDate > todayIso();
    case 'anytime': return !t.someday;
    case 'someday': return !!t.someday;
  }
  if (list.startsWith('project:')) return t.projectId === Number(list.slice(8));
  if (list.startsWith('company:')) {
    const ref = companyRefFromKey(list.slice(8));
    return inCompany(ref, t.companyId, t.client);
  }
  if (list.startsWith('tag:')) return (t.tags || []).includes(list.slice(4));
  return true;
}

/** Tasks shown in a list: matching top-level tasks, plus matching subtasks
 * whose parent isn't itself in the list (so nothing silently disappears). */
function tasksForList(list: string, includeDone = false): Todo[] {
  const matches = S.todos.filter((t) => inList(t, list) || (includeDone && !isOpenTask(t) && inList({ ...t, status: 'Pending' }, list)));
  const ids = new Set(matches.map((t) => t.id));
  return matches.filter((t) => t.parentId == null || !ids.has(t.parentId) || list === 'completed');
}

const PRI: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
function smartCompare(a: Todo, b: Todo): number {
  if (S.todoSort === 'manual') return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  const da = a.dueDate ? `${a.dueDate} ${a.dueTime ?? '99'}` : '9999';
  const db = b.dueDate ? `${b.dueDate} ${b.dueTime ?? '99'}` : '9999';
  if (da !== db) return da.localeCompare(db);
  const pa = PRI[a.priority || 'Medium'] ?? 1;
  const pb = PRI[b.priority || 'Medium'] ?? 1;
  if (pa !== pb) return pa - pb;
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
}

interface Group { key: string; label: string; tasks: Todo[]; dropDate?: string; hint?: string; tone?: 'danger' }

function groupsForList(list: string): Group[] {
  const t0 = todayIso();
  const sorted = (xs: Todo[]) => [...xs].sort(smartCompare);
  if (list === 'today') {
    const tasks = tasksForList('today');
    return [
      { key: 'overdue', label: 'Overdue', tasks: sorted(tasks.filter((t) => t.dueDate! < t0)), tone: 'danger' as const },
      { key: 'today', label: 'Today', tasks: sorted(tasks.filter((t) => t.dueDate === t0)), dropDate: t0 },
    ].filter((g) => g.tasks.length || g.key === 'today');
  }
  if (list === 'upcoming') {
    const tasks = tasksForList('upcoming');
    const groups: Group[] = [];
    for (let i = 1; i <= 7; i++) {
      const day = addDaysIso(t0, i);
      const [y, m, d] = day.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      const label = i === 1 ? 'Tomorrow' : date.toLocaleDateString('en-GB', { weekday: 'long' });
      groups.push({ key: day, label, hint: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), tasks: sorted(tasks.filter((t) => t.dueDate === day)), dropDate: day });
    }
    const later = tasks.filter((t) => t.dueDate! > addDaysIso(t0, 7));
    const months = [...new Set(later.map((t) => t.dueDate!.slice(0, 7)))].sort();
    for (const mo of months) {
      const [y, m] = mo.split('-').map(Number);
      groups.push({ key: mo, label: new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: y === new Date().getFullYear() ? undefined : 'numeric' }), tasks: sorted(later.filter((t) => t.dueDate!.startsWith(mo))) });
    }
    return groups;
  }
  if (list === 'completed') {
    const tasks = tasksForList('completed').sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')).slice(0, 300);
    const byDay = new Map<string, Todo[]>();
    for (const t of tasks) {
      const k = t.completedAt || 'unknown';
      byDay.set(k, [...(byDay.get(k) || []), t]);
    }
    return [...byDay.entries()].map(([day, ts]) => ({ key: day, label: day === 'unknown' ? 'Earlier' : friendlyDate(day, new Date()), tasks: ts }));
  }
  if (list.startsWith('project:')) {
    const tasks = tasksForList(list);
    const sections = [...new Set(tasks.map((t) => t.section || ''))].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
    return sections.map((sec) => ({ key: `sec:${sec}`, label: sec, tasks: sorted(tasks.filter((t) => (t.section || '') === sec)) }));
  }
  if (list === 'anytime' || list === 'someday' || list.startsWith('company:') || list.startsWith('tag:')) {
    const tasks = tasksForList(list);
    const groups: Group[] = [];
    const byProject = new Map<number, Todo[]>();
    const loose: Todo[] = [];
    for (const t of tasks) {
      if (t.projectId != null && S.projects.some((p) => p.id === t.projectId)) byProject.set(t.projectId, [...(byProject.get(t.projectId) || []), t]);
      else loose.push(t);
    }
    if (loose.length) groups.push({ key: 'loose', label: list.startsWith('company:') ? '' : 'No project', tasks: sorted(loose) });
    for (const [pid, ts] of [...byProject.entries()].sort((a, b) => (S.projects.find((p) => p.id === a[0])?.name || '').localeCompare(S.projects.find((p) => p.id === b[0])?.name || ''))) {
      groups.push({ key: `p:${pid}`, label: S.projects.find((p) => p.id === pid)?.name || 'Project', tasks: sorted(ts) });
    }
    return groups;
  }
  return [{ key: 'all', label: '', tasks: sorted(tasksForList(list)) }];
}

function listTitle(list: string): { title: string; subtitle: string } {
  const smart = SMART.find((s) => s.key === list);
  if (smart) {
    const sub = list === 'today' ? new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
      : list === 'upcoming' ? 'Everything with a date after today'
      : list === 'anytime' ? 'All open tasks you could do now'
      : list === 'someday' ? 'Parked until you pick them up again'
      : 'Recently finished';
    return { title: smart.label, subtitle: sub };
  }
  if (list.startsWith('project:')) {
    const p = S.projects.find((x) => x.id === Number(list.slice(8)));
    return { title: p?.name || 'Project', subtitle: p ? `${recordLink('project', p.id, 'Open project page')}${p.companyName ? ` · ${companyLink(p.companyId, p.companyName)}` : ''}` : '' };
  }
  if (list.startsWith('company:')) {
    const ref = companyRefFromKey(list.slice(8));
    return { title: ref.name, subtitle: companyLink(ref.id, ref.name).replace(`>${escHtml(ref.name)}<`, '>Open company page<') };
  }
  if (list.startsWith('tag:')) return { title: `#${list.slice(4)}`, subtitle: 'Open tasks with this tag' };
  return { title: 'Tasks', subtitle: '' };
}

// ── Sidebar ─────────────────────────────────────────────────────────────────

const collapsedSections = new Set<string>(['tags']);

function renderSidebar(): void {
  const el = document.getElementById('tasks-side');
  if (!el) return;
  const list = currentList();
  const count = (key: string) => tasksForList(key).length;
  const overdue = S.todos.filter(isOverdue).length;
  const item = (key: string, label: string, iconHtml: string, n: number | string, extra = '') =>
    `<button class="ws-side-item${list === key ? ' active' : ''}" data-drop="task-list" data-drop-value="${escHtml(key)}" onclick="setTodoFilter('${escHtml(key).replace(/'/g, "\\'")}')">
      ${iconHtml}<span class="ws-side-label">${escHtml(label)}</span>${extra}<span class="ws-side-count">${n || ''}</span>
    </button>`;
  const section = (id: string, label: string, body: string) => body
    ? `<div class="ws-side-section${collapsedSections.has(id) ? ' collapsed' : ''}">
        <button class="ws-side-section-hd" onclick="toggleTaskSideSection('${id}')">${icon('chevronDown', 11)}<span>${label}</span></button>
        <div class="ws-side-section-body">${body}</div>
      </div>` : '';

  const smart = SMART.map((s) => item(s.key, s.label, `<span class="ws-side-icon" style="color:${s.tint}">${icon(s.icon, 15)}</span>`, s.key === 'completed' ? '' : s.key === 'today' ? count(s.key) - overdue : count(s.key),
    s.key === 'today' && overdue ? `<span class="ws-side-alert" title="${overdue} overdue">${overdue}</span>` : '')).join('');

  const projects = S.projects.filter((p) => !p.archived && p.status !== 'Completed')
    .map((p) => ({ p, n: S.todos.filter((t) => isOpenTask(t) && t.projectId === p.id).length }))
    .filter(({ p, n }) => n > 0 || list === `project:${p.id}`)
    .sort((a, b) => a.p.name.localeCompare(b.p.name))
    .map(({ p, n }) => item(`project:${p.id}`, p.name, `<span class="ws-side-icon">${icon('target', 14)}</span>`, n)).join('');

  const clients = new Map<string, { name: string; n: number }>();
  for (const t of S.todos) {
    const key = companyKey(t);
    if (!key || !isOpenTask(t)) continue;
    const entry = clients.get(key) || { name: companyRefFromKey(key).name, n: 0 };
    entry.n++;
    clients.set(key, entry);
  }
  const clientItems = [...clients.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([key, { name, n }]) => item(`company:${key}`, name, `<span class="ws-side-icon">${icon('building', 14)}</span>`, n)).join('');

  const tags = new Map<string, number>();
  for (const t of S.todos) if (isOpenTask(t)) for (const tag of t.tags || []) tags.set(tag, (tags.get(tag) || 0) + 1);
  const tagItems = [...tags.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([tag, n]) => item(`tag:${tag}`, tag, `<span class="ws-side-icon">${icon('tag', 14)}</span>`, n)).join('');

  el.innerHTML = `<div class="ws-side-scroll">
    <div class="ws-side-group">${smart}</div>
    ${section('projects', 'Projects', projects)}
    ${section('clients', 'Clients', clientItems)}
    ${section('tags', 'Tags', tagItems)}
  </div>`;
}

export function toggleTaskSideSection(id: string): void {
  if (collapsedSections.has(id)) collapsedSections.delete(id); else collapsedSections.add(id);
  renderSidebar();
}
expose('toggleTaskSideSection', toggleTaskSideSection);

export function setTodoFilter(f: string): void {
  S.todoFilter = f;
  selection.clear();
  renderTodo();
  document.getElementById('todo-list')?.scrollTo(0, 0);
}
expose('setTodoFilter', setTodoFilter);

// ── Views ───────────────────────────────────────────────────────────────────

export function setTaskView(v: string): void {
  S.taskView = v as typeof S.taskView;
  renderTodo();
}
expose('setTaskView', setTaskView);

export function setTodoSort(v: string): void {
  S.todoSort = v as typeof S.todoSort;
  renderTodo();
}
expose('setTodoSort', setTodoSort);

export function taskListMenu(e: MouseEvent): void {
  e.stopPropagation();
  const items: ContextMenuItem[] = [
    { label: `${S.todoSort === 'smart' ? '✓ ' : ''}Sort by date and priority`, run: () => setTodoSort('smart') },
    { label: `${S.todoSort === 'manual' ? '✓ ' : ''}Sort manually (drag to reorder)`, run: () => setTodoSort('manual') },
    { label: '', run: () => {}, separator: true },
    { label: 'Keyboard shortcuts', iconName: 'command', run: () => showTaskShortcuts() },
  ];
  showContextMenu(e, items);
}
expose('taskListMenu', taskListMenu);

function showTaskShortcuts(): void {
  toast('Keyboard shortcuts', { duration: 10000, detail: '↑ ↓ select (⇧ to add) · Enter open · Space complete · T due today · D pick date · P priority · S someday · M move to project · N new task · ⌫ delete' });
}

export function renderTodo(): void {
  const list = currentList();
  renderSidebar();
  const { title, subtitle } = listTitle(list);
  const titleEl = document.getElementById('tasks-title'); if (titleEl) titleEl.textContent = title;
  const subEl = document.getElementById('tasks-subtitle'); if (subEl) subEl.innerHTML = subtitle;
  document.querySelectorAll<HTMLElement>('.task-vbtn').forEach((b) => b.classList.toggle('active', b.dataset.view === S.taskView));
  const calNav = document.getElementById('task-cal-nav'); if (calNav) calNav.hidden = S.taskView !== 'calendar';
  const quickAdd = document.getElementById('task-quickadd'); if (quickAdd) quickAdd.hidden = list === 'completed';

  const container = document.getElementById('todo-list');
  if (!container) return;
  if (S.taskView === 'board') container.innerHTML = renderBoard(list);
  else if (S.taskView === 'calendar') container.innerHTML = renderCalendar(list);
  else container.innerHTML = renderListView(list);
  renderIcons(container);
  paintSelection();
  if (S.taskDetailId != null && !S.todos.some((t) => t.id === S.taskDetailId)) closeTaskDetail();
}
registerTabRenderer('todo', renderTodo);
expose('renderTodo', renderTodo);

function renderListView(list: string): string {
  const groups = groupsForList(list);
  const total = groups.reduce((n, g) => n + g.tasks.length, 0);
  let html = '';
  if (list === 'upcoming') {
    html += `<div class="task-weekstrip">${groups.slice(0, 7).map((g) => {
      const [y, m, d] = g.key.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      return `<button class="task-weekday${g.tasks.length ? ' has' : ''}" data-drop="task-date" data-drop-value="${g.key}" onclick="document.getElementById('tg-${g.key}')?.scrollIntoView({behavior:'smooth',block:'start'})">
        <span class="task-weekday-name">${date.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
        <span class="task-weekday-num">${d}</span>
        <span class="task-weekday-dot">${g.tasks.length || ''}</span>
      </button>`;
    }).join('')}</div>`;
  }
  if (total === 0 && list !== 'upcoming') {
    const empty = list === 'today' ? { icon: 'sun', title: 'Nothing due today', body: 'Tasks due today and anything overdue show up here.' }
      : list === 'someday' ? { icon: 'archive', title: 'Nothing parked', body: 'Tasks you move to Someday wait here until you pick them up.' }
      : list === 'completed' ? { icon: 'check', title: 'Nothing completed yet', body: 'Finished tasks are kept here.' }
      : { icon: 'check', title: 'No open tasks here', body: 'Add one above — dates, projects and priority can go straight in the text.' };
    return html + emptyState(empty) + completedToggle(list);
  }
  for (const g of groups) {
    const isDay = !!g.dropDate;
    const hd = g.label
      ? `<div class="task-group-hd${g.tone === 'danger' ? ' danger' : ''}"><span>${escHtml(g.label)}</span>${g.hint ? `<span class="task-group-hint">${escHtml(g.hint)}</span>` : ''}<span class="task-group-count">${g.tasks.length || ''}</span></div>`
      : '';
    const body = g.tasks.length ? g.tasks.map((t) => taskRowHtml(t, { list })).join('')
      : `<div class="task-group-empty">${list === 'upcoming' ? 'Drop a task here to schedule it' : 'Nothing due today — enjoy the space.'}</div>`;
    const groupValue = isDay ? `date:${g.dropDate}` : g.key.startsWith('sec:') ? `section:${g.key.slice(4)}` : '';
    html += `<section class="task-group" id="tg-${escHtml(g.key)}" data-sort="task-order" data-drop-value="${escHtml(groupValue)}">${hd}${body}</section>`;
  }
  return html + completedToggle(list);
}

const showCompletedIn = new Set<string>();
function completedToggle(list: string): string {
  if (!list.startsWith('project:') && !list.startsWith('company:') && !list.startsWith('tag:')) return '';
  const done = S.todos.filter((t) => !isOpenTask(t) && inList({ ...t, status: 'Pending' }, list));
  if (!done.length) return '';
  const open = showCompletedIn.has(list);
  return `<button class="task-completed-toggle" onclick="toggleCompletedIn('${escHtml(list).replace(/'/g, "\\'")}')">${icon('chevronDown', 11)} ${open ? 'Hide' : 'Show'} ${done.length} completed</button>`
    + (open ? `<section class="task-group">${done.sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')).map((t) => taskRowHtml(t, { list })).join('')}</section>` : '');
}

export function toggleCompletedIn(list: string): void {
  if (showCompletedIn.has(list)) showCompletedIn.delete(list); else showCompletedIn.add(list);
  renderTodo();
}
expose('toggleCompletedIn', toggleCompletedIn);

/** One task as a clean row. Also used by the company and project pages. */
export function taskRowHtml(t: Todo, opts: { list?: string; compact?: boolean } = {}): string {
  const done = !isOpenTask(t);
  const over = isOverdue(t);
  const subs = S.todos.filter((x) => x.parentId === t.id);
  const project = t.projectId != null ? S.projects.find((p) => p.id === t.projectId) : null;
  const parent = t.parentId != null ? S.todos.find((p) => p.id === t.parentId) : null;
  const inProjectList = opts.list === `project:${t.projectId}`;
  const inCompanyList = opts.list?.startsWith('company:');
  const meta: string[] = [];
  if (t.status === 'In Progress') meta.push('<span class="task-state">In progress</span>');
  if (t.dueDate && !(opts.list === 'today' && t.dueDate === todayIso() && !t.dueTime)) {
    meta.push(`<span class="task-due${over ? ' overdue' : t.dueDate === todayIso() ? ' today' : ''}">${icon('calendar', 11)}${escHtml(dueLabel(t))}</span>`);
  }
  if (t.someday && opts.list !== 'someday') meta.push(`<span class="task-due">${icon('archive', 11)}Someday</span>`);
  if (parent) meta.push(`<span class="task-parent">↳ ${escHtml(parent.title)}</span>`);
  if (project && !inProjectList) meta.push(recordLink('project', project.id, project.name, { className: 'task-meta-link' }));
  if (t.client && !inCompanyList) meta.push(companyLink(t.companyId, t.client, { className: 'task-meta-link' }));
  if (subs.length) meta.push(`<span class="task-subcount">${icon('check', 11)}${subs.filter((s) => !isOpenTask(s)).length}/${subs.length}</span>`);
  for (const tag of (t.tags || []).slice(0, 3)) meta.push(`<span class="task-tag">#${escHtml(tag)}</span>`);
  if (t.recurrenceRule) meta.push(`<span class="task-icon-meta" title="Repeats ${escHtml(t.recurrenceRule)}">${icon('repeat', 11)}</span>`);
  if (t.description) meta.push(`<span class="task-icon-meta" title="Has notes">${icon('note', 11)}</span>`);
  const pri = t.priority === 'High' ? ' pri-high' : t.priority === 'Low' ? ' pri-low' : '';
  return `<div class="task-row${done ? ' done' : ''}${over ? ' overdue' : ''}${S.taskDetailId === t.id ? ' open' : ''}" data-task-id="${t.id}" data-drag-kind="task" data-drag-id="${t.id}" onclick="taskRowClick(event,${t.id})" oncontextmenu="todoContextMenu(event,${t.id})">
    <button class="task-check${pri}${done ? ' checked' : ''}" onclick="event.stopPropagation();completeTask(${t.id})" aria-label="${done ? 'Mark as not done' : 'Complete'}" title="${t.priority === 'High' ? 'High priority · ' : ''}${done ? 'Mark as not done' : 'Complete'}"></button>
    <div class="task-main">
      <div class="task-title">${escHtml(t.title)}</div>
      ${meta.length ? `<div class="task-meta">${meta.join('')}</div>` : ''}
    </div>
    ${opts.compact ? '' : `<div class="task-hover-actions">
      <button class="task-hover-btn" onclick="event.stopPropagation();openDatePopover(this,[${t.id}])" title="Schedule (D)" aria-label="Schedule">${icon('calendar', 14)}</button>
      <button class="task-hover-btn" onclick="event.stopPropagation();todoContextMenu(event,${t.id})" title="More" aria-label="More">${icon('more', 14)}</button>
    </div>`}
  </div>`;
}

// ── Board ───────────────────────────────────────────────────────────────────

const BOARD_COLUMNS = ['Pending', 'In Progress', 'Done'] as const;

function renderBoard(list: string): string {
  const base = list === 'completed' ? tasksForList('completed') : S.todos.filter((t) => (inList(t, list) || (!isOpenTask(t) && inList({ ...t, status: 'Pending' }, list))) && t.parentId == null);
  return `<div class="board-columns task-board">` + BOARD_COLUMNS.map((status) => {
    const items = base.filter((t) => (t.status || 'Pending') === status).sort(smartCompare);
    const label = status === 'Pending' ? 'To do' : status;
    return `<div class="board-column" data-status="${status}" data-drop="task-status" data-drop-value="${status}">
      <div class="board-column-hd">${label}<span class="board-column-count">${items.length}</span></div>
      ${items.length === 0 ? `<div class="board-empty">No tasks</div>` : items.map((t) => `<div class="board-card">${taskRowHtml(t, { list, compact: true })}</div>`).join('')}
    </div>`;
  }).join('') + `</div>`;
}



// ── Calendar ────────────────────────────────────────────────────────────────

function renderCalendar(list: string): string {
  const [ay, am] = S.taskCalAnchor.split('-').map(Number);
  const label = document.getElementById('task-cal-label');
  if (label) label.textContent = new Date(ay, am - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const monthStart = new Date(ay, am - 1, 1);
  const lead = (monthStart.getDay() + 6) % 7;
  const start = new Date(ay, am - 1, 1 - lead);
  const tasks = S.todos.filter((t) => t.dueDate && (list === 'completed' ? !isOpenTask(t) : (inList(t, list) || list === 'today' || list === 'upcoming' ? isOpenTask(t) && !t.someday && (list === 'today' || list === 'upcoming' || inList(t, list)) : false)));
  const cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="cal-month-dow">${d}</div>`);
  const t0 = todayIso();
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = isoDate(d);
    const dayTasks = tasks.filter((t) => t.dueDate === iso).sort(smartCompare);
    cells.push(`<div class="cal-month-cell${d.getMonth() !== am - 1 ? ' other-month' : ''}${iso === t0 ? ' today' : ''}" data-drop="task-date" data-drop-value="${iso}" ondblclick="quickAddTaskOnDay('${iso}')">
      <div class="cal-month-daynum">${d.getDate()}</div>
      ${dayTasks.slice(0, 4).map((t) => `<div class="cal-month-evt task-cal-evt${t.priority === 'High' ? ' pri-high' : ''}${isOpenTask(t) ? '' : ' done'}" data-drag-kind="task" data-drag-id="${t.id}" onclick="event.stopPropagation();openTaskDetail(${t.id})">${t.dueTime ? `<b>${t.dueTime}</b> ` : ''}${escHtml(t.title)}</div>`).join('')}
      ${dayTasks.length > 4 ? `<div class="cal-month-evt t-muted">+${dayTasks.length - 4} more</div>` : ''}
    </div>`);
  }
  return `<div class="cal-month-grid task-cal">${cells.join('')}</div>`;
}

export function taskCalNav(dir: number): void {
  if (dir === 0) { S.taskCalAnchor = todayIso(); renderTodo(); return; }
  const [y, m] = S.taskCalAnchor.split('-').map(Number);
  S.taskCalAnchor = isoDate(new Date(y, m - 1 + dir, 1));
  renderTodo();
}
expose('taskCalNav', taskCalNav);

export function quickAddTaskOnDay(dateIso: string): void {
  const input = document.getElementById('quick-task-input') as HTMLInputElement | null;
  if (!input) return;
  input.value = `${input.value.trim() ? `${input.value.trim()} ` : ''}${dateIso} `;
  input.focus();
  quickAddPreview();
}
expose('quickAddTaskOnDay', quickAddTaskOnDay);

// ── Quick add ───────────────────────────────────────────────────────────────

let dismissedTokens = new Set<string>();

function parseQuickAdd(value: string): ParsedTask {
  return parseTaskInput(value, {
    today: new Date(),
    projects: S.projects.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name })),
    companies: S.companies.map((c) => ({ id: c.id, name: c.name })),
  }, dismissedTokens);
}

const TOKEN_ICON: Record<string, string> = { date: 'calendar', time: 'clock', priority: 'flag', project: 'target', tag: 'tag', company: 'building', someday: 'archive', repeat: 'repeat' };

export function quickAddPreview(): void {
  const input = document.getElementById('quick-task-input') as HTMLInputElement | null;
  const el = document.getElementById('quick-task-preview');
  if (!input || !el) return;
  if (!input.value.trim()) { dismissedTokens = new Set(); el.innerHTML = ''; return; }
  const parsed = parseQuickAdd(input.value);
  el.innerHTML = parsed.tokens.map((tk) => `<button type="button" class="qa-chip qa-${tk.kind}" onclick="dismissQuickAddToken('${escHtml(tk.text.toLowerCase()).replace(/'/g, "\\'")}')" title="Recognised as ${tk.kind} — click to keep it as plain text">${icon(TOKEN_ICON[tk.kind] || 'tag', 11)}${escHtml(tk.label)}<span class="qa-chip-x">×</span></button>`).join('');
}
expose('quickAddPreview', quickAddPreview);

export function dismissQuickAddToken(text: string): void {
  dismissedTokens.add(text);
  quickAddPreview();
  document.getElementById('quick-task-input')?.focus();
}
expose('dismissQuickAddToken', dismissQuickAddToken);

export function quickAddKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    const input = e.target as HTMLInputElement;
    if (input.value) { input.value = ''; quickAddPreview(); } else input.blur();
    e.stopPropagation();
  }
}
expose('quickAddKey', quickAddKey);

/** Defaults a new task takes from the list it's added in. */
function listDefaults(list: string): Partial<Todo> {
  if (list === 'today') return { dueDate: todayIso() };
  if (list === 'someday') return { someday: true };
  if (list.startsWith('project:')) {
    const p = S.projects.find((x) => x.id === Number(list.slice(8)));
    return p ? taskFields(contextFromProject(S, p)) : {};
  }
  if (list.startsWith('company:')) {
    const ref = companyRefFromKey(list.slice(8));
    return { type: 'client', client: ref.name, companyId: ref.id };
  }
  if (list.startsWith('tag:')) return { tags: [list.slice(4)] };
  return {};
}

export function blankTask(fields: Partial<Todo>): Todo {
  return {
    id: nextTodoId(), title: '', type: 'general', client: null, priority: 'Medium', dueDate: null, dueTime: null, someday: false,
    status: 'Pending', description: null, createdAt: todayIso(), completedAt: null, projectId: null, parentId: null,
    areaId: null, section: null, sortOrder: null, recurrenceRule: null, meetingId: null, tags: [],
    ...fields,
  };
}

export function quickAddTask(e: Event): void {
  e.preventDefault();
  const input = document.getElementById('quick-task-input') as HTMLInputElement | null;
  const raw = input?.value.trim();
  if (!raw || !input) return;
  const task = addTaskFromText(raw, listDefaults(currentList()));
  if (!task) return;
  input.value = '';
  dismissedTokens = new Set();
  quickAddPreview();
  const row = document.querySelector<HTMLElement>(`.task-row[data-task-id="${task.id}"]`);
  if (row) { row.classList.add('just-added'); row.scrollIntoView({ block: 'nearest' }); }
  else undoToast(`Added "${task.title}" to ${task.someday ? 'Someday' : task.dueDate && task.dueDate > todayIso() ? 'Upcoming' : 'Anytime'}`, () => { deleteTodo(task.id, { silent: true }); });
}
expose('quickAddTask', quickAddTask);

/** Recognised parts of a quick-add line, for a preview (My Day capture). */
export function quickAddTokensHtml(raw: string): string {
  if (!raw.trim()) return '';
  return parseTaskInput(raw, {
    today: new Date(),
    projects: S.projects.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name })),
    companies: S.companies.map((c) => ({ id: c.id, name: c.name })),
  }).tokens.map((tk) => `<span class="qa-chip qa-${tk.kind}">${icon(TOKEN_ICON[tk.kind] || 'tag', 11)}${escHtml(tk.label)}</span>`).join('');
}

/** Creates a task from a quick-add line ("Call Globex tomorrow 3pm !high"). */
export function addTaskFromText(raw: string, defaults: Partial<Todo> = {}): Todo | null {
  const p = parseQuickAdd(raw);
  if (!p.title) return null;
  const task = blankTask({
    ...defaults,
    title: p.title,
    ...(p.dueDate ? { dueDate: p.dueDate } : {}),
    ...(p.dueTime ? { dueTime: p.dueTime } : {}),
    ...(p.someday ? { someday: true, dueDate: null } : {}),
    ...(p.priority ? { priority: p.priority } : {}),
    ...(p.projectId != null ? { projectId: p.projectId } : {}),
    // A company typed in the line replaces the list's; its id only stays when it is the same company.
    ...(p.companyName ? { type: 'client', client: p.companyName, companyId: companyFromForm({ companyId: defaults.companyId ?? null, companyName: defaults.client ?? null }, p.companyName).companyId } : {}),
    ...(p.recurrence ? { recurrenceRule: p.recurrence } : {}),
    tags: [...new Set([...(defaults.tags || []), ...p.tags])],
  });
  S.todos.push(task);
  afterTodoListChange();
  return task;
}

// ── Selection & keyboard ────────────────────────────────────────────────────

const selection = new Set<number>();
let anchorId: number | null = null;

function visibleIds(): number[] {
  return [...document.querySelectorAll<HTMLElement>('#todo-list .task-row[data-task-id]')].map((el) => Number(el.dataset.taskId));
}

function paintSelection(): void {
  document.querySelectorAll<HTMLElement>('#todo-list .task-row[data-task-id]').forEach((el) => {
    const id = Number(el.dataset.taskId);
    el.classList.toggle('sel', selection.has(id));
    el.classList.toggle('open', S.taskDetailId === id);
  });
}

export function taskRowClick(e: MouseEvent, id: number): void {
  if ((e.target as HTMLElement).closest('a,button,input')) return;
  const ids = visibleIds();
  if (e.shiftKey && anchorId != null && ids.includes(anchorId)) {
    const [a, b] = [ids.indexOf(anchorId), ids.indexOf(id)].sort((x, y) => x - y);
    selection.clear();
    ids.slice(a, b + 1).forEach((x) => selection.add(x));
  } else if (e.metaKey || e.ctrlKey) {
    if (selection.has(id)) selection.delete(id); else selection.add(id);
    anchorId = id;
  } else {
    selection.clear();
    selection.add(id);
    anchorId = id;
    if (getActiveTabId() === 'todo') openTaskDetail(id);
    else (window as any).openRecord('task', id);
  }
  paintSelection();
}
expose('taskRowClick', taskRowClick);

function selectedOrDetail(): number[] {
  if (selection.size) return [...selection];
  return S.taskDetailId != null ? [S.taskDetailId] : [];
}

function moveSelection(delta: number, extend: boolean): void {
  const ids = visibleIds();
  if (!ids.length) return;
  const current = anchorId != null && ids.includes(anchorId) ? ids.indexOf(anchorId) : delta > 0 ? -1 : ids.length;
  const next = ids[Math.min(Math.max(current + delta, 0), ids.length - 1)];
  if (!extend) selection.clear();
  selection.add(next);
  anchorId = next;
  paintSelection();
  document.querySelector(`#todo-list .task-row[data-task-id="${next}"]`)?.scrollIntoView({ block: 'nearest' });
  if (!extend && S.taskDetailId != null) openTaskDetail(next);
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

document.addEventListener('keydown', (e) => {
  if (getActiveTabId() !== 'todo' || S.commandPaletteOpen || document.querySelector('.modal-ov.open')) return;
  if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
  const ids = selectedOrDetail();
  const key = e.key;
  const run = (fn: () => void) => { e.preventDefault(); fn(); };
  if (key === 'ArrowDown' || key === 'ArrowUp') return run(() => moveSelection(key === 'ArrowDown' ? 1 : -1, e.shiftKey));
  if (key === 'n' || key === 'q') return run(() => document.getElementById('quick-task-input')?.focus());
  if (!ids.length) return;
  if (key === 'Enter') return run(() => { openTaskDetail(ids[0]); setTimeout(() => (document.getElementById('td-title') as HTMLTextAreaElement | null)?.focus(), 30); });
  if (key === ' ') return run(() => ids.forEach((id) => completeTask(id)));
  if (key === 'Backspace' || key === 'Delete') return run(() => deleteTasks(ids));
  if (key === 't') return run(() => scheduleTasks(ids, { dueDate: todayIso() }));
  if (key === 's') return run(() => { const all = ids.every((id) => S.todos.find((t) => t.id === id)?.someday); scheduleTasks(ids, all ? { someday: false } : { someday: true, dueDate: null, dueTime: null }); });
  if (key === 'd') return run(() => {
    const row = document.querySelector<HTMLElement>(`#todo-list .task-row[data-task-id="${ids[0]}"] .task-hover-btn`) ?? document.getElementById('td-when');
    if (row) openDatePopover(row, ids);
  });
  if (key === 'p') return run(() => {
    const order = ['High', 'Medium', 'Low'];
    const first = S.todos.find((t) => t.id === ids[0]);
    const next = order[(order.indexOf(first?.priority || 'Medium') + 1) % 3];
    ids.forEach((id) => { const t = S.todos.find((x) => x.id === id); if (t) t.priority = next; });
    afterTodoListChange();
  });
  if (key === 'm') return run(() => {
    const anchor = document.querySelector<HTMLElement>(`#todo-list .task-row[data-task-id="${ids[0]}"]`);
    if (anchor) moveTasksMenu(anchor, ids);
  });
  // The first Escape closes the panel (handled by the router); a second clears the selection.
  if (key === 'Escape' && selection.size && S.taskDetailId == null && Date.now() - detailClosedAt > 100) return run(() => { selection.clear(); paintSelection(); });
});

// ── Actions ─────────────────────────────────────────────────────────────────

function nextRecurrenceDate(dueDate: string, rule: string): string {
  const [y, m, d] = dueDate.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (rule === 'daily') date.setDate(date.getDate() + 1);
  else if (rule === 'weekly') date.setDate(date.getDate() + 7);
  else if (rule === 'monthly') date.setMonth(date.getMonth() + 1);
  return isoDate(date);
}

/** Completing a repeating task creates its next occurrence. */
function markDone(t: Todo): Todo | null {
  t.status = 'Done';
  t.completedAt = todayIso();
  if (!t.recurrenceRule || !t.dueDate) return null;
  const next = { ...t, id: nextTodoId(), dueDate: nextRecurrenceDate(t.dueDate, t.recurrenceRule), status: 'Pending', completedAt: null, createdAt: todayIso(), tags: [...(t.tags || [])] };
  S.todos.push(next);
  return next;
}

/** Complete with a small animation; the row settles away and Undo is offered. */
export function completeTask(id: number): void {
  const t = S.todos.find((x) => x.id === id);
  if (!t) return;
  if (!isOpenTask(t)) {
    t.status = 'Pending';
    t.completedAt = null;
    afterTodoListChange();
    return;
  }
  const before = { status: t.status, completedAt: t.completedAt };
  const spawned = markDone(t);
  persistTodos();
  updateTodoBadge();
  const rows = document.querySelectorAll<HTMLElement>(`.task-row[data-task-id="${id}"]`);
  rows.forEach((row) => {
    row.classList.add('completing');
    row.querySelector('.task-check')?.classList.add('checked');
  });
  window.setTimeout(() => {
    const list = currentList();
    if (getActiveTabId() === 'todo' && list !== 'completed' && S.taskView === 'list') {
      document.querySelectorAll<HTMLElement>(`#todo-list .task-row[data-task-id="${id}"]`).forEach((row) => {
        row.style.height = `${row.offsetHeight}px`;
        requestAnimationFrame(() => row.classList.add('leaving'));
      });
    }
    window.setTimeout(() => afterTodoListChange(), 220);
  }, reduceMotion() ? 0 : 650);
  undoToast(`Completed "${t.title}"`, () => {
    t.status = before.status;
    t.completedAt = before.completedAt;
    if (spawned) S.todos = S.todos.filter((x) => x.id !== spawned.id);
    afterTodoListChange();
  });
}
expose('completeTask', completeTask);

function reduceMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Used by My Day, meetings and the company page. */
export function toggleTodoDone(id: number): void {
  const t = S.todos.find((x) => x.id === id);
  if (!t) return;
  if (isOpenTask(t)) markDone(t); else { t.status = 'Pending'; t.completedAt = null; }
  afterTodoListChange();
}
expose('toggleTodoDone', toggleTodoDone);

export function updateTodoStatus(id: number, status: string): void {
  const t = S.todos.find((x) => x.id === id);
  if (!t) return;
  if (status === 'Done') { if (isOpenTask(t)) markDone(t); }
  else { t.status = status; t.completedAt = null; }
  afterTodoListChange();
}
expose('updateTodoStatus', updateTodoStatus);

function scheduleTasks(ids: number[], fields: Partial<Todo>): void {
  for (const id of ids) {
    const t = S.todos.find((x) => x.id === id);
    if (!t) continue;
    Object.assign(t, fields);
    if (fields.dueDate) t.someday = false;
    if (fields.dueDate === null) t.dueTime = null;
  }
  afterTodoListChange();
}

/** Moves tasks to a day (or clears the date) — used by My Day. */
export function setTasksDue(ids: number[], dueDate: string | null): void {
  scheduleTasks(ids, { dueDate });
}

/** Parks tasks in Someday — used by clean-up. */
export function setTasksSomeday(ids: number[]): void {
  scheduleTasks(ids, { someday: true, dueDate: null, dueTime: null });
}

export function duplicateTask(id: number): void {
  const t = S.todos.find((x) => x.id === id);
  if (!t) return;
  const copy = { ...t, id: nextTodoId(), title: `${t.title} (copy)`, status: 'Pending', completedAt: null, createdAt: todayIso(), sortOrder: null, tags: [...(t.tags || [])] };
  S.todos.push(copy);
  afterTodoListChange();
  openTaskDetail(copy.id);
}
expose('duplicateTask', duplicateTask);

function moveTasksMenu(anchor: HTMLElement, ids: number[]): void {
  const r = anchor.getBoundingClientRect();
  const fake = new MouseEvent('contextmenu', { clientX: r.left + 40, clientY: r.bottom });
  const items: ContextMenuItem[] = [
    { label: 'No project', iconName: 'close', run: () => scheduleTasks(ids, { projectId: null, section: null }) },
    ...S.projects.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ label: p.name, iconName: 'target', run: () => scheduleTasks(ids, { projectId: p.id, section: null }) })),
  ];
  showContextMenu(fake, items);
}

export function todoContextMenu(e: MouseEvent, id: number): void {
  const t = S.todos.find((x) => x.id === id);
  if (!t) return;
  const ids = selection.has(id) && selection.size > 1 ? [...selection] : [id];
  const many = ids.length > 1;
  const anchor = (e.currentTarget as HTMLElement | null)?.closest?.('.task-row') as HTMLElement | null
    ?? document.querySelector<HTMLElement>(`.task-row[data-task-id="${id}"]`);
  showContextMenu(e, [
    { label: many ? `Complete ${ids.length} tasks` : isOpenTask(t) ? 'Complete' : 'Mark as not done', iconName: 'check', run: () => ids.forEach((x) => completeTask(x)) },
    ...(many ? [] : [{ label: 'Open', iconName: 'edit', run: () => openTaskDetail(id) }]),
    { label: 'Due today', iconName: 'sun', run: () => scheduleTasks(ids, { dueDate: todayIso() }) },
    { label: 'Due tomorrow', iconName: 'calendar', run: () => scheduleTasks(ids, { dueDate: addDaysIso(todayIso(), 1) }) },
    { label: 'Pick a date…', iconName: 'calendar', run: () => { if (anchor) openDatePopover(anchor, ids); } },
    { label: t.someday ? 'Move out of Someday' : 'Move to Someday', iconName: 'archive', run: () => scheduleTasks(ids, t.someday ? { someday: false } : { someday: true, dueDate: null, dueTime: null }) },
    { label: 'Move to project…', iconName: 'target', run: () => { if (anchor) moveTasksMenu(anchor, ids); } },
    { label: '', run: () => {}, separator: true },
    ...(many ? [] : [{ label: 'Duplicate', iconName: 'copy', run: () => duplicateTask(id) }]),
    { label: many ? `Delete ${ids.length} tasks` : 'Delete', iconName: 'trash', danger: true, run: () => deleteTasks(ids) },
  ]);
}
expose('todoContextMenu', todoContextMenu);

function collectWithSubtasks(ids: number[]): Set<number> {
  const doomed = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of S.todos) {
      if (t.parentId != null && doomed.has(t.parentId) && !doomed.has(t.id)) { doomed.add(t.id); grew = true; }
    }
  }
  return doomed;
}

/** Deletes right away and offers Undo instead of asking first. */
export function deleteTasks(ids: number[], opts: { silent?: boolean } = {}): void {
  const tasks = ids.map((id) => S.todos.find((x) => x.id === id)).filter(Boolean) as Todo[];
  if (!tasks.length) return;
  const doomed = collectWithSubtasks(ids);
  const removed = S.todos.map((t, index) => ({ t, index })).filter(({ t }) => doomed.has(t.id));
  S.todos = S.todos.filter((x) => !doomed.has(x.id));
  ids.forEach((id) => selection.delete(id));
  if (S.taskDetailId != null && doomed.has(S.taskDetailId)) closeTaskDetail();
  afterTodoListChange();
  if (opts.silent) return;
  const subtasks = removed.length - tasks.length;
  const what = tasks.length === 1 ? `"${tasks[0].title}"` : `${tasks.length} tasks`;
  undoToast(`Deleted ${what}${subtasks > 0 ? ` and ${subtasks} subtask${subtasks === 1 ? '' : 's'}` : ''}`, () => {
    for (const { t, index } of removed) S.todos.splice(Math.min(index, S.todos.length), 0, t);
    afterTodoListChange();
  });
}

export function deleteTodo(id: number, opts: { silent?: boolean } = {}): void {
  deleteTasks([id], opts);
}
expose('deleteTodo', deleteTodo);

function afterTodoListChange(): void {
  persistTodos();
  updateTodoBadge();
  if (getActiveTabId() === 'todo') renderTodo();
  if (S.taskDetailId != null) refreshDetailChrome();
  refreshProjectViewIfOpen();
  refreshCompanyViewIfOpen();
}

// ── Drag and drop ───────────────────────────────────────────────────────────

registerDragSource('task', {
  // Dragging a selected row moves the whole selection.
  ids: (id) => (selection.has(id) && selection.size > 1 ? [...selection] : [id]),
  label: (ids) => ids.length > 1 ? `${ids.length} tasks` : null,
});
registerDragSource('subtask');

const listLabel = (list: string) => SMART.find((x) => x.key === list)?.label
  ?? (list.startsWith('project:') ? S.projects.find((p) => p.id === Number(list.slice(8)))?.name
  : list.startsWith('company:') ? companyRefFromKey(list.slice(8)).name
  : list.startsWith('tag:') ? `#${list.slice(4)}` : list);

/** Sidebar lists: Today schedules, Someday parks, a project moves, a tag tags. */
registerDropTarget('task-list', {
  accepts: ['task'],
  onDrop: ({ ids }, { value: list }) => {
    const n = ids.length === 1 ? 'Task' : `${ids.length} tasks`;
    if (list === 'today') scheduleTasks(ids, { dueDate: todayIso(), someday: false });
    else if (list === 'upcoming') scheduleTasks(ids, { dueDate: addDaysIso(todayIso(), 1), someday: false });
    else if (list === 'someday') scheduleTasks(ids, { someday: true, dueDate: null, dueTime: null });
    else if (list === 'anytime') scheduleTasks(ids, { someday: false });
    else if (list === 'completed') { ids.forEach((id) => { const t = S.todos.find((x) => x.id === id); if (t && isOpenTask(t)) markDone(t); }); afterTodoListChange(); }
    else if (list.startsWith('project:')) scheduleTasks(ids, { projectId: Number(list.slice(8)), section: null });
    else if (list.startsWith('company:')) scheduleTasks(ids, { type: 'client', client: companyRefFromKey(list.slice(8)).name });
    else if (list.startsWith('tag:')) {
      const tag = list.slice(4);
      ids.forEach((id) => { const t = S.todos.find((x) => x.id === id); if (t && !(t.tags || []).includes(tag)) t.tags = [...(t.tags || []), tag]; });
      afterTodoListChange();
    }
    toast(`${n} moved to ${listLabel(list)}`);
  },
});

registerDropTarget('task-date', {
  accepts: ['task'],
  onDrop: ({ ids }, { value }) => {
    scheduleTasks(ids, { dueDate: value, someday: false });
    toast(`${ids.length === 1 ? 'Task' : `${ids.length} tasks`} due ${friendlyDate(value, new Date())}`);
  },
});

registerDropTarget('task-status', {
  accepts: ['task'],
  onDrop: ({ ids }, { value: status }) => {
    for (const id of ids) {
      const t = S.todos.find((x) => x.id === id);
      if (!t || t.status === status) continue;
      if (status === 'Done') { markDone(t); continue; }
      t.status = status;
      t.completedAt = null;
    }
    afterTodoListChange();
  },
});

/** Dropping between rows puts the tasks in that place; into another day or
 * heading it also reschedules or re-files them. */
registerDropTarget('task-order', {
  accepts: ['task'],
  onDrop: ({ ids }, { value, beforeId }) => {
    for (const id of ids) {
      const t = S.todos.find((x) => x.id === id);
      if (!t) continue;
      if (value.startsWith('date:')) { t.dueDate = value.slice(5); t.someday = false; }
      if (value.startsWith('section:')) t.section = value.slice(8) || null;
    }
    const order = S.todos.filter((t) => t.parentId == null).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    reorder(order, ids, beforeId).forEach((t, i) => { t.sortOrder = i; });
    if (S.todoSort !== 'manual') {
      S.todoSort = 'manual';
      toast('Now sorted by hand', { detail: 'Switch back to date and priority from the ••• menu.' });
    }
    afterTodoListChange();
  },
});

registerDropTarget('subtask-order', {
  accepts: ['subtask'],
  onDrop: ({ ids }, { value, beforeId }) => {
    const subs = S.todos.filter((t) => t.parentId === Number(value)).sort((a, b) => (a.sortOrder ?? a.id) - (b.sortOrder ?? b.id));
    reorder(subs, ids, beforeId).forEach((t, i) => { t.sortOrder = i; });
    afterTodoListChange();
    renderTaskDetail();
  },
});

// ── Date popover ────────────────────────────────────────────────────────────

let dateTargets: number[] = [];

export function openDatePopover(anchor: HTMLElement, ids: number[]): void {
  dateTargets = ids;
  const first = S.todos.find((t) => t.id === ids[0]);
  let pop = document.getElementById('task-date-pop');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'task-date-pop';
    pop.className = 'task-date-pop';
    pop.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(pop);
    document.addEventListener('click', () => pop?.classList.remove('open'));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pop?.classList.remove('open'); });
  }
  const t0 = todayIso();
  const sat = addDaysIso(t0, (6 - new Date().getDay() + 7) % 7 || 7);
  const mon = addDaysIso(t0, (8 - new Date().getDay()) % 7 || 7);
  const opt = (label: string, iconName: string, js: string, hint = '') => `<button class="task-date-opt" onclick="${js}">${icon(iconName, 14)}<span>${label}</span><span class="task-date-hint">${hint}</span></button>`;
  pop.innerHTML = `
    ${opt('Today', 'sun', `applyTaskDate('${t0}')`, friendlyDate(t0, new Date()) === 'Today' ? new Date().toLocaleDateString('en-GB', { weekday: 'short' }) : '')}
    ${opt('Tomorrow', 'calendar', `applyTaskDate('${addDaysIso(t0, 1)}')`, new Date(Date.now() + 86400000).toLocaleDateString('en-GB', { weekday: 'short' }))}
    ${opt('This weekend', 'calendar', `applyTaskDate('${sat}')`, 'Sat')}
    ${opt('Next week', 'calendar', `applyTaskDate('${mon}')`, 'Mon')}
    ${opt('Someday', 'archive', 'applyTaskSomeday()')}
    <div class="task-date-custom">
      <input type="date" id="task-date-input" value="${first?.dueDate || ''}" aria-label="Date">
      <input type="time" id="task-time-input" value="${first?.dueTime || ''}" aria-label="Time">
      <button class="btn-primary" onclick="applyTaskDate(document.getElementById('task-date-input').value || null, document.getElementById('task-time-input').value || null)">Set</button>
    </div>
    ${first?.dueDate || first?.someday ? opt('Clear date', 'close', 'applyTaskDate(null)') : ''}`;
  pop.classList.add('open');
  positionFloatingPopup(pop, anchor);
}
expose('openDatePopover', openDatePopover);

export function applyTaskDate(date: string | null, time?: string | null): void {
  document.getElementById('task-date-pop')?.classList.remove('open');
  scheduleTasks(dateTargets, date ? { dueDate: date, dueTime: time ?? S.todos.find((t) => t.id === dateTargets[0])?.dueTime ?? null, someday: false } : { dueDate: null, dueTime: null, someday: false });
  if (S.taskDetailId != null) renderTaskDetail();
}
expose('applyTaskDate', applyTaskDate);

export function applyTaskSomeday(): void {
  document.getElementById('task-date-pop')?.classList.remove('open');
  scheduleTasks(dateTargets, { someday: true, dueDate: null, dueTime: null });
  if (S.taskDetailId != null) renderTaskDetail();
}
expose('applyTaskSomeday', applyTaskSomeday);

// ── Detail panel ────────────────────────────────────────────────────────────

export function openTaskDetail(id: number): void {
  const t = S.todos.find((x) => x.id === id);
  if (!t) return;
  const changed = S.taskDetailId !== id;
  S.taskDetailId = id;
  if (!selection.has(id)) { selection.clear(); selection.add(id); anchorId = id; }
  const panel = document.getElementById('task-detail');
  if (panel) panel.hidden = false;
  if (changed) renderTaskDetail();
  paintSelection();
  notifyNavigated();
}
expose('openTaskDetail', openTaskDetail);

let detailClosedAt = 0;

export function closeTaskDetail(): void {
  if (S.taskDetailId == null) return;
  detailClosedAt = Date.now();
  S.taskDetailId = null;
  const panel = document.getElementById('task-detail');
  if (panel) { panel.hidden = true; panel.innerHTML = ''; }
  paintSelection();
  notifyNavigated();
}
expose('closeTaskDetail', closeTaskDetail);

function detailTask(): Todo | undefined {
  return S.todos.find((t) => t.id === S.taskDetailId);
}

function renderTaskDetail(): void {
  const panel = document.getElementById('task-detail');
  const t = detailTask();
  if (!panel || !t) return;
  const done = !isOpenTask(t);
  const subs = S.todos.filter((x) => x.parentId === t.id).sort((a, b) => (a.sortOrder ?? a.id) - (b.sortOrder ?? b.id));
  const parent = t.parentId != null ? S.todos.find((x) => x.id === t.parentId) : null;
  const projects = S.projects.filter((p) => !p.archived || p.id === t.projectId);
  const sections = [...new Set(S.todos.filter((x) => x.projectId != null && x.projectId === t.projectId && x.section).map((x) => x.section as string))];
  const meeting = t.meetingId != null ? S.meetings.find((m) => m.id === t.meetingId) : null;
  const opportunities = S.opportunities.filter((o) => !o.archived || o.id === t.opportunityId);
  if (taskNotesFor?.taskId !== t.id) { taskNotesFor = { taskId: t.id, noteIds: [] }; void loadTaskNotes(t.id); }
  const fromNotes = taskNotesFor.noteIds.map((id) => S.notes.find((n) => n.id === id)).filter((n): n is NonNullable<typeof n> => !!n);
  const seg = (field: string, value: string | null, options: [string, string][]) =>
    `<div class="segmented td-seg">${options.map(([v, label]) => `<button class="${(value || options[0][0]) === v ? 'active' : ''}" onclick="taskDetailSet('${field}','${v}')">${label}</button>`).join('')}</div>`;
  panel.innerHTML = `
    <div class="td-top">
      <button class="loc-nav" onclick="closeTaskDetail()" title="Close (Esc)" aria-label="Close">${icon('close', 15)}</button>
      <div class="td-top-actions">
        <button class="loc-nav" onclick="duplicateTask(${t.id})" title="Duplicate" aria-label="Duplicate">${icon('copy', 15)}</button>
        <button class="loc-nav td-danger" onclick="deleteTodo(${t.id})" title="Delete" aria-label="Delete">${icon('trash', 15)}</button>
      </div>
    </div>
    <div class="td-scroll">
      ${parent ? `<button class="td-parent" onclick="openTaskDetail(${parent.id})">↳ Subtask of ${escHtml(parent.title)}</button>` : ''}
      <div class="td-title-row">
        <button class="task-check${t.priority === 'High' ? ' pri-high' : t.priority === 'Low' ? ' pri-low' : ''}${done ? ' checked' : ''}" onclick="completeTask(${t.id});setTimeout(renderTaskDetailExternal, 700)" aria-label="${done ? 'Mark as not done' : 'Complete'}"></button>
        <textarea id="td-title" class="td-title${done ? ' done' : ''}" rows="1" oninput="taskDetailText('title', this.value);autoGrow(this)" onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('td-notes').focus()}">${escHtml(t.title)}</textarea>
      </div>
      <textarea id="td-notes" class="td-notes" rows="2" placeholder="Notes" oninput="taskDetailText('description', this.value);autoGrow(this)">${escHtml(t.description || '')}</textarea>

      <div class="td-checklist" data-sort="subtask-order" data-drop-value="${t.id}">
        ${subs.map((s) => `<div class="td-check-item${isOpenTask(s) ? '' : ' done'}" data-drag-kind="subtask" data-drag-id="${s.id}"><span class="td-grip" aria-hidden="true">${icon('grip', 12)}</span>
          <button class="task-check small${isOpenTask(s) ? '' : ' checked'}" onclick="toggleSubtask(${s.id})" aria-label="Complete subtask"></button>
          <input value="${escHtml(s.title)}" onchange="renameSubtask(${s.id}, this.value)" onkeydown="if(event.key==='Enter')this.blur()" aria-label="Subtask">
          <button class="td-check-open" onclick="openTaskDetail(${s.id})" title="Open subtask">${icon('chevronRight', 12)}</button>
          <button class="td-check-remove" onclick="deleteTodo(${s.id})" title="Remove" aria-label="Remove subtask">×</button>
        </div>`).join('')}
        <div class="td-check-add">${icon('plus', 13)}<input id="td-add-sub" placeholder="Add a subtask" onkeydown="if(event.key==='Enter'){event.preventDefault();addSubtask(this.value)}"></div>
      </div>

      <dl class="td-props">
        <dt>When</dt>
        <dd><button id="td-when" class="td-chip${isOverdue(t) ? ' overdue' : ''}" onclick="event.stopPropagation();openDatePopover(this,[${t.id}])">${icon(t.someday ? 'archive' : 'calendar', 13)}${t.someday ? 'Someday' : t.dueDate ? escHtml(whenLabel(t)) : 'Add date'}</button></dd>
        <dt>Priority</dt>
        <dd>${seg('priority', t.priority, [['High', 'High'], ['Medium', 'Medium'], ['Low', 'Low']])}</dd>
        <dt>Status</dt>
        <dd>${seg('status', t.status, [['Pending', 'To do'], ['In Progress', 'In progress'], ['Done', 'Done']])}</dd>
        <dt>Project</dt>
        <dd><select class="td-select" onchange="taskDetailSet('projectId', this.value)"><option value="">No project</option>${projects.map((p) => `<option value="${p.id}"${p.id === t.projectId ? ' selected' : ''}>${escHtml(p.name)}</option>`).join('')}</select>
          ${t.projectId != null ? recordLink('project', t.projectId, 'Open', { className: 'td-open-link' }) : ''}</dd>
        ${t.projectId != null ? `<dt>Heading</dt><dd><input class="td-input" list="td-sections" value="${escHtml(t.section || '')}" placeholder="None" onchange="taskDetailSet('section', this.value)"><datalist id="td-sections">${sections.map((s) => `<option value="${escHtml(s)}">`).join('')}</datalist></dd>` : ''}
        <dt>Company</dt>
        <dd><input id="td-company" class="td-input" value="${escHtml(t.client || '')}" placeholder="None">
          ${t.client ? companyLink(t.companyId, t.client, { className: 'td-open-link' }).replace(`>${escHtml(t.client)}<`, '>Open<') : ''}</dd>
        <dt>Repeat</dt>
        <dd><select class="td-select" onchange="taskDetailSet('recurrenceRule', this.value)">${[['', 'Never'], ['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month']].map(([v, l]) => `<option value="${v}"${(t.recurrenceRule || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></dd>
        <dt>Tags</dt>
        <dd><div id="td-tags" class="tag-chip-input td-tags"></div></dd>
        <dt>Opportunity</dt>
        <dd><select class="td-select" onchange="taskDetailSet('opportunityId', this.value)"><option value="">No opportunity</option>${opportunities.map((o) => `<option value="${o.id}"${o.id === t.opportunityId ? ' selected' : ''}>${escHtml(o.name)}</option>`).join('')}</select>
          ${t.opportunityId != null ? recordLink('opportunity', t.opportunityId, 'Open', { className: 'td-open-link' }) : ''}</dd>
        ${meeting ? `<dt>Meeting</dt><dd>${recordLink('meeting', meeting.id, meeting.title)}</dd>` : ''}
        ${fromNotes.length ? `<dt>From note</dt><dd>${fromNotes.map((n) => recordLink('note', n.id, n.title || 'Untitled')).join(', ')}</dd>` : ''}
      </dl>
      <div class="td-foot">Created ${fmtDate(t.createdAt)}${t.completedAt ? ` · Completed ${fmtDate(t.completedAt)}` : ''}</div>
    </div>`;
  const tags = document.getElementById('td-tags');
  if (tags) renderTagChips(tags, t.tags || [], (next) => { const cur = detailTask(); if (cur) { cur.tags = next; afterTodoListChange(); } }, { placeholder: 'Add tag…', suggestions: S.allTags });
  const company = document.getElementById('td-company') as HTMLInputElement | null;
  if (company) {
    attachCompanySelector(company, { onSelect: (name) => taskDetailSet('client', name) });
    company.addEventListener('change', () => taskDetailSet('client', company.value));
  }
  panel.querySelectorAll<HTMLTextAreaElement>('textarea').forEach(autoGrow);
}
expose('renderTaskDetailExternal', () => renderTaskDetail());

/** Re-renders only the non-typing parts after list-level changes (dates,
 * priority from the keyboard) without disturbing text being edited. */
function refreshDetailChrome(): void {
  const active = document.activeElement as HTMLElement | null;
  if (active?.closest('#task-detail') && /^(TEXTAREA|INPUT)$/.test(active.tagName)) return;
  renderTaskDetail();
}

export function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}
expose('autoGrow', autoGrow);

let textTimer: number | undefined;
export function taskDetailText(field: 'title' | 'description', value: string): void {
  const t = detailTask();
  if (!t) return;
  if (field === 'title') { if (!value.trim()) return; t.title = value.replace(/\n/g, ' '); }
  else t.description = value || null;
  window.clearTimeout(textTimer);
  textTimer = window.setTimeout(() => {
    persistTodos();
    const row = document.querySelector<HTMLElement>(`#todo-list .task-row[data-task-id="${t.id}"] .task-title`);
    if (row) row.textContent = t.title;
    refreshProjectViewIfOpen();
  }, 350);
}
expose('taskDetailText', taskDetailText);

export function taskDetailSet(field: string, value: string): void {
  const t = detailTask();
  if (!t) return;
  switch (field) {
    case 'priority': t.priority = value; break;
    case 'status':
      if (value === 'Done') { if (isOpenTask(t)) markDone(t); }
      else { t.status = value; t.completedAt = null; }
      break;
    case 'projectId':
      t.projectId = value ? Number(value) : null; t.section = null;
      inheritTaskCompany(t);
      break;
    case 'opportunityId':
      t.opportunityId = value ? Number(value) : null;
      inheritTaskCompany(t);
      break;
    case 'section': t.section = value.trim() || null; break;
    case 'recurrenceRule': t.recurrenceRule = value || null; break;
    case 'client': {
      const name = value.trim();
      if ((t.client || '') === name) return;
      // An explicit reassignment: the backend resolves the new name to a company.
      t.client = name || null;
      t.companyId = null;
      t.type = name ? 'client' : 'general';
      break;
    }
  }
  afterTodoListChange();
  renderTaskDetail();
}
expose('taskDetailSet', taskDetailSet);

/** A task without a company takes the company of its project or opportunity;
 * a company already set is never replaced. */
function inheritTaskCompany(t: Todo): void {
  if (t.client) return;
  const ctx = inheritCompany(S, { ...EMPTY_CONTEXT, projectId: t.projectId, opportunityId: t.opportunityId ?? null });
  if (!ctx.companyName) return;
  t.client = ctx.companyName;
  t.companyId = ctx.companyId;
  t.type = 'client';
}

/** Records that a task came from a note (entity link task → note). */
export async function linkTaskToNote(taskId: number, noteId: number): Promise<void> {
  await saveTodosNow();
  const links = await getLinksFor('task', taskId);
  await setLinksFrom('task', taskId, addLinks(links, 'task', taskId, [{ toType: 'note', toId: noteId }]));
}

let taskNotesFor: { taskId: number; noteIds: number[] } | null = null;
/** The notes a task came from, loaded once per opened task. */
async function loadTaskNotes(taskId: number): Promise<void> {
  const links = await getLinksFor('task', taskId);
  taskNotesFor = { taskId, noteIds: links.filter((l) => l.fromType === 'task' && l.fromId === taskId && l.toType === 'note').map((l) => l.toId) };
  if (S.taskDetailId === taskId) refreshDetailChrome();
}

export function addSubtask(title: string): void {
  const parent = detailTask();
  if (!parent || !title.trim()) return;
  S.todos.push(blankTask({ title: title.trim(), parentId: parent.id, projectId: parent.projectId, type: parent.type, client: parent.client, companyId: parent.companyId ?? null, opportunityId: parent.opportunityId ?? null, sortOrder: null }));
  afterTodoListChange();
  renderTaskDetail();
  (document.getElementById('td-add-sub') as HTMLInputElement | null)?.focus();
}
expose('addSubtask', addSubtask);

export function toggleSubtask(id: number): void {
  toggleTodoDone(id);
  renderTaskDetail();
}
expose('toggleSubtask', toggleSubtask);

export function renameSubtask(id: number, title: string): void {
  const t = S.todos.find((x) => x.id === id);
  if (!t || !title.trim()) return;
  t.title = title.trim();
  afterTodoListChange();
}
expose('renameSubtask', renameSubtask);

// ── New-task dialog (used from other modules) ───────────────────────────────

let modalTaskTags: string[] = [];
/** The context a new task was started from (company, project, opportunity, meeting, note). */
let todoModalContext: WorkContext | null = null;

/** Existing tasks open in the detail panel; `null` opens the new-task dialog,
 * prefilled from `ctx` when given (every field can still be changed). */
export function openTodoModal(id: number | null, ctx: WorkContext | null = null): void {
  if (id !== null) { (window as any).openRecord('task', id); return; }
  S.todoEditId = null;
  todoModalContext = ctx;
  const f = document.getElementById('todo-form') as HTMLFormElement;
  f.reset();
  const clientField = f.elements.namedItem('todoClient') as HTMLInputElement | null;
  if (clientField) attachCompanySelector(clientField);
  const projSel = f.elements.namedItem('todoProject') as HTMLSelectElement | null;
  if (projSel) {
    projSel.innerHTML = `<option value="">— No project —</option>` +
      S.projects.filter((p) => !p.archived || p.id === ctx?.projectId).map((p) => `<option value="${p.id}">${escHtml(p.name)}${p.type === 'internal' ? ' (Internal)' : ''}</option>`).join('');
    projSel.value = ctx?.projectId != null ? String(ctx.projectId) : '';
  }
  const oppSel = f.elements.namedItem('todoOpportunity') as HTMLSelectElement | null;
  if (oppSel) {
    oppSel.innerHTML = `<option value="">— No opportunity —</option>` +
      S.opportunities.filter((o) => !o.archived || o.id === ctx?.opportunityId).map((o) => `<option value="${o.id}">${escHtml(o.name)}</option>`).join('');
    oppSel.value = ctx?.opportunityId != null ? String(ctx.opportunityId) : '';
  }
  const parent = S.todoParentId != null ? S.todos.find((x) => x.id === S.todoParentId) : null;
  const title = document.getElementById('todo-modal-title');
  if (title) title.textContent = parent ? `New subtask of “${parent.title}”` : 'New task';
  const btn = document.getElementById('todo-submit-btn'); if (btn) btn.textContent = 'Create task';
  const type = ctx?.companyName ? 'client' : 'general';
  (f.elements.namedItem('todoType') as HTMLSelectElement).value = type;
  (f.elements.namedItem('todoClient') as HTMLInputElement).value = ctx?.companyName || '';
  toggleTodoClient(type);
  const meeting = ctx?.meetingId != null ? S.meetings.find((m) => m.id === ctx.meetingId) : undefined;
  const note = ctx?.noteId != null ? S.notes.find((n) => n.id === ctx.noteId) : undefined;
  const ctxEl = document.getElementById('todo-context');
  if (ctxEl) {
    const parts = [meeting ? `meeting “${escHtml(meeting.title)}”` : '', note ? `note “${escHtml(note.title || 'Untitled')}”` : ''].filter(Boolean);
    ctxEl.hidden = parts.length === 0;
    ctxEl.innerHTML = parts.length ? `<span class="flbl-hint">From ${parts.join(' and ')}</span>` : '';
  }
  modalTaskTags = [];
  const tagsContainer = document.getElementById('todo-tags-chips');
  if (tagsContainer) renderTagChips(tagsContainer, modalTaskTags, (tags) => { modalTaskTags = tags; }, { placeholder: 'Add tag...', suggestions: S.allTags });
  document.getElementById('modal-todo')?.classList.add('open');
  (f.elements.namedItem('todoTitle') as HTMLInputElement | null)?.focus();
}
expose('openTodoModal', openTodoModal);

export function openSubtaskModal(parentId: number): void {
  S.todoParentId = parentId;
  const parent = S.todos.find((x) => x.id === parentId);
  openTodoModal(null, parent ? contextFromTask(parent) : null);
}
expose('openSubtaskModal', openSubtaskModal);

/** A task's own context, for subtasks. */
function contextFromTask(t: Todo): WorkContext {
  return { ...EMPTY_CONTEXT, ...companyOf(S, t.companyId, t.client), projectId: t.projectId, opportunityId: t.opportunityId ?? null, meetingId: t.meetingId };
}

/** New task in the open project: the project and its company. */
export function createTodoForCurrentProject(): void {
  const p = S.currentProjectId != null ? S.projects.find((x) => x.id === S.currentProjectId) : undefined;
  if (p) openTodoModal(null, contextFromProject(S, p));
}
expose('createTodoForCurrentProject', createTodoForCurrentProject);

/** New task for an opportunity: the opportunity and its company. */
export function createTodoForOpportunity(opportunityId: number | null = S.currentOpportunityId): void {
  const o = opportunityId != null ? S.opportunities.find((x) => x.id === opportunityId) : undefined;
  if (o) openTodoModal(null, contextFromOpportunity(S, o));
}
expose('createTodoForOpportunity', createTodoForOpportunity);

/** New task from a meeting: its company, project, opportunity and the meeting. */
export function createTodoForMeeting(meetingId: number | null = S.meetingEditId): void {
  const m = meetingId != null ? S.meetings.find((x) => x.id === meetingId) : undefined;
  if (m) openTodoModal(null, contextFromMeeting(S, m));
}
expose('createTodoForMeeting', createTodoForMeeting);

export function closeTodoModal(): void {
  document.getElementById('modal-todo')?.classList.remove('open');
  S.todoParentId = null;
  todoModalContext = null;
}
expose('closeTodoModal', closeTodoModal);

export function toggleTodoClient(type: string): void {
  const g = document.getElementById('todo-client-group');
  if (g) g.style.display = type === 'client' ? '' : 'none';
}
expose('toggleTodoClient', toggleTodoClient);

export function submitTodo(e: Event): void {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  const type = (f.elements.namedItem('todoType') as HTMLSelectElement).value;
  const projVal = (f.elements.namedItem('todoProject') as HTMLSelectElement | null)?.value || '';
  const oppVal = (f.elements.namedItem('todoOpportunity') as HTMLSelectElement | null)?.value || '';
  const status = (f.elements.namedItem('todoStatus') as HTMLSelectElement).value;
  const ctx = todoModalContext;
  // Company: kept by id while the field shows the context's company; another
  // typed name is an explicit reassignment; a general task with a project or
  // opportunity takes that record's company.
  const typed = type === 'client' ? (f.elements.namedItem('todoClient') as HTMLInputElement).value : '';
  const fromForm = {
    ...EMPTY_CONTEXT, ...companyFromForm(ctx, typed),
    projectId: projVal ? Number(projVal) : null,
    opportunityId: oppVal ? Number(oppVal) : null,
    meetingId: ctx?.meetingId ?? null,
  };
  // A company the dialog offered and the person removed stays removed.
  const removedCompany = !!ctx?.companyName && !typed.trim();
  const graph = removedCompany ? fromForm : inheritCompany(S, fromForm);
  const task = blankTask({
    ...taskFields(graph),
    title: (f.elements.namedItem('todoTitle') as HTMLInputElement).value.trim(),
    priority: (f.elements.namedItem('todoPriority') as HTMLSelectElement).value,
    dueDate: (f.elements.namedItem('todoDue') as HTMLInputElement).value || null,
    recurrenceRule: (f.elements.namedItem('todoRecurrence') as HTMLSelectElement).value || null,
    description: (f.elements.namedItem('todoDesc') as HTMLTextAreaElement).value.trim() || null,
    parentId: S.todoParentId,
    tags: [...modalTaskTags],
  });
  if (!task.title) return;
  S.todos.push(task);
  if (status === 'Done') markDone(task); else task.status = status;
  const noteId = ctx?.noteId ?? null;
  closeTodoModal();
  afterTodoListChange();
  if (noteId != null) void linkTaskToNote(task.id, noteId);
}
expose('submitTodo', submitTodo);

// ── Company page section ────────────────────────────────────────────────────

export function renderCoTodosSection(d: { name: string; companyId: number | null }): void {
  const ref = { id: d.companyId, name: d.name };
  const companyTodos = S.todos.filter((t) => inCompany(ref, t.companyId, t.client));
  const container = document.getElementById('cosub-todos-inner');
  if (!container) return;
  const cnt = document.getElementById('co-todos-tab-count');
  if (cnt) cnt.textContent = String(companyTodos.filter(isOpenTask).length);
  if (companyTodos.length === 0) {
    container.innerHTML = emptyState({ icon: 'check', title: `No tasks for ${d.name}`, compact: true, action: { label: 'New task', onclick: `createTodoForCompany('${d.name.replace(/'/g, "\\'")}')` } });
    renderIcons(container);
    return;
  }
  const sorted = [...companyTodos].sort((a, b) => Number(!isOpenTask(a)) - Number(!isOpenTask(b)) || smartCompare(a, b));
  container.innerHTML = `<div class="task-group">${sorted.map((t) => taskRowHtml(t, { list: `company:${d.companyId != null ? `id:${d.companyId}` : `name:${d.name}`}`, compact: true })).join('')}</div>`;
}
expose('renderCoTodosSection', renderCoTodosSection);

/** "New task for Globex": go to Globex's task list and start typing. */
export function createTodoForCompany(clientName: string): void {
  const co = S.companies.find((c) => c.name === clientName);
  S.todoFilter = `company:${co ? `id:${co.id}` : `name:${clientName}`}`;
  S.taskView = 'list';
  (window as any).switchTab('todo');
  setTimeout(() => document.getElementById('quick-task-input')?.focus(), 30);
}
expose('createTodoForCompany', createTodoForCompany);
