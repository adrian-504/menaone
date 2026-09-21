// The Work Graph: how records inherit context from the record they were
// created from, and which related records a record shows. Relationships are
// ids (company_id, project_id, opportunity_id, meeting_id and entity_links);
// names are only for display and are always read from the linked record.
//
// Context is a default, not a lock: the creation dialogs are prefilled from it
// and the person can change any field before saving.

import type { Agreement, Company, Contact, EntityKind, EntityLink, Meeting, Note, Opportunity, Project, Proposal, Todo } from './types';

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
