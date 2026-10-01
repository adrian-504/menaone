// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildInPlay, buildComingUpFocus, playRow, regulatoryNotes, stageOf } from './mydayFocus';
import { buildAttention, buildIndex, personName, type MyDayInput } from './myday';
import type { Agreement, Commitment, IntelligenceItem, Meeting, Proposal } from './types';

const TODAY = '2026-09-30';
const proposal = (over: Partial<Proposal>): Proposal => ({
  id: 1, client: 'Co', type: 'Payroll', status: 'Sent to Client', sentDate: null, dblSignedDate: null, kickoffDate: null, finance: null, hubspot: null,
  owner: null, remarks: null, dateAdded: null, monthlyFee: null, contractMonths: null, winLossReason: null, docLink: null, archived: false,
  archivedAt: null, snoozedUntil: null, dateSentToHassan: null, dateSentToClient: null, dateSigned: null, notes: [], ...over,
} as Proposal);
const meeting = (over: Partial<Meeting>): Meeting => ({
  id: 1, title: 'Meeting', meetingDate: TODAY, companyName: null, projectId: null, opportunityId: null, attendees: [], agenda: null,
  discussion: null, decisions: null, actionItems: null, followUp: null, nextMeeting: null, noteId: null, createdAt: null, updatedAt: null,
  outlookEventId: null, startAt: null, endAt: null, organizer: null, location: null, isOnlineMeeting: false, onlineMeetingUrl: null,
  isCancelled: false, source: 'internal', ...over,
} as Meeting);
const ctx = { emails: [], meetings: [], today: TODAY, ownDomains: new Set(['menabig.com']), touches: [] };

describe('proposals in play', () => {
  it('knows where each proposal waits', () => {
    expect(stageOf(proposal({ status: 'Proposal Request Received' }))).toBe('draft');
    expect(stageOf(proposal({ status: 'Drafting' }))).toBe('draft');
    expect(stageOf(proposal({ status: 'Drafting', revisions: [{ id: 1, number: 2, requestedAt: '2026-09-26', requestedByContactId: null, reason: null, linesBeforeJson: '[]', sentAt: null }] }))).toBe('client');
    expect(stageOf(proposal({ status: 'In Internal Review' }))).toBe('hassan');
    expect(stageOf(proposal({ status: 'Sent to Client' }))).toBe('client');
    expect(stageOf(proposal({ status: 'Signed by Both Parties' }))).toBeNull();
    expect(stageOf(proposal({ status: 'Sent to Client', archived: true }))).toBeNull();
  });

  it('ages: a promise two days out turns red; a long review turns amber', () => {
    const r = playRow(proposal({ status: 'Proposal Request Received', dateAdded: '2026-09-24', promisedBy: '2026-10-02' }), ctx)!;
    expect([r.meta, r.ageLabel, r.tone, r.action.kind]).toEqual(['Requested 6 days ago · promised Fri 2 Oct', '2 days left', 'red', 'draft']);
    expect(playRow(proposal({ status: 'Proposal Request Received', dateAdded: '2026-09-27' }), ctx)!.tone).toBeNull();
    const late = playRow(proposal({ status: 'Proposal Request Received', dateAdded: '2026-09-20', promisedBy: '2026-09-28' }), ctx)!;
    expect(late.ageLabel).toBe('2 days late');
    const review = playRow(proposal({ status: 'In Internal Review', reviewRequestedAt: '2026-09-10' }), ctx)!;
    expect([review.meta, review.age, review.tone, review.action.kind]).toEqual(['In review since 10 Sept', 20, 'amber', 'nudge']);
    expect(playRow(proposal({ status: 'In Internal Review', reviewRequestedAt: '2026-09-25' }), ctx)!.tone).toBeNull();
  });

  it('with clients: the last touch, an open revision, an offer about to expire', () => {
    const sent = playRow(proposal({ id: 3, status: 'Sent to Client', dateSentToClient: '2026-09-02', sentDate: '2026-09-02' }), { ...ctx, touches: [{ id: 1, companyId: null, proposalId: 3, kind: 'email_out', direction: 'out', at: '2026-09-15', subject: null, contactId: null, source: 'manual', sourceId: null } as never] })!;
    expect([sent.meta, sent.age, sent.action.kind]).toEqual(['Sent 2 Sept · last touch 15 Sept', 15, 'followed_up']);
    const rev = playRow(proposal({ status: 'Drafting', dateSentToClient: '2026-09-22', revisions: [{ id: 1, number: 2, requestedAt: '2026-09-26', requestedByContactId: null, reason: null, linesBeforeJson: '[]', sentAt: null }] }), ctx)!;
    expect([rev.meta, rev.action.label]).toEqual(['Sent 22 Sept · revision 2 open', 'Mark revision sent']);
    const exp = playRow(proposal({ status: 'Sent to Client', dateSentToClient: '2026-09-26', validUntil: '2026-10-26' }), ctx)!;
    expect(exp.meta).toBe('Sent 26 Sept · offer expires 26 Oct');
  });

  it('gives each stage its own share of rows, in stage order, and counts the rest', () => {
    const ps = [
      ...[1, 2, 3].map((n) => proposal({ id: n, status: 'Proposal Request Received', dateAdded: `2026-09-2${n}` })),
      ...[4, 5].map((n) => proposal({ id: n, status: 'In Internal Review', reviewRequestedAt: `2026-09-0${n}` })),
      ...[6, 7, 8].map((n) => proposal({ id: n, status: 'Sent to Client', dateSentToClient: `2026-08-1${n}` })),
    ];
    const p = buildInPlay(ps, ctx);
    expect(p.total).toBe(8);
    expect(p.stages.map((s) => [s.stage, s.count])).toEqual([['draft', 3], ['hassan', 2], ['client', 3]]);
    expect(p.rows.map((r) => r.id)).toEqual([1, 2, 4, 5, 6, 7, 8]);
    expect(p.hidden).toEqual({ draft: 1, hassan: 0, client: 0 });
    expect(buildInPlay([], ctx).stages).toEqual([]);
  });

  it('a long queue with clients never pushes the ones with Hassan off the list', () => {
    const ps = [
      ...Array.from({ length: 58 }, (_, n) => proposal({ id: n + 1, client: `Client ${n + 1}`, companyId: n + 1, status: 'Sent to Client', dateSentToClient: '2026-06-01' })),
      ...[101, 102, 103, 104, 105].map((id, n) => proposal({ id, status: 'In Internal Review', reviewRequestedAt: `2026-09-2${n + 1}` })),
      proposal({ id: 200, status: 'Proposal Request Received', dateAdded: '2026-09-29' }),
    ];
    const p = buildInPlay(ps, ctx);
    expect(p.rows.map((r) => r.stage)).toEqual(['draft', 'hassan', 'hassan', 'hassan', 'client', 'client', 'client']);
    expect(p.rows.filter((r) => r.stage === 'hassan').map((r) => r.id)).toEqual([101, 102, 103]);
    expect(p.hidden).toEqual({ draft: 0, hassan: 2, client: 55 });
  });

  it('with clients, the proposals sent together are one row and take one slot', () => {
    const ps = [
      proposal({ id: 1, client: 'Red Sea', companyId: 4, type: 'Workforce', status: 'Sent to Client', dateSentToClient: '2026-09-15' }),
      proposal({ id: 2, client: 'Red Sea', companyId: 4, type: 'Company maintenance', status: 'Sent to Client', dateSentToClient: '2026-09-15' }),
      proposal({ id: 3, client: 'Red Sea', companyId: 4, type: 'EOR', status: 'Sent to Client', dateSentToClient: '2026-09-15' }),
      proposal({ id: 4, client: 'Acme', companyId: 1, status: 'Sent to Client', dateSentToClient: '2026-09-20' }),
      proposal({ id: 5, client: 'Globex', companyId: 3, status: 'Sent to Client', dateSentToClient: '2026-09-22' }),
      proposal({ id: 6, client: 'Northwind', companyId: 2, status: 'Sent to Client', dateSentToClient: '2026-09-25' }),
    ];
    const p = buildInPlay(ps, ctx);
    expect(p.rows.map((r) => [r.id, r.client, r.service])).toEqual([[1, 'Red Sea', 'Workforce + Company maintenance + EOR'], [4, 'Acme', 'Payroll'], [5, 'Globex', 'Payroll']]);
    expect(p.stages).toEqual([{ stage: 'client', count: 4, oldest: 15 }]);
    expect(p.hidden.client).toBe(1);
    // A proposal the same client was sent on another day is its own request.
    expect(buildInPlay([...ps.slice(0, 2), proposal({ id: 7, client: 'Red Sea', companyId: 4, type: 'PRO', status: 'Sent to Client', dateSentToClient: '2026-09-28' })], ctx).rows.map((r) => r.service)).toEqual(['Workforce + Company maintenance', 'PRO']);
  });

  it('within a stage the urgent come first, then the oldest', () => {
    const ps = [
      proposal({ id: 1, status: 'In Internal Review', reviewRequestedAt: '2026-09-01' }),
      proposal({ id: 2, status: 'In Internal Review', reviewRequestedAt: '2026-09-10' }),
      proposal({ id: 3, status: 'In Internal Review', reviewRequestedAt: '2026-09-20' }),
      proposal({ id: 4, status: 'In Internal Review', reviewRequestedAt: '2026-09-28', reviewStatus: 'approved' }),
    ];
    expect(buildInPlay(ps, ctx).rows.map((r) => r.id)).toEqual([4, 1, 2]);
  });

  it('the index row counts proposals in play at 04', () => {
    const idx = buildIndex({ overdue: [], timed: [], anytime: [], allDay: [] }, [], 9);
    expect(idx).toEqual([{ ix: '01', n: 9, label: 'proposals in play', target: 'inplay' }]);
  });
});

describe('coming up', () => {
  const commitment = (over: Partial<Commitment>): Commitment => ({ id: 1, direction: 'ours', text: 'Send it', contactId: null, dueDate: '2026-10-02', status: 'open', closedAt: null, dropReason: null, companyId: null, opportunityId: null, projectId: null, sourceType: null, sourceId: null, sourceKey: null, todoId: null, createdAt: null, updatedAt: null, ...over } as Commitment);
  it('gathers meetings, promises both ways, expiries and notice windows over seven days', () => {
    const days = buildComingUpFocus({
      today: TODAY,
      meetings: [meeting({ id: 1, meetingDate: '2026-10-01', title: 'Kickoff' }), meeting({ id: 2, meetingDate: TODAY, title: 'Today is in Today' }), meeting({ id: 3, meetingDate: '2026-10-09', title: 'Too far' })],
      commitments: [commitment({ id: 1 }), commitment({ id: 2, direction: 'theirs', dueDate: '2026-10-03', text: 'Their numbers' }), commitment({ id: 3, status: 'kept' })],
      proposals: [proposal({ id: 8, client: 'Red Sea', status: 'Sent to Client', dateSentToClient: '2026-09-26', validUntil: '2026-10-05' })],
      agreements: [{ id: 2, client: 'Globex', status: 'Signed', serviceStatus: 'Active', endDate: '2026-12-31', noticeDays: 90 } as Agreement],
    });
    expect(days.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05']);
    expect(days.flatMap((d) => d.items.map((i) => i.kind))).toEqual(['meeting', 'promise_ours', 'notice', 'promise_theirs', 'expiry']);
    expect(days[1].items[1].detail).toBe('Ends 31 Dec · 90-day notice');
    expect(days[3].items[0].detail).toBe('Sent 26 Sept · 9-day validity');
  });
  it('caps the list', () => {
    const ms = Array.from({ length: 14 }, (_, n) => meeting({ id: n + 1, meetingDate: '2026-10-01', title: `M${n}` }));
    expect(buildComingUpFocus({ today: TODAY, meetings: ms, proposals: [], agreements: [] }).flatMap((d) => d.items)).toHaveLength(10);
  });
});

describe('regulatory', () => {
  const intel = (over: Partial<IntelligenceItem>): IntelligenceItem => ({ id: 1, kind: 'regulatory', headline: 'GOSI rates', importance: 'critical', archived: false, sourceName: 'GOSI', publishedAt: '2026-09-29', affectedServices: ['Payroll'], ...over } as IntelligenceItem);
  it('critical only, at most two, with the clients whose services it touches', () => {
    const notes = regulatoryNotes([intel({ id: 1 }), intel({ id: 2, importance: 'important' }), intel({ id: 3, publishedAt: '2026-09-01' }), intel({ id: 4, publishedAt: '2026-08-01' })],
      [{ id: 1, name: 'Acme', services: ['Payroll', 'PRO'] }, { id: 2, name: 'Globex', services: ['Company maintenance'] }]);
    expect(notes.map((n) => n.item.id)).toEqual([1, 3]);
    expect(notes[0].clients.map((c) => c.name)).toEqual(['Acme']);
    expect(regulatoryNotes([intel({ importance: 'monitor' })], [])).toEqual([]);
  });
});

describe('needs your attention: write-ups', () => {
  const input = (over: Partial<MyDayInput>): MyDayInput => ({
    today: TODAY, now: new Date('2026-09-30T18:00:00'), proposals: [], opportunities: [], pipelineFacts: [], agreements: [], meetings: [],
    todos: [], projects: [], emails: [], inboxCount: 0, reviewerName: () => 'Hassan', ownDomains: new Set(['menabig.com']), snoozed: {}, ...over,
  });
  it('a client meeting that ended today or yesterday with nothing written asks for a write-up', () => {
    const ended = meeting({ id: 5, title: 'Payroll questions', startAt: '2026-09-30T13:00:00', endAt: '2026-09-30T13:30:00', attendees: ['omar@acme.test'], attendeeEmails: ['omar@acme.test'] } as Partial<Meeting>);
    const written = meeting({ id: 6, title: 'Written', startAt: '2026-09-30T10:00:00', endAt: '2026-09-30T10:30:00', attendees: ['omar@acme.test'], attendeeEmails: ['omar@acme.test'], discussion: 'Notes' } as Partial<Meeting>);
    const internal = meeting({ id: 7, title: 'Internal', startAt: '2026-09-30T09:00:00', endAt: '2026-09-30T09:30:00', attendees: ['hassan@menabig.com'], attendeeEmails: ['hassan@menabig.com'] } as Partial<Meeting>);
    const keys = buildAttention(input({ meetings: [ended, written, internal] })).map((a) => a.key);
    expect(keys).toContain('meeting:5:writeup');
    expect(keys).not.toContain('meeting:6:writeup');
    expect(keys).not.toContain('meeting:7:writeup');
  });
});

describe('the rail owns proposal-stage work', () => {
  const input = (over: Partial<MyDayInput>): MyDayInput => ({
    today: TODAY, now: new Date('2026-09-30T18:00:00'), proposals: [], opportunities: [], pipelineFacts: [], agreements: [], meetings: [],
    todos: [], projects: [], emails: [], inboxCount: 0, reviewerName: () => 'Hassan', ownDomains: new Set(['menabig.com']), snoozed: {}, ...over,
  });
  it('a proposal is in Proposals in play or in Needs your attention, never both — except a late promise', () => {
    const proposals = [
      proposal({ id: 1, status: 'Proposal Request Received', dateAdded: '2026-09-20' }),
      proposal({ id: 2, status: 'Proposal Request Received', dateAdded: '2026-09-20', promisedBy: '2026-09-28' }),
      proposal({ id: 3, status: 'In Internal Review', reviewRequestedAt: '2026-09-01' }),
      proposal({ id: 4, status: 'In Internal Review', reviewRequestedAt: '2026-09-01', reviewStatus: 'approved' }),
      proposal({ id: 5, status: 'Sent to Client', dateSentToClient: '2026-08-20' }),
      proposal({ id: 6, status: 'Drafting', dateAdded: '2026-09-01' }),
    ];
    const rail = new Set(buildInPlay(proposals, ctx, { draft: 99, hassan: 99, client: 99 }).rows.map((r) => r.id));
    const attention = buildAttention(input({ proposals, railOwnsProposals: true })).flatMap((a) => [a, ...(a.children ?? [])]).filter((a) => a.record?.kind === 'proposal');
    const both = attention.filter((a) => rail.has(a.record!.id));
    expect(both.map((a) => a.key)).toEqual(['proposal:2:promise']);
    expect(both[0].reason).toBe('You promised it for 28 Sept — 2 days late · Payroll');
  });
  it('approved by Hassan: the rail says Mark as sent, not Nudge', () => {
    const r = playRow(proposal({ status: 'In Internal Review', reviewRequestedAt: '2026-09-20', reviewStatus: 'approved', reviewedAt: '2026-09-29' }), ctx)!;
    expect([r.action.kind, r.tone, r.meta]).toEqual(['mark_sent', 'red', 'Approved 29 Sept — send it to the client']);
  });
  it('attendees read as names', () => {
    expect(personName('omar.haddad@acme.test')).toBe('Omar Haddad');
    expect(personName('omar@acme.test')).toBe('Omar');
    expect(personName('Jane Doe')).toBe('Jane Doe');
  });
});
