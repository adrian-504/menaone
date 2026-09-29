// Notes → "From meetings" (owner, 29-Sep-2026): the notes written inside
// meetings, listed where Ahmad looks for notes. Read-only: each row opens its
// meeting. Pure: tabs/notes.ts renders it.

import { meetingExcerpt } from './meetingExcerpt';
import { writeUpState } from './meetingRecap';
import type { Meeting } from './types';

export interface MeetingNoteRow {
  id: number;
  date: string | null;
  company: string | null;
  title: string;
  excerpt: string;
}

type ListMeeting = Pick<Meeting, 'id' | 'title' | 'meetingDate' | 'startAt' | 'companyName' | 'isCancelled' | 'agenda' | 'discussion' | 'decisions' | 'followUp' | 'actionItems'>;

const key = (m: ListMeeting) => m.startAt || `${m.meetingDate || ''}T00:00`;

/** Every held meeting something was written about, newest first; `query`
 * matches the title, the company or the excerpt (every word, any order). */
export function meetingNotesList(meetings: ListMeeting[], query = ''): MeetingNoteRow[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return meetings
    .filter((m) => !m.isCancelled && writeUpState(m, [], false).hasNotes)
    .sort((a, b) => key(b).localeCompare(key(a)) || b.id - a.id)
    .map((m) => ({ id: m.id, date: m.meetingDate, company: m.companyName, title: m.title, excerpt: meetingExcerpt(m) || '' }))
    .filter((r) => {
      if (!terms.length) return true;
      const hay = `${r.title} ${r.company || ''} ${r.excerpt}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
}
