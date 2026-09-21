// Agreement page: the contract with a client — where it stands, the term,
// whether the service is running, the services and fees on it, the
// signature trail and activity. Active agreements make a company an active
// client and count towards MRR; the end date drives renewal alerts.

import { statusBadge } from '../lib/statusTone';
import { S } from '../lib/state';
import { escHtml, expose, fmtDate, today, showConfirm } from '../lib/utils';
import { icon } from '../lib/icons';
import { companyLink, recordLink } from '../lib/links';
import { toast, undoToast } from '../lib/ui';
import { persistAgreements } from '../lib/persist';
import { notifyNavigated, refreshAll, refreshCompanyViewIfOpen } from '../lib/registry';
import { attachCompanySelector } from '../lib/companySelector';
import { showMenuAt } from '../lib/contextMenu';
import { renderRecordTimeline, renderThreadStrip } from './recordThread';
import { renderIcons } from '../core/chrome';
import { AGR_STATUSES, AGR_TYPES, SERVICE_STATUSES } from '../lib/constants';
import { renderLinesEditor } from '../lib/linesEditor';
import { endPropsEdit, mountPropsList, propsEditButton, propsListHtml, resetPropsLists, type PropField } from '../lib/propsList';
import { agrBadge, updateAgrStatus } from '../core/agreements';
import { syncAgreementTotals, fmtMoney, currencyOf, agreementMonthly, teamMember, activeTeam, entityById, contractEndDate, lineTotals, isAgreementActive } from '../lib/commercial';
import { proposalProject } from '../lib/workGraph';
import type { Agreement } from '../lib/types';

const w = window as any;
const current = (): Agreement | undefined => S.agreements.find((a) => a.id === S.currentAgreementId);

export function openAgreementPage(id: number): void {
  if (!S.agreements.some((a) => a.id === id)) { toast('That agreement no longer exists', { tone: 'error' }); return; }
  const changed = S.currentAgreementId !== id;
  if (changed) { resetPropsLists('agd-'); linesEditing = false; }
  S.currentAgreementId = id;
  document.getElementById('agr-list-view')?.classList.add('hidden');
  document.getElementById('agr-detail')?.classList.add('open');
  if (changed) window.scrollTo(0, 0);
  renderAgreementPage();
  notifyNavigated();
}
expose('openAgreementPage', openAgreementPage);

export function closeAgreementPage(): void {
  if (S.currentAgreementId == null) return;
  S.currentAgreementId = null;
  document.getElementById('agr-detail')?.classList.remove('open');
  document.getElementById('agr-list-view')?.classList.remove('hidden');
  notifyNavigated();
  w.renderAgreements?.();
}
expose('closeAgreementPage', closeAgreementPage);

function savedFlash(): void {
  const el = document.getElementById('agd-save-state');
  if (el) { el.textContent = 'Saved'; window.setTimeout(() => { if (el.textContent === 'Saved') el.textContent = ''; }, 1500); }
}

function commit(a: Agreement, rerender = true): void {
  syncAgreementTotals(a);
  persistAgreements();
  savedFlash();
  agrBadge();
  refreshCompanyViewIfOpen();
  if (rerender) renderAgreementPage();
}


export function renderAgreementPage(): void {
  const a = current();
  if (!a) return;
  const title = document.getElementById('agd-title');
  if (title) title.innerHTML = `${escHtml(a.agrRef || 'Agreement')}${a.agrRef ? `<button class="rec-icon-btn rec-title-copy" onclick="copyText('${escHtml(a.agrRef)}','Reference copied')" title="Copy reference" aria-label="Copy reference">${icon('copy', 14)}</button>` : ''}<span class="pr-title-services">${companyLink(a.companyId, a.client)}</span>`;
  const monthly = agreementMonthly(a);
  const badges = document.getElementById('agd-badges');
  if (badges) badges.innerHTML = [
    statusBadge('agreement', a.status),
    a.serviceStatus ? statusBadge('service', a.serviceStatus, `Service ${a.serviceStatus.toLowerCase()}`) : '',
    monthly ? `<span class="rec-meta">${fmtMoney(monthly, currencyOf(a))}/mo</span>` : '',
    a.endDate ? `<span class="rec-meta">Ends ${fmtDate(a.endDate)}</span>` : '',
  ].filter(Boolean).join('');
  const actions = document.getElementById('agd-actions');
  if (actions) {
    const primary = a.status !== 'Signed' && a.status !== 'Canceled'
      ? `<button class="btn-primary" onclick="agreementMarkSigned()">Mark signed</button>`
      : a.serviceStatus !== 'Active' && a.status === 'Signed'
        ? `<button class="btn-primary" onclick="agreementFieldChanged('serviceStatus','Active')">Service started</button>` : '';
    actions.innerHTML = `${primary}<button class="loc-nav rec-more" onclick="agreementMoreMenu(event)" title="More" aria-label="More">${icon('more', 16)}</button>`;
  }
  renderThreadStrip('agd-thread', { kind: 'agreement', id: a.id });
  renderProps(a);
  renderTerm(a);
  renderLines(a);
  renderDates(a);
  void renderActivity(a);
  const page = document.getElementById('agr-detail'); if (page) renderIcons(page);
}
expose('renderAgreementPage', renderAgreementPage);

const opt = (value: string, label: string, selected: string) => `<option value="${escHtml(value)}"${value === selected ? ' selected' : ''}>${escHtml(label)}</option>`;
const onChange = (key: string) => `agreementFieldChanged('${key}', this.value)`;
const input = (key: string, type: string, value: string, placeholder = '') => `<input class="td-input" id="agd-f-${key}" type="${type}" value="${escHtml(value)}" placeholder="${escHtml(placeholder)}" onchange="${onChange(key)}" onkeydown="if(event.key==='Enter')this.blur()">`;
const select = (key: string, options: [string, string][], value: string) => `<select class="td-select" id="agd-f-${key}" onchange="${onChange(key)}">${options.map(([v, l]) => opt(v, l, value)).join('')}</select>`;

const text = (v: string | null | undefined) => (v ? escHtml(v) : '');
const dateText = (v: string | null | undefined) => (v ? escHtml(fmtDate(v)) : '');

/** Renders a read-first list into `elId`, with its Edit/Done in `actId`. */
function readList(elId: string, actId: string, fields: PropField[], rerender: () => void): void {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = propsListHtml(elId, fields, rerender);
  const act = document.getElementById(actId);
  if (act) act.innerHTML = fields.some((f) => f.control) ? propsEditButton(elId) : '';
  mountPropsList(elId);
}
const again = (fn: (a: Agreement) => void) => () => { const a = current(); if (a) fn(a); };

function renderProps(a: Agreement): void {
  const proposal = a.proposalId != null ? S.proposals.find((p) => p.id === a.proposalId) : undefined;
  // Agreement → proposal → opportunity → project, by id.
  const opportunity = proposal ? S.opportunities.find((o) => o.proposalId === proposal.id) : undefined;
  const project = proposal ? proposalProject(S, proposal.id) : undefined;
  const people: [string, string][] = [['', 'Not set'], ...activeTeam().map((t) => [String(t.id), t.name] as [string, string])];
  if (!a.preparedById && a.preparedBy?.trim()) people.push([`legacy:${a.preparedBy}`, `${a.preparedBy} (not in team)`]);
  const entity = entityById(a.businessEntityId);
  const fields: PropField[] = [
    { key: 'agrRef', label: 'Reference', display: text(a.agrRef), always: true, control: () => input('agrRef', 'text', a.agrRef || '') },
    { key: 'client', label: 'Client', display: a.client ? companyLink(a.companyId, a.client) : '', always: true, control: () => input('client', 'text', a.client || ''),
      mount: (dd) => { const el = dd.querySelector<HTMLInputElement>('input'); if (el) attachCompanySelector(el, { onSelect: (name) => { endPropsEdit(); void agreementFieldChanged('client', name); } }); } },
    { key: 'type', label: 'Type', display: text(a.type), control: () => select('type', [['', 'Not set'], ...AGR_TYPES.map((t) => [t, t] as [string, string])], a.type || '') },
    { key: 'status', label: 'Status', display: text(a.status), always: true, control: () => select('status', [...AGR_STATUSES.map((t) => [t, t] as [string, string]), ...(a.status && !AGR_STATUSES.includes(a.status) ? [[a.status, a.status] as [string, string]] : [])], a.status || '') },
    { key: 'preparedById', label: 'Prepared by', display: text(teamMember(a.preparedById)?.name || a.preparedBy), control: () => select('preparedById', people, a.preparedById ? String(a.preparedById) : a.preparedBy ? `legacy:${a.preparedBy}` : '') },
    { key: 'businessEntityId', label: 'Entity', display: text(entity?.name), control: () => select('businessEntityId', [['', 'Not set'], ...S.businessEntities.map((e) => [String(e.id), e.name] as [string, string])], a.businessEntityId ? String(a.businessEntityId) : '') },
    // The entity's own currency goes without saying.
    { key: 'currency', label: 'Currency', display: entity && entity.currency === currencyOf(a) ? '' : text(currencyOf(a)), control: () => select('currency', [...new Set(['SAR', 'EUR', 'USD', ...S.businessEntities.map((e) => e.currency)])].map((c) => [c, c] as [string, string]), currencyOf(a)) },
    { key: 'proposal', label: 'Proposal', display: proposal ? recordLink('proposal', proposal.id, `SL# ${proposal.id} · ${proposal.type || 'Proposal'}`) : '' },
    { key: 'opportunity', label: 'Opportunity', display: opportunity ? recordLink('opportunity', opportunity.id, opportunity.name) : '' },
    { key: 'project', label: 'Project', display: project ? recordLink('project', project.id, project.name) : '' },
    { key: 'hubspot', label: 'In HubSpot', display: text(a.hubspot), control: () => select('hubspot', [['', 'Not set'], ['Yes', 'Yes'], ['No', 'No'], ['Maybe', 'Maybe']], a.hubspot || '') },
    { key: 'docLink', label: 'Document', display: a.docLink ? `<a href="#" class="rlink" onclick="event.preventDefault();openExternalUrl('${escHtml(a.docLink)}')">Open document</a>` : '', control: () => input('docLink', 'url', a.docLink || '', 'OneDrive or SharePoint link') },
    { key: 'remarks', label: 'Remarks', display: a.remarks ? `<span class="pl-multiline">${escHtml(a.remarks)}</span>` : '', control: () => `<textarea class="td-input pr-remarks" rows="2" onchange="${onChange('remarks')}">${escHtml(a.remarks || '')}</textarea>` },
  ];
  readList('agd-props', 'agd-props-act', fields, again(renderProps));
}

function renderTerm(a: Agreement): void {
  const months = [3, 6, 12, 24, 36];
  const active = isAgreementActive(a);
  const suggestedEnd = a.startDate && a.contractMonths && !a.endDate ? contractEndDate(a.startDate, a.contractMonths) : null;
  const fields: PropField[] = [
    { key: 'serviceStatus', label: 'Service', display: text(a.serviceStatus), always: true, control: () => select('serviceStatus', [['', 'Not set'], ...SERVICE_STATUSES.map((st) => [st, st] as [string, string])], a.serviceStatus || '') },
    { key: 'startDate', label: 'Start', display: dateText(a.startDate), control: () => input('startDate', 'date', a.startDate || '') },
    { key: 'contractMonths', label: 'Term', display: a.contractMonths ? `${a.contractMonths} months` : '', control: () => select('contractMonths', [['', 'Not set'], ...months.map((m) => [String(m), `${m} months`] as [string, string]), ...(a.contractMonths && !months.includes(a.contractMonths) ? [[String(a.contractMonths), `${a.contractMonths} months`] as [string, string]] : [])], a.contractMonths ? String(a.contractMonths) : '') },
    { key: 'endDate', label: 'End', always: !!suggestedEnd,
      display: a.endDate ? dateText(a.endDate) : suggestedEnd ? `<button class="rec-add-link" onclick="agreementFieldChanged('endDate','${suggestedEnd}')">Use ${escHtml(fmtDate(suggestedEnd))}</button>` : '',
      control: () => input('endDate', 'date', a.endDate || '') },
    { key: 'autoRenew', label: 'Auto-renews', display: a.autoRenew ? 'Yes' : '', control: () => select('autoRenew', [['no', 'No'], ['yes', 'Yes']], a.autoRenew ? 'yes' : 'no') },
    { key: 'noticeDays', label: 'Notice', display: a.noticeDays != null ? `${a.noticeDays} days` : '', control: () => input('noticeDays', 'number', a.noticeDays != null ? String(a.noticeDays) : '', 'Days') },
    { key: 'countsAs', label: 'Counts as', display: active ? '<span class="t-positive">Active client · in MRR</span>' : '<span class="rec-muted">Not active — set the service to Active once it has started</span>' },
  ];
  readList('agd-term', 'agd-term-act', fields, again(renderTerm));
}

// The services table reads; Edit opens the line editor.
let linesEditing = false;

export function toggleAgreementLines(): void {
  linesEditing = !linesEditing;
  const a = current(); if (a) renderLines(a);
}
expose('toggleAgreementLines', toggleAgreementLines);

function renderLines(a: Agreement): void {
  const count = document.getElementById('agd-lines-count'); if (count) count.textContent = (a.lines || []).length ? String(a.lines!.length) : '';
  const act = document.getElementById('agd-lines-act');
  const editing = linesEditing || !(a.lines || []).length;
  if (act) act.innerHTML = (a.lines || []).length ? `<button class="btn-ghost btn-sm" onclick="toggleAgreementLines()" aria-pressed="${linesEditing}">${linesEditing ? 'Done' : 'Edit'}</button>` : '';
  renderLinesEditor(`agreement:${a.id}`, 'agd-lines', {
    lines: () => a.lines || [],
    setLines: (lines) => { a.lines = lines; },
    currency: () => currencyOf(a),
    contractMonths: () => a.contractMonths,
    editable: editing,
    onChange: () => {
      commit(a, false);
      const badges = document.getElementById('agd-badges');
      if (badges) { const m = lineTotals(a.lines, a.contractMonths).monthly; badges.querySelector('.rec-meta')?.replaceWith(Object.assign(document.createElement('span'), { className: 'rec-meta', textContent: m ? `${fmtMoney(m, currencyOf(a))}/mo` : '' })); }
    },
  });
}

function renderDates(a: Agreement): void {
  const fields: PropField[] = ([
    ['Prepared', 'datePrepared'], ['Sent to client', 'dateSentToClient'], ['Client signed', 'dateClientSigned'],
    ['MENA BIG signed', 'dateMenaSigned'], ['Filed', 'dateFiled'], ['Next action', 'actionDate'],
  ] as const).map(([label, key]) => ({ key, label, display: dateText((a as any)[key]), control: () => input(key, 'date', ((a as any)[key] as string) || '') }));
  readList('agd-dates', 'agd-dates-act', fields, again(renderDates));
}

async function renderActivity(a: Agreement): Promise<void> {
  const el = document.getElementById('agd-activity');
  if (!el) return;
  await renderRecordTimeline({ elId: 'agd-activity', record: { kind: 'agreement', id: a.id }, scopeToggle: false });
}

export async function agreementFieldChanged(key: string, value: string): Promise<void> {
  const a = current();
  if (!a) return;
  const v = value.trim();
  switch (key) {
    case 'status':
      updateAgrStatus(a.id, v);
      renderAgreementPage();
      return;
    case 'client':
      if (!v) { toast('An agreement needs a client', { tone: 'error' }); renderAgreementPage(); return; }
      a.client = v;
      break;
    case 'preparedById':
      if (v.startsWith('legacy:')) return;
      a.preparedById = v ? Number(v) : null;
      a.preparedBy = teamMember(a.preparedById)?.name ?? '';
      break;
    case 'businessEntityId': {
      a.businessEntityId = v ? Number(v) : null;
      const entity = entityById(a.businessEntityId);
      if (entity && entity.currency !== currencyOf(a) && await showConfirm(`${entity.name} bills in ${entity.currency}. Switch this agreement to ${entity.currency}? Fees are not converted.`, { title: 'Change currency?', confirmLabel: `Use ${entity.currency}` })) a.currency = entity.currency;
      break;
    }
    case 'startDate':
      a.startDate = v || null;
      if (a.startDate && a.contractMonths && !a.endDate) a.endDate = contractEndDate(a.startDate, a.contractMonths);
      break;
    case 'contractMonths':
      a.contractMonths = v ? Number(v) : null;
      if (a.startDate && a.contractMonths) a.endDate = contractEndDate(a.startDate, a.contractMonths);
      break;
    case 'autoRenew': a.autoRenew = v === 'yes'; break;
    case 'noticeDays': a.noticeDays = v ? Math.max(0, Math.round(Number(v))) : null; break;
    case 'serviceStatus':
      a.serviceStatus = (v || null) as Agreement['serviceStatus'];
      if (v === 'Active' && !a.startDate) a.startDate = today();
      break;
    case 'docLink': a.docLink = v || null; break;
    case 'agrRef': case 'type': case 'currency': case 'hubspot': case 'remarks': case 'endDate':
    case 'datePrepared': case 'dateSentToClient': case 'dateClientSigned': case 'dateMenaSigned': case 'dateFiled': case 'actionDate':
      (a as any)[key] = v || (key === 'endDate' || key === 'currency' ? null : '');
      break;
    default: return;
  }
  commit(a);
}
expose('agreementFieldChanged', agreementFieldChanged);

export function agreementMarkSigned(): void {
  const a = current();
  if (!a) return;
  updateAgrStatus(a.id, 'Signed');
  renderAgreementPage();
  toast('Agreement signed', { tone: 'success' });
}
expose('agreementMarkSigned', agreementMarkSigned);

export function agreementMoreMenu(e: MouseEvent): void {
  e.stopPropagation();
  const a = current();
  if (!a) return;
  showMenuAt(e.currentTarget as HTMLElement, [
    ...(a.serviceStatus !== 'Ended' ? [{ label: 'Service ended', iconName: 'archive', run: () => void agreementFieldChanged('serviceStatus', 'Ended') }] : []),
    ...(a.status !== 'On Hold' ? [{ label: 'Put on hold', iconName: 'clock', run: () => void agreementFieldChanged('status', 'On Hold') }] : []),
    ...(a.status !== 'Canceled' ? [{ label: 'Cancel agreement', iconName: 'close', run: () => void agreementFieldChanged('status', 'Canceled') }] : []),
    { label: '', run: () => {}, separator: true },
    { label: 'Delete agreement', iconName: 'trash', danger: true, run: () => void deleteAgreementFromPage(a.id) },
  ]);
}
expose('agreementMoreMenu', agreementMoreMenu);

async function deleteAgreementFromPage(id: number): Promise<void> {
  const index = S.agreements.findIndex((a) => a.id === id);
  if (index < 0) return;
  const a = S.agreements[index];
  const fromWon = a.proposalId != null && S.proposals.some((p) => p.id === a.proposalId && p.status === 'Signed by Both Parties');
  const note = fromWon ? `\n\nIts proposal (SL# ${a.proposalId}) is still marked as signed by both parties, so MENA One will create a new agreement for it. To stop that, change the proposal's status first.` : '';
  if (!(await showConfirm(`Delete agreement ${a.agrRef || ''} for ${a.client || 'this client'}?${note}`, { title: 'Delete agreement?', confirmLabel: 'Delete' }))) return;
  const [removed] = S.agreements.splice(index, 1);
  persistAgreements();
  closeAgreementPage();
  refreshAll();
  undoToast(`Deleted agreement ${removed.agrRef || ''}`, () => {
    S.agreements.splice(Math.min(index, S.agreements.length), 0, removed);
    persistAgreements();
    refreshAll();
  });
}
