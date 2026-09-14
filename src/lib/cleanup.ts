// Clean-up mode: queues of records whose status or details no longer match
// reality (proposals nobody closed, kickoffs that happened, opportunities with
// no value). Pure — tabs/cleanup.ts renders a queue one record at a time and
// applies the fixes.

import { PS } from './commercial';
import { daysBetween, isOpenOpportunity } from './pipeline';
import type { Agreement, Company, Opportunity, Proposal, Todo } from './types';
import type { RecordKind } from './navHistory';

export type CleanupAction =
  | 'lost' | 'withdrawn' | 'won' | 'keep' | 'snooze_followup'
  | 'approve' | 'changes' | 'back_to_drafting'
  | 'agreement_active' | 'agreement_not_started' | 'agreement_ended'
  | 'opportunity_details' | 'opportunity_lost'
  | 'set_industry' | 'set_owner'
  | 'task_done' | 'task_someday' | 'task_date' | 'task_delete';

export type QueueId =
  | 'stale-sent' | 'client-signed' | 'long-review' | 'stale-drafting'
  | 'kickoff-passed' | 'ended-still-active'
  | 'opportunity-incomplete' | 'company-industry' | 'company-owner' | 'old-tasks';

export interface CleanupItem {
  /** Unique across queues; used for "keep for now". */
  key: string;
  record: { kind: RecordKind; id: number };
  title: string;
  subtitle: string;
  /** Label/value pairs shown on the card. */
  facts: [string, string][];
  /** For sorting: bigger is more overdue. */
  age: number;
}

export interface CleanupQueue {
  id: QueueId;
  group: 'Proposals' | 'Agreements' | 'Pipeline' | 'Companies' | 'Tasks';
  title: string;
  /** What's wrong, in one sentence. */
  why: string;
  actions: CleanupAction[];
  /** Actions that can be applied to many selected records at once. */
  bulk: CleanupAction[];
  items: CleanupItem[];
}

export interface CleanupInput {
  today: string;
  proposals: Proposal[];
  agreements: Agreement[];
  opportunities: Opportunity[];
  companies: Company[];
  todos: Todo[];
  /** Company ids that have at least one industry. */
  companiesWithIndustry: Set<number>;
  /** Item keys kept (hidden) until a date. */
  kept: Record<string, string>;
}

export const STALE_SENT_DAYS = 45;
export const CLIENT_SIGNED_DAYS = 30;
export const LONG_REVIEW_DAYS = 14;
export const STALE_DRAFT_DAYS = 30;
export const OLD_TASK_DAYS = 60;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ago = (d: number | null) => (d == null ? '—' : d === 0 ? 'today' : `${plural(d, 'day')} ago`);

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function money(amount: number | null | undefined, currency: string | null | undefined): string {
  return amount == null ? '—' : `${currency || 'SAR'} ${Math.round(amount).toLocaleString('en-US')}`;
}

function proposalItem(p: Proposal, since: string | null, today: string, sinceLabel: string): CleanupItem {
  const d = daysBetween(since, today);
  const lastNote = [...(p.notes || [])].filter((n) => n.text).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  const facts: [string, string][] = [
    ['Service', p.type || '—'],
    [sinceLabel, `${fmt(since)} (${ago(d)})`],
    ['Monthly fee', money(p.monthlyFee, p.currency)],
  ];
  if (p.owner) facts.push(['Owner', p.owner]);
  if (lastNote?.text) facts.push(['Last note', `${fmt(lastNote.date)} — ${lastNote.text.length > 140 ? `${lastNote.text.slice(0, 140)}…` : lastNote.text}`]);
  if (p.remarks) facts.push(['Remarks', p.remarks.length > 140 ? `${p.remarks.slice(0, 140)}…` : p.remarks]);
  return { key: `proposal:${p.id}`, record: { kind: 'proposal', id: p.id }, title: p.client, subtitle: `${p.type || 'Proposal'} · SL# ${p.id}`, facts, age: d ?? 0 };
}

export function buildCleanupQueues(i: CleanupInput): CleanupQueue[] {
  const kept = (key: string) => !!i.kept[key] && i.kept[key] > i.today;
  const live = i.proposals.filter((p) => !p.archived);
  const queues: CleanupQueue[] = [];

  queues.push({
    id: 'stale-sent', group: 'Proposals', title: 'Sent with no answer',
    why: `Sent to the client over ${STALE_SENT_DAYS} days ago and still waiting. Close the ones that are gone; keep the ones still in play.`,
    actions: ['lost', 'snooze_followup', 'won', 'withdrawn'], bulk: ['lost', 'withdrawn', 'snooze_followup'],
    items: live.filter((p) => p.status === PS.SENT && (daysBetween(p.dateSentToClient || p.sentDate, i.today) ?? 0) > STALE_SENT_DAYS && !(p.snoozedUntil && p.snoozedUntil >= i.today))
      .map((p) => proposalItem(p, p.dateSentToClient || p.sentDate, i.today, 'Sent')),
  });
  queues.push({
    id: 'client-signed', group: 'Proposals', title: 'Signed by the client, not by us',
    why: `Marked "Signed by Client" for over ${CLIENT_SIGNED_DAYS} days. Usually it was countersigned and the status was never updated.`,
    actions: ['won', 'lost', 'withdrawn'], bulk: ['withdrawn'],
    items: live.filter((p) => p.status === PS.CLIENT_SIGNED && (daysBetween(p.dateSigned || p.dateSentToClient, i.today) ?? 0) > CLIENT_SIGNED_DAYS)
      .map((p) => proposalItem(p, p.dateSigned || p.dateSentToClient, i.today, 'Client signed')),
  });
  queues.push({
    id: 'long-review', group: 'Proposals', title: 'Stuck in internal review',
    why: `In review for over ${LONG_REVIEW_DAYS} days with no outcome recorded. Record what the reviewer decided.`,
    actions: ['approve', 'changes', 'withdrawn', 'lost'], bulk: ['approve', 'withdrawn'],
    items: live.filter((p) => p.status === PS.REVIEW && p.reviewStatus !== 'approved' && (daysBetween(p.reviewRequestedAt || p.dateSentToHassan, i.today) ?? 0) > LONG_REVIEW_DAYS)
      .map((p) => proposalItem(p, p.reviewRequestedAt || p.dateSentToHassan, i.today, 'Sent for review')),
  });
  queues.push({
    id: 'stale-drafting', group: 'Proposals', title: 'Requests and drafts going nowhere',
    why: `Requested or in drafting for over ${STALE_DRAFT_DAYS} days.`,
    actions: ['keep', 'withdrawn', 'lost'], bulk: ['withdrawn', 'keep'],
    items: live.filter((p) => (p.status === PS.REQUEST || p.status === PS.DRAFTING) && (daysBetween(p.dateAdded, i.today) ?? 0) > STALE_DRAFT_DAYS)
      .map((p) => ({ ...proposalItem(p, p.dateAdded, i.today, 'Requested'), subtitle: `${p.status} · ${p.type || 'Proposal'} · SL# ${p.id}` })),
  });

  const agreementItem = (a: Agreement, facts: [string, string][], age: number): CleanupItem => ({
    key: `agreement:${a.id}`, record: { kind: 'agreement', id: a.id }, title: a.client || a.agrRef || 'Agreement',
    subtitle: [a.agrRef, a.type].filter(Boolean).join(' · ') || 'Agreement', facts: [['Monthly fee', money(a.monthlyFee, a.currency)], ...facts], age,
  });
  queues.push({
    id: 'kickoff-passed', group: 'Agreements', title: 'Kickoff date has passed',
    why: 'The service is still "Kickoff scheduled" but the start date is behind us. Mark it active so it counts towards MRR, or reset it.',
    actions: ['agreement_active', 'agreement_not_started', 'agreement_ended'], bulk: ['agreement_active'],
    items: i.agreements.filter((a) => a.status !== 'Canceled' && a.serviceStatus === 'Kickoff scheduled' && a.startDate && a.startDate < i.today)
      .map((a) => agreementItem(a, [['Start date', `${fmt(a.startDate)} (${ago(daysBetween(a.startDate, i.today))})`]], daysBetween(a.startDate, i.today) ?? 0)),
  });
  queues.push({
    id: 'ended-still-active', group: 'Agreements', title: 'Ended but still active',
    why: 'The end date passed over a week ago and the service is still marked active, so it still counts towards MRR.',
    actions: ['agreement_ended', 'keep'], bulk: ['agreement_ended'],
    items: i.agreements.filter((a) => a.status !== 'Canceled' && a.serviceStatus === 'Active' && a.endDate && (daysBetween(a.endDate, i.today) ?? 0) > 7)
      .map((a) => agreementItem(a, [['End date', `${fmt(a.endDate)} (${ago(daysBetween(a.endDate, i.today))})`], ['Auto-renew', a.autoRenew ? 'Yes' : 'No']], daysBetween(a.endDate, i.today) ?? 0)),
  });

  queues.push({
    id: 'opportunity-incomplete', group: 'Pipeline', title: 'Opportunities missing the basics',
    why: 'Open opportunities without a value, a next step or an expected close date. The pipeline totals and health scores depend on them.',
    actions: ['opportunity_details', 'opportunity_lost', 'keep'], bulk: ['keep'],
    items: i.opportunities.filter((o) => isOpenOpportunity(o) && (o.estimatedValue == null || !(o.nextAction || '').trim() || !o.expectedCloseDate))
      .map((o) => {
        const missing = [o.estimatedValue == null ? 'value' : '', !(o.nextAction || '').trim() ? 'next step' : '', !o.expectedCloseDate ? 'close date' : ''].filter(Boolean);
        return {
          key: `opportunity:${o.id}`, record: { kind: 'opportunity' as RecordKind, id: o.id }, title: o.name, subtitle: [o.companyName, o.stage].filter(Boolean).join(' · '),
          facts: [['Missing', missing.join(', ')], ['Created', `${fmt(o.createdAt)} (${ago(daysBetween(o.createdAt, i.today))})`], ...(o.description ? [['Description', o.description.slice(0, 160)] as [string, string]] : [])],
          age: daysBetween(o.createdAt, i.today) ?? 0,
        };
      }),
  });

  const active = i.companies.filter((c) => !c.archived);
  const companyItem = (c: Company, facts: [string, string][]): CleanupItem => ({
    key: `company:${c.id}`, record: { kind: 'company', id: c.id }, title: c.name,
    subtitle: [c.city, c.country].filter(Boolean).join(', ') || c.website || 'Company', facts, age: 0,
  });
  queues.push({
    id: 'company-industry', group: 'Companies', title: 'Companies without an industry',
    why: 'Industry drives the company filters and the win/loss reports by industry.',
    actions: ['set_industry', 'keep'], bulk: ['set_industry'],
    items: active.filter((c) => !i.companiesWithIndustry.has(c.id)).map((c) => companyItem(c, [['Website', c.website || '—'], ['Description', c.description?.slice(0, 160) || '—']])),
  });
  queues.push({
    id: 'company-owner', group: 'Companies', title: 'Companies without an owner',
    why: 'Who looks after the relationship. Needed once colleagues use MENA One, and for reports by owner.',
    actions: ['set_owner', 'keep'], bulk: ['set_owner'],
    items: active.filter((c) => !(c.owner || '').trim()).map((c) => companyItem(c, [['Industry', i.companiesWithIndustry.has(c.id) ? 'Set' : '—'], ['Website', c.website || '—']])),
  });

  queues.push({
    id: 'old-tasks', group: 'Tasks', title: 'Old open tasks',
    why: `Open for over ${OLD_TASK_DAYS} days with no date, or overdue by more than 30 days. Finish them, park them in Someday, or give them a date.`,
    actions: ['task_done', 'task_date', 'task_someday', 'task_delete'], bulk: ['task_done', 'task_someday', 'task_delete'],
    items: i.todos.filter((t) => t.status !== 'Done' && !t.parentId && !t.someday && (
      (!t.dueDate && (daysBetween(t.createdAt, i.today) ?? 0) > OLD_TASK_DAYS) || (!!t.dueDate && (daysBetween(t.dueDate, i.today) ?? 0) > 30)
    )).map((t) => ({
      key: `task:${t.id}`, record: { kind: 'task' as RecordKind, id: t.id }, title: t.title, subtitle: [t.client, t.priority ? `${t.priority} priority` : ''].filter(Boolean).join(' · ') || 'Task',
      facts: [['Created', `${fmt(t.createdAt)} (${ago(daysBetween(t.createdAt, i.today))})`], ['Due', t.dueDate ? `${fmt(t.dueDate)} (${ago(daysBetween(t.dueDate, i.today))})` : 'No date'], ...(t.description ? [['Notes', t.description.slice(0, 160)] as [string, string]] : [])],
      age: daysBetween(t.dueDate || t.createdAt, i.today) ?? 0,
    })),
  });

  for (const q of queues) {
    q.items = q.items.filter((x) => !kept(`${q.id}|${x.key}`)).sort((a, b) => b.age - a.age || a.title.localeCompare(b.title));
  }
  return queues;
}

export const totalToClean = (queues: CleanupQueue[]): number => queues.reduce((n, q) => n + q.items.length, 0);
