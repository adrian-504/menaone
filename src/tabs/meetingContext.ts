// The meeting page's context column (owner, 29-Sep-2026, Concept B): beside the
// notes, at all times — Where we stand, In the room, Last time, Open promises.
// Empty panels are left out; an internal meeting shows only In the room. What
// goes in each: lib/meetingContext.ts.

import { S } from '../lib/state';
import { escHtml, expose, fmtDate, inCompany, today } from '../lib/utils';
import { recordLink } from '../lib/links';
import { meetingPeople } from '../lib/clientMatch';
import { meetingContext } from '../lib/meetingContext';
import { briefInputFor } from './companyState';
import { toggleCommitmentKept } from './commitments';
import type { Meeting } from '../lib/types';

function clientOf(m: Meeting): { id: number | null; name: string } | null {
  if (m.companyId != null) return S.companies.find((c) => c.id === m.companyId) || (m.companyName ? { id: m.companyId, name: m.companyName } : null);
  return m.companyName ? { id: null, name: m.companyName } : null;
}

const panel = (title: string, body: string, extra = '') => `<section class="md-ctx-panel"><div class="md-ctx-hd"><span class="rec-eyebrow">${title}</span>${extra}</div>${body}</section>`;

export function renderMeetingContext(m: Meeting): void {
  const el = document.getElementById('md-context');
  if (!el) return;
  const client = clientOf(m);
  const brief = client ? briefInputFor(client) : null;
  const ctx = meetingContext(m, brief, meetingPeople(m), S.meetings, S.commitments, (x) => !!client && inCompany(client, x.companyId, x.companyName));
  const todayIso = today();
  const out: string[] = [];
  if (ctx.stand) {
    out.push(panel('Where we stand', `<p class="md-ctx-text">${escHtml(ctx.stand)}</p>`,
      `<a href="#" class="rlink md-ctx-act" onclick="event.preventDefault();addSuggestedAgenda(${m.id})" title="Add the points worth covering to the agenda">Suggest agenda</a>`));
  }
  if (ctx.room.length) {
    out.push(panel('In the room', ctx.room.map((p) => `<div class="md-ctx-person${p.internal ? ' is-internal' : ''}">
        <span class="md-ctx-av">${escHtml(p.initials)}</span>
        <span class="md-ctx-main">${p.contactId != null ? recordLink('contact', p.contactId, p.name) : escHtml(p.name)}${p.decisionMaker ? ' <span class="chip co-dm">Decision maker</span>' : ''}${p.role || p.internal ? `<span class="md-ctx-sub">${escHtml(p.role || 'MENA BIG')}</span>` : ''}</span>
      </div>`).join('')));
  }
  if (ctx.lastTime) {
    const l = ctx.lastTime;
    const counts = [l.decisions ? `${l.decisions} decision${l.decisions === 1 ? '' : 's'}` : '', l.promises ? `${l.promises} promise${l.promises === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
    out.push(panel(`Last time · ${escHtml(fmtDate(l.date))}`, `<p class="md-ctx-text">${recordLink('meeting', l.id, l.title)}${l.excerpt ? ` — ${escHtml(l.excerpt)}` : ''}</p>
      ${counts ? `<p class="md-ctx-sub">${counts}</p>` : ''}
      ${l.stillOwed.map((c) => `<p class="md-ctx-text">${escHtml(c.text)} — <span class="md-ctx-owed">still owed</span></p>`).join('')}`));
  }
  if (ctx.openPromises.length) {
    out.push(panel('Open promises', ctx.openPromises.map((c) => {
      const late = !!c.dueDate && c.dueDate < todayIso;
      return `<div class="md-ctx-promise">
        <button class="md-ctx-box" onclick="meetingContextKept(${c.id})" data-tip="Mark kept" aria-label="Mark kept"></button>
        <span class="md-ctx-main">${escHtml(c.text)}<span class="md-ctx-sub${late ? ' is-late' : ''}">${c.direction === 'ours' ? 'We owe' : 'They owe'}${c.dueDate ? ` · ${late ? 'late since' : 'by'} ${escHtml(fmtDate(c.dueDate))}` : ''}</span></span>
      </div>`;
    }).join('')));
  }
  el.hidden = out.length === 0;
  el.innerHTML = out.join('');
}

export function meetingContextKept(id: number): void {
  toggleCommitmentKept(id);
  const m = S.meetingEditId != null ? S.meetings.find((x) => x.id === S.meetingEditId) : undefined;
  if (m) renderMeetingContext(m);
}
expose('meetingContextKept', meetingContextKept);
