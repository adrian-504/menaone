// The ⌘K palette (1.63 "chrome"): results in groups with a count each, a
// context line per result (what it is and where it stands), and for the
// selected result a preview — tile, name, status, up to four figures and the
// quick actions for its kind. Everything is read from the records already in
// memory: nothing is fetched as the selection moves. Pure: core/commandPalette.ts draws it.

import type { Agreement, Commitment, Contact, EntityKind, Meeting, Note, Opportunity, Project, Proposal, SearchResult, Todo } from './types';
import { PS, agreementMonthly, currencyOf, fmtMoney, fmtMoneyByCurrency, isAgreementActive, isOpenProposal, lineTotals, type MoneyByCurrency } from './commercial';
import { fmtDate, fmtDateShort, fmtTime } from './dates';
import { daysBetween } from './pipeline';
import { plural } from './pageKit';
import { stageOfProposal, stageSince } from './pagesProposals';
import { companyHeaderFigures } from './recordCompany';
import { agreementHeaderFigures } from './recordAgreement';
import type { Figure } from './recordFigures';
import { PAPERWORK_PENDING, paperworkPending } from './afterYes';

// ── Groups ──────────────────────────────────────────────────────────────────

export const GROUP_ORDER: EntityKind[] = ['company', 'proposal', 'opportunity', 'contact', 'meeting', 'project', 'agreement', 'task', 'commitment', 'note', 'intelligence'];
const GROUP_LABEL: Partial<Record<EntityKind, string>> = {
  company: 'Companies', proposal: 'Proposals', opportunity: 'Opportunities', contact: 'People', meeting: 'Meetings', project: 'Projects',
  agreement: 'Agreements', task: 'Tasks', commitment: 'Promises', note: 'Notes', intelligence: 'Watch',
};

export interface ResultGroup { kind: EntityKind | 'other'; label: string; items: SearchResult[] }

/** The results by kind, in a fixed order (business records first, then work, then reference), each group with its
 * own count; a kind the palette does not know goes last, never dropped. Pure. */
export function groupResults(results: SearchResult[]): ResultGroup[] {
  const groups: ResultGroup[] = GROUP_ORDER.map((kind) => ({ kind, label: GROUP_LABEL[kind] || kind, items: results.filter((r) => r.entityType === kind) })).filter((g) => g.items.length);
  const rest = results.filter((r) => !GROUP_ORDER.includes(r.entityType));
  if (rest.length) groups.push({ kind: 'other', label: 'Other', items: rest });
  return groups;
}

// ── What the palette reads ──────────────────────────────────────────────────

export interface PaletteData {
  today: string;
  now: Date;
  companies: { id: number; name: string }[];
  agreements: Agreement[];
  proposals: Proposal[];
  contacts: Contact[];
  opportunities: Opportunity[];
  projects: Project[];
  meetings: Meeting[];
  todos: Todo[];
  notes: Note[];
  commitments: Commitment[];
}

type Tone = 'green' | 'amber' | 'blue' | 'red' | 'grey';
export interface Chip { text: string; tone: Tone }

const same = (a: string | null | undefined, b: string | null | undefined) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
const ofCompany = <T extends { companyId?: number | null }>(list: T[], name: (x: T) => string | null | undefined, c: { id: number | null; name: string }) =>
  list.filter((x) => (c.id != null && x.companyId === c.id) || same(name(x), c.name));

/** The company a result names: by id, else by its title (companies are indexed by name). */
export function companyOfResult(r: Pick<SearchResult, 'entityId' | 'title'>, d: Pick<PaletteData, 'companies'>): { id: number | null; name: string } {
  const c = d.companies.find((x) => x.id === r.entityId) ?? d.companies.find((x) => same(x.name, r.title));
  return c ? { id: c.id, name: c.name } : { id: null, name: r.title };
}

function companyStanding(c: { id: number | null; name: string }, d: PaletteData) {
  const agreements = ofCompany(d.agreements, (a) => a.client, c);
  const proposals = ofCompany(d.proposals, (p) => p.client, c).filter((p) => !p.archived);
  const opportunities = ofCompany(d.opportunities, (o) => o.companyName, c).filter((o) => !o.archived);
  const active = agreements.filter((a) => isAgreementActive(a, d.today));
  const open = proposals.filter(isOpenProposal).length + opportunities.filter((o) => o.status === 'Open').length;
  const relationship: Chip = active.length ? { text: 'Active client', tone: 'green' } : open ? { text: 'In discussion', tone: 'amber' }
    : agreements.length || proposals.length ? { text: 'Past client or prospect', tone: 'grey' } : { text: 'Prospect', tone: 'blue' };
  const mrr: MoneyByCurrency = {};
  for (const a of active) { const m = agreementMonthly(a); if (m) mrr[currencyOf(a)] = (mrr[currencyOf(a)] || 0) + m; }
  const renews = active.map((a) => a.endDate?.slice(0, 10)).filter((x): x is string => !!x && x >= d.today).sort()[0] ?? null;
  return { agreements, proposals, opportunities, relationship, mrr, renews };
}

const proposalChip = (p: Proposal, today: string): Chip => {
  const stage = stageOfProposal(p);
  const since = stageSince(p);
  const days = since ? Math.max(0, daysBetween(since.slice(0, 10), today) ?? 0) : null;
  const age = days == null ? '' : ` · ${plural(days, 'day')}`;
  return stage === 'request' ? { text: `To draft${age}`, tone: 'red' } : stage === 'drafting' ? { text: `Drafting${age}`, tone: 'blue' }
    : stage === 'review' ? { text: `In review${age}`, tone: 'amber' } : stage === 'client' ? (paperworkPending(p) ? { text: PAPERWORK_PENDING, tone: 'green' } : { text: `With client${age}`, tone: 'blue' })
    : stage === 'signed' ? { text: 'Signed', tone: 'green' } : { text: p.status === PS.LOST ? 'Lost' : 'Closed', tone: 'grey' };
};

const meetingWhen = (m: Pick<Meeting, 'meetingDate' | 'startAt' | 'endAt'>, d: Pick<PaletteData, 'today' | 'now'>): string => {
  const day = (m.startAt || m.meetingDate || '').slice(0, 10);
  if (!day) return 'No date';
  const away = daysBetween(d.today, day) ?? 0;
  const word = away === 0 ? 'Today' : away === 1 ? 'Tomorrow' : away === -1 ? 'Yesterday' : fmtDateShort(day, true);
  const time = m.startAt && /T\d/.test(m.startAt) ? ` ${fmtTime(m.startAt)}` : '';
  const running = !!m.startAt && new Date(m.startAt) <= d.now && (!m.endAt || new Date(m.endAt) > d.now) && away === 0;
  return `${word}${time}${running ? ' · now' : ''}`;
};

// ── The context line ────────────────────────────────────────────────────────

export interface ContextLine { text: string; chip?: Chip }

/** What a result is and where it stands, in one line: a company's relationship, monthly and renewal; a proposal's
 * stage and age (as a chip); a person's role; a meeting's time. Empty for a kind with nothing to add. Pure. */
export function contextLine(r: SearchResult, d: PaletteData): ContextLine {
  switch (r.entityType) {
    case 'company': {
      const s = companyStanding(companyOfResult(r, d), d);
      return { text: [s.relationship.text, Object.keys(s.mrr).length ? `${fmtMoneyByCurrency(s.mrr)} /mo` : '', s.renews ? `renews ${fmtDateShort(s.renews, true)}` : ''].filter(Boolean).join(' · ') };
    }
    case 'proposal': { const p = d.proposals.find((x) => x.id === r.entityId); return p ? { text: '', chip: proposalChip(p, d.today) } : { text: '' }; }
    case 'contact': { const c = d.contacts.find((x) => x.id === r.entityId); return { text: c ? [c.role, c.isDecisionMaker ? 'decision maker' : '', c.clientName].filter(Boolean).join(' · ') : '' }; }
    case 'meeting': { const m = d.meetings.find((x) => x.id === r.entityId); return { text: m ? [meetingWhen(m, d), m.companyName].filter(Boolean).join(' · ') : '' }; }
    case 'opportunity': { const o = d.opportunities.find((x) => x.id === r.entityId); return { text: o ? [o.stage, o.estimatedValue != null ? fmtMoney(o.estimatedValue, o.currency || 'SAR') : '', o.companyName].filter(Boolean).join(' · ') : '' }; }
    case 'project': { const p = d.projects.find((x) => x.id === r.entityId); return { text: p ? [p.status, p.companyName, p.targetDate ? `target ${fmtDateShort(p.targetDate, true)}` : ''].filter(Boolean).join(' · ') : '' }; }
    case 'agreement': { const a = d.agreements.find((x) => x.id === r.entityId); return { text: a ? [a.status, a.client, a.endDate ? `ends ${fmtDateShort(a.endDate, true)}` : ''].filter(Boolean).join(' · ') : '' }; }
    case 'task': { const t = d.todos.find((x) => x.id === r.entityId); return { text: t ? [t.status === 'Done' ? 'Done' : t.dueDate ? `due ${fmtDateShort(t.dueDate, true)}` : 'no date', t.client].filter(Boolean).join(' · ') : '' }; }
    case 'commitment': { const c = d.commitments.find((x) => x.id === r.entityId); return { text: c ? [c.direction === 'ours' ? 'We owe' : 'They owe', c.dueDate ? `due ${fmtDateShort(c.dueDate, true)}` : 'no date'].join(' · ') : '' }; }
    default: return { text: '' };
  }
}

// ── The preview ─────────────────────────────────────────────────────────────

export type ActionKey = 'open' | 'email' | 'proposal' | 'brief' | 'company';
export interface PreviewAction { key: ActionKey; label: string; shortcut: string }
export interface Preview {
  /** The tile: a company's or person's name (a person's is round), or an icon for the other kinds. */
  tile: { name: string; round: boolean } | { icon: string };
  name: string;
  status: Chip | null;
  figures: Figure[];
  actions: PreviewAction[];
  /** For the actions: the company it belongs to, and who an email goes to. */
  company: string | null;
  email: string | null;
}

export const PREVIEW_FIGURES = 4;

/** The quick actions for a kind: always Open; an email when there is someone to write to; a new proposal for a
 * company or an opportunity; a company's brief; the company's page for anything that belongs to one. Pure. */
export function previewActions(kind: EntityKind, ctx: { company: string | null; emailTo: string | null }): PreviewAction[] {
  const out: PreviewAction[] = [{ key: 'open', label: kind === 'company' ? 'Open company' : 'Open', shortcut: '↵' }];
  if (ctx.emailTo) out.push({ key: 'email', label: `Email ${ctx.emailTo.split(/\s+/)[0]}`, shortcut: '⌘E' });
  if ((kind === 'company' || kind === 'opportunity') && ctx.company) out.push({ key: 'proposal', label: 'New proposal', shortcut: '⌘↵' });
  if (kind === 'company') out.push({ key: 'brief', label: 'Brief', shortcut: '⌘B' });
  else if (ctx.company) out.push({ key: 'company', label: 'Open company', shortcut: '' });
  return out.slice(0, 4);
}

const primaryContact = (company: string | null, d: PaletteData): Contact | null => {
  if (!company) return null;
  const people = d.contacts.filter((c) => same(c.clientName, company) && !!c.email);
  return people.find((c) => c.isDecisionMaker) ?? people[0] ?? null;
};

/** The preview of the selected result, from the records in memory: null for a kind with no record to show (or one
 * that is gone). The figures are the record page's own where it has them, four at most. Pure. */
export function previewOf(r: SearchResult, d: PaletteData): Preview | null {
  const done = (p: Omit<Preview, 'actions' | 'email'> & { emailTo?: Contact | null }): Preview => {
    // A person's own preview writes to that person or to no one; the rest write to the company's first contact.
    const to = 'emailTo' in p ? p.emailTo ?? null : primaryContact(p.company, d);
    const { emailTo: _drop, ...rest } = p;
    return { ...rest, figures: p.figures.slice(0, PREVIEW_FIGURES), email: to?.email ?? null, actions: previewActions(r.entityType, { company: p.company, emailTo: to?.email ? to.name : null }) };
  };
  switch (r.entityType) {
    case 'company': {
      const c = companyOfResult(r, d);
      const s = companyStanding(c, d);
      const figures = companyHeaderFigures({ today: d.today, clientAgreements: s.agreements, proposals: s.proposals, opportunities: s.opportunities, commitments: d.commitments.filter((m) => c.id != null && m.companyId === c.id) });
      return done({ tile: { name: c.name, round: false }, name: c.name, status: s.relationship, figures, company: c.name });
    }
    case 'contact': {
      const c = d.contacts.find((x) => x.id === r.entityId);
      if (!c) return null;
      const meetings = d.meetings.filter((m) => !m.isCancelled && (m.attendees || []).some((a) => same(a, c.name) || same(a, c.email)));
      const last = meetings.map((m) => (m.startAt || m.meetingDate || '').slice(0, 10)).filter((x) => x && x <= d.today).sort().pop();
      const owed = d.commitments.filter((m) => m.contactId === c.id && m.status === 'open');
      const figures: Figure[] = [
        ...(c.role ? [{ value: c.role, label: c.isDecisionMaker ? 'decision maker' : 'role' }] : []),
        ...(last ? [{ value: fmtDateShort(last, true), label: 'last met' }] : []),
        ...(meetings.length ? [{ value: String(meetings.length), label: meetings.length === 1 ? 'meeting' : 'meetings' }] : []),
        ...(owed.length ? [{ value: String(owed.length), label: owed.length === 1 ? 'open promise' : 'open promises', tone: 'amber' as const }] : []),
      ];
      return done({ tile: { name: c.name || '?', round: true }, name: c.name || 'Contact', status: c.clientName ? { text: c.clientName, tone: 'blue' } : null, figures, company: c.clientName || null, emailTo: c.email ? c : null });
    }
    case 'proposal': {
      const p = d.proposals.find((x) => x.id === r.entityId);
      if (!p) return null;
      const t = lineTotals(p.lines, p.contractMonths);
      const monthly = t.monthly ?? p.monthlyFee;
      const sent = (p.dateSentToClient || p.sentDate || '').slice(0, 10);
      const figures: Figure[] = [
        ...(monthly ? [{ value: fmtMoney(monthly, currencyOf(p)), label: 'a month', tone: 'green' as const }] : []),
        ...(p.contractMonths ? [{ value: plural(p.contractMonths, 'month'), label: 'term' }] : []),
        ...(sent ? [{ value: fmtDateShort(sent, true), label: 'sent to the client' }] : []),
        ...(p.validUntil && isOpenProposal(p) ? [{ value: fmtDateShort(p.validUntil, true), label: 'offer expires', tone: (daysBetween(d.today, p.validUntil) ?? 9) <= 3 ? 'red' as const : undefined }] : []),
      ];
      return done({ tile: { name: p.client || 'Proposal', round: false }, name: `${p.client} — ${p.type || 'Proposal'}`, status: proposalChip(p, d.today), figures, company: p.client || null });
    }
    case 'opportunity': {
      const o = d.opportunities.find((x) => x.id === r.entityId);
      if (!o) return null;
      const figures: Figure[] = [
        ...(o.estimatedValue != null ? [{ value: fmtMoney(o.estimatedValue, o.currency || 'SAR'), label: 'value', tone: 'green' as const }] : []),
        ...(o.probability != null ? [{ value: `${o.probability}%`, label: 'probability' }] : []),
        ...(o.expectedCloseDate ? [{ value: fmtDateShort(o.expectedCloseDate, true), label: 'close date' }] : []),
        ...(o.nextAction ? [{ value: 'Next step', label: o.nextAction as string }] : [{ value: '—', label: 'no next step', tone: 'amber' as const }]),
      ];
      return done({ tile: { name: o.companyName || o.name, round: false }, name: o.name, status: { text: o.stage, tone: o.status === 'Open' ? 'blue' : o.stage === 'Won' ? 'green' : 'grey' }, figures, company: o.companyName || null });
    }
    case 'agreement': {
      const a = d.agreements.find((x) => x.id === r.entityId);
      if (!a) return null;
      return done({ tile: { name: a.client || 'Agreement', round: false }, name: `${a.client || 'Agreement'}${a.type ? ` — ${a.type}` : ''}`, status: { text: a.status || 'In preparation', tone: a.status === 'Signed' ? 'green' : 'grey' }, figures: agreementHeaderFigures(a, d.today), company: a.client || null });
    }
    case 'meeting': {
      const m = d.meetings.find((x) => x.id === r.entityId);
      if (!m) return null;
      const figures: Figure[] = [
        { value: meetingWhen(m, d).replace(' · now', ''), label: m.isCancelled ? 'cancelled' : 'when' },
        ...((m.attendees || []).length ? [{ value: String(m.attendees.length), label: m.attendees.length === 1 ? 'person' : 'people' }] : []),
        ...(m.location || m.isOnlineMeeting ? [{ value: m.isOnlineMeeting ? 'Teams' : m.location!, label: 'where' }] : []),
      ];
      return done({ tile: { icon: 'meeting' }, name: m.title, status: m.companyName ? { text: m.companyName, tone: 'blue' } : null, figures, company: m.companyName || null });
    }
    case 'project': {
      const p = d.projects.find((x) => x.id === r.entityId);
      if (!p) return null;
      const figures: Figure[] = [
        ...(p.taskCount ? [{ value: `${p.taskDoneCount ?? 0} of ${p.taskCount}`, label: 'tasks done' }] : []),
        ...(p.targetDate ? [{ value: fmtDateShort(p.targetDate, true), label: 'target' }] : []),
        ...(p.owner ? [{ value: p.owner, label: 'owner' }] : []),
      ];
      return done({ tile: { icon: 'target' }, name: p.name, status: { text: p.status || 'Not started', tone: p.status === 'Completed' ? 'green' : 'blue' }, figures, company: p.companyName || null });
    }
    case 'task': {
      const t = d.todos.find((x) => x.id === r.entityId);
      if (!t) return null;
      const late = t.status !== 'Done' && !!t.dueDate && t.dueDate < d.today;
      const figures: Figure[] = [
        { value: t.dueDate ? fmtDateShort(t.dueDate, true) : '—', label: t.dueDate ? (late ? 'due · overdue' : 'due') : 'no date', tone: late ? 'red' : undefined },
        ...(t.priority && t.priority !== 'Medium' ? [{ value: t.priority, label: 'priority' }] : []),
      ];
      return done({ tile: { icon: 'check' }, name: t.title, status: { text: t.status === 'Done' ? 'Done' : t.status === 'In Progress' ? 'In progress' : 'To do', tone: t.status === 'Done' ? 'green' : 'grey' }, figures, company: t.client || null });
    }
    case 'note': {
      const n = d.notes.find((x) => x.id === r.entityId);
      if (!n) return null;
      const figures: Figure[] = [{ value: fmtDate(n.updatedAt || n.createdAt), label: 'edited' }, ...(n.folder ? [{ value: n.folder.split('/').pop()!, label: 'folder' }] : [])];
      return done({ tile: { icon: 'note' }, name: n.title || 'Untitled', status: n.clientName ? { text: n.clientName, tone: 'blue' } : null, figures, company: n.clientName || null });
    }
    default: return null;
  }
}

// ── Do ──────────────────────────────────────────────────────────────────────

export interface DoAction { key: string; label: string; sub: string; shortcut: string; company: string }

/** What the query suggests doing: a new proposal for the first company it found. Pure. */
export function doActions(results: SearchResult[], d: Pick<PaletteData, 'companies'>): DoAction[] {
  const first = results.find((r) => r.entityType === 'company');
  if (!first) return [];
  const c = companyOfResult(first, d);
  return [{ key: 'proposal', label: `New proposal for ${c.name}`, sub: `Opens the builder with ${c.name} filled in`, shortcut: '⌘↵', company: c.name }];
}
