// The meeting page's context column (owner, 29-Sep-2026, Concept B; panels in
// the record anatomy since 1.61): beside the notes, at all times — Where we
// stand with its three figures, Open promises, In the room with Last time.
// Empty panels are left out; an internal meeting shows only In the room. What
// goes in each: lib/meetingContext.ts.

import { S } from '../lib/state';
import { escHtml, expose, inCompany, today } from '../lib/utils';
import { fmtDateShort } from '../lib/dates';
import { daysBetween } from '../lib/pipeline';
import { plural } from '../lib/pageKit';
import { earlierMeetings } from '../lib/meetingRecap';
import { lastMet, standFigures } from '../lib/recordMeeting';
import { personAvatar } from '../core/contacts';
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

const panel = (title: string, body: string, extra = '') => `<section class="rk-panel md-ctx-panel"><div class="rec-section-hd"><h2 class="rk-panel-h">${title}</h2>${extra}</div>${body}</section>`;

export function renderMeetingContext(m: Meeting): void {
  const el = document.getElementById('md-context');
  if (!el) return;
  const client = clientOf(m);
  const brief = client ? briefInputFor(client) : null;
  const sameClient = (x: Meeting) => !!client && inCompany(client, x.companyId, x.companyName);
  const ctx = meetingContext(m, brief, meetingPeople(m), S.meetings, S.commitments, sameClient);
  const todayIso = today();
  const out: string[] = [];
  if (ctx.stand && client) {
    const figs = standFigures({
      today: todayIso, clientAgreements: S.agreements.filter((a) => inCompany(client, a.companyId, a.client)), proposals: S.proposals.filter((p) => inCompany(client, p.companyId, p.client)),
      opportunities: S.opportunities.filter((o) => inCompany(client, o.companyId, o.companyName)), commitments: S.commitments.filter((c) => client.id != null && c.companyId === client.id),
    });
    out.push(panel('Where we stand', `${figs.length ? `<div class="rk-mfigs">${figs.map((f) => `<div><b${f.tone ? ` class="t-${f.tone}"` : ''}>${escHtml(f.value)}</b><span>${escHtml(f.label)}</span></div>`).join('')}</div>` : ''}<p class="md-ctx-text">${escHtml(ctx.stand)}</p>`,
      `<div class="rec-section-actions"><a href="#" class="rlink md-ctx-act" onclick="event.preventDefault();addSuggestedAgenda(${m.id})" data-tip="Add the points worth covering to the agenda">Suggest agenda</a></div>`));
  }
  if (ctx.openPromises.length) {
    out.push(panel('Open promises', ctx.openPromises.map((c) => {
      const ours = c.direction === 'ours';
      const late = c.dueDate && c.dueDate < todayIso ? daysBetween(c.dueDate, todayIso) ?? 0 : 0;
      const since = c.createdAt ? `since ${fmtDateShort(c.createdAt.slice(0, 10), true)}` : '';
      const sub = `${ours ? 'We owe' : 'They owe'} · ${late > 0 ? `${plural(late, 'day')} late` : c.dueDate ? `by ${fmtDateShort(c.dueDate, true)}` : since || 'no date'}`;
      return `<div class="rk-promise"><span class="rk-k sm t-${ours ? 'red' : 'amber'}" aria-hidden="true">${ours ? '⚑' : '⚐'}</span>
        <span class="rk-row-main"><span class="rk-promise-t">${escHtml(c.text)}</span><span class="rk-row-s t-${ours ? 'red' : 'amber'}">${escHtml(sub)}</span></span>
        <button class="rk-link rk-linkbtn" onclick="meetingContextKept(${c.id})">${ours ? 'Kept' : 'Received'}</button>
      </div>`;
    }).join('')));
  }
  if (ctx.room.length) {
    const earlier = client ? earlierMeetings(m, S.meetings, sameClient, 60) : [];
    const organizer = (m.organizer || '').trim().toLowerCase();
    const l = ctx.lastTime;
    const counts = l ? [l.decisions ? `${l.decisions} decision${l.decisions === 1 ? '' : 's'}` : '', l.promises ? `${l.promises} promise${l.promises === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ') : '';
    out.push(panel('In the room', ctx.room.map((p) => {
      const contact = p.contactId != null ? S.contacts.find((c) => c.id === p.contactId) : undefined;
      const met = p.internal ? null : lastMet({ name: p.name, email: contact?.email }, earlier);
      const sub = p.internal ? ['MENA BIG', organizer && organizer.includes(p.name.toLowerCase()) ? 'organizer' : ''] : [p.role || '', met ? `last met ${fmtDateShort(met, true)}` : contact ? 'first meeting' : ''];
      const body = `${personAvatar(p.name, `pk-pav sm${p.internal ? ' is-internal' : ''}`)}<div class="rk-row-main"><div class="rk-row-t">${escHtml(p.name)}${p.decisionMaker ? ' <span class="pk-stage t-navy">Decision maker</span>' : ''}</div><div class="rk-row-s">${escHtml(sub.filter(Boolean).join(' · '))}</div></div>`;
      return p.contactId != null
        ? `<div class="rk-person" onclick="openRecord('contact', ${p.contactId})" role="button" tabindex="0" onkeydown="if(event.key==='Enter')this.click()">${body}</div>`
        : `<div class="rk-person is-plain">${body}</div>`;
    }).join('') + (l ? `<div class="rk-last"><div class="rec-eyebrow">Last time · ${escHtml(l.date ? fmtDateShort(l.date, true) : '')}</div>
        <p class="md-ctx-text">${recordLink('meeting', l.id, l.title)}${counts ? ` · ${counts}` : ''}${l.excerpt ? ` — ${escHtml(l.excerpt)}` : ''}</p>
        ${l.stillOwed.map((c) => `<p class="md-ctx-text">${escHtml(c.text)} — <span class="md-ctx-owed">still owed</span></p>`).join('')}</div>` : '')));
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
