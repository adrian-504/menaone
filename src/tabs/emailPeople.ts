// People from email: a review list of people you correspond with who aren't
// contacts yet, with their company filled in from the email domain. The
// mailbox is read on request (envelopes only, ms365/email_people.rs); the
// rules are in src/lib/emailPeople.ts; adding goes through the same path as
// People from meetings (addPeopleAsContacts), and a dismissed person stays
// dismissed in both lists.

import { S } from '../lib/state';
import { renderIcons } from '../core/chrome';
import { toast, emptyState } from '../lib/ui';
import { escHtml, expose, fmtDate, showConfirm } from '../lib/utils';
import { emailPeopleCached, scanEmailPeople, setAppMeta, getAppMeta, type EmailPeopleScan } from '../lib/db';
import { persistContacts } from '../lib/persist';
import { icon } from '../lib/icons';
import { PERSONAL_DOMAINS, domainIndex, guessCompany, ownDomains } from '../lib/clientMatch';
import { contactSummary, domainGroups, emailPeopleCandidates, type DomainGroup, type EmailCandidate } from '../lib/emailPeople';
import { addPeopleAsContacts, loadDismissedPeople, saveDomains } from './meetingClient';

const MONTHS = 24;
let scan: EmailPeopleScan | null = null;
let scanLoaded = false;
let scanning = false;
let list: EmailCandidate[] = [];
/** Which half of the screen: people at companies you have, or companies to sort. */
let view: 'people' | 'domains' = 'people';

// ── Domains marked "not a client" ───────────────────────────────────────────
let dismissedDomains: string[] | null = null;
async function loadDismissedDomains(): Promise<string[]> {
  if (dismissedDomains) return dismissedDomains;
  try { dismissedDomains = JSON.parse((await getAppMeta('dismissed_domains')) || '[]'); } catch { dismissedDomains = []; }
  return dismissedDomains!;
}
function saveDismissedDomains(): void {
  void setAppMeta('dismissed_domains', JSON.stringify(dismissedDomains || [])).catch(() => undefined);
}

const attr = (v: string) => escHtml(v).replace(/'/g, '&#39;');

async function cachedScan(): Promise<EmailPeopleScan | null> {
  if (!scanLoaded) {
    scanLoaded = true;
    try { scan = await emailPeopleCached(); } catch { scan = null; }
  }
  return scan;
}

async function candidates(): Promise<EmailCandidate[]> {
  const s = await cachedScan();
  if (!s) return [];
  const index = domainIndex();
  return emailPeopleCandidates(s.people, {
    own: ownDomains(),
    personal: PERSONAL_DOMAINS,
    contactEmails: new Set(S.contacts.map((c) => (c.email || '').trim().toLowerCase()).filter(Boolean)),
    dismissed: new Set((await loadDismissedPeople()).map((e) => e.toLowerCase())),
    dismissedDomains: new Set(await loadDismissedDomains()),
    guess: (domain) => guessCompany(domain, null, index),
  });
}

// ── Contacts banner ─────────────────────────────────────────────────────────

export async function updateEmailPeopleBanner(): Promise<void> {
  const el = document.getElementById('ct-email-banner');
  if (!el) return;
  if (S.ms365Status?.status !== 'connected') { el.hidden = true; return; }
  const s = await cachedScan();
  const all = s ? await candidates() : null;
  const n = all ? all.filter((c) => c.certainty !== 'new').length : null;
  const sortable = all ? domainGroups(all).length : 0;
  el.hidden = n === 0 && sortable === 0;
  el.innerHTML = n == null
    ? `<span class="rec-row-icon">${icon('mail', 15)}</span><div class="rec-row-main"><div class="rec-row-title">Find the people you email who aren't contacts yet</div><div class="rec-row-sub">Reads who you've written to and heard from in Outlook over the last ${MONTHS} months — names and addresses only.</div></div><button class="btn-secondary btn-sm" onclick="openEmailPeople()">Look</button>`
    : `<span class="rec-row-icon">${icon('mail', 15)}</span><div class="rec-row-main"><div class="rec-row-title">${[n ? `${n} ${n === 1 ? 'person' : 'people'} at your companies ${n === 1 ? "isn't a contact" : "aren't contacts"} yet` : '', sortable ? `${sortable} ${sortable === 1 ? 'company' : 'companies'} you email to sort` : ''].filter(Boolean).join(' · ')}</div><div class="rec-row-sub">From Outlook, read ${fmtDate(s!.scannedAt.slice(0, 10))}.</div></div><button class="btn-secondary btn-sm" onclick="openEmailPeople()">Review</button>`;
  renderIcons(el);
}
expose('updateEmailPeopleBanner', updateEmailPeopleBanner);

// ── Review list ─────────────────────────────────────────────────────────────

function rowHtml(c: EmailCandidate, i: number): string {
  const when = c.lastAt ? fmtDate(c.lastAt.slice(0, 10)) : '';
  const companyNote = c.certainty === 'new' ? '<div class="pr-new">New company</div>' : c.certainty === 'likely' ? '<div class="pr-new">Matched by name — check</div>' : '';
  return `<tr data-i="${i}">
    <td><input type="checkbox" class="ep-pick"${c.certainty === 'certain' ? ' checked' : ''} aria-label="Add ${attr(c.displayName)}"></td>
    <td><input class="finp" data-f="name" value="${attr(c.displayName)}"></td>
    <td class="t-muted">${escHtml(c.email)}</td>
    <td><input class="finp" data-f="company" list="email-people-companies" value="${attr(c.certainty === 'new' ? '' : c.guess.name)}" placeholder="${attr(c.certainty === 'new' ? c.guess.name : 'Company')}">${companyNote}</td>
    <td class="t-muted">${escHtml(contactSummary(c))}${when ? `<div>last ${escHtml(when)}</div>` : ''}</td>
    <td><button class="rec-icon-btn" onclick="dismissEmailPerson(${i})" title="Not a contact" aria-label="Not a contact">${icon('close', 12)}</button></td>
  </tr>`;
}

function tableHtml(rows: [EmailCandidate, number][]): string {
  return `<div class="tbl-wrap"><table class="people-review email-people"><thead><tr><th></th><th>Name</th><th>Email</th><th>Company</th><th>In touch</th><th></th></tr></thead>
    <tbody>${rows.map(([c, i]) => rowHtml(c, i)).join('')}</tbody></table></div>`;
}

function renderList(): void {
  const body = document.getElementById('email-people-body');
  if (!body) return;
  if (scanning) {
    body.innerHTML = `<div class="ep-scanning">${icon('mail', 18)}<div><strong>Reading who you've emailed…</strong><div class="t-muted">The last ${MONTHS} months of your Inbox and Sent Items — names and addresses only. This can take a minute.</div></div></div>`;
    renderIcons(body);
    return;
  }
  if (!list.length) {
    body.innerHTML = emptyState({ icon: 'people', title: scan ? 'Everyone you email is already a contact' : 'Nothing read yet', body: scan ? 'Or you dismissed them. New people show up after the next read.' : 'Read your email to find people who aren\'t contacts yet.', compact: true });
    renderIcons(body);
    return;
  }
  const indexed = list.map((c, i) => [c, i] as [EmailCandidate, number]);
  const matched = indexed.filter(([c]) => c.certainty !== 'new');
  const certain = matched.filter(([c]) => c.certainty === 'certain').length;
  const groups = domainGroups(list);
  const segment = `<div class="segmented ep-views" role="tablist">
      <button class="${view === 'people' ? 'active' : ''}" onclick="setEmailPeopleView('people')">At your companies <span class="ep-n">${matched.length}</span></button>
      <button class="${view === 'domains' ? 'active' : ''}" onclick="setEmailPeopleView('domains')">Companies to sort <span class="ep-n">${groups.length}</span></button>
    </div>`;
  const add = document.getElementById('email-people-add');
  if (add) add.hidden = view !== 'people';
  if (view === 'domains') { body.innerHTML = segment + domainTriageHtml(groups); renderIcons(body); focusTriage(); return; }
  body.innerHTML = `${segment}<datalist id="email-people-companies">${S.companies.filter((c) => !c.archived).map((c) => `<option value="${attr(c.name)}">`).join('')}</datalist>
    ${scan && !scan.complete ? '<div class="settings-callout tone-amber">Your mailbox is larger than one read covers: the oldest messages weren\'t included.</div>' : ''}
    <div class="ep-group-hd"><strong>Matched to a company</strong><span class="t-muted">${matched.length} · ${certain} certain, ticked</span>
      <button class="btn-ghost btn-sm" onclick="tickEmailPeople('certain')">Tick certain</button><button class="btn-ghost btn-sm" onclick="tickEmailPeople('none')">Untick all</button></div>
    ${matched.length ? tableHtml(matched) : `<div class="cm-empty">Everyone here is added. ${groups.length ? `${groups.length} companies you email aren't in MENA One yet — <button class="md-link-btn" onclick="setEmailPeopleView('domains')">sort them</button>.` : ''}</div>`}`;
  renderIcons(body);
}

export function setEmailPeopleView(v: 'people' | 'domains'): void {
  view = v;
  renderList();
}
expose('setEmailPeopleView', setEmailPeopleView);

// ── Companies to sort: one domain at a time ─────────────────────────────────

let onlyWrittenTo = true;
let reviewKinds = false;
/** Domains decided or skipped in this sitting, and what can be undone. */
const passed = new Set<string>();
interface Decision { domain: string; kind: 'add' | 'dismiss' | 'skip'; contactIds?: number[]; linkedDomain?: boolean }
const decisions: Decision[] = [];
let counts = { added: 0, dismissed: 0 };

function queue(groups: DomainGroup[]): DomainGroup[] {
  return groups.filter((g) => !passed.has(g.domain) && (reviewKinds ? g.kind != null : g.kind == null) && (!onlyWrittenTo || reviewKinds || g.writtenTo));
}

function currentGroup(): DomainGroup | undefined {
  return queue(domainGroups(list))[0];
}

function domainTriageHtml(groups: DomainGroup[]): string {
  const q = queue(groups);
  const hints = groups.filter((g) => g.kind != null && !passed.has(g.domain));
  const hiddenQuiet = onlyWrittenTo && !reviewKinds ? groups.filter((g) => g.kind == null && !g.writtenTo && !passed.has(g.domain)).length : 0;
  const bar = `<div class="ep-triage-bar">
      ${reviewKinds ? `<button class="btn-ghost btn-sm" onclick="setTriageKinds(false)">← Back to companies</button><span class="t-muted">Government and service providers: ${q.length}</span>`
        : `<label class="ep-check"><input type="checkbox" ${onlyWrittenTo ? 'checked' : ''} onchange="setTriageWrittenTo(this.checked)"> Only companies I've written to${hiddenQuiet ? ` <span class="t-muted">(${hiddenQuiet} hidden)</span>` : ''}</label>`}
      <span class="ep-progress">${counts.added} added · ${counts.dismissed} not clients · ${q.length} to go</span>
    </div>
    ${!reviewKinds && hints.length ? `<div class="settings-callout tone-accent ep-hint"><span>${hints.length} look like government or service providers (banks, airlines, hotels, job sites…).</span>
      <span><button class="btn-secondary btn-sm" onclick="dismissAllKinds()">Mark all not clients</button> <button class="btn-ghost btn-sm" onclick="setTriageKinds(true)">Review them</button></span></div>` : ''}`;
  const g = q[0];
  if (!g) return `${bar}${emptyState({ icon: 'check', title: reviewKinds ? 'All sorted' : 'Nothing left to sort here', body: reviewKinds ? '' : hiddenQuiet ? `${hiddenQuiet} companies only ever wrote to you — untick "Only companies I've written to" to go through them.` : 'Every company you email is sorted.', compact: true })}${decisions.length ? '<div class="ep-undo-row"><button class="btn-ghost btn-sm" onclick="undoTriage()">Undo last</button></div>' : ''}`;
  const existing = S.companies.find((c) => c.name.toLowerCase() === g.name.toLowerCase());
  const when = g.lastAt ? fmtDate(g.lastAt.slice(0, 10)) : '—';
  return `${bar}
    <div class="ep-card" data-domain="${attr(g.domain)}">
      <div class="ep-card-hd"><div><div class="ep-domain">${escHtml(g.domain)}</div>
        <div class="t-muted">${g.sent} sent · ${g.received} received${g.copied ? ` · copied ${g.copied}` : ''} · last ${escHtml(when)}${g.kind ? ` · ${g.kind === 'government' ? 'looks like government' : 'looks like a service provider'}` : ''}</div></div></div>
      <label class="ep-field"><span>Company</span>
        <input class="finp" id="ep-company" list="ep-companies" value="${attr(existing?.name || g.name)}" oninput="updateTriageAction()" onkeydown="if(event.key==='Enter'){event.preventDefault();triageAdd()}">
        <datalist id="ep-companies">${S.companies.filter((c) => !c.archived).map((c) => `<option value="${attr(c.name)}">`).join('')}</datalist></label>
      <div class="ep-people">${g.people.map((c) => `<label class="ep-person"><input type="checkbox" checked data-email="${attr(c.email)}">
        <span class="ep-person-name">${escHtml(c.displayName)}</span><span class="t-muted">${escHtml(c.email)} · ${escHtml(contactSummary(c))}</span></label>`).join('')}</div>
      <div class="ep-actions">
        <button class="btn-primary" id="ep-add" onclick="triageAdd()"><kbd>1</kbd><span id="ep-add-label"></span></button>
        <button class="btn-secondary" onclick="triagePickExisting()"><kbd>2</kbd>Existing company…</button>
        <button class="btn-secondary cu-danger" onclick="triageDismiss()"><kbd>3</kbd>Not a client</button>
        <button class="btn-ghost" onclick="triageSkip()"><kbd>S</kbd>Skip</button>
        ${decisions.length ? '<button class="btn-ghost ep-undo" onclick="undoTriage()"><kbd>U</kbd>Undo</button>' : ''}
      </div>
    </div>`;
}

function focusTriage(): void {
  updateTriageAction();
  (document.querySelector('#modal-email-people .ep-card') as HTMLElement | null)?.setAttribute('tabindex', '-1');
}

/** The main button says what it will do: add to an existing company or create one. */
export function updateTriageAction(): void {
  const label = document.getElementById('ep-add-label');
  const name = (document.getElementById('ep-company') as HTMLInputElement | null)?.value.trim() || '';
  if (!label) return;
  const existing = S.companies.find((c) => c.name.toLowerCase() === name.toLowerCase());
  label.textContent = !name ? 'Type a company' : existing ? `Add to ${existing.name}` : `New company: ${name}`;
}
expose('updateTriageAction', updateTriageAction);

export function triagePickExisting(): void {
  const input = document.getElementById('ep-company') as HTMLInputElement | null;
  if (!input) return;
  input.value = '';
  input.focus();
  updateTriageAction();
  try { (input as any).showPicker?.(); } catch { /* the list opens as you type */ }
}
expose('triagePickExisting', triagePickExisting);

export async function triageAdd(): Promise<void> {
  const g = currentGroup();
  const name = (document.getElementById('ep-company') as HTMLInputElement | null)?.value.trim() || '';
  if (!g) return;
  if (!name) { toast('Type the company first', { tone: 'error' }); return; }
  const picked = [...document.querySelectorAll<HTMLInputElement>('#modal-email-people .ep-person input:checked')].map((b) => b.dataset.email!);
  const people = g.people.filter((c) => picked.includes(c.email));
  const before = new Set(S.contacts.map((c) => c.id));
  const hadDomain = S.companyDomains[g.domain] != null;
  await addPeopleAsContacts(people.map((c) => ({ email: c.email, name: c.displayName, companyName: name })));
  // The domain belongs to that company from now on, even with nobody ticked.
  const company = S.companies.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (company && !hadDomain) { S.companyDomains[g.domain] = company.id; void saveDomains(); }
  const contactIds = S.contacts.filter((c) => !before.has(c.id)).map((c) => c.id);
  decisions.push({ domain: g.domain, kind: 'add', contactIds, linkedDomain: !hadDomain });
  passed.add(g.domain);
  counts.added += contactIds.length;
  list = await candidates();
  renderList();
}
expose('triageAdd', triageAdd);

export async function triageDismiss(): Promise<void> {
  const g = currentGroup();
  if (!g) return;
  const d = await loadDismissedDomains();
  if (!d.includes(g.domain)) d.push(g.domain);
  saveDismissedDomains();
  decisions.push({ domain: g.domain, kind: 'dismiss' });
  passed.add(g.domain);
  counts.dismissed++;
  renderList();
}
expose('triageDismiss', triageDismiss);

export function triageSkip(): void {
  const g = currentGroup();
  if (!g) return;
  decisions.push({ domain: g.domain, kind: 'skip' });
  passed.add(g.domain);
  renderList();
}
expose('triageSkip', triageSkip);

export async function undoTriage(): Promise<void> {
  const last = decisions.pop();
  if (!last) return;
  passed.delete(last.domain);
  if (last.kind === 'dismiss') {
    dismissedDomains = (await loadDismissedDomains()).filter((d) => d !== last.domain);
    saveDismissedDomains();
    counts.dismissed = Math.max(0, counts.dismissed - 1);
  } else if (last.kind === 'add') {
    const ids = new Set(last.contactIds || []);
    S.contacts = S.contacts.filter((c) => !ids.has(c.id));
    persistContacts();
    if (last.linkedDomain) { delete S.companyDomains[last.domain]; void saveDomains(); }
    counts.added = Math.max(0, counts.added - ids.size);
    toast('Undone: the contacts were removed', { detail: 'A company created for them stays — delete it from Companies if you don\'t want it.' });
  }
  list = await candidates();
  renderList();
}
expose('undoTriage', undoTriage);

export async function dismissAllKinds(): Promise<void> {
  const hints = domainGroups(list).filter((g) => g.kind != null && !passed.has(g.domain));
  if (!hints.length) return;
  if (!(await showConfirm(`Mark ${hints.length} government and service-provider domains as not clients?\n\n${hints.slice(0, 12).map((g) => g.domain).join(', ')}${hints.length > 12 ? '…' : ''}\n\nThey won't be suggested again. You can review them one by one instead.`, { title: 'Not clients', confirmLabel: 'Mark not clients' }))) return;
  const d = await loadDismissedDomains();
  for (const g of hints) { if (!d.includes(g.domain)) d.push(g.domain); passed.add(g.domain); }
  saveDismissedDomains();
  counts.dismissed += hints.length;
  list = await candidates();
  renderList();
}
expose('dismissAllKinds', dismissAllKinds);

export function setTriageWrittenTo(on: boolean): void { onlyWrittenTo = on; renderList(); }
expose('setTriageWrittenTo', setTriageWrittenTo);
export function setTriageKinds(on: boolean): void { reviewKinds = on; renderList(); }
expose('setTriageKinds', setTriageKinds);

// 1 / 2 / 3 / S / U while sorting companies (not while typing in a field).
document.addEventListener('keydown', (e) => {
  if (view !== 'domains' || !document.getElementById('modal-email-people')?.classList.contains('open')) return;
  const t = e.target as HTMLElement;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const run: Record<string, () => void> = { '1': () => void triageAdd(), '2': triagePickExisting, '3': () => void triageDismiss(), s: triageSkip, u: () => void undoTriage() };
  if (run[k]) { e.preventDefault(); run[k](); }
});

export async function openEmailPeople(): Promise<void> {
  document.getElementById('modal-email-people')?.classList.add('open');
  const s = await cachedScan();
  if (!s) { await rescanEmailPeople(); return; }
  list = await candidates();
  // Straight to sorting companies when everyone at known companies is added.
  view = list.some((c) => c.certainty !== 'new') ? view : 'domains';
  renderList();
}
expose('openEmailPeople', openEmailPeople);

export function closeEmailPeople(): void {
  document.getElementById('modal-email-people')?.classList.remove('open');
}
expose('closeEmailPeople', closeEmailPeople);

export async function rescanEmailPeople(): Promise<void> {
  if (scanning) return;
  scanning = true;
  renderList();
  try {
    scan = await scanEmailPeople(MONTHS);
    scanLoaded = true;
    list = await candidates();
  } catch (err) {
    toast('Could not read your email', { tone: 'error', detail: String(err) });
  } finally {
    scanning = false;
    renderList();
    void updateEmailPeopleBanner();
  }
}
expose('rescanEmailPeople', rescanEmailPeople);

export function tickEmailPeople(which: 'certain' | 'none'): void {
  document.querySelectorAll<HTMLTableRowElement>('.email-people tbody tr').forEach((tr) => {
    const c = list[Number(tr.dataset.i)];
    const box = tr.querySelector<HTMLInputElement>('.ep-pick');
    if (box && c) box.checked = which === 'certain' && c.certainty === 'certain';
  });
}
expose('tickEmailPeople', tickEmailPeople);

export async function dismissEmailPerson(i: number): Promise<void> {
  const c = list[i];
  if (!c) return;
  document.querySelectorAll(`.email-people tr[data-i="${i}"]`).forEach((tr) => tr.remove());
  const dismissed = await loadDismissedPeople();
  if (!dismissed.includes(c.email)) dismissed.push(c.email);
  void setAppMeta('dismissed_people', JSON.stringify(dismissed)).catch(() => undefined);
  void updateEmailPeopleBanner();
}
expose('dismissEmailPerson', dismissEmailPerson);

export async function addEmailPeople(): Promise<void> {
  const rows = [...document.querySelectorAll<HTMLTableRowElement>('.email-people tbody tr')].filter((tr) => tr.querySelector<HTMLInputElement>('.ep-pick')?.checked);
  const picked = rows.map((tr) => {
    const c = list[Number(tr.dataset.i)];
    const val = (f: string) => tr.querySelector<HTMLInputElement>(`input[data-f="${f}"]`)?.value.trim() || '';
    return { email: c.email, name: val('name'), companyName: val('company') };
  });
  if (!picked.length) { toast('Tick the people to add'); return; }
  const missing = picked.filter((p) => !p.companyName).length;
  if (missing) { toast(`Type a company for ${missing} ${missing === 1 ? 'person' : 'people'}`, { tone: 'error' }); return; }
  const known = new Set(S.companies.map((c) => c.name.toLowerCase()));
  const newCompanies = [...new Set(picked.map((p) => p.companyName).filter((n) => !known.has(n.toLowerCase())))];
  if (newCompanies.length && !(await showConfirm(`This also creates ${newCompanies.length === 1 ? 'a new company' : `${newCompanies.length} new companies`}: ${newCompanies.slice(0, 8).join(', ')}${newCompanies.length > 8 ? '…' : ''}.\n\nAdd ${picked.length} contact${picked.length === 1 ? '' : 's'}?`, { title: 'Add to contacts', confirmLabel: 'Add contacts' }))) return;
  const added = await addPeopleAsContacts(picked);
  list = await candidates();
  renderList();
  void updateEmailPeopleBanner();
  toast(`Added ${added} contact${added === 1 ? '' : 's'} from your email`, { tone: 'success' });
}
expose('addEmailPeople', addEmailPeople);
