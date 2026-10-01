// Follow-up by client and request (1.65 "followup"). The owner sends a client
// several proposals at once and follows them up as one conversation, so the
// page lists one row per request: the services as chips, what they are worth
// together, one contact trail, the client's last word, who last followed up
// and how, and how many follow-ups it has had.
//
// A request is the proposals requested together (their request group); a
// proposal with no group stands with the others sent to the same client on
// the same day.
//
// Where a request sits:
// - Decide: 60 days or more since the client's last word (or since it was
//   sent, when they never replied), and either two follow-ups unanswered or
//   those 60 days. Kept with a reason, it stays out until its date.
// - Due a follow-up: over ten days since the last contact, and the last word
//   was ours.
// - Waiting: everything else — not due yet, or held: the client replied (their
//   reply stops the clock, and is never counted as a follow-up), they said
//   they will revert after a date, or a meeting with them is booked.
//
// Pure: tabs/followup.ts draws what these return.

import type { Proposal, Touch } from './types';
import { PS, currencyOf, fmtMoneyByCurrency, proposalSentDate, type MoneyByCurrency } from './commercial';
import { daysBetween } from './pipeline';
import { FOLLOW_UP_AFTER_DAYS, lastTouch, touchesOf, type LastTouch, type TouchContext } from './followup';
import { fmtDateShort, fmtDateWeekday } from './dates';
import { moneyTotal, plural, type StripPanel } from './pageKit';
import { contactTrail, expiresIn, followUpDueOn, EXPIRING_DAYS, type MetaBit, type Trail } from './pagesQueues';

/** Days since the client's last word (or since sending) before a request is put to a decision. */
export const DECIDE_DAYS = 60;
/** Follow-ups left unanswered before a request is put to a decision. */
export const DECIDE_UNANSWERED = 2;
/** "Keep" takes a request out of Decide for this long. */
export const KEEP_DAYS = 30;

const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : '');

type KeyProposal = Pick<Proposal, 'id' | 'client' | 'companyId' | 'requestGroup' | 'lastSentAt' | 'dateSentToClient' | 'sentDate'>;

/** What ties proposals into one request: their request group; without one, the client and the day they were sent. */
export function requestKey(p: KeyProposal): string {
  if (p.requestGroup) return `g:${p.requestGroup}`;
  const who = p.companyId != null ? `c${p.companyId}` : `n:${(p.client || '').trim().toLowerCase()}`;
  return `${who}:${day(proposalSentDate(p)) || 'unsent'}`;
}

/** The other proposals with the client that were sent with this one (same request), by SL#. */
export function sentWith<T extends KeyProposal & Pick<Proposal, 'status' | 'archived'>>(p: T, all: T[]): T[] {
  const key = requestKey(p);
  return all.filter((x) => x.id !== p.id && !x.archived && x.status === PS.SENT && requestKey(x) === key).sort((a, b) => a.id - b.id);
}

export type EntryTouch = Pick<Touch, 'id' | 'proposalId' | 'companyId' | 'kind' | 'direction' | 'at' | 'contactId'> & Partial<Pick<Touch, 'byMemberId' | 'note' | 'batchId' | 'revertAfter' | 'source'>>;

/** One entry in the log, however many proposals it was written on. */
export interface Entry {
  /** The rows it was written as (one per proposal). */
  ids: number[];
  date: string;
  kind: Touch['kind'];
  direction: 'out' | 'in';
  byMemberId: number | null;
  note: string | null;
  revertAfter: string | null;
  batchId: string | null;
}

/** A touch's entry: its batch; a touch on the company itself; else the same day, channel and direction — so the
 * same follow-up logged on three proposals of one request counts once. */
const entryKey = (t: EntryTouch) => (t.batchId ? `b:${t.batchId}` : t.proposalId == null ? `t:${t.id}` : `${day(t.at)}|${t.kind}|${t.direction}`);

/** The log of a set of proposals as entries, oldest first. Pure. */
export function entriesOf(members: { id?: number; companyId?: number | null }[], touches: EntryTouch[]): Entry[] {
  const seen = new Set<number>();
  const byKey = new Map<string, Entry>();
  for (const m of members) {
    for (const t of touchesOf(m, touches)) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      const k = entryKey(t);
      const e = byKey.get(k);
      if (e) { e.ids.push(t.id); if (!e.note && t.note) e.note = t.note; if (!e.revertAfter && t.revertAfter) e.revertAfter = t.revertAfter; if (e.byMemberId == null && t.byMemberId != null) e.byMemberId = t.byMemberId; }
      else byKey.set(k, { ids: [t.id], date: day(t.at), kind: t.kind, direction: t.direction, byMemberId: t.byMemberId ?? null, note: t.note?.trim() || null, revertAfter: day(t.revertAfter) || null, batchId: t.batchId ?? null });
    }
  }
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.ids[0] - b.ids[0]);
}

const CHANNEL: Record<string, string> = { email_out: 'email', email_in: 'email', call: 'call', whatsapp: 'WhatsApp', meeting: 'meeting' };
/** "email", "call", "WhatsApp", "meeting". */
export const channelWord = (kind: string): string => CHANNEL[kind] || kind;

/** A follow-up of ours: an email, call or WhatsApp we made. A client's reply never counts, nor does a meeting. */
export const isFollowUp = (e: Pick<Entry, 'direction' | 'kind'>): boolean => e.direction === 'out' && e.kind !== 'meeting' && e.kind !== 'email_in';

export type RequestBucket = 'decide' | 'due' | 'waiting';
export type HoldKind = 'kept' | 'revert' | 'meeting' | 'replied';
export interface Hold { kind: HoldKind; /** The day the hold ends, when it has one. */ until: string | null; text: string }

export type RequestActionKind = 'followed_up' | 'changes' | 'decide_lost' | 'decide_keep' | 'decide_snooze';
export interface RequestAction { kind: RequestActionKind; label: string }

export interface FollowRequest {
  key: string;
  /** Its proposals, by SL#. */
  ids: number[];
  client: string;
  companyId: number | null;
  /** One chip per proposal. */
  services: string[];
  /** The earliest day one of them was sent. */
  sent: string;
  amount: string | null;
  amountCaption: string;
  amountShape: boolean;
  bucket: RequestBucket;
  hold: Hold | null;
  /** Days since the last contact either way; for a request to decide, since the client's last word (or the send). */
  age: number | null;
  ageCaption: string;
  tone: 'red' | 'amber' | 'ok';
  /** Our follow-ups since it was sent; an entry on several proposals counts once. */
  followUps: number;
  /** Follow-ups since the client's last word. */
  unanswered: number;
  /** What the client last said, and when; null when they never replied. */
  lastWord: { date: string; text: string; revertAfter: string | null } | null;
  /** Our last follow-up: who did it (when recorded), how, and when. */
  lastBy: { who: string | null; how: string; date: string } | null;
  /** None of its proposals has a contact person. */
  noContact: boolean;
  expiring: boolean;
  validUntil: string | null;
  /** When a request not yet due becomes due. */
  dueOn: string | null;
  trail: Trail;
  meta: MetaBit[];
  /** The second line: the client's last word, a hold, "no contact person". */
  word: MetaBit[];
  actions: RequestAction[];
  /** May its first action be the page's one blue button? */
  urgent: boolean;
}

export interface RequestContext extends TouchContext {
  touches: EntryTouch[];
  meetings: (TouchContext['meetings'][number] & { startAt?: string | null })[];
  /** A team member's first name. */
  memberName?: (id: number) => string | null;
  hasContact?: (p: Proposal) => boolean;
  /** How a proposal is priced when it has no single amount ("per person per month"). */
  shape?: (p: Proposal) => string | null;
}

const serviceOf = (p: Proposal) => p.type || (p.lines || []).map((l) => l.serviceName).filter(Boolean).join(', ') || 'Proposal';

/** What a request is worth: the monthly fees together; with none, the one-time fees; with neither, how it is priced. */
export function requestValue(members: Proposal[], shape?: (p: Proposal) => string | null): { amount: string | null; caption: string; shape: boolean } {
  const sum = (pick: (p: Proposal) => number | null | undefined) => { const m: MoneyByCurrency = {}; for (const p of members) { const v = pick(p); if (v) m[currencyOf(p)] = (m[currencyOf(p)] || 0) + v; } return m; };
  const monthly = sum((p) => p.monthlyFee);
  const months = [...new Set(members.filter((p) => p.monthlyFee && p.contractMonths).map((p) => p.contractMonths))];
  // Some of them have no monthly figure (priced per person, or not priced): the total says how many it leaves out.
  const apart = members.filter((p) => !p.monthlyFee).length;
  if (Object.keys(monthly).length) return { amount: fmtMoneyByCurrency(monthly), caption: apart ? `a month · + ${apart} more` : `a month${months.length === 1 ? ` · ${months[0]} mo` : ''}`, shape: false };
  const once = sum((p) => p.oneTimeFee);
  if (Object.keys(once).length) return { amount: fmtMoneyByCurrency(once), caption: 'one-time', shape: false };
  const how = members.map((p) => shape?.(p)).find(Boolean);
  return how ? { amount: null, caption: how, shape: true } : { amount: null, caption: 'not priced', shape: false };
}

/** One request: where it sits and what its row says. `members` are its sent proposals. Pure. */
export function buildRequest(members: Proposal[], ctx: RequestContext): FollowRequest {
  const ps = [...members].sort((a, b) => a.id - b.id);
  const lead = ps[0];
  const today = ctx.today;
  const sent = ps.map((p) => day(proposalSentDate(p))).filter(Boolean).sort()[0] || today;
  const entries = entriesOf(ps, ctx.touches).filter((e) => e.date >= sent && e.date <= today);
  // The latest contact either way, as Follow-up has always counted it (logged entries, notes, the client's emails, meetings).
  const last = ps.map((p) => lastTouch(p, ctx)).filter((t): t is LastTouch => !!t).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  const age = last ? last.days : Math.max(0, daysBetween(sent, today) ?? 0);

  // The client's last word: their latest logged reply; a synced email of theirs after it counts as a reply too.
  const reply = [...entries].reverse().find((e) => e.direction === 'in') ?? null;
  const theirs = last && (last.kind === 'email' || last.by === 'client') ? last : null;
  const how = (kind: string) => (kind === 'email_in' || kind === 'email' ? 'Replied by email' : kind === 'call' ? 'Called' : kind === 'whatsapp' ? 'Replied on WhatsApp' : 'Replied');
  const lastWord = reply && (!theirs || theirs.date <= reply.date)
    ? { date: reply.date, text: reply.note || how(reply.kind), revertAfter: reply.revertAfter }
    : theirs ? { date: theirs.date, text: how(theirs.kind), revertAfter: null } : null;

  const ours = entries.filter(isFollowUp);
  const followUps = ours.length;
  const since = lastWord?.date ?? sent;
  const unanswered = ours.filter((e) => e.date > since || (!lastWord && e.date >= since)).length;
  const lastOut = ours[ours.length - 1] ?? null;
  const lastBy = lastOut ? { who: lastOut.byMemberId != null ? ctx.memberName?.(lastOut.byMemberId) ?? null : null, how: channelWord(lastOut.kind), date: lastOut.date } : null;

  // Holds, the firmest first.
  const kept = ps.filter((p) => day(p.keepUntil) >= today && day(p.keepUntil)).sort((a, b) => day(b.keepUntil).localeCompare(day(a.keepUntil)))[0];
  const nextMeeting = lead.companyId != null ? ctx.meetings.filter((m) => !m.isCancelled && m.companyId === lead.companyId && day(m.meetingDate) >= today && !(day(m.meetingDate) === today && lastWord?.date === today)).map((m) => day(m.meetingDate)).sort()[0] : undefined;
  const replied = !!lastWord && !!last && last.date <= lastWord.date;
  let hold: Hold | null = null;
  if (kept) hold = { kind: 'kept', until: day(kept.keepUntil), text: `kept${kept.keepReason ? `: ${kept.keepReason}` : ''} · until ${fmtDateShort(day(kept.keepUntil), true)}` };
  else if (lastWord?.revertAfter && lastWord.revertAfter >= today) hold = { kind: 'revert', until: lastWord.revertAfter, text: `will revert after ${fmtDateShort(lastWord.revertAfter, true)}` };
  else if (nextMeeting) hold = { kind: 'meeting', until: nextMeeting, text: `meeting ${nextMeeting === today ? 'today' : `booked ${fmtDateShort(nextMeeting, true)}`}` };
  else if (replied) hold = { kind: 'replied', until: null, text: 'the client replied' };

  const quiet = Math.max(0, daysBetween(since, today) ?? 0);
  const decide = quiet >= DECIDE_DAYS && (unanswered >= DECIDE_UNANSWERED || quiet >= DECIDE_DAYS) && (!hold || hold.kind === 'replied');
  const due = !decide && !hold && age > FOLLOW_UP_AFTER_DAYS;
  const bucket: RequestBucket = decide ? 'decide' : due ? 'due' : 'waiting';

  const validUntil = ps.map((p) => day(p.validUntil)).filter((d) => d && d >= today).sort()[0] || null;
  const left = expiresIn(validUntil, today);
  const expiring = left != null && left <= EXPIRING_DAYS;

  // The offer's expiry comes right after the send: on a narrow row the end of the line is what gets cut.
  const meta: MetaBit[] = [{ text: `Sent ${fmtDateShort(sent, true)}` }];
  if (expiring) meta.push({ text: `◷ offer expires ${left === 0 ? 'today' : fmtDateWeekday(validUntil!)}`, tone: 'red', chip: true });
  if (followUps) meta.push({ text: plural(followUps, 'follow-up') });
  if (lastBy) meta.push({ text: `last ${lastBy.who ? `by ${lastBy.who}, ` : ''}${lastBy.how} ${fmtDateShort(lastBy.date, true)}` });

  const noContact = !!ctx.hasContact && !ps.some((p) => ctx.hasContact!(p));
  const word: MetaBit[] = [lastWord ? { text: `${/^(Replied|Called)/.test(lastWord.text) ? lastWord.text : `“${lastWord.text}”`} · ${fmtDateShort(lastWord.date, true)}` } : { text: 'Never replied' }];
  if (hold && hold.kind !== 'replied') word.push({ text: hold.text });
  if (noContact) word.push({ text: 'no contact person', tone: 'amber' });

  const actions: RequestAction[] = decide
    ? [{ kind: 'decide_snooze', label: 'Snooze' }, { kind: 'decide_keep', label: 'Keep' }, { kind: 'decide_lost', label: 'Close as lost' }]
    : due ? [{ kind: 'changes', label: 'Client asked for changes' }, { kind: 'followed_up', label: 'Followed up' }]
    : [{ kind: 'followed_up', label: 'Followed up' }];
  const { amount, caption, shape } = requestValue(ps, ctx.shape);
  return {
    key: requestKey(lead), ids: ps.map((p) => p.id), client: lead.client, companyId: lead.companyId ?? null, services: ps.map(serviceOf), sent,
    // To decide: how long since they last said anything (or since it was sent); otherwise since the last contact.
    amount, amountCaption: caption, amountShape: shape, bucket, hold, age: decide ? quiet : age,
    ageCaption: decide ? (lastWord ? 'since their reply' : 'since it was sent') : due ? 'without contact' : !last || last.kind === 'sent' ? 'since sent' : 'since last touch',
    tone: decide ? 'red' : due ? (age > 30 ? 'red' : 'amber') : 'ok',
    followUps, unanswered, lastWord, lastBy, noContact, expiring, validUntil,
    dueOn: bucket === 'waiting' ? (hold?.until ?? (hold ? null : followUpDueOn(last?.date ?? sent))) : null,
    trail: contactTrail({ sent, touches: [...entries.map((e) => ({ at: e.date, kind: e.kind })), ...(last && last.kind !== 'sent' && !entries.some((e) => e.date === last.date) ? [{ at: last.date, kind: last.kind === 'email' ? 'email_in' : last.kind }] : [])], today, validUntil, late: due || decide ? (decide ? since : last?.date ?? sent) : null }),
    meta, word, actions, urgent: due,
  };
}

/** Every request on the page: the sent proposals by request, oldest request first, a client's requests together. Pure. */
export function buildRequests(sentProposals: Proposal[], ctx: RequestContext): FollowRequest[] {
  const byKey = new Map<string, Proposal[]>();
  for (const p of sentProposals) {
    if (p.archived || p.status !== PS.SENT) continue;
    const k = requestKey(p);
    byKey.set(k, [...(byKey.get(k) || []), p]);
  }
  const rows = [...byKey.values()].map((members) => buildRequest(members, ctx));
  return orderRequests(rows);
}

const clientKey = (r: Pick<FollowRequest, 'companyId' | 'client'>) => (r.companyId != null ? `c${r.companyId}` : `n:${r.client.trim().toLowerCase()}`);

/** Oldest first, with a client's requests together: by the client's oldest request, then by each request's own day. */
export function orderRequests<T extends Pick<FollowRequest, 'companyId' | 'client' | 'sent' | 'key'>>(rows: T[]): T[] {
  const oldest = new Map<string, string>();
  for (const r of rows) { const k = clientKey(r); if (!oldest.has(k) || r.sent < oldest.get(k)!) oldest.set(k, r.sent); }
  return [...rows].sort((a, b) => oldest.get(clientKey(a))!.localeCompare(oldest.get(clientKey(b))!) || a.client.localeCompare(b.client) || clientKey(a).localeCompare(clientKey(b)) || a.sent.localeCompare(b.sent) || a.key.localeCompare(b.key));
}

/** Does a request belong to the picked strip panel? */
export function requestInBucket(r: Pick<FollowRequest, 'bucket' | 'expiring'>, bucket: string | null): boolean {
  if (!bucket || bucket === 'all') return true;
  return bucket === 'expiring' ? r.expiring : r.bucket === bucket;
}

/** The strip: what is with clients a month (requests and proposals), then to decide · due a follow-up · offers
 * expiring · not yet due. Pure. */
export function requestStrip(rows: FollowRequest[], proposals: Proposal[]): StripPanel[] {
  const of = (b: RequestBucket) => rows.filter((r) => r.bucket === b);
  const decide = of('decide'), due = of('due'), waiting = of('waiting');
  const longest = (rs: FollowRequest[]) => Math.max(0, ...rs.map((r) => r.age ?? 0));
  const expiring = rows.filter((r) => r.expiring).sort((a, b) => (a.validUntil || '').localeCompare(b.validUntil || ''));
  const nextDue = waiting.map((r) => r.dueOn).filter((d): d is string => !!d).sort()[0];
  const shown = new Set(rows.flatMap((r) => r.ids));
  const mine = proposals.filter((p) => shown.has(p.id));
  return [
    { key: 'all', total: true, n: moneyTotal(mine.map((p) => ({ amount: p.monthlyFee, currency: p.currency }))), count: rows.length, label: 'a month with clients', lead: 'across', detail: `${plural(rows.length, 'request')} · ${plural(mine.length, 'proposal')}`, tone: 'coral' },
    { key: 'decide', n: String(decide.length), count: decide.length, label: 'to decide', lead: 'longest', detail: `${plural(longest(decide), 'day')} with no word`, tone: 'red' },
    { key: 'due', n: String(due.length), count: due.length, label: 'due a follow-up', lead: 'longest', detail: `${plural(longest(due), 'day')} without contact`, tone: 'amber' },
    { key: 'expiring', n: String(expiring.length), count: expiring.length, label: 'offer expiring', lead: 'soonest', detail: expiring[0]?.validUntil ? `${fmtDateWeekday(expiring[0].validUntil)} · ${expiring[0].client}` : '', tone: 'red' },
    { key: 'waiting', n: String(waiting.length), count: waiting.length, label: 'not yet due', lead: nextDue ? 'next' : '', detail: nextDue ? `follow-up due ${fmtDateWeekday(nextDue)}` : '', tone: 'blue' },
  ];
}

// ── The status list ─────────────────────────────────────────────────────────

const STATUS_WORD: Record<RequestBucket, string> = { decide: 'to decide', due: 'follow-up due', waiting: 'waiting on the client' };

/** What happens next on a request, in a few words. */
export function nextAction(r: Pick<FollowRequest, 'bucket' | 'hold' | 'dueOn'>): string {
  if (r.bucket === 'decide') return 'close it or keep it';
  if (r.bucket === 'due') return 'follow up';
  if (r.hold?.kind === 'revert') return `wait: they revert after ${fmtDateShort(r.hold.until!, true)}`;
  if (r.hold?.kind === 'meeting') return `meeting ${fmtDateShort(r.hold.until!, true)}`;
  if (r.hold?.kind === 'kept') return `look again ${fmtDateShort(r.hold.until!, true)}`;
  if (r.hold?.kind === 'replied') return 'answer the client';
  return r.dueOn ? `follow up from ${fmtDateShort(r.dueOn, true)}` : 'wait';
}

/** The status list to paste to the reviewer: plain text, one line per request, oldest first — client, services, the
 * day sent, days since, where it stands, what happens next. No amounts. Pure. */
export function statusList(rows: FollowRequest[], today: string): string {
  const ordered = [...rows].sort((a, b) => a.sent.localeCompare(b.sent) || a.client.localeCompare(b.client) || a.key.localeCompare(b.key));
  return ordered.map((r) => {
    const days = Math.max(0, daysBetween(r.sent, today) ?? 0);
    const status = r.hold?.kind === 'replied' && r.bucket === 'waiting' ? 'client replied' : STATUS_WORD[r.bucket];
    return `${r.client} — ${r.services.join(', ')} — sent ${fmtDateShort(r.sent, true)} (${plural(days, 'day')}) — ${status} — next: ${nextAction(r)}`;
  }).join('\n');
}
