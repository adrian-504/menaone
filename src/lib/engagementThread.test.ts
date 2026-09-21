import { describe, expect, it } from 'vitest';
import { engagementThread, type GraphData } from './workGraph';
import type { Agreement, Opportunity, Project, Proposal } from './types';

const today = '2026-09-21';
const opp = (over: Partial<Opportunity>): Opportunity => ({
  id: 1, name: 'Contoso payroll', companyId: 1, companyName: 'Contoso Logistics', owner: null, stage: 'Proposal', status: 'Open', estimatedValue: null,
  currency: 'SAR', probability: null, expectedCloseDate: null, description: null, nextAction: null, proposalId: null, projectId: null, sortOrder: null,
  archived: false, createdAt: '2026-08-01', updatedAt: null, tags: [], ...over,
});
const prop = (over: Partial<Proposal>): Proposal => ({
  id: 10, client: 'Contoso Logistics', type: 'Payroll', status: 'Sent to Client', sentDate: null, dblSignedDate: null, kickoffDate: null, finance: null,
  hubspot: null, owner: null, remarks: null, dateAdded: '2026-08-05', monthlyFee: null, contractMonths: null, winLossReason: null, docLink: null,
  archived: false, archivedAt: null, snoozedUntil: null, dateSentToHassan: null, dateSentToClient: '2026-08-10', dateSigned: null, notes: [], ...over,
});
const agr = (over: Partial<Agreement>): Agreement => ({
  id: 20, agrRef: 'CON_PAY_001_0926', client: 'Contoso Logistics', type: 'Payroll', status: 'Client Review', preparedBy: null, datePrepared: '2026-09-01',
  dateSentToClient: '2026-09-02', dateClientSigned: null, dateMenaSigned: null, dateFiled: null, monthlyFee: null, contractMonths: null, proposalId: 10,
  hubspot: null, docLink: null, actionDate: null, remarks: null, createdAt: '2026-09-01', ...over,
});
const proj = (over: Partial<Project>): Project => ({
  id: 30, name: 'Contoso rollout', status: 'In Progress', startDate: '2026-09-15', targetDate: null, archived: false, ...over,
} as Project);
const data = (over: Partial<GraphData>): GraphData => ({ companies: [], opportunities: [], projects: [], meetings: [], proposals: [], agreements: [], contacts: [], todos: [], ...over });

describe('engagementThread', () => {
  it('a proposal with no opportunity starts at the proposal — no empty step in front', () => {
    const t = engagementThread({ kind: 'proposal', id: 10 }, data({ proposals: [prop({})] }), today);
    expect(t.nodes.map((n) => n.kind)).toEqual(['proposal']);
    expect(t.missing).toEqual(['agreement']); // no project step: a project links through an opportunity
    expect(t.after).toMatchObject({ waitingOn: 'them', days: 42, late: true });
    expect(t.next).toMatchObject({ label: 'Record signature', action: 'open', kind: 'proposal', id: 10 });
  });

  it('an agreement with no proposal starts at the agreement', () => {
    const t = engagementThread({ kind: 'agreement', id: 20 }, data({ agreements: [agr({ proposalId: null, status: 'MENA Signature', dateClientSigned: '2026-09-18' })] }), today);
    expect(t.nodes.map((n) => n.kind)).toEqual(['agreement']);
    expect(t.after).toMatchObject({ waitingOn: 'us', days: 3, late: false });
  });

  it('the full chain, in order, with days between each step', () => {
    const d = data({
      opportunities: [opp({ proposalId: 10, projectId: 30, stage: 'Won', status: 'Won' })],
      proposals: [prop({ status: 'Signed by Both Parties', dateSigned: '2026-08-25' })],
      agreements: [agr({ status: 'Signed', dateClientSigned: '2026-09-05', dateMenaSigned: '2026-09-06' })],
      projects: [proj({})],
    });
    for (const from of [{ kind: 'opportunity' as const, id: 1 }, { kind: 'proposal' as const, id: 10 }, { kind: 'agreement' as const, id: 20 }, { kind: 'project' as const, id: 30 }]) {
      const t = engagementThread(from, d, today);
      expect(t.nodes.map((n) => `${n.kind}:${n.id}`), from.kind).toEqual(['opportunity:1', 'proposal:10', 'agreement:20', 'project:30']);
    }
    const t = engagementThread({ kind: 'project', id: 30 }, d, today);
    expect(t.nodes.map((n) => n.date)).toEqual(['2026-08-01', '2026-08-10', '2026-09-06', '2026-09-15']);
    expect(t.gaps.map((g) => g.days)).toEqual([9, 27, 9]);
    expect(t.missing).toEqual([]);
    expect(t.next).toBeNull();
    expect(t.nodes[1]).toMatchObject({ label: 'Payroll (SL# 10)', tone: 'green', dateLabel: 'Sent' });
  });

  it('an opportunity with nothing yet offers to create the proposal', () => {
    const t = engagementThread({ kind: 'opportunity', id: 1 }, data({ opportunities: [opp({ waitingOn: 'them', waitingSince: '2026-09-01' })] }), today);
    expect(t.nodes.map((n) => n.kind)).toEqual(['opportunity']);
    expect(t.missing).toEqual(['proposal', 'agreement', 'project']);
    expect(t.next).toEqual({ label: 'Create proposal', action: 'create_proposal', kind: 'opportunity', id: 1 });
    expect(t.after).toMatchObject({ waitingOn: 'them', days: 20, late: true });
  });

  it('a signed proposal offers to draft its agreement; a won opportunity with an agreement offers the project', () => {
    const signed = engagementThread({ kind: 'proposal', id: 10 }, data({ proposals: [prop({ status: 'Signed by Both Parties' })] }), today);
    expect(signed.next).toEqual({ label: 'Draft agreement', action: 'draft_agreement', kind: 'proposal', id: 10 });
    const d = data({ opportunities: [opp({ proposalId: 10, stage: 'Won', status: 'Won' })], proposals: [prop({ status: 'Signed by Both Parties' })], agreements: [agr({ status: 'Signed' })] });
    expect(engagementThread({ kind: 'agreement', id: 20 }, d, today).next).toEqual({ label: 'Create project', action: 'create_project', kind: 'opportunity', id: 1 });
  });

  it('several agreements: the active one shows, the others are listed with it', () => {
    const t = engagementThread({ kind: 'proposal', id: 10 }, data({
      proposals: [prop({ status: 'Signed by Both Parties' })],
      agreements: [agr({ id: 20, status: 'Canceled', createdAt: '2026-09-01' }), agr({ id: 21, agrRef: 'CON_PAY_002', status: 'Signed', serviceStatus: 'Active', startDate: '2026-09-01', createdAt: '2026-09-05' } as Partial<Agreement>), agr({ id: 22, agrRef: 'CON_PAY_003', status: 'In Preparation', createdAt: '2026-09-10' })],
    }), today);
    const node = t.nodes.find((n) => n.kind === 'agreement')!;
    expect(node.id).toBe(21);
    expect(node.others?.map((o) => o.id)).toEqual([22, 20]);
  });

  it('a lost or withdrawn proposal is closed: durations, no waiting, nothing next', () => {
    for (const status of ['Lost', 'Withdrawn']) {
      const t = engagementThread({ kind: 'proposal', id: 10 }, data({ proposals: [prop({ status })] }), today);
      expect(t.closed).toBe(true);
      expect(t.after).toBeNull();
      expect(t.missing).toEqual([]);
      expect(t.next).toBeNull();
    }
  });

  it('a lone project with no origin has nothing to show', () => {
    const t = engagementThread({ kind: 'project', id: 30 }, data({ projects: [proj({})] }), today);
    expect(t.nodes).toHaveLength(1);
    expect(t.show).toBe(false);
  });
});
