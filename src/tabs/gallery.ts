// Component Gallery — dev builds only (imported behind import.meta.env.DEV
// in main.ts, so it never ships). One page showing every shared component in
// the current theme, to review consistency and each theme side by side.

import { S } from '../lib/state';
import { expose, kpiCard, badge, showConfirm, escHtml } from '../lib/utils';
import { registerTabRenderer } from '../lib/registry';
import { THEMES } from '../core/theme';
import { renderIcons } from '../core/chrome';
import { showContextMenu } from '../lib/contextMenu';
import { recordLink, companyLink } from '../lib/links';
import { toast, undoToast, emptyState, skeleton } from '../lib/ui';
import { taskRowHtml } from './todo';

function section(title: string, body: string, note = ''): string {
  return `<section class="sec" style="margin-bottom:var(--space-4)">
    <div class="card-hd">${title}</div>
    ${note ? `<div class="empty-state-body" style="text-align:left;margin:-6px 0 12px">${note}</div>` : ''}
    ${body}
  </section>`;
}

const row = (html: string) => `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">${html}</div>`;

function renderGallery(): void {
  const el = document.getElementById('gallery-body');
  if (!el) return;
  const company = S.companies[0];
  const project = S.projects[0];
  const opp = S.opportunities[0];
  const contact = S.contacts[0];
  const tokens = ['--bg', '--surface', '--surface-2', '--border', '--text', '--sub', '--muted', '--accent', '--accent-2', '--green', '--amber', '--red'];

  el.innerHTML = [
    section('Themes', row(THEMES.map((t) => `<button class="${t.id === S.theme ? 'btn-primary' : 'btn-secondary'}" onclick="setTheme('${t.id}')">${t.name}</button>`).join('')), 'Switch themes here and scroll the page — every component below should read well in all six.'),
    section('Colour tokens', row(tokens.map((t) => `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;font-size:var(--type-meta);color:var(--sub)"><div style="width:56px;height:36px;border-radius:8px;border:1px solid var(--border2);background:var(${t})"></div>${t}</div>`).join(''))),
    section('Type scale', ['title', 'section', 'heading', 'body', 'secondary', 'meta', 'caption'].map((t) => `<div style="font-size:var(--type-${t});${t === 'title' || t === 'section' ? 'font-weight:700' : t === 'heading' ? 'font-weight:600' : ''};margin-bottom:6px">--type-${t} · Proposal for Providing Workforce Services</div>`).join('')),
    section('Buttons', row(`<button class="btn-primary">Primary</button><button class="btn-secondary">Secondary</button><button class="btn-danger">Danger</button><button class="btn-secondary btn-sm">Small</button><button class="btn-primary" disabled>Disabled</button>`)),
    section('Inputs', row(`<input type="text" placeholder="Text input"><select class="fsel"><option>Select</option></select><select class="ssel"><option>Filter select</option></select><input type="date"><textarea class="fsel" rows="2" placeholder="Textarea"></textarea>`)),
    section('Segmented control', `<div class="segmented"><button class="active">All</button><button>Client</button><button>Internal</button></div>`),
    section('Chips and badges', row(`<span class="chip">Chip</span><span class="chip chip-accent">Accent chip</span>${badge('Sent to Client')}${badge('Signed by Both Parties')}`)),
    section('Record links', row([
      company ? companyLink(company.id, company.name) : '',
      project ? recordLink('project', project.id, project.name) : '',
      opp ? recordLink('opportunity', opp.id, opp.name, { chip: true }) : '',
      contact ? recordLink('contact', contact.id, contact.name, { chip: true }) : '',
    ].join('')), 'Every mention of a record uses these. Hover for a preview; click to open it.'),
    section('Task rows', `<div class="task-group" style="max-width:640px">${S.todos.slice(0, 3).map((t) => taskRowHtml(t, { compact: true })).join('')}</div>`, 'The same row everywhere a task appears: Tasks, company and project pages. High priority is a red ring; hover shows the date and more buttons in the Tasks list.'),
    section('Note rows', `<div class="notes-list notes-list-embedded" style="max-width:320px">${S.notes.slice(0, 2).map((n) => `<div class="note-item"><div class="note-item-title">${escHtml(n.title || 'Untitled')}</div><div class="note-item-preview">${escHtml((n.content || '').replace(/[#*_>`-]/g, '').slice(0, 120))}</div><div class="note-item-meta"><span>${escHtml(n.updatedAt || '')}</span></div></div>`).join('')}</div>`),
    section('KPI cards', `<div class="kpi-row">${kpiCard('Active pipeline', '12', 'Excl. leads & closed')}${kpiCard('Signed', '4', 'This quarter')}</div>`),
    section('Empty states', `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div class="sec">${emptyState({ icon: 'check', title: 'No tasks for today', body: 'Anything due today or overdue shows up here.', action: { label: 'New task', onclick: 'openTodoModal(null)' } })}</div><div class="sec">${emptyState({ icon: 'note', title: 'No notes yet', compact: true })}</div></div>`),
    section('Loading skeletons', `${skeleton(3)}<div style="height:12px"></div>${skeleton(3, 'cards')}`),
    section('Feedback', row(`<button class="btn-secondary" onclick="galleryToast('neutral')">Toast</button><button class="btn-secondary" onclick="galleryToast('success')">Success toast</button><button class="btn-secondary" onclick="galleryToast('error')">Error toast</button><button class="btn-secondary" onclick="galleryToast('undo')">Undo toast</button><button class="btn-secondary" onclick="galleryConfirm()">Confirm dialog</button><button class="btn-secondary" oncontextmenu="galleryMenu(event)" onclick="galleryMenu(event)">Context menu</button>`), 'Toasts replace alert(); destructive actions that can be reversed use Undo instead of a confirm.'),
  ].join('');
  renderIcons(el);
}

registerTabRenderer('gallery', renderGallery);

expose('galleryToast', (kind: string) => {
  if (kind === 'undo') undoToast('Deleted "Call Globex about renewal"', () => toast('Restored', { tone: 'success' }));
  else if (kind === 'error') toast('Could not sync with Outlook', { tone: 'error', detail: 'The network connection was lost.' });
  else if (kind === 'success') toast('Backup restored', { tone: 'success' });
  else toast('Link copied');
});
expose('galleryConfirm', () => { void showConfirm('This cannot be undone.', { title: 'Delete company?', confirmLabel: 'Delete' }); });
expose('galleryMenu', (e: MouseEvent) => showContextMenu(e, [
  { label: 'Open', iconName: 'briefcase', run: () => {} },
  { label: 'Edit', iconName: 'edit', run: () => {} },
  { label: '', run: () => {}, separator: true },
  { label: 'Delete', iconName: 'trash', danger: true, run: () => {} },
]));
