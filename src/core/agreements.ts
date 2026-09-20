import { S } from '../lib/state';
import { statusBadge } from '../lib/statusTone';
import { companyLink } from '../lib/links';
import { AGR_STATUSES, AGR_TYPES, AGR_ST, SERVICE_STATUSES } from '../lib/constants';
import { today, fmtDate, daysUntil, escHtml, nextAgrId, expose, kpiCard, showConfirm } from '../lib/utils';
import { emptyState } from '../lib/ui';
import { activeMrr, renewalsDue, isAgreementActive, fmtMoneyByCurrency, fmtMoney, currencyOf, agreementMonthly, teamMember, activeTeam, entityById, defaultEntity, contractEndDate } from '../lib/commercial';
import { matchesPeriod } from '../lib/period';
import { persistAgreements, proposalsAndAgreementsSaved, markAgreementsSaved } from '../lib/persist';
import { createAgreementsFromProposals, pendingAgreementsFromProposals, type PendingAgreement } from '../lib/db';
import { registerBadgeUpdater, registerTabRenderer, refreshCompanyViewIfOpen, getActiveTabId, refreshAll } from '../lib/registry';
import { saveCsv } from '../lib/files';
import { toast } from '../lib/ui';
import { attachCompanySelector } from '../lib/companySelector';
import type { Agreement } from '../lib/types';

// Proposal type → Agreement type mapping
export function proposalTypeToAgrType(ptype: string | null | undefined): string {
  const t = (ptype || '').toLowerCase();
  if (t.includes('workforce') || t.includes('recruit') || t.includes('manpower') || t.includes('staffing') || t.includes('mobiliz') || t.includes('dedicated')) return 'Workforce';
  if (t.includes('admin') || t.includes('payroll') || t.includes('gosi') || t.includes('pro') || t.includes('gm rep')) return 'Administration';
  if (t.includes('account') || t.includes('vat') || t.includes('finance')) return 'Accountancy';
  if (t.includes('company maintenance') || t.includes('maintenance')) return 'Company Maintenance';
  if (t.includes('company constitution') || t.includes('constitution')) return 'Company Constitution';
  if (t.includes('consult')) return 'Consultancy';
  return 'Other';
}

// Auto-generate AGR# from client + type + date
export function genAgrRef(client: string, type: string, date?: string | null): string {
  const prefix = (client || '').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase();
  const typeCode = type === 'Workforce' ? 'WF' : type === 'Administration' ? 'ADM' : type === 'Accountancy' ? 'ACC' : type === 'Company Maintenance' ? 'CM' : type === 'Company Constitution' ? 'CC' : type === 'Consultancy' ? 'CON' : 'OTH';
  const d = date ? new Date(date + 'T12:00:00') : new Date();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const yr = String(d.getFullYear()).slice(2);
  // Follow the highest existing number (not the count) so a deleted agreement's reference is never reused.
  const stem = `${prefix}_${typeCode}_`;
  const maxSeq = S.agreements.reduce((max, a) => {
    if (!a.agrRef?.startsWith(stem)) return max;
    const n = parseInt(a.agrRef.slice(stem.length).split('_')[0], 10);
    return Number.isNaN(n) ? max : Math.max(max, n);
  }, 0);
  const seq = String(maxSeq + 1).padStart(3, '0');
  return `${stem}${seq}_${mo}${yr}`;
}

/** Asks the backend to create an agreement for every proposal at a qualifying
 * status that has none yet (idempotent), then adds any new ones to the view. */
/** Drafts an agreement for each signed proposal that has none — on request,
 * never on its own. This used to run at every start and had quietly created
 * 55 of the owner's 107 agreements; agreements are now only created when
 * someone asks for them, and the list is shown before anything is written. */
export async function draftAgreementsFromProposals(): Promise<void> {
  await proposalsAndAgreementsSaved();
  let pending: PendingAgreement[];
  try {
    pending = await pendingAgreementsFromProposals();
  } catch (err) {
    toast('Could not check the proposals', { tone: 'error', detail: String(err) });
    return;
  }
  if (pending.length === 0) {
    toast('Nothing to draft', { detail: 'Every signed proposal already has an agreement.' });
    return;
  }
  const names = [...new Set(pending.map((p) => p.client))];
  const shown = names.slice(0, 8).join(', ');
  const ok = await showConfirm(
    `${pending.length} signed proposal${pending.length === 1 ? '' : 's'} ${pending.length === 1 ? 'has' : 'have'} no agreement: ${shown}${names.length > 8 ? `, and ${names.length - 8} more` : ''}.\n\nDraft ${pending.length === 1 ? 'an agreement' : 'agreements'} in Preparation, with the proposal's price lines?`,
    { title: 'Draft agreements from proposals', confirmLabel: `Draft ${pending.length}` },
  );
  if (!ok) return;
  let created: Agreement[];
  try {
    created = await createAgreementsFromProposals();
  } catch (err) {
    toast('Could not draft the agreements', { tone: 'error', detail: String(err) });
    return;
  }
  S.agreements.push(...created);
  markAgreementsSaved(created);
  refreshAll();
  toast(`Drafted ${created.length} agreement${created.length === 1 ? '' : 's'}`, { detail: 'Each one is In Preparation — check the terms before sending.' });
}
expose('draftAgreementsFromProposals', draftAgreementsFromProposals);

export function agrBadge(): void {
  const inProgress = S.agreements.filter((a) => !['Signed', 'Canceled'].includes(a.status || '')).length;
  const el = document.getElementById('agr-badge');
  if (el) { el.textContent = String(inProgress); el.style.display = inProgress > 0 ? '' : 'none'; }
}
registerBadgeUpdater(agrBadge);
expose('agrBadge', agrBadge);

const preparedByName = (a: Agreement) => teamMember(a.preparedById)?.name || (a.preparedBy || '').trim();

export function renderAgreements(): void {
  if (S.currentAgreementId != null && document.getElementById('agr-detail')?.classList.contains('open')) { (window as any).renderAgreementPage?.(); return; }
  const search = (document.getElementById('agr-search') as HTMLInputElement).value.toLowerCase();
  const status = (document.getElementById('agr-status') as HTMLSelectElement).value;
  const service = (document.getElementById('agr-service') as HTMLSelectElement | null)?.value || '';
  const type = (document.getElementById('agr-type') as HTMLSelectElement).value;
  const prep = (document.getElementById('agr-prep') as HTMLSelectElement).value;
  const data = S.agreements.filter((a) => {
    if (S.globalPeriod !== 'all') {
      const ad = a.startDate || a.actionDate || a.createdAt;
      if (!matchesPeriod(ad)) return false;
    }
    if (status && a.status !== status) return false;
    if (service === 'none' ? !!a.serviceStatus : service && a.serviceStatus !== service) return false;
    if (type && a.type !== type) return false;
    if (prep && preparedByName(a) !== prep) return false;
    if (search) {
      const hay = [a.client, a.agrRef, a.type, a.remarks, ...(a.lines || []).map((l) => l.serviceName)].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  }).sort((a, b) => (b.startDate || b.createdAt || '').localeCompare(a.startDate || a.createdAt || '') || b.id - a.id);
  const cntEl = document.getElementById('agr-cnt'); if (cntEl) cntEl.textContent = `${data.length} agreement${data.length !== 1 ? 's' : ''}`;

  const mrr = activeMrr(data);
  const ending = renewalsDue(60).filter((a) => data.includes(a)).length;
  const summaryDefs = [
    { lbl: 'In preparation', val: data.filter((a) => ['In Preparation', 'Client Review'].includes(a.status || '')).length },
    { lbl: 'Awaiting signature', val: data.filter((a) => ['Client Signature', 'MENA Signature'].includes(a.status || '')).length, signal: 'warning' as const },
    { lbl: 'Signed', val: data.filter((a) => a.status === 'Signed').length, signal: 'positive' as const },
    { lbl: 'Active services', val: data.filter((a) => isAgreementActive(a)).length, signal: 'positive' as const },
    { lbl: 'Active MRR', val: Object.keys(mrr).length ? fmtMoneyByCurrency(mrr) : '—' },
    { lbl: 'Ending within 60 days', val: ending, signal: ending ? ('warning' as const) : undefined },
  ];
  const summaryEl = document.getElementById('agr-summary');
  if (summaryEl) summaryEl.innerHTML = summaryDefs.map((x) => kpiCard(x.lbl, x.val, null, { signal: x.signal })).join('');

  const tbody = document.getElementById('agr-tbody');
  if (!tbody) return;
  if (data.length === 0) { tbody.innerHTML = `<tr><td colspan="9">${emptyState({ icon: 'document', title: 'No agreements match these filters', compact: true })}</td></tr>`; return; }
  const todayIso = today();
  tbody.innerHTML = data.map((a) => {
    const sc = AGR_ST[a.status || ''] || { c: '#6B7280', ch: '#9CA3AF' };
    const stOpts = AGR_STATUSES.map((st) => `<option value="${escHtml(st)}" ${a.status === st ? 'selected' : ''}>${escHtml(st)}</option>`).join('')
      + (a.status && !AGR_STATUSES.includes(a.status) ? `<option selected>${escHtml(a.status)}</option>` : '') + (!a.status ? '<option value="" selected>Not set</option>' : '');
    const services = a.lines?.length ? [...new Set(a.lines.map((l) => l.serviceName))] : (a.type ? [a.type] : []);
    const monthly = agreementMonthly(a);
    const endSoon = a.endDate && a.serviceStatus === 'Active' && a.endDate >= todayIso && (daysUntil(a.endDate) ?? 999) <= 60;
    return `<tr class="rec-tr" data-agreement-id="${a.id}" onclick="if(!event.target.closest('a,button,select,input'))openRecord('agreement', ${a.id})">
      <td class="agr-ref">${escHtml(a.agrRef || '—')}${a.proposalId ? `<div class="agr-prop-ref">SL# ${a.proposalId}</div>` : ''}</td>
      <td class="td-c strong" title="${escHtml(a.client)}">${companyLink(a.companyId, a.client)}</td>
      <td class="db-services">${services.map((sv) => `<span class="chip">${escHtml(sv)}</span>`).join(' ') || '—'}</td>
      <td><select class="ssel status-select" style="color:${sc.ch || sc.c}" onchange="updateAgrStatus(${a.id},this.value)" aria-label="Status">${stOpts}</select></td>
      <td>${a.serviceStatus ? statusBadge('service', a.serviceStatus) : '<span class="t-muted">—</span>'}</td>
      <td class="t-sub">${escHtml(preparedByName(a) || '—')}</td>
      <td class="td-d">${fmtDate(a.startDate)}</td>
      <td class="td-d">${a.endDate ? `<span class="${endSoon ? 'tone-amber fw-600' : ''}">${fmtDate(a.endDate)}</span>` : '—'}</td>
      <td class="num">${monthly ? fmtMoney(monthly, currencyOf(a)) : '—'}</td>
    </tr>`;
  }).join('');
}
registerTabRenderer('agreements', () => { populateAgrFilters(); renderAgreements(); });
expose('renderAgreements', renderAgreements);

export function updateAgrStatus(id: number, newStatus: string): void {
  const a = S.agreements.find((x) => x.id === id);
  if (!a) return;
  a.status = newStatus;
  const td = today();
  if (newStatus === 'Client Review' && !a.dateSentToClient) a.dateSentToClient = td;
  if (newStatus === 'Signed' && !a.dateFiled) a.dateFiled = td;
  if (newStatus === 'Signed' && !a.dateClientSigned) a.dateClientSigned = td;
  if (newStatus === 'Signed' && !a.dateMenaSigned) a.dateMenaSigned = td;
  if (newStatus === 'Signed' && !a.serviceStatus) a.serviceStatus = a.startDate && a.startDate <= td ? 'Active' : 'Not started';
  persistAgreements();
  agrBadge();
  refreshCompanyViewIfOpen();
  (window as any).updatePendingBadge?.();
}
expose('updateAgrStatus', updateAgrStatus);

const teamOpts = (selectedId: number | null) => `<option value="">Not set</option>` + activeTeam().map((t) => `<option value="${t.id}"${t.id === selectedId ? ' selected' : ''}>${escHtml(t.name)}</option>`).join('');

/** New agreement: the essentials, then the agreement's page for the rest. */
export function openAgrModal(id: number | null, prefill: { client?: string } = {}): void {
  if (id != null) { (window as any).openRecord('agreement', id); return; }
  const f = document.getElementById('agr-form') as HTMLFormElement;
  f.reset();
  const clientInput = document.getElementById('agr-client-inp') as HTMLInputElement | null;
  if (clientInput) { clientInput.value = prefill.client || ''; attachCompanySelector(clientInput); }
  const typeSel = document.getElementById('agr-type-sel'); if (typeSel) typeSel.innerHTML = `<option value="">Choose…</option>` + AGR_TYPES.map((t) => `<option>${escHtml(t)}</option>`).join('');
  const statusSel = document.getElementById('agr-status-sel'); if (statusSel) statusSel.innerHTML = AGR_STATUSES.map((st) => `<option>${escHtml(st)}</option>`).join('');
  const prepSel = document.getElementById('agr-prep-sel'); if (prepSel) prepSel.innerHTML = teamOpts(null);
  const entity = defaultEntity();
  const entitySel = document.getElementById('agr-entity-sel'); if (entitySel) entitySel.innerHTML = S.businessEntities.filter((e) => e.active).map((e) => `<option value="${e.id}"${e.id === entity?.id ? ' selected' : ''}>${escHtml(e.name)} (${escHtml(e.currency)})</option>`).join('');
  document.getElementById('modal-agr')?.classList.add('open');
  window.setTimeout(() => clientInput?.focus(), 50);
}
expose('openAgrModal', openAgrModal);

export function closeAgrModal(): void {
  document.getElementById('modal-agr')?.classList.remove('open');
}
expose('closeAgrModal', closeAgrModal);

export function submitAgreement(e: Event): void {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  const field = (name: string) => ((f.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value || '').trim();
  const client = field('agrClient');
  const type = field('agrType');
  if (!client || !type) return;
  const entity = entityById(Number(field('agrEntity'))) || defaultEntity();
  const months = field('agrContractMonths') ? Number(field('agrContractMonths')) : null;
  const start = field('agrStart') || null;
  const preparedById = field('agrPrepBy') ? Number(field('agrPrepBy')) : null;
  const a: Agreement = {
    id: nextAgrId(), agrRef: field('agrRef') || genAgrRef(client, type, start || today()), client, type,
    status: field('agrStatus') || 'In Preparation', preparedBy: teamMember(preparedById)?.name || '', datePrepared: today(),
    dateSentToClient: '', dateClientSigned: '', dateMenaSigned: '', dateFiled: '', monthlyFee: null, contractMonths: months,
    proposalId: null, hubspot: '', docLink: null, actionDate: '', remarks: '', createdAt: today(),
    businessEntityId: entity?.id ?? null, currency: entity?.currency ?? 'SAR', startDate: start, endDate: contractEndDate(start, months),
    serviceStatus: null, autoRenew: false, noticeDays: null, preparedById, lines: [],
  };
  S.agreements.push(a);
  persistAgreements();
  closeAgrModal();
  agrBadge();
  refreshCompanyViewIfOpen();
  (window as any).openRecord('agreement', a.id);
}
expose('submitAgreement', submitAgreement);

export async function deleteAgreement(id: number): Promise<void> {
  if (await showConfirm('Delete this agreement entry? This cannot be undone.', { confirmLabel: 'Delete' })) {
    S.agreements = S.agreements.filter((a) => a.id !== id);
    persistAgreements();
    renderAgreements();
    agrBadge();
  }
}
expose('deleteAgreement', deleteAgreement);

export function agrClear(): void {
  ['agr-search', 'agr-status', 'agr-type', 'agr-prep'].forEach((id) => { const el = document.getElementById(id) as HTMLInputElement | null; if (el) el.value = ''; });
  renderAgreements();
}
expose('agrClear', agrClear);

export async function exportAgreementsCSV(): Promise<void> {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const hdr = ['Reference', 'Client', 'Type', 'Services', 'Status', 'Service Status', 'Prepared By', 'Entity', 'Currency', 'Monthly Fee', 'Contract Months', 'Start', 'End', 'Auto-renew', 'Notice Days', 'Date Prepared', 'Sent to Client', 'Client Signed', 'MENA Signed', 'Filed', 'HubSpot', 'Linked Proposal SL#', 'Remarks'];
  const lines = [hdr.join(',')];
  for (const a of S.agreements) {
    lines.push([
      q(a.agrRef), q(a.client), q(a.type), q((a.lines || []).map((l) => l.serviceName).join(' + ')), q(a.status), q(a.serviceStatus), q(preparedByName(a)),
      q(entityById(a.businessEntityId)?.name), currencyOf(a), agreementMonthly(a) ?? '', a.contractMonths ?? '', a.startDate || '', a.endDate || '',
      a.autoRenew ? 'Yes' : 'No', a.noticeDays ?? '', a.datePrepared || '', a.dateSentToClient || '', a.dateClientSigned || '', a.dateMenaSigned || '', a.dateFiled || '',
      a.hubspot || '', a.proposalId ?? '', q(a.remarks),
    ].join(','));
  }
  await saveCsv('MENA_BIG_Agreements', lines.join('\n'));
}
expose('exportAgreementsCSV', exportAgreementsCSV);

export function populateAgrFilters(): void {
  const asel = document.getElementById('agr-status') as HTMLSelectElement | null;
  if (asel) asel.innerHTML = `<option value="">All statuses</option>` + AGR_STATUSES.map((s) => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
  const tsel = document.getElementById('agr-type') as HTMLSelectElement | null;
  if (tsel) tsel.innerHTML = `<option value="">All types</option>` + AGR_TYPES.map((t) => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('');
  const psel = document.getElementById('agr-prep') as HTMLSelectElement | null;
  if (psel) {
    const cur = psel.value;
    const preps = [...new Set(S.agreements.map(preparedByName).filter(Boolean))].sort();
    psel.innerHTML = `<option value="">Prepared by anyone</option>` + preps.map((p) => `<option value="${escHtml(p)}"${p === cur ? ' selected' : ''}>${escHtml(p)}</option>`).join('');
  }
  const ssel = document.getElementById('agr-service') as HTMLSelectElement | null;
  if (ssel) {
    const cur = ssel.value;
    ssel.innerHTML = `<option value="">Any service status</option>` + SERVICE_STATUSES.map((x) => `<option${x === cur ? ' selected' : ''}>${x}</option>`).join('') + `<option value="none"${cur === 'none' ? ' selected' : ''}>Not set</option>`;
  }
}
expose('populateAgrFilters', populateAgrFilters);
