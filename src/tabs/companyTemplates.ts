// Template emails from the company page (owner, 29-Sep-2026): behind the
// header's Email button, not on the page itself. The template names as quiet
// links, who it goes to (Change swaps in a select), and once one is picked,
// the email filled in with Copy and Open in Outlook. Unfilled placeholders are
// marked so he sees what to complete. The texts come from Settings →
// Templates; lib/emailTemplates.ts fills them.

import { S } from '../lib/state';
import { escHtml, expose, today } from '../lib/utils';
import { teamMember } from '../lib/commercial';
import { getEmailTemplates } from '../lib/db';
import { clipboardText, defaultContact, holesHtml, mailtoUrl, renderTemplate, SIGNATURE_NAME, templateContext, unfilled } from '../lib/emailTemplates';
import type { Agreement, Contact, EmailTemplate, Proposal } from '../lib/types';

let templates: EmailTemplate[] | null = null;
let loading: Promise<EmailTemplate[]> | null = null;

/** The templates (and the signature row), loaded once; Settings replaces them after an edit. */
export function loadEmailTemplates(): Promise<EmailTemplate[]> {
  if (templates) return Promise.resolve(templates);
  loading ??= getEmailTemplates().then((list) => (templates = list)).finally(() => { loading = null; });
  return loading;
}
export function setEmailTemplates(list: EmailTemplate[]): void { templates = list; }

interface Block { name: string; contacts: Contact[]; proposals: Proposal[]; agreements: Agreement[] }

/** What this visit chose: the template open, the contact, whether the contact select is showing. */
const view = { company: '', templateId: null as number | null, contactId: null as number | null, changing: false };
let current: Block | null = null;

const isOpen = () => !!document.getElementById('modal-co-templates')?.classList.contains('open');

/** The company page hands over its records; the dialog draws them when it opens (or redraws if open). */
export function renderCompanyTemplates(d: Block): void {
  if (view.company !== d.name) Object.assign(view, { company: d.name, templateId: null, contactId: null, changing: false });
  current = d;
  if (isOpen()) void loadEmailTemplates().then(() => { if (current === d) draw(d); }).catch(() => undefined);
}

export function openCompanyTemplates(): void {
  const d = current;
  if (!d) return;
  const sub = document.getElementById('co-templates-sub');
  if (sub) sub.textContent = d.name;
  document.getElementById('modal-co-templates')?.classList.add('open');
  const el = document.getElementById('co-templates');
  if (el && !templates) el.innerHTML = '<div class="feed-empty">Loading templates…</div>';
  void loadEmailTemplates().then(() => { if (current === d) draw(d); }).catch(() => { if (el) el.innerHTML = '<div class="feed-empty">Could not load the templates.</div>'; });
}
expose('openCompanyTemplates', openCompanyTemplates);

export function closeCompanyTemplates(): void {
  document.getElementById('modal-co-templates')?.classList.remove('open');
  view.changing = false;
}
expose('closeCompanyTemplates', closeCompanyTemplates);

function draw(d: Block): void {
  const el = document.getElementById('co-templates');
  if (!el || !templates) return;
  const list = templates.filter((t) => t.name !== SIGNATURE_NAME);
  const contact = d.contacts.find((c) => c.id === view.contactId) ?? defaultContact(d.contacts, d.proposals);
  const links = list.map((t) => `<a href="#" class="rlink${t.id === view.templateId ? ' is-on' : ''}" onclick="event.preventDefault();coTemplatePick(${t.id})">${escHtml(t.name)}</a>`).join('');
  const to = view.changing && d.contacts.length
    ? `<select class="finp co-tpl-contact" aria-label="Send to" onchange="coTemplateContact(this.value)">${d.contacts.map((c) => `<option value="${c.id}"${c.id === contact?.id ? ' selected' : ''}>${escHtml(c.name || c.email || 'Unnamed')}</option>`).join('')}</select>`
    : `<span>To ${contact ? escHtml(contact.name || contact.email || 'Unnamed') : 'nobody yet'}</span>${d.contacts.length > 1 ? ` <a href="#" class="rlink" onclick="event.preventDefault();coTemplateChange()">Change</a>` : ''}`;
  const tpl = list.find((t) => t.id === view.templateId);
  let panel = '';
  if (tpl) {
    const me = teamMember(S.currentUserId);
    const signature = templates.find((t) => t.name === SIGNATURE_NAME)?.body ?? null;
    const r = renderTemplate(tpl, templateContext({ company: d.name, contact, proposals: d.proposals, agreements: d.agreements, me, signature, today: today() }));
    const left = unfilled(`${r.subject}\n${r.body}`);
    const noEmail = !contact?.email;
    panel = `<div class="co-tpl-mail">
      <div class="co-tpl-subject">${holesHtml(r.subject)}</div>
      <div class="co-tpl-body">${holesHtml(r.body)}</div>
      ${left.length ? `<p class="co-tpl-left">To fill in: ${left.map((h) => `{${escHtml(h)}}`).join(', ')}</p>` : ''}
      <div class="btn-row">
        <button class="btn-secondary btn-sm" onclick="coTemplateCopy()">Copy</button>
        <button class="btn-primary btn-sm" onclick="coTemplateOpen()"${noEmail ? ` disabled title="${contact ? `${escHtml(contact.name || 'This contact')} has no email address` : 'No contact to send it to'}"` : ''}>Open in Outlook</button>
      </div>
    </div>`;
  }
  el.innerHTML = `<div class="co-tpl-links">${links}</div><div class="co-tpl-to">${to}</div>${panel}`;
}

function rendered(): { subject: string; body: string; to: string | null } | null {
  const d = current;
  const tpl = templates?.find((t) => t.id === view.templateId);
  if (!d || !tpl || !templates) return null;
  const contact = d.contacts.find((c) => c.id === view.contactId) ?? defaultContact(d.contacts, d.proposals);
  const signature = templates.find((t) => t.name === SIGNATURE_NAME)?.body ?? null;
  const r = renderTemplate(tpl, templateContext({ company: d.name, contact, proposals: d.proposals, agreements: d.agreements, me: teamMember(S.currentUserId), signature, today: today() }));
  return { ...r, to: contact?.email ?? null };
}

export function coTemplatePick(id: number): void {
  view.templateId = view.templateId === id ? null : id;
  if (current) draw(current);
}
expose('coTemplatePick', coTemplatePick);

export function coTemplateChange(): void {
  view.changing = true;
  if (current) draw(current);
  (document.querySelector('.co-tpl-contact') as HTMLSelectElement | null)?.focus();
}
expose('coTemplateChange', coTemplateChange);

export function coTemplateContact(id: string): void {
  view.contactId = Number(id) || null;
  view.changing = false;
  if (current) draw(current);
}
expose('coTemplateContact', coTemplateContact);

export function coTemplateCopy(): void {
  const r = rendered();
  if (r) (window as any).copyText(clipboardText(r.subject, r.body), 'Email copied');
}
expose('coTemplateCopy', coTemplateCopy);

export function coTemplateOpen(): void {
  const r = rendered();
  if (r?.to) (window as any).openExternalUrl(mailtoUrl(r.to, r.subject, r.body));
}
expose('coTemplateOpen', coTemplateOpen);
