// @vitest-environment jsdom
// Clean-up in My Day's language (1.60 "pages-2"): the card's fact panels, the most likely choice per kind, the strip, progress.
import { describe, expect, it } from 'vitest';

import { buildCleanupQueues, type CleanupInput } from './cleanup';
import { bumpCleared, cardFor, cleanupStrip, minutesFor, reviewPosition, type CardInput } from './cleanupCards';
import type { Company, Opportunity, Proposal, Todo } from './types';

const T = '2026-10-01';
const P = (over: Partial<Proposal>): Proposal => ({
  id: 4, client: 'Acme Holdings', companyId: 1, type: 'Mobilization', status: 'Sent to Client', sentDate: '2025-04-10', dblSignedDate: null, kickoffDate: null, finance: null, hubspot: null,
  owner: 'Ahmad', remarks: null, dateAdded: '2025-04-01', monthlyFee: 4000, contractMonths: 12, winLossReason: null, docLink: null, archived: false, archivedAt: null, snoozedUntil: null,
  dateSentToHassan: null, dateSentToClient: '2025-04-10', dateSigned: null, notes: [], currency: 'SAR', ...over,
});
const company = (id: number, over: Partial<Company> = {}): Company => ({ id, name: `Co ${id}`, legalName: null, industries: [], website: null, country: null, city: null, companyType: null, status: null, owner: null, description: null, archived: false, createdAt: null, updatedAt: null, ...over });
const base = (over: Partial<CleanupInput> = {}): CleanupInput => ({ today: T, proposals: [], agreements: [], opportunities: [], companies: [], todos: [], companiesWithIndustry: new Set(), kept: {}, ...over });
const card = (over: Partial<CardInput> = {}): CardInput => ({ today: T, proposals: [], agreements: [], opportunities: [], companies: [], todos: [], contacts: [], touches: [], ...over });
const touch = (at: string) => ({ proposalId: 4, companyId: null, kind: 'email_out' as const, direction: 'out' as const, at, contactId: null });

describe('the card', () => {
  it('sent with no answer: days since sent, follow-ups, the fee and the relationship; four follow-ups → Mark lost', () => {
    const p = P({});
    const qs = buildCleanupQueues(base({ proposals: [p] }));
    const q = qs.find((x) => x.id === 'stale-sent')!;
    const touches = ['2025-05-02', '2025-06-20', '2025-08-03', '2026-09-28'].map(touch);
    const c = cardFor(q, q.items[0], card({ proposals: [p], touches, relationshipOf: () => ({ label: 'Active client', services: ['Payroll', 'PRO'] }) }));
    expect(c.meta).toBe('SL# 4 · owner Ahmad');
    expect(c.panels).toEqual([
      { value: '539 days', caption: 'since it was sent, 10 Apr 2025', warn: true },
      { value: '4', caption: 'follow-ups, last 28 Sept' },
      { value: 'SAR 4,000', caption: 'a month · 12 months' },
      { value: 'Active client', caption: 'Payroll, PRO under an agreement' },
    ]);
    expect(c.recommend).toEqual({ action: 'lost', hint: 'Most likely after 4 follow-ups' });
  });
  it('a recent one with few follow-ups is most likely still in play', () => {
    const p = P({ dateSentToClient: '2026-08-01', sentDate: '2026-08-01' });
    const q = buildCleanupQueues(base({ proposals: [p] })).find((x) => x.id === 'stale-sent')!;
    expect(cardFor(q, q.items[0], card({ proposals: [p], touches: [touch('2026-08-20')] })).recommend?.action).toBe('snooze_followup');
  });
  it('stuck in review → Nudge the reviewer; signed by the client → Signed by both; an old request → Withdrawn', () => {
    const review = P({ id: 2, status: 'In Internal Review', reviewRequestedAt: '2026-09-08' });
    const signed = P({ id: 5, status: 'Signed by Client', dateSigned: '2026-06-01' });
    const old = P({ id: 7, status: 'Proposal Request Received', dateAdded: '2026-05-01' });
    const fresh = P({ id: 8, status: 'Drafting', dateAdded: '2026-08-20' });
    const qs = buildCleanupQueues(base({ proposals: [review, signed, old, fresh] }));
    const input = card({ proposals: [review, signed, old, fresh], reviewerOf: () => 'Hassan Balaghi' });
    const rec = (id: string, n = 0) => { const q = qs.find((x) => x.id === id)!; return cardFor(q, q.items[n], input).recommend; };
    expect(rec('long-review')).toEqual({ action: 'nudge', hint: 'Remind Hassan first' });
    expect(qs.find((x) => x.id === 'long-review')!.actions).toEqual(['nudge', 'approve', 'changes', 'withdrawn']);
    expect(rec('client-signed')?.action).toBe('won');
    expect(rec('stale-drafting', 0)?.action).toBe('withdrawn'); // 153 days
    expect(rec('stale-drafting', 1)?.action).toBe('keep'); // 42 days
  });
  it('a company without an owner → assign me; without contacts → add one', () => {
    const cos = [company(1, { industries: ['Retail'] })];
    const qs = buildCleanupQueues(base({ companies: cos, companiesWithIndustry: new Set([1]), contacts: [] }));
    const input = card({ companies: cos, me: 'Ahmad Abdallah' });
    const owner = qs.find((x) => x.id === 'company-owner')!;
    expect(cardFor(owner, owner.items[0], input).recommend).toEqual({ action: 'set_owner', hint: 'Assign Ahmad' });
    const people = qs.find((x) => x.id === 'company-contacts')!;
    expect(people.items.map((x) => x.record.id)).toEqual([1]);
    expect(cardFor(people, people.items[0], input)).toMatchObject({ recommend: { action: 'add_contact' }, panels: [{ value: 'New company' }, { value: 'Retail' }, { value: '0', warn: true }, { value: '0' }] });
  });
  it('the contacts queue only runs when contacts are known', () => {
    expect(buildCleanupQueues(base({ companies: [company(1)] })).find((x) => x.id === 'company-contacts')!.items).toEqual([]);
  });
  it('an opportunity missing the basics → fill them in; an old task with a date → give it a day, without → Someday', () => {
    const o: Opportunity = { id: 1, name: 'Deal', companyId: 1, companyName: 'Co', owner: null, stage: 'Lead', status: 'Open', estimatedValue: 15000, currency: 'SAR', probability: null, expectedCloseDate: null, description: null, nextAction: null, proposalId: null, projectId: null, sortOrder: null, archived: false, createdAt: '2026-06-10', updatedAt: null, tags: [] };
    const todo = (over: Partial<Todo>): Todo => ({ id: 1, title: 'Task', type: 'general', client: null, priority: 'Medium', dueDate: null, status: 'Pending', description: null, createdAt: '2026-01-01', completedAt: null, projectId: null, parentId: null, areaId: null, section: null, sortOrder: null, recurrenceRule: null, tags: [], meetingId: null, ...over });
    const todos = [todo({ id: 1 }), todo({ id: 2, dueDate: '2026-07-01' })];
    const qs = buildCleanupQueues(base({ opportunities: [o], todos }));
    const input = card({ opportunities: [o], todos });
    const oq = qs.find((x) => x.id === 'opportunity-incomplete')!;
    expect(cardFor(oq, oq.items[0], input)).toMatchObject({ recommend: { action: 'opportunity_details' }, panels: [{ value: '2 things', caption: 'missing: next step, close date', warn: true }, { value: 'SAR 15,000' }, { value: '113 days' }, {}] });
    const tq = qs.find((x) => x.id === 'old-tasks')!;
    expect(tq.items.map((x) => cardFor(tq, x, input).recommend?.action)).toEqual(['task_someday', 'task_date']);
  });
});

describe('the strip and progress', () => {
  const p1 = P({}), p2 = P({ id: 2, client: 'Acme Holdings', status: 'In Internal Review', reviewRequestedAt: '2026-09-08' });
  const qs = buildCleanupQueues(base({ proposals: [p1, p2], companies: [company(1), company(2)], companiesWithIndustry: new Set([1, 2]), contacts: [{ id: 1, companyId: 1 } as any, { id: 2, companyId: 2 } as any] }));
  it('to review with the minutes it takes, proposals stuck, pipeline gaps, company details', () => {
    const s = cleanupStrip(qs, 12);
    expect(s.map((x) => [x.key, x.n, x.label, x.detail])).toEqual([
      ['all', '4 to review', 'about 2 minutes of work', '12'],
      ['proposals', '2', 'proposals stuck', '539 days · Acme Holdings'],
      ['pipeline', '0', 'pipeline gaps', 'links to fix'],
      ['companies', '2', 'company details', 'owner'],
    ]);
    expect(s[1].action).toBe("cleanupQueue('stale-sent')");
    expect(s[3].action).toBe("cleanupQueue('company-owner')");
  });
  it('25 seconds each, never under a minute', () => {
    expect([minutesFor(0), minutesFor(1), minutesFor(7), minutesFor(30)]).toEqual([0, 1, 3, 13]);
  });
  it('"N of M" counts through the queues in their order', () => {
    expect(reviewPosition(qs, 'stale-sent', 0)).toEqual({ at: 1, of: 4, pct: 25 });
    expect(reviewPosition(qs, 'long-review', 0)).toMatchObject({ at: 2, of: 4 });
    expect(reviewPosition(qs, 'company-owner', 1)).toMatchObject({ at: 4, of: 4, pct: 100 });
  });
  it('cleared this month goes up and down, never below zero, and keeps a year', () => {
    expect(bumpCleared({}, '2026-10', 1)).toEqual({ '2026-10': 1 });
    expect(bumpCleared({ '2026-10': 1 }, '2026-10', -3)).toEqual({ '2026-10': 0 });
    const many = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`2025-${String(i + 1).padStart(2, '0')}`, 1]));
    expect(Object.keys(bumpCleared(many, '2026-10', 1)).length).toBe(12);
  });
});
