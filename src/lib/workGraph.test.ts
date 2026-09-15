import { describe, it, expect } from 'vitest';
import {
  actionItems, addLinks, companyFromForm, companyOf, contextFromMeeting, contextFromNote, contextFromOpportunity, contextFromProject,
  inheritCompany, opportunityTasks, projectChain, proposalProject, replaceLinks, taskFields, unconvertedActionItems, EMPTY_CONTEXT, type GraphData,
} from './workGraph';
import type { Agreement, Company, Contact, EntityLink, Meeting, Note, Opportunity, Project, Proposal, Todo } from './types';

// A fictional engagement: Contoso Logistics won an opportunity that became a
// project with a kickoff meeting; Fabrikam is a second company.
function graph(): GraphData {
  return {
    companies: [{ id: 1, name: 'Contoso Logistics' } as Company, { id: 2, name: 'Fabrikam' } as Company],
    opportunities: [
      { id: 10, name: 'Contoso Saudization', companyId: 1, companyName: 'Contoso Logistics', stage: 'Won', proposalId: 20, projectId: 30 } as Opportunity,
      { id: 11, name: 'Fabrikam Payroll', companyId: 2, companyName: 'Fabrikam', stage: 'Lead', proposalId: null, projectId: null } as Opportunity,
    ],
    proposals: [{ id: 20, client: 'Contoso Logistics', companyId: 1 } as Proposal],
    agreements: [{ id: 25, client: 'Contoso Logistics', companyId: 1, proposalId: 20 } as Agreement],
    projects: [{ id: 30, name: 'Contoso Saudization Project', companyId: 1, companyName: 'Contoso Logistics' } as Project],
    meetings: [{ id: 40, title: 'Contoso Kickoff', companyId: 1, companyName: 'Contoso Logistics', projectId: 30, opportunityId: null, noteId: 50 } as Meeting],
    contacts: [{ id: 60, name: 'Dana Test', companyId: 1, clientName: 'Contoso Logistics' } as Contact, { id: 61, name: 'Other Person', companyId: 1 } as Contact],
    todos: [],
  };
}

describe('work graph: context inheritance', () => {
  it('an opportunity passes on its company id and current company name', () => {
    const g = graph();
    g.companies[0].name = 'Contoso Logistics KSA'; // renamed since the opportunity was loaded
    const ctx = contextFromOpportunity(g, g.opportunities[0]);
    expect(ctx).toMatchObject({ companyId: 1, companyName: 'Contoso Logistics KSA', opportunityId: 10, projectId: null });
  });

  it('a meeting created from a project inherits the project and its company', () => {
    const g = graph();
    expect(contextFromProject(g, g.projects[0])).toEqual({ ...EMPTY_CONTEXT, companyId: 1, companyName: 'Contoso Logistics', projectId: 30 });
  });

  it('a note created from a meeting inherits meeting, project and company', () => {
    const g = graph();
    const note = { id: 50, title: 'Kickoff notes', clientName: '', companyId: null } as Note;
    expect(contextFromNote(g, note, [])).toEqual({ companyId: 1, companyName: 'Contoso Logistics', projectId: 30, opportunityId: null, meetingId: 40, noteId: 50 });
  });

  it('a note’s own links win over the meeting’s, and its own company is kept', () => {
    const g = graph();
    const note = { id: 50, title: 'Kickoff notes', clientName: 'Fabrikam', companyId: 2 } as Note;
    const links: EntityLink[] = [{ fromType: 'note', fromId: 50, toType: 'opportunity', toId: 11 }];
    expect(contextFromNote(g, note, links)).toMatchObject({ companyId: 2, companyName: 'Fabrikam', opportunityId: 11, projectId: 30, meetingId: 40 });
  });

  it('a task from a meeting (or its note) inherits company, project and meeting', () => {
    const g = graph();
    const fields = taskFields(contextFromMeeting(g, g.meetings[0]));
    expect(fields).toEqual({ type: 'client', client: 'Contoso Logistics', companyId: 1, projectId: 30, opportunityId: null, meetingId: 40 });
  });

  it('a record without a company takes its project’s, then its opportunity’s', () => {
    const g = graph();
    expect(inheritCompany(g, { ...EMPTY_CONTEXT, projectId: 30 })).toMatchObject({ companyId: 1, companyName: 'Contoso Logistics' });
    expect(inheritCompany(g, { ...EMPTY_CONTEXT, opportunityId: 11 })).toMatchObject({ companyId: 2, companyName: 'Fabrikam' });
  });

  it('never silently replaces a company that is set', () => {
    const g = graph();
    const ctx = { ...EMPTY_CONTEXT, companyId: 2, companyName: 'Fabrikam', projectId: 30 };
    expect(inheritCompany(g, ctx)).toBe(ctx);
  });

  it('a general task has no company id even when its context had one', () => {
    expect(taskFields({ ...EMPTY_CONTEXT, companyId: 1, companyName: null })).toMatchObject({ type: 'general', client: null, companyId: null });
  });
});

describe('work graph: explicit reassignment from a form', () => {
  const ctx = { companyId: 1, companyName: 'Contoso Logistics' };
  it('keeps the context company id while the field shows its name (any capitals)', () => {
    expect(companyFromForm(ctx, ' contoso logistics ')).toEqual({ companyName: 'contoso logistics', companyId: 1 });
  });
  it('typing another company drops the id so the backend resolves the new name', () => {
    expect(companyFromForm(ctx, 'Fabrikam')).toEqual({ companyName: 'Fabrikam', companyId: null });
  });
  it('clearing the field clears the company', () => {
    expect(companyFromForm(ctx, '')).toEqual({ companyName: null, companyId: null });
  });
  it('an unlinked company keeps its typed name without an id', () => {
    expect(companyOf(graph(), 99, 'Woodgrove')).toEqual({ companyId: null, companyName: 'Woodgrove' });
  });
});

describe('work graph: links', () => {
  const links: EntityLink[] = [
    { fromType: 'note', fromId: 5, toType: 'project', toId: 30 },
    { fromType: 'note', fromId: 5, toType: 'opportunity', toId: 10 },
    { fromType: 'task', fromId: 7, toType: 'note', toId: 5 }, // incoming: never part of the note's outgoing set
  ];
  it('changing a note’s project keeps its opportunity link', () => {
    expect(replaceLinks(links, 'note', 5, 'project', [31])).toEqual([
      { fromType: 'note', fromId: 5, toType: 'opportunity', toId: 10 },
      { fromType: 'note', fromId: 5, toType: 'project', toId: 31 },
    ]);
  });
  it('adding links keeps existing ones and skips duplicates and empty ids', () => {
    expect(addLinks(links, 'note', 5, [{ toType: 'project', toId: 30 }, { toType: 'opportunity', toId: null }, { toType: 'meeting', toId: 40 }])).toEqual([
      links[0], links[1], { fromType: 'note', fromId: 5, toType: 'meeting', toId: 40 },
    ]);
  });
});

describe('work graph: action items', () => {
  const md = '## Action Items\n- [ ] Send revised Saudization model\n- [x] Book the room\n* [ ]   Share the   headcount plan \n- [ ] send revised saudization model\nNot - [ ] an item';
  it('finds unchecked checklist items once each', () => {
    expect(actionItems(md)).toEqual(['Send revised Saudization model', 'Share the headcount plan']);
  });
  it('skips items that already have a task with the same title', () => {
    expect(unconvertedActionItems(md, [{ title: 'send revised  Saudization model' } as Todo])).toEqual(['Share the headcount plan']);
  });
});

describe('work graph: related records', () => {
  it('a project shows the opportunity, proposal, agreement and contacts it came from', () => {
    const g = graph();
    const chain = projectChain(g, 30, [{ fromType: 'contact', fromId: 60, toType: 'opportunity', toId: 10 }, { fromType: 'contact', fromId: 61, toType: 'opportunity', toId: 11 }]);
    expect(chain.opportunity?.id).toBe(10);
    expect(chain.proposal?.id).toBe(20);
    expect(chain.agreement?.id).toBe(25);
    expect(chain.contacts.map((c) => c.id)).toEqual([60]);
    expect(projectChain(g, 999).opportunity).toBeUndefined();
  });
  it('a proposal leads to its project through the opportunity', () => {
    expect(proposalProject(graph(), 20)?.id).toBe(30);
    expect(proposalProject(graph(), 21)).toBeUndefined();
  });
  it('an opportunity’s tasks include tasks from its meetings', () => {
    const g = graph();
    g.meetings.push({ id: 41, title: 'Payroll call', opportunityId: 11 } as Meeting);
    g.todos = [
      { id: 1, title: 'direct', opportunityId: 11, meetingId: null } as Todo,
      { id: 2, title: 'from meeting', opportunityId: null, meetingId: 41 } as Todo,
      { id: 3, title: 'other', opportunityId: 10, meetingId: 40 } as Todo,
    ];
    expect(opportunityTasks(g, 11).map((t) => t.id)).toEqual([1, 2]);
  });
});
