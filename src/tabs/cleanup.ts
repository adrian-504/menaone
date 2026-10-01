// Clean-up: works through lib/cleanup.ts queues — one record at a time with
// its context and one-click fixes, or as a list with the same fixes applied
// to many records. Every fix can be undone.

import { registerKey } from '../core/keys';
import { S } from '../lib/state';
import { escHtml, expose, today } from '../lib/utils';
import { icon } from '../lib/icons';
import { recordLink } from '../lib/links';
import { emptyState, toast, undoToast } from '../lib/ui';
import { registerTabRenderer, registerBadgeUpdater, getActiveTabId, refreshAll } from '../lib/registry';
import { onChange } from '../lib/changes';
import { renderIcons } from '../core/chrome';
import { activityLog, activityRemove, getAppMeta, setAppMeta, saveCompany } from '../lib/db';
import { persistAgreements, persistOpportunity, persistProposals, persistTodos } from '../lib/persist';
import { PS, activeTeam, currencyOf } from '../lib/commercial';
import { LOSS_REASONS } from '../lib/constants';
import { INDUSTRY_TAXONOMY } from '../lib/types';
import { openWlModal, recordReview, snoozeProposal, updateStatus, updateBadge } from '../core/proposals';
import { stripHtml, tileHtml, toneVar } from '../lib/pageKit';
import { ACTION_HINT, QUEUE_KIND, bumpCleared, cardFor, cleanupStrip, reviewPosition, type CardInput } from '../lib/cleanupCards';
import { GROUP_ORDER } from '../lib/cleanup';
import { teamMember, defaultReviewer, isAgreementActive } from '../lib/commercial';
import { inCompany } from '../lib/utils';
import { updateOpportunityStage } from './opportunities';
import { deleteTasks, setTasksDue, setTasksSomeday, toggleTodoDone } from './todo';
import { buildCleanupQueues, totalToClean, type CleanupAction, type CleanupItem, type CleanupQueue, type QueueId } from '../lib/cleanup';
import type { Company, ServiceStatus } from '../lib/types';

const w = window as any;

let kept: Record<string, string> = {};
let keptLoaded = false;
let currentQueue: QueueId | null = null;
let mode: 'step' | 'list' = 'step';
/** Items skipped in this session, per queue. */
const skipped = new Map<QueueId, Set<string>>();
const selected = new Set<string>();
/** Which inline chooser is open on the step card. */
let chooser: CleanupAction | null = null;
let done = 0;
/** Records cleared per month ("2026-10" → n), in app_meta 'cleanup_cleared' (the strip's "cleared this month"). */
let cleared: Record<string, number> = {};

function countCleared(delta: number): void {
  done = Math.max(0, done + delta);
  cleared = bumpCleared(cleared, today().slice(0, 7), delta);
  void setAppMeta('cleanup_cleared', JSON.stringify(cleared)).catch(() => undefined);
}

/** What the card needs to describe a record (lib/cleanupCards.ts). */
function cardInput(): CardInput {
  const t = today();
  return {
    today: t, proposals: S.proposals, agreements: S.agreements, opportunities: S.opportunities, companies: S.companies, todos: S.todos, contacts: S.contacts, touches: S.touches,
    reviewerOf: (p) => teamMember(p.reviewerId)?.name || defaultReviewer()?.name || 'the reviewer',
    me: defaultOwner(),
    relationshipOf: (companyId, name) => {
      if (!name) return null;
      const rel = w.companyRelationship?.(name) as { label: string } | undefined;
      const ref = { id: companyId ?? null, name };
      const services = [...new Set(S.agreements.filter((a) => inCompany(ref, a.companyId, a.client) && isAgreementActive(a, t)).flatMap((a) => (a.lines?.length ? a.lines.map((l) => l.serviceName) : [a.type || ''])).filter(Boolean))];
      return rel ? { label: rel.label, services } : null;
    },
  };
}

function queues(): CleanupQueue[] {
  return buildCleanupQueues({
    today: today(), proposals: S.proposals, agreements: S.agreements, opportunities: S.opportunities, companies: S.companies, todos: S.todos,
    companiesWithIndustry: new Set(S.companies.filter((c) => c.industries?.length).map((c) => c.id)), kept,
    commitments: S.commitments, contacts: S.contacts, projects: S.projects,
  });
}

async function ensureKept(): Promise<void> {
  if (keptLoaded) return;
  keptLoaded = true;
  try { kept = JSON.parse((await getAppMeta('cleanup_kept')) || '{}'); } catch { kept = {}; }
  try { cleared = JSON.parse((await getAppMeta('cleanup_cleared')) || '{}'); } catch { cleared = {}; }
  const t = today();
  for (const [k, until] of Object.entries(kept)) if (until <= t) delete kept[k];
}

// ── Render ──────────────────────────────────────────────────────────────────

const ACTION_LABEL: Record<CleanupAction, string> = {
  lost: 'Mark lost', withdrawn: 'Withdrawn', won: 'Signed by both parties', keep: 'Keep for 30 days', snooze_followup: 'Still in play',
  approve: 'Approved', changes: 'Changes requested', back_to_drafting: 'Back to drafting',
  agreement_active: 'Mark active', agreement_not_started: 'Not started yet', agreement_ended: 'Mark ended',
  opportunity_details: 'Fill in details', opportunity_lost: 'Close as lost',
  set_industry: 'Set industry', set_owner: 'Set owner', add_contact: 'Add a contact', nudge: 'Nudge',
  task_done: 'Done', task_someday: 'Someday', task_date: 'Give it a date', task_delete: 'Delete',
  commitment_edit: 'Fix the links',
};
const ACTION_TONE: Partial<Record<CleanupAction, string>> = { lost: 'danger', opportunity_lost: 'danger', task_delete: 'danger', withdrawn: 'danger' };

export async function renderCleanup(): Promise<void> {
  const root = document.getElementById('cleanup-root');
  if (!root) return;
  await ensureKept();
  const qs = queues();
  const withItems = qs.filter((q) => q.items.length);
  if (!currentQueue || !qs.some((q) => q.id === currentQueue)) currentQueue = (withItems[0] || qs[0]).id;
  const q = qs.find((x) => x.id === currentQueue)!;
  const groups = GROUP_ORDER.filter((g) => qs.some((x) => x.group === g));
  const total = totalToClean(qs);
  const strip = document.getElementById('cleanup-strip');
  if (strip) strip.innerHTML = stripHtml('cleanup', cleanupStrip(qs, cleared[today().slice(0, 7)] || 0));
  const modeEl = document.getElementById('cleanup-mode');
  if (modeEl) modeEl.innerHTML = total ? `<div class="seg-btns pk-seg"><button class="seg-btn${mode === 'step' ? ' active' : ''}" onclick="cleanupMode('step')">One at a time</button><button class="seg-btn${mode === 'list' ? ' active' : ''}" onclick="cleanupMode('list')">List</button></div>` : '';

  root.innerHTML = `<nav class="cu-nav" aria-label="Clean-up queues">
      ${groups.map((g) => `<div class="cu-nav-group"><div class="cu-nav-label">${escHtml(g)}</div>
        ${qs.filter((x) => x.group === g).map((x) => {
          const k = QUEUE_KIND[x.id];
          const clear = !x.items.length;
          return `<button class="cu-nav-item${x.id === q.id ? ' active' : ''}${clear ? ' is-clear' : ''}" onclick="cleanupQueue('${x.id}')">
          <span class="cu-kind${clear ? ' is-done' : ''}" style="--c:var(--${clear ? 'green' : toneVar(k.tone)})" aria-hidden="true">${clear ? '✓' : k.glyph}</span><span class="cu-nav-t">${escHtml(x.title)}</span><span class="cu-count">${clear ? '✓' : x.items.length}</span>
        </button>`;
        }).join('')}</div>`).join('')}
    </nav>
    <section class="cu-main">
      ${!q.items.length ? `<div class="sec">${emptyState({ icon: 'check', title: total ? `${q.title}: all clear` : 'Everything is up to date', body: withItems.length ? `Next: ${withItems[0].title} (${withItems[0].items.length}).` : 'No record needs a decision.', action: withItems.length ? { label: 'Go to next', onclick: `cleanupQueue('${withItems[0].id}')` } : undefined })}</div>`
        : mode === 'step' ? stepHtml(q, qs) : `<div class="cu-queue-hd"><div><h2>${escHtml(q.title)}</h2><p>${escHtml(q.why)}</p></div></div>${listHtml(q)}`}
    </section>`;
  renderIcons(root);
}
registerTabRenderer('cleanup', () => { void renderCleanup(); });

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function currentItem(q: CleanupQueue): { item: CleanupItem; index: number } | null {
  const skip = skipped.get(q.id) || new Set();
  const index = q.items.findIndex((x) => !skip.has(x.key));
  return index === -1 ? null : { item: q.items[index], index };
}

function chooserHtml(q: CleanupQueue, item: CleanupItem): string {
  const id = item.record.id;
  switch (chooser) {
    case 'lost':
      return `<div class="cu-chooser"><span>Why was it lost?</span>${LOSS_REASONS.map((r) => `<button class="prb-chip" onclick="cleanupApply('lost', ${JSON.stringify(r).replace(/"/g, '&quot;')})">${escHtml(r)}</button>`).join('')}</div>`;
    case 'snooze_followup':
      return `<div class="cu-chooser"><span>Check again in</span>${[7, 14, 30, 60].map((d) => `<button class="prb-chip" onclick="cleanupApply('snooze_followup', '${d}')">${d} days</button>`).join('')}</div>`;
    case 'set_industry':
      return `<div class="cu-chooser"><span>Industry</span><select class="fsel" id="cu-industry"><option value="">Choose…</option>${INDUSTRY_TAXONOMY.map((x) => `<option>${escHtml(x)}</option>`).join('')}</select><button class="btn-primary btn-sm" onclick="cleanupApply('set_industry', document.getElementById('cu-industry').value)">Save</button></div>`;
    case 'set_owner':
      return `<div class="cu-chooser"><span>Owner</span><input type="text" id="cu-owner" list="cu-owner-list" placeholder="Name" value="${escHtml(defaultOwner())}"><datalist id="cu-owner-list">${activeTeam().map((t) => `<option value="${escHtml(t.name)}">`).join('')}</datalist>
        <button class="btn-primary btn-sm" onclick="cleanupApply('set_owner', document.getElementById('cu-owner').value)">Save</button>
        ${q.items.length > 1 ? `<button class="btn-secondary btn-sm" onclick="cleanupOwnerForAll()">Use for all ${q.items.length}</button>` : ''}</div>`;
    case 'task_date':
      return `<div class="cu-chooser"><span>Due on</span><input type="date" id="cu-date" value="${today()}"><button class="btn-primary btn-sm" onclick="cleanupApply('task_date', document.getElementById('cu-date').value)">Save</button></div>`;
    case 'opportunity_details': {
      const o = S.opportunities.find((x) => x.id === id);
      if (!o) return '';
      return `<div class="cu-chooser cu-form">
        <label><span>Value</span><input type="number" id="cu-opp-value" value="${o.estimatedValue ?? ''}" placeholder="0"></label>
        <label><span>Currency</span><select class="fsel" id="cu-opp-currency">${['SAR', 'EUR', 'USD', 'AED'].map((c) => `<option${(o.currency || 'SAR') === c ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
        <label class="cu-grow"><span>Next step</span><input type="text" id="cu-opp-next" value="${escHtml(o.nextAction || '')}" placeholder="e.g. Send the proposal"></label>
        <label><span>Expected close</span><input type="date" id="cu-opp-close" value="${o.expectedCloseDate || ''}"></label>
        <button class="btn-primary btn-sm" onclick="cleanupApply('opportunity_details')">Save</button>
      </div>`;
    }
    default: return '';
  }
}

/** The person using the app: the team member with the Outlook account's email, if known. */
function defaultOwner(): string {
  const email = (S.ms365Status?.accountEmail || '').toLowerCase();
  const byEmail = activeTeam().find((t) => email && (t.email || '').toLowerCase() === email);
  const first = (S.ms365Status?.displayName || '').split(/\s+/)[0]?.toLowerCase();
  return byEmail?.name || activeTeam().find((t) => first && t.name.toLowerCase().startsWith(first))?.name || S.ms365Status?.displayName || '';
}

const NEEDS_CHOICE = new Set<CleanupAction>(['lost', 'snooze_followup', 'set_industry', 'set_owner', 'task_date', 'opportunity_details']);

function stepHtml(q: CleanupQueue, all: CleanupQueue[]): string {
  const cur = currentItem(q);
  const skippedCount = skipped.get(q.id)?.size || 0;
  if (!cur) {
    return `<div class="sec">${emptyState({ icon: 'check', title: `You've been through all ${q.items.length}`, body: `${skippedCount} skipped for now.`, action: { label: 'Start over', onclick: `cleanupRestart('${q.id}')` } })}</div>`;
  }
  const { item, index } = cur;
  const pos = reviewPosition(all, q.id, index);
  const card = cardFor(q, item, cardInput());
  const noun = item.record.kind === 'task' ? 'task' : item.record.kind;
  return `<article class="cu-card pk-cu-card">
    <div class="pk-cu-kind"><b>${escHtml(q.title)}</b><span class="pk-cu-prog">${pos.at} of ${pos.of}<span class="pk-cu-pbar"><i style="width:${pos.pct}%"></i></span></span></div>
    <div class="pk-cu-head">${item.record.kind === 'task' ? '<span class="pk-tile xl is-internal" aria-hidden="true">☑</span>' : tileHtml(item.title, 'pk-tile xl')}<div class="pk-cu-tt"><h3>${recordLink(item.record.kind, item.record.id, item.title)}${item.record.kind === 'proposal' ? `<span> — ${escHtml(item.subtitle.split(' · ').filter((x) => !x.startsWith('SL#') && !['Drafting', 'Proposal Request Received'].includes(x))[0] || '')}</span>` : ''}</h3><div class="pk-cu-s">${escHtml(card.meta)}</div></div></div>
    <div class="pk-facts">${card.panels.map((f) => `<div class="pk-fact${f.warn ? ' is-warn' : ''}"><b>${escHtml(f.value)}</b><span>${escHtml(f.caption)}</span></div>`).join('')}</div>
    <div class="pk-why">${escHtml(q.why)}</div>
    <div class="pk-choices">
      ${q.actions.map((a, i) => {
        const rec = card.recommend?.action === a;
        return `<button class="pk-choice${rec ? ' is-rec' : ''}${chooser === a ? ' is-open' : ''}${ACTION_TONE[a] === 'danger' && !rec ? ' is-danger' : ''}" onclick="cleanupAction('${a}')" aria-label="${escHtml(ACTION_LABEL[a])} — shortcut ${i + 1}"><kbd>${i + 1}</kbd><b>${escHtml(ACTION_LABEL[a])}</b><span>${escHtml(rec ? card.recommend!.hint : ACTION_HINT[a])}</span></button>`;
      }).join('')}
    </div>
    ${chooser && q.actions.includes(chooser) ? chooserHtml(q, item) : ''}
    <div class="pk-cu-foot"><span>Press 1–${q.actions.length} to decide · S to skip · ⌘Z to undo</span><span class="pk-cu-foot-r"><button class="btn-secondary btn-sm" onclick="cleanupOpen()">Open ${escHtml(noun)}</button><button class="btn-secondary btn-sm" onclick="cleanupSkip()">Skip →</button></span></div>
  </article>`;
}

function listHtml(q: CleanupQueue): string {
  const keys = new Set(q.items.map((x) => x.key));
  for (const k of [...selected]) if (!keys.has(k)) selected.delete(k);
  const n = selected.size;
  return `<div class="sec cu-list">
    <div class="cu-bulk${n ? ' has-selection' : ''}">
      <label class="check-label"><input type="checkbox" ${n && n === q.items.length ? 'checked' : ''} onchange="cleanupSelectAll(this.checked)"> ${n ? `${n} selected` : 'Select all'}</label>
      ${n ? q.bulk.map((a) => `<button class="btn-secondary btn-sm${ACTION_TONE[a] === 'danger' ? ' cu-danger' : ''}" onclick="cleanupBulk('${a}')">${escHtml(ACTION_LABEL[a])}</button>`).join('') : `<span class="t-muted">Select records to fix several at once</span>`}
    </div>
    <div class="cu-bulk-chooser" id="cu-bulk-chooser"></div>
    <div class="rec-list">${q.items.map((x) => `<div class="rec-row cu-row" onclick="if(!event.target.closest('input,a,button'))openRecord('${x.record.kind}', ${x.record.id})">
      <input type="checkbox" ${selected.has(x.key) ? 'checked' : ''} onchange="cleanupSelect('${escHtml(x.key)}', this.checked)" aria-label="Select ${escHtml(x.title)}">
      <div class="rec-row-main"><div class="rec-row-title">${recordLink(x.record.kind, x.record.id, x.title)}</div><div class="rec-row-sub">${escHtml(x.subtitle)}</div></div>
      <div class="cu-row-fact">${escHtml(x.facts[1]?.[1] || x.facts[0]?.[1] || '')}</div>
    </div>`).join('')}</div>
  </div>`;
}

// ── Navigation ──────────────────────────────────────────────────────────────

export function openCleanup(queue?: QueueId): void {
  if (queue) { currentQueue = queue; chooser = null; }
  if (S.currentTab === 'cleanup') void renderCleanup();
  else w.navToModule('cleanup');
}
expose('openCleanup', openCleanup);

export function cleanupQueue(id: QueueId): void {
  currentQueue = id;
  chooser = null;
  selected.clear();
  void renderCleanup();
}
expose('cleanupQueue', cleanupQueue);

export function cleanupMode(m: 'step' | 'list'): void {
  mode = m;
  chooser = null;
  void renderCleanup();
}
expose('cleanupMode', cleanupMode);

export function cleanupRestart(id: QueueId): void {
  skipped.delete(id);
  void renderCleanup();
}
expose('cleanupRestart', cleanupRestart);

function activeQueue(): CleanupQueue | null {
  return queues().find((q) => q.id === currentQueue) || null;
}

export function cleanupSkip(): void {
  const q = activeQueue();
  const cur = q && currentItem(q);
  if (!q || !cur) return;
  const set = skipped.get(q.id) || new Set<string>();
  set.add(cur.item.key);
  skipped.set(q.id, set);
  chooser = null;
  void renderCleanup();
}
expose('cleanupSkip', cleanupSkip);

export function cleanupOpen(): void {
  const q = activeQueue();
  const cur = q && currentItem(q);
  if (cur) w.openRecord(cur.item.record.kind, cur.item.record.id);
}
expose('cleanupOpen', cleanupOpen);

export function cleanupAction(action: CleanupAction): void {
  if (NEEDS_CHOICE.has(action)) {
    chooser = chooser === action ? null : action;
    void renderCleanup().then(() => {
      document.querySelector<HTMLElement>('.cu-chooser select, .cu-chooser input')?.focus();
    });
    return;
  }
  void cleanupApply(action);
}
expose('cleanupAction', cleanupAction);

// ── Applying fixes ──────────────────────────────────────────────────────────

type Undo = () => void;

function snapshot(item: CleanupItem): Undo {
  const { kind, id } = item.record;
  if (kind === 'proposal') {
    const p = S.proposals.find((x) => x.id === id); if (!p) return () => {};
    const before = structuredClone(p);
    return () => { Object.assign(p, before); persistProposals(); updateBadge(); refreshAll(); };
  }
  if (kind === 'agreement') {
    const a = S.agreements.find((x) => x.id === id); if (!a) return () => {};
    const before = structuredClone(a);
    return () => { Object.assign(a, before); persistAgreements(); refreshAll(); };
  }
  if (kind === 'opportunity') {
    const o = S.opportunities.find((x) => x.id === id); if (!o) return () => {};
    const before = structuredClone(o);
    return () => { Object.assign(o, before); void persistOpportunity(o); refreshAll(); };
  }
  if (kind === 'company') {
    const c = S.companies.find((x) => x.id === id); if (!c) return () => {};
    const before = structuredClone(c);
    return () => { void saveCompany(before).then((saved) => { replaceCompany(saved); refreshAll(); }); };
  }
  if (kind === 'task') {
    const t = S.todos.find((x) => x.id === id); if (!t) return () => {};
    const before = structuredClone(t);
    return () => { Object.assign(t, before); persistTodos(); refreshAll(); };
  }
  return () => {};
}

function replaceCompany(saved: Company): void {
  const i = S.companies.findIndex((c) => c.id === saved.id);
  if (i > -1) S.companies[i] = saved;
}

function saveKept(): void {
  void setAppMeta('cleanup_kept', JSON.stringify(kept)).catch(() => undefined);
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Applies one fix to one item. Returns an undo, or null if nothing changed
 * (or the fix continues in a dialog). */
async function applyTo(q: CleanupQueue, item: CleanupItem, action: CleanupAction, value?: string): Promise<Undo | null> {
  const id = item.record.id;
  const undo = snapshot(item);
  switch (action) {
    case 'commitment_edit': {
      // Continues in the commitment dialog; the queue recounts when it's saved.
      (window as any).openCommitmentModal?.(undefined, Number(item.key.split(':')[1]));
      return null;
    }
    case 'keep': {
      const key = `${q.id}|${item.key}`;
      const before = kept[key];
      kept[key] = addDaysIso(30);
      saveKept();
      return () => { if (before) kept[key] = before; else delete kept[key]; saveKept(); };
    }
    case 'lost': {
      const p = S.proposals.find((x) => x.id === id);
      if (!p || !value) return null;
      p.status = PS.LOST;
      p.winLossReason = value;
      p.snoozedUntil = null;
      p.notes = [...(p.notes || []), { id: Date.now() + Math.floor(Math.random() * 1000), date: today(), text: `[LOST: ${value}] Closed in clean-up` }];
      persistProposals();
      updateBadge();
      return undo;
    }
    case 'withdrawn': updateStatus(id, PS.WITHDRAWN); return undo;
    case 'won': openWlModal(id, 'won'); return null;
    case 'snooze_followup': snoozeProposal(id, Number(value) || 30); return undo;
    case 'nudge': {
      // A reminder to the reviewer goes in the activity log (it isn't contact with the client); the proposal leaves
      // this queue for a week. One undo takes back both.
      const p = S.proposals.find((x) => x.id === id);
      if (!p) return null;
      const who = teamMember(p.reviewerId)?.name || defaultReviewer()?.name || 'the reviewer';
      let entryId: number;
      try {
        entryId = await activityLog({ action: 'review_nudged', entityType: 'proposal', entityId: id, entityLabel: `${p.client} — ${p.type || 'proposal'}`, detail: `Nudged ${who} about the review`, companyId: p.companyId ?? null });
      } catch (err) {
        toast("Couldn't log the nudge", { tone: 'error', detail: String(err) });
        return null;
      }
      const key = `${q.id}|${item.key}`;
      const before = kept[key];
      kept[key] = addDaysIso(7);
      saveKept();
      return () => { void activityRemove(entryId); if (before) kept[key] = before; else delete kept[key]; saveKept(); };
    }
    case 'add_contact': {
      // Continues in the contact dialog; the queue recounts when the contact is saved.
      const c = S.companies.find((x) => x.id === id);
      if (c) w.openContactModal?.(c.name, c.id);
      return null;
    }
    case 'approve': recordReview(id, 'approved', 'Recorded in clean-up'); return undo;
    case 'changes': recordReview(id, 'changes_requested', null); return undo;
    case 'back_to_drafting': updateStatus(id, PS.DRAFTING); return undo;
    case 'agreement_active':
    case 'agreement_not_started':
    case 'agreement_ended': {
      const a = S.agreements.find((x) => x.id === id);
      if (!a) return null;
      const status: ServiceStatus = action === 'agreement_active' ? 'Active' : action === 'agreement_ended' ? 'Ended' : 'Not started';
      a.serviceStatus = status;
      if (status === 'Not started') a.startDate = null;
      persistAgreements();
      return undo;
    }
    case 'opportunity_details': {
      const o = S.opportunities.find((x) => x.id === id);
      if (!o) return null;
      const num = (document.getElementById('cu-opp-value') as HTMLInputElement | null)?.value;
      o.estimatedValue = num ? Number(num) : o.estimatedValue;
      o.currency = (document.getElementById('cu-opp-currency') as HTMLSelectElement | null)?.value || currencyOf(o);
      o.nextAction = (document.getElementById('cu-opp-next') as HTMLInputElement | null)?.value.trim() || o.nextAction;
      o.expectedCloseDate = (document.getElementById('cu-opp-close') as HTMLInputElement | null)?.value || o.expectedCloseDate;
      const saved = await persistOpportunity(o);
      if (saved) Object.assign(o, saved);
      return undo;
    }
    case 'opportunity_lost': void updateOpportunityStage(id, 'Lost'); return null;
    case 'set_industry':
    case 'set_owner': {
      const c = S.companies.find((x) => x.id === id);
      if (!c || !value?.trim()) return null;
      const next = action === 'set_industry' ? { ...c, industries: [...new Set([...(c.industries || []), value])] } : { ...c, owner: value.trim() };
      replaceCompany(await saveCompany(next));
      return undo;
    }
    case 'task_done': toggleTodoDone(id); return undo;
    case 'task_someday': setTasksSomeday([id]); return undo;
    case 'task_date': if (!value) return null; setTasksDue([id], value); return undo;
    case 'task_delete': return null; // handled by the caller, with Tasks' own undo
  }
  return null;
}

export async function cleanupApply(action: CleanupAction, value?: string): Promise<void> {
  const q = activeQueue();
  const cur = q && currentItem(q);
  if (!q || !cur) return;
  if (action === 'task_delete') {
    deleteTasks([cur.item.record.id]);
    countCleared(1);
    chooser = null;
    void renderCleanup();
    return;
  }
  if (NEEDS_CHOICE.has(action) && action !== 'opportunity_details' && !value) { toast('Choose an option first', { tone: 'error' }); return; }
  const undo = await applyTo(q, cur.item, action, value);
  chooser = null;
  if (undo) {
    countCleared(1);
    undoToast(`${cur.item.title}: ${ACTION_LABEL[action].toLowerCase()}`, () => { undo(); countCleared(-1); void renderCleanup(); });
  }
  refreshAll();
  void renderCleanup();
}
expose('cleanupApply', cleanupApply);

export async function cleanupOwnerForAll(): Promise<void> {
  const q = activeQueue();
  const owner = (document.getElementById('cu-owner') as HTMLInputElement | null)?.value.trim();
  if (!q || !owner) return;
  await bulkApply(q, q.items, 'set_owner', owner);
}
expose('cleanupOwnerForAll', cleanupOwnerForAll);

// ── List mode: selection and bulk fixes ─────────────────────────────────────

export function cleanupSelect(key: string, on: boolean): void {
  if (on) selected.add(key); else selected.delete(key);
  void renderCleanup();
}
expose('cleanupSelect', cleanupSelect);

export function cleanupSelectAll(on: boolean): void {
  const q = activeQueue();
  selected.clear();
  if (on && q) q.items.forEach((x) => selected.add(x.key));
  void renderCleanup();
}
expose('cleanupSelectAll', cleanupSelectAll);

async function bulkApply(q: CleanupQueue, items: CleanupItem[], action: CleanupAction, value?: string): Promise<void> {
  if (action === 'task_delete') {
    deleteTasks(items.map((x) => x.record.id));
    selected.clear();
    countCleared(items.length);
    void renderCleanup();
    return;
  }
  const undos: Undo[] = [];
  for (const item of items) {
    const u = await applyTo(q, item, action, value);
    if (u) undos.push(u);
  }
  selected.clear();
  countCleared(undos.length);
  refreshAll();
  void renderCleanup();
  if (undos.length) undoToast(`${ACTION_LABEL[action]}: ${undos.length} record${undos.length === 1 ? '' : 's'}`, () => {
    undos.reverse().forEach((u) => u());
    countCleared(-undos.length);
    void renderCleanup();
  });
}

export function cleanupBulk(action: CleanupAction): void {
  const q = activeQueue();
  if (!q) return;
  const items = q.items.filter((x) => selected.has(x.key));
  if (!items.length) return;
  const el = document.getElementById('cu-bulk-chooser');
  const go = (value?: string) => { void bulkApply(q, items, action, value); };
  if (action === 'lost' && el) {
    el.innerHTML = `<div class="cu-chooser"><span>Why were these ${items.length} lost?</span>${LOSS_REASONS.map((r, i) => `<button class="prb-chip" data-i="${i}">${escHtml(r)}</button>`).join('')}</div>`;
    el.querySelectorAll<HTMLButtonElement>('button[data-i]').forEach((b) => b.addEventListener('click', () => go(LOSS_REASONS[Number(b.dataset.i)])));
    return;
  }
  if (action === 'snooze_followup' && el) {
    el.innerHTML = `<div class="cu-chooser"><span>Check again in</span>${[7, 14, 30, 60].map((d) => `<button class="prb-chip" data-d="${d}">${d} days</button>`).join('')}</div>`;
    el.querySelectorAll<HTMLButtonElement>('button[data-d]').forEach((b) => b.addEventListener('click', () => go(b.dataset.d)));
    return;
  }
  if ((action === 'set_industry' || action === 'set_owner') && el) {
    el.innerHTML = action === 'set_industry'
      ? `<div class="cu-chooser"><span>Industry for ${items.length}</span><select class="fsel" id="cu-bulk-value"><option value="">Choose…</option>${INDUSTRY_TAXONOMY.map((x) => `<option>${escHtml(x)}</option>`).join('')}</select><button class="btn-primary btn-sm" id="cu-bulk-go">Apply</button></div>`
      : `<div class="cu-chooser"><span>Owner for ${items.length}</span><input type="text" id="cu-bulk-value" list="cu-owner-list-bulk" value="${escHtml(defaultOwner())}"><datalist id="cu-owner-list-bulk">${activeTeam().map((t) => `<option value="${escHtml(t.name)}">`).join('')}</datalist><button class="btn-primary btn-sm" id="cu-bulk-go">Apply</button></div>`;
    document.getElementById('cu-bulk-go')?.addEventListener('click', () => {
      const v = (document.getElementById('cu-bulk-value') as HTMLInputElement | HTMLSelectElement | null)?.value || '';
      if (!v.trim()) { toast('Choose a value first', { tone: 'error' }); return; }
      go(v);
    });
    return;
  }
  go();
}
expose('cleanupBulk', cleanupBulk);

// ── Badge, keyboard, live updates ───────────────────────────────────────────

function updateCleanupBadge(): void {
  const el = document.getElementById('cleanup-badge');
  if (!el) return;
  const n = totalToClean(queues());
  el.textContent = String(n);
  el.style.display = n > 0 ? '' : 'none';
}
registerBadgeUpdater(updateCleanupBadge);

// Clean-up's keys (core/keys.ts): 1–9 apply the numbered fix, → skips.
registerKey({ scope: 'list', tabs: ['cleanup'], combo: 'arrowright', label: 'Skip to the next record', group: 'Clean-up', note: 'or S', when: () => mode === 'step' && !!activeQueue(), run: () => cleanupSkip() });
registerKey({ scope: 'list', tabs: ['cleanup'], combo: 's', when: () => mode === 'step' && !!activeQueue(), run: () => cleanupSkip() });
for (let n = 1; n <= 9; n++) {
  registerKey({
    scope: 'list', tabs: ['cleanup'], combo: String(n), ...(n === 1 ? { label: 'Apply the numbered fix', group: 'Clean-up', note: '1 to 9' } : {}),
    when: () => mode === 'step' && (activeQueue()?.actions.length ?? 0) >= n,
    run: () => cleanupAction(activeQueue()!.actions[n - 1]),
  });
}

let pendingRender: ReturnType<typeof setTimeout> | null = null;
onChange(() => {
  if (pendingRender) clearTimeout(pendingRender);
  pendingRender = setTimeout(() => {
    pendingRender = null;
    updateCleanupBadge();
    if (getActiveTabId() === 'cleanup') void renderCleanup();
  }, 150);
});
