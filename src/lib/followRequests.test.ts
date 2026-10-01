// @vitest-environment jsdom
// Follow-up by client and request (1.65): what a request is, how its log
// counts, where it sits (Decide · Due · Waiting) and what its row says.
import { describe, it, expect } from 'vitest';
import { CHANNELS, DECIDE_DAYS, channelOf, entryLine, kindOf, buildRequest, buildRequests, entriesOf, nextAction, orderRequests, requestKey, requestStrip, requestValue, sentWith, statusList, type EntryTouch, type RequestContext } from './followRequests';
import type { Proposal } from './types';

const T = '2026-10-01';
const proposal = (over: Partial<Proposal>): Proposal => ({
  id: 1, client: 'Acme Holdings', companyId: 1, type: 'Payroll', status: 'Sent to Client', sentDate: null, dblSignedDate: null, kickoffDate: null, finance: null, hubspot: null,
  owner: null, remarks: null, dateAdded: null, monthlyFee: null, contractMonths: null, winLossReason: null, docLink: null, archived: false,
  archivedAt: null, snoozedUntil: null, dateSentToHassan: null, dateSentToClient: '2026-09-15', dateSigned: null, notes: [], ...over,
} as Proposal);
let nextId = 1;
const touch = (over: Partial<EntryTouch>): EntryTouch => ({ id: nextId++, proposalId: 1, companyId: 1, kind: 'email_out', direction: 'out', at: '2026-09-20', contactId: null, ...over });
const ctx = (over: Partial<RequestContext> = {}): RequestContext => ({ today: T, emails: [], meetings: [], touches: [], ownDomains: new Set(['menabig.com']), memberName: (id) => ({ 1: 'Ahmad', 2: 'Hassan' } as Record<number, string>)[id] ?? null, hasContact: () => true, ...over });

describe('what a request is', () => {
  it('the proposals requested together; without a group, the same client on the same day', () => {
    const a = proposal({ id: 1, requestGroup: 'g1' }), b = proposal({ id: 2, requestGroup: 'g1', dateSentToClient: '2026-09-18' });
    const c = proposal({ id: 3 }), d = proposal({ id: 4 }), e = proposal({ id: 5, dateSentToClient: '2026-09-16' }), f = proposal({ id: 6, companyId: 2, client: 'Globex' });
    expect(requestKey(a)).toBe(requestKey(b));
    expect(requestKey(c)).toBe(requestKey(d));
    expect(new Set([a, c, e, f].map(requestKey)).size).toBe(4);
    const all = [a, b, c, d, e, f, proposal({ id: 7, status: 'Drafting' }), proposal({ id: 8, archived: true })];
    expect(sentWith(c, all).map((p) => p.id)).toEqual([4]);
    expect(sentWith(a, all).map((p) => p.id)).toEqual([2]);
    expect(sentWith(e, all)).toEqual([]);
    // No company on file: the client's name stands in.
    expect(requestKey(proposal({ companyId: null, client: ' Initech ' }))).toBe(requestKey(proposal({ id: 9, companyId: null, client: 'initech' })));
  });

  it('one row per request, oldest first, a client\'s requests together', () => {
    const rows = buildRequests([
      proposal({ id: 1, client: 'Globex', companyId: 2, dateSentToClient: '2026-09-10' }),
      proposal({ id: 2, dateSentToClient: '2026-08-01', type: 'PRO' }), proposal({ id: 3, dateSentToClient: '2026-08-01', type: 'Payroll' }),
      proposal({ id: 4, dateSentToClient: '2026-09-25', type: 'EOR' }),
      proposal({ id: 5, status: 'Drafting' }), proposal({ id: 6, archived: true }),
    ], ctx());
    expect(rows.map((r) => [r.client, r.ids, r.services, r.sent])).toEqual([
      ['Acme Holdings', [2, 3], ['PRO', 'Payroll'], '2026-08-01'],
      ['Acme Holdings', [4], ['EOR'], '2026-09-25'],
      ['Globex', [1], ['Payroll'], '2026-09-10'],
    ]);
    expect(orderRequests([{ client: 'B', companyId: 2, sent: '2026-01-01', key: 'b' }, { client: 'A', companyId: 1, sent: '2026-01-01', key: 'a' }]).map((r) => r.client)).toEqual(['A', 'B']);
  });

  it('is worth its monthly fees together; with none, the one-time fees; else how it is priced', () => {
    const fee = (monthlyFee: number | null, over: Partial<Proposal> = {}) => proposal({ monthlyFee, currency: 'SAR', contractMonths: 12, ...over });
    expect(requestValue([fee(1500), fee(5000)])).toEqual({ amount: 'SAR 6,500', caption: 'a month · 12 mo', shape: false });
    expect(requestValue([fee(1500), fee(2000, { currency: 'AED', contractMonths: 6 })])).toEqual({ amount: 'SAR 1,500 · AED 2,000', caption: 'a month', shape: false });
    expect(requestValue([fee(null, { oneTimeFee: 9000 })])).toEqual({ amount: 'SAR 9,000', caption: 'one-time', shape: false });
    expect(requestValue([fee(null)], () => 'per person per month')).toEqual({ amount: null, caption: 'per person per month', shape: true });
    expect(requestValue([fee(null)])).toEqual({ amount: null, caption: 'not priced', shape: false });
    // One with a monthly fee and one priced per person: the total says it leaves one out.
    expect(requestValue([fee(1500), fee(null)], () => 'per person per month')).toEqual({ amount: 'SAR 1,500', caption: 'a month · + 1 more', shape: false });
  });
});

describe('the log of a request', () => {
  it('an entry written on several proposals counts once: by its batch, else by day, channel and direction', () => {
    const members = [{ id: 1, companyId: 1 }, { id: 2, companyId: 1 }];
    const entries = entriesOf(members, [
      touch({ id: 1, proposalId: 1, batchId: 'b1', at: '2026-09-20', byMemberId: 2, note: 'Chased by WhatsApp', kind: 'whatsapp' }),
      touch({ id: 2, proposalId: 2, batchId: 'b1', at: '2026-09-20', byMemberId: 2, note: 'Chased by WhatsApp', kind: 'whatsapp' }),
      touch({ id: 3, proposalId: 1, at: '2026-09-25' }), touch({ id: 4, proposalId: 2, at: '2026-09-25' }),
      touch({ id: 5, proposalId: 2, at: '2026-09-25', kind: 'call' }),
      touch({ id: 6, proposalId: null, at: '2026-09-27', kind: 'email_in', direction: 'in' }),
      touch({ id: 7, proposalId: 9, companyId: 1, at: '2026-09-28' }),
    ]);
    expect(entries.map((e) => [e.date, e.kind, e.ids])).toEqual([
      ['2026-09-20', 'whatsapp', [1, 2]], ['2026-09-25', 'email_out', [3, 4]], ['2026-09-25', 'call', [5]], ['2026-09-27', 'email_in', [6]],
    ]);
    expect([entries[0].byMemberId, entries[0].note, entries[0].batchId]).toEqual([2, 'Chased by WhatsApp', 'b1']);
  });

  it('counts our follow-ups, never the client\'s replies or a meeting; says who followed up last and how', () => {
    const r = buildRequest([proposal({ id: 1 }), proposal({ id: 2, type: 'PRO' })], ctx({ touches: [
      touch({ proposalId: 1, at: '2026-09-18', batchId: 'x' }), touch({ proposalId: 2, at: '2026-09-18', batchId: 'x' }),
      touch({ proposalId: 1, at: '2026-09-20', kind: 'email_in', direction: 'in', note: 'Reviewing with finance' }),
      touch({ proposalId: 1, at: '2026-09-22', kind: 'meeting' }),
      touch({ proposalId: 2, at: '2026-09-24', kind: 'whatsapp', byMemberId: 2 }),
    ] }));
    expect([r.followUps, r.unanswered]).toEqual([2, 1]);
    expect(r.lastBy).toEqual({ who: 'Hassan', how: 'WhatsApp', date: '2026-09-24' });
    expect(r.lastWord).toEqual({ date: '2026-09-20', text: 'Reviewing with finance', revertAfter: null });
    expect(r.meta.map((m) => m.text)).toEqual(['Sent 15 Sept', '2 follow-ups', 'last by Hassan, WhatsApp 24 Sept']);
    expect(r.word.map((m) => m.text)).toEqual(['“Reviewing with finance” · 20 Sept']);
  });

  it('never replied says so; a request with no contact person says that in amber', () => {
    const r = buildRequest([proposal({})], ctx({ hasContact: () => false }));
    expect(r.lastWord).toBeNull();
    expect(r.word).toEqual([{ text: 'Never replied' }, { text: 'no contact person', tone: 'amber' }]);
    expect(buildRequest([proposal({}), proposal({ id: 2 })], ctx({ hasContact: (p) => p.id === 2 })).noContact).toBe(false);
  });
});

describe('where a request sits', () => {
  const one = (over: Partial<Proposal>, c: Partial<RequestContext> = {}) => buildRequest([proposal(over)], ctx(c));

  it('due a follow-up after ten days without contact; not before', () => {
    expect([one({ dateSentToClient: '2026-09-20' }).bucket, one({ dateSentToClient: '2026-09-21' }).bucket]).toEqual(['due', 'waiting']);
    const due = one({ dateSentToClient: '2026-09-15' });
    expect([due.age, due.ageCaption, due.tone, due.urgent, due.actions.map((a) => a.kind)]).toEqual([16, 'without contact', 'amber', true, ['changes', 'followed_up']]);
    const waiting = one({ dateSentToClient: '2026-09-26' });
    expect([waiting.ageCaption, waiting.dueOn, waiting.actions.map((a) => a.kind)]).toEqual(['since sent', '2026-10-07', ['followed_up']]);
    // A follow-up of ours restarts the ten days.
    expect(one({ dateSentToClient: '2026-09-01' }, { touches: [touch({ at: '2026-09-25' })] }).bucket).toBe('waiting');
  });

  it('the client\'s reply stops the clock: not due, however long since, until we follow up again', () => {
    const replied = one({ dateSentToClient: '2026-08-20' }, { touches: [touch({ at: '2026-09-01' }), touch({ at: '2026-09-05', kind: 'email_in', direction: 'in', note: 'Will discuss internally' })] });
    expect([replied.bucket, replied.hold?.kind, replied.followUps, replied.unanswered, replied.urgent]).toEqual(['waiting', 'replied', 1, 0, false]);
    expect(nextAction(replied)).toBe('answer the client');
    // We follow up again: the ten days run from that follow-up.
    const again = one({ dateSentToClient: '2026-08-20' }, { touches: [touch({ at: '2026-09-05', kind: 'email_in', direction: 'in' }), touch({ at: '2026-09-10' })] });
    expect([again.bucket, again.hold, again.unanswered, again.age]).toEqual(['due', null, 1, 21]);
    // A client's email that Outlook synced counts as their word too.
    const synced = one({ dateSentToClient: '2026-09-01' }, { emails: [{ companyId: 1, senderEmail: 'jane@acme.test', receivedAt: '2026-09-12T08:00:00Z' }] });
    expect([synced.bucket, synced.hold?.kind, synced.lastWord?.text]).toEqual(['waiting', 'replied', 'Replied by email']);
  });

  it('to decide: 60 days since their last word, or since sending when they never replied', () => {
    expect(DECIDE_DAYS).toBe(60);
    const never = one({ dateSentToClient: '2026-08-02' }, { touches: [touch({ at: '2026-08-20' }), touch({ at: '2026-09-10' })] });
    expect([never.bucket, never.age, never.ageCaption, never.tone, never.unanswered, never.actions.map((a) => a.kind)]).toEqual(['decide', 60, 'since it was sent', 'red', 2, ['decide_snooze', 'decide_keep', 'decide_lost']]);
    expect(one({ dateSentToClient: '2026-08-03' }, { touches: [touch({ at: '2026-08-20' }), touch({ at: '2026-09-10' })] }).bucket).toBe('due');
    // They replied 60 days ago and nothing since: to decide, counted from their word.
    const word = one({ dateSentToClient: '2026-06-01' }, { touches: [touch({ at: '2026-08-02', kind: 'call', direction: 'in', note: 'Budget frozen' })] });
    expect([word.bucket, word.age, word.ageCaption]).toEqual(['decide', 60, 'since their reply']);
    // A reply within 60 days keeps it out, however old the proposal.
    expect(one({ dateSentToClient: '2026-03-01' }, { touches: [touch({ at: '2026-09-01', kind: 'call', direction: 'in' })] }).bucket).toBe('waiting');
  });

  it('kept with a reason: out of Decide until its date, then back', () => {
    const touches = [touch({ at: '2026-07-10' }), touch({ at: '2026-07-20' })];
    const kept = one({ dateSentToClient: '2026-07-01', keepReason: 'Budget in January', keepUntil: '2026-10-20' }, { touches });
    expect([kept.bucket, kept.hold]).toEqual(['waiting', { kind: 'kept', until: '2026-10-20', text: 'kept: Budget in January · until 20 Oct' }]);
    expect(nextAction(kept)).toBe('look again 20 Oct');
    expect(one({ dateSentToClient: '2026-07-01', keepReason: 'Budget in January', keepUntil: '2026-09-30' }, { touches }).bucket).toBe('decide');
  });

  it('not due while they said they would come back, or a meeting with them is booked', () => {
    const revert = one({ dateSentToClient: '2026-09-01' }, { touches: [touch({ at: '2026-09-05', kind: 'whatsapp', direction: 'in', note: 'After the board meeting', revertAfter: '2026-10-15' }), touch({ at: '2026-09-08' })] });
    expect([revert.bucket, revert.hold, revert.dueOn]).toEqual(['waiting', { kind: 'revert', until: '2026-10-15', text: 'will revert after 15 Oct' }, '2026-10-15']);
    expect(revert.word.map((m) => m.text)).toEqual(['“After the board meeting” · 5 Sept', 'will revert after 15 Oct']);
    // Once the day has passed it is due again.
    const passed = one({ dateSentToClient: '2026-09-01' }, { touches: [touch({ at: '2026-09-05', kind: 'whatsapp', direction: 'in', revertAfter: '2026-09-30' }), touch({ at: '2026-09-08' })] });
    expect([passed.bucket, passed.hold]).toEqual(['due', null]);
    const meeting = one({ dateSentToClient: '2026-09-01' }, { meetings: [{ companyId: 1, meetingDate: '2026-10-06', isCancelled: false }, { companyId: 1, meetingDate: '2026-10-03', isCancelled: true }, { companyId: 2, meetingDate: '2026-10-02', isCancelled: false }] });
    expect([meeting.bucket, meeting.hold]).toEqual(['waiting', { kind: 'meeting', until: '2026-10-06', text: 'meeting booked 6 Oct' }]);
    // A booked meeting also holds a request out of Decide.
    expect(one({ dateSentToClient: '2026-06-01' }, { meetings: [{ companyId: 1, meetingDate: '2026-10-06', isCancelled: false }] }).bucket).toBe('waiting');
  });

  it('an offer about to expire is flagged', () => {
    const r = one({ dateSentToClient: '2026-09-26', validUntil: '2026-10-05' });
    expect([r.expiring, r.validUntil, r.meta[1]]).toEqual([true, '2026-10-05', { text: '◷ offer expires Mon 5 Oct', tone: 'red', chip: true }]);
    expect(one({ dateSentToClient: '2026-09-26', validUntil: '2026-11-05' }).expiring).toBe(false);
  });
});

describe('the strip and the status list', () => {
  const rows = () => buildRequests([
    proposal({ id: 1, dateSentToClient: '2026-06-01', monthlyFee: 4000, currency: 'SAR' }),
    proposal({ id: 2, client: 'Globex', companyId: 2, dateSentToClient: '2026-09-15', monthlyFee: 1500, currency: 'SAR', type: 'Company maintenance' }),
    proposal({ id: 3, client: 'Globex', companyId: 2, dateSentToClient: '2026-09-15', monthlyFee: 5000, currency: 'SAR', type: 'Workforce' }),
    proposal({ id: 4, client: 'Northwind', companyId: 3, dateSentToClient: '2026-09-26', monthlyFee: 12000, currency: 'SAR', type: 'EOR', validUntil: '2026-10-05' }),
  ], ctx());

  it('money with clients across requests and proposals, then to decide, due, expiring, not yet due', () => {
    const all = [1, 2, 3, 4].map((id) => proposal({ id, monthlyFee: [0, 4000, 1500, 5000, 12000][id], currency: 'SAR' }));
    expect(requestStrip(rows(), all).map((p) => [p.key, p.n, p.label, p.detail])).toEqual([
      ['all', 'SAR 22,500', 'a month with clients', '3 requests · 4 proposals'],
      ['decide', '1', 'to decide', '122 days with no word'],
      ['due', '1', 'due a follow-up', '16 days without contact'],
      ['expiring', '1', 'offer expiring', 'Mon 5 Oct · Northwind'],
      ['waiting', '1', 'not yet due', 'follow-up due Wed 7 Oct'],
    ]);
  });

  it('the status list: one line per request, oldest first, with no amounts', () => {
    const text = statusList(rows(), T);
    expect(text.split('\n')).toEqual([
      'Acme Holdings — Payroll — sent 1 Jun (122 days) — to decide — next: close it or keep it',
      'Globex — Company maintenance, Workforce — sent 15 Sept (16 days) — follow-up due — next: follow up',
      'Northwind — EOR — sent 26 Sept (5 days) — waiting on the client — next: follow up from 7 Oct',
    ]);
    expect(text).not.toMatch(/SAR|\d{1,3},\d{3}/);
  });
});

describe('one entry, in words', () => {
  const names = { memberName: (id: number) => ({ 1: 'Ahmad', 2: 'Hassan' } as Record<number, string>)[id] ?? null, me: 1 };
  it('says who followed up when it was someone else, what was said, and when they will revert', () => {
    expect(entryLine({ direction: 'out', byMemberId: null, note: null, revertAfter: null }, 'you called Sara', names)).toBe('you called Sara');
    expect(entryLine({ direction: 'out', byMemberId: 1, note: null, revertAfter: null }, 'you called Sara', names)).toBe('you called Sara');
    expect(entryLine({ direction: 'out', byMemberId: 2, note: 'Left a message', revertAfter: null }, 'you called Sara', names)).toBe('Hassan called Sara · “Left a message”');
    expect(entryLine({ direction: 'out', byMemberId: 2, note: null, revertAfter: null }, 'WhatsApp to Sara', names)).toBe('Hassan sent a WhatsApp to Sara');
    expect(entryLine({ direction: 'in', byMemberId: 2, note: 'After the board meeting', revertAfter: '2026-10-15' }, 'Sara replied', names)).toBe('Sara replied · “After the board meeting” · will revert after 15 Oct');
  });
  it('a channel and a direction make the kind; a reply is never a meeting', () => {
    expect([kindOf('email', 'out'), kindOf('email', 'in'), kindOf('call', 'in'), kindOf('whatsapp', 'out'), kindOf('meeting', 'out')]).toEqual(['email_out', 'email_in', 'call', 'whatsapp', 'meeting']);
    expect(CHANNELS.in.map(([c]) => c)).toEqual(['email', 'whatsapp', 'call']);
    expect(CHANNELS.out.map(([c]) => c)).toEqual(['email', 'whatsapp', 'call', 'meeting']);
    expect(['email_in', 'email_out', 'call', 'whatsapp', 'meeting'].map((k) => channelOf(k as never))).toEqual(['email', 'email', 'call', 'whatsapp', 'meeting']);
  });
});
