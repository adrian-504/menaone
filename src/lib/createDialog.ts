// The create dialogs (1.63 "chrome"): one shell for every "New …" — a tile, an
// eyebrow, the kind in Saira, keyboard hints and one primary — and "create and
// add another". For a task: the typed line highlighted where it was understood,
// the "Understood as" chips, and what the field tiles are prefilled with. Pure:
// core/createDialog.ts and tabs/todo.ts draw it.

import type { ParsedTask, TokenKind, TokenRange } from './taskParse';
import { fmtDateWeekday } from './dates';

// ── The shell ───────────────────────────────────────────────────────────────

export interface CreateKind {
  /** The dialog's element id. */
  modal: string;
  /** "Task", "Meeting"… as the title says it. */
  kind: string;
  icon: string;
  tint: string;
  /** The window function that opens a blank one, for "create and add another", and whether it takes `null` first. */
  open: string;
  openWithNull: boolean;
  /** The fields carried over to the next one (client, project), by name. */
  keep: string[];
}

export const CREATE_KINDS: CreateKind[] = [
  { modal: 'modal-todo', kind: 'Task', icon: 'check', tint: 'var(--blue)', open: 'openTodoModal', openWithNull: true, keep: ['todoClient', 'todoProject', 'todoKind'] },
  { modal: 'modal-meeting', kind: 'Meeting', icon: 'meeting', tint: 'var(--blue)', open: 'openMeetingModal', openWithNull: true, keep: ['mtCompany', 'mtProject'] },
  { modal: 'modal-commitment', kind: 'Promise', icon: 'flag', tint: 'var(--coral-text)', open: 'openCommitmentModal', openWithNull: false, keep: ['cmCompany', 'cmProject', 'cmOpportunity'] },
  { modal: 'modal-new-company', kind: 'Company', icon: 'building', tint: 'var(--green)', open: 'openNewCompanyModal', openWithNull: false, keep: [] },
  { modal: 'modal-contact', kind: 'Contact', icon: 'people', tint: 'var(--green)', open: 'openContactModal', openWithNull: false, keep: ['ct-client'] },
  { modal: 'modal-opportunity', kind: 'Opportunity', icon: 'briefcase', tint: 'var(--amber)', open: 'openOpportunityModal', openWithNull: true, keep: ['oppCompany'] },
  { modal: 'modal-agr', kind: 'Agreement', icon: 'document', tint: 'var(--sub)', open: 'openAgrModal', openWithNull: true, keep: [] },
  { modal: 'modal-project', kind: 'Project', icon: 'target', tint: 'var(--sub)', open: 'openProjectModal', openWithNull: true, keep: ['pjCompany', 'pjType'] },
];

export interface DialogHead { eyebrow: 'New' | 'Edit' | ''; title: string }

/** The header from the title an opener wrote: "New task" → New · Task; "Edit meeting" → Edit · Meeting; "New subtask
 * of “X”" keeps its words after the eyebrow; anything else is shown as it is. Pure. */
export function dialogHead(title: string, kind: string): DialogHead {
  const t = title.trim();
  const m = /^(new|add|edit|log)\s+(.*)$/i.exec(t);
  if (!m) return { eyebrow: '', title: t || kind };
  const rest = m[2].trim();
  // "New task" → the kind; a longer title ("subtask of …", "contact at Acme") keeps its own words.
  const plain = rest.toLowerCase() === kind.toLowerCase() || rest.split(/\s+/).length === 1;
  return { eyebrow: /^edit$/i.test(m[1]) ? 'Edit' : 'New', title: plain ? kind : rest.charAt(0).toUpperCase() + rest.slice(1) };
}

/** The footer's keyboard hints: creating offers "add another", editing does not. Pure. */
export function dialogHints(editing: boolean): string {
  return editing ? '⌘↵ save · Esc cancel' : '⌘↵ create · ⌘⇧↵ create and add another · Esc cancel';
}

/** "Create and add another": what the next blank dialog starts with — the kept fields (client, project) as they
 * were, the main input and everything else empty. Pure. */
export function carryOver(values: Record<string, string>, k: Pick<CreateKind, 'keep'>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of k.keep) if (values[name]) out[name] = values[name];
  return out;
}

// ── A task's typed line ─────────────────────────────────────────────────────

export interface Segment { text: string; kind: TokenKind | null }

/** The typed line cut into what was understood and what was not, in order and covering every character (so a copy
 * of it drawn behind the input lines up). Overlapping or out-of-range ranges are dropped. Pure. */
export function highlightSegments(input: string, ranges: TokenRange[]): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    if (r.start < at || r.end > input.length || r.end <= r.start) continue;
    if (r.start > at) out.push({ text: input.slice(at, r.start), kind: null });
    out.push({ text: input.slice(r.start, r.end), kind: r.kind });
    at = r.end;
  }
  if (at < input.length) out.push({ text: input.slice(at), kind: null });
  return out;
}

export interface UnderstoodChip { kind: 'due' | 'company' | 'priority' | 'project' | 'tag' | 'repeat' | 'someday'; label: string; tone: 'amber' | 'blue' | 'red' | 'grey' }

/** "Understood as →": the day (and time), the client, the priority, the project, the tags, repeating, parked. Empty
 * when the line says nothing but the task. `projectName` is the parsed project's name. Pure. */
export function understoodChips(p: Pick<ParsedTask, 'dueDate' | 'dueTime' | 'companyName' | 'priority' | 'projectId' | 'tags' | 'recurrence' | 'someday'>, projectName?: string | null): UnderstoodChip[] {
  const out: UnderstoodChip[] = [];
  if (p.someday) out.push({ kind: 'someday', label: 'Someday', tone: 'grey' });
  else if (p.dueDate) out.push({ kind: 'due', label: `${fmtDateWeekday(p.dueDate)}${p.dueTime ? ` · ${p.dueTime}` : ''}`, tone: 'amber' });
  if (p.companyName) out.push({ kind: 'company', label: p.companyName, tone: 'blue' });
  if (p.priority && p.priority !== 'Medium') out.push({ kind: 'priority', label: p.priority, tone: p.priority === 'High' ? 'red' : 'grey' });
  if (p.projectId != null && projectName) out.push({ kind: 'project', label: projectName, tone: 'grey' });
  for (const t of p.tags) out.push({ kind: 'tag', label: `# ${t}`, tone: 'grey' });
  if (p.recurrence) out.push({ kind: 'repeat', label: `↻ ${p.recurrence}`, tone: 'grey' });
  return out;
}

/** The fields the typed line fills, by the form's field names. A field the person edited by hand is theirs: it is
 * left alone (`touched`). A field the line had filled and no longer mentions is emptied. Pure. */
export function prefillFromParse(p: Pick<ParsedTask, 'dueDate' | 'companyName' | 'priority' | 'projectId' | 'recurrence'>, touched: ReadonlySet<string>, filled: ReadonlySet<string>): { set: Record<string, string>; filled: Set<string> } {
  const want: Record<string, string> = {
    todoDue: p.dueDate || '', todoClient: p.companyName || '', todoPriority: p.priority || '', todoProject: p.projectId != null ? String(p.projectId) : '', todoRecurrence: p.recurrence || '',
  };
  const set: Record<string, string> = {};
  const next = new Set<string>();
  for (const [name, value] of Object.entries(want)) {
    if (touched.has(name)) continue;
    if (value) { set[name] = value; next.add(name); }
    else if (filled.has(name)) set[name] = name === 'todoPriority' ? 'Medium' : '';
  }
  return { set, filled: next };
}
