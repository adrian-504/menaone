// Settings → Templates (owner, 29-Sep-2026): the template emails offered on
// each company page, and the signature they end with. Plain text; the
// placeholders are listed once. Saved one at a time (email_templates.rs).

import { escHtml, expose, showConfirm } from '../lib/utils';
import { toast } from '../lib/ui';
import { deleteEmailTemplate, getEmailTemplates, saveEmailTemplate } from '../lib/db';
import { SIGNATURE_NAME } from '../lib/emailTemplates';
import { setEmailTemplates } from './companyTemplates';
import type { EmailTemplate } from '../lib/types';

let list: EmailTemplate[] = [];
/** The template being edited; 0 = a new one. */
let editing: number | null = null;

export async function renderTemplatesSettings(): Promise<void> {
  const el = document.getElementById('templates-settings');
  if (!el) return;
  try { list = await getEmailTemplates(); } catch { list = []; }
  setEmailTemplates(list);
  draw();
}
expose('renderTemplatesSettings', renderTemplatesSettings);

function editor(t: Pick<EmailTemplate, 'id' | 'name' | 'subject' | 'body'>, isSignature: boolean): string {
  return `<div class="tpl-edit" data-id="${t.id}">
    ${isSignature ? '' : `<label class="flbl" for="tpl-name">Name</label><input class="finp" id="tpl-name" value="${escHtml(t.name)}">
    <label class="flbl" for="tpl-subject">Subject</label><input class="finp" id="tpl-subject" value="${escHtml(t.subject)}">`}
    ${isSignature ? '' : '<label class="flbl" for="tpl-body">Body</label>'}
    <textarea class="finp tpl-body-input" id="tpl-body" rows="${isSignature ? 7 : 14}"${isSignature ? ' aria-label="Signature"' : ''}>${escHtml(t.body)}</textarea>
    <div class="btn-row">
      <button class="btn-primary btn-sm" onclick="templateSave(${t.id}, ${isSignature})">Save</button>
      <button class="btn-secondary btn-sm" onclick="templateCancel()">Cancel</button>
      ${!isSignature && t.id ? `<button class="btn-danger btn-sm" onclick="templateDelete(${t.id})">Delete</button>` : ''}
    </div>
  </div>`;
}

function draw(): void {
  const el = document.getElementById('templates-settings');
  if (!el) return;
  const templates = list.filter((t) => t.name !== SIGNATURE_NAME);
  const signature = list.find((t) => t.name === SIGNATURE_NAME);
  const rows = templates.map((t) => (editing === t.id ? editor(t, false)
    : `<div class="rec-row" role="button" tabindex="0" onclick="templateEdit(${t.id})" onkeydown="if(event.key==='Enter')this.click()"><div class="rec-row-main"><div class="rec-row-title">${escHtml(t.name)}</div><div class="rec-row-sub">${escHtml(t.subject)}</div></div></div>`)).join('');
  el.innerHTML = `<div class="rec-list">${rows}</div>
    ${editing === 0 ? editor({ id: 0, name: '', subject: '', body: 'Dear {first_name},\n\n\n\n{signature}' }, false) : `<button class="btn-secondary btn-sm tpl-add" onclick="templateEdit(0)">Add template</button>`}
    <h3 class="tpl-sig-hd">Signature</h3>
    ${signature ? (editing === signature.id ? editor(signature, true) : `<div class="rec-row" role="button" tabindex="0" onclick="templateEdit(${signature.id})" onkeydown="if(event.key==='Enter')this.click()"><div class="rec-row-main"><div class="co-tpl-body tpl-sig-preview">${escHtml(signature.body)}</div></div></div>`) : ''}
    <p class="settings-card-desc tpl-legend">Filled in on the company page: {first_name} {full_name} {company} {services} {proposal_date} {my_name} {my_title} {email} {phone} {signature}. Anything else in braces stays visible for you to complete, e.g. {where}.</p>`;
  (document.getElementById('tpl-name') || document.getElementById('tpl-body'))?.focus();
}

export function templateEdit(id: number): void { editing = id; draw(); }
expose('templateEdit', templateEdit);

export function templateCancel(): void { editing = null; draw(); }
expose('templateCancel', templateCancel);

export async function templateSave(id: number, isSignature: boolean): Promise<void> {
  const val = (x: string) => (document.getElementById(x) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? '';
  const prior = list.find((t) => t.id === id);
  const name = isSignature ? SIGNATURE_NAME : val('tpl-name').trim();
  if (!name) { toast('Give the template a name', { tone: 'error' }); return; }
  try {
    await saveEmailTemplate({ id, name, subject: isSignature ? '' : val('tpl-subject'), body: val('tpl-body') });
    editing = null;
    await renderTemplatesSettings();
    toast(isSignature ? 'Signature saved' : prior ? 'Template saved' : 'Template added', { tone: 'success' });
  } catch (err) {
    toast('Could not save it', { tone: 'error', detail: String(err) });
  }
}
expose('templateSave', templateSave);

export async function templateDelete(id: number): Promise<void> {
  const t = list.find((x) => x.id === id);
  if (!t || !(await showConfirm(`Delete the template "${t.name}"?`, { title: 'Delete template', confirmLabel: 'Delete' }))) return;
  await deleteEmailTemplate(id);
  editing = null;
  await renderTemplatesSettings();
  toast('Template deleted');
}
expose('templateDelete', templateDelete);
