// Search results show the match (owner, 29-Sep-2026): the palette's second
// line is the text the search found, and for a meeting, which part of the
// meeting it is in ("Discussion · …renewal terms agreed…"). Pure.

import { plainLine } from './meetingExcerpt';
import { SECTION_LABEL, type RecapMeeting } from './meetingRecap';
import type { SearchResult } from './types';

type HitMeeting = Pick<RecapMeeting, 'id' | 'agenda' | 'discussion' | 'decisions' | 'followUp' | 'actionItems'>;

/** Checked in this order; the first with the most of the snippet's words wins. */
const FIELDS = [
  ['discussion', SECTION_LABEL.discussion],
  ['decisions', SECTION_LABEL.decisions],
  ['followUp', SECTION_LABEL.followUp],
  ['agenda', SECTION_LABEL.agenda],
  ['actionItems', SECTION_LABEL.actions],
] as const;

/** Names and people are the title already; nothing to add. */
const NO_SUBTITLE = new Set(['company', 'contact']);

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];

/** The snippet as one plain line: each line's list or heading marker gone, then joined. */
function cleanSnippet(snippet: string): string {
  return plainLine(snippet.split('\n').map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '').replace(/^\s*#+\s+/, '')).join(' '));
}

/** Which part of the meeting holds the match: among the fields with a searched
 * word (as a prefix, like the search), or else all of them, the one containing
 * most of the snippet's words — at least half; null when none does. A snippet
 * can run across fields, so the searched word decides first. */
function meetingField(m: HitMeeting, snippetWords: string[], queryWords: string[]): string | null {
  if (!snippetWords.length) return null;
  const fields = FIELDS.map(([key, label]) => ({ label, have: words(m[key] || '') }));
  const holding = fields.filter((f) => queryWords.some((q) => f.have.some((w) => w.startsWith(q))));
  let best: { label: string; n: number } | null = null;
  for (const f of holding.length ? holding : fields) {
    const have = new Set(f.have);
    const n = snippetWords.filter((w) => have.has(w)).length;
    if (n > 0 && (!best || n > best.n)) best = { label: f.label, n };
  }
  return best && (holding.length || best.n * 2 >= snippetWords.length) ? best.label : null;
}

/** The palette row's second line for a search hit (`query`: what was typed). */
export function hitSubtitle(hit: Pick<SearchResult, 'entityType' | 'entityId' | 'snippet'>, meetings: HitMeeting[], query = ''): string {
  if (NO_SUBTITLE.has(hit.entityType)) return '';
  const text = cleanSnippet(hit.snippet || '');
  if (!text.replace(/…/g, '').trim()) return '';
  if (hit.entityType !== 'meeting') return text;
  const m = meetings.find((x) => x.id === hit.entityId);
  const field = m ? meetingField(m, words(text), words(query)) : null;
  return field ? `${field} · ${text}` : text;
}
