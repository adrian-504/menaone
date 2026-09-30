// My Day, focused (1.57 "myday-focus", owner, 30-Sep-2026: "I love the new
// My Day"). The rail answers three questions: which proposals are in play and
// where each one waits (to draft · with Hassan · with clients), what's coming
// in the next seven days, and whether anything regulatory is critical. Pure:
// the tab (tabs/myday.ts) renders what these return.

import type { Agreement, Commitment, IntelligenceItem, Meeting, Proposal } from './types';
import { PS, proposalSentDate } from './commercial';
import { openRevision } from './revisions';
import { lastTouch, type TouchContext } from './followup';
import { daysBetween } from './pipeline';
import { agreementRenewal, addDays } from './myday';
import { fmtDateShort, fmtDateWeekday } from './dates';

// ── Proposals in play ───────────────────────────────────────────────────────

export type Stage = 'draft' | 'hassan' | 'client';
export const STAGE_ORDER: Stage[] = ['draft', 'hassan', 'client'];
export const STAGE_LABEL: Record<Stage, string> = { draft: 'To draft', hassan: 'With Hassan', client: 'With clients' };

export type PlayAction = 'draft' | 'nudge' | 'followed_up' | 'revision_sent';
export interface PlayRow {
  id: number;
  stage: Stage;
  client: string;
  companyId: number | null;
  service: string;
  meta: string;
  /** Days waiting in this stage (the sort key). */
  age: number;
  ageLabel: string;
  tone: 'red' | 'amber' | null;
  action: { kind: PlayAction; label: string };
}
export interface StagePanel { stage: Stage; count: number; oldest: number }
export interface InPlay { total: number; stages: StagePanel[]; rows: PlayRow[]; hidden: Record<Stage, number> }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ago = (n: number) => (n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);
const weekdayShort = (iso: string) => fmtDateWeekday(iso);

/** Where a live proposal waits, or null when it isn't in play. Pure. */
export function stageOf(p: Pick<Proposal, 'status' | 'archived' | 'revisions'>): Stage | null {
  if (p.archived) return null;
  if (p.status === PS.REQUEST) return 'draft';
  // A revision the client asked for: the proposal was sent; the ball is with us but it's a client conversation.
  if (p.status === PS.DRAFTING) return openRevision(p) ? 'client' : 'draft';
  if (p.status === PS.REVIEW) return 'hassan';
  if (p.status === PS.SENT) return 'client';
  return null;
}

export function playRow(p: Proposal, ctx: TouchContext & { reviewerName?: (p: Proposal) => string }): PlayRow | null {
  const stage = stageOf(p);
  if (!stage) return null;
  const today = ctx.today;
  const service = p.type || (p.lines || []).map((l) => l.serviceName).filter(Boolean).join(' + ') || 'Proposal';
  const base = { id: p.id, stage, client: p.client, companyId: p.companyId ?? null, service };
  if (stage === 'draft') {
    const age = Math.max(0, daysBetween(p.dateAdded, today) ?? 0);
    const left = p.promisedBy ? daysBetween(today, p.promisedBy) : null;
    const promise = p.promisedBy ? `promised ${weekdayShort(p.promisedBy)}` : 'no promise';
    const urgent = left != null && left <= 2;
    const ageLabel = left == null || !urgent ? plural(age, 'day') : left < 0 ? `${plural(-left, 'day')} late` : left === 0 ? 'due today' : `${plural(left, 'day')} left`;
    return { ...base, meta: `${p.status === PS.DRAFTING ? 'Drafting' : 'Requested'} ${ago(age)} · ${promise}`, age, ageLabel, tone: urgent ? 'red' : null, action: { kind: 'draft', label: p.status === PS.DRAFTING ? 'Open' : 'Draft' } };
  }
  if (stage === 'hassan') {
    const since = p.reviewRequestedAt || p.dateSentToHassan;
    const age = Math.max(0, daysBetween(since, today) ?? 0);
    return { ...base, meta: since ? `In review since ${fmtDateShort(since)}` : 'In review', age, ageLabel: plural(age, 'day'), tone: age >= 14 ? 'amber' : null, action: { kind: 'nudge', label: 'Nudge' } };
  }
  const sent = proposalSentDate(p);
  const rev = openRevision(p);
  const touch = lastTouch(p, ctx);
  const age = touch?.days ?? Math.max(0, daysBetween(sent, today) ?? 0);
  const expires = p.validUntil && p.validUntil >= today && (daysBetween(today, p.validUntil) ?? 99) <= 30 ? p.validUntil : null;
  const second = rev ? `revision ${rev.number} open` : expires ? `offer expires ${fmtDateShort(expires)}` : touch && touch.kind !== 'sent' ? `last touch ${fmtDateShort(touch.date)}` : 'no answer yet';
  return {
    ...base, meta: `${sent ? `Sent ${fmtDateShort(sent)}` : 'Sent'} · ${second}`, age, ageLabel: plural(age, 'day'), tone: age > 30 ? 'amber' : null,
    action: rev ? { kind: 'revision_sent', label: 'Mark revision sent' } : { kind: 'followed_up', label: 'Followed up' },
  };
}

/** The in-play picture: stage counts with their oldest, and the six rows that have waited longest, shown in stage order. */
export function buildInPlay(proposals: Proposal[], ctx: TouchContext, cap = 6): InPlay {
  const all = proposals.map((p) => playRow(p, ctx)).filter((r): r is PlayRow => !!r);
  const stages = STAGE_ORDER.map((stage) => {
    const mine = all.filter((r) => r.stage === stage);
    return { stage, count: mine.length, oldest: Math.max(0, ...mine.map((r) => r.age)) };
  }).filter((s) => s.count > 0);
  const urgentFirst = (a: PlayRow, b: PlayRow) => (a.tone === 'red' ? 0 : 1) - (b.tone === 'red' ? 0 : 1) || b.age - a.age;
  const picked = new Set([...all].sort(urgentFirst).slice(0, cap).map((r) => r.id));
  const rows = STAGE_ORDER.flatMap((stage) => all.filter((r) => r.stage === stage && picked.has(r.id)).sort(urgentFirst));
  const hidden = Object.fromEntries(STAGE_ORDER.map((s) => [s, all.filter((r) => r.stage === s && !picked.has(r.id)).length])) as Record<Stage, number>;
  return { total: all.length, stages, rows, hidden };
}

// ── Coming up ───────────────────────────────────────────────────────────────

export type ComingKind = 'meeting' | 'promise_ours' | 'promise_theirs' | 'expiry' | 'notice' | 'proposal_promised';
export interface ComingItem { kind: ComingKind; title: string; detail: string; time?: string; record: { kind: 'meeting' | 'proposal' | 'agreement' | 'company' | 'opportunity' | 'project'; id: number } | null; companyId?: number | null; companyName?: string | null }
export interface ComingDay { date: string; items: ComingItem[] }

const KIND_ORDER: Record<ComingKind, number> = { meeting: 0, promise_ours: 1, proposal_promised: 1, promise_theirs: 2, expiry: 3, notice: 4 };

/** The next seven days: meetings from tomorrow (today's are in Today), and from today on the promises either side,
 * offer expiries, and agreement notice windows opening. Days with nothing aren't listed; at most `cap` items. Pure. */
export function buildComingUpFocus(i: {
  today: string; meetings: Meeting[]; commitments?: Commitment[]; proposals: Proposal[]; agreements: Agreement[];
  companies?: { id: number; name: string }[]; timeOf?: (iso: string) => string;
}, span = 7, cap = 10): ComingDay[] {
  const last = addDays(i.today, span);
  const inRange = (d: string | null | undefined, from = i.today): d is string => !!d && d.slice(0, 10) >= from && d.slice(0, 10) <= last;
  const tomorrow = addDays(i.today, 1);
  const out: (ComingItem & { date: string; sort: string })[] = [];
  const company = (id: number | null | undefined) => (id == null ? null : (i.companies || []).find((c) => c.id === id)?.name ?? null);
  for (const m of i.meetings) {
    if (m.isCancelled || !inRange(m.meetingDate, tomorrow)) continue;
    const who = [(m.attendees || []).slice(0, 2).map((a) => a.split('@')[0]).join(', '), m.isOnlineMeeting ? 'Teams' : m.location || ''].filter(Boolean).join(' · ');
    out.push({ date: m.meetingDate!, sort: `0${m.startAt || ''}`, kind: 'meeting', title: m.title, detail: who, time: m.startAt && i.timeOf ? i.timeOf(m.startAt) : undefined,
      record: { kind: 'meeting', id: m.id }, companyId: m.companyId ?? null, companyName: m.companyName });
  }
  for (const c of i.commitments || []) {
    if (c.status !== 'open' || !inRange(c.dueDate)) continue;
    const ours = c.direction === 'ours';
    const record = c.opportunityId != null ? { kind: 'opportunity' as const, id: c.opportunityId } : c.projectId != null ? { kind: 'project' as const, id: c.projectId }
      : c.sourceType === 'meeting' && c.sourceId != null ? { kind: 'meeting' as const, id: c.sourceId } : c.companyId != null ? { kind: 'company' as const, id: c.companyId } : null;
    out.push({ date: c.dueDate!, sort: '1', kind: ours ? 'promise_ours' : 'promise_theirs', title: c.text, detail: ours ? `You promised it by ${weekdayShort(c.dueDate!)}` : 'They promised · owed to you',
      record, companyId: c.companyId, companyName: company(c.companyId) });
  }
  for (const p of i.proposals) {
    if (p.archived) continue;
    if ((p.status === PS.REQUEST || p.status === PS.DRAFTING) && inRange(p.promisedBy)) {
      out.push({ date: p.promisedBy!, sort: '1', kind: 'proposal_promised', title: `${p.client} — ${p.type || 'proposal'}`, detail: `You promised it by ${weekdayShort(p.promisedBy!)}`, record: { kind: 'proposal', id: p.id }, companyId: p.companyId ?? null, companyName: p.client });
    }
    if (p.status === PS.SENT && inRange(p.validUntil)) {
      const sent = proposalSentDate(p);
      const validity = sent ? daysBetween(sent, p.validUntil!) : null;
      out.push({ date: p.validUntil!, sort: '3', kind: 'expiry', title: `${p.client} — offer expires`, detail: [sent ? `Sent ${fmtDateShort(sent)}` : '', validity ? `${validity}-day validity` : ''].filter(Boolean).join(' · '),
        record: { kind: 'proposal', id: p.id }, companyId: p.companyId ?? null, companyName: p.client });
    }
  }
  for (const a of i.agreements) {
    if (a.status === 'Canceled' || a.serviceStatus === 'Ended') continue;
    const r = agreementRenewal(a, i.today);
    if (!r.noticeDate || !inRange(r.noticeDate)) continue;
    out.push({ date: r.noticeDate, sort: '4', kind: 'notice', title: `${a.client || a.agrRef || 'Agreement'} — notice window opens`, detail: `Ends ${fmtDateShort(a.endDate!, true)} · ${a.noticeDays}-day notice`,
      record: { kind: 'agreement', id: a.id }, companyId: a.companyId ?? null, companyName: a.client });
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.sort.localeCompare(b.sort));
  const days: ComingDay[] = [];
  for (const it of out.slice(0, cap)) {
    const { date, sort: _s, ...item } = it;
    const day = days.find((d) => d.date === date);
    if (day) day.items.push(item); else days.push({ date, items: [item] });
  }
  return days;
}

/** How many items the cap left out (for "More"). Pure. */
export function comingUpTotal(days: ComingDay[]): number {
  return days.reduce((n, d) => n + d.items.length, 0);
}

// ── Regulatory ──────────────────────────────────────────────────────────────

export interface RegulatoryNote { item: IntelligenceItem; clients: { id: number | null; name: string }[] }

/** Critical stories only, newest first, at most two; each with the clients whose services it touches. Pure. */
export function regulatoryNotes(items: IntelligenceItem[], clientServices: { id: number | null; name: string; services: string[] }[], max = 2): RegulatoryNote[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  return items
    .filter((x) => x.importance === 'critical' && !x.archived)
    .sort((a, b) => (b.publishedAt || b.createdAt || '').localeCompare(a.publishedAt || a.createdAt || ''))
    .slice(0, max)
    .map((item) => {
      const touched = (item.affectedServices || []).map(norm).filter(Boolean);
      const clients = touched.length ? clientServices.filter((c) => c.services.some((s) => touched.some((t) => norm(s).includes(t) || t.includes(norm(s))))).map(({ id, name }) => ({ id, name })) : [];
      return { item, clients };
    });
}
