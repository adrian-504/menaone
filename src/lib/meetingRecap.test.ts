import { describe, expect, it } from 'vitest';
import { earlierMeetings, isMeetingOver, meetingSections, previewLines, writeUpState, type RecapMeeting } from './meetingRecap';

const base = (over: Partial<RecapMeeting> = {}): RecapMeeting => ({
  id: 1, meetingDate: '2026-09-21', startAt: null, endAt: null, isCancelled: false,
  agenda: null, discussion: null, decisions: null, followUp: null, actionItems: null, ...over,
});
const none = new Set<never>();

describe('isMeetingOver', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  it('uses the end time when there is one', () => {
    expect(isMeetingOver(base({ startAt: '2026-09-21T11:00:00Z', endAt: '2026-09-21T11:30:00Z' }), now, '2026-09-21')).toBe(true);
    expect(isMeetingOver(base({ startAt: '2026-09-21T11:30:00Z', endAt: '2026-09-21T12:30:00Z' }), now, '2026-09-21')).toBe(false);
  });
  it('gives a meeting without an end an hour', () => {
    expect(isMeetingOver(base({ startAt: '2026-09-21T10:30:00Z' }), now, '2026-09-21')).toBe(true);
    expect(isMeetingOver(base({ startAt: '2026-09-21T11:30:00Z' }), now, '2026-09-21')).toBe(false);
  });
  it('without a time, a meeting is over from the next day', () => {
    expect(isMeetingOver(base({ meetingDate: '2026-09-20' }), now, '2026-09-21')).toBe(true);
    expect(isMeetingOver(base(), now, '2026-09-21')).toBe(false);
  });
});

describe('meetingSections', () => {
  it('before a meeting: agenda first, follow-up offered', () => {
    const { shown, addable } = meetingSections(base(), false, 0, none);
    expect(shown).toEqual(['agenda', 'discussion', 'decisions', 'actions']);
    expect(addable).toEqual(['followUp']);
  });
  it('after a meeting: the outcome first, empty sections offered', () => {
    const { shown, addable } = meetingSections(base({ decisions: 'Go ahead', discussion: 'Pricing' }), true, 2, none);
    expect(shown).toEqual(['decisions', 'actions', 'discussion']);
    expect(addable).toEqual(['followUp', 'agenda']);
  });
  it('after a meeting with nothing written: the write-up sections', () => {
    expect(meetingSections(base(), true, 0, none).shown).toEqual(['decisions', 'actions', 'discussion']);
  });
  it('a section asked for stays open', () => {
    expect(meetingSections(base({ decisions: 'x' }), true, 0, new Set(['agenda'] as const)).shown).toEqual(['decisions', 'agenda']);
  });
  it('whitespace is empty', () => {
    expect(meetingSections(base({ decisions: '  \n', discussion: 'x' }), true, 0, none).shown).toEqual(['discussion']);
  });
});

describe('writeUpState', () => {
  it('flags a past meeting with nothing written', () => {
    expect(writeUpState(base(), [], true)).toEqual({ hasNotes: false, openActions: 0, needsWriteUp: true });
  });
  it('an agenda alone is not a write-up; a task is', () => {
    expect(writeUpState(base({ agenda: 'Points' }), [], true).needsWriteUp).toBe(true);
    expect(writeUpState(base(), [{ status: 'Pending' }, { status: 'Done' }], true)).toEqual({ hasNotes: false, openActions: 1, needsWriteUp: false });
  });
  it('cancelled and upcoming meetings never need a write-up', () => {
    expect(writeUpState(base({ isCancelled: true }), [], true).needsWriteUp).toBe(false);
    expect(writeUpState(base(), [], false).needsWriteUp).toBe(false);
  });
});

describe('earlierMeetings', () => {
  const all = [
    base({ id: 1, meetingDate: '2026-09-21', startAt: '2026-09-21T15:00:00Z' }),
    base({ id: 2, meetingDate: '2026-09-21', startAt: '2026-09-21T09:00:00Z' }),
    base({ id: 3, meetingDate: '2026-09-10' }),
    base({ id: 4, meetingDate: '2026-09-15', isCancelled: true }),
    base({ id: 5, meetingDate: '2026-09-30' }),
    base({ id: 6, meetingDate: '2026-09-01' }),
    base({ id: 7, meetingDate: '2026-08-01' }),
  ];
  it('same client, before this one, newest first, cancelled left out', () => {
    expect(earlierMeetings(all[0], all, (x) => x.id !== 6).map((x) => x.id)).toEqual([2, 3, 7]);
  });
});

describe('previewLines', () => {
  it('drops list, checkbox and heading markers', () => {
    expect(previewLines('## Outcome\n- [x] Start in October\n\n1. **Three** people\n* fourth', 3)).toEqual(['Outcome', 'Start in October', 'Three people']);
  });
});
