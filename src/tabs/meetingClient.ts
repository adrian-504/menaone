// Meetings linked to clients: suggestions from attendee email addresses,
// automatic links when a known contact attends, attendees to add as
// contacts, and a client brief with a suggested agenda built from fixed
// rules. Also fills company websites from their contacts' email domains.

import { S } from '../lib/state';
import { escHtml, expose, fmtDate, today, nextCtId, inCompany, daysSince, daysUntil, showConfirm } from '../lib/utils';
import { icon } from '../lib/icons';
import { companyLink, recordLink } from '../lib/links';
import { emptyState, toast } from '../lib/ui';
import { persistMeeting, persistContacts, persistCreateCompany } from '../lib/persist';
import { getAppMeta, setAppMeta, saveCompany } from '../lib/db';
import { refreshCompanyViewIfOpen } from '../lib/registry';
import { renderIcons } from '../core/chrome';
import { PERSONAL_DOMAINS, automaticMeetingLink, domainIndex, emailDomain, meetingEmails, meetingPeople, suggestedContacts, suggestMeetingCompanies, suggestWebsites, type MeetingLinkSuggestion, type MeetingPerson } from '../lib/clientMatch';
import { PS, isAgreementActive, isOpenProposal, lineTotals, agreementMonthly, fmtMoney, currencyOf } from '../lib/commercial';
import type { Company, Meeting } from '../lib/types';

const w = window as any;

// ── Settings kept in app_meta ──

export async function loadClientMatchSettings(): Promise<void> {
  const parse = <T,>(raw: string | null, fallback: T): T => { try { return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };
  const [domains, dismissed, own] = await Promise.all([getAppMeta('company_domains'), getAppMeta('dismissed_meeting_links'), getAppMeta('own_domains')]).catch(() => [null, null, null]);
  S.companyDomains = parse(domains, {});
  S.dismissedMeetingLinks = parse(dismissed, []);
  S.ownDomains = parse(own, []);
}

const saveDomains = () => setAppMeta('company_domains', JSON.stringify(S.companyDomains)).catch(() => undefined);
const saveDismissed = () => setAppMeta('dismissed_meeting_links', JSON.stringify(S.dismissedMeetingLinks)).catch(() => undefined);

function replaceMeeting(saved: Meeting | undefined): void {
  if (!saved) return;
  const i = S.meetings.findIndex((m) => m.id === saved.id);
  if (i > -1) S.meetings[i] = saved;
}

/** Links meetings where a known contact from exactly one company attends. */
export async function autoLinkMeetings(): Promise<number> {
  const index = domainIndex();
  let linked = 0;
  for (const m of S.meetings) {
    const s = automaticMeetingLink(m, index);
    if (!s) continue;
    m.companyName = s.company.name;
    if (m.opportunityId == null && s.opportunity) m.opportunityId = s.opportunity.id;
    replaceMeeting(await persistMeeting(m));
    linked++;
  }
  if (linked) {
    toast(`Linked ${linked} meeting${linked === 1 ? '' : 's'} to clients by attendee email`, { action: { label: 'Review', run: () => w.navToModule('meetings') } });
    refreshCompanyViewIfOpen();
  }
  return linked;
}
expose('autoLinkMeetings', autoLinkMeetings);

export async function confirmMeetingLink(meetingId: number, companyId: number, withOpportunity: boolean): Promise<void> {
  const m = S.meetings.find((x) => x.id === meetingId);
  const company = S.companies.find((c) => c.id === companyId);
  if (!m || !company) return;
  const suggestion = suggestMeetingCompanies(m).find((s) => s.company.id === companyId);
  m.companyName = company.name;
  if (withOpportunity && suggestion?.opportunity && m.opportunityId == null) m.opportunityId = suggestion.opportunity.id;
  // Remember the attendee domains for next time.
  for (const email of meetingEmails(m)) {
    const d = emailDomain(email);
    if (d && suggestion?.reasons.some((r) => r.includes(`@${d}`)) && S.companyDomains[d] == null) S.companyDomains[d] = companyId;
  }
  void saveDomains();
  replaceMeeting(await persistMeeting(m));
  toast(`Linked to ${company.name}`, { tone: 'success' });
  refreshCompanyViewIfOpen();
  rerender(meetingId);
}
expose('confirmMeetingLink', confirmMeetingLink);

export function dismissMeetingLink(meetingId: number): void {
  if (!S.dismissedMeetingLinks.includes(meetingId)) S.dismissedMeetingLinks.push(meetingId);
  void saveDismissed();
  rerender(meetingId);
}
expose('dismissMeetingLink', dismissMeetingLink);

function rerender(meetingId: number): void {
  if (S.meetingEditId === meetingId && document.getElementById('meeting-detail')?.classList.contains('open')) w.openMeetingDetail?.(meetingId);
  else w.renderMeetingsTab?.();
}

// ── Meeting page: client section ──

function reasonsHtml(s: MeetingLinkSuggestion): string {
  return s.reasons.slice(0, 2).map(escHtml).join(' · ');
}

export function renderMeetingClientSection(m: Meeting): void {
  const el = document.getElementById('md-client');
  if (!el) return;
  const company = m.companyId != null ? S.companies.find((c) => c.id === m.companyId) : S.companies.find((c) => c.name.toLowerCase() === (m.companyName || '').trim().toLowerCase());
  if (!company) {
    const suggestions = S.dismissedMeetingLinks.includes(m.id) ? [] : suggestMeetingCompanies(m).slice(0, 3);
    el.innerHTML = `<div class="rec-section-hd"><h2>Client</h2></div>` + (suggestions.length
      ? `<p class="md-client-lead">This meeting looks like it's with:</p><div class="rec-list">${suggestions.map((s) => `<div class="rec-row md-suggest">
          <span class="rec-row-icon">${icon('building', 15)}</span>
          <div class="rec-row-main"><div class="rec-row-title">${escHtml(s.company.name)} ${s.confidence === 'high' ? '<span class="rec-badge tone-green">Likely</span>' : '<span class="rec-badge">Possible</span>'}</div><div class="rec-row-sub">${reasonsHtml(s)}${s.opportunity ? ` · open opportunity: ${escHtml(s.opportunity.name)}` : ''}</div></div>
          <div class="rec-row-end"><button class="btn-secondary btn-sm" onclick="confirmMeetingLink(${m.id}, ${s.company.id}, true)">Link</button></div>
        </div>`).join('')}</div>
        <div class="btn-row md-client-actions"><button class="btn-secondary btn-sm" onclick="dismissMeetingLink(${m.id})">None of these</button></div>`
      : emptyState({ icon: 'building', title: meetingEmails(m).length ? 'No client matched the attendees' : 'No attendee emails', body: meetingPeople(m).some((p) => p.status === 'new' && p.guess) ? 'Add the people below as contacts — the meeting links to their company, and future meetings link by themselves.' : 'Pick the client above, or add attendees\' email addresses to their contacts so future meetings link by themselves.', compact: true }));
    renderIcons(el);
    renderMeetingPeople(m);
    return;
  }
  el.innerHTML = `<div class="rec-section-hd"><h2>Client brief</h2><span class="rec-count">${companyLink(company.id, company.name)}</span>
    <div class="rec-section-actions"><button class="btn-secondary btn-sm" onclick="addSuggestedAgenda(${m.id})">${icon('plus', 12)} Add suggested agenda</button></div></div>
    ${briefHtml(m, company)}`;
  renderIcons(el);
  renderMeetingPeople(m);
}
expose('renderMeetingClientSection', renderMeetingClientSection);

interface Brief { lines: string[]; agenda: string[] }

function buildBrief(m: Meeting, company: Company): Brief {
  const ref = { id: company.id, name: company.name };
  const lines: string[] = [];
  const agenda: string[] = [];
  const date = m.meetingDate || today();

  const previous = S.meetings
    .filter((x) => x.id !== m.id && !x.isCancelled && inCompany(ref, x.companyId, x.companyName) && (x.meetingDate || '') < date)
    .sort((a, b) => (b.meetingDate || '').localeCompare(a.meetingDate || ''))[0];
  if (previous) {
    // The last meetings themselves are in "Earlier with …" beside the page.
    if (previous.followUp?.trim()) agenda.push(`Follow up from ${fmtDate(previous.meetingDate)}: ${previous.followUp.trim().split('\n')[0]}`);
    const prevTasks = S.todos.filter((t) => t.meetingId === previous.id && t.status !== 'Done');
    if (prevTasks.length) agenda.push(`Open actions from last meeting: ${prevTasks.slice(0, 3).map((t) => t.title).join('; ')}`);
  }

  const proposals = S.proposals.filter((p) => !p.archived && inCompany(ref, p.companyId, p.client) && isOpenProposal(p));
  for (const p of proposals.slice(0, 3)) {
    const services = lineTotals(p.lines, p.contractMonths).serviceNames.join(', ') || p.type || 'Proposal';
    const sent = p.dateSentToClient || p.sentDate;
    lines.push(`<div class="md-brief-row">${icon('database', 13)}<div><strong>Proposal</strong> ${recordLink('proposal', p.id, `${services} (SL# ${p.id})`)} · ${escHtml(p.status)}${sent && p.status === PS.SENT ? ` · sent ${daysSince(sent)} days ago` : ''}</div></div>`);
    if (p.status === PS.SENT) agenda.push(`Proposal for ${services}: sent ${sent ? `${daysSince(sent)} days ago` : 'earlier'} — agree next steps or a decision`);
    else if (p.status === PS.CLIENT_SIGNED) agenda.push(`Proposal for ${services}: signed by the client — confirm countersignature and kickoff`);
    else if (p.status === PS.REQUEST || p.status === PS.DRAFTING) agenda.push(`Requirements for the ${services} proposal`);
  }

  const opps = S.opportunities.filter((o) => !o.archived && o.status === 'Open' && inCompany(ref, o.companyId, o.companyName));
  for (const o of opps.slice(0, 3)) {
    lines.push(`<div class="md-brief-row">${icon('target', 13)}<div><strong>Opportunity</strong> ${recordLink('opportunity', o.id, o.name)} · ${escHtml(o.stage)}${o.nextAction ? `<div class="rec-muted">Next: ${escHtml(o.nextAction)}</div>` : ''}</div></div>`);
    if (o.nextAction?.trim()) agenda.push(`${o.name}: ${o.nextAction.trim()}`);
  }

  const agreements = S.agreements.filter((a) => inCompany(ref, a.companyId, a.client) && a.status !== 'Canceled');
  for (const a of agreements.filter((x) => isAgreementActive(x) || x.status !== 'Signed').slice(0, 3)) {
    const services = a.lines?.length ? a.lines.map((l) => l.serviceName).join(', ') : a.type || 'Agreement';
    const ends = a.endDate ? daysUntil(a.endDate) : null;
    const monthly = agreementMonthly(a);
    lines.push(`<div class="md-brief-row">${icon('document', 13)}<div><strong>Agreement</strong> ${recordLink('agreement', a.id, a.agrRef || services)} · ${escHtml(a.serviceStatus ? `service ${a.serviceStatus.toLowerCase()}` : a.status || '')}${monthly ? ` · ${fmtMoney(monthly, currencyOf(a))}/mo` : ''}${a.endDate ? ` · ends ${fmtDate(a.endDate)}` : ''}</div></div>`);
    if (isAgreementActive(a)) agenda.push(`Service check-in: ${services}`);
    if (ends != null && ends >= 0 && ends <= 90) agenda.push(`Renewal: ${services} ends ${fmtDate(a.endDate)} (${ends} days)`);
    if (a.status && !['Signed', 'On Hold'].includes(a.status)) agenda.push(`Agreement ${a.agrRef || services}: ${a.status.toLowerCase()} — confirm signature`);
  }

  const tasks = S.todos.filter((t) => t.status !== 'Done' && inCompany(ref, t.companyId, t.client));
  if (tasks.length) {
    lines.push(`<div class="md-brief-row">${icon('check', 13)}<div><strong>${tasks.length} open task${tasks.length === 1 ? '' : 's'}</strong> ${tasks.slice(0, 3).map((t) => recordLink('task', t.id, t.title)).join(', ')}</div></div>`);
  }
  const notes = S.notes.filter((n) => inCompany(ref, n.companyId, n.clientName)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 3);
  if (notes.length) {
    lines.push(`<div class="md-brief-row">${icon('note', 13)}<div><strong>Recent notes</strong> ${notes.map((n) => recordLink('note', n.id, n.title || 'Untitled')).join(', ')}</div></div>`);
  }
  return { lines, agenda: [...new Set(agenda)] };
}

function briefHtml(m: Meeting, company: Company): string {
  const { lines, agenda } = buildBrief(m, company);
  if (!lines.length) return `<p class="rec-muted md-client-lead">Nothing on file with ${escHtml(company.name)} yet — no earlier meetings, proposals, opportunities or agreements.</p>`;
  return `<div class="md-brief">${lines.join('')}</div>${agenda.length ? `<details class="md-agenda-preview"><summary>Suggested agenda (${agenda.length})</summary><ol>${agenda.map((a) => `<li>${escHtml(a)}</li>`).join('')}</ol></details>` : ''}`;
}

export function addSuggestedAgenda(meetingId: number): void {
  const m = S.meetings.find((x) => x.id === meetingId);
  if (!m) return;
  const company = m.companyId != null ? S.companies.find((c) => c.id === m.companyId) : S.companies.find((c) => c.name === m.companyName);
  if (!company) return;
  const { agenda } = buildBrief(m, company);
  if (!agenda.length) { toast('Nothing to suggest yet for this client'); return; }
  const existing = (m.agenda || '').trim();
  const add = agenda.filter((a) => !existing.includes(a)).map((a) => `- ${a}`).join('\n');
  if (!add) { toast('The suggested points are already in the agenda'); return; }
  m.agenda = existing ? `${existing}\n${add}` : add;
  void persistMeeting(m).then((saved) => { replaceMeeting(saved); (window as any).openMeetingSection?.('agenda'); });
  toast('Suggested agenda added — edit it as you like', { tone: 'success' });
}
expose('addSuggestedAgenda', addSuggestedAgenda);

// ── Meetings list: suggestions waiting for review ──

export function meetingSuggestionsBanner(): string {
  const index = domainIndex();
  const pending = S.meetings.filter((m) => !m.isCancelled && m.companyId == null && !(m.companyName || '').trim() && !S.dismissedMeetingLinks.includes(m.id))
    .map((m) => ({ m, s: suggestMeetingCompanies(m, index)[0] }))
    .filter((x) => x.s);
  if (!pending.length) return '';
  return `<section class="sec md-review">
    <div class="rec-section-hd"><h2>Link meetings to clients</h2><span class="rec-count">${pending.length}</span></div>
    <div class="rec-list">${pending.slice(0, 8).map(({ m, s }) => `<div class="rec-row">
      <span class="rec-row-icon">${icon('meeting', 15)}</span>
      <div class="rec-row-main"><div class="rec-row-title">${escHtml(m.title)} → ${escHtml(s!.company.name)}</div><div class="rec-row-sub">${m.meetingDate ? `${fmtDate(m.meetingDate)} · ` : ''}${reasonsHtml(s!)}</div></div>
      <div class="rec-row-end">
        <button class="btn-secondary btn-sm" onclick="event.stopPropagation();confirmMeetingLink(${m.id}, ${s!.company.id}, true)">Link</button>
        <button class="btn-secondary btn-sm" onclick="event.stopPropagation();dismissMeetingLink(${m.id})">Dismiss</button>
      </div>
    </div>`).join('')}</div>
  </section>`;
}

export function meetingSuggestionChip(m: Meeting): string {
  if (m.companyId != null || (m.companyName || '').trim() || S.dismissedMeetingLinks.includes(m.id)) return '';
  const s = suggestMeetingCompanies(m)[0];
  return s ? `<span class="rec-badge">Suggested: ${escHtml(s.company.name)}</span>` : '';
}

// ── Company websites from email domains ──

export function openWebsiteSuggestions(): void {
  const list = suggestWebsites();
  const body = document.getElementById('websites-body');
  if (!body) return;
  body.innerHTML = list.length
    ? `<p class="modal-body-text">Websites guessed from the email addresses of each company's contacts. Untick any that look wrong (for example a parent group's domain).</p>
      <label class="check-label websites-all"><input type="checkbox" checked onchange="document.querySelectorAll('.website-pick').forEach((c)=>c.checked=this.checked)"> Select all</label>
      <div class="websites-list">${list.map((s) => `<label class="settings-list-row websites-row">
        <span><input type="checkbox" class="website-pick" value="${s.company.id}" data-domain="${escHtml(s.domain)}" checked> <span class="fw-600">${escHtml(s.company.name)}</span></span>
        <span class="websites-domain"><code>${escHtml(s.domain)}</code><span class="t-meta t-muted">${escHtml(s.reason)}</span></span>
      </label>`).join('')}</div>`
    : emptyState({ icon: 'link', title: 'No websites to suggest', body: 'Every company either has a website or no contact with a company email address.', compact: true });
  const btn = document.getElementById('websites-apply') as HTMLButtonElement | null;
  if (btn) btn.hidden = !list.length;
  document.getElementById('modal-websites')?.classList.add('open');
}
expose('openWebsiteSuggestions', openWebsiteSuggestions);

export function closeWebsiteSuggestions(): void {
  document.getElementById('modal-websites')?.classList.remove('open');
}
expose('closeWebsiteSuggestions', closeWebsiteSuggestions);

export async function applyWebsiteSuggestions(): Promise<void> {
  const picks = [...document.querySelectorAll<HTMLInputElement>('.website-pick:checked')];
  if (!picks.length) return;
  if (!(await showConfirm(`Set the website of ${picks.length} compan${picks.length === 1 ? 'y' : 'ies'} from their email domain?`, { confirmLabel: 'Fill websites' }))) return;
  let done = 0;
  for (const pick of picks) {
    const co = S.companies.find((c) => c.id === Number(pick.value));
    if (!co || co.website) continue;
    try {
      const saved = await saveCompany({ ...co, website: pick.dataset.domain || null });
      const i = S.companies.findIndex((c) => c.id === saved.id);
      if (i > -1) S.companies[i] = saved;
      done++;
    } catch (err) {
      toast(`Could not update ${co.name}`, { tone: 'error', detail: String(err) });
    }
  }
  closeWebsiteSuggestions();
  toast(`Filled ${done} website${done === 1 ? '' : 's'}`, { tone: 'success' });
  w.renderCompanyList?.();
  refreshCompanyViewIfOpen();
}
expose('applyWebsiteSuggestions', applyWebsiteSuggestions);

export async function useSuggestedWebsite(companyId: number, domain: string): Promise<void> {
  const co = S.companies.find((c) => c.id === companyId);
  if (!co) return;
  const saved = await saveCompany({ ...co, website: domain });
  const i = S.companies.findIndex((c) => c.id === saved.id);
  if (i > -1) S.companies[i] = saved;
  toast(`Website set to ${domain}`, { tone: 'success' });
  refreshCompanyViewIfOpen();
}
expose('useSuggestedWebsite', useSuggestedWebsite);

// ── People in a meeting → contacts ──

let dismissedPeople: string[] | null = null;
const peopleEditing = new Set<string>();

export async function loadDismissedPeople(): Promise<string[]> {
  if (dismissedPeople) return dismissedPeople;
  try { dismissedPeople = JSON.parse((await getAppMeta('dismissed_people')) || '[]'); } catch { dismissedPeople = []; }
  return dismissedPeople!;
}

const personKey = (meetingId: number, email: string) => `${meetingId}|${email}`;
const attr = (v: string) => escHtml(v).replace(/'/g, '&#39;');

function personRow(m: Meeting, p: MeetingPerson): string {
  const key = personKey(m.id, p.email);
  const initials = p.name.split(/\s+/).map((x) => x[0] || '').join('').slice(0, 2).toUpperCase();
  if (p.status === 'new' && peopleEditing.has(key)) {
    return `<div class="md-person is-editing" data-email="${attr(p.email)}">
      <div class="md-person-form">
        <label><span>Name</span><input class="finp" data-f="name" value="${attr(p.name)}"></label>
        <label><span>Company</span><input class="finp" data-f="company" list="md-people-companies" value="${attr(p.guess?.name || '')}" placeholder="Company"></label>
        <label><span>Role</span><input class="finp" data-f="role" placeholder="Optional"></label>
      </div>
      <div class="md-person-email">${escHtml(p.email)}</div>
      <div class="btn-row"><button class="btn-secondary btn-sm" onclick="cancelMeetingPerson(${m.id}, '${attr(p.email)}')">Cancel</button><button class="btn-primary btn-sm" onclick="saveMeetingPerson(${m.id}, '${attr(p.email)}')">Add contact</button></div>
    </div>`;
  }
  const sub = p.status === 'contact' && p.contact
    ? `${recordLink('contact', p.contact.id, 'Contact')}${p.contact.clientName ? ` · ${companyLink(p.contact.companyId, p.contact.clientName)}` : ''}`
    : p.status === 'internal' ? 'MENA BIG'
    : p.guess ? `${p.guess.company ? companyLink(p.guess.company.id, p.guess.company.name) : `New company: ${escHtml(p.guess.name)}`}`
    : 'Personal email — choose the company when adding';
  return `<div class="md-person status-${p.status}">
    <span class="md-person-avatar">${escHtml(initials)}</span>
    <div class="md-person-main"><div class="md-person-name">${escHtml(p.name)}</div><div class="md-person-sub">${escHtml(p.email)} · ${sub}</div></div>
    ${p.status === 'new' ? `<div class="md-person-actions">
      <button class="btn-secondary btn-sm" onclick="editMeetingPerson(${m.id}, '${attr(p.email)}')">${icon('plus', 12)} Add to contacts</button>
      <button class="rec-icon-btn" onclick="dismissMeetingPerson(${m.id}, '${attr(p.email)}')" title="Not a contact" aria-label="Not a contact">${icon('close', 12)}</button>
    </div>` : ''}
  </div>`;
}

export function renderMeetingPeople(m: Meeting): void {
  const el = document.getElementById('md-people');
  if (!el) return;
  const skip = new Set((dismissedPeople || []).map((e) => e.toLowerCase()));
  const people = meetingPeople(m).filter((p) => !(p.status === 'new' && skip.has(p.email) && !peopleEditing.has(personKey(m.id, p.email))));
  el.hidden = people.length === 0;
  if (!people.length) { el.innerHTML = ''; return; }
  const fresh = people.filter((p) => p.status === 'new');
  const addable = fresh.filter((p) => p.guess);
  const groups: [string, MeetingPerson[]][] = [['Not in contacts yet', fresh], ['Contacts', people.filter((p) => p.status === 'contact')], ['MENA BIG', people.filter((p) => p.status === 'internal')]];
  el.innerHTML = `<div class="rec-section-hd"><h2>People</h2><span class="rec-count">${people.length}</span>
      ${addable.length > 1 ? `<div class="rec-section-actions"><button class="btn-secondary btn-sm" onclick="addAllMeetingPeople(${m.id})">${icon('plus', 12)} Add all ${addable.length} to contacts</button></div>` : ''}</div>
    <datalist id="md-people-companies">${S.companies.filter((c) => !c.archived).map((c) => `<option value="${attr(c.name)}">`).join('')}</datalist>
    ${groups.filter(([, list]) => list.length).map(([label, list]) => `<div class="md-people-group"><div class="md-people-label">${escHtml(label)}</div>${list.map((p) => personRow(m, p)).join('')}</div>`).join('')}`;
  renderIcons(el);
  if (dismissedPeople == null) void loadDismissedPeople().then(() => { if (S.meetingEditId === m.id) renderMeetingPeople(m); });
}
expose('renderMeetingPeople', renderMeetingPeople);

function refreshPeople(meetingId: number): void {
  const m = S.meetings.find((x) => x.id === meetingId);
  if (m && S.meetingEditId === meetingId) { renderMeetingClientSection(m); }
}

export function editMeetingPerson(meetingId: number, email: string): void {
  peopleEditing.add(personKey(meetingId, email));
  refreshPeople(meetingId);
  document.querySelector<HTMLInputElement>(`#md-people .md-person.is-editing[data-email="${CSS.escape(email)}"] input[data-f="company"]`)?.focus();
}
expose('editMeetingPerson', editMeetingPerson);

export function cancelMeetingPerson(meetingId: number, email: string): void {
  peopleEditing.delete(personKey(meetingId, email));
  refreshPeople(meetingId);
}
expose('cancelMeetingPerson', cancelMeetingPerson);

export interface NewContactFromPerson { email: string; name: string; companyName: string; role?: string | null }

/** Adds people as contacts, creating their companies when needed, and
 * remembers each email domain for the company so meetings link by themselves. */
export async function addPeopleAsContacts(people: NewContactFromPerson[]): Promise<number> {
  let added = 0;
  const companies = new Map<string, Company>();
  for (const p of people) {
    const email = p.email.trim().toLowerCase();
    const companyName = p.companyName.trim();
    if (!companyName || S.contacts.some((c) => (c.email || '').toLowerCase() === email)) continue;
    let company = companies.get(companyName.toLowerCase()) || S.companies.find((c) => c.name.toLowerCase() === companyName.toLowerCase());
    if (!company) {
      company = await persistCreateCompany(companyName);
      if (!company) continue;
      if (!S.companies.some((c) => c.id === company!.id)) S.companies.push(company);
    }
    companies.set(companyName.toLowerCase(), company);
    S.contacts.push({ id: nextCtId(), clientName: company.name, companyId: company.id, name: p.name.trim() || email, role: p.role?.trim() || null, email, phone: null, whatsapp: null, service: null, lists: [] });
    const domain = emailDomain(email);
    if (domain && !PERSONAL_DOMAINS.has(domain) && S.companyDomains[domain] == null) S.companyDomains[domain] = company.id;
    added++;
  }
  if (added) {
    persistContacts();
    void saveDomains();
    // Meetings with these people and no client yet now link on their own.
    await autoLinkMeetings();
    refreshCompanyViewIfOpen();
    w.renderContacts?.();
  }
  return added;
}

export async function saveMeetingPerson(meetingId: number, email: string): Promise<void> {
  const row = document.querySelector<HTMLElement>(`#md-people .md-person.is-editing[data-email="${CSS.escape(email)}"]`);
  const val = (f: string) => row?.querySelector<HTMLInputElement>(`input[data-f="${f}"]`)?.value.trim() || '';
  if (!val('company')) { toast('Choose the company this person works for', { tone: 'error' }); return; }
  const added = await addPeopleAsContacts([{ email, name: val('name'), companyName: val('company'), role: val('role') }]);
  peopleEditing.delete(personKey(meetingId, email));
  if (added) toast(`${val('name') || email} added to ${val('company')}'s contacts`, { tone: 'success' });
  refreshPeople(meetingId);
}
expose('saveMeetingPerson', saveMeetingPerson);

export async function addAllMeetingPeople(meetingId: number): Promise<void> {
  const m = S.meetings.find((x) => x.id === meetingId);
  if (!m) return;
  const people = meetingPeople(m).filter((p) => p.status === 'new' && p.guess && !(dismissedPeople || []).includes(p.email));
  const newCompanies = [...new Set(people.filter((p) => !p.guess!.company).map((p) => p.guess!.name))];
  if (newCompanies.length && !(await showConfirm(`This also creates ${newCompanies.length === 1 ? 'a new company' : 'new companies'}: ${newCompanies.join(', ')}.\n\nYou can rename ${newCompanies.length === 1 ? 'it' : 'them'} later. Add ${people.length} contacts?`, { title: 'Add to contacts', confirmLabel: 'Add contacts' }))) return;
  const added = await addPeopleAsContacts(people.map((p) => ({ email: p.email, name: p.name, companyName: p.guess!.name })));
  toast(`Added ${added} contact${added === 1 ? '' : 's'}`, { tone: 'success' });
  refreshPeople(meetingId);
}
expose('addAllMeetingPeople', addAllMeetingPeople);

export async function dismissMeetingPerson(meetingId: number, email: string): Promise<void> {
  const list = await loadDismissedPeople();
  if (!list.includes(email)) list.push(email);
  void setAppMeta('dismissed_people', JSON.stringify(list)).catch(() => undefined);
  refreshPeople(meetingId);
  w.renderContacts?.();
}
expose('dismissMeetingPerson', dismissMeetingPerson);

// ── Contacts: people from meetings ──

export async function peopleFromMeetingsCount(): Promise<number> {
  return suggestedContacts(S.meetings, await loadDismissedPeople()).length;
}

let reviewList: ReturnType<typeof suggestedContacts> = [];

export async function openPeopleFromMeetings(): Promise<void> {
  reviewList = suggestedContacts(S.meetings, await loadDismissedPeople());
  const body = document.getElementById('people-review-body');
  if (!body) return;
  body.innerHTML = reviewList.length ? `<datalist id="people-review-companies">${S.companies.filter((c) => !c.archived).map((c) => `<option value="${attr(c.name)}">`).join('')}</datalist>
    <div class="tbl-wrap"><table class="people-review"><thead><tr><th><input type="checkbox" checked onchange="document.querySelectorAll('.pr-pick').forEach((x)=>x.checked=this.checked)" aria-label="Select all"></th><th>Name</th><th>Email</th><th>Company</th><th>Met in</th><th></th></tr></thead><tbody>
    ${reviewList.map((p, i) => `<tr data-i="${i}">
      <td><input type="checkbox" class="pr-pick"${p.guess ? ' checked' : ''} aria-label="Add ${attr(p.name)}"></td>
      <td><input class="finp" data-f="name" value="${attr(p.name)}"></td>
      <td class="t-muted">${escHtml(p.email)}</td>
      <td><input class="finp" data-f="company" list="people-review-companies" value="${attr(p.guess?.name || '')}" placeholder="Company">${p.guess && !p.guess.company ? '<div class="pr-new">New company</div>' : ''}</td>
      <td>${recordLink('meeting', p.lastMeetingId, p.lastMeetingTitle)}${p.meetings > 1 ? ` <span class="t-muted">+${p.meetings - 1}</span>` : ''}</td>
      <td><button class="rec-icon-btn" onclick="dismissReviewPerson(${i})" title="Not a contact" aria-label="Not a contact">${icon('close', 12)}</button></td>
    </tr>`).join('')}</tbody></table></div>`
    : emptyState({ icon: 'people', title: 'Everyone you meet is already a contact', body: 'People from future Outlook meetings show up here.', compact: true });
  renderIcons(body);
  document.getElementById('modal-people-review')?.classList.add('open');
}
expose('openPeopleFromMeetings', openPeopleFromMeetings);

export function closePeopleFromMeetings(): void {
  document.getElementById('modal-people-review')?.classList.remove('open');
}
expose('closePeopleFromMeetings', closePeopleFromMeetings);

export async function dismissReviewPerson(i: number): Promise<void> {
  const p = reviewList[i];
  if (!p) return;
  document.querySelector(`.people-review tr[data-i="${i}"]`)?.remove();
  const list = await loadDismissedPeople();
  if (!list.includes(p.email)) list.push(p.email);
  void setAppMeta('dismissed_people', JSON.stringify(list)).catch(() => undefined);
  w.renderContacts?.();
}
expose('dismissReviewPerson', dismissReviewPerson);

export async function addReviewedPeople(): Promise<void> {
  const rows = [...document.querySelectorAll<HTMLTableRowElement>('.people-review tbody tr')].filter((tr) => tr.querySelector<HTMLInputElement>('.pr-pick')?.checked);
  const picked = rows.map((tr) => {
    const p = reviewList[Number(tr.dataset.i)];
    const val = (f: string) => tr.querySelector<HTMLInputElement>(`input[data-f="${f}"]`)?.value.trim() || '';
    return { email: p.email, name: val('name'), companyName: val('company') };
  });
  const missing = picked.filter((p) => !p.companyName).length;
  if (!picked.length) { toast('Tick the people to add'); return; }
  if (missing) { toast(`Choose a company for ${missing} ${missing === 1 ? 'person' : 'people'}`, { tone: 'error' }); return; }
  const added = await addPeopleAsContacts(picked);
  closePeopleFromMeetings();
  toast(`Added ${added} contact${added === 1 ? '' : 's'} from your meetings`, { tone: 'success' });
}
expose('addReviewedPeople', addReviewedPeople);

export async function updatePeopleBanner(): Promise<void> {
  const el = document.getElementById('ct-people-banner');
  if (!el) return;
  const n = await peopleFromMeetingsCount();
  el.hidden = n === 0;
  el.innerHTML = n ? `<span class="rec-row-icon">${icon('meeting', 15)}</span><div class="rec-row-main"><div class="rec-row-title">${n} ${n === 1 ? 'person' : 'people'} from your meetings ${n === 1 ? "isn't a contact" : "aren't contacts"} yet</div><div class="rec-row-sub">Names, emails and companies taken from Outlook meeting invites.</div></div><button class="btn-primary btn-sm" onclick="openPeopleFromMeetings()">Review</button>` : '';
  renderIcons(el);
}
expose('updatePeopleBanner', updatePeopleBanner);
