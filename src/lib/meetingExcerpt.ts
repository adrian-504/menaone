// Meeting notes are findable (owner, 29-Sep-2026): Ahmad spent a morning looking
// for notes written in a meeting a week earlier. Wherever a meeting is listed
// (the company page, the Meetings list, Notes' "From meetings"), it shows the
// first sentence of what was noted. Pure.

import { previewLines, type RecapMeeting } from './meetingRecap';

type ExcerptMeeting = Pick<RecapMeeting, 'decisions' | 'discussion' | 'followUp' | 'actionItems'>;

const MAX = 120;

/** Markdown down to plain text: links to their words, emphasis and code marks gone. */
export function plainLine(s: string): string {
  return s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[\[([^\]]*)\]\]/g, '$1').replace(/\*\*|__|`|~~/g, '').replace(/(^|\s)[*_](\S)/g, '$1$2').replace(/(\S)[*_](?=\s|$)/g, '$1').replace(/\s+/g, ' ').trim();
}

/** The first sentence of the decisions, else the discussion, the follow-up or
 * the action items (max 120 characters); null when nothing was noted. */
export function meetingExcerpt(m: ExcerptMeeting): string | null {
  for (const text of [m.decisions, m.discussion, m.followUp, m.actionItems]) {
    const line = plainLine(previewLines(text, 1)[0] || '');
    if (!line) continue;
    const sentence = line.match(/^.*?[.!?](?=\s)/)?.[0] || line;
    return sentence.length > MAX ? `${sentence.slice(0, MAX - 1).trimEnd()}…` : sentence;
  }
  return null;
}
