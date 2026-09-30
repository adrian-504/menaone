// Company 360 as a briefing: where we stand with a client, in up to five
// plain clauses — the relationship and commercials, what's in flight, how
// recently we spoke, who owes what, and the pinned notes. Each clause is left
// out when it has nothing to say. Pure (rules only), so Company 360, the
// meeting page's Client brief and the printable Brief all say the same thing.

import { PS, proposalSentDate, addMoney, agreementMonthly, currencyOf, fmtMoney, fmtMoneyByCurrency, isAgreementActive, isLost, isOpenProposal, isWon, lineTotals, type MoneyByCurrency } from './commercial';
import { agreementRenewal } from './myday';
import { engagementThread, type EngagementThread, type GraphData, type ThreadKind } from './workGraph';
import type { Tone } from './statusTone';
import type { RecordKind } from './navHistory';
import type { Agreement, Commitment, Contact, EmailRecord, Meeting, Touch } from './types';
import { fmtDate, fmtDateShort, fmtMonth } from './dates';

/** An active client with no meeting or email for longer than this is flagged. */
export const NEGLECT_DAYS = 45;
/** How many live engagements the "In flight" clause names before "and N more". */
export const IN_FLIGHT_SHOWN = 3;
/** Pinned notes quoted in the brief before "+N pinned". */
export const PINNED_SHOWN = 3;
/** An engagement with nothing dated for longer than this is dormant: an old
 * proposal never closed, say. It isn't "in flight"; Clean-up is where it goes. */
export const DORMANT_DAYS = 120;

export interface PinnedNote { id: number; body: string; createdAt: string; pinned?: boolean }

export interface CompanyBriefInput extends GraphData {
  company: { id: number | null; name: string };
  today: string;
  /** ISO time now, to tell a meeting earlier today from one later today. */
  now?: string;
  commitments: Commitment[];
  emails: EmailRecord[];
  /** The company's note entries (only the pinned ones are used). */
  notes: PinnedNote[];
  /** Follow-ups logged against proposals: an email we sent or a call counts as contact too. */
  touches?: Touch[];
}

/** A logged follow-up as one person's last contact ("You called", "Emailed you"). */
const PERSON_TOUCH: Record<string, string> = {
  'email_out:out': 'You emailed', 'email_in:in': 'Emailed you', 'call:out': 'You called', 'call:in': 'Called you',
  'whatsapp:out': 'WhatsApp from you', 'whatsapp:in': 'WhatsApp to you', 'meeting:out': 'Met',
};

/** The company's logged follow-ups. */
/** Follow-ups logged with the company, or on one of its proposals (a touch logged on a proposal may carry no company). */
const companyTouches = (i: CompanyBriefInput): Touch[] => {
  const own = new Set(i.proposals.filter((p) => inCompany(i.company, p.companyId, p.client)).map((p) => p.id));
  return (i.touches || []).filter((t) => (i.company.id != null && t.companyId === i.company.id) || (t.proposalId != null && own.has(t.proposalId)));
};

export type BriefLink = { kind: RecordKind | 'section'; id: number | string; label: string };

export type ClauseKey = 'relationship' | 'inflight' | 'rhythm' | 'commitments' | 'pinned';

export interface BriefClause {
  key: ClauseKey;
  /** Plain text; `{0}`, `{1}` … stand for `links[0]`, `links[1]` …. */
  text: string;
  links: BriefLink[];
  tone: Tone | null;
  /** Pinned notes, verbatim. */
  quotes?: string[];
}

/** A clause as plain text, links written out (for tests and the Brief's text lines). */
export function clauseText(c: BriefClause): string {
  return c.text.replace(/\{(\d+)\}/g, (_, i) => c.links[+i]?.label ?? '');
}

// utils.ts registers window handlers when imported, so this pure module keeps
// its own copies of the two helpers it needs (same results).
const inCompany = (ref: { id: number | null; name: string }, id: number | null | undefined, name: string | null | undefined) =>
  id != null && ref.id != null ? id === ref.id : !!name && name === ref.name;
const monthYear = (iso: string) => fmtMonth(iso.slice(0, 10), 'short');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
const minDate = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).map((x) => x.slice(0, 10)).sort()[0] ?? null;
const maxDate = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).map((x) => x.slice(0, 10)).sort().pop() ?? null;
/** "In Internal Review" → "in internal review"; words in capitals (MENA) stay. */
const lowerStatus = (s: string) => s.split(' ').map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase())).join(' ');

// ── The company's records ───────────────────────────────────────────────────

export function companyRecords(i: CompanyBriefInput) {
  const ref = i.company;
  const agreements = i.agreements.filter((a) => inCompany(ref, a.companyId, a.client));
  const today = i.today;
  return {
    proposals: i.proposals.filter((p) => inCompany(ref, p.companyId, p.client)),
    agreements,
    /** Agreements that make the company a client today. */
    clientAgreements: agreements.filter((a) => isAgreementActive(a, today) || (a.status === 'Signed' && a.serviceStatus !== 'Ended' && !(a.endDate && a.endDate < today))),
    signedAgreements: agreements.filter((a) => a.status === 'Signed'),
    opportunities: i.opportunities.filter((o) => !o.archived && inCompany(ref, o.companyId, o.companyName)),
    projects: i.projects.filter((p) => !p.archived && inCompany(ref, p.companyId, p.companyName)),
    meetings: i.meetings.filter((m) => !m.isCancelled && inCompany(ref, m.companyId, m.companyName)),
    contacts: i.contacts.filter((c) => inCompany(ref, c.companyId, c.clientName)),
    todos: i.todos.filter((t) => inCompany(ref, t.companyId, t.client)),
    commitments: i.commitments.filter((c) => c.status === 'open' && ref.id != null && c.companyId === ref.id),
    emails: i.emails.filter((e) => inCompany(ref, e.companyId ?? null, e.companyName)),
  };
}
type Records = ReturnType<typeof companyRecords>;

/** The header's relationship badge. */
export function relationshipStatus(r: Pick<Records, 'clientAgreements' | 'opportunities' | 'proposals'>): { label: string; tone: Tone } {
  if (r.clientAgreements.length > 0) return { label: 'Active client', tone: 'green' };
  if (r.opportunities.some((o) => o.status === 'Open') || r.proposals.some((p) => !p.archived && isOpenProposal(p))) return { label: 'In discussion', tone: 'amber' };
  if (r.proposals.some((p) => isLost(p) || isWon(p))) return { label: 'Past client or prospect', tone: 'muted' };
  return { label: 'Prospect', tone: 'accent' };
}

/** A meeting that has taken place (by its start time when known). */
function happened(m: Meeting, today: string, now: string): boolean {
  if (m.startAt) return m.startAt <= now;
  return !!m.meetingDate && m.meetingDate < today;
}

// ── Live engagements ────────────────────────────────────────────────────────

export interface CompanyThread {
  /** The thread's first step — one engagement is one key, however it was reached. */
  key: string;
  record: { kind: ThreadKind; id: number };
  thread: EngagementThread;
  /** Service or opportunity name. */
  label: string;
  /** Where it stands, in a few words. */
  phrase: string;
  /** Most recent date on the thread, for ordering. */
  lastDate: string;
  late: boolean;
  /** Nothing on it for over DORMANT_DAYS (an active project never is). */
  dormant: boolean;
  /** The Clean-up queue that deals with it when dormant. */
  cleanupQueue: string | null;
}

/** Where a thread stands, its waiting and next step, for one line on Company 360.
 * A revised proposal says so: "proposal revision 2 sent 3 days ago". */
export function threadStand(t: EngagementThread, today?: string): string {
  const last = t.nodes[t.nodes.length - 1];
  const rev = last.kind === 'proposal' && (last.revision ?? 1) > 1 ? last.revision! : null;
  if (rev && last.status === PS.SENT && last.dateLabel.startsWith('Rev')) {
    const d = today && last.date ? daysBetween(last.date, today) : null;
    return `proposal revision ${rev} sent${d == null ? '' : d === 0 ? ' today' : d === 1 ? ' yesterday' : ` ${d} days ago`}`;
  }
  const status = last.status ? lowerStatus(last.status) : '';
  const promised = last.promisedBy ? `, promised by ${fmtDateShort(last.promisedBy.slice(0, 10))}` : '';
  return `${last.kind} ${status && !/^(in|sent|signed|on)\b/.test(status) ? 'at ' : ''}${status}`.trim() + (rev ? `, revision ${rev}` : '') + promised;
}

function cleanupQueueFor(t: EngagementThread, i: CompanyBriefInput): string | null {
  const last = t.nodes[t.nodes.length - 1];
  if (last.kind !== 'proposal') return null;
  const p = i.proposals.find((x) => x.id === last.id);
  if (!p) return null;
  if (p.status === PS.SENT) return 'stale-sent';
  if (p.status === PS.CLIENT_SIGNED) return 'client-signed';
  if (p.status === PS.REVIEW) return 'long-review';
  if (p.status === PS.REQUEST || p.status === PS.DRAFTING) return 'stale-drafting';
  return null;
}

function threadLabel(t: EngagementThread, i: CompanyBriefInput): string {
  for (const n of t.nodes) {
    if (n.kind === 'opportunity') return i.opportunities.find((o) => o.id === n.id)?.name || n.label;
    if (n.kind === 'proposal') {
      const p = i.proposals.find((x) => x.id === n.id);
      return (p && (lineTotals(p.lines, p.contractMonths).serviceNames.join(', ') || p.type)) || n.label;
    }
    if (n.kind === 'agreement') {
      const a = i.agreements.find((x) => x.id === n.id);
      return (a && (a.lines?.length ? [...new Set(a.lines.map((l) => l.serviceName))].join(', ') : a.type)) || n.label;
    }
    if (n.kind === 'project') return n.label;
  }
  return '';
}

function threadPhrase(t: EngagementThread, i: CompanyBriefInput): string {
  const last = t.nodes[t.nodes.length - 1];
  const stand = threadStand(t, i.today);
  let value = '';
  const opp = t.nodes.find((n) => n.kind === 'opportunity');
  const prop = t.nodes.find((n) => n.kind === 'proposal');
  if (last.kind === 'proposal' && prop) {
    const p = i.proposals.find((x) => x.id === prop.id);
    const monthly = p ? (p.lines?.length ? lineTotals(p.lines, p.contractMonths).monthly : p.monthlyFee) : null;
    if (p && monthly) value = `${fmtMoney(monthly, currencyOf(p))} a month`;
  } else if (last.kind === 'agreement') {
    const a = i.agreements.find((x) => x.id === last.id);
    const monthly = a ? agreementMonthly(a) : null;
    if (a && monthly) value = `${fmtMoney(monthly, currencyOf(a))} a month`;
  } else if (opp) {
    const o = i.opportunities.find((x) => x.id === opp.id);
    if (o?.estimatedValue) value = fmtMoney(o.estimatedValue, o.currency || 'SAR');
  }
  const a = t.after;
  const wait = a?.waitingOn && a.days != null ? `${a.waitingOn === 'us' ? 'with us' : 'with the client'} ${plural(a.days, 'day')}` : '';
  return [stand, value, wait].filter(Boolean).join(', ');
}

/** Every live engagement (open opportunity, live proposal, agreement not yet
 * signed, active project), one per thread, most recently active first —
 * dormant ones included and flagged. */
export function liveThreads(i: CompanyBriefInput, r: Records = companyRecords(i)): CompanyThread[] {
  const seeds: { kind: ThreadKind; id: number }[] = [
    ...r.opportunities.filter((o) => o.status === 'Open').map((o) => ({ kind: 'opportunity' as const, id: o.id })),
    ...r.proposals.filter((p) => !p.archived && isOpenProposal(p)).map((p) => ({ kind: 'proposal' as const, id: p.id })),
    ...r.agreements.filter((a) => !['Signed', 'Canceled'].includes(a.status || '')).map((a) => ({ kind: 'agreement' as const, id: a.id })),
    ...r.projects.filter((p) => !['Completed', 'Cancelled'].includes(p.status)).map((p) => ({ kind: 'project' as const, id: p.id })),
  ];
  const out = new Map<string, CompanyThread>();
  for (const record of seeds) {
    const thread = engagementThread(record, i, i.today);
    if (!thread.nodes.length) continue;
    const key = `${thread.nodes[0].kind}:${thread.nodes[0].id}`;
    if (out.has(key)) continue;
    const lastNode = thread.nodes[thread.nodes.length - 1];
    const activeProject = lastNode.kind === 'project' && r.projects.some((p) => p.id === lastNode.id && !['Completed', 'Cancelled'].includes(p.status));
    const oppUpdated = thread.nodes.filter((n) => n.kind === 'opportunity').map((n) => i.opportunities.find((o) => o.id === n.id)?.updatedAt);
    const lastDate = maxDate([...thread.nodes.map((n) => n.date), ...oppUpdated]) || '';
    const dormant = !activeProject && (!lastDate || daysBetween(lastDate, i.today) > DORMANT_DAYS);
    out.set(key, {
      key, record: { kind: thread.nodes[0].kind, id: thread.nodes[0].id }, thread,
      label: threadLabel(thread, i), phrase: threadPhrase(thread, i),
      lastDate, late: !dormant && !!thread.after?.late, dormant, cleanupQueue: dormant ? cleanupQueueFor(thread, i) : null,
    });
  }
  return [...out.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.key.localeCompare(b.key));
}

// ── The clauses ─────────────────────────────────────────────────────────────

function relationshipClause(i: CompanyBriefInput, r: Records): BriefClause {
  const status = relationshipStatus(r);
  const started = (a: Agreement) => a.startDate || a.dateMenaSigned || a.dateClientSigned || a.datePrepared || a.createdAt;
  if (r.clientAgreements.length) {
    const since = minDate(r.signedAgreements.map(started));
    const services = [...new Set(r.clientAgreements.flatMap((a) => (a.lines?.length ? a.lines.map((l) => l.serviceName) : [a.type || ''])).filter(Boolean))];
    const mrr: MoneyByCurrency = {};
    for (const a of r.clientAgreements) if (isAgreementActive(a, i.today)) addMoney(mrr, currencyOf(a), agreementMonthly(a));
    let text = `Active client${since ? ` since ${monthYear(since)}` : ''}`;
    if (services.length) text += ` — ${services.join(', ')}`;
    if (Object.keys(mrr).length) text += `${services.length ? ' at' : ' —'} ${fmtMoneyByCurrency(mrr)} a month`;
    text += '.';
    const links: BriefLink[] = [];
    let tone: Tone = 'green';
    const ending = r.clientAgreements.filter((a) => a.endDate).sort((a, b) => a.endDate!.localeCompare(b.endDate!))[0];
    if (ending) {
      links.push({ kind: 'agreement', id: ending.id, label: ending.agrRef || 'The agreement' });
      const { noticeDate, daysToNotice } = agreementRenewal(ending, i.today);
      text += ` {0} ends ${fmtDate(ending.endDate)}`;
      if (noticeDate) {
        text += daysToNotice! < 0 ? `; the notice date (${fmtDate(noticeDate)}) has passed` : `; notice due ${fmtDate(noticeDate)}`;
        if (daysToNotice! <= 30) tone = 'amber';
      }
      text += '.';
    }
    return { key: 'relationship', text, links, tone };
  }
  if (r.signedAgreements.length) {
    const from = minDate(r.signedAgreements.map(started));
    const until = maxDate(r.signedAgreements.map((a) => a.endDate || started(a)));
    return { key: 'relationship', text: `Past client${from ? `, ${monthYear(from)}${until && until !== from ? ` – ${monthYear(until)}` : ''}` : ''}.`, links: [], tone: 'muted' };
  }
  const first = minDate([
    ...r.proposals.map((p) => p.dateAdded || p.sentDate), ...r.opportunities.map((o) => o.createdAt),
    ...r.meetings.map((m) => m.meetingDate), ...r.emails.map((e) => e.receivedAt),
  ]);
  const label = status.label === 'In discussion' ? 'In discussion' : 'Prospect';
  return { key: 'relationship', text: first ? `${label} — first contact ${fmtDate(first)}.` : `${label} — nothing recorded yet.`, links: [], tone: status.tone };
}

/** Short (Company 360, whose Open threads list follows): the count and what
 * needs attention — with us, or late. Long (the meeting brief): each one. */
/** One "in flight" item: a thread, or the proposals requested together as one. */
interface InFlightItem { label: string; late: boolean; after: CompanyThread['thread']['after']; phrase: string; link: Omit<BriefLink, 'label'> }

/** Threads as in-flight items; proposals sharing a request group (two or more)
 * become one, named "A, B and C (requested together)", pointing at Proposals. */
function inFlightItems(threads: CompanyThread[], proposals: CompanyBriefInput['proposals']): InFlightItem[] {
  const groupOf = (t: CompanyThread) => {
    const node = t.thread.nodes.find((n) => n.kind === 'proposal');
    return node ? proposals.find((p) => p.id === node.id)?.requestGroup || null : null;
  };
  const members = new Map<string, CompanyThread[]>();
  for (const t of threads) { const g = groupOf(t); if (g) members.set(g, [...(members.get(g) || []), t]); }
  const out: InFlightItem[] = [];
  const done = new Set<string>();
  for (const t of threads) {
    const g = groupOf(t);
    const group = g ? members.get(g)! : [];
    if (!g || group.length < 2) { out.push({ label: t.label || 'Engagement', late: t.late, after: t.thread.after, phrase: t.phrase, link: { kind: t.record.kind, id: t.record.id } }); continue; }
    if (done.has(g)) continue;
    done.add(g);
    const labels = group.map((x) => x.label || 'Proposal');
    const named = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}` : labels[0];
    // The one waiting longest speaks for the request.
    const lead = [...group].sort((a, b) => (b.thread.after?.days ?? -1) - (a.thread.after?.days ?? -1))[0];
    out.push({ label: `${named} (requested together)`, late: group.some((x) => x.late), after: lead.thread.after, phrase: lead.phrase, link: { kind: 'section', id: 'proposals' } });
  }
  return out;
}

function inFlightClause(all: CompanyThread[], form: 'short' | 'long', proposals: CompanyBriefInput['proposals'] = []): BriefClause | null {
  const threads = inFlightItems(all.filter((t) => !t.dormant), proposals);
  if (!threads.length) return null;
  const tone: Tone | null = threads.some((t) => t.late) ? 'amber' : null;
  if (form === 'short') {
    const heads = threads.filter((t) => t.late || t.after?.waitingOn === 'us');
    const count = threads.length === 1 ? 'One in flight' : `${threads.length} in flight`;
    if (!heads.length) return { key: 'inflight', text: `${count}.`, links: [], tone };
    const shownHeads = heads.slice(0, IN_FLIGHT_SHOWN);
    const links: BriefLink[] = shownHeads.map((t) => ({ ...t.link, label: t.label }));
    const parts = shownHeads.map((t, n) => {
      const a = t.after!;
      const who = a.waitingOn === 'us' ? 'with us' : a.waitingOn === 'them' ? 'with the client' : 'waiting';
      return `{${n}} ${who}${a.days != null ? ` ${plural(a.days, 'day')}` : ''}`;
    });
    const more = heads.length - shownHeads.length;
    return { key: 'inflight', text: `${count} — ${parts.join('; ')}${more > 0 ? `; and ${more} more` : ''}.`, links, tone };
  }
  const shown = threads.slice(0, IN_FLIGHT_SHOWN);
  const links: BriefLink[] = shown.map((t) => ({ ...t.link, label: t.label }));
  const parts = shown.map((t, n) => `{${n}}: ${t.phrase}`);
  const more = threads.length - shown.length;
  const text = `${threads.length === 1 ? 'In flight' : `${threads.length} in flight`} — ${parts.join('; ')}${more > 0 ? `; and ${more} more` : ''}.`;
  return { key: 'inflight', text, links, tone };
}

/** The company's last meeting, email (either way) and call, and the latest of them — the brief's
 * rhythm line and My Day's gone-quiet rule read this one calculation. */
export function companyContact(i: CompanyBriefInput, r: Records = companyRecords(i)) {
  const now = i.now || `${i.today}T12:00:00`;
  const past = r.meetings.filter((m) => m.meetingDate && happened(m, i.today, now)).sort((a, b) => (b.startAt || b.meetingDate!).localeCompare(a.startAt || a.meetingDate!));
  const next = r.meetings.filter((m) => m.meetingDate && m.meetingDate >= i.today && !happened(m, i.today, now)).sort((a, b) => (a.startAt || a.meetingDate!).localeCompare(b.startAt || b.meetingDate!))[0];
  const lastMeeting = past[0];
  // An email we sent or a call logged as a follow-up is contact too, not only the client's emails.
  const touches = companyTouches(i).filter((t) => t.at.slice(0, 10) <= i.today);
  const lastEmail = maxDate([...r.emails.map((e) => e.receivedAt), ...touches.filter((t) => t.kind === 'email_out' || t.kind === 'email_in').map((t) => t.at)]);
  const lastCall = maxDate(touches.filter((t) => t.kind === 'call' || t.kind === 'whatsapp').map((t) => t.at));
  const lastContact = maxDate([lastMeeting?.meetingDate, lastEmail, lastCall]);
  return { lastMeeting, next, lastEmail, lastCall, lastContact: lastContact ? lastContact.slice(0, 10) : null };
}

function rhythmClause(i: CompanyBriefInput, r: Records, isClient: boolean): BriefClause | null {
  const { lastMeeting, next, lastEmail, lastCall, lastContact } = companyContact(i, r);
  const gap = lastContact ? daysBetween(lastContact, i.today) : null;
  const neglected = isClient && (gap == null || gap > NEGLECT_DAYS);
  const links: BriefLink[] = [];
  const bits: string[] = [];
  if (neglected) bits.push(gap == null ? 'No meeting or email on record.' : `No meeting or email for ${gap} days.`);
  if (lastMeeting) {
    links.push({ kind: 'meeting', id: lastMeeting.id, label: lastMeeting.title });
    bits.push(`Last meeting ${fmtDate(lastMeeting.meetingDate)}, {${links.length - 1}}${lastEmail && lastEmail > lastMeeting.meetingDate! ? `; last email ${fmtDate(lastEmail)}` : ''}${lastCall && lastCall > lastMeeting.meetingDate! ? `; last call ${fmtDate(lastCall)}` : ''}.`);
  } else if (lastEmail || lastCall) {
    bits.push([lastEmail ? `Last email ${fmtDate(lastEmail)}` : '', lastCall ? `${lastEmail ? 'last' : 'Last'} call ${fmtDate(lastCall)}` : ''].filter(Boolean).join('; ') + '.');
  }
  if (next) {
    links.push({ kind: 'meeting', id: next.id, label: next.title });
    bits.push(`Next meeting ${next.meetingDate === i.today ? 'today' : fmtDate(next.meetingDate)}, {${links.length - 1}}.`);
  }
  if (!bits.length) return null;
  return { key: 'rhythm', text: bits.join(' '), links, tone: neglected ? 'amber' : null };
}

function commitmentsClause(i: CompanyBriefInput, r: Records): BriefClause | null {
  const late = (c: Commitment) => !!c.dueDate && c.dueDate < i.today;
  const ours = r.commitments.filter((c) => c.direction === 'ours');
  const theirs = r.commitments.filter((c) => c.direction === 'theirs');
  const overdue = r.todos.filter((t) => t.status !== 'Done' && t.parentId == null && t.dueDate && t.dueDate < i.today).length;
  const links: BriefLink[] = [];
  const bits: string[] = [];
  const owe = (who: string, list: Commitment[]) => {
    const n = list.filter(late).length;
    links.push({ kind: 'section', id: 'commitments', label: `${who} owe ${list.length}${n ? ` (${n} late)` : ''}` });
    bits.push(`{${links.length - 1}}.`);
  };
  if (ours.length) owe('We', ours);
  if (theirs.length) owe('They', theirs);
  if (overdue) { links.push({ kind: 'section', id: 'tasks', label: `${plural(overdue, 'task')} overdue` }); bits.push(`{${links.length - 1}}.`); }
  if (!bits.length) return null;
  return { key: 'commitments', text: bits.join(' '), links, tone: ours.some(late) || overdue ? 'amber' : null };
}

function pinnedClause(i: CompanyBriefInput): BriefClause | null {
  const pinned = i.notes.filter((n) => n.pinned).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  if (!pinned.length) return null;
  const more = pinned.length - PINNED_SHOWN;
  return {
    key: 'pinned', text: more > 0 ? '{0}' : '', tone: null,
    links: more > 0 ? [{ kind: 'section', id: 'notes-log', label: `+${more} pinned` }] : [],
    quotes: pinned.slice(0, PINNED_SHOWN).map((n) => n.body),
  };
}

/** Up to five clauses on where we stand with the company; each only when it has something to say. */
export function buildCompanyState(i: CompanyBriefInput, opts: { inFlight?: 'short' | 'long' } = {}): BriefClause[] {
  const r = companyRecords(i);
  return [
    relationshipClause(i, r),
    inFlightClause(liveThreads(i, r), opts.inFlight ?? 'short', i.proposals),
    rhythmClause(i, r, r.clientAgreements.length > 0),
    commitmentsClause(i, r),
    pinnedClause(i),
  ].filter((c): c is BriefClause => !!c);
}

// ── People ──────────────────────────────────────────────────────────────────

export interface LastContact { date: string; label: string; kind: 'meeting' | 'email' | 'touch'; id: number }

/** Each contact's most recent meeting attended, email from them, or follow-up logged with them. */
export function lastContactByPerson(i: CompanyBriefInput, r: Records = companyRecords(i)): Map<number, LastContact> {
  const now = i.now || `${i.today}T12:00:00`;
  const out = new Map<number, LastContact>();
  const offer = (id: number, c: LastContact) => { const cur = out.get(id); if (!cur || c.date > cur.date) out.set(id, c); };
  for (const c of r.contacts) {
    const email = (c.email || '').trim().toLowerCase();
    if (!email) continue;
    for (const m of i.meetings) {
      if (m.isCancelled || !m.meetingDate || !happened(m, i.today, now)) continue;
      if ((m.attendeeEmails || []).some((a) => a.toLowerCase() === email)) offer(c.id, { date: m.meetingDate, label: m.title, kind: 'meeting', id: m.id });
    }
    for (const e of i.emails) {
      if ((e.senderEmail || '').toLowerCase() === email && e.receivedAt) offer(c.id, { date: e.receivedAt.slice(0, 10), label: e.subject || 'Email', kind: 'email', id: e.id });
    }
  }
  for (const t of companyTouches(i)) {
    if (t.contactId == null || t.at.slice(0, 10) > i.today) continue;
    offer(t.contactId, { date: t.at.slice(0, 10), label: t.subject || PERSON_TOUCH[`${t.kind}:${t.direction}`] || 'Contact', kind: 'touch', id: t.id });
  }
  return out;
}

/** Decision makers first, then by last contact (most recent first), then by name. */
export function orderPeople(contacts: Contact[], last: Map<number, LastContact>): Contact[] {
  return [...contacts].sort((a, b) =>
    Number(!!b.isDecisionMaker) - Number(!!a.isDecisionMaker)
    || (last.get(b.id)?.date || '').localeCompare(last.get(a.id)?.date || '')
    || (a.name || '').localeCompare(b.name || ''));
}

// ── ⌘K "Brief <company>" ───────────────────────────────────────────────────

/** Companies to offer for a typed "brief …": the rest of the query is matched
 * against the start of the name first, then anywhere in it. */
export function briefCommandMatches(query: string, names: string[], limit = 5): string[] {
  const m = /^\s*brief\b\s*(.*)$/i.exec(query);
  if (!m) return [];
  const q = m[1].trim().toLowerCase();
  if (!q) return [];
  const starts = names.filter((n) => n.toLowerCase().startsWith(q));
  const within = names.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q));
  return [...starts, ...within].slice(0, limit);
}

// ── The meeting page's Client brief ─────────────────────────────────────────

/** The company-level lines of a meeting's Client brief are the company's
 * state (the same clauses as Company 360, with each engagement spelled out,
 * since the meeting page has no Open threads list); the agenda is the
 * meeting's own. */
export function meetingBrief(m: Meeting, i: CompanyBriefInput): { clauses: BriefClause[]; agenda: string[] } {
  const r = companyRecords(i);
  const agenda: string[] = [];
  const date = m.meetingDate || i.today;
  const previous = r.meetings.filter((x) => x.id !== m.id && (x.meetingDate || '') < date).sort((a, b) => (b.meetingDate || '').localeCompare(a.meetingDate || ''))[0];
  if (previous) {
    if (previous.followUp?.trim()) agenda.push(`Follow up from ${fmtDate(previous.meetingDate)}: ${previous.followUp.trim().split('\n')[0]}`);
    const prevTasks = i.todos.filter((t) => t.meetingId === previous.id && t.status !== 'Done');
    if (prevTasks.length) agenda.push(`Open actions from last meeting: ${prevTasks.slice(0, 3).map((t) => t.title).join('; ')}`);
  }
  for (const p of r.proposals.filter((x) => !x.archived && isOpenProposal(x)).slice(0, 3)) {
    const services = lineTotals(p.lines, p.contractMonths).serviceNames.join(', ') || p.type || 'Proposal';
    const sent = proposalSentDate(p);
    const rev = (p.revision ?? 1) > 1 && p.lastSentAt ? `revision ${p.revision} ` : '';
    if (p.status === PS.SENT) agenda.push(`Proposal for ${services}: ${rev}sent ${sent ? `${daysBetween(sent, i.today)} days ago` : 'earlier'} — agree next steps or a decision`);
    else if (p.status === PS.CLIENT_SIGNED) agenda.push(`Proposal for ${services}: signed by the client — confirm countersignature and kickoff`);
    else if (p.status === PS.REQUEST || p.status === PS.DRAFTING) agenda.push(`Requirements for the ${services} proposal`);
  }
  for (const o of r.opportunities.filter((x) => x.status === 'Open').slice(0, 3)) if (o.nextAction?.trim()) agenda.push(`${o.name}: ${o.nextAction.trim()}`);
  for (const a of r.agreements.filter((x) => x.status !== 'Canceled' && (isAgreementActive(x, i.today) || x.status !== 'Signed')).slice(0, 3)) {
    const services = a.lines?.length ? a.lines.map((l) => l.serviceName).join(', ') : a.type || 'Agreement';
    const ends = agreementRenewal(a, i.today).daysToEnd;
    if (isAgreementActive(a, i.today)) agenda.push(`Service check-in: ${services}`);
    if (ends != null && ends >= 0 && ends <= 90) agenda.push(`Renewal: ${services} ends ${fmtDate(a.endDate)} (${ends} days)`);
    if (a.status && !['Signed', 'On Hold'].includes(a.status)) agenda.push(`Agreement ${a.agrRef || services}: ${a.status.toLowerCase()} — confirm signature`);
  }
  return { clauses: buildCompanyState(i, { inFlight: 'long' }), agenda: [...new Set(agenda)] };
}
