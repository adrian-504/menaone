// Commitments on screen: one row component used by every page, the sections
// on opportunity, project, meeting and company pages, the New / Edit dialog,
// and reading `>>` / `<<` lines out of meeting notes, notes and quick
// capture (the rules are in src/lib/commitments.ts, storage in commitments.rs).

import { S } from '../lib/state';
import { renderIcons } from '../core/chrome';
import { toast } from '../lib/ui';
import { recordLink, companyLink } from '../lib/links';
import { escHtml, expose, fmtDate, today, inCompany, showTextPrompt, showConfirm } from '../lib/utils';
import { commitmentsAdd, type NewCommitment } from '../lib/db';
import { persistCommitments, persistTodos, markCommitmentsSaved } from '../lib/persist';
import { refreshBadges } from '../lib/registry';
import { icon } from '../lib/icons';
import { showContextMenu } from '../lib/contextMenu';
import { attachCompanySelector } from '../lib/companySelector';
import { parseCommitmentLines } from '../lib/commitments';
import { companyFromForm, contextFromMeeting, contextFromOpportunity, contextFromProject, inheritCompany, EMPTY_CONTEXT, type WorkContext } from '../lib/workGraph';
import type { Commitment } from '../lib/types';

// ── Reading commitments out of text ─────────────────────────────────────────

function contactsOf(companyId: number | null, companyName: string | null): { id: number; name: string | null }[] {
  if (companyId == null && !companyName) return [];
  const ref = { id: companyId, name: companyName || '' };
  return S.contacts.filter((c) => inCompany(ref, c.companyId ?? null, c.clientName));
}

/** Adds the `>>` / `<<` lines of a source that aren't commitments yet. The
 * backend skips lines already read from the same source, so this can run on
 * every save. Returns how many were added. */
export async function readCommitmentsFrom(sourceType: 'meeting' | 'note' | 'capture', sourceId: number | null, texts: (string | null | undefined)[], ctx: WorkContext): Promise<number> {
  const parsed = parseCommitmentLines(texts.filter(Boolean).join('\n'), { today: new Date(), contacts: contactsOf(ctx.companyId, ctx.companyName) });
  if (!parsed.length) return 0;
  // Only send what isn't known yet: fewer writes, same result.
  const known = new Set(S.commitments.filter((c) => c.sourceType === sourceType && c.sourceId === sourceId).map((c) => `${c.direction}|${c.sourceKey}`));
  const fresh = sourceType === 'capture' ? parsed : parsed.filter((p) => !known.has(`${p.direction}|${p.sourceKey}`));
  if (!fresh.length) return 0;
  const items: NewCommitment[] = fresh.map((p) => ({
    direction: p.direction, text: p.text, contactId: p.contactId, dueDate: p.dueDate, kept: p.kept,
    companyId: ctx.companyId, opportunityId: ctx.opportunityId, projectId: ctx.projectId, meetingId: ctx.meetingId,
    sourceType, sourceId, sourceKey: p.sourceKey,
  }));
  return addToState(await commitmentsAdd(items));
}

function addToState(added: { commitments: Commitment[]; tasks: import('../lib/types').Todo[] }): number {
  for (const c of added.commitments) if (!S.commitments.some((x) => x.id === c.id)) S.commitments.push(c);
  for (const t of added.tasks) if (!S.todos.some((x) => x.id === t.id)) S.todos.push(t);
  markCommitmentsSaved(added.commitments, added.tasks);
  if (added.tasks.length) refreshBadges();
  if (added.commitments.length) refreshCommitmentViews();
  return added.commitments.length;
}

// ── Rows and sections ───────────────────────────────────────────────────────

function sourceLink(c: Commitment): string {
  if (c.sourceType === 'meeting' && c.sourceId != null) {
    const m = S.meetings.find((x) => x.id === c.sourceId);
    return m ? `from ${recordLink('meeting', m.id, m.title)}` : '';
  }
  if (c.sourceType === 'note' && c.sourceId != null) {
    const n = S.notes.find((x) => x.id === c.sourceId);
    return n ? `from ${recordLink('note', n.id, n.title || 'a note')}` : '';
  }
  return '';
}

function whoLabel(c: Commitment): string {
  const who = c.contactId != null ? S.contacts.find((x) => x.id === c.contactId)?.name : null;
  return who ? `${c.direction === 'theirs' ? 'from' : 'to'} ${escHtml(who)}` : '';
}

/** One commitment: who owes it, what, who, when, where it came from. */
export function commitmentRow(c: Commitment, opts: { showCompany?: boolean } = {}): string {
  const closed = c.status !== 'open';
  const overdue = !closed && !!c.dueDate && c.dueDate < today();
  const dir = c.direction === 'ours'
    ? `<span class="cm-dir" title="We owe it" aria-label="We owe it">→</span>`
    : `<span class="cm-dir is-theirs" title="They owe it" aria-label="They owe it">←</span>`;
  const company = opts.showCompany && c.companyId != null ? companyLink(c.companyId, S.companies.find((x) => x.id === c.companyId)?.name || null) : '';
  const meta = [
    c.direction === 'ours' ? 'We owe' : 'They owe',
    whoLabel(c),
    company,
    c.dueDate ? `<span class="${overdue ? 'cm-overdue' : ''}">${overdue ? 'was due' : 'due'} ${escHtml(fmtDate(c.dueDate))}</span>` : '',
    sourceLink(c),
    c.status === 'dropped' ? `dropped${c.dropReason ? `: ${escHtml(c.dropReason)}` : ''}` : '',
  ].filter(Boolean).join(' · ');
  return `<div class="cm-row${closed ? ' is-closed' : ''}${c.status === 'dropped' ? ' is-dropped' : ''}" data-commitment-id="${c.id}">
    <button class="task-check${c.status === 'kept' ? ' checked' : ''}" onclick="toggleCommitmentKept(${c.id})" ${c.status === 'dropped' ? 'disabled' : ''} aria-label="${c.status === 'kept' ? 'Mark as open again' : 'Mark kept'}" title="${c.status === 'kept' ? 'Kept — click to reopen' : 'Mark kept'}"></button>
    ${dir}
    <div class="cm-main"><div class="cm-text">${escHtml(c.text)}</div><div class="cm-meta">${meta}</div></div>
    <button class="rec-icon-btn" onclick="commitmentMenu(event, ${c.id})" title="More" aria-label="More">${icon('more', 14)}</button>
  </div>`;
}

/** Open ones first; closed ones fold under a "N kept or dropped" line. */
export function commitmentListHtml(list: Commitment[], opts: { split?: boolean; showCompany?: boolean } = {}): string {
  const sort = (a: Commitment, b: Commitment) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.id - b.id;
  const open = list.filter((c) => c.status === 'open').sort(sort);
  const closed = list.filter((c) => c.status !== 'open').sort((a, b) => (b.closedAt || '').localeCompare(a.closedAt || ''));
  const rows = (xs: Commitment[]) => xs.map((c) => commitmentRow(c, opts)).join('');
  const openHtml = opts.split
    ? ['ours', 'theirs'].map((d) => {
      const xs = open.filter((c) => c.direction === d);
      return xs.length ? `<div class="cm-group"><div class="cm-group-label">${d === 'ours' ? 'We owe' : 'They owe'}</div>${rows(xs)}</div>` : '';
    }).join('')
    : rows(open);
  return `<div class="cm-list">${openHtml || '<div class="cm-empty">Nothing open.</div>'}</div>
    ${closed.length ? `<details class="cm-closed"><summary>${closed.length} kept or dropped</summary><div class="cm-list">${rows(closed)}</div></details>` : ''}`;
}

type Scope = { opportunityId?: number; projectId?: number; meetingId?: number; company?: { id: number | null; name: string } };

function inScope(c: Commitment, s: Scope): boolean {
  if (s.opportunityId != null) return c.opportunityId === s.opportunityId;
  if (s.projectId != null) return c.projectId === s.projectId;
  if (s.meetingId != null) return c.sourceType === 'meeting' && c.sourceId === s.meetingId;
  if (s.company) return inCompany({ id: s.company.id, name: s.company.name }, c.companyId, null);
  return false;
}

/** Sections on screen, re-drawn after any change. */
const sections = new Map<string, () => void>();

/** A Commitments section: hidden while there are none (the record's New menu adds one). */
export function renderCommitmentSection(elId: string, scope: Scope, ctx: WorkContext, opts: { split?: boolean } = {}): void {
  const draw = () => {
    const el = document.getElementById(elId);
    if (!el) { sections.delete(elId); return; }
    const list = S.commitments.filter((c) => inScope(c, scope));
    el.hidden = list.length === 0;
    if (!list.length) { el.innerHTML = ''; return; }
    const open = list.filter((c) => c.status === 'open').length;
    el.innerHTML = `<div class="rec-section-hd"><h2>Commitments</h2><span class="rec-count">${open ? `${open} open` : ''}</span>
      <div class="rec-section-actions"><button class="btn-secondary btn-sm" onclick="newCommitmentHere('${elId}')">+ New</button></div></div>
      ${commitmentListHtml(list, opts)}`;
    renderIcons(el);
  };
  contexts.set(elId, ctx);
  sections.set(elId, draw);
  draw();
}

const contexts = new Map<string, WorkContext>();

export function newCommitmentHere(elId: string): void {
  openCommitmentModal(contexts.get(elId) ?? EMPTY_CONTEXT);
}
expose('newCommitmentHere', newCommitmentHere);

/** Re-draws every commitment section on screen (and the pages that show counts). */
export function refreshCommitmentViews(): void {
  for (const draw of sections.values()) draw();
  (window as any).refreshMeetingActions?.();
  (window as any).renderTaskDetailExternal?.();
}

// ── Actions ─────────────────────────────────────────────────────────────────

function byId(id: number): Commitment | undefined {
  return S.commitments.find((c) => c.id === id);
}

export function setCommitmentKept(id: number, kept: boolean): void {
  const c = byId(id);
  if (!c || c.status === 'dropped') return;
  c.status = kept ? 'kept' : 'open';
  c.closedAt = kept ? new Date().toISOString() : null;
  persistCommitments();
  refreshBadges();
  refreshCommitmentViews();
}

export function toggleCommitmentKept(id: number): void {
  const c = byId(id);
  if (c) setCommitmentKept(id, c.status !== 'kept');
}
expose('toggleCommitmentKept', toggleCommitmentKept);

export async function dropCommitment(id: number): Promise<void> {
  const c = byId(id);
  if (!c) return;
  const reason = await showTextPrompt({ title: 'Drop this commitment?', label: 'Why, in a line (optional)', placeholder: 'e.g. Client decided to wait until Q1' });
  if (reason === null) return;
  c.status = 'dropped';
  c.dropReason = reason.trim() || null;
  c.closedAt = new Date().toISOString();
  // Its task goes too, while it's still open: there's nothing left to do.
  const task = c.todoId != null ? S.todos.find((t) => t.id === c.todoId) : undefined;
  if (task && task.status !== 'Done') {
    S.todos = S.todos.filter((t) => t.id !== task.id);
    c.todoId = null;
    persistTodos();
  }
  persistCommitments();
  refreshBadges();
  refreshCommitmentViews();
  toast('Commitment dropped');
}

export function reopenCommitment(id: number): void {
  const c = byId(id);
  if (!c) return;
  c.status = 'open';
  c.closedAt = null;
  c.dropReason = null;
  persistCommitments();
  refreshCommitmentViews();
}

export function openCommitmentSource(id: number): void {
  if (!S.commitments.length) return;
  const c = byId(id);
  if (!c) return;
  const w = window as any;
  if (c.sourceType === 'meeting' && c.sourceId != null) w.openRecord('meeting', c.sourceId);
  else if (c.sourceType === 'note' && c.sourceId != null) w.openRecord('note', c.sourceId);
  else if (c.opportunityId != null) w.openRecord('opportunity', c.opportunityId);
  else if (c.projectId != null) w.openRecord('project', c.projectId);
  else if (c.companyId != null) w.openRecord('company', c.companyId);
}

expose('openCommitmentSource', openCommitmentSource);

export async function deleteCommitment(id: number): Promise<void> {
  const c = byId(id);
  if (!c || !(await showConfirm(`Delete "${c.text}"? Dropping keeps a record of it; deleting doesn't.`, { confirmLabel: 'Delete' }))) return;
  S.commitments = S.commitments.filter((x) => x.id !== id);
  persistCommitments();
  refreshCommitmentViews();
}

export function commitmentMenu(e: MouseEvent, id: number): void {
  const c = byId(id);
  if (!c) return;
  const hasSource = (c.sourceType === 'meeting' || c.sourceType === 'note') && c.sourceId != null;
  showContextMenu(e, [
    { label: 'Edit', iconName: 'edit', run: () => openCommitmentModal(EMPTY_CONTEXT, id) },
    ...(c.status === 'open' ? [{ label: 'Drop…', iconName: 'close', run: () => { void dropCommitment(id); } }] : [{ label: 'Reopen', iconName: 'repeat', run: () => reopenCommitment(id) }]),
    ...(hasSource ? [{ label: c.sourceType === 'meeting' ? 'Open the meeting' : 'Open the note', iconName: c.sourceType === 'meeting' ? 'meeting' : 'note', run: () => openCommitmentSource(id) }] : []),
    { label: '', run: () => {}, separator: true },
    { label: 'Delete', iconName: 'trash', danger: true, run: () => { void deleteCommitment(id); } },
  ]);
}
expose('commitmentMenu', commitmentMenu);

/** New commitment from an opportunity, project or meeting, with its context. */
export function createCommitmentFor(kind: 'opportunity' | 'project' | 'meeting', id: number): void {
  if (kind === 'opportunity') { const o = S.opportunities.find((x) => x.id === id); if (o) openCommitmentModal(contextFromOpportunity(S, o)); }
  if (kind === 'project') { const p = S.projects.find((x) => x.id === id); if (p) openCommitmentModal(contextFromProject(S, p)); }
  if (kind === 'meeting') { const m = S.meetings.find((x) => x.id === id); if (m) openCommitmentModal(contextFromMeeting(S, m)); }
}
expose('createCommitmentFor', createCommitmentFor);

export function createCommitmentForCurrentCompany(): void {
  const co = S.companies.find((c) => c.name === S.currentCompany);
  openCommitmentModal({ ...EMPTY_CONTEXT, companyId: co?.id ?? null, companyName: co?.name ?? S.currentCompany ?? null });
}
expose('createCommitmentForCurrentCompany', createCommitmentForCurrentCompany);

/** The Commitments section on a company page: open first, split we owe / they owe. */
export function renderCompanyCommitments(company: { id: number | null; name: string }): number {
  const list = S.commitments.filter((c) => inScope(c, { company }));
  const el = document.getElementById('co-commitments-list');
  const count = document.getElementById('co-commitments-count');
  const open = list.filter((c) => c.status === 'open').length;
  if (count) count.textContent = open ? String(open) : '';
  if (el) {
    el.innerHTML = list.length ? commitmentListHtml(list, { split: true }) : '';
    renderIcons(el);
  }
  sections.set('co-commitments-list', () => { if (document.getElementById('co-commitments-list')) renderCompanyCommitments(company); });
  return open;
}

// ── New / Edit dialog ───────────────────────────────────────────────────────

let modalEditId: number | null = null;
let modalContext: WorkContext = EMPTY_CONTEXT;
let modalDirection: 'ours' | 'theirs' = 'ours';

export function setCommitmentDirection(d: 'ours' | 'theirs'): void {
  modalDirection = d;
  document.querySelectorAll<HTMLElement>('#cm-direction button').forEach((b) => b.classList.toggle('active', b.dataset.dir === d));
  const label = document.getElementById('cm-who-label');
  if (label) label.textContent = d === 'ours' ? 'Promised to' : 'Promised by';
}
expose('setCommitmentDirection', setCommitmentDirection);

function fillContacts(f: HTMLFormElement, selected: number | null): void {
  const sel = f.elements.namedItem('cmContact') as HTMLSelectElement;
  const name = (f.elements.namedItem('cmCompany') as HTMLInputElement).value.trim();
  const co = S.companies.find((c) => c.name.toLowerCase() === name.toLowerCase());
  const list = contactsOf(co?.id ?? null, name || null);
  sel.innerHTML = `<option value="">— Nobody in particular —</option>` + list.map((c) => `<option value="${c.id}">${escHtml(c.name || '')}</option>`).join('');
  sel.value = selected != null && list.some((c) => c.id === selected) ? String(selected) : '';
}

/** New commitment with the context it was started from, or edit one. */
export function openCommitmentModal(ctx: WorkContext = EMPTY_CONTEXT, editId: number | null = null): void {
  const f = document.getElementById('commitment-form') as HTMLFormElement | null;
  if (!f) return;
  f.reset();
  modalEditId = editId;
  const c = editId != null ? byId(editId) : undefined;
  modalContext = c ? { ...EMPTY_CONTEXT, companyId: c.companyId, companyName: S.companies.find((x) => x.id === c.companyId)?.name ?? null, opportunityId: c.opportunityId, projectId: c.projectId } : inheritCompany(S, ctx);
  (document.getElementById('commitment-modal-title') as HTMLElement).textContent = c ? 'Edit commitment' : 'New commitment';
  (document.getElementById('commitment-submit-btn') as HTMLElement).textContent = c ? 'Save changes' : 'Create commitment';
  setCommitmentDirection(c?.direction ?? 'ours');
  (f.elements.namedItem('cmText') as HTMLInputElement).value = c?.text ?? '';
  (f.elements.namedItem('cmDue') as HTMLInputElement).value = c?.dueDate ?? '';
  const company = f.elements.namedItem('cmCompany') as HTMLInputElement;
  company.value = modalContext.companyName || '';
  attachCompanySelector(company, { onSelect: () => fillContacts(f, null) });
  company.onchange = () => fillContacts(f, null);
  const opp = f.elements.namedItem('cmOpportunity') as HTMLSelectElement;
  opp.innerHTML = `<option value="">— No opportunity —</option>` + S.opportunities.filter((o) => !o.archived).map((o) => `<option value="${o.id}">${escHtml(o.name)}</option>`).join('');
  opp.value = modalContext.opportunityId != null ? String(modalContext.opportunityId) : '';
  const proj = f.elements.namedItem('cmProject') as HTMLSelectElement;
  proj.innerHTML = `<option value="">— No project —</option>` + S.projects.filter((p) => !p.archived).map((p) => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
  proj.value = modalContext.projectId != null ? String(modalContext.projectId) : '';
  fillContacts(f, c?.contactId ?? null);
  document.getElementById('modal-commitment')?.classList.add('open');
  setTimeout(() => (f.elements.namedItem('cmText') as HTMLInputElement).focus(), 30);
}
expose('openCommitmentModal', openCommitmentModal);

export function closeCommitmentModal(): void {
  document.getElementById('modal-commitment')?.classList.remove('open');
}
expose('closeCommitmentModal', closeCommitmentModal);

export async function submitCommitment(e: Event): Promise<void> {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  const text = (f.elements.namedItem('cmText') as HTMLInputElement).value.trim();
  if (!text) return;
  const due = (f.elements.namedItem('cmDue') as HTMLInputElement).value || null;
  const contact = (f.elements.namedItem('cmContact') as HTMLSelectElement).value;
  const oppVal = (f.elements.namedItem('cmOpportunity') as HTMLSelectElement).value;
  const projVal = (f.elements.namedItem('cmProject') as HTMLSelectElement).value;
  const typed = (f.elements.namedItem('cmCompany') as HTMLInputElement).value;
  const company = companyFromForm(modalContext, typed);
  const companyId = company.companyId ?? S.companies.find((c) => c.name.toLowerCase() === (company.companyName || '').toLowerCase())?.id ?? null;
  const fields = {
    text, dueDate: due, contactId: contact ? Number(contact) : null, companyId,
    opportunityId: oppVal ? Number(oppVal) : null, projectId: projVal ? Number(projVal) : null,
  };
  if (modalEditId != null) {
    const c = byId(modalEditId);
    if (!c) return;
    Object.assign(c, fields, { direction: modalDirection });
    // An edited promise we owe keeps its task's wording.
    const task = c.todoId != null ? S.todos.find((t) => t.id === c.todoId) : undefined;
    if (task && task.title !== text) { task.title = text; persistTodos(); }
    persistCommitments();
    refreshCommitmentViews();
    closeCommitmentModal();
    return;
  }
  const added = await commitmentsAdd([{ direction: modalDirection, ...fields, meetingId: modalContext.meetingId, sourceType: 'manual' }]);
  addToState(added);
  closeCommitmentModal();
  toast(modalDirection === 'ours' ? 'Commitment added, with a task' : 'Commitment added');
}
expose('submitCommitment', submitCommitment);
