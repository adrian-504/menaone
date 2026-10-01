// Pending and Follow-up in My Day's language (1.59 "pages"). What each row and
// strip panel says: where a proposal waits, how long, what it's worth, the
// contact trail since it was sent. Pure: tabs/pending.ts and tabs/followup.ts
// draw what these return with lib/pageKit.ts.

import type { Proposal, Touch } from './types';
import { PS, fmtMoney, currencyOf, proposalSentDate } from './commercial';
import { daysBetween } from './pipeline';
import { openRevision, revisionOf } from './revisions';
import { touchesOf, FOLLOW_UP_AFTER_DAYS, type LastTouch } from './followup';
import { fmtDateShort, fmtDateWeekday, fmtWeekday } from './dates';
import { ageTone, moneyTotal, plural, type StripPanel, type Tone } from './pageKit';

// ── Shared ──────────────────────────────────────────────────────────────────

export interface MetaBit { text: string; tone?: 'red' | 'amber'; chip?: boolean }
export type RowActionKind = 'draft' | 'generate' | 'review' | 'nudge' | 'record' | 'mark_sent' | 'changes' | 'followed_up' | 'mark_lost';
export interface RowAction { kind: RowActionKind; label: string }

export interface QueueRow {
  id: number;
  bucket: string;
  client: string;
  companyId: number | null;
  service: string;
  meta: MetaBit[];
  age: number | null;
  ageCaption: string;
  tone: 'red' | 'amber' | 'ok';
  amount: string | null;
  amountCaption: string;
  actions: RowAction[];
  /** May this row's first action be the page's one blue button? */
  urgent: boolean;
}

const serviceOf = (p: Proposal) => p.type || (p.lines || []).map((l) => l.serviceName).filter(Boolean).join(', ') || 'Proposal';

/** "SAR 6,500 / a month · 12 mo"; "SAR 9,000 / one-time"; null when it isn't priced. */
export function proposalValue(p: Pick<Proposal, 'monthlyFee' | 'oneTimeFee' | 'contractMonths' | 'currency'>): { amount: string | null; caption: string } {
  const cur = currencyOf(p);
  if (p.monthlyFee) return { amount: fmtMoney(p.monthlyFee, cur), caption: `a month${p.contractMonths ? ` · ${p.contractMonths} mo` : ''}` };
  if (p.oneTimeFee) return { amount: fmtMoney(p.oneTimeFee, cur), caption: 'one-time' };
  return { amount: null, caption: 'not priced' };
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

// ── Pending ─────────────────────────────────────────────────────────────────

export type PendingBucket = 'draft' | 'drafting' | 'review';
export const PENDING_ORDER: PendingBucket[] = ['draft', 'drafting', 'review'];
export const PENDING_GROUP: Record<PendingBucket, { name: (reviewer: string) => string; note: string; tone: Tone }> = {
  draft: { name: () => 'To draft', note: "Requests you haven't started", tone: 'coral-text' },
  drafting: { name: () => 'Drafting', note: 'Being written, deck or revision in progress', tone: 'blue' },
  review: { name: (r) => `With ${firstName(r)}`, note: 'In internal review', tone: 'amber' },
};

/** Which group a pending proposal sits in. Pure. */
export function pendingBucket(p: Pick<Proposal, 'status'>): PendingBucket | null {
  return p.status === PS.REQUEST ? 'draft' : p.status === PS.DRAFTING ? 'drafting' : p.status === PS.REVIEW ? 'review' : null;
}

/** Thresholds per group: requests and reviews go amber at a week, red at two; a draft amber at two weeks, red at a month. */
export const PENDING_AGE: Record<PendingBucket, { amber: number; red: number }> = {
  draft: { amber: 7, red: 14 }, drafting: { amber: 14, red: 30 }, review: { amber: 7, red: 14 },
};

/** "1 day left", "due today", "2 days late". */
export function promiseLeft(left: number): string {
  return left < 0 ? `${plural(-left, 'day')} late` : left === 0 ? 'due today' : `${plural(left, 'day')} left`;
}

export function pendingRow(p: Proposal, ctx: { today: string; reviewer: string; latestDeck?: number | null }): QueueRow | null {
  const bucket = pendingBucket(p);
  if (!bucket) return null;
  const { amount, caption } = proposalValue(p);
  const base = { id: p.id, bucket, client: p.client, companyId: p.companyId ?? null, service: serviceOf(p), amount, amountCaption: caption };
  if (bucket === 'draft') {
    const age = Math.max(0, daysBetween(p.dateAdded, ctx.today) ?? 0);
    const left = p.promisedBy ? daysBetween(ctx.today, p.promisedBy) : null;
    const due = left != null && left <= 1;
    const meta: MetaBit[] = [{ text: p.dateAdded ? `Requested ${fmtDateShort(p.dateAdded)}` : 'Requested' }];
    meta.push(p.promisedBy && left != null ? { text: `⚑ promised ${fmtDateWeekday(p.promisedBy)} · ${promiseLeft(left)}`, tone: due ? 'red' : 'amber', chip: true } : { text: 'no promise' });
    return { ...base, meta, age, ageCaption: 'since request', tone: due ? 'red' : ageTone(age, PENDING_AGE.draft), actions: [{ kind: 'draft', label: 'Start drafting' }], urgent: due };
  }
  if (bucket === 'drafting') {
    const age = Math.max(0, daysBetween(p.dateAdded, ctx.today) ?? 0);
    const rev = revisionOf(p);
    const open = openRevision(p);
    const meta: MetaBit[] = [];
    if (rev > 1) meta.push({ text: `Revision ${rev}` });
    if (open?.requestedAt) meta.push({ text: `client asked for changes on ${fmtDateShort(open.requestedAt)}` });
    if (!meta.length) meta.push({ text: p.dateAdded ? `Requested ${fmtDateShort(p.dateAdded)}` : 'Drafting' });
    if (ctx.latestDeck) meta.push({ text: `deck V${ctx.latestDeck} in folder`, tone: 'amber' });
    return { ...base, meta, age, ageCaption: 'since request', tone: ageTone(age, PENDING_AGE.drafting), actions: [{ kind: 'generate', label: `Generate V${rev}` }, { kind: 'review', label: 'Send for review' }], urgent: false };
  }
  const since = p.reviewRequestedAt || p.dateSentToHassan;
  const age = since ? Math.max(0, daysBetween(since, ctx.today) ?? 0) : null;
  const meta: MetaBit[] = [];
  if (p.remarks) meta.push({ text: p.remarks });
  if (p.reviewStatus === 'approved') {
    meta.push({ text: `Approved${p.reviewedAt ? ` ${fmtDateShort(p.reviewedAt)}` : ''} — send it to the client`, tone: 'red' });
    return { ...base, meta, age, ageCaption: 'in review', tone: 'red', actions: [{ kind: 'mark_sent', label: 'Mark sent' }], urgent: true };
  }
  if (p.reviewStatus === 'changes_requested') meta.push({ text: `Changes asked${p.reviewNote ? `: ${p.reviewNote}` : ''}`, tone: 'amber' });
  else if (since) meta.push({ text: `sent to ${firstName(ctx.reviewer)} ${fmtDateShort(since)}` });
  return { ...base, meta, age, ageCaption: 'in review', tone: ageTone(age, PENDING_AGE.review), actions: [{ kind: 'nudge', label: 'Nudge' }, { kind: 'record', label: 'Record review' }], urgent: false };
}

const oldest = (rows: QueueRow[]) => Math.max(0, ...rows.map((r) => r.age ?? 0));

/** The strip: what's waiting to be sent, then to draft · drafting · with the reviewer. Pure. */
export function pendingStrip(rows: QueueRow[], proposals: Proposal[], ctx: { reviewer: string; today: string }): StripPanel[] {
  const of = (b: PendingBucket) => rows.filter((r) => r.bucket === b);
  const byId = new Map(proposals.map((p) => [p.id, p]));
  const draft = of('draft'), drafting = of('drafting'), review = of('review');
  const promised = draft.map((r) => byId.get(r.id)?.promisedBy).filter((d): d is string => !!d).sort();
  const maxRev = Math.max(1, ...drafting.map((r) => revisionOf(byId.get(r.id) || {})));
  return [
    { key: 'all', total: true, n: moneyTotal(rows.map((r) => ({ amount: byId.get(r.id)?.monthlyFee, currency: byId.get(r.id)?.currency }))), count: rows.length, label: 'a month waiting to be sent', lead: 'across', detail: plural(rows.length, 'proposal'), tone: 'coral' },
    { key: 'draft', n: String(draft.length), count: draft.length, label: 'to draft', lead: 'oldest', detail: `${plural(oldest(draft), 'day')}${promised.length ? ` · ${promised.length} promised ${fmtWeekday(promised[0], 'short')}` : ''}`, tone: 'coral-text' },
    { key: 'drafting', n: String(drafting.length), count: drafting.length, label: 'drafting', lead: 'oldest', detail: `${plural(oldest(drafting), 'day')}${maxRev > 1 ? ` · revision ${maxRev}` : ''}`, tone: 'blue' },
    { key: 'review', n: String(review.length), count: review.length, label: `with ${firstName(ctx.reviewer)}`, lead: 'oldest', detail: `${plural(oldest(review), 'day')} in review`, tone: 'amber' },
  ];
}

// ── Follow-up ───────────────────────────────────────────────────────────────

export type FollowBucket = 'due' | 'waiting';
/** An offer expiring within a week is flagged; with 4+ follow-ups and 90+ days since it was sent, it may be lost. */
export const EXPIRING_DAYS = 7;
export const STALE_FOLLOWUPS = 4;
export const STALE_DAYS = 90;

/** When a proposal not yet due becomes due: the day after the tenth day without contact. Pure. */
export function followUpDueOn(lastTouchDate: string): string {
  const d = new Date(`${lastTouchDate.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + FOLLOW_UP_AFTER_DAYS + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Days until the offer lapses (0 = today), or null when there's no expiry or it has passed. */
export function expiresIn(validUntil: string | null | undefined, today: string): number | null {
  if (!validUntil) return null;
  const left = daysBetween(today, validUntil);
  return left == null || left < 0 ? null : left;
}

/** Many follow-ups and months without an answer: offer to mark it lost. Months since the client last spoke, else since it was sent. */
export function staleMonths(p: { sent: string; followUps: number; lastFromClient: string | null }, today: string): number | null {
  const sinceSent = daysBetween(p.sent, today) ?? 0;
  if (p.followUps < STALE_FOLLOWUPS || sinceSent < STALE_DAYS) return null;
  const quiet = daysBetween(p.lastFromClient || p.sent, today) ?? 0;
  return quiet < STALE_DAYS ? null : Math.floor(quiet / 30);
}

/** The stale rule for one sent proposal, from its touches. Pure. */
export function proposalStaleMonths(p: Proposal, touches: Pick<Touch, 'proposalId' | 'companyId' | 'kind' | 'direction' | 'at' | 'contactId'>[], followUps: number, today: string): number | null {
  const sent = proposalSentDate(p)?.slice(0, 10);
  if (!sent || p.status !== PS.SENT) return null;
  const fromClient = touchesOf(p, touches).filter((x) => x.direction === 'in' && x.at.slice(0, 10) >= sent).map((x) => x.at.slice(0, 10)).sort().pop() || null;
  return staleMonths({ sent, followUps, lastFromClient: fromClient }, today);
}

/** The touches a trail draws: the logged ones, plus the last contact when it was something else (a meeting, an
 * email received, a note) so the line's last dot is where the silence really starts. Pure. */
export function trailTouches<T extends { at: string; kind: string }>(logged: T[], last: Pick<LastTouch, 'date' | 'kind'> | null): { at: string; kind: string }[] {
  const out: { at: string; kind: string }[] = logged.map((t) => ({ at: t.at, kind: t.kind }));
  if (last && last.kind !== 'sent' && !out.some((t) => t.at.slice(0, 10) === last.date)) out.push({ at: last.date, kind: last.kind === 'email' ? 'email_in' : last.kind });
  return out;
}

export interface FollowRow extends QueueRow { expiring: boolean; dueOn: string | null; trail: Trail }

export function followRow(p: Proposal, ctx: { today: string; touch: LastTouch | null; followUps: number; touches: Pick<Touch, 'proposalId' | 'companyId' | 'kind' | 'direction' | 'at' | 'contactId'>[] }): FollowRow | null {
  if (p.archived || p.status !== PS.SENT) return null;
  const sent = proposalSentDate(p)?.slice(0, 10) || null;
  const t = ctx.touch;
  const days = t?.days ?? (sent ? Math.max(0, daysBetween(sent, ctx.today) ?? 0) : null);
  const due = days != null && days > FOLLOW_UP_AFTER_DAYS;
  const left = expiresIn(p.validUntil, ctx.today);
  const expiring = left != null && left <= EXPIRING_DAYS;
  const mine = sent ? touchesOf(p, ctx.touches).filter((x) => x.at.slice(0, 10) >= sent && x.at.slice(0, 10) <= ctx.today) : [];
  const fromClient = mine.filter((x) => x.direction === 'in').map((x) => x.at.slice(0, 10)).sort().pop() || null;
  const stale = sent ? staleMonths({ sent, followUps: ctx.followUps, lastFromClient: fromClient }, ctx.today) : null;
  const meta: MetaBit[] = [{ text: sent ? `Sent ${fmtDateShort(sent, true)}` : 'Sent' }];
  if (ctx.followUps) meta.push({ text: plural(ctx.followUps, 'follow-up') });
  if (expiring) meta.push({ text: `◷ offer expires ${left === 0 ? 'today' : fmtDateWeekday(p.validUntil)}`, tone: 'red', chip: true });
  else if (p.validUntil && left != null) meta.push({ text: `offer valid until ${fmtDateShort(p.validUntil)}` });
  if (stale != null) meta.push({ text: `no answer in ${plural(stale, 'month')} — mark lost?`, tone: 'amber' });
  const { amount, caption } = proposalValue(p);
  const caption2 = due ? 'without contact' : !t || t.kind === 'sent' ? 'since sent' : 'since last touch';
  const actions: RowAction[] = [];
  if (due) actions.push({ kind: 'changes', label: 'Client asked for changes' });
  if (stale != null) actions.push({ kind: 'mark_lost', label: 'Mark lost' });
  actions.push({ kind: 'followed_up', label: 'Followed up' });
  return {
    id: p.id, bucket: due ? 'due' : 'waiting', client: p.client, companyId: p.companyId ?? null, service: serviceOf(p),
    meta, age: days, ageCaption: caption2, tone: due ? (days! > 30 ? 'red' : 'amber') : 'ok', amount, amountCaption: caption,
    actions, urgent: due, expiring, dueOn: !due && t ? followUpDueOn(t.date) : null,
    trail: sent ? contactTrail({ sent, touches: trailTouches(mine, t), today: ctx.today, validUntil: p.validUntil ?? null, late: due ? t?.date ?? sent : null }) : { points: [], late: null },
  };
}

export function followStrip(rows: FollowRow[], proposals: Proposal[]): StripPanel[] {
  const byId = new Map(proposals.map((p) => [p.id, p]));
  const due = rows.filter((r) => r.bucket === 'due');
  const waiting = rows.filter((r) => r.bucket === 'waiting');
  const expiring = rows.filter((r) => r.expiring).sort((a, b) => (byId.get(a.id)?.validUntil || '').localeCompare(byId.get(b.id)?.validUntil || ''));
  const nextDue = waiting.map((r) => r.dueOn).filter((d): d is string => !!d).sort()[0];
  const soonest = expiring[0] ? byId.get(expiring[0].id) : null;
  return [
    { key: 'all', total: true, n: moneyTotal(rows.map((r) => ({ amount: byId.get(r.id)?.monthlyFee, currency: byId.get(r.id)?.currency }))), count: rows.length, label: 'a month with clients', lead: 'across', detail: plural(rows.length, 'proposal'), tone: 'coral' },
    { key: 'due', n: String(due.length), count: due.length, label: 'due a follow-up', lead: 'longest', detail: `${plural(oldest(due), 'day')} without contact`, tone: 'amber' },
    { key: 'expiring', n: String(expiring.length), count: expiring.length, label: 'offer expiring', lead: 'soonest', detail: soonest?.validUntil ? `${fmtDateWeekday(soonest.validUntil)} · ${soonest.client}` : '', tone: 'red' },
    { key: 'waiting', n: String(waiting.length), count: waiting.length, label: 'not yet due', lead: 'next', detail: nextDue ? `follow-up due ${fmtDateWeekday(nextDue)}` : '', tone: 'blue' },
  ];
}

/** Does a row belong to the picked strip bucket? */
export function inBucket(r: { bucket: string; expiring?: boolean }, bucket: string | null): boolean {
  if (!bucket || bucket === 'all') return true;
  return bucket === 'expiring' ? !!r.expiring : r.bucket === bucket;
}

// ── Contact trail ───────────────────────────────────────────────────────────

export interface TrailPoint { kind: 'sent' | 'touch' | 'today' | 'expiry'; date: string; pos: number; label: string; showLabel: boolean; /** A touch's kind (email_out, call, …), for the proposal page's wider trail. */ touch?: string }
export interface Trail { points: TrailPoint[]; late: { from: number; to: number } | null }

export const TOUCH_ICON: Record<string, string> = { email_out: '✉', email_in: '✉', call: '☎', whatsapp: '✆', meeting: '◎', note: '✎' };
/** At most this many touches on the line; older ones are dropped. */
export const TRAIL_TOUCHES = 5;
/** Labels closer than this (percent of the line) would overlap: the touch's label gives way. */
const LABEL_GAP = 14;

/** Sent, each touch since (the last five), today and the offer expiry, placed by date along one line; the current
 * silence (from the last touch to today) is marked when the proposal is due. Pure. */
export function contactTrail(i: { sent: string; touches: { at: string; kind: string }[]; today: string; validUntil: string | null; late: string | null }): Trail {
  const sent = i.sent.slice(0, 10);
  const touches = i.touches.map((t) => ({ date: t.at.slice(0, 10), kind: t.kind })).filter((t) => t.date >= sent && t.date <= i.today).sort((a, b) => a.date.localeCompare(b.date));
  const kept = touches.slice(-TRAIL_TOUCHES);
  // The same day twice is one dot.
  const days = kept.filter((t, n) => kept.findIndex((x) => x.date === t.date) === n);
  const expiry = i.validUntil && i.validUntil.slice(0, 10) >= i.today ? i.validUntil.slice(0, 10) : null;
  const end = expiry || i.today;
  const span = Math.max(1, daysBetween(sent, end) ?? 1);
  const at = (d: string) => Math.round(((daysBetween(sent, d) ?? 0) / span) * 1000) / 10;
  const points: TrailPoint[] = [
    { kind: 'sent', date: sent, pos: 0, label: fmtDateShort(sent), showLabel: true },
    ...days.filter((t) => t.date > sent && t.date < i.today).map((t) => ({ kind: 'touch' as const, date: t.date, pos: at(t.date), label: `${fmtDateShort(t.date)} ${TOUCH_ICON[t.kind] || ''}`.trim(), showLabel: true, touch: t.kind })),
    { kind: 'today', date: i.today, pos: at(i.today), label: 'today', showLabel: true },
  ];
  if (expiry && expiry > i.today) points.push({ kind: 'expiry', date: expiry, pos: 100, label: fmtDateShort(expiry), showLabel: true });
  // Today keeps clear of the send and the expiry so the three labels never overlap; touches stay before today.
  const now = points.find((p) => p.kind === 'today')!;
  const hasExpiry = points.some((p) => p.kind === 'expiry');
  now.pos = Math.min(hasExpiry ? 100 - LABEL_GAP : 100, Math.max(LABEL_GAP, now.pos));
  // A touch a day or two before today would sit under today's dot: today stands for it. Touches on top of the
  // previous dot are dropped too (the meta line counts them all).
  for (let n = points.length - 1; n >= 0; n--) if (points[n].kind === 'touch' && now.pos - points[n].pos < 2.5) points.splice(n, 1);
  for (let n = 1; n < points.length; n++) if (points[n].kind === 'touch' && points[n].pos - points[n - 1].pos < 2.5) points.splice(n--, 1);
  // Labels give way left to right; sent, today and the expiry always show, so a touch crowding one of them hides.
  const fixed = points.filter((p) => p.kind !== 'touch');
  let lastShown = -Infinity;
  for (const p of points) {
    if (p.kind !== 'touch') { lastShown = p.pos; continue; }
    const crowded = p.pos - lastShown < LABEL_GAP || fixed.some((f) => f.pos > p.pos && f.pos - p.pos < LABEL_GAP);
    p.showLabel = !crowded;
    if (!crowded) lastShown = p.pos;
  }
  const lateFrom = i.late ? (i.late.slice(0, 10) <= sent ? 0 : points.find((p) => p.kind === 'touch' && p.date === i.late!.slice(0, 10))?.pos ?? Math.min(at(i.late.slice(0, 10)), now.pos)) : 0;
  const late = i.late ? { from: lateFrom, to: now.pos } : null;
  return { points, late };
}

// ── This month ──────────────────────────────────────────────────────────────

/** Won (signed by both) and lost this month, from the signing date and the "[LOST" note. Pure. */
export function closedThisMonth(proposals: Proposal[], today: string): { won: Proposal[]; lost: Proposal[] } {
  const month = today.slice(0, 7);
  const lostOn = (p: Proposal) => [...(p.notes || [])].reverse().find((n) => (n.text || '').startsWith('[LOST'))?.date || null;
  return {
    won: proposals.filter((p) => !p.archived && p.status === PS.WON && (p.dblSignedDate || '').slice(0, 7) === month),
    lost: proposals.filter((p) => !p.archived && p.status === PS.LOST && (lostOn(p) || '').slice(0, 7) === month),
  };
}
