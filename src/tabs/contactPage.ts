// Contact page: one person — how to reach them, which company and lists
// they're in, and everything they're part of: opportunities, meetings they
// attended, emails with them, tasks and notes that mention them, and activity.

import { S } from '../lib/state';
import { escHtml, expose, fmtDate, fmtDateFromIso, strColor } from '../lib/utils';
import { icon } from '../lib/icons';
import { companyLink, recordLink } from '../lib/links';
import { emptyState, toast, undoToast } from '../lib/ui';
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

/** Latest date we know we were in touch: a meeting, an email or logged activity. */
function lastInteraction(meetings: string[], emails: EmailRecord[], activity: string[]): string | null {
  const dates = [...meetings, ...emails.map((e) => e.receivedAt || ''), ...activity].filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

export function renderContactPage(): void {
  const c = currentContact();
  if (!c) return;
  const name = c.name || 'Unnamed contact';
  const avatar = document.getElementById('ctd-avatar');
  if (avatar) {
    avatar.textContent = name.split(/\s+/).slice(0, 2).map((x) => x[0] || '').join('').toUpperCase();
    avatar.style.background = strColor(name);
  }
  const nameEl = document.getElementById('ctd-name'); if (nameEl) nameEl.textContent = name;
  renderHeaderMeta(c, null);

  const actions = document.getElementById('ctd-actions');
  if (actions) {
    const wa = c.whatsapp || c.phone;
    actions.innerHTML = [
      c.email ? `<button class="btn-secondary ctd-action" onclick="openExternalUrl('mailto:${escHtml(c.email)}')">${icon('mail', 14)} Email</button>` : '',
      c.phone ? `<button class="btn-secondary ctd-action" onclick="openExternalUrl('tel:${escHtml(c.phone.replace(/[^+0-9]/g, ''))}')">Call</button>` : '',
      wa ? `<button class="btn-secondary ctd-action ctd-wa" onclick="openExternalUrl('https://wa.me/${escHtml(wa.replace(/[^0-9]/g, ''))}')">WhatsApp</button>` : '',
      `<button class="loc-nav rec-more" onclick="contactMoreMenu(event)" title="More" aria-label="More">${icon('more', 16)}</button>`,
    ].join('');
  }

  renderContactProps(c);
  renderContactLists(c);
  void renderContactRelations(c);
}

function renderHeaderMeta(c: Contact, last: string | null): void {
  const meta = document.getElementById('ctd-meta');
  if (!meta) return;
  meta.innerHTML = [
    c.role ? `<span class="rec-meta">${escHtml(c.role)}</span>` : '',
    c.clientName ? `<span class="rec-meta">${icon('building', 12)} ${companyLink(c.companyId, c.clientName)}</span>` : '',
    ...(c.lists || []).map((l) => `<span class="rec-badge">${escHtml(l)}</span>`),
    last ? `<span class="rec-meta">Last in touch ${fmtDateFromIso(last) || fmtDate(last)}</span>` : '',
  ].filter(Boolean).join('');
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

function renderContactProps(c: Contact): void {
  const el = document.getElementById('ctd-props');
  if (!el) return;
  el.innerHTML = FIELDS.map((f) => {
    const value = (c[f.key] as string | null) || '';
    const copy = value && (f.key === 'email' || f.key === 'phone' || f.key === 'whatsapp')
      ? `<button class="rec-icon-btn ctd-copy" onclick="copyText('${escHtml(value)}','${f.label} copied')" title="Copy ${f.label.toLowerCase()}" aria-label="Copy ${f.label.toLowerCase()}">${icon('copy', 13)}</button>` : '';
    return `<dt>${f.label}</dt><dd class="ctd-field"><input class="td-input" id="ctd-f-${f.key}" type="${f.type || 'text'}" value="${escHtml(value)}" placeholder="${f.placeholder}" onchange="contactFieldChanged('${f.key}', this.value)" onkeydown="if(event.key==='Enter')this.blur()">${copy}</dd>`;
  }).join('');
  const company = document.getElementById('ctd-f-clientName') as HTMLInputElement | null;
  if (company) attachCompanySelector(company, { onSelect: (name) => contactFieldChanged('clientName', name) });
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
  renderHeaderMeta(c, null);
}
expose('toggleContactList', toggleContactList);

export function contactMoreMenu(e: MouseEvent): void {
  e.stopPropagation();
  const c = currentContact();
  if (!c) return;
  showMenuAt(e.currentTarget as HTMLElement, [
    ...(c.email ? [{ label: 'Copy email', iconName: 'copy', run: () => w.copyText(c.email, 'Email copied') }] : []),
    ...(c.phone ? [{ label: 'Copy phone', iconName: 'copy', run: () => w.copyText(c.phone, 'Phone copied') }] : []),
    { label: 'Copy details', iconName: 'copy', run: () => w.copyText([c.name, c.role, c.clientName, c.email, c.phone].filter(Boolean).join('\n'), 'Contact details copied') },
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
  const name = (c.name || '').trim();
  const lowerName = name.toLowerCase();

  // Meetings they attended: by email address from Outlook, or by name.
  const meetings = S.meetings.filter((m) =>
    (email && ((m.attendeeEmails || []).some((a) => a.toLowerCase() === email) || (m.organizerEmail || '').toLowerCase() === email))
    || (lowerName.length > 3 && (m.attendees || []).some((a) => a.toLowerCase().includes(lowerName))))
    .sort((a, b) => (b.meetingDate || '').localeCompare(a.meetingDate || ''));
  setCount('ctd-meetings-count', meetings.length);
  setHtml('ctd-meetings', meetings.length
    ? meetings.map((m) => `<div class="rec-row" onclick="openRecord('meeting', ${m.id})"><span class="rec-row-icon">${icon('meeting', 15)}</span><div class="rec-row-main"><div class="rec-row-title">${recordLink('meeting', m.id, m.title)}</div><div class="rec-row-sub">${escHtml([m.meetingDate ? fmtDate(m.meetingDate) : '', m.companyName].filter(Boolean).join(' · '))}</div></div></div>`).join('')
    : emptyState({ icon: 'meeting', title: 'No meetings found', body: 'Meetings synced from Outlook with this person attending show up here.', compact: true }));

  // Mentioned in tasks and notes.
  const mentions = lowerName.length > 3 ? [
    ...S.todos.filter((t) => `${t.title} ${t.description || ''}`.toLowerCase().includes(lowerName)).map((t) => ({ kind: 'task' as const, id: t.id, title: t.title, sub: t.status === 'Done' ? 'Task · done' : `Task${t.dueDate ? ` · due ${fmtDate(t.dueDate)}` : ''}` })),
    ...S.notes.filter((n) => `${n.title || ''} ${n.content || ''}`.toLowerCase().includes(lowerName)).map((n) => ({ kind: 'note' as const, id: n.id, title: n.title || 'Untitled', sub: `Note · ${fmtDate(n.updatedAt)}` })),
  ] : [];
  setCount('ctd-mentions-count', mentions.length);
  setHtml('ctd-mentions', mentions.length
    ? mentions.map((m) => `<div class="rec-row" onclick="openRecord('${m.kind}', ${m.id})"><span class="rec-row-icon">${icon(m.kind === 'task' ? 'check' : 'note', 15)}</span><div class="rec-row-main"><div class="rec-row-title">${recordLink(m.kind, m.id, m.title)}</div><div class="rec-row-sub">${escHtml(m.sub)}</div></div></div>`).join('')
    : emptyState({ icon: 'search', title: 'Not mentioned anywhere yet', body: 'Tasks and notes that mention this person by name appear here.', compact: true }));

  const [links, emails, activity] = await Promise.all([
    getLinksFor('contact', id).catch(() => []),
    email ? ms365GetEmailsByAddress(email).catch(() => [] as EmailRecord[]) : Promise.resolve([] as EmailRecord[]),
    getActivity({ contactId: id, limit: 100 }).catch(() => []),
  ]);
  if (S.currentContactId !== id) return;

  const oppIds = new Set(links.filter((l) => l.fromType === 'contact' && l.toType === 'opportunity').map((l) => l.toId));
  const opps = S.opportunities.filter((o) => oppIds.has(o.id));
  setCount('ctd-opps-count', opps.length);
  setHtml('ctd-opps', opps.length
    ? opps.map((o) => `<div class="rec-row" onclick="openRecord('opportunity', ${o.id})"><span class="rec-row-icon">${icon('briefcase', 15)}</span><div class="rec-row-main"><div class="rec-row-title">${recordLink('opportunity', o.id, o.name)}</div><div class="rec-row-sub">${escHtml([o.stage, o.companyName].filter(Boolean).join(' · '))}</div></div></div>`).join('')
    : emptyState({ icon: 'briefcase', title: 'Not on any opportunity', body: 'Link this person from an opportunity’s Contacts section.', compact: true }));

  setCount('ctd-emails-count', emails.length);
  setHtml('ctd-emails', emails.length
    ? emails.map((e) => `<div class="rec-row"${e.webLink ? ` onclick="openExternalUrl('${escHtml(e.webLink)}')"` : ''}><span class="rec-row-icon">${icon('mail', 15)}</span><div class="rec-row-main"><div class="rec-row-title">${escHtml(e.subject || '(no subject)')}</div><div class="rec-row-sub">${escHtml([e.senderName || e.senderEmail, e.receivedAt ? fmtDateFromIso(e.receivedAt) : ''].filter(Boolean).join(' · '))}</div></div></div>`).join('')
    : emptyState({ icon: 'mail', title: email ? 'No emails with this address' : 'No email address', body: email ? 'Flagged Outlook emails from or to this person appear here.' : 'Add an email address to see their emails.', compact: true }));

  const feed = document.getElementById('ctd-activity');
  if (feed) feed.innerHTML = renderFeed(activity.map(activityItem), { empty: 'Nothing recorded yet.' });
  const current = currentContact();
  if (current) renderHeaderMeta(current, lastInteraction(meetings.map((m) => m.meetingDate || ''), emails, activity.map((a) => a.createdAt)));
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
