import { describe, it, expect } from 'vitest';
import { meetingExcerpt } from './meetingExcerpt';
import { hitSubtitle } from './searchHit';
import { meetingNotesList } from './meetingNotesList';
import type { Meeting } from './types';

const meeting = (over: Partial<Meeting>): Meeting => ({
  id: 1, title: 'Check-in', meetingDate: '2026-09-20', startAt: null, companyName: 'Acme Test Co', isCancelled: false,
  agenda: null, discussion: null, decisions: null, followUp: null, actionItems: null,
  ...over,
} as Meeting);

describe('meeting excerpt', () => {
  it('prefers the decisions, then the discussion, the follow-up and the action items', () => {
    expect(meetingExcerpt(meeting({ discussion: 'Talked it through.', decisions: 'Renewal agreed.' }))).toBe('Renewal agreed.');
    expect(meetingExcerpt(meeting({ discussion: 'Talked it through.', followUp: 'Send the terms.' }))).toBe('Talked it through.');
    expect(meetingExcerpt(meeting({ followUp: 'Send the terms.', actionItems: '- Call Omar' }))).toBe('Send the terms.');
    expect(meetingExcerpt(meeting({ actionItems: '- [ ] Call Omar' }))).toBe('Call Omar');
    expect(meetingExcerpt(meeting({ agenda: 'Only an agenda' }))).toBeNull();
  });

  it('keeps the first sentence of the first line, markdown removed', () => {
    expect(meetingExcerpt(meeting({ decisions: '## Outcome\n- **Invoice monthly** from October. Fees stay.' }))).toBe('Outcome');
    expect(meetingExcerpt(meeting({ decisions: '- **Invoice monthly** from [October](https://x.test). Fees stay.\n- More' }))).toBe('Invoice monthly from October.');
    expect(meetingExcerpt(meeting({ discussion: 'Version 2.5 of the plan is fine' }))).toBe('Version 2.5 of the plan is fine');
  });

  it('cuts a long sentence at 120 characters with an ellipsis', () => {
    const out = meetingExcerpt(meeting({ discussion: 'word '.repeat(60) }))!;
    expect(out.length).toBe(120);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('search hit subtitle', () => {
  const m = meeting({ id: 9, agenda: 'Quarterly review', discussion: 'The renewal terms were agreed and we invoice monthly', decisions: 'Keep the Riyadh team' });

  it("prefixes a meeting's snippet with the part of the meeting it is in", () => {
    expect(hitSubtitle({ entityType: 'meeting', entityId: 9, snippet: '…renewal terms were agreed and we invoice…' }, [m]))
      .toBe('Discussion · …renewal terms were agreed and we invoice…');
    expect(hitSubtitle({ entityType: 'meeting', entityId: 9, snippet: 'Keep the **Riyadh** team' }, [m])).toBe('Decisions · Keep the Riyadh team');
  });

  it('names the part holding the searched word when the snippet runs across parts', () => {
    const k = meeting({ id: 7, decisions: 'Start payroll from October', followUp: 'Send the onboarding checklist\nConfirm GOSI access' });
    const hit = { entityType: 'meeting' as const, entityId: 7, snippet: 'Start payroll from October Send the onboarding checklist Confirm GOSI acc…' };
    expect(hitSubtitle(hit, [k], 'payroll')).toBe('Decisions · Start payroll from October Send the onboarding checklist Confirm GOSI acc…');
    expect(hitSubtitle(hit, [k], 'onboard')).toMatch(/^Follow-up · /);
  });

  it('has no prefix when no part holds the words, or the meeting is not loaded', () => {
    expect(hitSubtitle({ entityType: 'meeting', entityId: 9, snippet: 'Acme Test Co' }, [m])).toBe('Acme Test Co');
    expect(hitSubtitle({ entityType: 'meeting', entityId: 99, snippet: 'renewal terms' }, [m])).toBe('renewal terms');
  });

  it('cleans list and heading markers and whitespace; companies and contacts show nothing', () => {
    expect(hitSubtitle({ entityType: 'note', entityId: 1, snippet: '# Plan\n- [x] call   Omar\n' }, [])).toBe('Plan call Omar');
    expect(hitSubtitle({ entityType: 'company', entityId: 0, snippet: 'Acme' }, [])).toBe('');
    expect(hitSubtitle({ entityType: 'contact', entityId: 3, snippet: 'Acme omar@acme.test' }, [])).toBe('');
    expect(hitSubtitle({ entityType: 'task', entityId: 3, snippet: '' }, [])).toBe('');
  });
});

describe('Notes → From meetings', () => {
  const list = [
    meeting({ id: 1, meetingDate: '2026-09-01', decisions: 'Invoice monthly.' }),
    meeting({ id: 2, meetingDate: '2026-09-20', title: 'Renewal', companyName: 'Globex Test', discussion: 'Headcount up.' }),
    meeting({ id: 3, meetingDate: '2026-09-25', agenda: 'Agenda only' }),
    meeting({ id: 4, meetingDate: '2026-09-26', decisions: 'Cancelled but noted', isCancelled: true }),
    meeting({ id: 5, meetingDate: '2026-09-20', startAt: '2026-09-20T15:00:00', followUp: 'Afternoon follow-up.' }),
  ];

  it('lists held meetings with notes, newest first', () => {
    expect(meetingNotesList(list).map((r) => r.id)).toEqual([5, 2, 1]);
    expect(meetingNotesList(list)[1]).toEqual({ id: 2, date: '2026-09-20', company: 'Globex Test', title: 'Renewal', excerpt: 'Headcount up.' });
  });

  it('filters by title, company or excerpt, every word', () => {
    expect(meetingNotesList(list, 'invoice').map((r) => r.id)).toEqual([1]);
    expect(meetingNotesList(list, 'globex').map((r) => r.id)).toEqual([2]);
    expect(meetingNotesList(list, 'renewal headcount').map((r) => r.id)).toEqual([2]);
    expect(meetingNotesList(list, 'renewal invoice')).toEqual([]);
  });
});
