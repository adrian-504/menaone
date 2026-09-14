// Agreement page: the contract with a client — where it stands, the term,
// whether the service is running, the services and fees on it, the
// signature trail and activity. Active agreements make a company an active
// client and count towards MRR; the end date drives renewal alerts.

import { S } from '../lib/state';
import { escHtml, expose, fmtDate, today, showConfirm } from '../lib/utils';
import { icon } from '../lib/icons';
import { companyLink, recordLink } from '../lib/links';
import { toast, undoToast } from '../lib/ui';
import { persistAgreements } from '../lib/persist';
import { notifyNavigated, refreshAll, refreshCompanyViewIfOpen } from '../lib/registry';
import { getActivity } from '../lib/db';
import { attachCompanySelector } from '../lib/companySelector';
import { showMenuAt } from '../lib/contextMenu';
import { activityItem, renderFeed } from '../lib/activityFeed';
import { renderIcons } from '../core/chrome';
import { AGR_STATUSES, AGR_TYPES, SERVICE_STATUSES } from '../lib/constants';
import { renderLinesEditor } from '../lib/linesEditor';
import { agrBadge, updateAgrStatus } from '../core/agreements';
import { syncAgreementTotals, fmtMoney, currencyOf, agreementMonthly, teamMember, activeTeam, entityById, contractEndDate, lineTotals, isAgreementActive } from '../lib/commercial';
import type { Agreement } from '../lib/types';

const w = window as any;
const current = (): Agreement | undefined => S.agreements.find((a) => a.id === S.currentAgreementId);

export function openAgreementPage(id: number): void {
  if (!S.agreements.some((a) => a.id === id)) { toast('That agreement no longer exists', { tone: 'error' }); return; }
  const changed = S.currentAgreementId !== id;
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

const serviceTone = (s: string | null | undefined) => (s === 'Active' ? 'green' : s === 'Kickoff scheduled' ? 'accent' : s === 'Ended' ? 'muted' : 'amber');

export function renderAgreementPage(): void {
  const a = current();
  if (!a) return;
  const title = document.getElementById('agd-title');
  if (title) title.innerHTML = `${escHtml(a.agrRef || 'Agreement')}${a.agrRef ? `<button class="rec-icon-btn rec-title-copy" onclick="copyText('${escHtml(a.agrRef)}','Reference copied')" title="Copy reference" aria-label="Copy reference">${icon('copy', 14)}</button>` : ''}<span class="pr-title-services">${companyLink(a.companyId, a.client)}</span>`;
  const monthly = agreementMonthly(a);
  const badges = document.getElementById('agd-badges');
  if (badges) badges.innerHTML = [
    `<span class="rec-badge tone-${a.status === 'Signed' ? 'green' : a.status === 'Canceled' ? 'red' : 'amber'}">${escHtml(a.status || 'No status')}</span>`,
    a.serviceStatus ? `<span class="rec-badge tone-${serviceTone(a.serviceStatus)}">Service ${escHtml(a.serviceStatus.toLowerCase())}</span>` : '',
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

function renderProps(a: Agreement): void {
  const el = document.getElementById('agd-props');
  if (!el) return;
  const proposal = a.proposalId != null ? S.proposals.find((p) => p.id === a.proposalId) : undefined;
  const people: [string, string][] = [['', 'Not set'], ...activeTeam().map((t) => [String(t.id), t.name] as [string, string])];
  if (!a.preparedById && a.preparedBy?.trim()) people.push([`legacy:${a.preparedBy}`, `${a.preparedBy} (not in team)`]);
  el.innerHTML = [
    ['Reference', input('agrRef', 'text', a.agrRef || '')],
    ['Client', input('client', 'text', a.client || '')],
    ['Type', select('type', [['', 'Not set'], ...AGR_TYPES.map((t) => [t, t] as [string, string])], a.type || '')],
    ['Status', select('status', [...AGR_STATUSES.map((t) => [t, t] as [string, string]), ...(a.status && !AGR_STATUSES.includes(a.status) ? [[a.status, a.status] as [string, string]] : [])], a.status || '')],
    ['Prepared by', select('preparedById', people, a.preparedById ? String(a.preparedById) : a.preparedBy ? `legacy:${a.preparedBy}` : '')],
    ['Entity', select('businessEntityId', [['', 'Not set'], ...S.businessEntities.map((e) => [String(e.id), e.name] as [string, string])], a.businessEntityId ? String(a.businessEntityId) : '')],
    ['Currency', select('currency', [...new Set(['SAR', 'EUR', 'USD', ...S.businessEntities.map((e) => e.currency)])].map((c) => [c, c] as [string, string]), currencyOf(a))],
    ['Proposal', proposal ? recordLink('proposal', proposal.id, `SL# ${proposal.id} · ${proposal.type || 'Proposal'}`) : '<span class="rec-muted">Not linked</span>'],
    ['In HubSpot', select('hubspot', [['', 'Not set'], ['Yes', 'Yes'], ['No', 'No'], ['Maybe', 'Maybe']], a.hubspot || '')],
    ['Document', input('docLink', 'url', a.docLink || '', 'OneDrive or SharePoint link')],
    ['Remarks', `<textarea class="td-input pr-remarks" rows="2" onchange="${onChange('remarks')}">${escHtml(a.remarks || '')}</textarea>`],
  ].map(([label, control]) => `<dt>${label}</dt><dd>${control}</dd>`).join('');
  const client = document.getElementById('agd-f-client') as HTMLInputElement | null;
  if (client) attachCompanySelector(client, { onSelect: (name) => agreementFieldChanged('client', name) });
}

function renderTerm(a: Agreement): void {
  const el = document.getElementById('agd-term');
  if (!el) return;
  const months = [3, 6, 12, 24, 36];
  const active = isAgreementActive(a);
  el.innerHTML = [
    ['Service', select('serviceStatus', [['', 'Not set'], ...SERVICE_STATUSES.map((s) => [s, s] as [string, string])], a.serviceStatus || '')],
    ['Start', input('startDate', 'date', a.startDate || '')],
    ['Term', select('contractMonths', [['', 'Not set'], ...months.map((m) => [String(m), `${m} months`] as [string, string]), ...(a.contractMonths && !months.includes(a.contractMonths) ? [[String(a.contractMonths), `${a.contractMonths} months`] as [string, string]] : [])], a.contractMonths ? String(a.contractMonths) : '')],
    ['End', `${input('endDate', 'date', a.endDate || '')}${a.startDate && a.contractMonths && !a.endDate ? `<button class="rec-add-link" onclick="agreementFieldChanged('endDate','${contractEndDate(a.startDate, a.contractMonths)}')">Use ${fmtDate(contractEndDate(a.startDate, a.contractMonths))}</button>` : ''}`],
    ['Auto-renews', select('autoRenew', [['no', 'No'], ['yes', 'Yes']], a.autoRenew ? 'yes' : 'no')],
    ['Notice', `${input('noticeDays', 'number', a.noticeDays != null ? String(a.noticeDays) : '', 'Days')}`],
  ].map(([label, control]) => `<dt>${label}</dt><dd>${control}</dd>`).join('')
    + `<dt>Counts as</dt><dd class="rec-prop-text">${active ? '<span class="t-positive">Active client · in MRR</span>' : '<span class="rec-muted">Not active — set the service to Active once it has started</span>'}</dd>`;
}

function renderLines(a: Agreement): void {
  const count = document.getElementById('agd-lines-count'); if (count) count.textContent = (a.lines || []).length ? String(a.lines!.length) : '';
  renderLinesEditor(`agreement:${a.id}`, 'agd-lines', {
    lines: () => a.lines || [],
    setLines: (lines) => { a.lines = lines; },
    currency: () => currencyOf(a),
    contractMonths: () => a.contractMonths,
    editable: true,
    onChange: () => {
      commit(a, false);
      const badges = document.getElementById('agd-badges');
      if (badges) { const m = lineTotals(a.lines, a.contractMonths).monthly; badges.querySelector('.rec-meta')?.replaceWith(Object.assign(document.createElement('span'), { className: 'rec-meta', textContent: m ? `${fmtMoney(m, currencyOf(a))}/mo` : '' })); }
    },
  });
}

function renderDates(a: Agreement): void {
  const el = document.getElementById('agd-dates');
  if (!el) return;
  el.innerHTML = [
    ['Prepared', 'datePrepared'], ['Sent to client', 'dateSentToClient'], ['Client signed', 'dateClientSigned'],
    ['MENA BIG signed', 'dateMenaSigned'], ['Filed', 'dateFiled'], ['Next action', 'actionDate'],
  ].map(([label, key]) => `<dt>${label}</dt><dd>${input(key, 'date', ((a as any)[key] as string) || '')}</dd>`).join('');
}

async function renderActivity(a: Agreement): Promise<void> {
  const el = document.getElementById('agd-activity');
  if (!el) return;
  const entries = await getActivity({ entityType: 'agreement', entityId: a.id, limit: 100 }).catch(() => []);
  if (S.currentAgreementId !== a.id) return;
  el.innerHTML = renderFeed(entries.map(activityItem), { empty: 'Nothing recorded yet.' });
  renderIcons(el);
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
