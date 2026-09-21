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
import { emailPeopleCached, scanEmailPeople, setAppMeta, type EmailPeopleScan } from '../lib/db';
import { icon } from '../lib/icons';
import { PERSONAL_DOMAINS, domainIndex, guessCompany, ownDomains } from '../lib/clientMatch';
import { contactSummary, emailPeopleCandidates, type EmailCandidate } from '../lib/emailPeople';
import { addPeopleAsContacts, loadDismissedPeople } from './meetingClient';

const MONTHS = 24;
let scan: EmailPeopleScan | null = null;
let scanLoaded = false;
let scanning = false;
let list: EmailCandidate[] = [];

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
    guess: (domain) => guessCompany(domain, null, index),
  });
}

// ── Contacts banner ─────────────────────────────────────────────────────────

export async function updateEmailPeopleBanner(): Promise<void> {
  const el = document.getElementById('ct-email-banner');
  if (!el) return;
  if (S.ms365Status?.status !== 'connected') { el.hidden = true; return; }
  const s = await cachedScan();
  const n = s ? (await candidates()).length : null;
  el.hidden = n === 0;
  el.innerHTML = n == null
    ? `<span class="rec-row-icon">${icon('mail', 15)}</span><div class="rec-row-main"><div class="rec-row-title">Find the people you email who aren't contacts yet</div><div class="rec-row-sub">Reads who you've written to and heard from in Outlook over the last ${MONTHS} months — names and addresses only.</div></div><button class="btn-secondary btn-sm" onclick="openEmailPeople()">Look</button>`
    : `<span class="rec-row-icon">${icon('mail', 15)}</span><div class="rec-row-main"><div class="rec-row-title">${n} ${n === 1 ? 'person' : 'people'} you email ${n === 1 ? "isn't a contact" : "aren't contacts"} yet</div><div class="rec-row-sub">From Outlook, read ${fmtDate(s!.scannedAt.slice(0, 10))}. Their company is filled in from the email address.</div></div><button class="btn-secondary btn-sm" onclick="openEmailPeople()">Review</button>`;
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
  const unknown = indexed.filter(([c]) => c.certainty === 'new');
  const certain = matched.filter(([c]) => c.certainty === 'certain').length;
  body.innerHTML = `<datalist id="email-people-companies">${S.companies.filter((c) => !c.archived).map((c) => `<option value="${attr(c.name)}">`).join('')}</datalist>
    ${scan && !scan.complete ? '<div class="settings-callout tone-amber">Your mailbox is larger than one read covers: the oldest messages weren\'t included.</div>' : ''}
    <div class="ep-group-hd"><strong>Matched to a company</strong><span class="t-muted">${matched.length} · ${certain} certain, ticked</span>
      <button class="btn-ghost btn-sm" onclick="tickEmailPeople('certain')">Tick certain</button><button class="btn-ghost btn-sm" onclick="tickEmailPeople('none')">Untick all</button></div>
    ${matched.length ? tableHtml(matched) : '<div class="cm-empty">None — the companies below aren\'t in MENA One yet.</div>'}
    ${unknown.length ? `<details class="ep-unknown"><summary><strong>Company not recognised</strong> <span class="t-muted">${unknown.length} · type the company to add them</span></summary>${tableHtml(unknown)}</details>` : ''}`;
  renderIcons(body);
}

export async function openEmailPeople(): Promise<void> {
  document.getElementById('modal-email-people')?.classList.add('open');
  const s = await cachedScan();
  if (!s) { await rescanEmailPeople(); return; }
  list = await candidates();
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
