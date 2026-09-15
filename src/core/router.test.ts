// @vitest-environment jsdom
// Router regression: the cross-module workflow Company → Opportunity →
// Proposal → Project → Meeting, back/forward, record links, closing records,
// deleted records, and the company shown beside a record. Module pages are
// stand-ins that behave like the real ones: set state, show the page, notify.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./recordRail', () => ({ updateRecordRail: vi.fn() }));
vi.mock('../lib/bulkBar', () => ({ syncBulkBars: vi.fn() }));

import { S } from '../lib/state';
import { notifyNavigated } from '../lib/registry';
import { currentPlace, openRecord, navBack, navForward, closeCurrentRecord, openRecordLink, placeCompany, navBackFromRecord } from './router';
import { placeKey } from '../lib/navHistory';
import type { Company, Meeting, Note, Opportunity, Project, Proposal, Todo } from '../lib/types';

const w = window as any;
const tick = () => new Promise((r) => setTimeout(r, 0));
const where = () => placeKey(currentPlace());

function page(detailId: string, set: (id: number | null) => void, exists: (id: number) => boolean, async = false) {
  const open = (id: number) => {
    if (!exists(id)) { if (document.getElementById(detailId)!.classList.contains('open')) close(); return; }
    set(id);
    document.getElementById(detailId)!.classList.add('open');
    notifyNavigated();
  };
  const close = () => { set(null); document.getElementById(detailId)!.classList.remove('open'); notifyNavigated(); };
  return { open: async ? async (id: number) => { await Promise.resolve(); open(id); } : open, close };
}

beforeEach(() => {
  document.body.innerHTML = `<div id="loc-crumbs"></div><button id="loc-back"></button><button id="loc-fwd"></button>
    ${['co-detail', 'opp-detail', 'pr-detail', 'proj-detail', 'meeting-detail', 'note-editor', 'task-detail'].map((id) => `<div id="${id}"></div>`).join('')}`;
  S.companies = [{ id: 1, name: 'Globex Test Co' } as Company];
  S.opportunities = [{ id: 5, name: 'Workforce deal', companyId: 1, companyName: 'Globex Test Co' } as Opportunity];
  S.proposals = [
    { id: 7, client: 'Globex (old name)', companyId: 1 } as Proposal,
    { id: 8, client: '', companyId: null } as Proposal,
    { id: 9, client: 'Unsaved Test Co', companyId: null } as Proposal,
  ];
  S.projects = [{ id: 11, name: 'Rollout', companyId: 1, companyName: 'Globex Test Co' } as Project];
  S.meetings = [{ id: 13, title: 'Kickoff', companyId: 1, companyName: 'Globex Test Co', projectId: 11, noteId: 17 } as Meeting];
  S.notes = [{ id: 17, title: 'Kickoff notes', companyId: 1, clientName: 'Globex Test Co' } as Note];
  S.todos = [{ id: 19, title: 'Send the model', companyId: 1, client: 'Globex (old name)', projectId: 11, meetingId: 13 } as Todo];
  S.currentNoteId = null; S.taskDetailId = null;
  S.currentTab = 'myday';
  S.currentCompany = null; S.currentOpportunityId = null; S.currentProposalId = null; S.currentProjectId = null; S.meetingEditId = null;
  w.switchTab = (tab: string) => { S.currentTab = tab; notifyNavigated(); };
  const company = page('co-detail', (id) => { S.currentCompany = id == null ? null : S.companies.find((c) => c.id === id)!.name; }, (id) => S.companies.some((c) => c.id === id));
  w.openCompanyDetail = (name: string) => company.open(S.companies.find((c) => c.name === name)?.id ?? -1);
  w.closeCompanyDetail = company.close;
  const opp = page('opp-detail', (id) => { S.currentOpportunityId = id; }, (id) => S.opportunities.some((o) => o.id === id), true);
  w.openOpportunityDetail = opp.open; w.closeOpportunityDetail = opp.close;
  const proposal = page('pr-detail', (id) => { S.currentProposalId = id; }, (id) => S.proposals.some((p) => p.id === id));
  w.openProposalPage = proposal.open; w.closeProposalPage = proposal.close;
  const project = page('proj-detail', (id) => { S.currentProjectId = id; }, (id) => S.projects.some((p) => p.id === id), true);
  w.openProjectDetail = project.open; w.closeProjectDetail = project.close;
  const meeting = page('meeting-detail', (id) => { S.meetingEditId = id; }, (id) => S.meetings.some((m) => m.id === id));
  w.openMeetingDetail = meeting.open; w.closeMeetingDetail = meeting.close;
  const note = page('note-editor', (id) => { S.currentNoteId = id; }, (id) => S.notes.some((n) => n.id === id));
  w.openNote = note.open;
  const task = page('task-detail', (id) => { S.taskDetailId = id; }, (id) => S.todos.some((t) => t.id === id));
  w.openTaskDetail = task.open; w.closeTaskDetail = task.close;
});

async function walkWorkflow(): Promise<void> {
  w.switchTab('companies'); await tick();
  openRecord('company', 1); await tick();
  openRecord('opportunity', 5); await tick();
  openRecord('proposal', 7); await tick();
  openRecord('project', 11); await tick();
  openRecord('meeting', 13); await tick();
}

describe('router: cross-module workflow', () => {
  it('opens each record in its module and records one history entry per move', async () => {
    await walkWorkflow();
    expect(where()).toBe('meetings/meeting/13');
    const trail: string[] = [where()];
    for (let i = 0; i < 5; i++) { navBack(); await tick(); trail.push(where()); }
    expect(trail).toEqual([
      'meetings/meeting/13', 'projects/project/11', 'database/proposal/7', 'opportunities/opportunity/5', 'companies/company/1', 'companies',
    ]);
    expect((document.getElementById('loc-back') as HTMLButtonElement).disabled).toBe(true);
    // Forward retraces the same path.
    for (const expected of ['companies/company/1', 'opportunities/opportunity/5', 'database/proposal/7', 'projects/project/11', 'meetings/meeting/13']) {
      navForward(); await tick();
      expect(where()).toBe(expected);
    }
    expect((document.getElementById('loc-fwd') as HTMLButtonElement).disabled).toBe(true);
  });

  it('reverse navigation: Meeting → Company through links, then back', async () => {
    w.switchTab('meetings'); await tick();
    openRecord('meeting', 13); await tick();
    const link = document.createElement('a');
    link.dataset.rkind = 'company'; link.dataset.rid = '1';
    openRecordLink(new Event('click'), link); await tick();
    expect(where()).toBe('companies/company/1');
    navBack(); await tick();
    expect(where()).toBe('meetings/meeting/13');
  });

  it('a new visit after going back drops the forward history', async () => {
    await walkWorkflow();
    navBack(); await tick(); navBack(); await tick();
    expect(where()).toBe('database/proposal/7');
    openRecord('company', 1); await tick();
    navForward(); await tick();
    expect(where()).toBe('companies/company/1');
  });

  it('closing a record returns to its module list, and ← Back returns to where you came from', async () => {
    await walkWorkflow();
    navBackFromRecord(); await tick();
    expect(where()).toBe('projects/project/11');
    expect(closeCurrentRecord()).toBe(true);
    await tick();
    expect(where()).toBe('projects');
    expect(closeCurrentRecord()).toBe(false);
  });

  it('a record deleted since it was visited lands on its module list, not a stuck page', async () => {
    await walkWorkflow();
    S.opportunities = [];
    S.proposals = S.proposals.filter((p) => p.id !== 7);
    navBack(); await tick(); navBack(); await tick();
    // The proposal page can't reopen: the router corrects the entry to where it actually is.
    expect(currentPlace().kind).not.toBe('proposal');
    navBack(); await tick();
    expect(where()).not.toBe('opportunities/opportunity/5');
    expect(S.currentOpportunityId).toBeNull();
    // Links to the deleted records do nothing harmful either.
    openRecord('opportunity', 5); await tick();
    expect(currentPlace().key).toBeUndefined();
  });
});

describe('router: work graph both ways', () => {
  it('Project → Meeting → Note → Task → Company, then back through each', async () => {
    w.switchTab('projects'); await tick();
    openRecord('project', 11); await tick();
    openRecord('meeting', 13); await tick();
    openRecord('note', 17); await tick();
    openRecord('task', 19); await tick();
    // The task shows its linked company under its current name, not its stale text.
    const ctx = document.querySelector('#loc-crumbs .loc-context a') as HTMLAnchorElement;
    expect([ctx.textContent, ctx.dataset.rid]).toEqual(['Globex Test Co', '1']);
    openRecordLink(new Event('click'), ctx); await tick();
    expect(where()).toBe('companies/company/1');
    const back: string[] = [];
    for (let i = 0; i < 4; i++) { navBack(); await tick(); back.push(where()); }
    expect(back).toEqual(['todo/task/19', 'notes/note/17', 'meetings/meeting/13', 'projects/project/11']);
  });
});

describe('router: company shown beside a record', () => {
  it('a proposal shows its linked company under the company’s current name', async () => {
    expect(placeCompany({ tab: 'database', kind: 'proposal', key: 7 })).toEqual({ id: 1, name: 'Globex Test Co' });
    w.switchTab('database'); await tick();
    openRecord('proposal', 7); await tick();
    const ctx = document.querySelector('#loc-crumbs .loc-context a') as HTMLAnchorElement;
    expect(ctx.textContent).toBe('Globex Test Co');
    expect(ctx.dataset.rid).toBe('1');
    // Proposal → Company through the location bar link, and back.
    openRecordLink(new Event('click'), ctx); await tick();
    expect(where()).toBe('companies/company/1');
    navBack(); await tick();
    expect(where()).toBe('database/proposal/7');
  });

  it('a proposal without a company shows none; one not yet linked shows its typed name', () => {
    expect(placeCompany({ tab: 'database', kind: 'proposal', key: 8 })).toBeNull();
    expect(placeCompany({ tab: 'database', kind: 'proposal', key: 9 })).toEqual({ id: null, name: 'Unsaved Test Co' });
    expect(placeCompany({ tab: 'database', kind: 'proposal', key: 404 })).toBeNull();
    expect(placeCompany({ tab: 'companies', kind: 'company', key: 1 })).toBeNull();
  });

  it('projects, opportunities and meetings use the linked company too', () => {
    S.companies = [{ id: 1, name: 'Globex Renamed' } as Company];
    for (const [tab, kind, key] of [['projects', 'project', 11], ['opportunities', 'opportunity', 5], ['meetings', 'meeting', 13]] as const) {
      expect(placeCompany({ tab, kind, key })).toEqual({ id: 1, name: 'Globex Renamed' });
    }
  });
});
