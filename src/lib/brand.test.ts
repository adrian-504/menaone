// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

vi.mock('../assets/brand/office-band.jpg', () => ({ default: '/office-band.jpg' }));

import { tileIndex, strColor } from './utils';
import { dayPart, scrimFor, photoOfDay, initialsOf, homeCity } from './appearance';
import { buildIndex, nowMeeting, type AttentionItem, type Timeline } from './myday';
import { agreementFigures, companyFigures, contactFigures, projectFigures, proposalFigures } from './recordFigures';
import type { Agreement, Meeting, Proposal, Todo } from './types';

const meeting = (over: Partial<Meeting>): Meeting => ({
  id: 1, title: 'Meeting', meetingDate: '2026-09-30', companyName: null, projectId: null, opportunityId: null, attendees: [], agenda: null,
  discussion: null, decisions: null, actionItems: null, followUp: null, nextMeeting: null, noteId: null, createdAt: null, updatedAt: null,
  outlookEventId: null, startAt: null, endAt: null, organizer: null, location: null, isOnlineMeeting: false, onlineMeetingUrl: null,
  isCancelled: false, source: 'internal', ...over,
} as Meeting);
const todo = (id: number): Todo => ({ id, title: 'T', status: 'Pending' } as Todo);
const att = (key: string, companyName: string | null = null, children?: AttentionItem[]): AttentionItem =>
  ({ key, kind: 'system', title: key, reason: '', tone: 'red', score: 1, companyName, children, action: { kind: 'open', label: 'Open' } } as unknown as AttentionItem);

describe('initials tiles', () => {
  it('picks one of six brand colours, the same every time for the same name', () => {
    const names = ['Acme Holdings', 'Northwind Trading', 'Globex', 'Contoso', 'Initech', 'Umbrella', 'Hooli', 'Stark', 'Wayne', 'Tyrell', 'Soylent', 'Cyberdyne'];
    for (const n of names) {
      expect(tileIndex(n)).toBeGreaterThanOrEqual(1);
      expect(tileIndex(n)).toBeLessThanOrEqual(6);
      expect(tileIndex(n)).toBe(tileIndex(n));
      expect(tileIndex(`  ${n.toUpperCase()} `)).toBe(tileIndex(n));
    }
    expect(new Set(names.map(tileIndex)).size).toBeGreaterThanOrEqual(4);
    expect(strColor('Acme Holdings')).toMatch(/^var\(--tile-[1-6]\)$/);
  });
  it('initials: first and last word, or two letters of one', () => {
    expect(initialsOf('Ahmad Abdallah')).toBe('AA');
    expect(initialsOf('Hassan Al Balaghi')).toBe('HB');
    expect(initialsOf('omar')).toBe('OM');
    expect(initialsOf('  ')).toBe('');
  });
});

describe('the band', () => {
  it('scrim follows the time of day', () => {
    expect(dayPart(9)).toBe('morning');
    expect(dayPart(14)).toBe('afternoon');
    expect(dayPart(19)).toBe('evening');
    expect(dayPart(2)).toBe('evening');
    expect(scrimFor('afternoon')).toContain('rgba(1,75,140,.92) 0%');
    expect(scrimFor('morning')).toContain('rgba(1,75,140,.78) 0%');
    expect(scrimFor('evening')).toContain('rgba(10,32,51,.85) 0%');
  });
  it('one of your photos a day, in turn', () => {
    expect(photoOfDay([], new Date(2026, 8, 30))).toBeNull();
    const a = photoOfDay(['a.jpg', 'b.jpg'], new Date(2026, 8, 30));
    const b = photoOfDay(['a.jpg', 'b.jpg'], new Date(2026, 9, 1));
    expect(a).not.toBe(b);
    expect(photoOfDay(['a.jpg', 'b.jpg'], new Date(2026, 8, 30, 23))).toBe(a);
  });
  it('home city: this Mac\'s time zone, else the first weather city', () => {
    expect(homeCity('Asia/Riyadh')).toBe('Riyadh');
    expect(homeCity('America/New_York')).toBe('Barcelona');
  });
});

describe('the index row', () => {
  const timeline = (over: Partial<Timeline>): Timeline => ({ overdue: [], timed: [], anytime: [], allDay: [], ...over });
  it('counts from the signals My Day has, hides zeros and numbers the rest in order', () => {
    const t = timeline({
      overdue: [todo(1), todo(2), todo(3)],
      timed: [
        { type: 'meeting', at: '09:00', meeting: meeting({ id: 1 }), past: true, current: false },
        { type: 'now', at: '14:05' },
        { type: 'meeting', at: '16:00', meeting: meeting({ id: 2 }), past: false, current: false },
      ],
    });
    const attention = [
      att('commitment:1:overdue', 'Acme Holdings'),
      att('proposal:4:followup', 'Northwind Trading'),
      att('group:followup', null, [att('proposal:5:followup', 'Acme Holdings')]),
    ];
    expect(buildIndex(t, attention)).toEqual([
      { ix: '01', n: 3, label: 'need you', target: 'attention' },
      { ix: '02', n: 1, label: 'meeting to go', target: 'today' },
      { ix: '03', n: 3, label: 'tasks overdue', target: 'overdue' },
      { ix: '04', n: 2, label: 'clients waiting on you', target: 'followup' },
      { ix: '05', n: 1, label: 'promise late', target: 'attention' },
    ]);
    expect(buildIndex(timeline({ overdue: [todo(1)] }), [])).toEqual([{ ix: '01', n: 1, label: 'task overdue', target: 'overdue' }]);
    expect(buildIndex(timeline({}), [])).toEqual([]);
  });
  it('the Now panel: the meeting running, else the next one today', () => {
    const past = { type: 'meeting' as const, at: '09:00', meeting: meeting({ id: 1 }), past: true, current: false };
    const running = { type: 'meeting' as const, at: '14:00', meeting: meeting({ id: 2 }), past: false, current: true };
    const next = { type: 'meeting' as const, at: '16:00', meeting: meeting({ id: 3 }), past: false, current: false };
    expect(nowMeeting(timeline({ timed: [past, running, next] }))).toEqual({ meeting: running.meeting, current: true });
    expect(nowMeeting(timeline({ timed: [past, next] }))).toEqual({ meeting: next.meeting, current: false });
    expect(nowMeeting(timeline({ timed: [past] }))).toBeNull();
  });
});

describe('record figures', () => {
  const today = '2026-09-30';
  const agreement = (over: Partial<Agreement>): Agreement => ({ id: 1, agrRef: 'AGR-1', client: 'Acme', status: 'Signed', serviceStatus: 'Active', monthlyFee: 15000, contractMonths: 12, currency: 'SAR', endDate: '2027-01-31', ...over } as Agreement);
  const proposal = (over: Partial<Proposal>): Proposal => ({ id: 7, client: 'Acme', status: 'Sent to Client', monthlyFee: 9000, contractMonths: 12, dateSentToClient: '2026-09-08', dateAdded: '2026-09-01', archivedAt: null, currency: 'SAR', ...over } as Proposal);
  it('company: monthly fee, agreement end (or next meeting), open proposals — at most three', () => {
    const f = companyFigures({ clientAgreements: [agreement({})], proposals: [proposal({}), proposal({ id: 8, status: 'Lost' })], meetings: [meeting({ meetingDate: '2026-10-02' })] }, today);
    expect(f.map((x) => x.label)).toEqual(['a month', 'agreement ends', 'open proposal']);
    expect(f[0].value).toContain('15,000');
    const noAgreement = companyFigures({ clientAgreements: [], proposals: [], meetings: [meeting({ meetingDate: '2026-10-02' })] }, today);
    expect(noAgreement.map((x) => x.label)).toEqual(['next meeting']);
  });
  it('proposal: value, status, days with the client or with us', () => {
    expect(proposalFigures(proposal({}), today).map((x) => [x.label, x.value])).toEqual([['a month', expect.stringContaining('9,000')], ['status', 'Sent to Client'], ['days with the client', '22']]);
    expect(proposalFigures(proposal({ status: 'Drafting', monthlyFee: null }), today).map((x) => x.label)).toEqual(['status', 'days with us']);
  });
  it('project: progress and the next milestone', () => {
    expect(projectFigures({ progressOverride: null, computedProgress: 42.4 }, [{ status: 'Done', targetDate: '2026-09-01' }, { status: 'In Progress', targetDate: '2026-10-15' }], today).map((x) => x.value)).toEqual(['42%', expect.stringContaining('15')]);
  });
  it('agreement: contracted value, monthly, ends', () => {
    expect(agreementFigures(agreement({}), today).map((x) => x.label)).toEqual(['contracted', 'a month', 'ends']);
  });
  it('contact: role, company, last contact', () => {
    expect(contactFigures({ role: 'CFO', clientName: 'Acme' }, '2026-09-15').map((x) => x.label)).toEqual(['role', 'company', 'last contact']);
    expect(contactFigures({ role: null, clientName: null }, null)).toEqual([]);
  });
});
