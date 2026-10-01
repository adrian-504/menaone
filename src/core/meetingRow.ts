// A meeting as a row on a record page (1.61 "records"): when it is and who
// with (or where), what came out of it once it is over — decisions, promises,
// whether it was written up — and one plain action: Prepare before it, Join
// while it runs. Shared by the contact, opportunity and project pages.

import { S } from '../lib/state';
import type { Meeting } from '../lib/types';
import { escHtml, today } from '../lib/utils';
import { fmtDateShort, fmtTime } from '../lib/dates';
import { recordLink } from '../lib/links';
import { isRunning, meetingOutcomes, placeLabel } from '../lib/meetingsList';
import { isMeetingOver } from '../lib/meetingRecap';
import { meetingExcerpt } from '../lib/meetingExcerpt';
import { attendeeName } from '../lib/pagePeople';

const addDay = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** `second`: what follows the time — the place (on a person's page) or who it is with. */
export function meetingRowHtml(m: Meeting, opts: { second?: 'place' | 'people'; now?: Date } = {}): string {
  const now = opts.now || new Date();
  const t = today();
  const running = isRunning(m, now);
  const over = isMeetingOver(m, now, t) && !running;
  const tasks = S.todos.filter((x) => x.meetingId === m.id && x.parentId == null);
  const o = over ? meetingOutcomes(m, S.commitments, tasks, over) : null;
  const chips = o
    ? [o.decisions ? `<span>${o.decisions} ${o.decisions === 1 ? 'decision' : 'decisions'}</span>` : '', o.promisesMade ? `<span>${o.promisesMade} ${o.promisesMade === 1 ? 'promise' : 'promises'}</span>` : '', o.writtenUp ? '<span class="g">Written up</span>' : o.needsWriteUp ? '<span class="a">Not written up</span>' : ''].join('')
    : running ? '<span>Notes open</span>' : m.isCancelled ? '<span>Cancelled</span>' : (m.agenda || '').trim() ? '<span>Agenda ready</span>' : '';
  const time = m.startAt ? ` ${fmtTime(m.startAt)}` : '';
  const day = !m.meetingDate ? '' : m.meetingDate === t ? `Today${time}` : m.meetingDate === addDay(t, 1) ? `Tomorrow${time}` : fmtDateShort(m.meetingDate, true);
  const people = (m.attendees || []).map(attendeeName).filter(Boolean);
  const second = opts.second === 'people' ? (people.length > 2 ? `${people.slice(0, 2).join(', ')} +${people.length - 2}` : people.join(', ')) : placeLabel(m) || '';
  const noted = over ? meetingExcerpt(m) : null;
  const act = running && m.onlineMeetingUrl ? `<a class="btn-secondary btn-sm" href="${escHtml(m.onlineMeetingUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Join</a>`
    : !over && !running && !m.isCancelled ? `<button class="btn-secondary btn-sm" onclick="event.stopPropagation();openRecord('meeting', ${m.id})">Prepare</button>` : '';
  return `<div class="rk-row rk-row-3 rec-row" onclick="if(!event.target.closest('a,button'))openRecord('meeting', ${m.id})"><span class="rk-k t-blue" aria-hidden="true">◉</span><div class="rk-row-main"><div class="rk-row-t">${recordLink('meeting', m.id, m.title)}</div><div class="rk-row-s">${escHtml([day, second].filter(Boolean).join(' · '))}${noted ? ` · “${escHtml(noted)}”` : ''}</div></div><div class="pk-mout">${chips}</div>${act || '<span></span>'}</div>`;
}

/** Newest first, the ones still to come on top in the order they happen. */
export function orderMeetingRows<T extends Pick<Meeting, 'startAt' | 'meetingDate'>>(list: T[], t: string = today()): T[] {
  const at = (m: T) => m.startAt || m.meetingDate || '';
  const upcoming = list.filter((m) => (m.meetingDate || '') >= t).sort((a, b) => at(a).localeCompare(at(b)));
  const past = list.filter((m) => (m.meetingDate || '') < t).sort((a, b) => at(b).localeCompare(at(a)));
  return [...upcoming, ...past];
}
