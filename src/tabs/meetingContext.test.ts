// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { S } from '../lib/state';
import { renderMeetingContext } from './meetingContext';
import type { Meeting } from '../lib/types';

describe('the meeting page context column', () => {
  it('an internal meeting shows only In the room', () => {
    document.body.innerHTML = '<div id="md-context" hidden></div>';
    S.contacts = []; S.companies = []; S.commitments = [];
    const m = { id: 1, title: 'Proposals review', meetingDate: '2026-09-29', startAt: null, companyId: null, companyName: null, isCancelled: false,
      attendees: ['Hassan Balaghi'], attendeeEmails: ['hassan@menabig.test'], organizer: null, organizerEmail: null,
      agenda: null, discussion: null, decisions: null, followUp: null, actionItems: null } as unknown as Meeting;
    S.meetings = [m];
    renderMeetingContext(m);
    const el = document.getElementById('md-context')!;
    expect(el.hidden).toBe(false);
    expect([...el.querySelectorAll('.md-ctx-hd .rec-eyebrow')].map((h) => h.textContent)).toEqual(['In the room']);
    expect(el.textContent).toContain('Hassan Balaghi');
  });
});
