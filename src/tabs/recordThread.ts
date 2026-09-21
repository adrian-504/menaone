// The engagement thread and record timeline on opportunity, proposal,
// agreement and project pages: renders the shared strip and timeline
// (src/lib/threadStrip.ts, src/lib/timeline.ts) from the pure rules
// (workGraph.engagementThread, recordTimeline.buildRecordTimeline) and
// handles their actions. Nothing is created without being asked.

import { S } from '../lib/state';
import { renderIcons } from '../core/chrome';
import { toast } from '../lib/ui';
import { escHtml, expose, today } from '../lib/utils';
import { getActivity, getAppMeta, setAppMeta } from '../lib/db';
import { invoke } from '@tauri-apps/api/core';
import { refreshAll } from '../lib/registry';
import { onChange, touches } from '../lib/changes';
import { markAgreementsSaved } from '../lib/persist';
import { showContextMenu } from '../lib/contextMenu';
import { engagementThread, type ThreadKind } from '../lib/workGraph';
import { threadStripHtml } from '../lib/threadStrip';
import { buildRecordTimeline } from '../lib/recordTimeline';
import { recordTimelineHtml } from '../lib/timeline';
import { setCommitmentKept } from './commitments';
import { toggleTodoDone } from './todo';
import type { Agreement, Milestone } from '../lib/types';

type Rec = { kind: ThreadKind; id: number };
const w = () => window as any;

// ── Strip ───────────────────────────────────────────────────────────────────

export function renderThreadStrip(elId: string, record: Rec): void {
  const el = document.getElementById(elId);
  if (!el) return;
  const html = threadStripHtml(engagementThread(record, S, today()), record);
  el.innerHTML = html;
  el.hidden = !html;
  renderIcons(el);
}

/** The strip's one next action. */
export async function threadNext(action: string, kind: ThreadKind, id: number): Promise<void> {
  if (action === 'create_proposal') {
    w().createProposalForOpportunity?.(id);
    return;
  }
  if (action === 'create_project') { w().createProjectForOpportunity?.(id); return; }
  if (action === 'draft_agreement') {
    try {
      const created = await invoke<Agreement[]>('draft_agreement_for_proposal', { proposalId: id });
      if (!created.length) { toast('Nothing to draft', { detail: 'This proposal already has an agreement, or isn\'t signed by both parties.' }); return; }
      S.agreements.push(...created);
      markAgreementsSaved(created);
      refreshAll();
      toast(`Drafted ${created[0].agrRef || 'the agreement'}`, { detail: 'In Preparation, with the proposal\'s price lines — check the terms before sending.', action: { label: 'Open', run: () => w().openRecord('agreement', created[0].id) } });
    } catch (err) {
      toast('Could not draft the agreement', { tone: 'error', detail: String(err) });
    }
    return;
  }
  // 'open': the record's own page has the button for its next step.
  const here = kind === 'proposal' && S.currentProposalId === id && document.getElementById('pr-detail')?.classList.contains('open');
  if (here) { (document.querySelector('#prd-actions .btn-primary') as HTMLElement | null)?.click(); return; }
  w().openRecord(kind, id);
}
expose('threadNext', (a: string, k: ThreadKind, id: number) => { void threadNext(a, k, id); });

export function threadOthersMenu(e: MouseEvent, json: string): void {
  e.stopPropagation();
  let others: { id: number; label: string }[] = [];
  try { others = JSON.parse(json); } catch { return; }
  showContextMenu(e, others.map((o) => ({ label: o.label, iconName: 'document', run: () => w().openRecord('agreement', o.id) })));
}
expose('threadOthersMenu', threadOthersMenu);

// ── Timeline ────────────────────────────────────────────────────────────────

let scope: 'record' | 'engagement' = 'record';
let scopeLoaded = false;
async function loadScope(): Promise<void> {
  if (scopeLoaded) return;
  scopeLoaded = true;
  try { scope = (await getAppMeta('timeline_scope')) === 'engagement' ? 'engagement' : 'record'; } catch { /* default */ }
}

interface TimelineMount { elId: string; record: Rec; scopeToggle: boolean; header?: string; milestones?: () => Milestone[]; skipPast?: (action: string) => boolean }
const mounts = new Map<string, TimelineMount>();
const showAll = new Set<string>();
const PAST_LIMIT = 15;

/** A record's timeline, replacing its Activity section. */
export async function renderRecordTimeline(m: TimelineMount): Promise<void> {
  mounts.set(m.elId, m);
  await loadScope();
  const el = document.getElementById(m.elId);
  if (!el) return;
  const thread = engagementThread(m.record, S, today());
  const useThread = m.scopeToggle && scope === 'engagement' && thread.nodes.length > 1;
  const records: Rec[] = useThread
    ? thread.nodes.flatMap((n) => [{ kind: n.kind, id: n.id }, ...(n.others || []).map((o) => ({ kind: 'agreement' as const, id: o.id }))])
    : [m.record];
  const activity = await getActivity({ records, limit: 400 }).catch(() => []);
  if (!document.getElementById(m.elId)) return;
  const tl = buildRecordTimeline(records, {
    today: today(), activity: m.skipPast ? activity.filter((a) => !m.skipPast!(a.action)) : activity,
    meetings: S.meetings, todos: S.todos, commitments: S.commitments, opportunities: S.opportunities, proposals: S.proposals,
    agreements: S.agreements, projects: S.projects, milestones: m.milestones?.() || [],
  });
  const now = new Date();
  const toggle = m.scopeToggle && thread.nodes.length > 1
    ? `<div class="segmented tl-scope" role="group" aria-label="Timeline of">
        <button class="${scope === 'record' ? 'active' : ''}" onclick="setTimelineScope('record')">This ${m.record.kind}</button>
        <button class="${scope === 'engagement' ? 'active' : ''}" onclick="setTimelineScope('engagement')">Whole engagement</button></div>`
    : '';
  el.innerHTML = `<div class="rec-section-hd tl-hd"><h2>Timeline</h2>${toggle}<div class="rec-section-actions">${m.header || ''}</div></div>
    <div class="tl">${recordTimelineHtml(tl, {
      today: today(), nowLabel: `Now · ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
      pastLimit: showAll.has(m.elId) ? null : PAST_LIMIT, showEarlier: `showEarlierTimeline('${m.elId}')`,
    })}</div>`;
  renderIcons(el);
}

export function rerenderTimelines(): void {
  for (const m of mounts.values()) if (document.getElementById(m.elId)) void renderRecordTimeline(m);
}

export function setTimelineScope(v: 'record' | 'engagement'): void {
  scope = v;
  void setAppMeta('timeline_scope', v).catch(() => undefined);
  rerenderTimelines();
}
expose('setTimelineScope', setTimelineScope);

export function showEarlierTimeline(elId: string): void {
  showAll.add(elId);
  const m = mounts.get(elId);
  if (m) void renderRecordTimeline(m);
}
expose('showEarlierTimeline', showEarlierTimeline);

/** The one inline action on a future row. */
export function timelineAct(kind: string, id: number): void {
  if (kind === 'complete_task') toggleTodoDone(id);
  if (kind === 'mark_kept') setCommitmentKept(id, true);
}
expose('timelineAct', timelineAct);
expose('rerenderRecordTimelines', rerenderTimelines);

// Work saved anywhere (a task done, a meeting booked, a promise kept) shows on
// an open timeline straight away.
onChange((changes) => {
  if ((['task', 'meeting', 'commitment'] as const).some((k) => touches(changes, k))) rerenderTimelines();
});

/** Escapes for use inside an onclick attribute. */
export const attrJs = (s: string) => escHtml(s).replace(/'/g, '&#39;');
