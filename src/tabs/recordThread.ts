// The engagement thread and record timeline on opportunity, proposal,
// agreement and project pages: renders the shared strip and timeline
// (src/lib/threadStrip.ts, src/lib/timeline.ts) from the pure rules
// (workGraph.engagementThread, recordTimeline.buildRecordTimeline) and
// handles their actions. Nothing is created without being asked.

import { S } from '../lib/state';
import { renderIcons } from '../core/chrome';
import { toast } from '../lib/ui';
import { escHtml, expose, today } from '../lib/utils';
import { getActivity } from '../lib/db';
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
import type { ActivityEntry, Agreement, Milestone } from '../lib/types';
import type { FeedItem } from '../lib/activityFeed';

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
  fitThreadStrip(el);
}

/** A missing step never sits alone on a second line: if the last one wraps
 * by itself, it's dropped (with its gap) rather than wrapped. */
export function fitThreadStrip(host: HTMLElement): void {
  const strip = host.querySelector('.thread-strip');
  if (!strip) return;
  for (let guard = 0; guard < 3; guard++) {
    const nodes = [...strip.querySelectorAll<HTMLElement>(':scope > .ts-node')];
    if (nodes.length < 2) return;
    const last = nodes[nodes.length - 1];
    const prev = nodes[nodes.length - 2];
    if (!last.classList.contains('is-missing') || last.querySelector('.ts-next')) return;
    if (last.offsetTop <= prev.offsetTop + 2) return;
    const gap = last.previousElementSibling;
    last.remove();
    if (gap?.classList.contains('ts-gap')) gap.remove();
  }
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

interface TimelineMount {
  elId: string;
  /** The record — or, on Company 360, the company (every record of it, and its own meetings, tasks and promises). */
  record?: Rec; company?: { id: number | null; name: string };
  /** Opportunity and project pages show the whole engagement (every record on the thread). */
  scopeToggle: boolean;
  /** Dated history that isn't in the activity log (given the log's rows, to avoid repeating them). */
  extraPast?: (activity: ActivityEntry[]) => FeedItem[]; header?: string; milestones?: () => Milestone[]; skipPast?: (action: string) => boolean }
const mounts = new Map<string, TimelineMount>();
const showAll = new Set<string>();
const PAST_LIMIT = 15;

/** Every opportunity, proposal, agreement and project of a company. */
function companyTimelineRecords(co: { id: number | null; name: string }): Rec[] {
  const of = (id: number | null | undefined, name: string | null | undefined) => (id != null && co.id != null ? id === co.id : !!name && name === co.name);
  return [
    ...S.opportunities.filter((o) => !o.archived && of(o.companyId, o.companyName)).map((o) => ({ kind: 'opportunity' as const, id: o.id })),
    ...S.proposals.filter((p) => !p.archived && of(p.companyId, p.client)).map((p) => ({ kind: 'proposal' as const, id: p.id })),
    ...S.agreements.filter((a) => of(a.companyId, a.client)).map((a) => ({ kind: 'agreement' as const, id: a.id })),
    ...S.projects.filter((p) => !p.archived && of(p.companyId, p.companyName)).map((p) => ({ kind: 'project' as const, id: p.id })),
  ];
}

/** A record's timeline, replacing its Activity section. */
export async function renderRecordTimeline(m: TimelineMount): Promise<void> {
  mounts.set(m.elId, m);
  const el = document.getElementById(m.elId);
  if (!el) return;
  const co = m.company;
  const thread = m.record ? engagementThread(m.record, S, today()) : null;
  const useThread = !!thread && m.scopeToggle && thread.nodes.length > 1;
  const records: Rec[] = co
    ? companyTimelineRecords(co)
    : useThread
      ? thread!.nodes.flatMap((n) => [{ kind: n.kind, id: n.id }, ...(n.others || []).map((o) => ({ kind: 'agreement' as const, id: o.id }))])
      : [m.record!];
  const activity = await (co ? getActivity({ companyId: co.id ?? undefined, limit: 400 }) : getActivity({ records, limit: 400 })).catch(() => []);
  if (!document.getElementById(m.elId)) return;
  const tl = buildRecordTimeline(records, {
    today: today(), activity: m.skipPast ? activity.filter((a) => !m.skipPast!(a.action)) : activity,
    meetings: S.meetings, todos: S.todos, commitments: S.commitments, opportunities: S.opportunities, proposals: S.proposals,
    agreements: S.agreements, projects: S.projects, milestones: m.milestones?.() || [], company: co,
  });
  const now = new Date();
  el.innerHTML = `<div class="rec-section-hd tl-hd"><h2>Timeline</h2><div class="rec-section-actions">${m.header || ''}</div></div>
    <div class="tl">${recordTimelineHtml(tl, {
      today: today(), nowLabel: `Now · ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
      pastLimit: showAll.has(m.elId) ? null : PAST_LIMIT, showEarlier: `showEarlierTimeline('${m.elId}')`, extraPast: m.extraPast?.(activity),
    })}</div>`;
  renderIcons(el);
}

export function rerenderTimelines(): void {
  for (const m of mounts.values()) if (document.getElementById(m.elId)) void renderRecordTimeline(m);
}


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

