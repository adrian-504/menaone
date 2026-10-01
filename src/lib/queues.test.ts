// Pending and Follow-up, calmer (owner, 27-Sep-2026).
import { describe, expect, it } from 'vitest';
import { backInDays, lastTouch, touchLabel } from './followup';
import { pendingRuns } from './queues';

const TODAY = '2026-09-27';
const own = new Set(['menabig.test']);
const sentP = (over: Record<string, unknown> = {}) => ({ dateSentToClient: '2026-09-02', sentDate: null, notes: [], companyId: 7, ...over });

describe('lastTouch', () => {
  it('is the send date when nothing happened since', () => {
    expect(lastTouch(sentP(), { emails: [], meetings: [], today: TODAY, ownDomains: own })).toEqual({ date: '2026-09-02', kind: 'sent', days: 25 });
  });

  it('a note, an email from the client or a meeting wins when it is the latest', () => {
    const notes = [{ id: 1, date: '2026-09-22', text: 'Called Sara' }];
    const emails = [{ companyId: 7, senderEmail: 'sara@contoso.test', receivedAt: '2026-09-24T09:00:00Z' }];
    const meetings = [{ companyId: 7, meetingDate: '2026-09-23', isCancelled: false }];
    expect(lastTouch(sentP({ notes }), { emails: [], meetings: [], today: TODAY, ownDomains: own })).toMatchObject({ kind: 'note', days: 5 });
    expect(lastTouch(sentP({ notes }), { emails, meetings, today: TODAY, ownDomains: own })).toMatchObject({ kind: 'email', date: '2026-09-24', days: 3 });
    expect(lastTouch(sentP({ notes }), { emails: [], meetings, today: TODAY, ownDomains: own })).toMatchObject({ kind: 'meeting', days: 4 });
  });

  it('ignores our own emails, emails and meetings before it was sent, cancelled meetings and other companies', () => {
    const ctx = {
      today: TODAY, ownDomains: own,
      emails: [
        { companyId: 7, senderEmail: 'ahmad@menabig.test', receivedAt: '2026-09-25T09:00:00Z' },
        { companyId: 7, senderEmail: 'sara@contoso.test', receivedAt: '2026-08-30T09:00:00Z' },
        { companyId: 8, senderEmail: 'lina@northwind.test', receivedAt: '2026-09-25T09:00:00Z' },
      ],
      meetings: [{ companyId: 7, meetingDate: '2026-09-20', isCancelled: true }, { companyId: 7, meetingDate: '2026-08-20', isCancelled: false }],
    };
    expect(lastTouch(sentP(), ctx)).toMatchObject({ kind: 'sent', days: 25 });
  });

  it('a meeting still to come is not contact yet; no send date, no answer', () => {
    expect(lastTouch(sentP(), { emails: [], meetings: [{ companyId: 7, meetingDate: '2026-09-30', isCancelled: false }], today: TODAY })).toMatchObject({ kind: 'sent' });
    expect(lastTouch(sentP({ dateSentToClient: null }), { emails: [], meetings: [], today: TODAY })).toBeNull();
  });

  it('says what it was on the row', () => {
    expect(touchLabel({ date: '2026-09-24', kind: 'email', days: 3 }, '2 Sept')).toBe('Sent 2 Sept · client replied 3 days ago');
    expect(touchLabel({ date: '2026-09-22', kind: 'note', days: 5 }, '2 Sept')).toBe('Sent 2 Sept · you logged a note 5 days ago');
    expect(touchLabel({ date: '2026-09-23', kind: 'meeting', days: 4 }, '2 Sept')).toBe('Sent 2 Sept · meeting 4 days ago');
    expect(touchLabel({ date: '2026-09-02', kind: 'sent', days: 25 }, '2 Sept')).toBe('Sent 2 Sept');
  });
});

describe('Wait longer — back in N days', () => {
  it('is today plus N, across months and years, with N kept within 1–90 (30 when unreadable)', () => {
    expect(backInDays('2026-09-27', 30)).toBe('2026-10-27');
    expect(backInDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(backInDays('2026-09-27', 0)).toBe('2026-09-28');
    expect(backInDays('2026-09-27', 90)).toBe('2026-12-26');
    expect(backInDays('2026-09-27', 120)).toBe('2026-12-26');
    expect(backInDays('2026-09-27', Number.NaN)).toBe('2026-10-27');
  });
});

describe('Pending order', () => {
  const p = (id: number, client: string, dateAdded: string, requestGroup: string | null = null) => ({ id, client, dateAdded, sentDate: null, requestGroup });
  const list = [p(1, 'Beta', '2026-09-20'), p(2, 'Acme', '2026-09-25', 'g'), p(3, 'Acme', '2026-09-10', 'g'), p(4, 'Gamma', '2026-09-15')];
  const ids = (runs: ReturnType<typeof pendingRuns>) => runs.map((r) => [r.group, r.items.map((x) => x.id)]);

  it('oldest first: a group sits at its oldest member, members oldest first', () => {
    expect(ids(pendingRuns(list, 'age'))).toEqual([['g', [3, 2]], [null, [4]], [null, [1]]]);
  });
  it('newest first: the group still sorts by its oldest member', () => {
    expect(ids(pendingRuns(list, 'age-desc'))).toEqual([[null, [1]], [null, [4]], ['g', [2, 3]]]);
  });
  it('client A–Z keeps the group together', () => {
    expect(ids(pendingRuns(list, 'client'))).toEqual([['g', [3, 2]], [null, [1]], [null, [4]]]);
  });
});
