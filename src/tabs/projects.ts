import { arrive, settleNew } from '../lib/motion';
import { paintFigures } from '../lib/recordFigures';
import { projectHeaderFigures, tasksByMilestone, trackNotes, type TaskGroup } from '../lib/recordProject';
import { meetingRowHtml, orderMeetingRows } from '../core/meetingRow';
import { initialsOf } from '../lib/appearance';
import { personAvatar } from '../core/contacts';
import { S } from '../lib/state';
import { emptyState, undoToast } from '../lib/ui';
import { recordLink } from '../lib/links';
import { renderRecordTimeline, renderThreadStrip } from './recordThread';
import { collapseEmptySections } from '../lib/sectionLayout';
import { mountPropsList, propsEditButton, propsListHtml, type PropField } from '../lib/propsList';
import { renderIcons } from '../core/chrome';
import { registerDragSource, registerDropTarget, reorder } from '../lib/dnd';
import { loadInto } from '../lib/ui';
import { companyLink } from '../lib/links';
import { fmtDate, escHtml, expose, statusDot, showConfirm, nextNoteId, today, inCompany, strColor } from '../lib/utils';
import { registerTabRenderer, registerProjectViewRefresher, refreshAll, notifyNavigated } from '../lib/registry';
import { createListNav } from '../lib/listNav';
import { getProjects, getMilestones, getLinksFor, setLinksFrom, filesGetByIds } from '../lib/db';
import { persistProject, persistMilestones, persistOpportunity, persistNotes, saveNotesNow } from '../lib/persist';
import { companyFromForm, contextFromOpportunity, contextFromProject, projectChain } from '../lib/workGraph';
import { getAllCompanies } from './companies';
import { taskRowHtml, createTodoForCurrentProject } from './todo';
import { renderLinkedEmails } from '../core/emailLinks';
import { icon } from '../lib/icons';
import { recordHeaderHtml } from '../lib/recordHeader';
import { showContextMenu, showMenuAt, menuHead } from '../lib/contextMenu';
import { projectNextStep } from '../lib/recordSteps';
import { newForRecordItems } from '../core/contextActions';
import { attachCompanySelector } from '../lib/companySelector';
import type { Project, Milestone, Note, Todo } from '../lib/types';
import { statusTone, toneVar } from '../lib/statusTone';
import { renderCommitmentSection } from './commitments';
import { currentUser, matchesOwnerFilter, ownerFilterOptions, isAgreementActive } from '../lib/commercial';
import { plural, tileHtml } from '../lib/pageKit';
import { nextMilestoneKey, projectFigures as trackFigures, projectTrack, ringDash, ringProgress } from '../lib/pagesProjects';
import { fmtDateShort } from '../lib/dates';

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
  // The list draws each project's milestone track (1.59 pages).
  const live = S.projects.filter((p) => !p.archived);
  const lists = await Promise.all(live.map((p) => getMilestones(p.id).catch(() => [] as Milestone[])));
  milestonesByProject.clear();
  live.forEach((p, i) => milestonesByProject.set(p.id, lists[i]));
}

/** Each project's milestones, for the list's tracks; refreshed on load and when a project page closes. */
const milestonesByProject = new Map<number, Milestone[]>();

async function renderProjectsTab(): Promise<void> {
  if (!(await loadInto(document.getElementById('proj-grid'), 'projects', 'renderTab(\'projects\')', loadProjects, 'cards'))) return;
  renderProjects();
  if (S.currentProjectId != null) await renderProjectDetail();
}
registerTabRenderer('projects', () => { void renderProjectsTab(); });

createListNav<number>({
  tabId: 'projects',
  getItems: () => [...document.querySelectorAll<HTMLElement>('#proj-grid .pj-row[data-project-id]')].map((el) => Number(el.dataset.projectId)),
  getEl: (id) => document.querySelector<HTMLElement>(`#proj-grid .pj-row[data-project-id="${id}"]`),
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
  const sortBy = (document.getElementById('proj-sort') as HTMLSelectElement | null)?.value || 'milestone';
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
  const ms = (p: Project) => milestonesByProject.get(p.id) || [];
  if (sortBy === 'priority') data.sort((a, b) => (priOrder[a.priority] ?? 1) - (priOrder[b.priority] ?? 1));
  else if (sortBy === 'target') data.sort((a, b) => (a.targetDate || '9999').localeCompare(b.targetDate || '9999'));
  else if (sortBy === 'progress') data.sort((a, b) => b.computedProgress - a.computedProgress);
  else if (sortBy === 'status') data.sort((a, b) => a.status.localeCompare(b.status));
  else if (sortBy === 'updated') data.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  else data.sort((a, b) => nextMilestoneKey(a, ms(a)).localeCompare(nextMilestoneKey(b, ms(b))) || a.name.localeCompare(b.name));

  // Counts on the switch: live projects of each kind.
  const live = S.projects.filter((p) => !p.archived);
  const counts = [live.length, live.filter((p) => p.type === 'client').length, live.filter((p) => p.type === 'internal').length];
  document.querySelectorAll('#proj-type-seg button span').forEach((el, i) => { el.textContent = String(counts[i] ?? ''); });

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

const PROJECT_STAGE_TONE: Record<string, string> = { 'In Progress': 'blue', 'At Risk': 'red', 'On Hold': 'amber', Completed: 'green' };

/** A client project's services: what its company has under an active agreement. */
function projectServices(p: Project): string[] {
  if (p.type !== 'client' || !p.companyName) return [];
  const ref = { id: p.companyId ?? null, name: p.companyName };
  const t = today();
  return [...new Set(S.agreements.filter((a) => inCompany(ref, a.companyId, a.client) && isAgreementActive(a, t)).flatMap((a) => (a.lines?.length ? a.lines.map((l) => l.serviceName) : [a.type || ''])).filter(Boolean))];
}

/** How wide a milestone's label may be, as a share of the track: the distance to its nearest neighbour, so two
 * labels never overlap however close their dates. */
function labelRoom(pos: number[], i: number): number {
  const near = Math.min(i > 0 ? pos[i] - pos[i - 1] : Infinity, i < pos.length - 1 ? pos[i + 1] - pos[i] : Infinity);
  return Number.isFinite(near) ? Math.max(4, Math.round((near - 1) * 10) / 10) : 40;
}

/** A project as a card with its milestone track (1.59 pages): the list's unit. */
function projectCard(p: Project): string {
  const list = milestonesByProject.get(p.id) || [];
  const t = today();
  const f = trackFigures(p, list, t);
  const track = projectTrack(p, list, t);
  const internal = p.type !== 'client';
  const tile = internal ? '<span class="pk-tile lg is-internal" aria-hidden="true">MB</span>' : tileHtml(p.companyName || p.name, 'pk-tile lg');
  const services = projectServices(p);
  const sub = [internal ? 'Internal' : 'Client', services.slice(0, 3).join(', ')].filter(Boolean).map(escHtml).join(' · ');
  const days = f.daysToTarget;
  const ring = ringProgress(p, f);
  const figs = `${f.total ? `<div class="pk-fig"><b>${f.done} of ${f.total}</b><span>milestones</span></div>` : ''}${days != null ? `<div class="pk-fig${days < 0 ? ' t-red' : ''}"><b>${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'}</b><span>${days < 0 ? 'past' : 'to'} ${escHtml(f.targetLabel)}</span></div>` : ''}
    <svg class="pk-ring" viewBox="0 0 36 36" role="img" aria-label="${ring.pct}% ${ring.of === 'milestones' ? 'of milestones done' : ring.of === 'tasks' ? 'of tasks done' : 'done'}"><circle cx="18" cy="18" r="15" fill="none" class="pk-ring-bg" stroke-width="4"/>${ring.pct > 0 ? `<circle cx="18" cy="18" r="15" fill="none" class="pk-ring-fg" stroke-width="4" stroke-dasharray="${ringDash(ring.pct)}" transform="rotate(-90 18 18)" stroke-linecap="round"/>` : ''}<text x="18" y="21.5" text-anchor="middle">${ring.pct}%</text></svg>`;
  const trackHtml = track.points.length
    ? `<div class="pk-track"><div class="pk-track-line"></div><div class="pk-track-done" style="width:${track.done}%"></div>${track.today != null ? `<div class="pk-track-today" style="left:${track.today}%"><span>today</span></div>` : ''}
        ${track.points.map((x, i) => `<div class="pk-ms is-${x.state}" style="left:${x.pos}%;--w:${labelRoom(track.points.map((y) => y.pos), i)}%"><i></i><b title="${escHtml(x.name)}">${escHtml(x.name)}</b><span>${escHtml(x.dateLabel)}</span></div>`).join('')}</div>`
    : '';
  const open = p.taskCount - p.taskDoneCount;
  const late = f.next?.days != null && f.next.days < 0;
  // The footer folded into the track's row (1.64): the next milestone and the tasks at the left, Open project at the right.
  const next = f.next
    ? `<div class="pk-proj-nx is-next${late ? ' t-red' : ''}"><span>Next <b>${escHtml(f.next.name)}</b></span>${f.next.days != null ? `<em>· ${late ? `${plural(-f.next.days, 'day')} late` : f.next.days === 0 ? 'today' : plural(f.next.days, 'day')}</em>` : ''}</div>`
    : track.points.length ? '<div class="pk-proj-nx">All milestones done</div>'
    : `<div class="pk-proj-nx">No milestones yet · <button class="rlink" onclick="event.stopPropagation();openRecord('project', ${p.id})">Add milestone</button></div>`;
  const tasks = p.taskCount ? `<div class="pk-proj-nx">${plural(open, 'task')} open</div>` : `<div class="pk-proj-nx">No tasks yet · <button class="rlink" onclick="event.stopPropagation();projectAddTask(${p.id})">Add the first task</button></div>`;
  return `<article class="pk-proj pj-row${internal ? ' is-internal' : ''}" data-project-id="${p.id}" tabindex="0" onclick="if(!event.target.closest('a,button'))openRecord('project', ${p.id})" onkeydown="if(event.key==='Enter'&&event.target===this)this.click()" oncontextmenu="projectContextMenu(event,${p.id})">
    <div class="pk-proj-hd">${tile}<h3>${escHtml(p.name)}</h3><span class="pk-stage t-${PROJECT_STAGE_TONE[p.status] || 'grey'}"><i></i>${escHtml(p.status)}</span>${sub ? `<span class="pk-proj-s">${sub}</span>` : ''}<div class="pk-figs">${figs}</div></div>
    <div class="pk-proj-row${track.points.length ? '' : ' no-track'}"><div class="pk-proj-next">${next}${tasks}</div>${trackHtml}<button class="rlink pk-proj-open" onclick="event.stopPropagation();openRecord('project', ${p.id})">Open project</button></div>
  </article>`;
}

/** "Add the first task": the project, with a new task started. */
export function projectAddTask(id: number): void {
  (window as any).switchTab('projects');
  void openProjectDetail(id).then(() => createTodoForCurrentProject());
}
expose('projectAddTask', projectAddTask);

export function projectContextMenu(e: MouseEvent, id: number): void {
  const p = S.projects.find((x) => x.id === id);
  if (!p) return;
  showContextMenu(e, [
    menuHead(p.name, ['Project', (p.status || '').toLowerCase(), p.companyName].filter(Boolean).join(' · '), p.companyName ? { name: p.companyName } : { icon: 'target' }),
    { label: 'Open', iconName: 'target', shortcut: '↵', run: () => (window as any).openRecord('project', id) },
    { label: 'Edit', iconName: 'edit', run: () => openProjectModal(id) },
    { label: 'Create Task', iconName: 'plus', run: () => { (window as any).switchTab('projects'); void openProjectDetail(id).then(() => createTodoForCurrentProject()); } },
    { label: p.archived ? 'Unarchive' : 'Archive', iconName: 'archive', run: () => { S.currentProjectId = id; void toggleArchiveProject(); } },
  ]);
}
expose('projectContextMenu', projectContextMenu);

/** A project as a row (owner, 30-Sep-2026: rows, not cards) — name, client or
 * internal with the status, progress, target date. Also on company pages. */
function projectRow(p: Project): string {
  const sc = STATUS_COLOR[p.status] || STATUS_COLOR['Not Started'];
  // Rows are also shown on company pages: open through the router so the Projects module comes forward.
  return `<div class="rec-row pj-row" data-project-id="${p.id}" onclick="openRecord('project', ${p.id})" oncontextmenu="projectContextMenu(event,${p.id})">
    <div class="rec-row-main">
      <div class="rec-row-title">${escHtml(p.name)}</div>
      <div class="rec-row-sub">${p.companyName ? companyLink(p.companyId, p.companyName) : 'Internal'}<span class="pq-sep">·</span>${statusDot(sc, p.status)}</div>
    </div>
    <div class="pj-row-progress" title="${p.taskDoneCount}/${p.taskCount} tasks done"><div class="project-progress-track"><div class="project-progress-fill" style="width:${p.computedProgress}%"></div></div><span>${p.computedProgress}%</span></div>
    <span class="pj-row-date">${p.targetDate ? `Target ${escHtml(fmtDate(p.targetDate))}` : ''}</span>
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
  // The list's track for this project follows what was just edited on its page.
  if (S.currentProjectId != null) milestonesByProject.set(S.currentProjectId, [...S.currentProjectMilestones]);
  S.currentProjectId = null;
  S.currentProjectMilestones = [];
  renderProjects();
  document.getElementById('proj-detail')?.classList.remove('open');
  document.getElementById('proj-list-view')?.classList.remove('hidden');
  notifyNavigated();
}
expose('closeProjectDetail', closeProjectDetail);

async function renderProjectDetail(): Promise<void> {
  if (S.currentProjectId == null) return;
  const p = S.projects.find((x) => x.id === S.currentProjectId);
  if (!p) { closeProjectDetail(); return; }
  const internal = p.type !== 'client';

  const avatar = document.getElementById('pd-avatar');
  if (avatar) {
    avatar.textContent = internal ? 'MB' : initialsOf(p.companyName || p.name) || '?';
    avatar.style.background = internal ? 'var(--tile-3)' : strColor(p.companyName || p.name);
  }
  (document.getElementById('pd-eyebrow') as HTMLElement).textContent = `Project · ${internal ? 'internal' : 'client'}`;
  (document.getElementById('pd-name') as HTMLElement).textContent = p.name;
  (document.getElementById('pd-desc') as HTMLElement).textContent = p.description || '';
  const facts = [projectServices(p).slice(0, 3).join(', '), p.startDate ? `${p.startDate <= today() ? 'started' : 'starts'} ${fmtDateShort(p.startDate, true)}` : '', p.targetDate ? `target ${fmtDateShort(p.targetDate, true)}` : ''].filter(Boolean).join(' · ');
  (document.getElementById('pd-badges') as HTMLElement).innerHTML = [
    !internal && p.companyName ? `<span class="pk-mini-co">${tileHtml(p.companyName, 'pk-tile mini')}${companyLink(p.companyId, p.companyName)}</span>` : '',
    `<span class="pk-stage t-${PROJECT_STAGE_TONE[p.status] || 'grey'}"><i></i>${escHtml(p.status)}</span>`,
    p.archived ? '<span class="pk-chip t-grey">Archived</span>' : '',
    facts ? `<span class="rec-meta">${escHtml(facts)}</span>` : '',
  ].filter(Boolean).join('');
  renderProjectProps(p);
  fillTeamNames();

  renderThreadStrip('pd-thread', { kind: 'project', id: p.id });
  renderMilestones();
  renderProjectMeetings(p.id);
  renderCommitmentSection('pd-commitments', { projectId: p.id }, contextFromProject(S, p));
  void renderLinkedEmails('project', p.id, 'pd-emails');
  await Promise.all([renderLinkedNotes(p.id), renderProjectOrigin(p.id), renderProjectActivity(p.id), renderLinkedFiles(p.id)]);
  if (S.currentProjectId === p.id) layoutProjectSections();
}

/** The project's top-level tasks under their milestones (lib/recordProject.ts). */
function projectTaskGroups(projectId: number): TaskGroup<Todo>[] {
  return tasksByMilestone(S.todos.filter((t) => t.projectId === projectId), S.currentProjectId === projectId ? S.currentProjectMilestones : []);
}

/** What follows the milestones and the tasks: the header's figures and ring, and the full-width track. */
function renderProjectStory(p: Project): void {
  const t = today();
  const list = S.currentProjectId === p.id ? S.currentProjectMilestones : [];
  paintFigures('pd-figures', projectHeaderFigures(p, list, t));
  const el = document.getElementById('pd-track');
  if (!el) return;
  const track = projectTrack(p, list, t);
  const closed = p.status === 'Completed' || p.status === 'Cancelled';
  el.classList.toggle('is-empty', !track.points.length);
  if (!track.points.length) {
    // No milestones: the track's place asks for the first one.
    el.innerHTML = closed ? '' : `<div class="rk-ptrack-none"><div><b>No milestones yet</b><span>Add the first one and the track appears here: what is done, what is next, and where today falls.</span></div>
      <form class="milestone-add-row" onsubmit="addMilestone(event)"><input class="td-input" name="msName" placeholder="First milestone…" aria-label="First milestone" required><input class="td-input" type="date" name="msDate" aria-label="Its date"><button type="submit" class="btn-secondary btn-sm">Add milestone</button></form></div>`;
    el.hidden = closed;
    return;
  }
  el.hidden = false;
  const notes = trackNotes(list, projectTaskGroups(p.id), t);
  // On a narrow window a milestone close to the one before it carries its label above the line.
  let alt = false;
  const points = track.points.map((x, i) => { const near = i > 0 && x.pos - track.points[i - 1].pos < 13; alt = near && !alt; return { ...x, alt }; });
  el.innerHTML = `<div class="rk-ptrack${points.some((x) => x.alt) ? ' has-alt' : ''}"><div class="rk-pt-line"></div><div class="rk-pt-done" style="width:${track.done}%"></div>${track.today != null ? `<div class="rk-pt-today" style="left:${track.today}%"><span>today</span></div>` : ''}
    ${points.map((x) => { const n = notes.get(x.id); return `<div class="rk-pm is-${x.state}${x.alt ? ' is-alt' : ''}" style="left:${x.pos}%"><i></i><b>${escHtml(x.name)}</b><span>${escHtml(x.dateLabel)}</span>${n ? `<em${n.tone ? ` class="t-${n.tone}"` : ''}>${escHtml(n.text)}</em>` : ''}</div>`; }).join('')}</div>`;
}

/** Tasks and meetings stay first, then the timeline; below it the sections
 * with content, then the empty ones, collapsed. */
function layoutProjectSections(): void {
  const host = document.getElementById('pd-main');
  if (!host) return;
  const el = (id: string) => document.getElementById(id);
  const inner = (id: string) => !!el(id)?.querySelector(':scope > .feed-empty');
  const sections = ['pd-milestones-sec', 'pd-commitments', 'pd-notes', 'pd-emails']
    .map((id) => el(id)).filter((x): x is HTMLElement => !!x && !x.hidden);
  collapseEmptySections(host, sections.map((x) => ({
    el: x,
    empty: x.id === 'pd-milestones-sec' ? inner('pd-milestones') : !!x.querySelector(':scope > .feed-empty'),
  })));
}

const PROJECT_STATUSES = ['Idea', 'Planning', 'Not Started', 'In Progress', 'At Risk', 'On Hold', 'Completed', 'Cancelled'];

/** Details, read first (lib/propsList.ts). */
function renderProjectProps(p: Project): void {
  const el = document.getElementById('pd-props');
  if (!el) return;
  const sel = (id: string, options: string[], value: string, onchange: string) => () =>
    `<select id="${id}" class="td-select" onchange="${onchange}">${options.map((o) => `<option${o === value ? ' selected' : ''}>${escHtml(o)}</option>`).join('')}</select>`;
  const inp = (id: string, attrs: string, value: string, onchange: string) => () =>
    `<input id="${id}" class="td-input" ${attrs} value="${escHtml(value)}" onchange="${onchange}" onkeydown="if(event.key==='Enter')this.blur()">`;
  const fields: PropField[] = [
    { key: 'status', label: 'Status', display: escHtml(p.status), always: true, control: sel('pd-status-sel', PROJECT_STATUSES, p.status, 'changeCurrentProjectStatus(this.value)') },
    { key: 'priority', label: 'Priority', display: escHtml(p.priority), control: sel('pd-priority-sel', ['High', 'Medium', 'Low'], p.priority, "autoSaveProjectField('priority',this.value)") },
    { key: 'owner', label: 'Owner', display: p.owner ? escHtml(p.owner) : '', always: true, control: inp('pd-owner-inp', 'placeholder="Add owner" list="team-names"', p.owner || '', "autoSaveProjectField('owner',this.value)") },
    { key: 'company', label: 'Company', display: p.companyName ? companyLink(p.companyId, p.companyName) : '<span class="rec-muted">Internal initiative</span>' },
    { key: 'start', label: 'Start', display: p.startDate ? escHtml(fmtDate(p.startDate)) : '', control: inp('pd-start-inp', 'type="date"', p.startDate || '', "autoSaveProjectField('startDate',this.value)") },
    { key: 'target', label: 'Target', display: p.targetDate ? escHtml(fmtDate(p.targetDate)) : '', control: inp('pd-target-inp', 'type="date"', p.targetDate || '', "autoSaveProjectField('targetDate',this.value)") },
  ];
  el.innerHTML = propsListHtml('pd-props', fields, () => { const cur = S.projects.find((x) => x.id === S.currentProjectId); if (cur) renderProjectProps(cur); });
  const act = document.getElementById('pd-props-act'); if (act) act.innerHTML = propsEditButton('pd-props');
  mountPropsList('pd-props');
}

async function renderLinkedFiles(projectId: number): Promise<void> {
  const el = document.getElementById('pd-files');
  const cntEl = document.getElementById('pd-files-cnt');
  if (!el) return;
  const links = await getLinksFor('project', projectId);
  if (S.currentProjectId !== projectId) return;
  arrive(el);
  const msfileIds = links.filter((l) => l.fromType === 'msfile' && l.toType === 'project').map((l) => l.fromId);
  if (cntEl) cntEl.textContent = msfileIds.length ? String(msfileIds.length) : '';
  if (msfileIds.length === 0) {
    el.innerHTML = `<div class="feed-empty">No files linked yet. In Files, right-click an item and choose “Link to Project…”.</div>`;
    return;
  }
  const files = await filesGetByIds(msfileIds);
  if (S.currentProjectId !== projectId) return;
  el.innerHTML = files.map((f) => {
    const sheet = /\.(xlsx?|csv|numbers)$/i.test(f.name);
    return `<div class="rk-person${f.exists ? '' : ' is-missing'}" role="button" tabindex="0" onkeydown="if(event.key==='Enter')this.click()" onclick="switchTab('files');msFilesNavigateToPath('${escHtml(f.path).replace(/'/g, "\\'")}')">
    <span class="rk-k sm t-${f.isFolder ? 'amber' : sheet ? 'green' : 'blue'}" aria-hidden="true">${icon(f.isFolder ? 'folder' : 'document', 13)}</span>
    <div class="rk-row-main"><div class="rk-row-t">${escHtml(f.name)}</div><div class="rk-row-s${f.exists ? '' : ' is-late'}">${f.exists ? (f.modifiedAt ? escHtml(fmtDateShort(f.modifiedAt.slice(0, 10), true)) : f.isFolder ? 'Folder' : 'File') : 'Unavailable'}</div></div>
  </div>`;
  }).join('');
}

// Notes linked via entity_links (note → project) — same shape as Opportunity's
// renderOpportunityNotes, previously bare title+date rows with no preview or
// way to add a note without leaving the page.
async function renderLinkedNotes(projectId: number): Promise<void> {
  const el = document.getElementById('pd-notes');
  if (!el) return;
  const links = await getLinksFor('project', projectId);
  if (S.currentProjectId !== projectId) return;
  const noteIds = links.filter((l) => l.fromType === 'note' && l.toType === 'project').map((l) => l.fromId);
  const notes = S.notes.filter((n) => noteIds.includes(n.id));
  el.innerHTML = `<div class="rec-section-hd"><h2>Notes</h2><span class="rec-count">${notes.length || ''}</span><div class="rec-section-actions"><button class="rlink" onclick="createNoteForProject()">Add</button></div></div>` +
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
  const meetings = orderMeetingRows(S.meetings.filter((m) => m.projectId === projectId));
  el.innerHTML = `<div class="rk-sh"><h2 class="hd-major">Meetings</h2><span class="rk-cnt">${meetings.length || ''}</span><a href="#" class="rlink rk-sh-r" onclick="event.preventDefault();createMeetingForProject()">New meeting</a></div>` +
    (meetings.length === 0 ? '<p class="co-nr-none">No meetings yet.</p>' : meetings.slice(0, 8).map((m) => meetingRowHtml(m, { second: 'people' })).join(''));
}

// The client contacts on the opportunity the project came from (the chain
// itself — opportunity, proposal, agreement — is in the thread strip).
async function renderProjectOrigin(projectId: number): Promise<void> {
  const el = document.getElementById('pd-origin');
  if (!el) return;
  const o = S.opportunities.find((x) => x.projectId === projectId);
  if (!o) { el.innerHTML = ''; el.hidden = true; return; }
  const links = await getLinksFor('opportunity', o.id).catch(() => []);
  if (S.currentProjectId !== projectId) return;
  const { contacts } = projectChain(S, projectId, links);
  el.hidden = contacts.length === 0;
  el.innerHTML = `<div class="rec-section-hd"><h2 class="rk-panel-h">Client contacts</h2><span class="rec-count">${contacts.length || ''}</span></div>
    ${contacts.map((c) => `<div class="rk-person" onclick="openRecord('contact', ${c.id})" role="button" tabindex="0" onkeydown="if(event.key==='Enter')this.click()">${personAvatar(c.name || c.email || '', 'pk-pav sm')}
      <div class="rk-row-main"><div class="rk-row-t">${escHtml(c.name || c.email || 'Contact')}</div><div class="rk-row-s">${escHtml(c.role || c.email || '')}</div></div>
    </div>`).join('')}`;
}

async function renderProjectActivity(projectId: number): Promise<void> {
  const el = document.getElementById('pd-activity');
  if (!el) return;
  await renderRecordTimeline({ elId: 'pd-activity', record: { kind: 'project', id: projectId }, scopeToggle: true,
    header: '<button class="rlink" onclick="createNoteForProject()">Add note</button>',
    milestones: () => S.currentProjectId === projectId ? S.currentProjectMilestones : [] });
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
    return ids[0];
  },
});

/** ⌥↑ / ⌥↓ on a focused milestone moves it (the keyboard way to reorder). */
export function milestoneKey(e: KeyboardEvent, id: number): void {
  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || S.currentProjectId == null) return;
  e.preventDefault();
  const ordered = [...S.currentProjectMilestones].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const at = ordered.findIndex((m) => m.id === id);
  const to = at + (e.key === 'ArrowDown' ? 1 : -1);
  if (at < 0 || to < 0 || to >= ordered.length) return;
  [ordered[at], ordered[to]] = [ordered[to], ordered[at]];
  ordered.forEach((m, i) => { m.sortOrder = i; });
  renderMilestones();
  void persistMilestones(S.currentProjectId, S.currentProjectMilestones);
  document.querySelector<HTMLElement>(`#pd-milestones .milestone-row[data-drag-id="${id}"]`)?.focus();
}
expose('milestoneKey', milestoneKey);

/** Header: Edit, the next step (blue), "…" (owner, 30-Sep-2026: one pattern for every record). */
function renderProjectActions(p: Project): void {
  const el = document.getElementById('pd-actions');
  if (!el) return;
  const step = projectNextStep(p, S.currentProjectId === p.id ? S.currentProjectMilestones : []);
  const f = trackFigures(p, S.currentProjectId === p.id ? S.currentProjectMilestones : [], today());
  const ring = ringProgress(p, f);
  const of = ring.of === 'milestones' ? 'of milestones done' : ring.of === 'tasks' ? 'of tasks done' : 'done';
  el.innerHTML = `<svg class="pk-ring rk-ring" viewBox="0 0 36 36" role="img" aria-label="${ring.pct}% ${of}" data-tip="${ring.pct}% ${of}"><circle cx="18" cy="18" r="15" fill="none" class="pk-ring-bg" stroke-width="4"/>${ring.pct > 0 ? `<circle cx="18" cy="18" r="15" fill="none" class="pk-ring-fg" stroke-width="4" stroke-dasharray="${ringDash(ring.pct)}" transform="rotate(-90 18 18)" stroke-linecap="round"/>` : ''}<text x="18" y="21.5" text-anchor="middle">${ring.pct}%</text></svg>`
    + recordHeaderHtml([{ label: 'Edit', run: 'editCurrentProject()' }], step, 'projectMoreMenu(event)');
}

function renderMilestones(): void {
  const cur = S.projects.find((x) => x.id === S.currentProjectId);
  if (cur) { renderProjectActions(cur); renderProjectTasks(cur.id); }
  const el = document.getElementById('pd-milestones'); if (!el) return;
  const cnt = document.getElementById('pd-milestone-cnt');
  const list = S.currentProjectMilestones;
  const done = list.filter((m) => m.status === 'Done').length;
  if (cnt) cnt.textContent = `${done}/${list.length}`;
  if (list.length === 0) { el.innerHTML = `<div class="feed-empty">No milestones yet — add the first one below.</div>`; return; }
  el.dataset.sort = 'milestone-order';
  el.setAttribute('data-sort-shift', '');
  el.innerHTML = [...list].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((m) => `<div class="milestone-row" data-drag-kind="milestone" data-drag-id="${m.id}" tabindex="0" onkeydown="milestoneKey(event, ${m.id})" aria-label="${escHtml(m.name)} — ⌥↑ or ⌥↓ to move">
    <div class="milestone-dot ${m.status === 'Done' ? 'done' : m.status === 'In Progress' ? 'in-progress' : ''}" onclick="cycleMilestoneStatus(${m.id})" title="Click to change status">${m.status === 'Done' ? '&#10003;' : ''}</div>
    <div class="milestone-name">${escHtml(m.name)}</div>
    ${m.targetDate ? `<div class="milestone-date">${fmtDate(m.targetDate)}</div>` : ''}
    <button class="btn-ghost btn-sm" onclick="deleteMilestone(${m.id})" data-tip="Remove">&times;</button>
  </div>`).join('');
}

/** Tasks under the milestone they belong to — the one a task's heading names, else the first one due on or after
 * its date — each group with its progress; then the header figures and the track, which count the same tasks. */
function renderProjectTasks(projectId: number): void {
  const p = S.projects.find((x) => x.id === projectId);
  if (p) renderProjectStory(p);
  const el = document.getElementById('pd-tasks'); if (!el) return;
  const cnt = document.getElementById('pd-task-cnt');
  const groups = projectTaskGroups(projectId);
  const open = groups.reduce((n, g) => n + g.total - g.done, 0);
  if (cnt) cnt.textContent = groups.length ? `${open} open` : '';
  if (!groups.length) { el.innerHTML = `<p class="co-nr-none">No tasks in this project yet.</p>`; return; }
  el.innerHTML = groups.map((g) => `<div class="rk-tgroup${g.done === g.total ? ' is-done' : ''}">
    <div class="rk-tgroup-hd"><b>${escHtml(g.name)}</b><span class="rk-tbar" role="img" aria-label="${g.done} of ${g.total} done"><i style="width:${g.pct}%"></i></span><span class="rk-tgroup-n">${escHtml(g.note)}</span></div>
    <div class="task-group">${g.tasks.map((t) => taskRowHtml(t, { list: `project:${projectId}`, compact: true })).join('')}</div>
  </div>`).join('');
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
  if (p.archived) {
    closeProjectDetail();
    renderProjects();
    const id = p.id;
    undoToast(`Archived ${p.name}`, () => { S.currentProjectId = id; void toggleArchiveProject().then(() => (window as any).openRecord?.('project', id)); });
  } else await renderProjectDetail();
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
  const rows = document.querySelectorAll('#pd-milestones .milestone-row');
  settleNew(rows[rows.length - 1]);
  (f.elements.namedItem('msName') as HTMLInputElement | null)?.focus();
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

/** The header's "Complete milestone: …". */
export async function completeMilestone(id: number): Promise<void> {
  if (S.currentProjectId == null) return;
  const m = S.currentProjectMilestones.find((x) => x.id === id);
  if (!m || m.status === 'Done') return;
  m.status = 'Done';
  m.completionDate = today();
  await persistMilestones(S.currentProjectId, S.currentProjectMilestones);
  S.currentProjectMilestones = await getMilestones(S.currentProjectId);
  renderMilestones();
  await loadProjects();
}
expose('completeMilestone', completeMilestone);

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
  container.innerHTML = `<div class="rec-list pj-list">${companyProjects.map(projectRow).join('')}</div>`;
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
  e.stopPropagation();
  showMenuAt(e.currentTarget as HTMLElement, [
    ...newForRecordItems(),
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
