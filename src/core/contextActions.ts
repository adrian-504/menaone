// "Create from here": the records you can start from the open record, each
// inheriting its context (Work Graph). One list feeds both the sidebar's
// "+ New" menu and the command palette, so they always offer the same things.
// Openers live in their tab modules and are reached through `window`, like
// the rest of the app's cross-module calls.

import { S } from '../lib/state';
import { currentPlace, placeCompany } from './router';
import { showMenuAt } from '../lib/contextMenu';
import { expose } from '../lib/utils';

export interface ContextAction {
  id: string;
  /** Full label for the palette, e.g. "New Meeting for this Project". */
  label: string;
  /** The record type it creates, for "New" menus, e.g. "Meeting". */
  noun: string;
  /** Palette group, e.g. "This Project". */
  group: string;
  iconName: string;
  run: () => void;
}

const w = () => window as any;

/** Actions for the open record, most specific first. Empty outside a record. */
export function contextCreateActions(): ContextAction[] {
  const place = currentPlace();
  const key = place.key != null ? Number(place.key) : null;
  const a = (id: string, noun: string, label: string, group: string, iconName: string, run: () => void): ContextAction => ({ id, noun, label, group, iconName, run });
  switch (place.kind) {
    case 'company': {
      const name = S.currentCompany;
      if (!name) return [];
      const g = 'This Company';
      return [
        a('ctx-co-contact', 'Contact', `New Contact at ${name}`, g, 'people', () => w().openContactModal?.(name, S.companies.find((c) => c.name === name)?.id ?? null)),
        a('ctx-co-opportunity', 'Opportunity', `New Opportunity for ${name}`, g, 'briefcase', () => w().createOpportunityForCurrentCompany?.()),
        a('ctx-co-meeting', 'Meeting', `New Meeting with ${name}`, g, 'meeting', () => w().createMeetingForCurrentCompany?.()),
        a('ctx-co-task', 'Task', `New Task for ${name}`, g, 'check', () => w().createTodoForCompany?.(name)),
        a('ctx-co-commitment', 'Commitment', `New Commitment with ${name}`, g, 'flag', () => w().createCommitmentForCurrentCompany?.()),
        a('ctx-co-note', 'Note', `New Note for ${name}`, g, 'note', () => w().createNoteForCompany?.(name)),
        a('ctx-co-proposal', 'Proposal', `New Proposal for ${name}`, g, 'database', () => w().createProposalForCurrentCompany?.()),
        a('ctx-co-project', 'Project', `New Project for ${name}`, g, 'target', () => w().createProjectForCurrentCompany?.()),
        a('ctx-co-agreement', 'Agreement', `New Agreement for ${name}`, g, 'document', () => w().openAgrForCompany?.()),
      ];
    }
    case 'opportunity': {
      const o = S.opportunities.find((x) => x.id === key);
      if (!o) return [];
      const g = 'This Opportunity';
      return [
        ...(o.proposalId == null ? [a('ctx-opp-proposal', 'Proposal', 'New Proposal for this Opportunity', g, 'database', () => w().createProposalForOpportunity?.())] : []),
        a('ctx-opp-meeting', 'Meeting', 'New Meeting for this Opportunity', g, 'meeting', () => w().createMeetingForOpportunity?.(o.id)),
        a('ctx-opp-task', 'Task', 'New Task for this Opportunity', g, 'check', () => w().createTodoForOpportunity?.(o.id)),
        a('ctx-opp-commitment', 'Commitment', 'New Commitment for this Opportunity', g, 'flag', () => w().createCommitmentFor?.('opportunity', o.id)),
        a('ctx-opp-note', 'Note', 'New Note for this Opportunity', g, 'note', () => { void w().createNoteForOpportunity?.(); }),
        ...(o.stage === 'Won' && o.projectId == null ? [a('ctx-opp-project', 'Project', 'New Project from this Opportunity', g, 'target', () => w().createProjectForOpportunity?.())] : []),
      ];
    }
    case 'project': {
      if (key == null || !S.projects.some((p) => p.id === key)) return [];
      const g = 'This Project';
      return [
        a('ctx-pj-meeting', 'Meeting', 'New Meeting for this Project', g, 'meeting', () => w().createMeetingForProject?.(key)),
        a('ctx-pj-task', 'Task', 'New Task in this Project', g, 'check', () => w().createTodoForCurrentProject?.()),
        a('ctx-pj-commitment', 'Commitment', 'New Commitment for this Project', g, 'flag', () => w().createCommitmentFor?.('project', key)),
        a('ctx-pj-note', 'Note', 'New Note for this Project', g, 'note', () => { void w().createNoteForProject?.(); }),
      ];
    }
    case 'meeting': {
      const m = S.meetings.find((x) => x.id === key);
      if (!m) return [];
      const g = 'This Meeting';
      return [
        ...(m.noteId != null ? [a('ctx-mt-note', 'Note', 'Open the Older Meeting Note', g, 'note', () => w().openRecord?.('note', m.noteId))] : []),
        a('ctx-mt-task', 'Task', 'New Task from this Meeting', g, 'check', () => w().createTodoForMeeting?.(m.id)),
        a('ctx-mt-commitment', 'Commitment', 'New Commitment from this Meeting', g, 'flag', () => w().createCommitmentFor?.('meeting', m.id)),
      ];
    }
    case 'note': {
      if (key == null || !S.notes.some((n) => n.id === key)) return [];
      const g = 'This Note';
      return [
        a('ctx-note-task', 'Task', 'New Task from this Note', g, 'check', () => { void w().createTodoForNote?.(key); }),
        a('ctx-note-actions', 'Tasks from action items', 'New Tasks from Action Items', g, 'checklist', () => { void w().createTasksFromNoteActionItems?.(); }),
      ];
    }
    default:
      return [];
  }
}

/** The "New" button in a record's header: the same actions as "+ New" and the palette. */
export function recordNewMenu(e: MouseEvent): void {
  e.stopPropagation();
  const actions = contextCreateActions();
  if (actions.length) showMenuAt(e.currentTarget as HTMLElement, actions.map((x) => ({ label: x.noun, iconName: x.iconName, run: x.run })));
}
expose('recordNewMenu', recordNewMenu);

/** The company of the open record (not the company page itself), for "Contact at …". */
export function contextRecordCompany(): { id: number | null; name: string } | null {
  const place = currentPlace();
  return place.kind === 'company' ? null : placeCompany(place);
}
