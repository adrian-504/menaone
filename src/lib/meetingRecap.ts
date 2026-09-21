// What a meeting page shows and in which order. Before and during a meeting
// it is a place to prepare and take notes; once the meeting is over it reads
// as a recap, with the outcome (decisions, action items) first. Also decides
// what the Meetings list flags: notes written, open actions, not written up.
// Pure (no DOM, no global state) so it can be tested.

export type NoteField = 'agenda' | 'discussion' | 'decisions' | 'followUp';
export type SectionKey = NoteField | 'actions';

export interface RecapMeeting {
  id: number;
  meetingDate: string | null;
  startAt?: string | null;
  endAt?: string | null;
  isCancelled?: boolean;
  agenda: string | null;
  discussion: string | null;
  decisions: string | null;
  followUp: string | null;
  actionItems?: string | null;
}

export const SECTION_LABEL: Record<SectionKey, string> = {
  agenda: 'Agenda',
  discussion: 'Discussion',
  decisions: 'Decisions',
  actions: 'Action items',
  followUp: 'Follow-up',
};

const filled = (s: string | null | undefined): boolean => !!s && s.trim() !== '';

/** Over once it has ended; without an end time, an hour after it started;
 * without any time, from the next day. */
export function isMeetingOver(m: RecapMeeting, now: Date, todayIso: string): boolean {
  if (m.endAt) return new Date(m.endAt).getTime() <= now.getTime();
  if (m.startAt) return new Date(m.startAt).getTime() + 60 * 60_000 <= now.getTime();
  return !!m.meetingDate && m.meetingDate < todayIso;
}

const PREP_ORDER: SectionKey[] = ['agenda', 'discussion', 'decisions', 'actions', 'followUp'];
const RECAP_ORDER: SectionKey[] = ['decisions', 'actions', 'discussion', 'followUp', 'agenda'];
/** Open before and during a meeting even when empty. */
const PREP_ALWAYS = new Set<SectionKey>(['agenda', 'discussion', 'decisions', 'actions']);
/** Open after a meeting that nothing was written for yet, to write it up. */
const WRITE_UP = new Set<SectionKey>(['discussion', 'decisions', 'actions']);

/**
 * The sections shown, in order, and the empty ones offered as "+ Add" links.
 * `opened` holds sections the user asked for on this visit.
 */
export function meetingSections(m: RecapMeeting, over: boolean, taskCount: number, opened: ReadonlySet<SectionKey>): { shown: SectionKey[]; addable: SectionKey[] } {
  const has = (k: SectionKey) => (k === 'actions' ? taskCount > 0 || filled(m.actionItems) : filled(m[k]));
  const order = over ? RECAP_ORDER : PREP_ORDER;
  const nothingYet = !order.some(has);
  const show = (k: SectionKey) => has(k) || opened.has(k) || (over ? nothingYet && WRITE_UP.has(k) : PREP_ALWAYS.has(k));
  return { shown: order.filter(show), addable: order.filter((k) => !show(k)) };
}

export interface WriteUpState {
  /** Something was written about what happened (the agenda doesn't count). */
  hasNotes: boolean;
  openActions: number;
  /** Over, not cancelled, and nothing written or assigned. */
  needsWriteUp: boolean;
}

export function writeUpState(m: RecapMeeting, tasks: { status: string | null }[], over: boolean): WriteUpState {
  const hasNotes = filled(m.discussion) || filled(m.decisions) || filled(m.followUp) || filled(m.actionItems);
  const openActions = tasks.filter((t) => t.status !== 'Done').length;
  return { hasNotes, openActions, needsWriteUp: over && !m.isCancelled && !hasNotes && tasks.length === 0 };
}

/** The last few meetings before this one with the same client, newest first. */
export function earlierMeetings<T extends RecapMeeting>(m: T, all: T[], sameClient: (x: T) => boolean, limit = 3): T[] {
  const key = (x: RecapMeeting) => x.startAt || `${x.meetingDate || ''}T00:00`;
  const mine = key(m);
  return all
    .filter((x) => x.id !== m.id && !x.isCancelled && !!x.meetingDate && key(x) < mine && sameClient(x))
    .sort((a, b) => key(b).localeCompare(key(a)))
    .slice(0, limit);
}

/** The first lines of a Markdown text, without list, checkbox and heading
 * markers, for a short preview. */
export function previewLines(md: string | null | undefined, max = 3): string[] {
  return (md || '')
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '').replace(/^#+\s+/, '').replace(/\*\*|__|`/g, '').trim())
    .filter(Boolean)
    .slice(0, max);
}
