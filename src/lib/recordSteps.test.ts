// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { agreementNextStep, contactNextStep, noticeDate, opportunityNextStep, projectNextStep } from './recordSteps';
import { proposalNextStep } from './proposalSteps';
import { recordHeaderHtml } from './recordHeader';
import type { Agreement, Contact, Milestone, Opportunity, Project, Proposal } from './types';

const ms = (id: number, name: string, status: string, sortOrder: number) => ({ id, name, status, sortOrder }) as Milestone;
const proj = (status: string, archived = false, computedProgress = 0) => ({ status, archived, computedProgress }) as Project;
const opp = (stage: string, over: Partial<Opportunity> = {}) => ({ stage, archived: false, proposalId: null, projectId: null, ...over }) as Opportunity;
const agr = (over: Partial<Agreement>) => ({ status: 'Signed', serviceStatus: 'Active', endDate: null, noticeDays: null, proposalId: null, ...over }) as Agreement;

describe('project: the next milestone, else move the project on', () => {
  it('completes the first unfinished milestone in order', () => {
    const s = projectNextStep(proj('In Progress'), [ms(3, 'Go live', 'Not Started', 2), ms(2, 'Payroll set-up', 'In Progress', 1), ms(1, 'Kickoff', 'Done', 0)]);
    expect(s).toEqual({ label: 'Complete milestone: Payroll set-up', run: 'completeMilestone(2)' });
  });
  it('a long milestone name is shortened in the label', () => {
    expect(projectNextStep(proj('Planning'), [ms(1, 'Transfer every employee file to the new GOSI portal', 'Not Started', 0)])!.label)
      .toBe('Complete milestone: Transfer every employee fil…');
  });
  it('no milestones at all and nothing done: Add milestone', () => {
    expect(projectNextStep(proj('In Progress'), [])?.label).toBe('Add milestone');
    expect(projectNextStep(proj('In Progress', false, 40), [])?.label).toBe('Mark completed');
  });
  it('no milestones left: Mark in progress, then Mark completed; nothing once closed', () => {
    expect(projectNextStep(proj('Planning', false, 10), [])?.label).toBe('Mark in progress');
    expect(projectNextStep(proj('In Progress'), [ms(1, 'Kickoff', 'Done', 0)])?.label).toBe('Mark completed');
    expect(projectNextStep(proj('Completed'), [])).toBeNull();
    expect(projectNextStep(proj('In Progress', true), [])).toBeNull();
  });
});

describe('opportunity: the next stage', () => {
  it('advances in pipeline order', () => {
    expect(opportunityNextStep(opp('Lead'))).toEqual({ label: 'Advance to Qualified', run: "changeCurrentOpportunityStage('Qualified')" });
    expect(opportunityNextStep(opp('Solution Design'))?.label).toBe('Advance to Proposal');
    expect(opportunityNextStep(opp('Verbal Commitment'))?.label).toBe('Mark won');
  });
  it('at Proposal with no proposal: Create proposal; with one: Advance to Negotiation', () => {
    expect(opportunityNextStep(opp('Proposal'))?.label).toBe('Create proposal');
    expect(opportunityNextStep(opp('Proposal', { proposalId: 4 }))?.label).toBe('Advance to Negotiation');
  });
  it('won: Create project until there is one; lost, on hold or archived: nothing', () => {
    expect(opportunityNextStep(opp('Won'))?.label).toBe('Create project');
    expect(opportunityNextStep(opp('Won', { projectId: 2 }))).toBeNull();
    expect(opportunityNextStep(opp('Lost'))).toBeNull();
    expect(opportunityNextStep(opp('On Hold'))).toBeNull();
    expect(opportunityNextStep(opp('Lead', { archived: true }))).toBeNull();
  });
});

describe('agreement: sign, start, renew, else its proposal', () => {
  const today = '2026-09-30';
  it('unsigned: Mark signed; signed, not started: Mark active', () => {
    expect(agreementNextStep(agr({ status: 'Sent' }), today)?.label).toBe('Mark signed');
    expect(agreementNextStep(agr({ serviceStatus: 'Not started' }), today)?.label).toBe('Mark active');
  });
  it('Start renewal from 30 days before the notice date to a week after the end, until it is decided', () => {
    expect(noticeDate({ endDate: '2026-12-31', noticeDays: 30 })).toBe('2026-12-01');
    expect(agreementNextStep(agr({ endDate: '2026-12-31', noticeDays: 90 }), today)?.label).toBe('Start renewal');
    expect(agreementNextStep(agr({ endDate: '2026-12-31', noticeDays: 60 }), today)).toBeNull();
    expect(agreementNextStep(agr({ endDate: '2027-06-30', noticeDays: 30, proposalId: 9 }), today)).toEqual({ label: 'Open proposal', run: "openRecord('proposal', 9)" });
    expect(agreementNextStep(agr({ endDate: '2026-09-25' }), today)?.label).toBe('Start renewal');
    expect(agreementNextStep(agr({ endDate: '2026-09-01' }), today)).toBeNull();
    expect(agreementNextStep(agr({ endDate: '2026-12-31', noticeDays: 90, renewalDecision: 'end' }), today)).toBeNull();
  });
  it('cancelled: nothing', () => {
    expect(agreementNextStep(agr({ status: 'Canceled' }), today)).toBeNull();
  });
});

describe('contact: Email, else WhatsApp, else Call', () => {
  it('picks the first way to reach them', () => {
    expect(contactNextStep({ email: 'sara@contoso.test', phone: '+966 50 000 0000', whatsapp: null } as Contact)).toEqual({ label: 'Email', run: "openExternalUrl('mailto:sara@contoso.test')" });
    expect(contactNextStep({ email: null, phone: '+966 50 000 0000', whatsapp: '+966 55 111 2222' } as Contact)?.run).toBe("openExternalUrl('https://wa.me/966551112222')");
    expect(contactNextStep({ email: null, phone: '+966 50 000 0000', whatsapp: null } as Contact)?.label).toBe('Call');
    expect(contactNextStep({ email: null, phone: null, whatsapp: null } as Contact)).toBeNull();
  });
});

describe('every record header has exactly one blue button', () => {
  const blue = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return [...d.querySelectorAll('.btn-primary')].map((b) => b.textContent); };
  it.each([
    ['project', recordHeaderHtml([{ label: 'Edit', run: 'editCurrentProject()' }], projectNextStep(proj('Planning'), [ms(1, 'Kickoff', 'Not Started', 0)]), 'projectMoreMenu(event)'), 'Complete milestone: Kickoff'],
    ['opportunity', recordHeaderHtml([{ label: 'Edit', run: 'editCurrentOpportunity()' }], opportunityNextStep(opp('Meeting')), 'opportunityMoreMenu(event)'), 'Advance to Solution Design'],
    ['agreement', recordHeaderHtml([], agreementNextStep(agr({ serviceStatus: 'Not started' }), '2026-09-30'), 'agreementMoreMenu(event)'), 'Mark active'],
    ['contact', recordHeaderHtml([], contactNextStep({ email: 'sara@contoso.test', phone: null, whatsapp: null } as Contact), 'contactMoreMenu(event)'), 'Email'],
    ['proposal', recordHeaderHtml([], proposalNextStep({ id: 7, status: 'Drafting', reviewStatus: null, revisions: [] } as unknown as Proposal, []).primary, 'proposalMoreMenu(event)'), 'Submit for review'],
  ])('%s', (_kind, html, label) => {
    expect(blue(html)).toEqual([label]);
    const d = document.createElement('div'); d.innerHTML = html;
    expect(d.lastElementChild?.getAttribute('aria-label')).toBe('More');
  });
});
