// Company 360 as a briefing: where we stand with a client, in up to five
// plain clauses — the relationship and commercials, what's in flight, how
// recently we spoke, who owes what, and the pinned notes. Each clause is left
// out when it has nothing to say. Pure (rules only), so Company 360, the
// meeting page's Client brief and the printable Brief all say the same thing.

import { PS, addMoney, agreementMonthly, currencyOf, fmtMoney, fmtMoneyByCurrency, isAgreementActive, isLost, isOpenProposal, isWon, lineTotals, type MoneyByCurrency } from './commercial';
import { agreementRenewal } from './myday';
import { engagementThread, type EngagementThread, type GraphData, type ThreadKind } from './workGraph';
import type { Tone } from './statusTone';
import type { RecordKind } from './navHistory';
import type { Agreement, Commitment, Contact, EmailRecord, Meeting } from './types';

/** An active client with no meeting or email for longer than this is flagged. */
export const NEGLECT_DAYS = 45;
/** How many live engagements the "In flight" clause names before "and N more". */
export const IN_FLIGHT_SHOWN = 3;
/** Pinned notes quoted in the brief before "+N pinned". */
export const PINNED_SHOWN = 3;

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
}

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
const fmtDate = (s: string | null | undefined) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const inCompany = (ref: { id: number | null; name: string }, id: number | null | undefined, name: string | null | undefined) =>
  id != null && ref.id != null ? id === ref.id : !!name && name === ref.name;
const monthYear = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
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
  const status = last.status ? lowerStatus(last.status) : '';
  const stand = `${last.kind} ${status && !/^(in|sent|signed|on)\b/.test(status) ? 'at ' : ''}${status}`.trim();
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
 * signed, active project), one per thread, most recently active first. */
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
    out.set(key, {
      key, record: { kind: thread.nodes[0].kind, id: thread.nodes[0].id }, thread,
      label: threadLabel(thread, i), phrase: threadPhrase(thread, i),
      lastDate: maxDate(thread.nodes.map((n) => n.date)) || '', late: !!thread.after?.late,
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

function inFlightClause(threads: CompanyThread[]): BriefClause | null {
  if (!threads.length) return null;
  const shown = threads.slice(0, IN_FLIGHT_SHOWN);
  const links: BriefLink[] = shown.map((t) => ({ kind: t.record.kind, id: t.record.id, label: t.label || 'Engagement' }));
  const parts = shown.map((t, n) => `{${n}}: ${t.phrase}`);
  const more = threads.length - shown.length;
  const text = `${threads.length === 1 ? 'In flight' : `${threads.length} in flight`} — ${parts.join('; ')}${more > 0 ? `; and ${more} more` : ''}.`;
  return { key: 'inflight', text, links, tone: threads.some((t) => t.late) ? 'amber' : null };
}

function rhythmClause(i: CompanyBriefInput, r: Records, isClient: boolean): BriefClause | null {
  const now = i.now || `${i.today}T12:00:00`;
  const past = r.meetings.filter((m) => m.meetingDate && happened(m, i.today, now)).sort((a, b) => (b.startAt || b.meetingDate!).localeCompare(a.startAt || a.meetingDate!));
  const next = r.meetings.filter((m) => m.meetingDate && m.meetingDate >= i.today && !happened(m, i.today, now)).sort((a, b) => (a.startAt || a.meetingDate!).localeCompare(b.startAt || b.meetingDate!))[0];
  const lastMeeting = past[0];
  const lastEmail = maxDate(r.emails.map((e) => e.receivedAt));
  const lastContact = maxDate([lastMeeting?.meetingDate, lastEmail]);
  const gap = lastContact ? daysBetween(lastContact, i.today) : null;
  const neglected = isClient && (gap == null || gap > NEGLECT_DAYS);
  const links: BriefLink[] = [];
  const bits: string[] = [];
  if (neglected) bits.push(gap == null ? 'No meeting or email on record.' : `No meeting or email for ${gap} days.`);
  if (lastMeeting) {
    links.push({ kind: 'meeting', id: lastMeeting.id, label: lastMeeting.title });
    bits.push(`Last meeting ${fmtDate(lastMeeting.meetingDate)}, {${links.length - 1}}${lastEmail && lastEmail > lastMeeting.meetingDate! ? `; last email ${fmtDate(lastEmail)}` : ''}.`);
  } else if (lastEmail) {
    bits.push(`Last email ${fmtDate(lastEmail)}.`);
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
export function buildCompanyState(i: CompanyBriefInput): BriefClause[] {
  const r = companyRecords(i);
  return [
    relationshipClause(i, r),
    inFlightClause(liveThreads(i, r)),
    rhythmClause(i, r, r.clientAgreements.length > 0),
    commitmentsClause(i, r),
    pinnedClause(i),
  ].filter((c): c is BriefClause => !!c);
}

// ── People ──────────────────────────────────────────────────────────────────

export interface LastContact { date: string; label: string; kind: 'meeting' | 'email'; id: number }

/** Each contact's most recent meeting attended or email from them. */
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
 * state (the same clauses as Company 360); the agenda is the meeting's own. */
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
    const sent = p.dateSentToClient || p.sentDate;
    if (p.status === PS.SENT) agenda.push(`Proposal for ${services}: sent ${sent ? `${daysBetween(sent, i.today)} days ago` : 'earlier'} — agree next steps or a decision`);
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
  return { clauses: buildCompanyState(i), agenda: [...new Set(agenda)] };
}
