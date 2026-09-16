import { S } from '../lib/state';
import { emptyState } from '../lib/ui';
import { companyLink, recordLink } from '../lib/links';
import { escHtml, expose, today, fmtDate, statusDot, nextTodoId, nextNoteId, showConfirm } from '../lib/utils';
import { attachCompanySelector } from '../lib/companySelector';
import { registerTabRenderer } from '../lib/registry';
import {
  getIntelligenceItems, saveIntelligenceItem, deleteIntelligenceItem,
  setIntelligenceSaved, setIntelligenceArchived, getLinksFor, setLinksFrom, syncIntelligenceFeeds, intelligenceFeedStatus, type FeedStatus,
} from '../lib/db';
import { getAllCompanies } from './companies';
import { persistTodos, persistNotes } from '../lib/persist';
import type { IntelligenceItem, IntelligenceImportance, Todo, Note, EntityLink } from '../lib/types';
import { icon } from '../lib/icons';
import { showContextMenu } from '../lib/contextMenu';
import { renderIcons } from '../core/chrome';

const IMPORTANCE_CFG: Record<IntelligenceImportance, { c: string; label: string }> = {
  critical: { c: 'var(--red)', label: 'Critical' },
  important: { c: 'var(--amber)', label: 'Important' },
  monitor: { c: 'var(--muted)', label: 'Monitor' },
};

const linkCache = new Map<number, EntityLink[]>();

async function loadItems(): Promise<void> {
  S.intelItems = await getIntelligenceItems(S.intelKind, S.intelShowArchived);
}

export function renderIntelligence(): void {
  void loadItems().then(paintIntelligence);
  paintIntelligence();
  void syncFeedsAndRepaint();
}
registerTabRenderer('intelligence', renderIntelligence);
expose('renderIntelligence', renderIntelligence);

/** Fires on every visit to the tab, same pattern as Calendar's sync — paints
 * whatever's cached immediately, syncs in the background, then reloads once
 * done. A real fetch/parse failure surfaces in the sync-status label instead
 * of being swallowed (same reasoning as the Calendar sync fix: indistinguishable
 * silent failure is worse than a visible one). */
async function syncFeedsAndRepaint(): Promise<void> {
  S.intelSyncing = true;
  S.intelSyncError = null;
  paintIntelSyncStatus();
  try {
    await syncIntelligenceFeeds();
    S.intelSyncError = null;
    await loadItems();
    paintIntelligence();
    void paintFeedSources();
  } catch (err) {
    console.error('[intel sync]', err);
    S.intelSyncError = String(err);
  }
  S.intelSyncing = false;
  paintIntelSyncStatus();
}

/** Which sources ran, what they brought back, and which ones failed — so
 * "is this pulling anything?" is answerable without opening the database. */
async function paintFeedSources(): Promise<void> {
  const el = document.getElementById('intel-sources');
  if (!el) return;
  let sources: FeedStatus[] = [];
  try {
    sources = await intelligenceFeedStatus();
  } catch { /* the panel simply stays empty */ }
  if (!sources.length) { el.innerHTML = ''; return; }
  const when = sources.find((s) => s.lastRunAt)?.lastRunAt;
  const failed = sources.filter((s) => s.error);
  el.innerHTML = `<details class="intel-sources"${failed.length ? ' open' : ''}>
    <summary>${sources.length} sources${when ? ` · last checked ${escHtml(fmtDate(when.slice(0, 10)))}` : ''}${failed.length ? ` · <span class="c-red">${failed.length} not reachable</span>` : ''}</summary>
    <div class="intel-source-list">${sources.map((s) => `<div class="intel-source">
      <span class="intel-source-name">${escHtml(s.name)}</span>
      <span class="intel-source-kind">${escHtml(s.kind === 'regulatory' ? 'Regulatory' : 'Business')}</span>
      <span class="intel-source-stat">${s.error ? `<span class="c-red">${escHtml(s.error)}</span>` : `${s.added} new of ${s.considered} seen`}</span>
    </div>`).join('')}</div>
  </details>`;
}

function paintIntelSyncStatus(): void {
  const el = document.getElementById('intel-sync-status');
  if (!el) return;
  el.classList.remove('c-red');
  if (S.intelSyncing) { el.textContent = 'Syncing…'; return; }
  if (S.intelSyncError) { el.textContent = `Sync failed — ${S.intelSyncError}`; el.classList.add('c-red'); return; }
  el.textContent = '';
}

export function setIntelKind(k: string): void {
  S.intelKind = k as typeof S.intelKind;
  document.querySelectorAll('.intel-kbtn').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.kind === k));
  const title = document.getElementById('intel-subtitle');
  if (title) title.textContent = k === 'regulatory'
    ? 'Saudi regulatory changes — labour law, Saudization/Nitaqat, GOSI, ZATCA, MISA, and more.'
    : 'Saudi & GCC business developments — investments, M&A, mega-projects, and more.';
  renderIntelligence();
}
expose('setIntelKind', setIntelKind);

export function setIntelImportanceFilter(v: string): void {
  S.intelImportanceFilter = v as typeof S.intelImportanceFilter;
  paintIntelligence();
}
expose('setIntelImportanceFilter', setIntelImportanceFilter);

export function toggleIntelArchived(): void {
  S.intelShowArchived = !S.intelShowArchived;
  const btn = document.getElementById('intel-archived-btn');
  if (btn) btn.classList.toggle('active', S.intelShowArchived);
  renderIntelligence();
}
expose('toggleIntelArchived', toggleIntelArchived);

function filteredItems(): IntelligenceItem[] {
  let list = S.intelItems;
  if (S.intelImportanceFilter) list = list.filter((i) => i.importance === S.intelImportanceFilter);
  const order: Record<string, number> = { critical: 0, important: 1, monitor: 2 };
  return [...list].sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    const oi = (order[a.importance] ?? 3) - (order[b.importance] ?? 3);
    if (oi !== 0) return oi;
    return (b.publishedAt || b.createdAt || '').localeCompare(a.publishedAt || a.createdAt || '');
  });
}

function paintIntelligence(): void {
  const root = document.getElementById('intel-root');
  if (!root) return;
  const list = filteredItems();
  const cnt = document.getElementById('intel-cnt');
  if (cnt) cnt.textContent = `${list.length} item${list.length !== 1 ? 's' : ''}`;
  if (list.length === 0) {
    root.innerHTML = `<div class="card">${emptyState({ icon: 'target', title: 'Nothing tracked yet', body: 'Add a verified item with its source link, or wait for the next automatic feed sync.' })}</div>`;
    return;
  }
  root.innerHTML = `<div class="card intel-list">${list.map(itemRow).join('')}</div>`;
  renderIcons(root);
}

function itemRow(it: IntelligenceItem): string {
  const cfg = IMPORTANCE_CFG[it.importance] || IMPORTANCE_CFG.monitor;
  const links = linkCache.get(it.id);
  const chips: string[] = [];
  if (it.ingestedVia === 'feed') chips.push(`<span class="chip" title="Pulled in automatically — not personally reviewed">Auto</span>`);
  if (it.companyName) chips.push(companyLink(it.companyId, it.companyName, { chip: true }));
  if (links) {
    for (const l of links) {
      if (l.toType === 'project') {
        const p = S.projects.find((x) => x.id === l.toId);
        if (p) chips.push(recordLink('project', p.id, p.name, { chip: true }));
      }
    }
  }
  return `<div class="intel-row${it.archived ? ' is-archived' : ''}" style="--tone:${cfg.c}" oncontextmenu="intelMenu(event, ${it.id})">
    <span class="intel-tone" title="${escHtml(cfg.label)}"></span>
    <div class="intel-main" onclick="if(!event.target.closest('a,button'))openIntelModal(${it.id})">
      <div class="intel-headline">${escHtml(it.headline)}</div>
      <div class="intel-meta"><span class="intel-importance">${escHtml(cfg.label)}</span>${escHtml(it.sourceName)}${it.status ? ` · ${escHtml(it.status)}` : ''}${it.publishedAt ? ` · ${escHtml(fmtDate(it.publishedAt))}` : ''}${it.effectiveDate ? ` · <span class="intel-effective">applies from ${escHtml(it.effectiveDate)}</span>` : ''}</div>
      ${(it.affectedServices || []).length ? `<div class="intel-services">${(it.affectedServices || []).map((sv) => `<span class="chip">${escHtml(sv)}</span>`).join('')}</div>` : ''}
      ${it.whyItMatters ? `<div class="intel-why">${escHtml(it.whyItMatters)}</div>` : ''}
      ${chips.length ? `<div class="chip-row">${chips.join('')}</div>` : ''}
      <div class="ar-link-popover" id="intel-link-pop-${it.id}" hidden></div>
    </div>
    <div class="intel-actions">
      <button class="rec-icon-btn${it.saved ? ' is-on' : ''}" onclick="intelToggleSaved(${it.id})" title="${it.saved ? 'Saved — click to unsave' : 'Save'}" aria-pressed="${it.saved}">${it.saved ? '★' : '☆'}</button>
      <a href="${escHtml(it.sourceUrl)}" target="_blank" rel="noopener" class="rec-icon-btn" title="Open the source">${icon('link', 13)}</a>
      <button class="rec-icon-btn" onclick="intelMenu(event, ${it.id})" title="More" aria-label="More">${icon('more', 14)}</button>
    </div>
  </div>`;
}

export function intelMenu(e: MouseEvent, id: number): void {
  const it = S.intelItems.find((x) => x.id === id);
  if (!it) return;
  showContextMenu(e, [
    { label: 'Create a task', iconName: 'check', run: () => { void intelCreateTask(id); } },
    { label: 'Create a note', iconName: 'note', run: () => { void intelCreateNote(id); } },
    { label: 'Link to company or project…', iconName: 'link', run: () => intelToggleLinkPopover(id) },
    { label: 'Edit', iconName: 'edit', run: () => openIntelModal(id) },
    { label: '', run: () => {}, separator: true },
    { label: it.archived ? 'Unarchive' : 'Archive', iconName: 'archive', run: () => { void intelToggleArchived(id); } },
  ]);
}
expose('intelMenu', intelMenu);

export async function intelToggleSaved(id: number): Promise<void> {
  const it = S.intelItems.find((x) => x.id === id);
  if (!it) return;
  it.saved = !it.saved;
  await setIntelligenceSaved(id, it.saved);
  paintIntelligence();
}
expose('intelToggleSaved', intelToggleSaved);

export async function intelToggleArchived(id: number): Promise<void> {
  const it = S.intelItems.find((x) => x.id === id);
  if (!it) return;
  it.archived = !it.archived;
  await setIntelligenceArchived(id, it.archived);
  paintIntelligence();
}
expose('intelToggleArchived', intelToggleArchived);

export async function intelCreateTask(id: number): Promise<void> {
  const it = S.intelItems.find((x) => x.id === id);
  if (!it) return;
  const t: Todo = {
    id: nextTodoId(), title: it.headline, type: 'general', client: it.companyName, priority: it.importance === 'critical' ? 'High' : 'Medium',
    dueDate: it.effectiveDate || null, status: 'Pending',
    description: [it.whatChanged, it.whyItMatters].filter(Boolean).join('\n\n') || null,
    createdAt: today(), completedAt: null, projectId: null, parentId: null, areaId: null, section: null, sortOrder: null, recurrenceRule: null, meetingId: null, tags: ['from-intelligence'],
  };
  S.todos.push(t);
  persistTodos();
  (window as any).updateTodoBadge?.();
  const links = linkCache.get(id) ?? (await getLinksFor('intelligence', id));
  const next = [...links, { fromType: 'intelligence' as const, fromId: id, toType: 'task' as const, toId: t.id }];
  linkCache.set(id, next);
  await setLinksFrom('intelligence', id, next);
}
expose('intelCreateTask', intelCreateTask);

export async function intelCreateNote(id: number): Promise<void> {
  const it = S.intelItems.find((x) => x.id === id);
  if (!it) return;
  const n: Note = {
    id: nextNoteId(), title: it.headline,
    content: `<p><strong>Source:</strong> ${escHtml(it.sourceName)} — <a href="${escHtml(it.sourceUrl)}" target="_blank" rel="noopener">${escHtml(it.sourceUrl)}</a></p>${it.whatChanged ? `<p><strong>What changed:</strong> ${escHtml(it.whatChanged)}</p>` : ''}${it.whyItMatters ? `<p><strong>Why it matters:</strong> ${escHtml(it.whyItMatters)}</p>` : ''}`,
    folder: '', clientName: it.companyName, tags: ['from-intelligence'], pinned: false, createdAt: today(), updatedAt: today(),
  };
  S.notes.unshift(n);
  persistNotes();
  const links = linkCache.get(id) ?? (await getLinksFor('intelligence', id));
  const next = [...links, { fromType: 'intelligence' as const, fromId: id, toType: 'note' as const, toId: n.id }];
  linkCache.set(id, next);
  await setLinksFrom('intelligence', id, next);
}
expose('intelCreateNote', intelCreateNote);

export function intelToggleLinkPopover(id: number): void {
  const wasOpen = S.intelLinkPopoverId === id;
  S.intelLinkPopoverId = wasOpen ? null : id;
  document.querySelectorAll<HTMLElement>('[id^="intel-link-pop-"]').forEach((el) => { el.hidden = true; el.innerHTML = ''; });
  if (wasOpen) return;
  const pop = document.getElementById(`intel-link-pop-${id}`);
  if (!pop) return;
  pop.hidden = false;
  pop.innerHTML = `<div class="feed-empty">Loading…</div>`;
  void openIntelLinkPopover(id, pop);
}
expose('intelToggleLinkPopover', intelToggleLinkPopover);

async function openIntelLinkPopover(id: number, pop: HTMLElement): Promise<void> {
  const it = S.intelItems.find((x) => x.id === id);
  if (!it) return;
  let links = linkCache.get(id);
  if (!links) {
    links = await getLinksFor('intelligence', id);
    linkCache.set(id, links);
  }
  const projectId = links.find((l) => l.toType === 'project')?.toId ?? null;
  const projectOpts = S.projects.map((p) => `<option value="${p.id}" ${p.id === projectId ? 'selected' : ''}>${escHtml(p.name)}</option>`).join('');

  if (S.intelLinkPopoverId !== id) return;
  pop.innerHTML = `<div class="ar-link-form">
    <dl class="rec-inline-props">
      <div><dt>Company</dt><dd><input type="text" class="td-input" id="intel-company-${id}" value="${escHtml(it.companyName || '')}" placeholder="None"></dd></div>
      <div><dt>Project</dt><dd><select class="td-select" id="intel-project-${id}"><option value="">None</option>${projectOpts}</select></dd></div>
    </dl>
    <div class="btn-row ar-link-actions">
      <button class="btn-secondary" onclick="intelToggleLinkPopover(${id})">Cancel</button>
      <button class="btn-primary" onclick="intelSaveLinks(${id})">Save links</button>
    </div>
  </div>`;
}

export async function intelSaveLinks(id: number): Promise<void> {
  const it = S.intelItems.find((x) => x.id === id);
  if (!it) return;
  const companyInput = document.getElementById(`intel-company-${id}`) as HTMLInputElement | null;
  const projectSel = document.getElementById(`intel-project-${id}`) as HTMLSelectElement | null;

  it.companyName = companyInput?.value.trim() || null;
  await saveIntelligenceItem(it);

  const links: EntityLink[] = [];
  if (projectSel?.value) links.push({ fromType: 'intelligence', fromId: id, toType: 'project', toId: Number(projectSel.value) });
  linkCache.set(id, links);
  await setLinksFrom('intelligence', id, links);

  S.intelLinkPopoverId = null;
  paintIntelligence();
}
expose('intelSaveLinks', intelSaveLinks);

// ═══════════════ Add / Edit modal ═══════════════

export function openIntelModal(id: number | null): void {
  S.intelEditId = id;
  const f = document.getElementById('intel-form') as HTMLFormElement;
  f.reset();
  const itCompany = document.querySelector<HTMLInputElement>('[name=itCompany]');
  if (itCompany) attachCompanySelector(itCompany);
  const deleteBtn = document.getElementById('intel-delete-btn'); if (deleteBtn) deleteBtn.style.display = id === null ? 'none' : '';

  if (id !== null) {
    const it = S.intelItems.find((x) => x.id === id);
    if (!it) return;
    (document.getElementById('intel-modal-title') as HTMLElement).textContent = 'Edit Item';
    (f.elements.namedItem('itKind') as HTMLSelectElement).value = it.kind;
    (f.elements.namedItem('itHeadline') as HTMLInputElement).value = it.headline;
    (f.elements.namedItem('itImportance') as HTMLSelectElement).value = it.importance;
    (f.elements.namedItem('itStatus') as HTMLInputElement).value = it.status || '';
    (f.elements.namedItem('itSourceName') as HTMLInputElement).value = it.sourceName;
    (f.elements.namedItem('itSourceUrl') as HTMLInputElement).value = it.sourceUrl;
    (f.elements.namedItem('itPublishedAt') as HTMLInputElement).value = it.publishedAt || '';
    (f.elements.namedItem('itEffectiveDate') as HTMLInputElement).value = it.effectiveDate || '';
    (f.elements.namedItem('itWhoAffected') as HTMLInputElement).value = it.whoAffected || '';
    (f.elements.namedItem('itWhatChanged') as HTMLTextAreaElement).value = it.whatChanged || '';
    (f.elements.namedItem('itWhyItMatters') as HTMLTextAreaElement).value = it.whyItMatters || '';
    (f.elements.namedItem('itSummary') as HTMLTextAreaElement).value = it.summary || '';
    (f.elements.namedItem('itCompany') as HTMLInputElement).value = it.companyName || '';
  } else {
    (document.getElementById('intel-modal-title') as HTMLElement).textContent = 'Add Intelligence Item';
    (f.elements.namedItem('itKind') as HTMLSelectElement).value = S.intelKind;
    (f.elements.namedItem('itImportance') as HTMLSelectElement).value = 'monitor';
  }
  document.getElementById('modal-intel')?.classList.add('open');
}
expose('openIntelModal', openIntelModal);

export function closeIntelModal(): void {
  document.getElementById('modal-intel')?.classList.remove('open');
}
expose('closeIntelModal', closeIntelModal);

export async function submitIntelItem(e: Event): Promise<void> {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  const headline = (f.elements.namedItem('itHeadline') as HTMLInputElement).value.trim();
  const sourceName = (f.elements.namedItem('itSourceName') as HTMLInputElement).value.trim();
  const sourceUrl = (f.elements.namedItem('itSourceUrl') as HTMLInputElement).value.trim();
  if (!headline || !sourceName || !sourceUrl) return;
  const existing = S.intelEditId != null ? S.intelItems.find((x) => x.id === S.intelEditId) : null;

  const draft: IntelligenceItem = {
    id: existing?.id ?? 0,
    kind: (f.elements.namedItem('itKind') as HTMLSelectElement).value as IntelligenceItem['kind'],
    headline,
    summary: (f.elements.namedItem('itSummary') as HTMLTextAreaElement).value.trim() || null,
    whatChanged: (f.elements.namedItem('itWhatChanged') as HTMLTextAreaElement).value.trim() || null,
    effectiveDate: (f.elements.namedItem('itEffectiveDate') as HTMLInputElement).value || null,
    whoAffected: (f.elements.namedItem('itWhoAffected') as HTMLInputElement).value.trim() || null,
    whyItMatters: (f.elements.namedItem('itWhyItMatters') as HTMLTextAreaElement).value.trim() || null,
    country: existing?.country ?? 'Saudi Arabia',
    category: existing?.category ?? null,
    status: (f.elements.namedItem('itStatus') as HTMLInputElement).value.trim() || null,
    importance: (f.elements.namedItem('itImportance') as HTMLSelectElement).value as IntelligenceImportance,
    sourceName,
    sourceTier: existing?.sourceTier ?? 3,
    sourceUrl,
    publishedAt: (f.elements.namedItem('itPublishedAt') as HTMLInputElement).value || null,
    saved: existing?.saved ?? false,
    archived: existing?.archived ?? false,
    createdAt: existing?.createdAt ?? null,
    companyName: (f.elements.namedItem('itCompany') as HTMLInputElement).value.trim() || null,
    ingestedVia: existing?.ingestedVia ?? null,
  };

  const saved = await saveIntelligenceItem(draft);
  S.intelItems = S.intelItems.filter((x) => x.id !== saved.id);
  if (saved.kind === S.intelKind) S.intelItems.push(saved);
  closeIntelModal();
  paintIntelligence();
}
expose('submitIntelItem', submitIntelItem);

export async function deleteCurrentIntelItem(): Promise<void> {
  if (S.intelEditId == null) return;
  const it = S.intelItems.find((x) => x.id === S.intelEditId);
  if (!(await showConfirm(`Remove "${it?.headline || 'this item'}"? This cannot be undone.`, { confirmLabel: 'Remove' }))) return;
  await deleteIntelligenceItem(S.intelEditId);
  S.intelItems = S.intelItems.filter((x) => x.id !== S.intelEditId);
  closeIntelModal();
  paintIntelligence();
}
expose('deleteCurrentIntelItem', deleteCurrentIntelItem);
