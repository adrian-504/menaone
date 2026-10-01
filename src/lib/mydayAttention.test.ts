// Needs your attention, 1.64 (owner, 1-Oct-2026): what only you can move
// today, in a fixed order, never a client listed for a lack of contact.
import { describe, it, expect } from 'vitest';
import { AFTER_SIGNED_DAYS, NO_AGREEMENT_WITHIN_DAYS, TIER, buildAttention, buildTimeline, inRail, shownAttentionKeys, type MyDayInput } from './myday';
import { buildInPlay } from './mydayFocus';
import type { Agreement, Commitment, Meeting, Opportunity, Proposal, Todo } from './types';

const TODAY = '2026-10-01';
const proposal = (over: Partial<Proposal>): Proposal => ({
  id: 1, client: 'Co', type: 'Payroll', status: 'Sent to Client', sentDate: null, dblSignedDate: null, kickoffDate: null, finance: null, hubspot: null,
  owner: null, remarks: null, dateAdded: null, monthlyFee: null, contractMonths: null, winLossReason: null, docLink: null, archived: false,
  archivedAt: null, snoozedUntil: null, dateSentToHassan: null, dateSentToClient: null, dateSigned: null, notes: [], ...over,
});
const opp = (over: Partial<Opportunity>): Opportunity => ({
  id: 1, name: 'Deal', companyId: 1, companyName: 'Co', owner: null, stage: 'Lead', status: 'Open', estimatedValue: null, currency: 'SAR',
  probability: null, expectedCloseDate: null, description: null, nextAction: null, proposalId: null, projectId: null, sortOrder: null,
  archived: false, createdAt: '2026-09-28', updatedAt: '2026-09-28', tags: [], ...over,
});
const meeting = (over: Partial<Meeting>): Meeting => ({
  id: 1, title: 'Meeting', meetingDate: TODAY, companyName: null, projectId: null, opportunityId: null, attendees: [], agenda: null,
  discussion: null, decisions: null, actionItems: null, followUp: null, nextMeeting: null, noteId: null, createdAt: null, updatedAt: null,
  outlookEventId: null, startAt: null, endAt: null, organizer: null, location: null, isOnlineMeeting: false, onlineMeetingUrl: null,
  isCancelled: false, source: 'internal', ...over,
});
const todo = (over: Partial<Todo>): Todo => ({
  id: 1, title: 'Task', type: 'general', client: null, priority: 'Medium', dueDate: null, status: 'Pending', description: null, createdAt: null,
  completedAt: null, projectId: null, parentId: null, areaId: null, section: null, sortOrder: null, recurrenceRule: null, tags: [], meetingId: null, ...over,
});
const agreement = (over: Partial<Agreement>): Agreement => ({
  id: 1, agrRef: 'AGR-1', client: 'Co', type: null, status: 'Signed', preparedBy: null, datePrepared: null, dateSentToClient: null, dateClientSigned: null,
  dateMenaSigned: null, dateFiled: null, monthlyFee: null, contractMonths: null, proposalId: null, hubspot: null, docLink: null, actionDate: null,
  remarks: null, createdAt: null, ...over,
});
const commitment = (over: Partial<Commitment>): Commitment => ({
  id: 1, direction: 'ours', text: 'Send the revised quote', contactId: null, dueDate: '2026-09-28', status: 'open', closedAt: null, dropReason: null,
  companyId: null, opportunityId: null, projectId: null, sourceType: null, sourceId: null, sourceKey: null, todoId: null, createdAt: null, updatedAt: null, ...over,
} as Commitment);
const input = (over: Partial<MyDayInput>): MyDayInput => ({
  today: TODAY, now: new Date(`${TODAY}T11:00:00`), proposals: [], opportunities: [], pipelineFacts: [], agreements: [], meetings: [],
  todos: [], projects: [], emails: [], inboxCount: 0, reviewerName: () => 'Hassan', ownDomains: new Set(['menabig.com']), snoozed: {},
  railOwnsProposals: true, ...over,
});
const ctx = (i: MyDayInput) => ({ emails: i.emails, meetings: i.meetings, today: i.today, ownDomains: i.ownDomains, touches: i.touches });
const keys = (i: MyDayInput) => buildAttention(i).map((x) => x.key);
const clientMeeting = (over: Partial<Meeting>) => meeting({ companyName: 'Acme', attendees: ['omar@acme.test'], attendeeEmails: ['omar@acme.test'], ...over } as Partial<Meeting>);

describe('needs your attention: never a lack of contact', () => {
  it('an active client with no contact on record, or none for months, is not listed', () => {
    const i = input({
      companies: [{ id: 1, name: 'No Contact Co' }, { id: 2, name: 'Long Quiet Co' }],
      agreements: [agreement({ id: 1, companyId: 1, client: 'No Contact Co', serviceStatus: 'Active' }), agreement({ id: 2, companyId: 2, client: 'Long Quiet Co', serviceStatus: 'Active' })],
      // The only contact with the second client: a written-up meeting 74 days ago.
      meetings: [clientMeeting({ id: 9, companyId: 2, companyName: 'Long Quiet Co', meetingDate: '2026-07-19', discussion: 'Notes' })],
    });
    expect(buildAttention(i)).toEqual([]);
  });

  it('there is no quiet row and no folded "gone quiet" row either, whatever else is listed', () => {
    const items = buildAttention(input({
      companies: [{ id: 1, name: 'Co' }], agreements: [agreement({ companyId: 1, serviceStatus: 'Active' })], inboxCount: 2,
    }));
    expect(items.map((x) => x.key)).toEqual(['inbox']);
    expect(items.some((x) => /quiet/i.test(`${x.key} ${x.kind} ${x.title} ${x.reason}`))).toBe(false);
  });
});

describe('needs your attention: the order', () => {
  // One of each, deliberately given out of order.
  const everything = (): MyDayInput => input({
    inboxCount: 3,
    opportunities: [opp({ id: 1, name: 'At risk', expectedCloseDate: '2026-09-01', nextAction: 'Call' }), opp({ id: 2, name: 'With me', nextAction: 'Reply', waitingOn: 'us', waitingSince: '2026-09-15' })],
    meetings: [clientMeeting({ id: 1, title: 'No agenda', startAt: `${TODAY}T15:00:00` }), clientMeeting({ id: 2, title: 'To write up', meetingDate: '2026-09-30', startAt: '2026-09-30T10:00:00', endAt: '2026-09-30T10:30:00' })],
    agreements: [
      agreement({ id: 1, client: 'Past term', serviceStatus: 'Active', endDate: '2026-08-31' }),
      agreement({ id: 2, client: 'Decide soon', serviceStatus: 'Active', endDate: '2026-12-31', noticeDays: 90 }),
      agreement({ id: 3, client: 'Linked', serviceStatus: 'Active', proposalId: 14 }),
    ],
    proposals: [
      proposal({ id: 11, client: 'Not started', status: 'Signed by Both Parties', dblSignedDate: '2026-09-10' }),
      proposal({ id: 12, client: 'No agreement', status: 'Signed by Both Parties', dblSignedDate: '2026-09-10', serviceStartedAt: '2026-09-12' }),
      proposal({ id: 13, client: 'Countersign', status: 'Signed by Client', dateSigned: '2026-09-29' }),
      proposal({ id: 14, client: 'All done', status: 'Signed by Both Parties', dblSignedDate: '2026-09-10', serviceStartedAt: '2026-09-12' }),
      proposal({ id: 15, client: 'Approved', status: 'In Internal Review', reviewStatus: 'approved' }),
      proposal({ id: 16, client: 'Changes', status: 'In Internal Review', reviewStatus: 'changes_requested' }),
      proposal({ id: 17, client: 'Promised', status: 'Drafting', dateAdded: '2026-09-20', promisedBy: '2026-09-29' }),
    ],
    commitments: [
      commitment({ id: 1, direction: 'theirs', dueDate: '2026-09-20', text: 'Their headcount' }),
      commitment({ id: 2, dueDate: '2026-10-02', sourceKey: 'b', text: 'Due tomorrow' }),
      commitment({ id: 3, dueDate: '2026-09-28', sourceKey: 'c', text: 'Late' }),
      commitment({ id: 4, dueDate: TODAY, sourceKey: 'd', text: 'Due today' }),
    ],
    railShown: new Set<number>(),
  });

  it('runs in the owner\'s order, tier by tier', () => {
    expect(keys(everything())).toEqual([
      // 1. his own promises: late first (the longest late first), then today, then tomorrow
      'commitment:3:overdue', 'proposal:17:promise', 'commitment:4:due', 'commitment:2:due',
      // 2. a review outcome waiting on him
      'proposal:16:changes', 'proposal:15:approved',
      // 3. signed by the client, waiting for MENA's signature
      'proposal:13:countersign',
      // 4. a promise owed to him that is late (always one row)
      'group:owed',
      // 5. signed by both, service not started; then no agreement yet
      'proposal:11:not-started', 'proposal:12:no-agreement',
      // 6. past term and still active; decide-by within 30 days
      'agreement:1:renewal', 'agreement:2:renewal',
      // 7. a meeting with no agenda; a meeting to write up
      'meeting:1:prepare', 'meeting:2:writeup',
      // 8. an opportunity at risk; one with him for more than a week
      'opportunity:1:risk', 'opportunity:2:with-us',
      // 9. the Inbox count, last
      'inbox',
    ]);
  });

  it('every row sits inside its tier: a lower tier never outranks a higher one', () => {
    const tiers = Object.values(TIER).sort((a, b) => b - a);
    const tierOf = (score: number) => tiers.find((t) => score >= t)!;
    const got = buildAttention(everything()).map((x) => tierOf(x.score));
    expect(got).toEqual([...got].sort((a, b) => b - a));
    expect(new Set(got)).toEqual(new Set([TIER.ownPromise, TIER.reviewOutcome, TIER.countersign, TIER.owedLate, TIER.afterSigned, TIER.agreement, TIER.meeting, TIER.opportunity, TIER.inbox]));
    // The database check sits above everything.
    expect(buildAttention({ ...everything(), integrityFailed: true })[0].key).toBe('db:integrity');
  });

  it('signed by both: raised after a week, for a service not started or an agreement not made', () => {
    const signed = (dbl: string, over: Partial<Proposal> = {}) => keys(input({ proposals: [proposal({ id: 1, status: 'Signed by Both Parties', dblSignedDate: dbl, ...over })] }));
    expect(AFTER_SIGNED_DAYS).toBe(7);
    expect(signed('2026-09-26')).toEqual([]);
    expect(signed('2026-09-24')).toEqual(['proposal:1:not-started']);
    expect(signed('2026-09-24', { serviceStartedAt: '2026-09-25' })).toEqual(['proposal:1:no-agreement']);
    const linked = input({ proposals: [proposal({ id: 1, status: 'Signed by Both Parties', dblSignedDate: '2026-09-01', serviceStartedAt: '2026-09-02' })], agreements: [agreement({ proposalId: 1 })] });
    expect(keys(linked)).toEqual([]);
  });

  it('an agreement: decide-by passed, within 30 days, or past term and still active; not before, and not once decided', () => {
    const one = (over: Partial<Agreement>) => buildAttention(input({ agreements: [agreement({ serviceStatus: 'Active', ...over })] }))[0]?.reason ?? null;
    expect(one({ endDate: '2026-12-31', noticeDays: 90 })).toBe('Decide by 2 Oct — in 1 day: renew it or let it end on 31 Dec');
    expect(one({ endDate: '2026-12-31', noticeDays: 100 })).toBe('The last day to decide was 22 Sept — it ends 31 Dec; renew it or let it end');
    expect(one({ endDate: '2026-10-20' })).toBe('Decide by 20 Oct — in 19 days: renew it or let it end on 20 Oct (notice period not recorded)');
    expect(one({ endDate: '2026-12-31', noticeDays: 30 })).toBeNull();
    expect(one({ endDate: '2026-08-31' })).toBe('Past term since 31 Aug, still active — renew it or end it');
    expect(one({ endDate: '2026-12-31', noticeDays: 90, renewalDecision: 'renew' })).toBeNull();
    expect(one({ endDate: '2026-08-31', serviceStatus: 'Ended' })).toBeNull();
  });
});

describe('needs your attention: length', () => {
  it('more than two meetings to write up fold into one row; two stay as they are', () => {
    const ended = (id: number) => clientMeeting({ id, title: `M${id}`, meetingDate: '2026-09-30', startAt: '2026-09-30T10:00:00', endAt: '2026-09-30T10:30:00' });
    expect(keys(input({ meetings: [ended(1), ended(2)] }))).toEqual(['meeting:1:writeup', 'meeting:2:writeup']);
    const folded = buildAttention(input({ meetings: [ended(1), ended(2), ended(3), ended(4)] }));
    expect(folded.map((x) => [x.key, x.title, x.children?.length])).toEqual([['group:writeup', '4 meetings to write up', 4]]);
  });

  it('signed proposals with no agreement fold into one row once there are more than two', () => {
    const won = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((id) => proposal({ id, client: `Co ${id}`, status: 'Signed by Both Parties', dblSignedDate: '2026-09-01', serviceStartedAt: '2026-09-02' }));
    const items = buildAttention(input({ proposals: won }));
    expect(items.map((x) => [x.key, x.title])).toEqual([['group:no-agreement', '9 signed proposals with no agreement yet']]);
  });

  it('"no agreement yet" is never a permanent row: only for proposals signed in the last 60 days', () => {
    const signed = (dbl: string, over: Partial<Proposal> = {}) => keys(input({ proposals: [proposal({ id: 1, status: 'Signed by Both Parties', dblSignedDate: dbl, serviceStartedAt: dbl, ...over })] }));
    expect(NO_AGREEMENT_WITHIN_DAYS).toBe(60);
    expect(signed('2026-08-02')).toEqual(['proposal:1:no-agreement']); // 60 days ago
    expect(signed('2026-08-01')).toEqual([]); // 61 days ago
    expect(signed('2025-11-01')).toEqual([]);
    // A service that never started is still raised, however long ago it was signed.
    expect(signed('2025-11-01', { serviceStartedAt: null })).toEqual(['proposal:1:not-started']);
  });

  it('flagged emails: one that is due is raised; a count of those with no date is not', () => {
    const mail = (id: number, due: string | null) => ({ id, subject: `Mail ${id}`, senderEmail: 'omar@acme.test', senderName: 'Omar', receivedAt: '2026-09-28T09:00:00Z', flagStatus: 'flagged', flagDueAt: due, companyId: null, companyName: null }) as never;
    expect(keys(input({ emails: [mail(1, `${TODAY}T09:00:00`), mail(2, null), mail(3, null)] }))).toEqual(['email:1:due']);
    expect(keys(input({ emails: [mail(2, null), mail(3, null)] }))).toEqual([]);
  });

  it('seven rows show; the rest wait behind "N more"; a folded row counts as one', () => {
    const late = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((id) => commitment({ id, sourceKey: `k${id}`, dueDate: '2026-09-20' }));
    const owed = [11, 12, 13].map((id) => commitment({ id, sourceKey: `o${id}`, direction: 'theirs', dueDate: '2026-09-20' }));
    const items = buildAttention(input({ commitments: [...late, ...owed] }));
    expect(items).toHaveLength(10);
    expect(items[9]).toMatchObject({ key: 'group:owed', title: 'Owed to you (3)' });
    expect(shownAttentionKeys(items, 7).size).toBe(7);
    expect(items.length - shownAttentionKeys(items, 7).size).toBe(3);
  });

  it('nothing qualifies: the list is empty', () => {
    expect(buildAttention(input({}))).toEqual([]);
    // With you for a week or less, a decide-by date far off, a signature this week: none is raised.
    expect(buildAttention(input({
      opportunities: [opp({ nextAction: 'Reply', waitingOn: 'us', waitingSince: '2026-09-28' })],
      agreements: [agreement({ serviceStatus: 'Active', endDate: '2027-06-30', noticeDays: 30 })],
      proposals: [proposal({ status: 'Signed by Both Parties', dblSignedDate: '2026-09-28' })],
    }))).toEqual([]);
  });
});

describe('needs your attention: nothing is also in the rail or in Today', () => {
  const proposals = [
    proposal({ id: 1, status: 'Proposal Request Received', dateAdded: '2026-09-20' }),
    proposal({ id: 2, status: 'Drafting', dateAdded: '2026-09-01' }),
    proposal({ id: 3, status: 'In Internal Review', reviewRequestedAt: '2026-09-01' }),
    proposal({ id: 4, status: 'In Internal Review', reviewRequestedAt: '2026-09-02', reviewStatus: 'approved' }),
    proposal({ id: 5, status: 'In Internal Review', reviewRequestedAt: '2026-09-03', reviewStatus: 'changes_requested' }),
    proposal({ id: 6, status: 'Sent to Client', dateSentToClient: '2026-08-20' }),
    proposal({ id: 7, status: 'Signed by Client', dateSigned: '2026-09-29' }),
  ];

  it('a proposal the rail shows is not listed again; one the rail leaves out, waiting on you, is', () => {
    const base = input({ proposals });
    const rail = new Set(buildInPlay(proposals, ctx(base)).rows.map((r) => r.id));
    expect([...rail].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    const shown = buildAttention({ ...base, railShown: rail });
    expect(shown.map((x) => x.key)).toEqual(['proposal:7:countersign']);
    expect(shown.filter((x) => x.record?.kind === 'proposal' && rail.has(x.record.id) && inRail(x.key))).toEqual([]);
    // Five in review, three of them waiting on you: the rail's share is three, so the outcome it leaves out is raised here.
    const many = [...proposals, proposal({ id: 8, status: 'In Internal Review', reviewRequestedAt: '2026-09-04', reviewStatus: 'approved' }), proposal({ id: 9, status: 'In Internal Review', reviewRequestedAt: '2026-09-28', reviewStatus: 'approved' })];
    const rail2 = new Set(buildInPlay(many, ctx(base)).rows.map((r) => r.id));
    const outcomes = [4, 5, 8, 9];
    const left = outcomes.filter((id) => !rail2.has(id));
    expect(left).toHaveLength(1);
    const keys2 = buildAttention({ ...base, proposals: many, railShown: rail2 }).map((x) => x.key);
    expect(keys2.filter((k) => /:(approved|changes)$/.test(k))).toEqual([`proposal:${left[0]}:approved`]);
    // A proposal only waiting for the reviewer is never raised here: the rail owns it.
    expect(keys2.some((k) => k.endsWith(':waiting-review'))).toBe(false);
  });

  it('a promise shown here keeps its task out of Today; one behind "N more" stays in Today', () => {
    const tasks = [todo({ id: 1, title: 'Send the quote', dueDate: '2026-09-28' }), todo({ id: 2, title: 'Other', dueDate: '2026-09-28' })];
    const promise = commitment({ id: 1, todoId: 1, dueDate: '2026-09-28' });
    const i = input({ todos: tasks, commitments: [promise] });
    const attention = buildAttention(i);
    expect(attention.map((x) => x.key)).toEqual(['commitment:1:overdue']);
    const today = buildTimeline({ ...i, attentionShown: shownAttentionKeys(attention, 7) });
    expect(today.overdue.map((t) => t.id)).toEqual([2]);
    const hidden = buildTimeline({ ...i, attentionShown: new Set<string>() });
    expect(hidden.overdue.map((t) => t.id)).toEqual([1, 2]);
  });
});
