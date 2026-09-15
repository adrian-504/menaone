// "Create from here": the records you can start from the open record, each
// inheriting its context (Work Graph). One list feeds both the sidebar's
// "+ New" menu and the command palette, so they always offer the same things.
// Openers live in their tab modules and are reached through `window`, like
// the rest of the app's cross-module calls.

import { S } from '../lib/state';
import { currentPlace, placeCompany } from './router';

export interface ContextAction {
  id: string;
  label: string;
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
  switch (place.kind) {
    case 'company': {
      const name = S.currentCompany;
      if (!name) return [];
      const g = 'This Company';
      return [
        { id: 'ctx-co-contact', label: `New Contact at ${name}`, group: g, iconName: 'people', run: () => w().openContactModal?.(name, S.companies.find((c) => c.name === name)?.id ?? null) },
        { id: 'ctx-co-opportunity', label: `New Opportunity for ${name}`, group: g, iconName: 'briefcase', run: () => w().createOpportunityForCurrentCompany?.() },
        { id: 'ctx-co-meeting', label: `New Meeting with ${name}`, group: g, iconName: 'meeting', run: () => w().createMeetingForCurrentCompany?.() },
        { id: 'ctx-co-task', label: `New Task for ${name}`, group: g, iconName: 'check', run: () => w().createTodoForCompany?.(name) },
        { id: 'ctx-co-note', label: `New Note for ${name}`, group: g, iconName: 'note', run: () => w().createNoteForCompany?.(name) },
        { id: 'ctx-co-project', label: `New Project for ${name}`, group: g, iconName: 'target', run: () => w().createProjectForCurrentCompany?.() },
      ];
    }
    case 'opportunity': {
      const o = S.opportunities.find((x) => x.id === key);
      if (!o) return [];
      const g = 'This Opportunity';
      return [
        ...(o.proposalId == null ? [{ id: 'ctx-opp-proposal', label: 'Create Proposal for this Opportunity', group: g, iconName: 'database', run: () => w().createProposalForOpportunity?.() }] : []),
        { id: 'ctx-opp-meeting', label: 'New Meeting for this Opportunity', group: g, iconName: 'meeting', run: () => w().createMeetingForOpportunity?.(o.id) },
        { id: 'ctx-opp-task', label: 'New Task for this Opportunity', group: g, iconName: 'check', run: () => w().createTodoForOpportunity?.(o.id) },
        { id: 'ctx-opp-note', label: 'New Note for this Opportunity', group: g, iconName: 'note', run: () => { void w().createNoteForOpportunity?.(); } },
        ...(o.stage === 'Won' && o.projectId == null ? [{ id: 'ctx-opp-project', label: 'Create Project from this Opportunity', group: g, iconName: 'target', run: () => w().createProjectForOpportunity?.() }] : []),
      ];
    }
    case 'project': {
      if (key == null || !S.projects.some((p) => p.id === key)) return [];
      const g = 'This Project';
      return [
        { id: 'ctx-pj-meeting', label: 'New Meeting for this Project', group: g, iconName: 'meeting', run: () => w().createMeetingForProject?.(key) },
        { id: 'ctx-pj-task', label: 'New Task in this Project', group: g, iconName: 'check', run: () => w().createTodoForCurrentProject?.() },
        { id: 'ctx-pj-note', label: 'New Note for this Project', group: g, iconName: 'note', run: () => { void w().createNoteForProject?.(); } },
      ];
    }
    case 'meeting': {
      const m = S.meetings.find((x) => x.id === key);
      if (!m) return [];
      const g = 'This Meeting';
      return [
        { id: 'ctx-mt-task', label: 'New Task from this Meeting', group: g, iconName: 'check', run: () => w().createTodoForMeeting?.(m.id) },
        { id: 'ctx-mt-note', label: m.noteId != null ? 'Open Meeting Note' : 'New Meeting Note', group: g, iconName: 'note', run: () => { void w().openMeetingNote?.(m.id); } },
      ];
    }
    case 'note': {
      if (key == null || !S.notes.some((n) => n.id === key)) return [];
      const g = 'This Note';
      return [
        { id: 'ctx-note-task', label: 'New Task from this Note', group: g, iconName: 'check', run: () => { void w().createTodoForNote?.(key); } },
        { id: 'ctx-note-actions', label: 'Create Tasks from Action Items', group: g, iconName: 'check', run: () => { void w().createTasksFromNoteActionItems?.(); } },
      ];
    }
    default:
      return [];
  }
}

/** The company of the open record (not the company page itself), for "Contact at …". */
export function contextRecordCompany(): { id: number | null; name: string } | null {
  const place = currentPlace();
  return place.kind === 'company' ? null : placeCompany(place);
}
