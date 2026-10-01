// Agreement page: the contract with a client — where it stands, the term,
// whether the service is running, the services and fees on it, the
// signature trail and activity. Active agreements make a company an active
// client and count towards MRR; the end date drives renewal alerts.

import { paintFigures } from '../lib/recordFigures';
import { S } from '../lib/state';
import { escHtml, expose, fmtDate, today, showConfirm, inCompany, nextAgrId, strColor } from '../lib/utils';
import { icon } from '../lib/icons';
import { recordHeaderHtml } from '../lib/recordHeader';
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
import { endPropsEdit, isEditingAll, mountPropsList, propsEditButton, propsListHtml, resetPropsLists, type PropField } from '../lib/propsList';
import { agrBadge, genAgrRef, updateAgrStatus } from '../core/agreements';
import { syncAgreementTotals, currencyOf, teamMember, activeTeam, entityById, contractEndDate, lineTotals, isAgreementActive, isOpenProposal, nextLineId, defaultReviewer, PS } from '../lib/commercial';
import { proposalProject } from '../lib/workGraph';
import { agreementNextStep } from '../lib/recordSteps';
import type { Agreement, RenewalDecision } from '../lib/types';
import { agreementHeaderFigures, decisionChip, renewalDraft, renewalFor, termLane } from '../lib/recordAgreement';
import { signatureStepper, stepperHtml } from '../lib/recordStory';
import { nextDecision } from '../lib/pagesAgreements';
import { tileHtml, plural } from '../lib/pageKit';
import { initialsOf } from '../lib/appearance';
import { fmtDateShort } from '../lib/dates';
import { daysBetween } from '../lib/pipeline';
import { companyContact } from '../lib/companyBrief';
import { briefInputFor } from './companyState';

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


const STATUS_TONE: Record<string, string> = { Signed: 'green', 'Client Signature': 'amber', 'MENA Signature': 'amber', 'On Hold': 'amber', Canceled: 'red' };

export function renderAgreementPage(): void {
  const a = current();
  if (!a) return;
  const t = today();
  const services = lineTotals(a.lines, a.contractMonths).serviceNames.join(' + ') || a.type || 'Agreement';
  const avatar = document.getElementById('agd-avatar');
  if (avatar) { avatar.textContent = initialsOf(a.client || a.agrRef || '?') || '?'; avatar.style.background = strColor(a.client || a.agrRef || '?'); }
  const eyebrow = document.getElementById('agd-eyebrow');
  if (eyebrow) eyebrow.innerHTML = `Agreement${a.agrRef ? ` · ${escHtml(a.agrRef)}<button class="rec-icon-btn rec-eyebrow-copy" onclick="copyText('${escHtml(a.agrRef)}','Reference copied')" data-tip="Copy reference" aria-label="Copy reference">${icon('copy', 11)}</button>` : ''}`;
  const title = document.getElementById('agd-title');
  if (title) title.innerHTML = `${companyLink(a.companyId, a.client)}<span class="pr-title-services"> — ${escHtml(services)}</span>`;
  paintFigures('agd-figures', agreementHeaderFigures(a, t));
  const decided = decisionChip(a);
  const next = nextDecision(a, t);
  const entity = entityById(a.businessEntityId);
  const preparer = teamMember(a.preparedById)?.name || a.preparedBy;
  const from = a.renewedFrom != null ? S.agreements.find((x) => x.id === a.renewedFrom) : undefined;
  const renewal = S.agreements.find((x) => x.renewedFrom === a.id);
  const badges = document.getElementById('agd-badges');
  if (badges) badges.innerHTML = [
    a.client ? `<span class="pk-mini-co">${tileHtml(a.client, 'pk-tile mini')}${companyLink(a.companyId, a.client)}</span>` : '',
    `<span class="pk-stage t-${STATUS_TONE[a.status || ''] || 'grey'}"><i></i>${escHtml([a.status || 'In preparation', a.serviceStatus ? `service ${a.serviceStatus.toLowerCase()}` : ''].filter(Boolean).join(' · '))}</span>`,
    decided ? `<span class="pk-chip is-text t-${decided.tone}">${escHtml(decided.text)}</span>`
      : a.status === 'Signed' && (next.tone === 'amber' || next.tone === 'blue') ? `<span class="pk-chip is-text t-${next.tone}">${escHtml(next.text)}</span>` : '',
    [entity?.name, preparer ? `prepared by ${preparer}` : ''].some(Boolean) ? `<span class="rec-meta">${escHtml([entity?.name, preparer ? `prepared by ${preparer}` : ''].filter(Boolean).join(' · '))}</span>` : '',
    from ? `<span class="rec-meta">renews ${recordLink('agreement', from.id, from.agrRef || 'the previous agreement')}</span>` : '',
    renewal ? `<span class="rec-meta">renewal ${recordLink('agreement', renewal.id, renewal.agrRef || 'drafted')}</span>` : '',
  ].filter(Boolean).join('');
  const actions = document.getElementById('agd-actions');
  if (actions) {
    const step = agreementNextStep(a, t);
    actions.innerHTML = recordHeaderHtml([], step, 'agreementMoreMenu(event)');
  }
  renderLane(a);
  renderThreadStrip('agd-thread', { kind: 'agreement', id: a.id });
  renderRenewal(a);
  renderProps(a);
  renderTerm(a);
  renderAt(a);
  renderLines(a);
  renderDates(a);
  void renderActivity(a);
  const page = document.getElementById('agr-detail'); if (page) renderIcons(page);
}
expose('renderAgreementPage', renderAgreementPage);

/** The term at full width: what has run (lighter), what is left, today in coral and the notice window hatched. */
function renderLane(a: Agreement): void {
  const el = document.getElementById('agd-lane');
  if (!el) return;
  const l = termLane(a, today());
  el.hidden = !l;
  if (!l) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="rk-lane${a.status === 'Signed' ? '' : ' is-outline'}">
      ${l.notice ? `<span class="rk-lane-nl" style="left:${l.notice.left}%">${escHtml(l.notice.label)}</span>` : ''}
      <div class="rk-lane-bar"><span class="rk-lane-ran" style="width:${l.elapsed}%"></span>${l.notice ? `<span class="rk-lane-notice" style="left:${l.notice.left}%"></span>` : ''}</div>
      ${l.today != null ? `<span class="rk-lane-today" style="left:${l.today}%"><em>today</em></span>` : ''}
      <span class="rk-lane-s">${escHtml(l.startLabel)}</span><span class="rk-lane-e">${escHtml(l.endLabel)}</span>
    </div>`;
}

/** Renewal: three choices, each saying what it does; the chosen one is marked and can be changed. */
function renderRenewal(a: Agreement): void {
  const el = document.getElementById('agd-renewal');
  if (!el) return;
  const r = renewalFor(a, today());
  el.hidden = !r;
  if (!r) { el.innerHTML = ''; return; }
  const draft = S.agreements.find((x) => x.renewedFrom === a.id);
  el.innerHTML = `<div class="rk-sh"><h2 class="hd-major">Renewal</h2><span class="rk-cnt${r.tone ? ` t-${r.tone}` : ''}">${escHtml(r.decided ? r.decided.on : r.deadline)}</span>${r.decided ? `<a href="#" class="rlink rk-sh-r" onclick="event.preventDefault();agreementRenewalClear()">Change</a>` : ''}</div>
    <div class="rk-choices">${r.cards.map((c) => `<button type="button" class="rk-choice${c.chosen ? ' is-chosen' : ''}" aria-pressed="${c.chosen}" onclick="agreementRenewalChoose('${c.key}')">
      <b>${escHtml(c.title)}</b><span>${escHtml(c.body)}</span>${c.chosen && c.key === 'renew' && draft ? `<em>Drafted: ${escHtml(draft.agrRef || 'the renewal')}</em>` : c.chosen ? '<em>Chosen</em>' : ''}</button>`).join('')}</div>`;
}

/** The header's "Start renewal": to the three choices. */
export function agreementStartRenewal(): void {
  const el = document.getElementById('agd-renewal');
  if (!el || el.hidden) return;
  el.scrollIntoView({ block: 'center' });
  el.querySelector<HTMLElement>('.rk-choice')?.focus();
}
expose('agreementStartRenewal', agreementStartRenewal);

/** Records a renewal choice and does what it says; the toast undoes it. */
export function agreementRenewalChoose(choice: RenewalDecision): void {
  const a = current();
  if (!a) return;
  if (a.renewalDecision === choice) {
    // Clicking the chosen card again goes to what it made.
    const made = choice === 'renew' ? S.agreements.find((x) => x.renewedFrom === a.id) : undefined;
    if (made) w.openRecord('agreement', made.id);
    else if (choice === 'changes') agreementRenew();
    return;
  }
  const before = { decision: a.renewalDecision ?? null, at: a.renewalDecidedAt ?? null };
  const t = today();
  a.renewalDecision = choice;
  a.renewalDecidedAt = t;
  let drafted: Agreement | undefined;
  if (choice === 'renew' && !S.agreements.some((x) => x.renewedFrom === a.id && x.status !== 'Canceled')) {
    drafted = renewalDraft(a, { id: nextAgrId(), agrRef: '', today: t, lineId: nextLineId });
    // Its reference is dated by its own start: the day after this one ends.
    drafted.agrRef = genAgrRef(a.client || '', a.type || '', drafted.startDate || t);
    S.agreements.push(drafted);
  }
  commit(a);
  const undo = () => {
    a.renewalDecision = before.decision;
    a.renewalDecidedAt = before.at;
    if (drafted) { const i = S.agreements.findIndex((x) => x.id === drafted!.id); if (i > -1) S.agreements.splice(i, 1); }
    commit(a);
  };
  undoToast(choice === 'renew' ? `Renewal drafted${drafted ? `: ${drafted.agrRef}` : ''}` : choice === 'changes' ? 'Recorded: renewing with changes' : `Recorded: it ends ${a.endDate ? fmtDateShort(a.endDate, true) : 'at term'}`, undo);
  if (choice === 'changes') agreementRenew();
}
expose('agreementRenewalChoose', agreementRenewalChoose);

/** "Change": back to undecided. A renewal already drafted stays; it is its own agreement now. */
export function agreementRenewalClear(): void {
  const a = current();
  if (!a || !a.renewalDecision) return;
  const before = { decision: a.renewalDecision, at: a.renewalDecidedAt ?? null };
  a.renewalDecision = null;
  a.renewalDecidedAt = null;
  commit(a);
  undoToast('Renewal undecided again', () => { a.renewalDecision = before.decision; a.renewalDecidedAt = before.at; commit(a); });
}
expose('agreementRenewalClear', agreementRenewalClear);

/** "At <client>": who to talk to, what else is open there, when we last spoke. */
function renderAt(a: Agreement): void {
  const el = document.getElementById('agd-at');
  if (!el) return;
  el.hidden = !a.client;
  if (!a.client) { el.innerHTML = ''; return; }
  const ref = { id: a.companyId ?? null, name: a.client };
  const people = S.contacts.filter((c) => inCompany(ref, c.companyId, c.clientName));
  const who = people.find((c) => c.isDecisionMaker) || people[0];
  const open = S.proposals.filter((p) => !p.archived && isOpenProposal(p) && inCompany(ref, p.companyId, p.client));
  const reviewer = (p: (typeof open)[number]) => (teamMember(p.reviewerId)?.name || defaultReviewer()?.name || 'the reviewer').split(' ')[0];
  const last = companyContact(briefInputFor(ref)).lastContact;
  const ago = last ? Math.max(0, daysBetween(last, today()) ?? 0) : null;
  el.innerHTML = `<div class="rec-section-hd"><h2 class="rk-panel-h">At ${escHtml(a.client)}</h2></div>
    <dl class="rec-props od-at">
      ${who ? `<dt>Contact</dt><dd>${recordLink('contact', who.id, who.name || 'Contact')}${who.role ? ` · ${escHtml(who.role)}` : ''}</dd>` : ''}
      ${open.length ? `<dt>In flight</dt><dd>${open.slice(0, 3).map((p) => `<div>${recordLink('proposal', p.id, `${p.type || 'Proposal'}, SL# ${p.id}${p.status === PS.REVIEW ? ` in review with ${reviewer(p)}` : ''}`)}</div>`).join('')}</dd>` : ''}
      <dt>Last contact</dt><dd>${ago == null ? '<span class="rec-muted">none on record</span>' : ago === 0 ? 'today' : ago === 1 ? 'yesterday' : `${plural(ago, 'day')} ago`}</dd>
    </dl>`;
}

/** "Renew…" near the notice date: a new proposal for the client, starting from this agreement's lines and term. */
export function agreementRenew(): void {
  const a = current();
  if (!a) return;
  (window as any).openProposalBuilder?.({
    client: a.client || undefined,
    lines: (a.lines || []).map((l) => ({ ...l })),
    currency: a.currency ?? null,
    businessEntityId: a.businessEntityId ?? null,
    contractMonths: a.contractMonths ?? null,
  });
}
expose('agreementRenew', agreementRenew);

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
    { key: 'actionDate', label: 'Next action', display: dateText(a.actionDate), control: () => input('actionDate', 'date', a.actionDate || '') },
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
  if (act) act.innerHTML = (a.lines || []).length ? `<button class="rlink" onclick="toggleAgreementLines()" aria-pressed="${linesEditing}">${linesEditing ? 'Done' : 'Edit services'}</button>` : '';
  renderLinesEditor(`agreement:${a.id}`, 'agd-lines', {
    lines: () => a.lines || [],
    setLines: (lines) => { a.lines = lines; },
    currency: () => currencyOf(a),
    contractMonths: () => a.contractMonths,
    editable: editing,
    onChange: () => {
      commit(a, false);
      // The header's money follows the lines.
      paintFigures('agd-figures', agreementHeaderFigures(a, today()));
      renderRenewal(a);
    },
  });
}

/** The signature trail as five green steps; Edit opens the dates. */
function renderDates(a: Agreement): void {
  const sign = document.getElementById('agd-sign');
  if (sign) sign.innerHTML = stepperHtml(signatureStepper(a), { tone: 'green' });
  const fields: PropField[] = ([
    ['Prepared', 'datePrepared'], ['Sent to client', 'dateSentToClient'], ['Client signed', 'dateClientSigned'],
    ['MENA BIG signed', 'dateMenaSigned'], ['Filed', 'dateFiled'],
  ] as const).map(([label, key]) => ({ key, label, always: true, display: dateText((a as any)[key]), control: () => input(key, 'date', ((a as any)[key] as string) || '') }));
  readList('agd-dates', 'agd-dates-act', fields, again(renderDates));
  const list = document.getElementById('agd-dates'); if (list) list.hidden = !isEditingAll('agd-dates');
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
