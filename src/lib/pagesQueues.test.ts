// @vitest-environment jsdom
// Pending and Follow-up in My Day's language (1.59 "pages"): the strip's
// buckets and sums, ages by threshold, the contact trail and the stale rule.
import { describe, expect, it } from 'vitest';

import { ageTone, moneyTotal, toggleBucket, visiblePanels, type StripPanel } from './pageKit';
import {
  closedThisMonth, contactTrail, expiresIn, followRow, followStrip, followUpDueOn, inBucket, pendingRow, pendingStrip, promiseLeft, staleMonths, TRAIL_TOUCHES,
  type FollowRow, type QueueRow,
} from './pagesQueues';
import type { Proposal } from './types';

const T = '2026-10-01';
const P = (over: Partial<Proposal>): Proposal => ({
  id: 1, client: 'Northwind Trading', companyId: 2, type: 'Payroll', status: 'Proposal Request Received', sentDate: null, dblSignedDate: null, kickoffDate: null,
  finance: null, hubspot: null, owner: 'Ahmad', remarks: null, dateAdded: '2026-09-24', monthlyFee: null, contractMonths: null, winLossReason: null, docLink: null,
  archived: false, archivedAt: null, snoozedUntil: null, dateSentToHassan: null, dateSentToClient: null, dateSigned: null, notes: [], currency: 'SAR', ...over,
});
const ctx = { today: T, reviewer: 'Hassan Balaghi' };

describe('the strip kit', () => {
  it('a panel click picks its bucket; a second click clears it', () => {
    expect(toggleBucket(null, 'draft')).toBe('draft');
    expect(toggleBucket('draft', 'draft')).toBeNull();
    expect(toggleBucket('draft', 'review')).toBe('review');
  });
  it('hides an empty panel but always keeps the total', () => {
    const panels: StripPanel[] = [
      { key: 'all', total: true, n: 'SAR 0', count: 0, label: 'x', tone: 'coral' },
      { key: 'a', n: '0', count: 0, label: 'a', tone: 'blue' },
      { key: 'b', n: '2', count: 2, label: 'b', tone: 'amber' },
    ];
    expect(visiblePanels(panels).map((p) => p.key)).toEqual(['all', 'b']);
  });
  it('filters by bucket, and "expiring" across both groups', () => {
    expect(inBucket({ bucket: 'draft' }, null)).toBe(true);
    expect(inBucket({ bucket: 'draft' }, 'review')).toBe(false);
    expect(inBucket({ bucket: 'waiting', expiring: true }, 'expiring')).toBe(true);
    expect(inBucket({ bucket: 'due', expiring: false }, 'expiring')).toBe(false);
  });
  it('ages go amber then red at their thresholds', () => {
    expect(ageTone(6, { amber: 7, red: 14 })).toBe('ok');
    expect(ageTone(7, { amber: 7, red: 14 })).toBe('amber');
    expect(ageTone(14, { amber: 7, red: 14 })).toBe('red');
    expect(ageTone(null, { amber: 7, red: 14 })).toBe('ok');
  });
  it('sums money per currency, the reporting currency first', () => {
    expect(moneyTotal([{ amount: 6500, currency: 'SAR' }, { amount: null }, { amount: 7000 }])).toBe('SAR 13,500');
    expect(moneyTotal([{ amount: 2000, currency: 'EUR' }, { amount: 1000, currency: 'SAR' }])).toBe('SAR 1,000 · EUR 2,000');
  });
});

describe('Pending rows', () => {
  it('a request with a promise a day away is red, with a red chip and a blue Start drafting', () => {
    const r = pendingRow(P({ promisedBy: '2026-10-02', monthlyFee: 6500, contractMonths: 12 }), ctx)!;
    expect(r.bucket).toBe('draft');
    expect(r.age).toBe(7);
    expect(r.tone).toBe('red');
    expect(r.urgent).toBe(true);
    expect(r.meta[1]).toMatchObject({ chip: true, tone: 'red' });
    expect(r.meta[1].text).toContain('1 day left');
    expect([r.amount, r.amountCaption]).toEqual(['SAR 6,500', 'a month · 12 mo']);
    expect(r.actions.map((a) => a.label)).toEqual(['Start drafting']);
  });
  it('where the monthly would be blank the row says how the proposal is priced', () => {
    expect(pendingRow(P({ dateAdded: '2026-09-27' }), { ...ctx, shape: 'per person per month' })).toMatchObject({ amount: null, amountCaption: 'per person per month', amountShape: true });
    expect(pendingRow(P({ dateAdded: '2026-09-27', oneTimeFee: 55000 }), { ...ctx, shape: 'one-time' })).toMatchObject({ amount: 'SAR 55,000', amountCaption: 'one-time' });
    expect(pendingRow(P({ dateAdded: '2026-09-27', monthlyFee: 6500 }), { ...ctx, shape: 'monthly' })).toMatchObject({ amount: 'SAR 6,500', amountCaption: 'a month' });
    expect(pendingRow(P({ dateAdded: '2026-09-27' }), ctx)).toMatchObject({ amount: null, amountCaption: 'not priced' });
  });
  it('a request without a promise ages by the week: 4 days is quiet, unpriced shows not priced', () => {
    const r = pendingRow(P({ dateAdded: '2026-09-27' }), ctx)!;
    expect([r.age, r.tone, r.urgent, r.amount, r.amountCaption]).toEqual([4, 'ok', false, null, 'not priced']);
    expect(r.meta.map((m) => m.text)).toEqual(['Requested 27 Sept', 'no promise']);
  });
  it('promises late and due today read as such', () => {
    expect(promiseLeft(-2)).toBe('2 days late');
    expect(promiseLeft(0)).toBe('due today');
    expect(promiseLeft(3)).toBe('3 days left');
  });
  it('drafting: revision, the deck on file, Generate V{n} and Send for review; amber at two weeks', () => {
    const r = pendingRow(P({ status: 'Drafting', dateAdded: '2026-09-10', revision: 2, revisions: [{ number: 2, requestedAt: '2026-09-24', sentAt: null } as any] }), { ...ctx, latestDeck: 1 })!;
    expect(r.age).toBe(21);
    expect(r.tone).toBe('amber');
    expect(r.meta.map((m) => m.text)).toEqual(['Revision 2', 'client asked for changes on 24 Sept', 'deck V1 in folder']);
    expect(r.actions.map((a) => a.label)).toEqual(['Generate V2', 'Send for review']);
  });
  it('in review: days since it went to the reviewer, red at two weeks, Nudge and Record review', () => {
    const r = pendingRow(P({ status: 'In Internal Review', dateSentToHassan: '2026-09-08', remarks: 'Five engineers' }), ctx)!;
    expect([r.bucket, r.age, r.tone, r.ageCaption]).toEqual(['review', 23, 'red', 'in review']);
    expect(r.meta.map((m) => m.text)).toEqual(['Five engineers', 'sent to Hassan 8 Sept']);
    expect(r.actions.map((a) => a.kind)).toEqual(['nudge', 'record']);
    const ok = pendingRow(P({ status: 'In Internal Review', dateSentToHassan: '2026-09-08', reviewStatus: 'approved' }), ctx)!;
    expect(ok.actions.map((a) => a.label)).toEqual(['Mark sent']);
    expect(ok.urgent).toBe(true);
  });
  it('the strip: the month waiting, then each group with its oldest', () => {
    const ps = [
      P({ id: 5, promisedBy: '2026-10-02', monthlyFee: 6500 }),
      P({ id: 6, dateAdded: '2026-09-27' }),
      P({ id: 7, status: 'Drafting', dateAdded: '2026-09-10', revision: 2, monthlyFee: 4000 }),
      P({ id: 2, status: 'In Internal Review', dateSentToHassan: '2026-09-08', monthlyFee: 7000 }),
    ];
    const rows = ps.map((p) => pendingRow(p, ctx)!) as QueueRow[];
    const s = pendingStrip(rows, ps, ctx);
    expect(s.map((p) => [p.key, p.n, p.detail])).toEqual([
      ['all', 'SAR 17,500', '4 proposals'],
      ['draft', '2', '7 days · 1 promised Fri'],
      ['drafting', '1', '21 days · revision 2'],
      ['review', '1', '23 days in review'],
    ]);
    expect(s[3].label).toBe('with Hassan');
  });
});

describe('Follow-up rows', () => {
  const sent = (over: Partial<Proposal> = {}) => P({ id: 3, status: 'Sent to Client', dateSentToClient: '2026-09-02', sentDate: '2026-09-02', monthlyFee: 5000, contractMonths: 12, ...over });
  const touch = (date: string) => ({ date, kind: 'email_out' as const, days: Math.round((Date.parse(T) - Date.parse(date)) / 864e5) });

  it('due after ten days without contact: amber, Client asked for changes and a blue Followed up, the silence dashed', () => {
    const touches = [{ proposalId: 3, companyId: null, kind: 'email_out' as const, direction: 'out' as const, at: '2026-09-15', contactId: null }];
    const r = followRow(sent({ validUntil: '2026-10-02' }), { today: T, touch: touch('2026-09-15'), followUps: 1, touches })!;
    expect([r.bucket, r.age, r.tone, r.ageCaption, r.urgent, r.expiring]).toEqual(['due', 16, 'amber', 'without contact', true, true]);
    expect(r.actions.map((a) => a.label)).toEqual(['Client asked for changes', 'Followed up']);
    expect(r.trail.late).not.toBeNull();
    expect(r.trail.points.map((p) => p.kind)).toEqual(['sent', 'touch', 'today', 'expiry']);
  });
  it('not yet due: when it will be (the day after the tenth day)', () => {
    const r = followRow(sent({ dateSentToClient: '2026-09-26', sentDate: '2026-09-26', validUntil: '2026-10-05' }), { today: T, touch: { date: '2026-09-26', kind: 'sent', days: 5 }, followUps: 0, touches: [] })!;
    expect([r.bucket, r.ageCaption, r.dueOn, r.trail.late]).toEqual(['waiting', 'since sent', '2026-10-07', null]);
    expect(followUpDueOn('2026-09-26')).toBe('2026-10-07');
  });
  it('an offer expiring within a week is flagged; a lapsed one is not', () => {
    expect(expiresIn('2026-10-05', T)).toBe(4);
    expect(expiresIn('2026-09-30', T)).toBeNull();
    expect(expiresIn(null, T)).toBeNull();
  });
  it('stale: four follow-ups and ninety days without the client answering → "mark lost?"', () => {
    expect(staleMonths({ sent: '2025-04-10', followUps: 4, lastFromClient: null }, T)).toBe(17);
    expect(staleMonths({ sent: '2025-04-10', followUps: 3, lastFromClient: null }, T)).toBeNull();
    expect(staleMonths({ sent: '2026-08-01', followUps: 6, lastFromClient: null }, T)).toBeNull();
    expect(staleMonths({ sent: '2025-04-10', followUps: 5, lastFromClient: '2026-09-20' }, T)).toBeNull();
    const touches = ['2025-05-02', '2025-06-20', '2025-08-03', '2026-09-28'].map((at) => ({ proposalId: 3, companyId: null, kind: 'email_out' as const, direction: 'out' as const, at, contactId: null }));
    const r = followRow(sent({ dateSentToClient: '2025-04-10', sentDate: '2025-04-10' }), { today: T, touch: touch('2026-09-28'), followUps: 4, touches })!;
    expect(r.meta.some((m) => /no answer in 17 months — mark lost\?/.test(m.text))).toBe(true);
    expect(r.actions.map((a) => a.kind)).toEqual(['mark_lost', 'followed_up']);
  });
  it('the strip: money with clients, due, expiring soonest, next due', () => {
    const a = sent({ validUntil: '2026-10-02' });
    const b = sent({ id: 8, client: 'Red Sea Global', dateSentToClient: '2026-09-26', sentDate: '2026-09-26', validUntil: '2026-10-05', monthlyFee: 12000 });
    const rows = [
      followRow(a, { today: T, touch: touch('2026-09-15'), followUps: 1, touches: [] })!,
      followRow(b, { today: T, touch: { date: '2026-09-26', kind: 'sent', days: 5 }, followUps: 0, touches: [] })!,
    ] as FollowRow[];
    expect(followStrip(rows, [a, b]).map((p) => [p.key, p.n, p.detail])).toEqual([
      ['all', 'SAR 17,000', '2 proposals'],
      ['due', '1', '16 days without contact'],
      ['expiring', '2', 'Fri 2 Oct · Northwind Trading'],
      ['waiting', '1', 'follow-up due Wed 7 Oct'],
    ]);
  });
});

describe('the contact trail', () => {
  it('places sent, touches, today and the expiry by date', () => {
    const t = contactTrail({ sent: '2026-09-01', touches: [{ at: '2026-09-11', kind: 'call' }], today: '2026-09-21', validUntil: '2026-10-11', late: '2026-09-11' });
    expect(t.points.map((p) => [p.kind, p.pos])).toEqual([['sent', 0], ['touch', 25], ['today', 50], ['expiry', 100]]);
    expect(t.points[1].label).toBe('11 Sept ☎');
    expect(t.late).toEqual({ from: 25, to: 50 });
  });
  it('keeps the last five touches of a long history', () => {
    const touches = Array.from({ length: 8 }, (_, n) => ({ at: `2026-0${n + 1}-15`, kind: 'email_out' }));
    const t = contactTrail({ sent: '2026-01-01', touches, today: '2026-10-01', validUntil: null, late: null });
    const kept = t.points.filter((p) => p.kind === 'touch');
    expect(kept.length).toBe(TRAIL_TOUCHES);
    expect(kept[0].date).toBe('2026-04-15');
  });
  it('today keeps clear of an expiry a day away; a touch crowding a label gives way', () => {
    const t = contactTrail({ sent: '2026-09-02', touches: [{ at: '2026-09-30', kind: 'email_out' }, { at: '2026-09-03', kind: 'call' }], today: T, validUntil: '2026-10-02', late: null });
    const today = t.points.find((p) => p.kind === 'today')!;
    expect(100 - today.pos).toBeGreaterThanOrEqual(9);
    // 30 Sept sits under today's dot: dropped. 3 Sept crowds "sent": dot kept, label hidden.
    expect(t.points.filter((p) => p.kind === 'touch').map((p) => [p.date, p.showLabel])).toEqual([['2026-09-03', false]]);
  });
});

describe('this month', () => {
  it('won from the signing date, lost from the [LOST] note', () => {
    const won = P({ id: 1, status: 'Signed by Both Parties', dblSignedDate: '2026-10-01' });
    const oldWon = P({ id: 2, status: 'Signed by Both Parties', dblSignedDate: '2026-01-20' });
    const lost = P({ id: 3, status: 'Lost', notes: [{ id: 1, date: '2026-10-01', text: '[LOST: price] went local' }] });
    const r = closedThisMonth([won, oldWon, lost], T);
    expect([r.won.map((p) => p.id), r.lost.map((p) => p.id)]).toEqual([[1], [3]]);
  });
});
