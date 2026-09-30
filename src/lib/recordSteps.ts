// The next step in a record page's header (owner, 30-Sep-2026: "one pattern:
// grey tool, blue next step, …"). One blue button per record, named for what
// happens next where the record stands; null when there is nothing to do.
// Pure — mirrors proposalSteps.ts; the pages turn a Step into a button.

import { OPPORTUNITY_STAGES } from './types';
import type { Agreement, Contact, Milestone, Opportunity, Project } from './types';
import type { Step } from './proposalSteps';

export type { Step };

const js = (v: string) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const short = (name: string, max = 28) => (name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name);

/** Project: finish the next milestone; with none left, move the project on. */
export function projectNextStep(p: Pick<Project, 'status' | 'archived'>, milestones: Pick<Milestone, 'id' | 'name' | 'status' | 'sortOrder'>[]): Step | null {
  if (p.archived || p.status === 'Completed' || p.status === 'Cancelled') return null;
  const next = [...milestones].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).find((m) => m.status !== 'Done');
  if (next) return { label: `Complete milestone: ${short(next.name)}`, run: `completeMilestone(${next.id})` };
  return p.status === 'In Progress' || p.status === 'At Risk'
    ? { label: 'Mark completed', run: "changeCurrentProjectStatus('Completed')" }
    : { label: 'Mark in progress', run: "changeCurrentProjectStatus('In Progress')" };
}

/** Opportunity: the next stage; a proposal when it reaches Proposal without one. */
export function opportunityNextStep(o: Pick<Opportunity, 'stage' | 'archived' | 'proposalId' | 'projectId'>): Step | null {
  if (o.archived || o.stage === 'Lost' || o.stage === 'On Hold') return null;
  if (o.stage === 'Won') return o.projectId == null ? { label: 'Create project', run: 'createProjectForOpportunity()' } : null;
  if (o.stage === 'Proposal' && o.proposalId == null) return { label: 'Create proposal', run: 'createProposalForOpportunity()' };
  const open = OPPORTUNITY_STAGES.slice(0, OPPORTUNITY_STAGES.indexOf('Won') + 1) as readonly string[];
  const at = open.indexOf(o.stage);
  const next = at < 0 ? open[0] : open[at + 1];
  if (!next) return null;
  return next === 'Won'
    ? { label: 'Mark won', run: "changeCurrentOpportunityStage('Won')" }
    : { label: `Advance to ${next}`, run: `changeCurrentOpportunityStage('${js(next)}')` };
}

/** Days from `from` to `to` (YYYY-MM-DD), whole days. */
const daysTo = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** The last day to give notice: the end less the notice period (the end itself without one). */
export function noticeDate(a: Pick<Agreement, 'endDate' | 'noticeDays'>): string | null {
  if (!a.endDate) return null;
  const d = new Date(`${a.endDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (a.noticeDays ?? 0));
  return d.toISOString().slice(0, 10);
}

/** Agreement: sign it, start the service, renew near the notice date, else the proposal it came from. */
export function agreementNextStep(a: Pick<Agreement, 'status' | 'serviceStatus' | 'endDate' | 'noticeDays' | 'proposalId'>, today: string): Step | null {
  if (a.status === 'Canceled') return null;
  if (a.status !== 'Signed') return { label: 'Mark signed', run: 'agreementMarkSigned()' };
  if (a.serviceStatus !== 'Active' && a.serviceStatus !== 'Ended') return { label: 'Mark active', run: "agreementFieldChanged('serviceStatus','Active')" };
  const notice = noticeDate(a);
  if (a.serviceStatus === 'Active' && notice && a.endDate && daysTo(today, notice) <= 30 && daysTo(today, a.endDate) >= -7) {
    return { label: 'Renew…', run: 'agreementRenew()' };
  }
  return a.proposalId != null ? { label: 'Open proposal', run: `openRecord('proposal', ${a.proposalId})` } : null;
}

/** Contact: write to them; with no email, call or WhatsApp. */
export function contactNextStep(c: Pick<Contact, 'email' | 'phone' | 'whatsapp'>): Step | null {
  if (c.email) return { label: 'Email', run: `openExternalUrl('mailto:${js(c.email)}')` };
  const wa = c.whatsapp || c.phone;
  if (c.whatsapp && wa) return { label: 'WhatsApp', run: `openExternalUrl('https://wa.me/${wa.replace(/[^0-9]/g, '')}')` };
  if (c.phone) return { label: 'Call', run: `openExternalUrl('tel:${c.phone.replace(/[^+0-9]/g, '')}')` };
  return null;
}
