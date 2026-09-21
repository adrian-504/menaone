import { S } from '../lib/state';
import { emptyState } from '../lib/ui';
import { recordLink } from '../lib/links';
import { activityItem, renderFeed } from '../lib/activityFeed';
import { renderIcons } from '../core/chrome';
import { registerDragSource, registerDropTarget, reorder } from '../lib/dnd';
import { loadInto } from '../lib/ui';
import { companyLink } from '../lib/links';
import { fmtDate, escHtml, expose, statusDot, showConfirm, nextNoteId, today, inCompany } from '../lib/utils';
import { registerTabRenderer, registerProjectViewRefresher, refreshAll, notifyNavigated } from '../lib/registry';
import { createListNav } from '../lib/listNav';
import { getProjects, getMilestones, getLinksFor, setLinksFrom, filesGetByIds, getActivity } from '../lib/db';
import { persistProject, persistMilestones, persistOpportunity, persistNotes, saveNotesNow } from '../lib/persist';
import { companyFromForm, contextFromOpportunity, contextFromProject, projectChain } from '../lib/workGraph';
import { getAllCompanies } from './companies';
import { taskRowHtml, createTodoForCurrentProject } from './todo';
import { renderLinkedEmails } from '../core/emailLinks';
import { icon } from '../lib/icons';
import { showContextMenu } from '../lib/contextMenu';
import { attachCompanySelector } from '../lib/companySelector';
import type { Project, Milestone, Note } from '../lib/types';
import { statusTone, toneVar } from '../lib/statusTone';
import { currentUser, matchesOwnerFilter, ownerFilterOptions } from '../lib/commercial';

// Project status dots use the shared tones (statusTone.ts).
const STATUS_COLOR: Record<string, { c: string }> = Object.fromEntries(
  ['Idea', 'Planning', 'Not Started', 'In Progress', 'At Risk', 'On Hold', 'Completed', 'Cancelled'].map((s) => [s, { c: `var(${toneVar(statusTone('project', s))})` }]),
);

/** Reloads S.projects from the backend — progress/task counts are computed
 * server-side from linked tasks (see hydrate_project in v2_commands.rs), so
 * any mutation that could affect them (saving a project, saving a task) needs
 * a refetch rather than a local patch to stay accurate. */
async function loadProjects(): Promise<void> {
  S.projects = await getProjects(true);
}

async function renderProjectsTab(): Promise<void> {
  if (!(await loadInto(document.getElementById('proj-grid'), 'projects', 'renderTab(\'projects\')', loadProjects, 'cards'))) return;
  renderProjects();
  if (S.currentProjectId != null) await renderProjectDetail();
}
registerTabRenderer('projects', () => { void renderProjectsTab(); });

createListNav<number>({
  tabId: 'projects',
  getItems: () => [...document.querySelectorAll<HTMLElement>('#proj-grid .project-card[data-project-id]')].map((el) => Number(el.dataset.projectId)),
  getEl: (id) => document.querySelector<HTMLElement>(`#proj-grid .project-card[data-project-id="${id}"]`),
  onOpen: (id) => { void openProjectDetail(id); },
});
registerProjectViewRefresher(() => {
  // A task linked to the open project just changed — its computedProgress
  // is derived server-side from task completion, so refetch before re-rendering.
  void loadProjects().then(() => renderProjectDetail());
});

export function setProjectFilter(f: typeof S.projectFilter): void {
  S.projectFilter = f;
  document.querySelectorAll('#proj-type-seg button').forEach((b, i) => {
    b.classList.toggle('active', (i === 0 && f === 'all') || (i === 1 && f === 'client') || (i === 2 && f === 'internal'));
  });
  renderProjects();
}
expose('setProjectFilter', setProjectFilter);

export function renderProjects(): void {
  const statusF = (document.getElementById('proj-status-filter') as HTMLSelectElement | null)?.value || '';
  const sortBy = (document.getElementById('proj-sort') as HTMLSelectElement | null)?.value || 'updated';
  const search = ((document.getElementById('proj-search') as HTMLInputElement | null)?.value || '').toLowerCase();
  const ownerSel = document.getElementById('proj-owner-filter') as HTMLSelectElement | null;
  const ownerF = ownerSel?.value || '';
  if (ownerSel) ownerSel.innerHTML = ownerFilterOptions(S.projects.filter((p) => !p.archived).map((p) => p.owner), ownerF);

  let data = S.projects.filter((p) => {
    if (p.archived) return false;
    if (!matchesOwnerFilter(p, ownerF)) return false;
    if (S.projectFilter === 'client' && p.type !== 'client') return false;
    if (S.projectFilter === 'internal' && p.type !== 'internal') return false;
    if (statusF && p.status !== statusF) return false;
    if (search && !p.name.toLowerCase().includes(search) && !(p.companyName || '').toLowerCase().includes(search)) return false;
    return true;
  });

  const priOrder: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
  if (sortBy === 'priority') data.sort((a, b) => (priOrder[a.priority] ?? 1) - (priOrder[b.priority] ?? 1));
  else if (sortBy === 'target') data.sort((a, b) => (a.targetDate || '9999').localeCompare(b.targetDate || '9999'));
  else if (sortBy === 'progress') data.sort((a, b) => b.computedProgress - a.computedProgress);
  else if (sortBy === 'status') data.sort((a, b) => a.status.localeCompare(b.status));
  else data.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  const cnt = document.getElementById('proj-cnt'); if (cnt) cnt.textContent = `${data.length} project${data.length !== 1 ? 's' : ''}`;

  const grid = document.getElementById('proj-grid');
  if (!grid) return;
  if (data.length === 0) {
    grid.innerHTML = `<div class="sec grid-full">${emptyState({ icon: 'target', title: 'No projects here', body: 'Client engagements and internal initiatives both live here.', action: { label: 'New project', onclick: 'openProjectModal(null)' } })}</div>`;
    renderIcons(grid);
    return;
  }
  grid.innerHTML = data.map(projectCard).join('');
}
expose('renderProjects', renderProjects);

export function projectContextMenu(e: MouseEvent, id: number): void {
  const p = S.projects.find((x) => x.id === id);
  if (!p) return;
  showContextMenu(e, [
    { label: 'Open', iconName: 'target', run: () => (window as any).openRecord('project', id) },
    { label: 'Edit', iconName: 'edit', run: () => openProjectModal(id) },
    { label: 'Create Task', iconName: 'plus', run: () => { (window as any).switchTab('projects'); void openProjectDetail(id).then(() => createTodoForCurrentProject()); } },
    { label: p.archived ? 'Unarchive' : 'Archive', iconName: 'archive', run: () => { S.currentProjectId = id; void toggleArchiveProject(); } },
  ]);
}
expose('projectContextMenu', projectContextMenu);

function projectCard(p: Project): string {
  const sc = STATUS_COLOR[p.status] || STATUS_COLOR['Not Started'];
  // Cards are also shown on company pages: open through the router so the Projects module comes forward.
  return `<div class="project-card" data-project-id="${p.id}" onclick="openRecord('project', ${p.id})" oncontextmenu="projectContextMenu(event,${p.id})">
    <div class="project-card-hd">
      <div class="project-type-dot ${p.type}" title="${p.type === 'client' ? 'Client project' : 'Internal project'}"></div>
      <div class="project-name">${escHtml(p.name)}</div>
    </div>
    <div class="project-meta-row">
      ${statusDot(sc, p.status)}
      <span>${p.companyName ? companyLink(p.companyId, p.companyName) : 'Internal · MENA BIG'}</span>
    </div>
    <div class="project-progress-track"><div class="project-progress-fill" style="width:${p.computedProgress}%"></div></div>
    <div class="project-meta-row">
      <span>${p.computedProgress}% · ${p.taskDoneCount}/${p.taskCount} tasks</span>
      ${p.targetDate ? `<span class="push-right">Target ${fmtDate(p.targetDate)}</span>` : ''}
    </div>
  </div>`;
}

// ═══════════════ Detail / workspace view ═══════════════

export async function openProjectDetail(id: number): Promise<void> {
  S.currentProjectId = id;
  S.currentProjectMilestones = await getMilestones(id);
  document.getElementById('proj-list-view')?.classList.add('hidden');
  document.getElementById('proj-detail')?.classList.add('open');
  notifyNavigated();
  await renderProjectDetail();
}
expose('openProjectDetail', openProjectDetail);

export function closeProjectDetail(): void {
  S.currentProjectId = null;
  S.currentProjectMilestones = [];
  document.getElementById('proj-detail')?.classList.remove('open');
  document.getElementById('proj-list-view')?.classList.remove('hidden');
  notifyNavigated();
}
expose('closeProjectDetail', closeProjectDetail);

async function renderProjectDetail(): Promise<void> {
  if (S.currentProjectId == null) return;
  const p = S.projects.find((x) => x.id === S.currentProjectId);
  if (!p) { closeProjectDetail(); return; }

  (document.getElementById('pd-name') as HTMLElement).textContent = p.name;
  (document.getElementById('pd-desc') as HTMLElement).textContent = p.description || '';
  // Status/priority/owner are edited inline just below (see the control row
  // in index.html) rather than shown as read-only chips here too — showing
  // both would mean the chip goes stale between edits and a full re-render.
  (document.getElementById('pd-badges') as HTMLElement).innerHTML = [
    `<span class="rec-badge">${p.type === 'client' ? 'Client project' : 'Internal project'}</span>`,
    p.startDate ? `<span class="rec-meta">Started ${fmtDate(p.startDate)}</span>` : '',
    p.targetDate ? `<span class="rec-meta">Target ${fmtDate(p.targetDate)}</span>` : '',
  ].filter(Boolean).join('');
  (document.getElementById('pd-status-sel') as HTMLSelectElement).value = p.status;
  (document.getElementById('pd-priority-sel') as HTMLSelectElement).value = p.priority;
  (document.getElementById('pd-owner-inp') as HTMLInputElement).value = p.owner || '';
  const startInp = document.getElementById('pd-start-inp') as HTMLInputElement | null; if (startInp) startInp.value = p.startDate || '';
  const targetInp = document.getElementById('pd-target-inp') as HTMLInputElement | null; if (targetInp) targetInp.value = p.targetDate || '';
  fillTeamNames();
  (document.getElementById('pd-progress-txt') as HTMLElement).textContent = `${p.computedProgress}%`;
  (document.getElementById('pd-progress-fill') as HTMLElement).style.width = `${p.computedProgress}%`;
  const companyLinkEl = document.getElementById('pd-company-link') as HTMLElement;
  companyLinkEl.innerHTML = p.companyName
    ? companyLink(p.companyId, p.companyName)
    : '<span class="rec-muted">Internal initiative</span>';

  const archiveBtn = document.getElementById('pd-archive-btn'); if (archiveBtn) archiveBtn.textContent = p.archived ? 'Unarchive' : 'Archive';

  renderMilestones();
  renderProjectTasks(p.id);
  void renderLinkedNotes(p.id);
  renderProjectMeetings(p.id);
  void renderProjectOrigin(p.id);
  void renderProjectActivity(p.id);
  void renderLinkedEmails('project', p.id, 'pd-emails');
  void renderLinkedFiles(p.id);
}

async function renderLinkedFiles(projectId: number): Promise<void> {
  const el = document.getElementById('pd-files');
  const cntEl = document.getElementById('pd-files-cnt');
  if (!el) return;
  const links = await getLinksFor('project', projectId);
  if (S.currentProjectId !== projectId) return;
  const msfileIds = links.filter((l) => l.fromType === 'msfile' && l.toType === 'project').map((l) => l.fromId);
  if (cntEl) cntEl.textContent = msfileIds.length ? String(msfileIds.length) : '';
  if (msfileIds.length === 0) {
    el.innerHTML = `<div class="feed-empty">No files linked yet. In Files, right-click an item and choose “Link to Project…”.</div>`;
    return;
  }
  const files = await filesGetByIds(msfileIds);
  el.innerHTML = `<div class="rec-list">${files.map((f) => `<div class="rec-row${f.exists ? '' : ' is-missing'}" onclick="switchTab('files');msFilesNavigateToPath('${escHtml(f.path).replace(/'/g, "\\'")}')">
    <span class="rec-row-icon">${icon(f.isFolder ? 'folder' : 'document', 15)}</span>
    <div class="rec-row-main"><div class="rec-row-title">${escHtml(f.name)}</div><div class="rec-row-sub">${escHtml(f.path)}</div></div>
    ${f.exists ? '' : '<span class="rec-badge tone-red">Unavailable</span>'}
  </div>`).join('')}</div>`;
}

// Notes linked via entity_links (note → project) — same shape as Opportunity's
// renderOpportunityNotes, previously bare title+date rows with no preview or
// way to add a note without leaving the page.
async function renderLinkedNotes(projectId: number): Promise<void> {
  const el = document.getElementById('pd-notes');
  if (!el) return;
  el.style.display = '';
  const links = await getLinksFor('project', projectId);
  if (S.currentProjectId !== projectId) return;
  const noteIds = links.filter((l) => l.fromType === 'note' && l.toType === 'project').map((l) => l.fromId);
  const notes = S.notes.filter((n) => noteIds.includes(n.id));
  el.innerHTML = `<div class="rec-section-hd"><h2>Notes</h2><span class="rec-count">${notes.length || ''}</span><div class="rec-section-actions"><button class="btn-sm" onclick="createNoteForProject()">+ New</button></div></div>` +
    (notes.length === 0
      ? `<div class="feed-empty">No notes yet.</div>`
      : `<div class="rec-list">${notes.map((n) => `<div class="rec-row" onclick="openRecord('note', ${n.id})">
          <span class="rec-row-icon">${icon('note', 15)}</span>
          <div class="rec-row-main"><div class="rec-row-title">${escHtml(n.title || 'Untitled')}</div></div>
          <span class="rec-row-date">${n.updatedAt ? fmtDate(n.updatedAt) : ''}</span>
        </div>`).join('')}</div>`);
}

export async function createNoteForProject(): Promise<void> {
  const p = S.projects.find((x) => x.id === S.currentProjectId);
  if (!p) return;
  const ctx = contextFromProject(S, p);
  const newNote: Note = {
    id: nextNoteId(), title: p.name, content: '', folder: '', clientName: ctx.companyName || '', companyId: ctx.companyId,
    tags: [], pinned: false, createdAt: today(), updatedAt: today(),
  };
  S.notes.unshift(newNote);
  persistNotes();
  await saveNotesNow();
  await setLinksFrom('note', newNote.id, [{ fromType: 'note', fromId: newNote.id, toType: 'project', toId: p.id }]);
  (window as any).openRecord('note', newNote.id);
}
expose('createNoteForProject', createNoteForProject);

// Meetings linked via a direct projectId FK (Meeting.projectId already
// existed — it just had no renderer anywhere). Mirrors Opportunity's
// renderOpportunityMeetings: synchronous, filters the already-loaded
// S.meetings client-side, no new backend call.
function renderProjectMeetings(projectId: number): void {
  const el = document.getElementById('pd-meetings');
  if (!el) return;
  const meetings = S.meetings.filter((m) => m.projectId === projectId);
  el.innerHTML = `<div class="rec-section-hd"><h2>Meetings</h2><span class="rec-count">${meetings.length || ''}</span><div class="rec-section-actions"><button class="btn-sm" onclick="createMeetingForProject()">+ New</button></div></div>` +
    (meetings.length === 0
      ? `<div class="feed-empty">No meetings yet.</div>`
      : `<div class="rec-list">${meetings.map((m) => `<div class="rec-row" onclick="openRecord('meeting', ${m.id})">
          <span class="rec-row-icon">${icon('meeting', 15)}</span>
          <div class="rec-row-main"><div class="rec-row-title">${escHtml(m.title)}</div></div>
          <span class="rec-row-date">${m.meetingDate ? fmtDate(m.meetingDate) : ''}</span>
        </div>`).join('')}</div>`);
}

// The engagement chain the project came from: opportunity → proposal →
// agreement, and the opportunity's contacts. Derived from ids already loaded
// (Opportunity.projectId / proposalId, Agreement.proposalId) plus one link
// lookup for the contacts.
async function renderProjectOrigin(projectId: number): Promise<void> {
  const el = document.getElementById('pd-origin');
  if (!el) return;
  const o = S.opportunities.find((x) => x.projectId === projectId);
  if (!o) { el.innerHTML = ''; el.style.display = 'none'; return; }
  const links = await getLinksFor('opportunity', o.id).catch(() => []);
  if (S.currentProjectId !== projectId) return;
  const { proposal, agreement, contacts } = projectChain(S, projectId, links);
  const row = (kind: 'opportunity' | 'proposal' | 'agreement', id: number, iconName: string, label: string, title: string, sub: string) => `<div class="rec-row" onclick="openRecord('${kind}', ${id})">
      <span class="rec-row-icon">${icon(iconName, 15)}</span>
      <div class="rec-row-main"><div class="rec-row-title">${recordLink(kind, id, title)}</div><div class="rec-row-sub">${escHtml([label, sub].filter(Boolean).join(' · '))}</div></div>
    </div>`;
  el.style.display = '';
  el.innerHTML = `<div class="rec-section-hd"><h2>Started from</h2></div>
    <div class="rec-list">
      ${row('opportunity', o.id, 'briefcase', 'Opportunity', o.name, o.stage)}
      ${proposal ? row('proposal', proposal.id, 'database', 'Proposal', `${proposal.type && proposal.type !== '—' ? proposal.type : 'Proposal'} · SL#${proposal.id}`, proposal.status || '') : ''}
      ${agreement ? row('agreement', agreement.id, 'document', 'Agreement', agreement.agrRef || `Agreement #${agreement.id}`, agreement.status || '') : ''}
    </div>
    ${contacts.length ? `<div class="rec-row-sub" style="margin-top:8px">Contacts: ${contacts.map((c) => recordLink('contact', c.id, c.name || c.email || 'Contact')).join(', ')}</div>` : ''}`;
}

async function renderProjectActivity(projectId: number): Promise<void> {
  const el = document.getElementById('pd-activity');
  if (!el) return;
  const entries = await getActivity({ entityType: 'project', entityId: projectId, limit: 100 }).catch(() => []);
  if (S.currentProjectId !== projectId) return;
  el.innerHTML = `<div class="rec-section-hd"><h2>Activity</h2></div><div class="feed">${renderFeed(entries.map(activityItem), { empty: 'No activity yet.' })}</div>`;
}

registerDragSource('milestone');
registerDropTarget('milestone-order', {
  accepts: ['milestone'],
  onDrop: ({ ids }, { beforeId }) => {
    if (S.currentProjectId == null) return;
    const ordered = [...S.currentProjectMilestones].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    reorder(ordered, ids, beforeId).forEach((m, i) => { m.sortOrder = i; });
    renderMilestones();
    void persistMilestones(S.currentProjectId, S.currentProjectMilestones);
  },
});

function renderMilestones(): void {
  const el = document.getElementById('pd-milestones'); if (!el) return;
  const cnt = document.getElementById('pd-milestone-cnt');
  const list = S.currentProjectMilestones;
  const done = list.filter((m) => m.status === 'Done').length;
  if (cnt) cnt.textContent = `${done}/${list.length}`;
  if (list.length === 0) { el.innerHTML = `<div class="feed-empty">No milestones yet — add the first one below.</div>`; return; }
  el.dataset.sort = 'milestone-order';
  el.innerHTML = [...list].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((m) => `<div class="milestone-row" data-drag-kind="milestone" data-drag-id="${m.id}">
    <div class="milestone-dot ${m.status === 'Done' ? 'done' : m.status === 'In Progress' ? 'in-progress' : ''}" onclick="cycleMilestoneStatus(${m.id})" title="Click to change status">${m.status === 'Done' ? '&#10003;' : ''}</div>
    <div class="milestone-name">${escHtml(m.name)}</div>
    ${m.targetDate ? `<div class="milestone-date">${fmtDate(m.targetDate)}</div>` : ''}
    <button class="btn-rmline" onclick="deleteMilestone(${m.id})" title="Remove">&times;</button>
  </div>`).join('');
}

function renderProjectTasks(projectId: number): void {
  const el = document.getElementById('pd-tasks'); if (!el) return;
  const cnt = document.getElementById('pd-task-cnt');
  const tasks = S.todos.filter((t) => t.projectId === projectId);
  if (cnt) cnt.textContent = `${tasks.filter((t) => t.status === 'Done').length}/${tasks.length}`;
  if (tasks.length === 0) { el.innerHTML = `<div class="feed-empty">No tasks in this project yet.</div>`; return; }
  const priOrder: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
  const sorted = [...tasks].sort((a, b) => {
    if ((a.status === 'Done') !== (b.status === 'Done')) return a.status === 'Done' ? 1 : -1;
    return (priOrder[a.priority || 'Medium'] ?? 1) - (priOrder[b.priority || 'Medium'] ?? 1);
  });
  el.innerHTML = `<div class="task-group">${sorted.filter((t) => t.parentId == null || !tasks.some((x) => x.id === t.parentId)).map((t) => taskRowHtml(t, { list: `project:${projectId}`, compact: true })).join('')}</div>`;
}

export function editCurrentProject(): void {
  if (S.currentProjectId != null) openProjectModal(S.currentProjectId);
}
expose('editCurrentProject', editCurrentProject);

let pdAutoSaveTimer: ReturnType<typeof setTimeout> | null = null;
function debouncePdSave(fn: () => void): void {
  if (pdAutoSaveTimer) clearTimeout(pdAutoSaveTimer);
  pdAutoSaveTimer = setTimeout(fn, 500);
}

// Status gets its own handler (rather than the generic autosave below)
// because save_project logs a status_changed activity entry server-side and
// the project list/board elsewhere reflect status — a full re-render keeps
// everything in sync, same reasoning as Opportunity's dedicated stage
// handler (changeCurrentOpportunityStage) versus its generic field autosave.
export async function changeCurrentProjectStatus(value: string): Promise<void> {
  const p = S.projects.find((x) => x.id === S.currentProjectId);
  if (!p) return;
  p.status = value;
  const saved = await persistProject(p);
  if (!saved) return;
  await loadProjects();
  if (S.currentProjectId === saved.id) await renderProjectDetail();
}
expose('changeCurrentProjectStatus', changeCurrentProjectStatus);

type ProjectInlineField = 'priority' | 'owner' | 'startDate' | 'targetDate';
export function autoSaveProjectField(field: ProjectInlineField, value: string): void {
  const p = S.projects.find((x) => x.id === S.currentProjectId);
  if (!p) return;
  if (field === 'owner') p.owner = value.trim() || null;
  else if (field === 'startDate' || field === 'targetDate') p[field] = value || null;
  else p.priority = value;
  debouncePdSave(() => { void persistProject(p); });
}
expose('autoSaveProjectField', autoSaveProjectField);

export async function toggleArchiveProject(): Promise<void> {
  const p = S.projects.find((x) => x.id === S.currentProjectId);
  if (!p) return;
  p.archived = !p.archived;
  const saved = await persistProject(p);
  if (!saved) { p.archived = !p.archived; return; }
  await loadProjects();
  if (p.archived) { closeProjectDetail(); renderProjects(); }
  else await renderProjectDetail();
}
expose('toggleArchiveProject', toggleArchiveProject);

// ═══════════════ Milestones ═══════════════

export async function addMilestone(e: Event): Promise<void> {
  e.preventDefault();
  if (S.currentProjectId == null) return;
  const f = e.target as HTMLFormElement;
  const name = (f.elements.namedItem('msName') as HTMLInputElement).value.trim();
  if (!name) return;
  const targetDate = (f.elements.namedItem('msDate') as HTMLInputElement).value || null;
  const draft: Milestone = {
    id: 0, projectId: S.currentProjectId, name, description: null, status: 'Not Started',
    targetDate, completionDate: null, sortOrder: S.currentProjectMilestones.length,
  };
  S.currentProjectMilestones = [...S.currentProjectMilestones, draft];
  await persistMilestones(S.currentProjectId, S.currentProjectMilestones);
  S.currentProjectMilestones = await getMilestones(S.currentProjectId);
  f.reset();
  renderMilestones();
}
expose('addMilestone', addMilestone);

export async function cycleMilestoneStatus(id: number): Promise<void> {
  if (S.currentProjectId == null) return;
  const order: Milestone['status'][] = ['Not Started', 'In Progress', 'Done'];
  const m = S.currentProjectMilestones.find((x) => x.id === id);
  if (!m) return;
  const idx = order.indexOf(m.status as Milestone['status']);
  m.status = order[(idx + 1) % order.length];
  m.completionDate = m.status === 'Done' ? today() : null;
  await persistMilestones(S.currentProjectId, S.currentProjectMilestones);
  S.currentProjectMilestones = await getMilestones(S.currentProjectId);
  renderMilestones();
  await loadProjects(); // milestone completion doesn't affect computedProgress (task-derived), but keep list view fresh
}
expose('cycleMilestoneStatus', cycleMilestoneStatus);

export async function deleteMilestone(id: number): Promise<void> {
  if (S.currentProjectId == null) return;
  if (!(await showConfirm('Remove this milestone?', { confirmLabel: 'Remove' }))) return;
  S.currentProjectMilestones = S.currentProjectMilestones.filter((m) => m.id !== id);
  await persistMilestones(S.currentProjectId, S.currentProjectMilestones);
  renderMilestones();
}
expose('deleteMilestone', deleteMilestone);

// ═══════════════ Create / edit modal ═══════════════

export function openProjectModal(id: number | null): void {
  S.projectEditId = id;
  const f = document.getElementById('project-form') as HTMLFormElement;
  f.reset();
  const companyInput = f.elements.namedItem('pjCompany') as HTMLInputElement | null;
  if (companyInput) attachCompanySelector(companyInput);

  if (id !== null) {
    const p = S.projects.find((x) => x.id === id);
    if (!p) return;
    (document.getElementById('proj-modal-title') as HTMLElement).textContent = 'Edit project';
    (document.getElementById('proj-submit-btn') as HTMLElement).textContent = 'Save changes';
    (f.elements.namedItem('pjName') as HTMLInputElement).value = p.name;
    (f.elements.namedItem('pjType') as HTMLSelectElement).value = p.type;
    (f.elements.namedItem('pjCompany') as HTMLInputElement).value = p.companyName || '';
    (f.elements.namedItem('pjStatus') as HTMLSelectElement).value = p.status;
    (f.elements.namedItem('pjPriority') as HTMLSelectElement).value = p.priority;
    (f.elements.namedItem('pjOwner') as HTMLInputElement).value = p.owner || '';
    (f.elements.namedItem('pjStart') as HTMLInputElement).value = p.startDate || '';
    (f.elements.namedItem('pjTarget') as HTMLInputElement).value = p.targetDate || '';
    (f.elements.namedItem('pjTags') as HTMLInputElement).value = (p.tags || []).join(', ');
    (f.elements.namedItem('pjDesc') as HTMLTextAreaElement).value = p.description || '';
    toggleProjectCompanyField(p.type);
  } else {
    (document.getElementById('proj-modal-title') as HTMLElement).textContent = 'New project';
    (document.getElementById('proj-submit-btn') as HTMLElement).textContent = 'Create project';
    toggleProjectCompanyField('internal');
    (f.elements.namedItem('pjOwner') as HTMLInputElement).value = currentUser()?.name || '';
  }
  document.getElementById('modal-project')?.classList.add('open');
}
expose('openProjectModal', openProjectModal);

export function closeProjectModal(): void {
  document.getElementById('modal-project')?.classList.remove('open');
}
expose('closeProjectModal', closeProjectModal);

export function toggleProjectCompanyField(type: string): void {
  const input = document.querySelector('#project-form [name=pjCompany]') as HTMLInputElement | null;
  if (!input) return;
  if (type === 'internal') { input.value = ''; input.disabled = true; input.placeholder = 'Not applicable — internal project'; }
  else { input.disabled = false; input.placeholder = 'Client company (optional)...'; }
}
expose('toggleProjectCompanyField', toggleProjectCompanyField);

export async function submitProject(e: Event): Promise<void> {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  const type = (f.elements.namedItem('pjType') as HTMLSelectElement).value as Project['type'];
  const name = (f.elements.namedItem('pjName') as HTMLInputElement).value.trim();
  if (!name) return;
  const tagsRaw = (f.elements.namedItem('pjTags') as HTMLInputElement).value;
  const existing = S.projectEditId != null ? S.projects.find((x) => x.id === S.projectEditId) : null;

  const draft: Project = {
    id: existing?.id ?? 0,
    name,
    type,
    status: (f.elements.namedItem('pjStatus') as HTMLSelectElement).value,
    priority: (f.elements.namedItem('pjPriority') as HTMLSelectElement).value,
    owner: (f.elements.namedItem('pjOwner') as HTMLInputElement).value.trim() || null,
    description: (f.elements.namedItem('pjDesc') as HTMLTextAreaElement).value.trim() || null,
    // A project started from an opportunity keeps that opportunity's company
    // (by id) while the field still shows its name.
    ...(() => {
      if (type !== 'client') return { companyName: null, companyId: null };
      const typed = (f.elements.namedItem('pjCompany') as HTMLInputElement).value;
      const pendingOpp = !existing && S.opportunityLinkPending != null && S.opportunityLinkPendingKind === 'project' ? S.opportunities.find((o) => o.id === S.opportunityLinkPending) : undefined;
      const known = existing ? { companyId: existing.companyId ?? null, companyName: existing.companyName } : pendingOpp ? contextFromOpportunity(S, pendingOpp) : null;
      return companyFromForm(known, typed);
    })(),
    areaId: existing?.areaId ?? null,
    startDate: (f.elements.namedItem('pjStart') as HTMLInputElement).value || null,
    targetDate: (f.elements.namedItem('pjTarget') as HTMLInputElement).value || null,
    completionDate: existing?.completionDate ?? null,
    progressOverride: existing?.progressOverride ?? null,
    tags: tagsRaw.split(',').map((t) => t.trim()).filter(Boolean),
    archived: existing?.archived ?? false,
    createdAt: existing?.createdAt ?? null,
    updatedAt: null,
    taskCount: existing?.taskCount ?? 0,
    taskDoneCount: existing?.taskDoneCount ?? 0,
    computedProgress: existing?.computedProgress ?? 0,
  };

  const saved = await persistProject(draft);
  if (!saved) return;
  await loadProjects();
  closeProjectModal();

  if (S.opportunityLinkPending != null && S.opportunityLinkPendingKind === 'project') {
    const oppId = S.opportunityLinkPending;
    S.opportunityLinkPending = null;
    S.opportunityLinkPendingKind = null;
    const opp = S.opportunities.find((o) => o.id === oppId);
    if (opp) {
      opp.projectId = saved.id;
      const updated = await persistOpportunity(opp);
      if (updated) {
        const idx = S.opportunities.findIndex((o) => o.id === updated.id);
        if (idx > -1) S.opportunities[idx] = updated;
      }
    }
    renderProjects();
    refreshAll();
    (window as any).openRecord('opportunity', oppId);
    return;
  }

  if (S.currentProjectId === saved.id) await renderProjectDetail();
  renderProjects();
  refreshAll();
}
expose('submitProject', submitProject);

// ── Companies tab integration: projects linked to a company

export function renderCoProjectsSection(d: { name: string; companyId: number | null }): void {
  const ref = { id: d.companyId, name: d.name };
  const companyProjects = S.projects.filter((p) => inCompany(ref, p.companyId, p.companyName) && !p.archived);
  const container = document.getElementById('cosub-projects-inner');
  if (!container) return;
  const cnt = document.getElementById('co-projects-tab-count');
  if (cnt) cnt.textContent = companyProjects.length ? String(companyProjects.length) : '';
  if (companyProjects.length === 0) {
    container.innerHTML = emptyState({ icon: 'target', title: `No projects for ${d.name} yet`, compact: true, action: { label: 'New project', onclick: 'createProjectForCurrentCompany()' } });
    renderIcons(container);
    return;
  }
  container.innerHTML = `<div class="project-grid">${companyProjects.map(projectCard).join('')}</div>`;
}
expose('renderCoProjectsSection', renderCoProjectsSection);


export function createProjectForCurrentCompany(): void {
  if (!S.currentCompany) return;
  const companyName = S.currentCompany;
  openProjectModal(null);
  setTimeout(() => {
    const typeEl = document.querySelector('#project-form [name=pjType]') as HTMLSelectElement;
    typeEl.value = 'client';
    toggleProjectCompanyField('client');
    (document.querySelector('#project-form [name=pjCompany]') as HTMLInputElement).value = companyName;
  }, 0);
}
expose('createProjectForCurrentCompany', createProjectForCurrentCompany);

// ── Duplicate ─────────────────────────────────────────────────

/** A new project with the same setup and milestones, not started. */
export async function duplicateProject(id: number): Promise<void> {
  const p = S.projects.find((x) => x.id === id);
  if (!p) return;
  const milestones = await getMilestones(id).catch(() => [] as Milestone[]);
  const saved = await persistProject({
    ...p, id: 0, name: `${p.name} (copy)`, status: 'Not Started', completionDate: null, progressOverride: null, archived: false,
    createdAt: null, updatedAt: null, tags: [...(p.tags || [])], taskCount: 0, taskDoneCount: 0, computedProgress: 0,
  });
  if (!saved) return;
  if (milestones.length) {
    await persistMilestones(saved.id, milestones.map((m, i) => ({ ...m, id: 0, projectId: saved.id, status: 'Not Started', completionDate: null, sortOrder: m.sortOrder ?? i })));
  }
  await loadProjects();
  (window as any).openRecord('project', saved.id);
}
expose('duplicateProject', duplicateProject);

export function projectMoreMenu(e: MouseEvent): void {
  const id = S.currentProjectId;
  if (id == null) return;
  const p = S.projects.find((x) => x.id === id);
  showContextMenu(e, [
    { label: 'Duplicate with milestones', iconName: 'copy', run: () => { void duplicateProject(id); } },
    { label: p?.archived ? 'Unarchive' : 'Archive', iconName: 'archive', run: () => { void toggleArchiveProject(); } },
  ]);
}
expose('projectMoreMenu', projectMoreMenu);

/** Names offered in owner fields. */
export function fillTeamNames(): void {
  const list = document.getElementById('team-names');
  if (list) list.innerHTML = S.team.filter((t) => t.active).map((t) => `<option value="${escHtml(t.name)}">`).join('');
}
expose('fillTeamNames', fillTeamNames);
