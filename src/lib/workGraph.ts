// The Work Graph: how records inherit context from the record they were
// created from, and which related records a record shows. Relationships are
// ids (company_id, project_id, opportunity_id, meeting_id and entity_links);
// names are only for display and are always read from the linked record.
//
// Context is a default, not a lock: the creation dialogs are prefilled from it
// and the person can change any field before saving.

import type { Agreement, Company, Contact, EntityKind, EntityLink, Meeting, Note, Opportunity, Project, Proposal, Todo } from './types';
import { statusTone, type Tone } from './statusTone';
import { proposalWaitingOn, type WaitingOn } from './commitments';
import { isAgreementActive } from './commercial';

/** The records a new record belongs to. */
export interface WorkContext {
  companyId: number | null;
  /** The company's current name (display and the text column), never used to identify it. */
  companyName: string | null;
  projectId: number | null;
  opportunityId: number | null;
  meetingId: number | null;
  noteId: number | null;
}

/** The slice of app state the helpers read. */
export interface GraphData {
  companies: Company[];
  opportunities: Opportunity[];
  projects: Project[];
  meetings: Meeting[];
  proposals: Proposal[];
  agreements: Agreement[];
  contacts: Contact[];
  todos: Todo[];
}

export const EMPTY_CONTEXT: WorkContext = { companyId: null, companyName: null, projectId: null, opportunityId: null, meetingId: null, noteId: null };

/** A record's company as { id, current name }. A linked company shows under its
 * current name; an unlinked record keeps its typed name with no id. */
export function companyOf(g: Pick<GraphData, 'companies'>, companyId: number | null | undefined, typedName: string | null | undefined): { companyId: number | null; companyName: string | null } {
  if (companyId != null) {
    const co = g.companies.find((c) => c.id === companyId);
    if (co) return { companyId: co.id, companyName: co.name };
  }
  const name = typedName?.trim() || null;
  return { companyId: null, companyName: name };
}

export function contextFromCompany(company: Company): WorkContext {
  return { ...EMPTY_CONTEXT, companyId: company.id, companyName: company.name };
}

export function contextFromOpportunity(g: GraphData, o: Opportunity): WorkContext {
  return { ...EMPTY_CONTEXT, ...companyOf(g, o.companyId, o.companyName), opportunityId: o.id };
}

/** A project's context: its company. The opportunity it was started from stays
 * reachable through the project (Origin), so project work isn't also filed
 * under the closed opportunity. */
export function contextFromProject(g: GraphData, p: Project): WorkContext {
  return { ...EMPTY_CONTEXT, ...companyOf(g, p.companyId, p.companyName), projectId: p.id };
}

export function contextFromMeeting(g: GraphData, m: Meeting): WorkContext {
  return { ...EMPTY_CONTEXT, ...companyOf(g, m.companyId, m.companyName), projectId: m.projectId, opportunityId: m.opportunityId, meetingId: m.id };
}

/** A note's context: its company, the project and opportunity it is linked to,
 * and the meeting whose notes it holds. `links` are the note's entity links. */
export function contextFromNote(g: GraphData, n: Note, links: EntityLink[]): WorkContext {
  const meeting = g.meetings.find((m) => m.noteId === n.id);
  const linked = (kind: EntityKind) => links.find((l) => l.fromType === 'note' && l.fromId === n.id && l.toType === kind)?.toId ?? null;
  const company = companyOf(g, n.companyId, n.clientName);
  return {
    ...EMPTY_CONTEXT,
    // A meeting note that has no company of its own takes the meeting's.
    ...(company.companyName || !meeting ? company : companyOf(g, meeting.companyId, meeting.companyName)),
    projectId: linked('project') ?? meeting?.projectId ?? null,
    opportunityId: linked('opportunity') ?? meeting?.opportunityId ?? null,
    meetingId: meeting?.id ?? null,
    noteId: n.id,
  };
}

/** A context with no company takes the company of its project, or else of its
 * opportunity. A company that is set is never replaced. */
export function inheritCompany(g: GraphData, ctx: WorkContext): WorkContext {
  if (ctx.companyName) return ctx;
  const p = ctx.projectId != null ? g.projects.find((x) => x.id === ctx.projectId) : undefined;
  const o = ctx.opportunityId != null ? g.opportunities.find((x) => x.id === ctx.opportunityId) : undefined;
  const from = p ? companyOf(g, p.companyId, p.companyName) : o ? companyOf(g, o.companyId, o.companyName) : null;
  return from?.companyName ? { ...ctx, ...from } : ctx;
}

/** Task fields for a task created in a context. */
export function taskFields(ctx: WorkContext): Partial<Todo> {
  return {
    type: ctx.companyName ? 'client' : 'general',
    client: ctx.companyName,
    companyId: ctx.companyName ? ctx.companyId : null,
    projectId: ctx.projectId,
    opportunityId: ctx.opportunityId,
    meetingId: ctx.meetingId,
  };
}

/** Company fields for a record saved from a form: the context's company id is
 * kept only while the company field still shows that company's name. Typing
 * another name is an explicit reassignment and is resolved by the backend. */
export function companyFromForm(ctx: Pick<WorkContext, 'companyId' | 'companyName'> | null, typed: string): { companyName: string | null; companyId: number | null } {
  const name = typed.trim() || null;
  if (!name) return { companyName: null, companyId: null };
  const same = ctx?.companyName != null && ctx.companyName.trim().toLowerCase() === name.toLowerCase();
  return { companyName: name, companyId: same ? ctx!.companyId : null };
}

// ── Links ────────────────────────────────────────────────────────────────────

/** A record's outgoing links with every link to `kind` replaced by `toIds`,
 * keeping links to other kinds (a note's project link must not drop its
 * opportunity link). */
export function replaceLinks(links: EntityLink[], fromType: EntityKind, fromId: number, kind: EntityKind, toIds: number[]): EntityLink[] {
  const others = links.filter((l) => l.fromType === fromType && l.fromId === fromId && l.toType !== kind);
  return [...others, ...[...new Set(toIds)].map((toId) => ({ fromType, fromId, toType: kind, toId }))];
}

/** Outgoing links plus the given ones (deduplicated). */
export function addLinks(links: EntityLink[], fromType: EntityKind, fromId: number, add: { toType: EntityKind; toId: number | null | undefined }[]): EntityLink[] {
  const out = links.filter((l) => l.fromType === fromType && l.fromId === fromId);
  for (const a of add) {
    if (a.toId == null) continue;
    if (!out.some((l) => l.toType === a.toType && l.toId === a.toId)) out.push({ fromType, fromId, toType: a.toType, toId: a.toId });
  }
  return out;
}

// ── Action items in notes ────────────────────────────────────────────────────

/** Unchecked Markdown checklist items ("- [ ] Send the model"), in order, without duplicates. */
export function actionItems(markdown: string | null | undefined): string[] {
  const out: string[] = [];
  for (const line of (markdown || '').split('\n')) {
    const m = /^\s*[-*+]\s+\[ \]\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const title = m[1].replace(/\s+/g, ' ').trim();
    // "- [ ] >> …" is a commitment: it gets its task that way, not twice.
    if (/^(>>|<<)/.test(title)) continue;
    if (title && !out.some((t) => sameTitle(t, title))) out.push(title);
  }
  return out;
}

export function sameTitle(a: string, b: string): boolean {
  return a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Action items not yet turned into a task: a task linked to the note, or
 * created from its meeting, with the same title counts as done already. */
export function unconvertedActionItems(markdown: string | null | undefined, existing: Todo[]): string[] {
  return actionItems(markdown).filter((title) => !existing.some((t) => sameTitle(t.title, title)));
}

// ── Related records ──────────────────────────────────────────────────────────

/** The opportunity a project was started from. */
export function originOpportunity(g: Pick<GraphData, 'opportunities'>, projectId: number): Opportunity | undefined {
  return g.opportunities.find((o) => o.projectId === projectId);
}

/** A project's engagement chain: opportunity → proposal → agreement, and the
 * opportunity's contacts. `contactLinks` are the opportunity's entity links. */
export function projectChain(g: GraphData, projectId: number, contactLinks: EntityLink[] = []): { opportunity?: Opportunity; proposal?: Proposal; agreement?: Agreement; contacts: Contact[] } {
  const opportunity = originOpportunity(g, projectId);
  const proposal = opportunity?.proposalId != null ? g.proposals.find((p) => p.id === opportunity.proposalId) : undefined;
  const agreement = proposal ? g.agreements.find((a) => a.proposalId === proposal.id) : undefined;
  const contactIds = new Set(contactLinks.filter((l) => l.fromType === 'contact' && l.toType === 'opportunity' && l.toId === opportunity?.id).map((l) => l.fromId));
  return { opportunity, proposal, agreement, contacts: g.contacts.filter((c) => contactIds.has(c.id)) };
}

/** The project a proposal led to (through its opportunity). */
export function proposalProject(g: Pick<GraphData, 'opportunities' | 'projects'>, proposalId: number): Project | undefined {
  const o = g.opportunities.find((x) => x.proposalId === proposalId && x.projectId != null);
  return o ? g.projects.find((p) => p.id === o.projectId) : undefined;
}

/** Tasks for an opportunity: linked directly, or from one of its meetings. */
export function opportunityTasks(g: Pick<GraphData, 'todos' | 'meetings'>, opportunityId: number): Todo[] {
  const meetingIds = new Set(g.meetings.filter((m) => m.opportunityId === opportunityId).map((m) => m.id));
  return g.todos.filter((t) => t.opportunityId === opportunityId || (t.meetingId != null && meetingIds.has(t.meetingId)));
}

// ── The engagement thread: opportunity → proposal → agreement → project ────

export type ThreadKind = 'opportunity' | 'proposal' | 'agreement' | 'project';
const THREAD_ORDER: ThreadKind[] = ['opportunity', 'proposal', 'agreement', 'project'];

export interface ThreadNode {
  kind: ThreadKind;
  id: number;
  label: string;
  status: string | null;
  tone: Tone;
  /** The one date that matters for this step, and what it is. */
  date: string | null;
  dateLabel: string;
  /** Agreements beside the one shown (a proposal with several). */
  others?: { id: number; label: string }[];
}

export interface ThreadGap {
  days: number | null;
  /** Only on the gap after the last step of an open thread. */
  waitingOn?: WaitingOn | null;
  late?: boolean;
}

export interface ThreadNext {
  label: string;
  /** open: go to that record (its own page has the button for the step). */
  action: 'create_proposal' | 'draft_agreement' | 'create_project' | 'open';
  kind: ThreadKind;
  id: number;
}

export interface EngagementThread {
  nodes: ThreadNode[];
  /** gaps[i] is between nodes[i] and nodes[i + 1]. */
  gaps: ThreadGap[];
  /** Time since the last step, and who it waits on — open threads only. */
  after: ThreadGap | null;
  /** Later steps that don't exist yet (never ones before the first node). */
  missing: ThreadKind[];
  next: ThreadNext | null;
  closed: boolean;
  /** Worth a strip: more than one step, or something to do next. */
  show: boolean;
}

/** Days from `a` to `b` (YYYY-MM-DD…), or null. */
function daysFrom(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const d = (Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000;
  // Legacy records can be dated out of order (an agreement before the
  // proposal was sent): a negative gap has no number, just the line.
  return Number.isFinite(d) && d >= 0 ? Math.round(d) : null;
}

/** The label for a proposal's next step — the same wording as the proposal page's main button. */
export function proposalNextStepLabel(p: Pick<Proposal, 'status' | 'reviewStatus'>): string | null {
  switch (p.status) {
    case 'Proposal Request Received': return 'Start drafting';
    case 'Drafting': return 'Submit for review';
    case 'In Internal Review': return p.reviewStatus === 'approved' ? 'Mark sent to client' : 'Record review';
    case 'Sent to Client': return 'Record signature';
    case 'Signed by Client': return 'Signed by both parties';
    default: return null;
  }
}

const later = (a: string | null | undefined, b: string | null | undefined) => ((a || '') > (b || '') ? a : b) || null;

function opportunityNode(o: Opportunity): ThreadNode {
  return { kind: 'opportunity', id: o.id, label: o.name, status: o.stage, tone: statusTone('opportunity', o.status), date: o.createdAt?.slice(0, 10) || null, dateLabel: 'Created' };
}
function proposalNode(p: Proposal): ThreadNode {
  const sent = p.dateSentToClient || p.sentDate;
  return { kind: 'proposal', id: p.id, label: `${p.type || 'Proposal'} (SL# ${p.id})`, status: p.status, tone: statusTone('proposal', p.status),
    date: (sent || p.dateAdded || null)?.slice(0, 10) || null, dateLabel: sent ? 'Sent' : 'Created' };
}
function agreementNode(a: Agreement, others: Agreement[]): ThreadNode {
  const signed = later(a.dateClientSigned, a.dateMenaSigned);
  const date = signed || a.dateSentToClient || a.datePrepared || a.createdAt;
  return { kind: 'agreement', id: a.id, label: a.agrRef || a.type || 'Agreement', status: a.status, tone: statusTone('agreement', a.status),
    date: date?.slice(0, 10) || null, dateLabel: signed ? 'Signed' : a.dateSentToClient ? 'Sent' : 'Prepared',
    ...(others.length ? { others: others.map((x) => ({ id: x.id, label: x.agrRef || x.type || 'Agreement' })) } : {}) };
}
function projectNode(p: Project): ThreadNode {
  return { kind: 'project', id: p.id, label: p.name, status: p.status, tone: statusTone('project', p.status), date: p.startDate || null, dateLabel: 'Started' };
}

/** The chain a record belongs to, from its first existing step to its last,
 * with the gaps between them and the one next action. Derived only from links
 * that exist: opportunities.proposal_id / project_id and agreements.proposal_id. */
export function engagementThread(record: { kind: ThreadKind; id: number }, g: GraphData, today: string): EngagementThread {
  let opportunity: Opportunity | undefined;
  let proposal: Proposal | undefined;
  let project: Project | undefined;
  let agreements: Agreement[] = [];
  if (record.kind === 'opportunity') opportunity = g.opportunities.find((o) => o.id === record.id);
  if (record.kind === 'proposal') proposal = g.proposals.find((p) => p.id === record.id);
  if (record.kind === 'agreement') {
    const a = g.agreements.find((x) => x.id === record.id);
    if (a) { agreements = [a]; proposal = a.proposalId != null ? g.proposals.find((p) => p.id === a.proposalId) : undefined; }
  }
  if (record.kind === 'project') {
    project = g.projects.find((p) => p.id === record.id);
    opportunity = project ? originOpportunity(g, project.id) : undefined;
  }
  if (!opportunity && proposal) opportunity = g.opportunities.find((o) => o.proposalId === proposal!.id);
  if (!proposal && opportunity?.proposalId != null) proposal = g.proposals.find((p) => p.id === opportunity!.proposalId);
  if (!project && opportunity?.projectId != null) project = g.projects.find((p) => p.id === opportunity!.projectId);
  if (proposal && record.kind !== 'agreement') agreements = g.agreements.filter((a) => a.proposalId === proposal!.id);
  if (proposal && record.kind === 'agreement') agreements = [...agreements, ...g.agreements.filter((a) => a.proposalId === proposal!.id && a.id !== record.id)];

  // Several agreements: the one being viewed, else the active one, else the latest.
  const byLatest = [...agreements].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.id - a.id);
  const shownAgreement = record.kind === 'agreement' ? agreements[0] : byLatest.find((a) => isAgreementActive(a, today)) || byLatest[0];
  const otherAgreements = byLatest.filter((a) => a !== shownAgreement);

  const nodes: ThreadNode[] = [];
  if (opportunity) nodes.push(opportunityNode(opportunity));
  if (proposal) nodes.push(proposalNode(proposal));
  if (shownAgreement) nodes.push(agreementNode(shownAgreement, otherAgreements));
  if (project) nodes.push(projectNode(project));

  const last = nodes[nodes.length - 1];
  const closed = (opportunity?.status === 'Lost')
    || (!!proposal && ['Lost', 'Withdrawn'].includes(proposal.status))
    || (last?.kind === 'project' && ['Completed', 'Cancelled'].includes(project!.status))
    || (last?.kind === 'agreement' && shownAgreement!.status === 'Canceled');

  // Later steps not there yet. A project only links through an opportunity,
  // so a thread without one never shows an empty project step.
  const lastIndex = last ? THREAD_ORDER.indexOf(last.kind) : -1;
  const missing = closed || !last ? [] : THREAD_ORDER.slice(lastIndex + 1).filter((k) => k !== 'project' || !!opportunity);

  const gaps: ThreadGap[] = nodes.slice(1).map((n, i) => ({ days: daysFrom(nodes[i].date, n.date) }));

  // Who the last step waits on, and since when.
  let after: ThreadGap | null = null;
  if (last && !closed) {
    let waitingOn: WaitingOn | null = null;
    let since: string | null = last.date;
    if (last.kind === 'opportunity') {
      waitingOn = opportunity!.waitingOn ?? null;
      since = opportunity!.waitingSince || last.date;
    } else if (last.kind === 'proposal') {
      waitingOn = proposalWaitingOn(proposal!.status, proposal!.archived);
      since = proposal!.status === 'Signed by Client' ? (proposal!.dateSigned || last.date) : last.date;
    } else if (last.kind === 'agreement') {
      const a = shownAgreement!;
      if (a.status === 'Client Review' || a.status === 'Client Signature') { waitingOn = 'them'; since = a.dateSentToClient || last.date; }
      else if (a.status === 'MENA Signature') { waitingOn = 'us'; since = a.dateClientSigned || last.date; }
      else if (a.status === 'In Preparation') { waitingOn = 'us'; since = a.datePrepared || a.createdAt || last.date; }
    }
    if (last.kind !== 'project') {
      const days = daysFrom(since, today);
      const limit = waitingOn === 'them' ? (last.kind === 'proposal' ? 10 : 14) : 7;
      after = { days, waitingOn, late: !!waitingOn && days != null && days > limit };
    }
  }

  // The one thing to do next, for the first missing step. Nothing is created without asking.
  let next: ThreadNext | null = null;
  if (last && !closed) {
    if (last.kind === 'opportunity' && opportunity!.status === 'Open') next = { label: 'Create proposal', action: 'create_proposal', kind: 'opportunity', id: opportunity!.id };
    else if (last.kind === 'opportunity' && opportunity!.status === 'Won' && !project) next = { label: 'Create project', action: 'create_project', kind: 'opportunity', id: opportunity!.id };
    else if (last.kind === 'proposal' && proposal!.status === 'Signed by Both Parties') next = { label: 'Draft agreement', action: 'draft_agreement', kind: 'proposal', id: proposal!.id };
    else if (last.kind === 'proposal') {
      const label = proposalNextStepLabel(proposal!);
      if (label) next = { label, action: 'open', kind: 'proposal', id: proposal!.id };
    } else if (last.kind === 'agreement' && opportunity && !project && ['Signed', 'Filed'].includes(shownAgreement!.status || '')) {
      next = { label: 'Create project', action: 'create_project', kind: 'opportunity', id: opportunity.id };
    }
  }

  return { nodes, gaps, after, missing, next, closed, show: nodes.length > 1 || next != null };
}
