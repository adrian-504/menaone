// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

const templates = [
  ...['Sending a proposal', 'Following up on a proposal', 'After a call — next steps', 'Sending the NDA', 'Thank you for the information', 'Introduction · after meeting', 'Introduction · first contact']
    .map((name, i) => ({ id: i + 1, name, subject: '{company} — {services} Proposal', body: 'Dear {first_name},\n\nAt {where}.\n\n{signature}', sortOrder: i + 1, updatedAt: '' })),
  { id: 8, name: '_signature', subject: '', body: '{my_name}', sortOrder: 8, updatedAt: '' },
];
vi.mock('../lib/db', async (orig) => ({ ...(await orig<typeof import('../lib/db')>()), getEmailTemplates: vi.fn(async () => templates) }));

import { renderCompanyTemplates, coTemplatePick, openCompanyTemplates } from './companyTemplates';
import type { Contact } from '../lib/types';

const sara = { id: 5, clientName: 'Contoso Test', companyId: 1, name: 'Sara Haddad', role: null, email: 'sara@contoso.test', phone: null, whatsapp: null, service: null, lists: [], isDecisionMaker: true } as Contact;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('Template emails on the company page', () => {
  it('is behind the Email button: nothing drawn until the dialog opens', async () => {
    document.body.innerHTML = '<div class="modal-ov" id="modal-co-templates"><div id="co-templates-sub"></div><div id="co-templates"></div></div>';
    renderCompanyTemplates({ name: 'Contoso Test', contacts: [sara], proposals: [], agreements: [] });
    await tick();
    expect(document.getElementById('co-templates')!.innerHTML).toBe('');
  });

  it('shows the template names and who it goes to, and no email until one is picked', async () => {
    openCompanyTemplates();
    await tick();
    expect(document.getElementById('modal-co-templates')!.classList.contains('open')).toBe(true);
    const el = document.getElementById('co-templates')!;
    expect(el.querySelectorAll('.co-tpl-links .rlink')).toHaveLength(7);
    expect(el.querySelector('.co-tpl-to')?.textContent).toContain('To Sara Haddad');
    expect(el.querySelector('.co-tpl-mail')).toBeNull();
    expect(el.querySelectorAll('input, select, textarea')).toHaveLength(0);
  });

  it('picking one shows the subject and body, the unfilled parts marked, and Copy and Open in Outlook', async () => {
    coTemplatePick(1);
    const el = document.getElementById('co-templates')!;
    expect(el.querySelector('.co-tpl-subject')?.textContent).toBe('Contoso Test — our services Proposal');
    expect(el.querySelector('.co-tpl-body')?.textContent).toContain('Dear Sara,');
    expect([...el.querySelectorAll('.tpl-hole')].map((h) => h.textContent)).toContain('{where}');
    expect([...el.querySelectorAll('.co-tpl-mail button')].map((b) => b.textContent)).toEqual(['Copy', 'Open in Outlook']);
    expect((el.querySelector('.btn-primary') as HTMLButtonElement).disabled).toBe(false);
  });
});
