// Contact page: one person — how to reach them, which company and lists
// they're in, and everything they're part of: opportunities, meetings they
// attended, emails with them, tasks and notes that mention them, and activity.

import { paintFigures } from '../lib/recordFigures';
import { contactHeaderFigures, monthTrail, openWithRows } from '../lib/recordContact';
import { lastSpokeByContact, openWith } from '../lib/pagesContacts';
import { RELATIONSHIP_TONE } from '../lib/pagesCompanies';
import { tileHtml } from '../lib/pageKit';
import { setCommitmentKept } from './commitments';
import { personAvatar } from '../core/contacts';
import { initialsOf } from '../lib/appearance';
import { agreementMonthly, currencyOf, defaultReviewer, fmtMoneyByCurrency, isAgreementActive, teamMember, type MoneyByCurrency } from '../lib/commercial';
import { contextFromCompany, EMPTY_CONTEXT } from '../lib/workGraph';
import { isRunning, meetingOutcomes, placeLabel } from '../lib/meetingsList';
import { isMeetingOver } from '../lib/meetingRecap';
import { meetingExcerpt } from '../lib/meetingExcerpt';
import { fmtDateShort, fmtTime } from '../lib/dates';
import { contactNextStep } from '../lib/recordSteps';
import { endPropsEdit, mountPropsList, propsEditButton, propsListHtml, type PropField } from '../lib/propsList';
import { jsString } from './companyState';
import { S } from '../lib/state';
import { escHtml, expose, fmtDate, inCompany, strColor, today } from '../lib/utils';
import { icon } from '../lib/icons';
import { recordHeaderHtml } from '../lib/recordHeader';
import { companyLink, recordLink } from '../lib/links';
import { toast, undoToast } from '../lib/ui';
import { persistContacts } from '../lib/persist';
import { notifyNavigated, refreshCompanyViewIfOpen } from '../lib/registry';
import { getActivity, getLinksFor, ms365GetEmailsByAddress } from '../lib/db';
import { attachCompanySelector } from '../lib/companySelector';
import { showMenuAt } from '../lib/contextMenu';
import { activityItem, renderFeed } from '../lib/activityFeed';
import { renderIcons } from '../core/chrome';
import type { Contact, EmailRecord } from '../lib/types';

const w = window as any;


function currentContact(): Contact | undefined {
  return S.contacts.find((c) => c.id === S.currentContactId);
}

export function openContactPage(id: number): void {
  if (!S.contacts.some((c) => c.id === id)) return;
  const changed = S.currentContactId !== id;
  S.currentContactId = id;
  document.getElementById('ct-list-view')?.classList.add('hidden');
  document.getElementById('ct-detail')?.classList.add('open');
  if (changed) window.scrollTo(0, 0);
  renderContactPage();
  notifyNavigated();
}
expose('openContactPage', openContactPage);

export function closeContactPage(): void {
  if (S.currentContactId == null) return;
  S.currentContactId = null;
  document.getElementById('ct-detail')?.classList.remove('open');
  document.getElementById('ct-list-view')?.classList.remove('hidden');
  notifyNavigated();
  w.renderContacts?.();
}
expose('closeContactPage', closeContactPage);

export function renderContactPage(): void {
  const c = currentContact();
  if (!c) return;
  const name = c.name || 'Unnamed contact';
  const avatar = document.getElementById('ctd-avatar');
  if (avatar) {
    avatar.textContent = initialsOf(name) || '·';
    avatar.style.background = strColor(name);
  }
  const nameEl = document.getElementById('ctd-name'); if (nameEl) nameEl.textContent = name;
  renderHeaderMeta(c);
  const t = today();
  const spoke = lastSpokeByContact([c], { meetings: S.meetings, emails: S.emails, touches: S.touches, today: t }).get(c.id);
  const ref = c.clientName ? { id: c.companyId ?? null, name: c.clientName } : null;
  const mrr: MoneyByCurrency = {};
  if (ref) for (const a of S.agreements) if (inCompany(ref, a.companyId, a.client) && isAgreementActive(a, t)) { const m = agreementMonthly(a); if (m) mrr[currencyOf(a)] = (mrr[currencyOf(a)] || 0) + m; }
  paintFigures('ctd-figures', contactHeaderFigures({
    today: t, last: spoke, commitments: S.commitments.filter((x) => x.contactId === c.id),
    meetingDates: meetingsWith(c).map((m) => (m.meetingDate || '').slice(0, 10)).filter(Boolean),
    companyMonthly: Object.keys(mrr).length ? fmtMoneyByCurrency(mrr) : '',
  }));

  const actions = document.getElementById('ctd-actions');
  if (actions) {
    // Email is the next step; a template email is beside it; Call and WhatsApp are in "…".
    const step = contactNextStep(c);
    const template = c.clientName ? { label: 'Template', run: `openRecord('company', ${c.companyId ?? 'null'});setTimeout(() => openCompanyTemplates(), 300)` } : null;
    actions.innerHTML = recordHeaderHtml(c.companyId != null ? [template] : [], step, 'contactMoreMenu(event)');
  }

  renderContactProps(c);
  renderContactLists(c);
  renderContactOpen(c);
  renderContactAlso(c);
  void renderContactRelations(c);
}

/** Meetings this person was in: by email address from Outlook, or by name. */
function meetingsWith(c: Contact) {
  const email = (c.email || '').toLowerCase();
  const lowerName = (c.name || '').trim().toLowerCase();
  return S.meetings.filter((m) =>
    (email && ((m.attendeeEmails || []).some((a) => a.toLowerCase() === email) || (m.organizerEmail || '').toLowerCase() === email))
    || (lowerName.length > 3 && (m.attendees || []).some((a) => a.toLowerCase().includes(lowerName))))
    .sort((a, b) => (b.startAt || b.meetingDate || '').localeCompare(a.startAt || a.meetingDate || ''));
}

/** One line: the Decision maker chip, "role at [company tile] Company", the relationship, the email in mono. */
function renderHeaderMeta(c: Contact): void {
  const meta = document.getElementById('ctd-meta');
  if (!meta) return;
  const rel = c.clientName ? (w.companyRelationship?.(c.clientName) as { label: string } | undefined) : undefined;
  meta.innerHTML = [
    c.isDecisionMaker ? '<span class="pk-stage t-navy">Decision maker</span>' : '',
    c.clientName ? `<span class="rec-meta">${c.role ? `${escHtml(c.role)} at` : 'At'}</span><span class="pk-mini-co">${tileHtml(c.clientName, 'pk-tile mini')}${companyLink(c.companyId, c.clientName)}</span>` : c.role ? `<span class="rec-meta">${escHtml(c.role)}</span>` : '',
    rel ? `<span class="pk-stage t-${RELATIONSHIP_TONE[rel.label] || 'grey'}"><i></i>${escHtml(rel.label)}</span>` : '',
    c.email ? `<span class="rec-meta mono">${escHtml(c.email)}</span>` : '',
  ].filter(Boolean).join('');
}

/** What is open with them: promises either way and the proposals they are the contact on. */
function renderContactOpen(c: Contact): void {
  const sec = document.getElementById('ctd-open-sec');
  const el = document.getElementById('ctd-open');
  if (!sec || !el) return;
  const rows = openWithRows(c, { today: today(), commitments: S.commitments, proposals: S.proposals, reviewer: (p) => teamMember(p.reviewerId)?.name || defaultReviewer()?.name || 'the reviewer' });
  sec.hidden = !rows.length;
  const h = document.getElementById('ctd-open-h'); if (h) h.textContent = `Open with ${(c.name || 'them').trim().split(/\s+/)[0]}`;
  const cnt = document.getElementById('ctd-open-count'); if (cnt) cnt.textContent = rows.length ? String(rows.length) : '';
  el.innerHTML = rows.map((r) => `<div class="rk-row rk-row-3">
    <span class="rk-k t-${r.glyphTone}" aria-hidden="true">${r.glyph}</span>
    <div class="rk-row-main"><div class="rk-row-t">${r.kind === 'proposal' ? recordLink('proposal', r.id, r.title) : escHtml(r.title)}</div><div class="rk-row-s">${escHtml(r.sub)}</div></div>
    <span class="pk-age-sm t-${r.tone}">${escHtml(r.age)}</span>
    <button class="btn-secondary btn-sm" onclick="${r.action.kind === 'mark_kept' ? `contactMarkKept(${r.id})` : `openRecord('proposal', ${r.id})`}">${escHtml(r.action.label)}</button>
  </div>`).join('');
}

export function contactMarkKept(id: number): void {
  setCommitmentKept(id, true);
  if (currentContact()) renderContactPage();
}
expose('contactMarkKept', contactMarkKept);

/** A meeting with this person, at their company. */
export function contactNewMeeting(): void {
  const c = currentContact();
  if (!c) return;
  const co = c.companyId != null ? S.companies.find((x) => x.id === c.companyId) : undefined;
  w.openMeetingModal?.(null, co ? contextFromCompany(co) : { ...EMPTY_CONTEXT, companyName: c.clientName || null });
}
expose('contactNewMeeting', contactNewMeeting);

/** The other people at their company, with what is open with each. */
function renderContactAlso(c: Contact): void {
  const el = document.getElementById('ctd-also');
  if (!el) return;
  const others = c.clientName ? S.contacts.filter((x) => x.id !== c.id && (c.companyId != null ? x.companyId === c.companyId : x.clientName === c.clientName)) : [];
  el.hidden = !others.length;
  if (!others.length) { el.innerHTML = ''; return; }
  const t = today();
  el.innerHTML = `<div class="rec-section-hd"><h2 class="rk-panel-h">Also at ${escHtml(c.clientName || '')}</h2></div>${others.slice(0, 6).map((x) => {
    const open = openWith(x, { commitments: S.commitments, proposals: S.proposals, today: t })[0];
    return `<div class="rk-person" onclick="openRecord('contact', ${x.id})" role="button" tabindex="0" onkeydown="if(event.key==='Enter')this.click()">${personAvatar(x.name || '', 'pk-pav sm')}<div class="rk-row-main"><div class="rk-row-t">${escHtml(x.name || 'Unnamed')}${x.isDecisionMaker ? ' <span class="pk-stage t-navy">Decision maker</span>' : ''}</div><div class="rk-row-s">${escHtml([x.role || '', open ? open.text.charAt(0).toLowerCase() + open.text.slice(1) : ''].filter(Boolean).join(' · ') || 'No details yet')}</div></div></div>`;
  }).join('')}`;
}

const FIELDS: { key: keyof Contact; label: string; type?: string; placeholder: string }[] = [
  { key: 'name', label: 'Name', placeholder: 'Full name' },
  { key: 'role', label: 'Role', placeholder: 'e.g. HR Director' },
  { key: 'clientName', label: 'Company', placeholder: 'Company' },
  { key: 'email', label: 'Email', type: 'email', placeholder: 'name@company.com' },
  { key: 'phone', label: 'Phone', type: 'tel', placeholder: '+966…' },
  { key: 'whatsapp', label: 'WhatsApp', type: 'tel', placeholder: 'Same as phone' },
  { key: 'service', label: 'Service', placeholder: 'Service they look after' },
];

/** Details, read first (lib/propsList.ts); email and phone read as links, copy on hover. */
function renderContactProps(c: Contact): void {
  const el = document.getElementById('ctd-props');
  if (!el) return;
  const fields: PropField[] = FIELDS.map((f) => {
    const value = (c[f.key] as string | null) || '';
    const copy = value && (f.key === 'email' || f.key === 'phone' || f.key === 'whatsapp')
      ? `<button class="rec-icon-btn ctd-copy" onclick="copyText('${jsString(value)}','${f.label} copied')" data-tip="Copy ${f.label.toLowerCase()}" aria-label="Copy ${f.label.toLowerCase()}">${icon('copy', 13)}</button>` : '';
    const display = !value ? ''
      : f.key === 'clientName' ? companyLink(c.companyId, value)
      : f.key === 'email' ? `<a href="#" class="rlink" onclick="event.preventDefault();openExternalUrl('mailto:${escHtml(value)}')">${escHtml(value)}</a>${copy}`
      : `${escHtml(value)}${copy}`;
    return {
      key: String(f.key), label: f.label, display, always: f.key === 'name' || f.key === 'clientName',
      control: () => `<input class="td-input" id="ctd-f-${f.key}" type="${f.type || 'text'}" value="${escHtml(value)}" placeholder="${f.placeholder}" onchange="contactFieldChanged('${f.key}', this.value)" onkeydown="if(event.key==='Enter')this.blur()">`,
      mount: f.key === 'clientName' ? (dd: HTMLElement) => { const i = dd.querySelector<HTMLInputElement>('input'); if (i) attachCompanySelector(i, { onSelect: (name) => { endPropsEdit(); contactFieldChanged('clientName', name); } }); } : undefined,
    };
  });
  el.innerHTML = propsListHtml('ctd-props', fields, () => { const cur = currentContact(); if (cur) renderContactProps(cur); });
  const act = document.getElementById('ctd-props-act'); if (act) act.innerHTML = propsEditButton('ctd-props');
  mountPropsList('ctd-props');
}

export function contactFieldChanged(key: keyof Contact, value: string): void {
  const c = currentContact();
  if (!c) return;
  const v = value.trim();
  if (key === 'name' && !v) { toast('A contact needs a name', { tone: 'error' }); renderContactProps(c); return; }
  if ((c[key] || '') === v) return;
  (c as any)[key] = v || null;
  persistContacts();
  const state = document.getElementById('ctd-save-state');
  if (state) { state.textContent = 'Saved'; window.setTimeout(() => { if (state.textContent === 'Saved') state.textContent = ''; }, 1500); }
  renderContactPage();
  refreshCompanyViewIfOpen();
}
expose('contactFieldChanged', contactFieldChanged);

function renderContactLists(c: Contact): void {
  const el = document.getElementById('ctd-lists');
  if (!el) return;
  if (!S.contactLists.length) {
    el.innerHTML = `<div class="rec-muted">No lists yet. <a href="#" class="rec-add-link" onclick="event.preventDefault();openCtListsModal()">Create one</a></div>`;
    return;
  }
  el.innerHTML = S.contactLists.map((l) => {
    const on = (c.lists || []).includes(l);
    return `<button class="ctd-list-chip${on ? ' on' : ''}" onclick="toggleContactList('${escHtml(l).replace(/'/g, "\\'")}')" aria-pressed="${on}">${on ? icon('check', 11) : icon('plus', 11)}${escHtml(l)}</button>`;
  }).join('');
}

export function toggleContactList(list: string): void {
  const c = currentContact();
  if (!c) return;
  const lists = new Set(c.lists || []);
  if (lists.has(list)) lists.delete(list); else lists.add(list);
  c.lists = [...lists];
  persistContacts();
  renderContactLists(c);
  renderHeaderMeta(c);
}
expose('toggleContactList', toggleContactList);

export function contactMoreMenu(e: MouseEvent): void {
  e.stopPropagation();
  const c = currentContact();
  if (!c) return;
  const wa = c.whatsapp || c.phone;
  showMenuAt(e.currentTarget as HTMLElement, [
    ...(c.phone ? [{ label: 'Call', run: () => w.openExternalUrl(`tel:${c.phone!.replace(/[^+0-9]/g, '')}`) }] : []),
    ...(wa ? [{ label: 'WhatsApp', run: () => w.openExternalUrl(`https://wa.me/${wa.replace(/[^0-9]/g, '')}`) }] : []),
    ...(c.phone || wa ? [{ label: '', run: () => {}, separator: true }] : []),
    ...(c.email ? [{ label: 'Copy email', iconName: 'copy', run: () => w.copyText(c.email, 'Email copied') }] : []),
    ...(c.phone ? [{ label: 'Copy phone', iconName: 'copy', run: () => w.copyText(c.phone, 'Phone copied') }] : []),
    { label: 'Copy details', iconName: 'copy', run: () => w.copyText([c.name, c.role, c.clientName, c.email, c.phone].filter(Boolean).join('\n'), 'Contact details copied') },
    { label: '', run: () => {}, separator: true },
    { label: c.isDecisionMaker ? 'Not a decision maker' : 'Mark as decision maker', iconName: 'check', run: () => w.toggleDecisionMaker(c.id) },
    { label: '', run: () => {}, separator: true },
    { label: 'Delete contact', iconName: 'trash', danger: true, run: () => deleteContactWithUndo(c.id) },
  ]);
}
expose('contactMoreMenu', contactMoreMenu);

export function deleteContactWithUndo(id: number): void {
  const index = S.contacts.findIndex((c) => c.id === id);
  if (index < 0) return;
  const [removed] = S.contacts.splice(index, 1);
  persistContacts();
  if (S.currentContactId === id) closeContactPage();
  w.renderContacts?.();
  refreshCompanyViewIfOpen();
  undoToast(`Deleted ${removed.name || 'contact'}`, () => {
    S.contacts.splice(Math.min(index, S.contacts.length), 0, removed);
    persistContacts();
    w.renderContacts?.();
    refreshCompanyViewIfOpen();
  });
}
expose('deleteContactWithUndo', deleteContactWithUndo);

async function renderContactRelations(c: Contact): Promise<void> {
  const id = c.id;
  const email = (c.email || '').toLowerCase();
  // A section with nothing in it and nothing to do isn't shown (Focus).
  const showSection = (listId: string, on: boolean) => { const sec = document.getElementById(listId)?.closest('section'); if (sec) sec.hidden = !on; };
  const name = (c.name || '').trim();
  const lowerName = name.toLowerCase();

  // Meetings they attended, with what came out of each.
  const meetings = meetingsWith(c);
  const now = new Date();
  const t = today();
  setCount('ctd-meetings-count', meetings.length);
  setHtml('ctd-meetings', meetings.length
    ? meetings.slice(0, 8).map((m) => {
      const running = isRunning(m, now);
      const over = isMeetingOver(m, now, t) && !running;
      const tasks = S.todos.filter((x) => x.meetingId === m.id && x.parentId == null);
      const o = over ? meetingOutcomes(m, S.commitments, tasks, over) : null;
      const chips = o ? [o.decisions ? `<span>${o.decisions} ${o.decisions === 1 ? 'decision' : 'decisions'}</span>` : '', o.promisesMade ? `<span>${o.promisesMade} ${o.promisesMade === 1 ? 'promise' : 'promises'}</span>` : '', o.writtenUp ? '<span class="g">Written up</span>' : o.needsWriteUp ? '<span class="a">Not written up</span>' : ''].join('') : running ? '<span>Notes open</span>' : '';
      const when = [m.meetingDate === t ? `Today${m.startAt ? ` ${fmtTime(m.startAt)}` : ''}` : m.meetingDate ? fmtDateShort(m.meetingDate, true) : '', placeLabel(m) || ''].filter(Boolean).join(' · ');
      const noted = over ? meetingExcerpt(m) : null;
      const act = running && m.onlineMeetingUrl ? `<a class="btn-secondary btn-sm" href="${escHtml(m.onlineMeetingUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Join</a>` : '';
      return `<div class="rk-row rk-row-3 rec-row" onclick="if(!event.target.closest('a,button'))openRecord('meeting', ${m.id})"><span class="rk-k t-blue" aria-hidden="true">◉</span><div class="rk-row-main"><div class="rk-row-t">${recordLink('meeting', m.id, m.title)}</div><div class="rk-row-s">${escHtml(when)}${noted ? ` · “${escHtml(noted)}”` : ''}</div></div><div class="pk-mout">${chips}</div>${act || '<span></span>'}</div>`;
    }).join('')
    : '<p class="co-nr-none">No meetings with them yet.</p>');

  // Mentioned in tasks and notes.
  const mentions = lowerName.length > 3 ? [
    ...S.todos.filter((t) => `${t.title} ${t.description || ''}`.toLowerCase().includes(lowerName)).map((t) => ({ kind: 'task' as const, id: t.id, title: t.title, sub: t.status === 'Done' ? 'Task · done' : `Task${t.dueDate ? ` · due ${fmtDate(t.dueDate)}` : ''}` })),
    ...S.notes.filter((n) => `${n.title || ''} ${n.content || ''}`.toLowerCase().includes(lowerName)).map((n) => ({ kind: 'note' as const, id: n.id, title: n.title || 'Untitled', sub: `Note · ${fmtDate(n.updatedAt)}` })),
  ] : [];
  setCount('ctd-mentions-count', mentions.length);
  showSection('ctd-mentions', mentions.length > 0);
  setHtml('ctd-mentions', mentions.length
    ? mentions.map((m) => `<div class="rec-row" onclick="openRecord('${m.kind}', ${m.id})"><span class="rec-row-icon">${icon(m.kind === 'task' ? 'check' : 'note', 15)}</span><div class="rec-row-main"><div class="rec-row-title">${recordLink(m.kind, m.id, m.title)}</div><div class="rec-row-sub">${escHtml(m.sub)}</div></div></div>`).join('')
    : '');

  const [links, emails, activity] = await Promise.all([
    getLinksFor('contact', id).catch(() => []),
    email ? ms365GetEmailsByAddress(email).catch(() => [] as EmailRecord[]) : Promise.resolve([] as EmailRecord[]),
    getActivity({ contactId: id, limit: 100 }).catch(() => []),
  ]);
  if (S.currentContactId !== id) return;

  const oppIds = new Set(links.filter((l) => l.fromType === 'contact' && l.toType === 'opportunity').map((l) => l.toId));
  const opps = S.opportunities.filter((o) => oppIds.has(o.id));
  setCount('ctd-opps-count', opps.length);
  showSection('ctd-opps', opps.length > 0);
  setHtml('ctd-opps', opps.length
    ? opps.map((o) => `<div class="rec-row" onclick="openRecord('opportunity', ${o.id})"><span class="rec-row-icon">${icon('briefcase', 15)}</span><div class="rec-row-main"><div class="rec-row-title">${recordLink('opportunity', o.id, o.name)}</div><div class="rec-row-sub">${escHtml([o.stage, o.companyName].filter(Boolean).join(' · '))}</div></div></div>`).join('')
    : '');

  setCount('ctd-emails-count', emails.length);
  showSection('ctd-emails', emails.length > 0);
  setHtml('ctd-emails', emails.length
    ? emails.slice(0, 8).map((e) => `<div class="rk-row rk-row-3"><span class="rk-k t-blue" aria-hidden="true">✉</span><div class="rk-row-main"><div class="rk-row-t">${escHtml(e.subject || '(no subject)')}</div><div class="rk-row-s">${escHtml([`From ${(e.senderName || e.senderEmail || '').split(' ')[0]}`, e.flagStatus === 'flagged' ? 'flagged' : ''].filter(Boolean).join(' · '))}</div></div><span class="mono t-sub">${e.receivedAt ? escHtml(fmtDateShort(e.receivedAt.slice(0, 10), true)) : ''}</span>${e.webLink ? `<a href="#" class="rlink rk-link" onclick="event.preventDefault();openExternalUrl('${escHtml(e.webLink)}')">Open in Outlook</a>` : '<span></span>'}</div>`).join('')
    : '');

  // The trail: meetings, emails, calls and notes that mention them, over the last months.
  const tr = monthTrail({ today: t, meetings, emails, touches: S.touches.filter((x) => x.contactId === id), notes: lowerName.length > 3 ? S.notes.filter((n) => `${n.title || ''} ${n.content || ''}`.toLowerCase().includes(lowerName)) : [] });
  const trailSec = document.getElementById('ctd-trail-sec');
  if (trailSec) trailSec.hidden = !tr.events.length;
  const since = document.getElementById('ctd-trail-since'); if (since) since.textContent = tr.since ? `since ${tr.since}` : '';
  const legend = document.getElementById('ctd-trail-legend');
  if (legend) legend.textContent = ([['meeting', 'meetings'], ['email', 'emails'], ['call', 'calls'], ['note', 'notes']] as const).filter(([k]) => tr.counts[k]).map(([, l]) => l).join(' · ');
  const GLYPH = { meeting: '◉', email: '✉', note: '✎', call: '☎' } as const;
  setHtml('ctd-trail', tr.events.length ? `<span class="rk-ct-ax"></span>${tr.months.map((m) => `<span class="rk-ct-m" style="left:${m.pos}%">${m.label}</span>`).join('')}${tr.events.map((e) => `<span class="rk-ev is-${e.kind}${e.today ? ' is-today' : ''}${e.pos > 88 ? ' at-end' : e.pos < 10 ? ' at-start' : ''}" style="left:${e.pos}%"${e.record ? ` role="button" tabindex="0" onclick="openRecord('${e.record.kind}', ${e.record.id})" onkeydown="if(event.key==='Enter')this.click()"` : ''} data-tip="${escHtml(`${e.label} · ${e.today ? 'today' : fmtDateShort(e.date, true)}`)}">${e.showLabel ? `<span>${escHtml(e.label)}${e.today ? ' · today' : ''}</span>` : ''}<i aria-hidden="true">${GLYPH[e.kind]}</i></span>`).join('')}` : '');

  const feed = document.getElementById('ctd-activity');
  if (feed) feed.innerHTML = renderFeed(activity.map(activityItem), { empty: 'Nothing recorded yet.' });
  const page = document.getElementById('ct-detail');
  if (page) renderIcons(page);
}

function setCount(id: string, n: number): void {
  const el = document.getElementById(id);
  if (el) el.textContent = n ? String(n) : '';
}

function setHtml(id: string, html: string): void {
  const el = document.getElementById(id);
  if (el) { el.innerHTML = html; renderIcons(el); }
}

expose('renderContactPage', renderContactPage);
