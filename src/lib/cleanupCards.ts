// Clean-up in My Day's language (1.60 "pages-2"): what the one-at-a-time card
// shows for each kind of record — four fact panels, the most likely choice —
// plus the page's strip and how far through the review you are. Pure:
// tabs/cleanup.ts draws it; the queues themselves are lib/cleanup.ts.

import type { Agreement, Company, Contact, Opportunity, Proposal, Todo, Touch } from './types';
import { proposalSentDate } from './commercial';
import { daysBetween } from './pipeline';
import { followUpCount, touchesOf } from './followup';
import { fmtDateShort } from './dates';
import { plural, type StripPanel, type Tone } from './pageKit';
import { QUEUE_ORDER, type CleanupAction, type CleanupGroup, type CleanupItem, type CleanupQueue, type QueueId } from './cleanup';

export interface FactPanel { value: string; caption: string; warn?: boolean }
export interface Recommendation { action: CleanupAction; hint: string }
export interface CardView { meta: string; panels: FactPanel[]; recommend: Recommendation | null }

/** A queue's small tile in the left list: a glyph on its role colour. */
export const QUEUE_KIND: Record<QueueId, { glyph: string; tone: Tone }> = {
  'stale-sent': { glyph: '✉', tone: 'red' },
  'long-review': { glyph: '◔', tone: 'amber' },
  'client-signed': { glyph: '✎', tone: 'coral' },
  'stale-drafting': { glyph: '…', tone: 'grey' },
  'opportunity-incomplete': { glyph: '→', tone: 'amber' },
  'commitment-company': { glyph: '⚑', tone: 'amber' },
  'company-owner': { glyph: '◎', tone: 'blue' },
  'company-industry': { glyph: '▦', tone: 'blue' },
  'company-contacts': { glyph: '☺', tone: 'blue' },
  'ended-still-active': { glyph: '■', tone: 'green' },
  'kickoff-passed': { glyph: '▶', tone: 'green' },
  'old-tasks': { glyph: '☑', tone: 'grey' },
};

/** What each choice does, under its name on the card. */
export const ACTION_HINT: Record<CleanupAction, string> = {
  lost: 'Close it with a reason', withdrawn: 'We pulled it', won: 'Create the agreement', keep: 'Hide it here for 30 days', snooze_followup: 'Snooze for 30 days',
  approve: 'The reviewer said yes', changes: 'Back to you to edit', back_to_drafting: 'Reopen the draft', nudge: 'Log a reminder, look again in a week',
  agreement_active: 'It counts towards the monthly total', agreement_not_started: 'Clear the start date', agreement_ended: 'It stops counting',
  opportunity_details: 'Value, next step, close date', opportunity_lost: 'Take it off the pipeline',
  set_industry: 'Pick from the list', set_owner: 'Who looks after it', add_contact: 'The person you deal with',
  task_done: 'Tick it off', task_someday: 'Park it without a date', task_date: 'Bring it back on a day', task_delete: 'Remove it',
  commitment_edit: 'Choose the right company',
};

export interface CardInput {
  today: string;
  proposals: Proposal[];
  agreements: Agreement[];
  opportunities: Opportunity[];
  companies: Company[];
  todos: Todo[];
  contacts: Contact[];
  touches: Pick<Touch, 'proposalId' | 'companyId' | 'kind' | 'direction' | 'at' | 'contactId'>[];
  /** "Active client", "In discussion", … for a company, with its active services. */
  relationshipOf?: (companyId: number | null | undefined, name: string) => { label: string; services: string[] } | null;
  reviewerOf?: (p: Proposal) => string;
  /** The person using the app (the default owner). */
  me?: string;
}

const money = (amount: number | null | undefined, currency: string | null | undefined) => (amount == null ? '—' : `${(currency || 'SAR').toUpperCase()} ${Math.round(amount).toLocaleString('en-US')}`);
const days = (n: number | null) => (n == null ? '—' : plural(Math.max(0, n), 'day'));
const first = (name: string) => name.trim().split(/\s+/)[0] || name;

/** The follow-up count at or past which a sent proposal is most likely lost. */
export const LIKELY_LOST_FOLLOWUPS = 4;
/** …or this long with no answer and no follow-ups at all. */
export const LIKELY_LOST_DAYS = 180;
/** A request or draft untouched this long is most likely to be withdrawn. */
export const LIKELY_WITHDRAWN_DAYS = 90;

function relationPanel(i: CardInput, companyId: number | null | undefined, name: string): FactPanel {
  const r = i.relationshipOf?.(companyId, name);
  if (!r) return { value: 'New company', caption: 'no agreement or proposal on record' };
  return { value: r.label, caption: r.services.length ? `${r.services.slice(0, 3).join(', ')} under an agreement` : 'no active agreement' };
}

function proposalCard(q: QueueId, p: Proposal, i: CardInput): CardView {
  const contact = p.primaryContactId != null ? i.contacts.find((c) => c.id === p.primaryContactId)?.name : null;
  const meta = [`SL# ${p.id}`, p.owner ? `owner ${p.owner}` : '', contact ? `contact ${contact}` : ''].filter(Boolean).join(' · ');
  const fee: FactPanel = { value: money(p.monthlyFee, p.currency), caption: p.monthlyFee ? `a month${p.contractMonths ? ` · ${p.contractMonths} months` : ''}` : 'not priced' };
  const rel = relationPanel(i, p.companyId, p.client);
  if (q === 'stale-sent') {
    const sent = proposalSentDate(p);
    const d = daysBetween(sent, i.today);
    const n = followUpCount(p, i.touches);
    const last = touchesOf(p, i.touches).filter((t) => t.direction === 'out').map((t) => t.at.slice(0, 10)).sort().pop();
    const likelyLost = n >= LIKELY_LOST_FOLLOWUPS || (d ?? 0) >= LIKELY_LOST_DAYS;
    return {
      meta, panels: [{ value: days(d), caption: `since it was sent, ${fmtDateShort(sent, true)}`, warn: true }, { value: String(n), caption: n ? `${n === 1 ? 'follow-up' : 'follow-ups'}, last ${fmtDateShort(last, true)}` : 'follow-ups logged' }, fee, rel],
      recommend: likelyLost ? { action: 'lost', hint: n >= LIKELY_LOST_FOLLOWUPS ? `Most likely after ${n} follow-ups` : `Most likely after ${days(d)}` } : { action: 'snooze_followup', hint: 'Recent enough to still be alive' },
    };
  }
  if (q === 'long-review') {
    const since = p.reviewRequestedAt || p.dateSentToHassan;
    const reviewer = i.reviewerOf?.(p) || 'the reviewer';
    return {
      meta, panels: [{ value: days(daysBetween(since, i.today)), caption: `in review since ${fmtDateShort(since, true)}`, warn: true }, { value: first(reviewer), caption: 'has it for review' }, fee, rel],
      recommend: { action: 'nudge', hint: `Remind ${first(reviewer)} first` },
    };
  }
  if (q === 'client-signed') {
    const since = p.dateSigned || proposalSentDate(p);
    return {
      meta, panels: [{ value: days(daysBetween(since, i.today)), caption: `since the client signed, ${fmtDateShort(since, true)}`, warn: true }, fee, { value: p.owner || '—', caption: 'owner' }, rel],
      recommend: { action: 'won', hint: 'Usually countersigned and never updated' },
    };
  }
  const d = daysBetween(p.dateAdded, i.today);
  return {
    meta: [p.status, meta].join(' · '),
    panels: [{ value: days(d), caption: `since the request, ${fmtDateShort(p.dateAdded, true)}`, warn: true }, { value: p.promisedBy ? fmtDateShort(p.promisedBy, true) : 'No promise', caption: p.promisedBy ? 'promised to the client' : 'no date given to the client' }, fee, rel],
    recommend: (d ?? 0) >= LIKELY_WITHDRAWN_DAYS ? { action: 'withdrawn', hint: `Nothing moved in ${days(d)}` } : { action: 'keep', hint: 'Still recent: decide later' },
  };
}

/** The card for one item of one queue: its meta line, four fact panels and the most likely choice. Pure. */
export function cardFor(q: Pick<CleanupQueue, 'id' | 'actions'>, item: CleanupItem, i: CardInput): CardView {
  const id = item.record.id;
  const fallback: CardView = { meta: item.subtitle, panels: item.facts.slice(0, 4).map(([k, v]) => ({ value: v, caption: k.toLowerCase() })), recommend: null };
  const ok = (v: CardView): CardView => ({ ...v, recommend: v.recommend && q.actions.includes(v.recommend.action) ? v.recommend : null });
  switch (q.id) {
    case 'stale-sent': case 'long-review': case 'client-signed': case 'stale-drafting': {
      const p = i.proposals.find((x) => x.id === id);
      return p ? ok(proposalCard(q.id, p, i)) : fallback;
    }
    case 'opportunity-incomplete': {
      const o = i.opportunities.find((x) => x.id === id);
      if (!o) return fallback;
      const missing = [o.estimatedValue == null ? 'value' : '', !(o.nextAction || '').trim() ? 'next step' : '', !o.expectedCloseDate ? 'close date' : ''].filter(Boolean);
      return ok({
        meta: [o.companyName, o.stage, o.owner ? `owner ${o.owner}` : ''].filter(Boolean).join(' · '),
        panels: [{ value: plural(missing.length, 'thing'), caption: `missing: ${missing.join(', ')}`, warn: true }, { value: money(o.estimatedValue, o.currency), caption: o.estimatedValue == null ? 'no value yet' : 'estimated value' }, { value: days(daysBetween(o.createdAt, i.today)), caption: `open since ${fmtDateShort(o.createdAt, true)}` }, relationPanel(i, o.companyId, o.companyName || '')],
        recommend: { action: 'opportunity_details', hint: 'A minute to fill in' },
      });
    }
    case 'company-owner': case 'company-industry': case 'company-contacts': {
      const c = i.companies.find((x) => x.id === id);
      if (!c) return fallback;
      const people = i.contacts.filter((p) => p.companyId === c.id).length;
      const open = i.proposals.filter((p) => !p.archived && p.companyId === c.id && !['Signed by Both Parties', 'Lost', 'Withdrawn'].includes(p.status)).length;
      const rec: Recommendation = q.id === 'company-owner' ? { action: 'set_owner', hint: i.me ? `Assign ${first(i.me)}` : 'Assign yourself' }
        : q.id === 'company-industry' ? { action: 'set_industry', hint: 'Drives filters and reports' } : { action: 'add_contact', hint: 'Start with one person' };
      return ok({
        meta: [[c.city, c.country].filter(Boolean).join(', '), c.website || ''].filter(Boolean).join(' · ') || 'Company',
        panels: [relationPanel(i, c.id, c.name), { value: c.industries?.[0] || 'Not set', caption: 'industry', warn: !c.industries?.length }, { value: String(people), caption: people === 1 ? 'contact' : 'contacts', warn: people === 0 }, { value: String(open), caption: open === 1 ? 'open proposal' : 'open proposals' }],
        recommend: rec,
      });
    }
    case 'ended-still-active': case 'kickoff-passed': {
      const a = i.agreements.find((x) => x.id === id);
      if (!a) return fallback;
      const ended = q.id === 'ended-still-active';
      const date = ended ? a.endDate : a.startDate;
      return ok({
        meta: [a.agrRef, a.type].filter(Boolean).join(' · ') || 'Agreement',
        panels: [{ value: days(daysBetween(date, i.today)), caption: ended ? `since it ended, ${fmtDateShort(date, true)}` : `since the start date, ${fmtDateShort(date, true)}`, warn: true }, { value: money(a.monthlyFee, a.currency), caption: 'a month' }, { value: a.serviceStatus || '—', caption: 'service status' }, { value: a.autoRenew ? 'Yes' : 'No', caption: 'auto-renew' }],
        recommend: ended ? { action: 'agreement_ended', hint: 'The end date has passed' } : { action: 'agreement_active', hint: 'The start date has passed' },
      });
    }
    case 'old-tasks': {
      const t = i.todos.find((x) => x.id === id);
      if (!t) return fallback;
      const late = t.dueDate ? daysBetween(t.dueDate, i.today) : null;
      return ok({
        meta: [t.client, t.priority ? `${t.priority} priority` : ''].filter(Boolean).join(' · ') || 'Task',
        panels: [{ value: days(daysBetween(t.createdAt, i.today)), caption: `open since ${fmtDateShort(t.createdAt, true)}`, warn: true }, { value: t.dueDate ? fmtDateShort(t.dueDate, true) : 'No date', caption: late != null ? `${days(late)} overdue` : 'never given a day' }, { value: t.priority || '—', caption: 'priority' }, { value: t.client || 'Internal', caption: 'for' }],
        recommend: t.dueDate ? { action: 'task_date', hint: 'Give it a real day' } : { action: 'task_someday', hint: 'No date in months: park it' },
      });
    }
    default:
      return ok({ ...fallback, recommend: { action: 'commitment_edit', hint: 'Fix the company' } });
  }
}

// ── The strip ───────────────────────────────────────────────────────────────

/** Seconds a decision takes, for "about N minutes of work". */
export const SECONDS_EACH = 25;
export const minutesFor = (n: number): number => (n === 0 ? 0 : Math.max(1, Math.round((n * SECONDS_EACH) / 60)));

const COMPANY_GAP: Partial<Record<QueueId, string>> = { 'company-owner': 'owner', 'company-contacts': 'contacts', 'company-industry': 'industry' };

/** To review (minutes of work, cleared this month) · proposals stuck · pipeline gaps · company details; a panel opens
 * its group's first queue with something in it. Pure. */
export function cleanupStrip(queues: CleanupQueue[], clearedThisMonth: number): StripPanel[] {
  const total = queues.reduce((n, q) => n + q.items.length, 0);
  const group = (g: CleanupGroup) => queues.filter((q) => q.group === g);
  const count = (qs: CleanupQueue[]) => qs.reduce((n, q) => n + q.items.length, 0);
  const firstOf = (qs: CleanupQueue[]) => qs.find((q) => q.items.length)?.id;
  const props = group('Proposals'), pipe = group('Pipeline'), cos = group('Companies');
  const oldest = props.flatMap((q) => q.items).sort((a, b) => b.age - a.age)[0];
  const gaps = cos.filter((q) => q.items.length).map((q) => COMPANY_GAP[q.id]).filter(Boolean);
  const missing = pipe.find((q) => q.id === 'opportunity-incomplete')?.items[0]?.facts.find(([k]) => k === 'Missing')?.[1];
  const mins = minutesFor(total);
  const panel = (key: string, qs: CleanupQueue[], label: string, lead: string, detail: string, tone: Tone): StripPanel =>
    ({ key, n: String(count(qs)), count: count(qs), label, lead, detail, tone, action: `cleanupQueue('${firstOf(qs) || qs[0]?.id}')` });
  return [
    { key: 'all', total: true, n: `${total} to review`, count: total, label: total ? `about ${plural(mins, 'minute')} of work` : 'everything is up to date', lead: 'cleared this month', detail: String(clearedThisMonth), tone: 'coral' },
    panel('proposals', props, 'proposals stuck', 'oldest', oldest ? `${plural(oldest.age, 'day')} · ${oldest.title}` : '', 'red'),
    panel('pipeline', pipe, pipe.reduce((n, q) => n + q.items.length, 0) === 1 ? 'pipeline gap' : 'pipeline gaps', 'missing', missing ? missing.replace(/, ([^,]*)$/, ' and $1') : 'links to fix', 'amber'),
    panel('companies', cos, 'company details', 'missing', gaps.join(', '), 'blue'),
  ];
}

/** "3 of 7": where this item is in the whole review, counting queues in their order. Pure. */
export function reviewPosition(queues: CleanupQueue[], queueId: QueueId, index: number): { at: number; of: number; pct: number } {
  const ordered = [...queues].sort((a, b) => QUEUE_ORDER.indexOf(a.id) - QUEUE_ORDER.indexOf(b.id));
  const of = ordered.reduce((n, q) => n + q.items.length, 0);
  let before = 0;
  for (const q of ordered) { if (q.id === queueId) break; before += q.items.length; }
  const at = before + index + 1;
  return { at, of, pct: of ? Math.round((at / of) * 100) : 0 };
}

/** Records cleared per month ("2026-10" → 12), kept in app_meta. Pure. */
export function bumpCleared(map: Record<string, number>, month: string, delta: number): Record<string, number> {
  const next = { ...map, [month]: Math.max(0, (map[month] || 0) + delta) };
  // Only the last twelve months are worth keeping.
  for (const k of Object.keys(next).sort().slice(0, -12)) delete next[k];
  return next;
}
