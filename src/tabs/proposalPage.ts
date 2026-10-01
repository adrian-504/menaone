// Proposal page and the new-proposal page. A proposal is one offer to one
// client with a line per service; it moves Request → Drafting → Internal
// review → Sent → Signed by client → Signed by both parties (won), or ends
// as Lost / Withdrawn. The page shows where it stands and the next step, the
// commercials, the client's OneDrive folder and documents, what it's linked
// to, notes and activity.

import { proposalCascade } from '../lib/chromeKit';
import { pricingShape } from '../lib/pricingShape';
import { cardFor } from '../lib/linesEditor';
import { requestSiblings } from '../lib/proposalGroups';
import { paintFigures } from '../lib/recordFigures';
import { proposalHeaderFigures, proposalStepper, stepperHtml } from '../lib/recordStory';
import { contactTrail, trailTouches, TOUCH_ICON, type TrailPoint } from '../lib/pagesQueues';
import { tableCells } from '../lib/pagesProposals';
import { registerKey } from '../core/keys';
import { registerDragSource, registerDropTarget } from '../lib/dnd';
import { arrive, settleNew, shake } from '../lib/motion';
import { statusBadge } from '../lib/statusTone';
import { blockSummary, blocksToSave, emptyBlock, proposalsFromBlocks, type ProposalBlock, type SharedProposalFields } from '../lib/proposalBlocks';
import { draftDeck, markSentVersion, proposalDeckRows, sendCheckHtml, sentDayFor, type Fingerprints } from '../lib/proposalDocuments';
import type { SendCheck } from '../lib/sendCheck';
import { deckVersion, matchDecks } from '../lib/deckMatch';
import { generateIsFeatured, proposalNextStep } from '../lib/proposalSteps';
import { latestRevision, lineWasNote, parseSnapshot, removedServices, revisionFact, revisionOf } from '../lib/revisions';
import { companyFromForm, contextFromOpportunity } from '../lib/workGraph';
import { S } from '../lib/state';
import { touchDoing, touchesOf } from '../lib/followup';
import { entryLine } from '../lib/followRequests';
import { PAPERWORK_PENDING, afterYes, paperworkPending, showsAfterYes, type YesKey } from '../lib/afterYes';
import { sentByOther } from '../lib/bulkProposals';
import { escHtml, expose, fmtDate, today, nextId, nextCtId, showConfirm, showTextPrompt, showDatePrompt, debounce, strColor, fmtDateShort } from '../lib/utils';
import { icon } from '../lib/icons';
import { companyLink, recordLink } from '../lib/links';
import { emptyState, toast, undoToast } from '../lib/ui';
import { persistProposals, persistContacts } from '../lib/persist';
import { notifyNavigated, refreshAll, refreshCompanyViewIfOpen } from '../lib/registry';
import { saveOpportunity, filesOpen, filesRevealInFinder, filesStatPaths, filesFingerprints, proposalSendCheck, proposalFolderLookup, proposalFolderCreate } from '../lib/db';
import { attachCompanySelector } from '../lib/companySelector';
import { breadcrumb, cardLine } from '../lib/studio';
import { initialsOf } from '../lib/appearance';
import { showMenuAt, type ContextMenuItem } from '../lib/contextMenu';
import { renderFeed } from '../lib/activityFeed';
import { renderRecordTimeline, renderThreadStrip } from './recordThread';
import { endPropsEdit, mountPropsList, propsEditButton, propsListHtml, resetPropsLists, type PropField } from '../lib/propsList';
import { renderIcons } from '../core/chrome';
import './revisePrices';
import { basedOnLabel, startFromCopy, startFromMatches, startFromSub, startFromTitle } from '../lib/startFrom';
import { ST, LEAD_SOURCES } from '../lib/constants';
import { renderLinesEditor, lineForService } from '../lib/linesEditor';
import { needsFollowUp, proposalLastTouch, snapshotProposal, changeProposalStatus, contactFirstName, recordReview, undoReview, openRevisionDialog, openWlModal, updateStatus, archiveProposal, unarchiveProposal, snoozeProposal, isSnoozed } from '../core/proposals';
import {
  PS, PROPOSAL_STAGES, proposalSentDate, stageIndex, isWon, isLost, isWithdrawn, isClosed, lineTotals, syncProposalTotals, fmtMoney, currencyOf,
  teamMember, reviewers, defaultReviewer, activeTeam, ownerName, entityById, defaultEntity, activeServices, newLine,
  suggestedFileName, nextDocumentId, nextLineId, nextDeckFileName,
  currentUser, priceRange, serviceById } from '../lib/commercial';
import type { Proposal, CommercialLine, ProposalFolder, Opportunity, LocalFileItem } from '../lib/types';

const w = window as any;


const currentProposal = (): Proposal | undefined => S.proposals.find((p) => p.id === S.currentProposalId);
const CURRENCIES = () => [...new Set(['SAR', 'EUR', 'USD', ...S.businessEntities.map((e) => e.currency)])];

function showView(view: 'list' | 'detail' | 'builder'): void {
  document.getElementById('pr-list-view')?.classList.toggle('hidden', view !== 'list');
  document.getElementById('pr-detail')?.classList.toggle('open', view === 'detail');
  document.getElementById('pr-builder')?.classList.toggle('open', view === 'builder');
}

// ═══════════════ Proposal page ═══════════════

export function openProposalPage(id: number): void {
  if (!S.proposals.some((p) => p.id === id)) { toast('That proposal no longer exists', { tone: 'error' }); return; }
  const changed = S.currentProposalId !== id;
  if (changed) { resetPropsLists('prd-'); linesEditing = null; }
  S.currentProposalId = id;
  deckFiles = null;
  S.proposalBuilderOpen = false;
  showView('detail');
  if (changed) window.scrollTo(0, 0);
  renderProposalPage();
  notifyNavigated();
}
expose('openProposalPage', openProposalPage);

export function closeProposalPage(): void {
  if (S.currentProposalId == null && !S.proposalBuilderOpen) return;
  S.currentProposalId = null;
  S.proposalBuilderOpen = false;
  showView('list');
  notifyNavigated();
  w.renderDB?.();
}
expose('closeProposalPage', closeProposalPage);

function savedFlash(): void {
  const state = document.getElementById('prd-save-state');
  if (state) { state.textContent = 'Saved'; window.setTimeout(() => { if (state.textContent === 'Saved') state.textContent = ''; }, 1500); }
}

/** Every edit on the page goes through here. */
function commit(p: Proposal, rerender = true): void {
  syncProposalTotals(p);
  persistProposals();
  savedFlash();
  refreshCompanyViewIfOpen();
  if (rerender) renderProposalPage();
}


/** "Promised by 2 Oct" while it's a request or a draft; red once the day has come. */
function promisedByFact(p: Proposal): string {
  if (!p.promisedBy || (p.status !== PS.REQUEST && p.status !== PS.DRAFTING)) return '';
  const d = new Date(`${p.promisedBy.slice(0, 10)}T12:00:00`);
  const label = isNaN(d.getTime()) ? p.promisedBy : fmtDateShort(d);
  return `<span class="rec-meta${p.promisedBy.slice(0, 10) <= today() ? ' t-red' : ''}">Promised by ${escHtml(label)}</span>`;
}

export function renderProposalPage(): void {
  const p = currentProposal();
  if (!p) return;
  const page = document.getElementById('pr-detail');
  const avatar = document.getElementById('prd-avatar');
  if (avatar) { avatar.textContent = initialsOf(p.client || '') || '?'; avatar.style.background = strColor(p.client); }
  const eyebrow = document.getElementById('prd-eyebrow'); if (eyebrow) eyebrow.innerHTML = `Proposal · SL# ${p.id}<button class="rec-icon-btn rec-eyebrow-copy" onclick="copyText('SL# ${p.id}','Reference copied')" data-tip="Copy reference" aria-label="Copy reference">${icon('copy', 11)}</button>`;
  const title = document.getElementById('prd-title');
  if (title) title.innerHTML = `${companyLink(p.companyId, p.client)}<span class="pr-title-services"> — ${escHtml(lineTotals(p.lines, p.contractMonths).serviceNames.join(' + ') || p.type || 'Services to be confirmed')}</span>`;
  const entity = entityById(p.businessEntityId);
  const owner = ownerName(p);
  const badges = document.getElementById('prd-badges');
  const t = today();
  const touch = proposalLastTouch(p);
  const due = needsFollowUp(p);
  paintFigures('prd-figures', proposalHeaderFigures(p, { today: t, touch, due, shape: pricingShape(p.lines, cardFor) }));
  // Sent with: the proposals requested together with this one, as one line of links.
  const siblings = requestSiblings(p, S.proposals);
  const cells = tableCells(p, { today: t, reviewer: teamMember(p.reviewerId)?.name || defaultReviewer()?.name || 'the reviewer', due });
  const contact = p.primaryContactId != null ? S.contacts.find((c) => c.id === p.primaryContactId)?.name : null;
  // Who sent it, said only when it was not its owner.
  const sender = proposalSentDate(p) ? sentByOther(p, (id) => (teamMember(id)?.name || '').trim().split(/\s+/)[0] || null) : null;
  if (badges) badges.innerHTML = [
    `<span class="pk-stage t-${cells.chip.tone}"><i></i>${escHtml(paperworkPending(p) ? PAPERWORK_PENDING : p.status === PS.SENT ? 'With the client' : cells.chip.text)}</span>`,
    due ? '<span class="pk-chip is-text t-amber">Follow-up due</span>' : '',
    p.archived ? '<span class="pk-chip t-grey">Archived</span>' : '',
    isSnoozed(p) ? `<span class="pk-chip t-amber">Snoozed until ${fmtDate(p.snoozedUntil)}</span>` : '',
    `<span class="rec-meta">${escHtml([entity?.name, currencyOf(p), owner ? `owner ${owner}` : '', sender ? `sent by ${sender}` : '', contact ? `contact ${contact}` : ''].filter(Boolean).join(' · '))}</span>`,
    promisedByFact(p),
    revisionFact(p) ? `<span class="rec-meta">${escHtml(revisionFact(p)!)}</span>` : '',
    siblings.length ? `<span class="rec-meta rk-with">sent with ${siblings.map((x) => recordLink('proposal', x.id, `${x.type || 'Proposal'} · SL# ${x.id}`)).join(', ')}</span>` : '',
    p.winLossReason && isClosed(p) ? `<span class="rec-meta">${escHtml(p.winLossReason)}</span>` : '',
  ].filter(Boolean).join('');

  renderActions(p);
  renderThreadStrip('prd-thread', { kind: 'proposal', id: p.id });
  renderStages(p);
  renderToolbar(p);
  renderProps(p);
  renderReview(p);
  renderAfterYes(p);
  renderContact(p);
  renderCommercials(p);
  void renderDocuments(p);
  renderRelated(p);
  renderNotes(p);
  void renderActivity(p);
  if (page) renderIcons(page);
}
expose('renderProposalPage', renderProposalPage);

// ── Header actions: the next step for where the proposal stands ──


/** The one document action worth a button where the proposal stands: open
 * the deck once there is one, generate it while drafting; the rest are in "…". */
function contextualTool(p: Proposal): { label: string; run: string } | null {
  const folder = folderCache?.proposalId === p.id ? folderCache.info : null;
  const deck = latestDeck(p, folder);
  if (deck) return { label: 'Open PowerPoint', run: `proposalOpenFile('${escHtml(deck.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'"))}')` };
  if (p.status === PS.REQUEST || p.status === PS.DRAFTING) return { label: 'Generate proposal', run: `openGenerateProposal(${p.id})` };
  return null;
}

export function renderActions(p: Proposal): void {
  const el = document.getElementById('prd-actions');
  if (!el) return;
  const step = proposalNextStep(p, S.agreements);
  // With the client and a follow-up due: the next step is to follow up (Record signature is in "…").
  const dueNow = p.status === PS.SENT && needsFollowUp(p);
  const primary = dueNow ? null : step.primary;
  const secondary = dueNow ? { label: 'Client asked for changes', run: `openRevisionDialog(${p.id})` } : step.secondary;
  const tool = dueNow ? null : contextualTool(p);
  // No deck yet while requested or drafting: Generate proposal is the page's one blue button, the status step beside it.
  const featured = generateIsFeatured(p, hasDeck(p));
  el.innerHTML = [
    tool && !featured ? `<button class="btn-secondary" onclick="${tool.run}">${escHtml(tool.label)}</button>` : '',
    secondary ? `<button class="btn-secondary" onclick="${secondary.run}">${escHtml(secondary.label)}</button>` : '',
    primary ? `<button class="${featured ? 'btn-secondary' : 'btn-primary'}" onclick="${primary.run}">${escHtml(primary.label)}</button>` : '',
    featured ? `<button class="btn-primary" onclick="openGenerateProposal(${p.id})">${icon('bolt', 13)} Generate proposal</button>` : '',
    dueNow ? `<button class="btn-primary" onclick="followUpMenu(event, ${p.id})" aria-haspopup="menu">Followed up ${icon('chevronDown', 11)}</button>` : '',
    `<button class="loc-nav rec-more" onclick="proposalMoreMenu(event)" data-tip="More" aria-label="More">${icon('more', 16)}</button>`,
  ].join('');
}

/** "Mark service started": one date, pre-filled with the signature date and back-datable; the toast undoes it. */
export async function proposalMarkServiceStarted(): Promise<void> {
  const p = currentProposal();
  if (!p) return;
  const date = await showDatePrompt({ title: 'Service started', label: `${p.client} — the day the service started`, defaultValue: (p.dblSignedDate || p.dateSigned || today()).slice(0, 10), confirmLabel: 'Mark started' });
  if (!date) return;
  const restore = snapshotProposal(p);
  p.serviceStartedAt = date;
  commit(p);
  undoToast(`${p.client}: service started ${fmtDateShort(date)}`, restore);
}
expose('proposalMarkServiceStarted', proposalMarkServiceStarted);

export async function proposalStep(status: string): Promise<void> {
  const p = currentProposal();
  if (!p) return;
  const restore = snapshotProposal(p);
  const changed = await changeProposalStatus(p.id, status);
  renderProposalPage();
  if (changed) undoToast(`${p.client}: ${p.status}`, restore);
}
expose('proposalStep', proposalStep);

export function proposalSignatureMenu(e: MouseEvent): void {
  e.stopPropagation();
  const p = currentProposal();
  if (!p) return;
  showMenuAt(e.currentTarget as HTMLElement, [
    { label: 'Client signed', iconName: 'edit', run: () => void proposalStep(PS.CLIENT_SIGNED) },
    { label: 'Client asked for changes…', iconName: 'edit', run: () => openRevisionDialog(p.id) },
    { label: 'Signed by both parties', iconName: 'check', run: () => openWlModal(p.id, 'won') },
    { label: '', run: () => {}, separator: true },
    { label: 'Mark as lost', iconName: 'close', danger: true, run: () => openWlModal(p.id, 'lost') },
  ]);
}
expose('proposalSignatureMenu', proposalSignatureMenu);

export function proposalReopenMenu(e: MouseEvent): void {
  e.stopPropagation();
  const p = currentProposal();
  if (!p) return;
  showMenuAt(e.currentTarget as HTMLElement, [PS.DRAFTING, PS.SENT].map((s) => ({
    label: `Back to ${s.toLowerCase()}`, run: () => { p.winLossReason = null; updateStatus(p.id, s); renderProposalPage(); },
  })));
}
expose('proposalReopenMenu', proposalReopenMenu);

export function proposalMoreMenu(e: MouseEvent): void {
  e.stopPropagation();
  const p = currentProposal();
  if (!p) return;
  const items: ContextMenuItem[] = [];
  const folder = folderCache?.proposalId === p.id ? folderCache.info : null;
  const deck = latestDeck(p, folder);
  items.push({ label: 'Generate proposal', iconName: 'bolt', run: () => void (window as any).openGenerateProposal?.(p.id) });
  if (deck) items.push({ label: 'Open PowerPoint', iconName: 'document', run: () => void proposalOpenFile(deck.path) });
  if (folder?.exists) items.push({ label: 'Open proposal folder', iconName: 'folder', run: () => void proposalOpenFolder() });
  items.push({ label: '', run: () => {}, separator: true });
  if (!isClosed(p)) {
    if (p.status === PS.CLIENT_SIGNED) items.push({ label: 'Client asked for changes…', iconName: 'edit', run: () => openRevisionDialog(p.id) });
    if (p.status === PS.SENT) items.push({ label: 'Signed by the client…', iconName: 'check', run: () => { void changeProposalStatus(p.id, PS.CLIENT_SIGNED).then(() => renderProposalPage()); } });
    if (p.status === PS.SENT) items.push({ label: 'Signed by both parties…', iconName: 'check', run: () => openWlModal(p.id, 'won') });
    if (p.status === PS.SENT) items.push({ label: 'Snooze follow-up 7 days', iconName: 'clock', run: () => { snoozeProposal(p.id, 7); renderProposalPage(); } });
    items.push({ label: 'Mark as lost', iconName: 'close', run: () => openWlModal(p.id, 'lost') });
    items.push({ label: 'Withdraw', iconName: 'archive', run: () => void withdrawProposal(p.id) });
    items.push({ label: '', run: () => {}, separator: true });
  }
  items.push({ label: 'Duplicate as new proposal', iconName: 'copy', run: () => duplicateProposal(p.id) });
  items.push(p.archived
    ? { label: 'Unarchive', iconName: 'archive', run: () => { unarchiveProposal(p.id); renderProposalPage(); } }
    : { label: 'Archive', iconName: 'archive', run: () => { archiveProposal(p.id); renderProposalPage(); } });
  items.push({ label: '', run: () => {}, separator: true });
  items.push({ label: 'Delete proposal', iconName: 'trash', danger: true, run: () => void deleteProposalFromPage(p.id) });
  showMenuAt(e.currentTarget as HTMLElement, items);
}
expose('proposalMoreMenu', proposalMoreMenu);

async function withdrawProposal(id: number): Promise<void> {
  const reason = await showTextPrompt({ title: 'Withdraw this proposal?', label: 'Why (optional)', placeholder: 'e.g. Client paused the project' });
  if (reason === null) return;
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  p.winLossReason = reason.trim() || null;
  updateStatus(id, PS.WITHDRAWN);
  renderProposalPage();
}

function duplicateProposal(id: number): void {
  const src = S.proposals.find((x) => x.id === id);
  if (!src) return;
  let lineId = nextLineId();
  openProposalBuilder({
    client: src.client,
    lines: (src.lines || []).map((l) => ({ ...l, id: lineId++ })),
    currency: src.currency ?? null,
    businessEntityId: src.businessEntityId ?? null,
    contractMonths: src.contractMonths,
    basedOnId: src.id,
  });
}

async function deleteProposalFromPage(id: number): Promise<void> {
  const index = S.proposals.findIndex((x) => x.id === id);
  if (index < 0) return;
  const p = S.proposals[index];
  const agreement = S.agreements.find((a) => a.proposalId === id);
  // What goes with it is worked out from the record; the decks themselves stay in OneDrive.
  const c = proposalCascade(p, agreement ? { agreementRef: agreement.agrRef || '' } : {});
  const ok = await showConfirm(`${c.named}.${c.also.length ? ' This also removes:' : ''}`, { title: 'Delete this proposal?', confirmLabel: 'Delete', also: c.also, stays: c.stays, undoable: true });
  if (!ok) return;
  const [removed] = S.proposals.splice(index, 1);
  persistProposals();
  closeProposalPage();
  refreshAll();
  undoToast(`Deleted proposal SL# ${id}`, () => {
    S.proposals.splice(Math.min(index, S.proposals.length), 0, removed);
    persistProposals();
    refreshAll();
  });
}

// ── Progress ──

function renderStages(p: Proposal): void {
  const el = document.getElementById('prd-stages');
  // The agreement it became (or that there is none yet) closes the stepper once it is signed by both.
  const agreement = S.agreements.find((a) => a.proposalId === p.id) ?? null;
  if (el) el.innerHTML = stepperHtml(proposalStepper(p, today(), agreement ? { id: agreement.id, agrRef: agreement.agrRef } : null));
  // Once it is with the client: sent, each touch since, today and the offer's expiry on one line.
  const trail = document.getElementById('prd-trail');
  if (!trail) return;
  const sent = proposalSentDate(p)?.slice(0, 10);
  trail.hidden = p.status !== PS.SENT || !sent;
  if (trail.hidden) { trail.innerHTML = ''; return; }
  const t = today();
  const touch = proposalLastTouch(p);
  const due = needsFollowUp(p);
  const mine = touchesOf(p, S.touches).filter((x) => x.at.slice(0, 10) >= sent! && x.at.slice(0, 10) <= t);
  const tr = contactTrail({ sent: sent!, touches: trailTouches(mine, touch), today: t, validUntil: p.validUntil ?? null, late: due ? touch?.date ?? sent! : null });
  const WHAT: Record<string, string> = { email_out: 'Followed up', email_in: 'Client replied', call: 'Call', whatsapp: 'WhatsApp', meeting: 'Met', note: 'Note' };
  const top = (x: TrailPoint) => x.kind === 'sent' ? 'Sent' : x.kind === 'expiry' ? 'Offer expires'
    : x.kind === 'today' ? (due ? `No contact · ${touch?.days ?? 0} ${touch?.days === 1 ? 'day' : 'days'}` : 'Today')
    : `${TOUCH_ICON[x.touch || ''] || ''} ${WHAT[x.touch || ''] || 'Contact'}`.trim();
  const under = (x: TrailPoint) => (x.kind === 'today' ? 'today' : fmtDateShort(x.date, true));
  trail.innerHTML = `<div class="rk-trail"><span class="rk-trail-line"></span>${tr.late ? `<span class="rk-trail-late" style="left:${tr.late.from}%;width:${Math.max(0, tr.late.to - tr.late.from)}%"></span>` : ''}
    ${tr.points.map((x) => `<span class="rk-tp is-${x.kind}${x.kind === 'today' && due ? ' is-late' : ''}${x.pos > 85 ? ' at-end' : x.pos < 8 ? ' at-start' : ''}" style="left:${x.pos}%"><em>${x.showLabel || x.kind !== 'touch' ? escHtml(top(x)) : ''}</em><i></i><span>${x.showLabel || x.kind !== 'touch' ? escHtml(under(x)) : ''}</span></span>`).join('')}</div>`;
}

// ── Document actions ──

let folderCache: { proposalId: number; client: string; info: ProposalFolder } | null = null;

function latestDeck(p: Proposal, folder: ProposalFolder | null): { path: string; name: string } | null {
  const docs = (p.documents || []).filter((d) => d.kind === 'proposal' && d.path).sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
  if (docs.length) return { path: docs[0].path!, name: docs[0].fileName };
  const decks = (folder?.files || []).filter((f) => !f.isFolder && /\.pptx$/i.test(f.name) && /proposal/i.test(f.name))
    .sort((a, b) => (b.modifiedAt || '').localeCompare(a.modifiedAt || ''));
  return decks.length ? { path: decks[0].path, name: decks[0].name } : null;
}

/** Is there a deck: one recorded on the proposal, or a proposal deck in the client folder. */
function hasDeck(p: Proposal): boolean {
  return !!latestDeck(p, folderCache?.proposalId === p.id ? folderCache.info : null);
}

/** Document tools live in the header ("Open PowerPoint" / "Generate proposal") and in "…";
 * the folder lookup finishing can change which one applies. */
function renderToolbar(p: Proposal): void {
  renderActions(p);
}

export async function proposalOpenFolder(): Promise<void> {
  const path = folderCache?.info.path;
  if (!path || !folderCache?.info.exists) return;
  try { await filesOpen(path); } catch (err) { toast('Could not open the folder', { tone: 'error', detail: String(err) }); }
}
expose('proposalOpenFolder', proposalOpenFolder);

export async function proposalOpenFile(path: string): Promise<void> {
  try { await filesOpen(path); } catch (err) { toast('Could not open the file', { tone: 'error', detail: String(err) }); }
}
expose('proposalOpenFile', proposalOpenFile);

export async function proposalRevealFile(path: string): Promise<void> {
  try { await filesRevealInFinder(path); } catch (err) { toast('Could not show the file', { tone: 'error', detail: String(err) }); }
}
expose('proposalRevealFile', proposalRevealFile);

// ── Details ──

type FieldKind = 'text' | 'date' | 'select' | 'textarea';
interface Field { key: string; label: string; kind: FieldKind; value: string; options?: [string, string][]; placeholder?: string }

function teamOptions(selectedId: number | null | undefined, legacyText: string | null | undefined, onlyReviewers = false): [string, string][] {
  const people = onlyReviewers ? reviewers() : activeTeam();
  const opts: [string, string][] = [['', 'Not set'], ...people.map((t) => [String(t.id), t.name] as [string, string])];
  const current = teamMember(selectedId);
  if (current && !people.includes(current)) opts.push([String(current.id), `${current.name} (inactive)`]);
  if (!selectedId && legacyText?.trim()) opts.push([`legacy:${legacyText}`, `${legacyText} (not in team)`]);
  return opts;
}

function renderProps(p: Proposal): void {
  const el = document.getElementById('prd-props');
  if (!el) return;
  const ref = { id: p.companyId ?? null, name: p.client };
  const opps = S.opportunities.filter((o) => (ref.id != null && o.companyId === ref.id) || (o.companyName || '').toLowerCase() === p.client.toLowerCase());
  const linkedOpp = S.opportunities.find((o) => o.proposalId === p.id);
  const contacts = S.contacts.filter((c) => (ref.id != null && c.companyId === ref.id) || (c.clientName || '').toLowerCase() === p.client.toLowerCase());
  const contact = p.primaryContactId != null ? S.contacts.find((c) => c.id === p.primaryContactId) : undefined;
  const entity = entityById(p.businessEntityId);
  const txt = (v: string | null | undefined) => (v ? escHtml(v) : '');
  const date = (v: string | null | undefined) => (v ? escHtml(fmtDate(v)) : '');
  const sel = (key: string, value: string, options: [string, string][]) => () =>
    `<select class="td-select" id="prd-f-${key}" onchange="proposalFieldChanged('${key}', this.value)">${options.map(([v, l]) => `<option value="${escHtml(v)}"${v === value ? ' selected' : ''}>${escHtml(l)}</option>`).join('')}</select>`;
  const inp = (key: string, type: string, value: string, placeholder = '') => () =>
    `<input class="td-input" id="prd-f-${key}" type="${type}" value="${escHtml(value)}" placeholder="${escHtml(placeholder)}" onchange="proposalFieldChanged('${key}', this.value)" onkeydown="if(event.key==='Enter')this.blur()">`;
  const months = [3, 6, 12, 24, 36];
  const onRail = true; // Received, sent, signed and kickoff dates are on the stage rail; they show here only under Edit.
  const fields: PropField[] = [
    { key: 'client', label: 'Company', display: companyLink(p.companyId, p.client), always: true, control: inp('client', 'text', p.client),
      mount: (dd) => { const c = dd.querySelector<HTMLInputElement>('input'); if (c) attachCompanySelector(c, { onSelect: (name) => { endPropsEdit(); void proposalFieldChanged('client', name); } }); } },
    { key: 'opportunity', label: 'Opportunity', display: linkedOpp ? recordLink('opportunity', linkedOpp.id, linkedOpp.name) : '', control: opps.length ? sel('opportunity', linkedOpp ? String(linkedOpp.id) : '', [['', 'None'], ...opps.map((o) => [String(o.id), `${o.name} · ${o.stage}`] as [string, string])]) : undefined },
    { key: 'primaryContactId', label: 'Contact', display: contact ? recordLink('contact', contact.id, contact.name || 'Contact') : '', control: contacts.length ? sel('primaryContactId', p.primaryContactId != null ? String(p.primaryContactId) : '', [['', 'Not set'], ...contacts.map((c) => [String(c.id), [c.name, c.role].filter(Boolean).join(' · ')] as [string, string])]) : undefined },
    { key: 'ownerId', label: 'Owner', display: txt(ownerName(p)), always: true, control: sel('ownerId', p.ownerId != null ? String(p.ownerId) : p.owner ? `legacy:${p.owner}` : '', teamOptions(p.ownerId, p.owner)) },
    { key: 'reviewerId', label: 'Reviewer', display: txt(teamMember(p.reviewerId)?.name), control: sel('reviewerId', p.reviewerId != null ? String(p.reviewerId) : '', teamOptions(p.reviewerId, null, true)) },
    { key: 'businessEntityId', label: 'Entity', display: txt(entity?.name), control: sel('businessEntityId', p.businessEntityId != null ? String(p.businessEntityId) : '', [['', 'Not set'], ...S.businessEntities.filter((e) => e.active || e.id === p.businessEntityId).map((e) => [String(e.id), e.name] as [string, string])]) },
    { key: 'currency', label: 'Currency', display: entity && entity.currency === currencyOf(p) ? '' : txt(currencyOf(p)), control: sel('currency', currencyOf(p), CURRENCIES().map((c) => [c, c] as [string, string])) },
    { key: 'dateAdded', label: 'Received', display: onRail ? '' : date(p.dateAdded), control: inp('dateAdded', 'date', p.dateAdded || '') },
    // Shown in the header while it's a request or a draft; edited here.
    { key: 'promisedBy', label: 'Promised by', display: '', control: inp('promisedBy', 'date', p.promisedBy || '') },
    { key: 'sentDate', label: 'Sent', display: '', control: inp('sentDate', 'date', p.dateSentToClient || p.sentDate || '') },
    { key: 'dblSignedDate', label: 'Signed', display: '', control: inp('dblSignedDate', 'date', p.dblSignedDate || '') },
    { key: 'kickoffDate', label: 'Kickoff', display: p.kickoffDate && isWon(p) ? date(p.kickoffDate) : '', control: inp('kickoffDate', 'date', p.kickoffDate || '') },
    { key: 'contractMonths', label: 'Term', display: p.contractMonths ? `${p.contractMonths} months` : '', control: sel('contractMonths', p.contractMonths ? String(p.contractMonths) : '', [['', 'Not set'], ...months.map((m) => [String(m), `${m} months`] as [string, string]), ...(p.contractMonths && !months.includes(p.contractMonths) ? [[String(p.contractMonths), `${p.contractMonths} months`] as [string, string]] : [])]) },
    { key: 'validUntil', label: 'Valid until', display: date(p.validUntil), control: inp('validUntil', 'date', p.validUntil || '') },
    // Where it started (1.66): one line, a link while that proposal is still here.
    { key: 'basedOnId', label: 'Started from', display: p.basedOnId == null ? '' : S.proposals.some((x) => x.id === p.basedOnId) ? recordLink('proposal', p.basedOnId, basedOnLabel(p.basedOnId, S.proposals)) : txt(basedOnLabel(p.basedOnId, S.proposals)) },
    { key: 'leadSource', label: 'Source', display: txt(p.leadSource), control: sel('leadSource', p.leadSource || '', [['', 'Not set'], ...LEAD_SOURCES.map((x) => [x, x] as [string, string]), ...(p.leadSource && !LEAD_SOURCES.includes(p.leadSource) ? [[p.leadSource, p.leadSource] as [string, string]] : [])]) },
    { key: 'hubspot', label: 'In HubSpot', display: txt(p.hubspot), control: sel('hubspot', p.hubspot || '', [['', 'Not set'], ['Yes', 'Yes'], ['No', 'No']]) },
    { key: 'finance', label: 'Sent to finance', display: txt(p.finance), control: sel('finance', p.finance || '', [['', 'Not set'], ['Yes', 'Yes'], ['No', 'No']]) },
    { key: 'remarks', label: 'Remarks', display: p.remarks ? `<span class="pl-multiline">${escHtml(p.remarks)}</span>` : '',
      control: () => `<textarea class="td-input pr-remarks" id="prd-f-remarks" rows="2" placeholder="Anything the team should know" onchange="proposalFieldChanged('remarks', this.value)">${escHtml(p.remarks || '')}</textarea>` },
  ];
  el.innerHTML = propsListHtml('prd-props', fields, () => { const cur = currentProposal(); if (cur) renderProps(cur); });
  const act = document.getElementById('prd-props-act'); if (act) act.innerHTML = propsEditButton('prd-props');
  mountPropsList('prd-props');
}

export async function proposalFieldChanged(key: string, value: string): Promise<void> {
  const p = currentProposal();
  if (!p) return;
  const v = value.trim();
  switch (key) {
    case 'client':
      if (!v) { toast('A proposal needs a company', { tone: 'error' }); renderProposalPage(); return; }
      if (v === p.client) return;
      p.client = v;
      folderCache = null;
      break;
    case 'opportunity': {
      const prev = S.opportunities.find((o) => o.proposalId === p.id);
      const next = v ? S.opportunities.find((o) => o.id === Number(v)) : undefined;
      if (prev === next) return;
      const saves: Promise<void>[] = [];
      const save = (o: Opportunity) => saves.push(saveOpportunity(o).then((saved) => {
        const i = S.opportunities.findIndex((x) => x.id === saved.id);
        if (i > -1) S.opportunities[i] = saved;
      }).catch((err) => { toast('Could not update the opportunity', { tone: 'error', detail: String(err) }); }));
      if (prev) { prev.proposalId = null; save(prev); }
      if (next) { next.proposalId = p.id; save(next); }
      await Promise.all(saves);
      savedFlash();
      renderProposalPage();
      return;
    }
    case 'ownerId':
      if (v.startsWith('legacy:')) return;
      p.ownerId = v ? Number(v) : null;
      p.owner = teamMember(p.ownerId)?.name ?? null;
      break;
    case 'reviewerId': p.reviewerId = v ? Number(v) : null; break;
    case 'primaryContactId': p.primaryContactId = v ? Number(v) : null; break;
    case 'businessEntityId': {
      p.businessEntityId = v ? Number(v) : null;
      const entity = entityById(p.businessEntityId);
      if (entity && entity.currency !== currencyOf(p)) {
        const priced = (p.lines || []).some((l) => l.unitPrice != null);
        if (!priced || await showConfirm(`${entity.name} bills in ${entity.currency}. Switch this proposal's currency from ${currencyOf(p)} to ${entity.currency}? Prices are not converted.`, { title: 'Change currency?', confirmLabel: `Use ${entity.currency}` })) {
          p.currency = entity.currency;
        }
      }
      break;
    }
    case 'currency': p.currency = v || null; break;
    case 'sentDate': p.sentDate = v || null; p.dateSentToClient = v || null; break;
    case 'contractMonths': p.contractMonths = v ? Number(v) : null; break;
    case 'dateAdded': case 'promisedBy': case 'dblSignedDate': case 'kickoffDate': case 'validUntil': case 'leadSource': case 'hubspot': case 'finance': case 'remarks':
      (p as any)[key] = v || null;
      break;
    default: return;
  }
  commit(p);
}
expose('proposalFieldChanged', proposalFieldChanged);

// ── Follow-up: contact with the client while it is with them ──

/** Show every touch instead of the latest five (reset when another proposal opens). */
let contactAll: number | null = null;

export function renderContact(p: Proposal): void {
  const el = document.getElementById('prd-contact');
  if (!el) return;
  el.hidden = p.status !== PS.SENT;
  if (el.hidden) { el.innerHTML = ''; return; }
  const touches = touchesOf(p, S.touches).slice().sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
  const shown = contactAll === p.id ? touches : touches.slice(0, 5);
  const names = { memberName: (id: number) => (teamMember(id)?.name || '').trim().split(/\s+/)[0] || null, me: S.currentUserId };
  const rows = shown.map((t) => {
    const who = t.contactId != null ? contactFirstName(t.contactId) : null;
    // Who followed up when it was someone else, what was said, when they will revert (1.65); an entry logged by
    // hand can be changed or deleted afterwards.
    const line = entryLine({ direction: t.direction, byMemberId: t.byMemberId ?? null, note: t.note ?? null, revertAfter: t.revertAfter ?? null }, touchDoing(t, who), names);
    const edit = t.source === 'manual' && t.id > 0 ? `<button class="rlink pr-contact-edit" onclick="openEntryDialog([${p.id}], ${t.id})" aria-label="Edit the entry of ${escHtml(fmtDate(t.at.slice(0, 10)))}">Edit</button>` : '';
    return `<li><span>${[fmtDate(t.at.slice(0, 10)), line, t.subject || ''].filter(Boolean).map(escHtml).join(' · ')}</span>${edit}</li>`;
  }).join('');
  // When a follow-up is due the two actions are in the header; otherwise they stay here.
  const acts = needsFollowUp(p) ? '' : `<div class="rec-section-actions"><button class="btn-secondary btn-sm" onclick="openRevisionDialog(${p.id})" data-tip="Record what the client wants changed; the proposal goes back to drafting as a revision">Client asked for changes</button><button class="btn-secondary btn-sm" onclick="followUpMenu(event, ${p.id})" data-tip="Log an email, call, WhatsApp or meeting in one click" aria-haspopup="menu">Followed up ${icon('chevronDown', 11)}</button></div>`;
  el.innerHTML = `<div class="rec-section-hd"><h2>Follow-up</h2>${acts}</div>
    ${touches.length ? `<ul class="pr-contact-list">${rows}</ul>${touches.length > 5 && contactAll !== p.id ? `<a href="#" class="rlink pr-contact-all" onclick="event.preventDefault();proposalContactAll(${p.id})">Show all ${touches.length}</a>` : ''}` : `<p class="pr-review-note">${proposalSentDate(p) ? `Sent ${escHtml(fmtDate(proposalSentDate(p)))} · nothing logged since.` : 'Nothing logged since it was sent.'}</p>`}`;
  renderIcons(el);
}

export function proposalContactAll(id: number): void {
  contactAll = id;
  const p = currentProposal();
  if (p) renderContact(p);
}
expose('proposalContactAll', proposalContactAll);

// ── After the yes: the steps between the client's yes and the service running ──

function renderAfterYes(p: Proposal): void {
  const el = document.getElementById('prd-yes');
  if (!el) return;
  el.hidden = !showsAfterYes(p);
  if (el.hidden) { el.innerHTML = ''; return; }
  const rows = afterYes(p, S.agreements).map((x) => {
    // A recorded day of the two facts kept here can be changed; the others are changed where they are set.
    const own = x.key === 'accepted' || x.key === 'letter';
    const when = x.date
      ? (own ? `<button class="rlink pr-yes-d" onclick="proposalYesDate('${x.key}')" data-tip="Change the day">${escHtml(fmtDateShort(x.date, true))}</button>` : `<span class="pr-yes-d">${escHtml(fmtDateShort(x.date, true))}</span>`)
      : x.agreementId != null ? `<button class="rlink pr-yes-d" onclick="openRecord('agreement', ${x.agreementId})">Open</button>`
      : x.mark ? `<button class="rlink pr-yes-m" onclick="proposalMarkYes(event, '${x.key}')">${x.mark}</button>`
      : x.done ? '<span class="pr-yes-d">yes</span>' : '';
    // Done with a day of its own still to give (a signature implied the yes): the day can be added.
    const add = x.done && !x.date && x.mark && own ? `<button class="rlink pr-yes-m" onclick="proposalYesDate('${x.key}')">Add the day</button>` : '';
    return `<li class="${x.done ? 'is-done' : ''}"><i aria-hidden="true">${x.done ? icon('check', 11) : ''}</i><span class="pr-yes-l">${escHtml(x.label)}</span>${x.done && !x.date && own ? add : when}</li>`;
  }).join('');
  el.innerHTML = `<div class="rec-section-hd"><h2 class="rk-panel-h">After the yes</h2></div><ul class="pr-yes-list">${rows}</ul>`;
}

/** One click on a step that is not done: the two facts kept here take today (the toast undoes it); the others go
 * through what already records them — the signature, the agreement, the service start. */
export function proposalMarkYes(e: MouseEvent, key: YesKey): void {
  e.stopPropagation();
  const p = currentProposal();
  if (!p) return;
  if (key === 'accepted' || key === 'letter') {
    const restore = snapshotProposal(p);
    if (key === 'accepted') p.acceptedAt = today(); else p.engagementLetterSentAt = today();
    commit(p);
    undoToast(key === 'accepted' ? `${p.client}: accepted today` : `${p.client}: engagement letter sent today`, restore);
    return;
  }
  if (key === 'client_signed') { void proposalStep(PS.CLIENT_SIGNED); return; }
  if (key === 'both_signed') { openWlModal(p.id, 'won'); return; }
  if (key === 'agreement') { void (window as any).draftAgreementFor?.(p.id); return; }
  if (key === 'started') void proposalMarkServiceStarted();
}
expose('proposalMarkYes', proposalMarkYes);

/** The day the client accepted, or the engagement letter went out: set or changed, back-datable. */
export async function proposalYesDate(key: 'accepted' | 'letter'): Promise<void> {
  const p = currentProposal();
  if (!p) return;
  const cur = key === 'accepted' ? p.acceptedAt : p.engagementLetterSentAt;
  const date = await showDatePrompt({ title: key === 'accepted' ? 'Accepted' : 'Engagement letter sent', label: `${p.client} — ${key === 'accepted' ? 'the day the client said yes' : 'the day the engagement letter went out'}`, defaultValue: (cur || today()).slice(0, 10), confirmLabel: 'Save' });
  if (!date) return;
  const restore = snapshotProposal(p);
  if (key === 'accepted') p.acceptedAt = date; else p.engagementLetterSentAt = date;
  commit(p);
  undoToast(`${p.client}: ${key === 'accepted' ? 'accepted' : 'engagement letter sent'} ${fmtDateShort(date)}`, restore);
}
expose('proposalYesDate', proposalYesDate);

// ── Internal review ──

function renderReview(p: Proposal): void {
  const el = document.getElementById('prd-review');
  if (!el) return;
  const reviewer = teamMember(p.reviewerId) || defaultReviewer();
  const name = reviewer?.name || 'the reviewer';
  const at = stageIndex(p.status);
  let body = '';
  // Recorded by mistake: undo while it still counts (approved, not yet sent;
  // changes requested, still drafting because of it).
  const undo = `<a href="#" class="rlink pr-review-undo" onclick="event.preventDefault();proposalUndoReview()">Undo</a>`;
  if (p.reviewStatus === 'approved') {
    body = `<div class="pr-review-state tone-green">${icon('check', 14)} Approved by ${escHtml(name)}${p.reviewedAt ? ` on ${fmtDate(p.reviewedAt)}` : ''}${p.status === PS.REVIEW ? `<span class="pr-review-undo-sep">·</span>${undo}` : ''}</div>${p.reviewNote ? `<p class="pr-review-note">${escHtml(p.reviewNote)}</p>` : ''}`;
  } else if (p.reviewStatus === 'changes_requested') {
    // "Submit for review" is the header's main action while drafting.
    body = `<div class="pr-review-state tone-amber">${icon('edit', 14)} ${escHtml(name)} asked for changes${p.reviewedAt ? ` on ${fmtDate(p.reviewedAt)}` : ''}${p.status === PS.DRAFTING ? `<span class="pr-review-undo-sep">·</span>${undo}` : ''}</div>${p.reviewNote ? `<p class="pr-review-note">${escHtml(p.reviewNote)}</p>` : ''}`;
  } else if (p.status === PS.REVIEW) {
    body = `<div class="pr-review-state tone-accent">${icon('clock', 14)} With ${escHtml(name)} since ${fmtDate(p.reviewRequestedAt || p.dateSentToHassan)}</div>
      <textarea class="finp pr-review-input" id="prd-review-note" data-typing rows="2" placeholder="Comments from the review (optional)">${escHtml(p.reviewNote || '')}</textarea>
      <div class="btn-row">
        <button class="btn-secondary is-positive" onclick="proposalRecordReview('approved')">${icon('check', 13)} Approved</button>
        <button class="btn-secondary" onclick="proposalRecordReview('changes_requested')">Changes requested</button>
      </div>`;
  } else if (at >= 0 && at < stageIndex(PS.REVIEW)) {
    body = `<p class="pr-review-note">Reviewed by ${escHtml(name)} before it goes to the client.</p>`;
  }
  // Nothing recorded and nothing to do: no section.
  el.hidden = !body;
  el.innerHTML = body ? `<div class="rec-section-hd"><h2>Internal review</h2></div>${body}` : '';
}

export function proposalRecordReview(outcome: 'approved' | 'changes_requested'): void {
  const p = currentProposal();
  if (!p) return;
  const note = (document.getElementById('prd-review-note') as HTMLTextAreaElement | null)?.value || null;
  if (outcome === 'changes_requested' && !note?.trim()) { toast('Add what needs to change', { tone: 'error' }); const box = document.getElementById('prd-review-note'); box?.focus(); shake(box); return; }
  const restore = snapshotProposal(p);
  recordReview(p.id, outcome, note);
  renderProposalPage();
  undoToast(outcome === 'approved' ? 'Review recorded — ready to send' : 'Changes requested — back to drafting', restore);
}
expose('proposalRecordReview', proposalRecordReview);

export function proposalUndoReview(): void {
  const p = currentProposal();
  if (!p) return;
  undoReview(p.id);
  renderProposalPage();
}
expose('proposalUndoReview', proposalUndoReview);

// ── Commercials ──

/** null: the default for the stage (open while pricing is the job — Request and Drafting — or when there are no lines). */
let linesEditing: boolean | null = null;

export function toggleProposalLines(): void {
  const p = currentProposal();
  if (!p) return;
  linesEditing = !linesOpen(p);
  renderCommercials(p);
}
expose('toggleProposalLines', toggleProposalLines);

function linesOpen(p: Proposal): boolean {
  if (isWon(p) && (p.lines || []).length) return false;
  if (!(p.lines || []).length) return true;
  return linesEditing ?? (p.status === PS.REQUEST || p.status === PS.DRAFTING);
}

function renderCommercials(p: Proposal): void {
  // A revision: each changed service says what it was; removed ones and a new term once, below.
  const before = revisionOf(p) > 1 ? parseSnapshot(latestRevision(p)?.linesBeforeJson) : null;
  const count = document.getElementById('prd-lines-count'); if (count) count.textContent = (p.lines || []).length ? String(p.lines!.length) : '';
  const open = linesOpen(p);
  const act = document.getElementById('prd-lines-act');
  if (act) act.innerHTML = (p.lines || []).length && !(isWon(p)) ? `<button class="btn-ghost btn-sm" onclick="toggleProposalLines()" aria-pressed="${open}">${open ? 'Done' : 'Edit'}</button>` : '';
  renderLinesEditor(`proposal:${p.id}`, 'prd-lines', {
    lines: () => p.lines || [],
    setLines: (lines) => { p.lines = lines; },
    currency: () => currencyOf(p),
    contractMonths: () => p.contractMonths,
    editable: open,
    lineNote: (l) => (before ? lineWasNote(l, before, currencyOf(p)) : null),
    onChange: () => {
      syncProposalTotals(p);
      persistProposals();
      savedFlash();
      const t = document.getElementById('prd-title');
      if (t) t.querySelector('.pr-title-services')!.textContent = lineTotals(p.lines, p.contractMonths).serviceNames.join(' + ') || 'Services to be confirmed';
      const c = document.getElementById('prd-lines-count'); if (c) c.textContent = (p.lines || []).length ? String(p.lines!.length) : '';
      refreshCompanyViewIfOpen();
    },
  });
  if (before) {
    const removed = removedServices(before, p.lines || []);
    const term = (before.contractMonths ?? null) !== (p.contractMonths ?? null) ? `Term was ${before.contractMonths ? `${before.contractMonths} months` : 'not set'}` : '';
    const notes = [removed.length ? `Removed: ${removed.join(', ')}` : '', term].filter(Boolean);
    if (notes.length) document.getElementById('prd-lines')?.insertAdjacentHTML('beforeend', `<p class="form-hint le-was">${escHtml(notes.join(' · '))}</p>`);
  }
  if (isWon(p) && (p.lines || []).length) {
    document.getElementById('prd-lines')?.insertAdjacentHTML('beforeend', `<p class="form-hint">Signed proposals keep the commercials that were agreed. Changes to the running service belong on the agreement.</p>`);
  }
}

// ── Documents ──

const DOC_EXT = /\.(pptx|ppt|pdf|docx|doc|xlsx|xls|key)$/i;

async function renderDocuments(p: Proposal): Promise<void> {
  const folderEl = document.getElementById('prd-folder');
  const docsEl = document.getElementById('prd-docs');
  const actions = document.getElementById('prd-docs-actions');
  if (!folderEl || !docsEl) return;
  let info = folderCache?.proposalId === p.id && folderCache.client === p.client ? folderCache.info : null;
  if (!info) {
    folderEl.innerHTML = `<div class="feed-empty">Looking for the client folder…</div>`;
    try {
      info = await proposalFolderLookup(p.client, p.folderPath ?? null);
    } catch {
      info = { root: null, path: null, exists: false, files: [] };
    }
    if (S.currentProposalId !== p.id) return;
    folderCache = { proposalId: p.id, client: p.client, info };
    if (info.exists && info.path && p.folderPath !== info.path) { p.folderPath = info.path; persistProposals(); }
    renderToolbar(p);
    const tb = document.getElementById('prd-toolbar'); if (tb) renderIcons(tb);
  }
  const serviceLabel = lineTotals(p.lines, p.contractMonths).serviceNames.join(' & ') || p.type || 'Services';
  const suggested = nextDeckFileName(p, serviceLabel, today(), info.files.map((f) => f.name));
  // The folder path below opens it in Finder; no second button for the same thing.
  if (actions) actions.innerHTML = '';
  arrive(folderEl);
  if (!info.root) {
    folderEl.innerHTML = `<div class="pr-folder-line rec-muted">${icon('folder', 14)} No Proposals folder found in OneDrive. Choose it in Settings → Proposals.</div>`;
  } else if (!info.exists) {
    folderEl.innerHTML = `<div class="pr-folder-line">${icon('folder', 14)}<span>No folder for ${escHtml(p.client)} yet in <span data-tip="${escHtml(info.root)}">${escHtml(breadcrumb(info.root))}</span></span><button class="btn-secondary btn-sm" onclick="proposalCreateFolder()">Create folder</button></div>`;
  } else {
    // The folder by name (like Files); the full path is on hover.
    const folderName = (info.path || '').split('/').filter(Boolean).pop() || p.client;
    folderEl.innerHTML = `<div class="pr-folder-line">${icon('folder', 14)}<button class="rlink pr-folder-path" onclick="proposalOpenFolder()" data-tip="${escHtml(info.path || '')}" aria-label="Open ${escHtml(folderName)} in Finder">${escHtml(breadcrumb(info.path) || folderName)}</button></div>
      <div class="pr-next-name"><span class="rec-muted">Next file name</span><code>${escHtml(suggested)}</code><button class="rec-icon-btn pr-copy-name" onclick="copyText('${escHtml(suggested.replace(/'/g, "\\'"))}','File name copied')" data-tip="Copy file name" aria-label="Copy file name">${icon('copy', 13)}</button></div>`;
  }

  // Generated decks: their own version history above; everything else is supporting.
  renderDeckHistory(p);
  const recorded = (p.documents || []).filter((d) => d.kind !== 'proposal');
  const recordedPaths = new Set((p.documents || []).map((d) => d.path).filter(Boolean));
  // A deck made by hand in the client folder: offered first, not again in the list.
  const matches = matchDecks(p, info.files, S.proposals).slice(0, 3);
  const matched = new Set(matches.map((f) => f.path));
  const files = info.files.filter((f) => !f.isFolder && DOC_EXT.test(f.name) && !recordedPaths.has(f.path) && !matched.has(f.path))
    .sort((a, b) => (b.modifiedAt || '').localeCompare(a.modifiedAt || ''));
  const kindLabel = { proposal: 'Proposal', commercials: 'Commercials', supporting: 'Supporting' } as const;
  const rows: string[] = [];
  for (const d of [...recorded].sort((a, b) => (b.version ?? 0) - (a.version ?? 0) || b.id - a.id)) {
    const path = d.path ? escHtml(d.path.replace(/'/g, "\\'")) : '';
    rows.push(`<div class="rec-row"${d.path ? ` tabindex="0" data-ql-path="${escHtml(d.path)}" onkeydown="if(event.key==='Enter'&&event.target===this)this.click()" onclick="proposalOpenFile('${path}')"` : d.url ? ` onclick="openExternalUrl('${escHtml(d.url)}')"` : ''}>
      <span class="rec-row-icon">${icon('document', 15)}</span>
      <div class="rec-row-main"><div class="rec-row-title">${escHtml(d.fileName)}</div><div class="rec-row-sub">${kindLabel[d.kind] || 'Document'}${d.version ? ` · V${d.version}` : ''}${d.createdAt ? ` · added ${fmtDate(d.createdAt)}` : ''}</div></div>
      <div class="rec-row-actions"><button class="rec-icon-btn" onclick="event.stopPropagation();proposalRemoveDocument(${d.id})" data-tip="Remove from this proposal" aria-label="Remove from this proposal">${icon('close', 13)}</button></div>
    </div>`);
  }
  if (p.docLink) {
    rows.push(`<div class="rec-row" onclick="openExternalUrl('${escHtml(p.docLink)}')"><span class="rec-row-icon">${icon('link', 15)}</span><div class="rec-row-main"><div class="rec-row-title">Document link</div><div class="rec-row-sub">${escHtml(p.docLink)}</div></div></div>`);
  }
  if (matches.length) rows.push(deckMatchBlock(p, matches));
  for (const f of files.slice(0, 12)) rows.push(folderFileRow(f));
  const count = document.getElementById('prd-docs-count'); if (count) count.textContent = recorded.length ? String(recorded.length) : '';
  docsEl.innerHTML = rows.length ? rows.join('') : emptyState({ icon: 'document', title: 'No supporting documents', body: info.exists ? 'Other files saved in the client folder show up here.' : 'Create the client folder to keep commercials and supporting files with the proposal.', compact: true });
  renderIcons(docsEl);
  renderIcons(folderEl);
}

/** Which decks' files are still in place, and the fingerprints of the ones MENA One wrote, per proposal (read once
 * per set of paths, and again when the window comes back from PowerPoint). */
let deckFiles: { key: string; status: Map<string, boolean>; prints: Fingerprints; /** The check before sending, per file read; null while it is being read. */ checks: Map<string, SendCheck | null> } | null = null;
let deckFilesReadAt = 0;
window.addEventListener('focus', () => {
  const p = currentProposal();
  if (!p || !deckFiles || Date.now() - deckFilesReadAt < 5000 || !document.getElementById('prd-decks')?.offsetParent) return;
  deckFiles = null;
  renderDeckHistory(p);
});

function renderDeckHistory(p: Proposal): void {
  const el = document.getElementById('prd-decks');
  if (!el) return;
  const decks = (p.documents || []).filter((d) => d.kind === 'proposal');
  const count = document.getElementById('prd-decks-count'); if (count) count.textContent = decks.length ? String(decks.length) : '';
  // No deck yet while requested or drafting: generating it is the section's feature card, and the header's blue button.
  const featured = generateIsFeatured(p, hasDeck(p));
  const sectionBtn = document.getElementById('prd-gen-btn'); if (sectionBtn) sectionBtn.hidden = featured;
  if (!decks.length) {
    el.innerHTML = featured ? `<div class="deck-feature"><span class="deck-feature-tile" aria-hidden="true">${icon('bolt', 18)}</span>
      <div class="deck-feature-t"><b>Generate the deck</b><span>A PowerPoint in the MENA BIG design with this proposal’s services, prices and term, saved in the client folder as V1.</span></div>
      <button class="btn-secondary btn-sm" onclick="generateCurrentProposal()">Generate proposal</button></div>` : '';
    return;
  }
  const paths = decks.map((d) => d.path).filter((x): x is string => !!x);
  const key = `${p.id}:${paths.join('|')}`;
  const fresh = deckFiles?.key !== key;
  // On a re-read the last answers stay on screen until the new ones are in.
  const state = fresh ? { key, status: new Map(deckFiles?.status), prints: new Map(deckFiles?.prints) as Fingerprints, checks: new Map(deckFiles?.checks) } : deckFiles!;
  // The check before sending sits beside the latest version while the client does not have it. It reads the file
  // once per visit (and again when the window comes back, or on "Check again"), and changes nothing.
  const draft = draftDeck(p);
  const toCheck = draft?.path && state.status.get(draft.path) !== false ? draft : null;
  const draw = () => {
    const panel = toCheck ? { afterId: toCheck.id, html: sendCheckHtml(toCheck, state.checks.get(toCheck.path!) ?? null, { narrow: decks.length > 1 }) } : null;
    el.innerHTML = proposalDeckRows(p, state.status, state.prints, panel);
    renderIcons(el);
  };
  draw();
  if (toCheck && (fresh || !state.checks.has(toCheck.path!))) {
    const path = toCheck.path!;
    if (!state.checks.has(path)) state.checks.set(path, null);
    void proposalSendCheck(path)
      .then((c) => state.checks.set(path, c))
      .catch((e) => state.checks.set(path, { fileName: toCheck.fileName, checked: false, note: `Not checked: ${String(e)}`, lines: [], slideCount: 0 }))
      .then(() => { if (S.currentProposalId === p.id && deckFiles === state) draw(); });
  }
  if (!fresh) return;
  deckFiles = state;
  deckFilesReadAt = Date.now();
  const redraw = () => { if (S.currentProposalId === p.id && deckFiles === state) draw(); };
  void filesStatPaths(paths).then((items) => {
    for (const it of items) state.status.set(it.path, it.exists);
    redraw();
  }).catch(() => { /* unknown status: rows stay openable */ });
  // Only a file MENA One wrote has a fingerprint to compare with.
  const written = decks.filter((d) => !!d.path && !!d.generatedSha256).map((d) => d.path!);
  void filesFingerprints(written).then((items) => {
    for (const it of items) state.prints.set(it.path, it.sha256);
    if (items.length) redraw();
  }).catch(() => { /* not read: nothing is called edited */ });
}

/** "This is the one sent to the client" on a version, generated or attached: the mark moves to it and the version
 * leads the section; on the marked one it takes the mark off. The proposal's status is not touched. */
export function proposalMarkSentVersion(id: number): void {
  const p = currentProposal();
  const d = (p?.documents || []).find((x) => x.id === id);
  if (!p || !d) return;
  markSentVersion(p, d.sentToClientAt ? null : id, sentDayFor(p, d, today()));
  commit(p);
}
expose('proposalMarkSentVersion', proposalMarkSentVersion);

/** "Check again" on the check before sending: the file is read afresh. */
export function proposalRecheck(): void {
  const p = currentProposal();
  if (!p) return;
  deckFiles = null;
  renderDeckHistory(p);
}
expose('proposalRecheck', proposalRecheck);

/** "Mark as sent" beside the check: the proposal is marked as sent (one click, as everywhere: today, by its owner,
 * with Undo and "Change day or sender") and this version as the one the client has. On a proposal the client
 * already has, a later version went today. The check never stands in the way. */
export async function proposalSendVersion(id: number): Promise<void> {
  const p = currentProposal();
  const d = (p?.documents || []).find((x) => x.id === id);
  if (!p || !d) return;
  if (stageIndex(p.status) < stageIndex(PS.SENT)) {
    if (await changeProposalStatus(p.id, PS.SENT, { sentDocId: id })) renderProposalPage();
    return;
  }
  const restore = snapshotProposal(p);
  markSentVersion(p, id, today());
  if (p.status === PS.SENT) p.lastSentAt = today();
  commit(p);
  undoToast(`${p.client}: V${d.version ?? '?'} sent today`, restore);
}
expose('proposalSendVersion', proposalSendVersion);

export function generateCurrentProposal(): void {
  if (S.currentProposalId != null) void (window as any).openGenerateProposal?.(S.currentProposalId);
}
expose('generateCurrentProposal', generateCurrentProposal);

function folderFileRow(f: LocalFileItem): string {
  const path = escHtml(f.path.replace(/'/g, "\\'"));
  return `<div class="rec-row pr-folder-file" tabindex="0" data-ql-path="${escHtml(f.path)}" onkeydown="if(event.key==='Enter'&&event.target===this)this.click()" onclick="proposalOpenFile('${path}')">
    <span class="rec-row-icon">${icon('document', 15)}</span>
    <div class="rec-row-main"><div class="rec-row-title">${escHtml(f.name)}</div><div class="rec-row-sub">In the client folder${f.modifiedAt ? ` · modified ${fmtDate(f.modifiedAt.slice(0, 10))}` : ''}</div></div>
    <div class="rec-row-actions"><button class="btn-secondary btn-sm" onclick="event.stopPropagation();proposalAttachFile('${path}')">Add to proposal</button></div>
  </div>`;
}

function deckMatchBlock(p: Proposal, matches: LocalFileItem[]): string {
  const taken = (p.documents || []).filter((d) => d.kind === 'proposal').map((d) => d.version ?? 0);
  return `<div class="pr-deck-match"><div class="rec-eyebrow">Looks like this proposal's deck</div>${matches.map((f) => {
    const path = escHtml(f.path.replace(/'/g, "\\'"));
    return `<div class="rec-row" tabindex="0" data-ql-path="${escHtml(f.path)}" onkeydown="if(event.key==='Enter'&&event.target===this)this.click()" onclick="proposalOpenFile('${path}')">
      <span class="rec-row-icon">${icon('document', 15)}</span>
      <div class="rec-row-main"><div class="rec-row-title" title="${escHtml(f.name)}">${escHtml(f.name)}</div><div class="rec-row-sub">${f.modifiedAt ? `Modified ${fmtDate(f.modifiedAt.slice(0, 10))}` : 'In the client folder'}</div></div>
      <div class="rec-row-actions"><button class="btn-secondary btn-sm" onclick="event.stopPropagation();proposalAttachFile('${path}')">Add as V${deckVersion(f.name, taken)}</button></div>
    </div>`;
  }).join('')}</div>`;
}

export async function proposalCreateFolder(): Promise<void> {
  const p = currentProposal();
  if (!p) return;
  try {
    const info = await proposalFolderCreate(p.client);
    folderCache = { proposalId: p.id, client: p.client, info };
    p.folderPath = info.path;
    persistProposals();
    toast('Client folder created in OneDrive', { tone: 'success' });
    renderProposalPage();
  } catch (err) {
    toast('Could not create the folder', { tone: 'error', detail: String(err) });
  }
}
expose('proposalCreateFolder', proposalCreateFolder);

/** Reads the client folder again (files were just dropped into it) and redraws. */
export async function proposalRefreshFolder(): Promise<void> {
  const p = currentProposal();
  if (!p) return;
  const info = await proposalFolderLookup(p.client, p.folderPath ?? null);
  folderCache = { proposalId: p.id, client: p.client, info };
  renderProposalPage();
}

/** A file attached as the deck when it is one (pptx/key/pdf with "proposal" in the name). Pure. */
export function isDeckFile(name: string): boolean {
  return /\.(pptx|ppt|key|pdf)$/i.test(name) && /proposal/i.test(name);
}

export function proposalAttachFile(path: string): void {
  const p = currentProposal();
  const file = folderCache?.info.files.find((f) => f.path === path);
  if (!p || !file) return;
  const isDeck = isDeckFile(file.name);
  const isCommercials = /\.(xlsx|xls)$/i.test(file.name) || /commercial|pricing|quotation/i.test(file.name);
  const docs = p.documents || [];
  // A deck keeps the version in its name unless that number is already taken; otherwise it is the next one.
  const taken = docs.filter((d) => d.kind === 'proposal').map((d) => d.version ?? 0);
  docs.push({
    id: nextDocumentId(), kind: isDeck ? 'proposal' : isCommercials ? 'commercials' : 'supporting',
    version: isDeck ? deckVersion(file.name, taken) : null, fileName: file.name, path: file.path, url: null, notes: null, createdAt: today(),
  });
  p.documents = docs;
  // As with a generated deck: a first deck means drafting has started (never moves back).
  if (isDeck && p.status === PS.REQUEST) updateStatus(p.id, PS.DRAFTING);
  commit(p);
}
expose('proposalAttachFile', proposalAttachFile);

export function proposalRemoveDocument(id: number): void {
  const p = currentProposal();
  if (!p) return;
  p.documents = (p.documents || []).filter((d) => d.id !== id);
  commit(p);
}
expose('proposalRemoveDocument', proposalRemoveDocument);

// ── Linked records, notes, activity ──

function renderRelated(p: Proposal): void {
  const el = document.getElementById('prd-related');
  if (!el) return;
  const opp = S.opportunities.find((o) => o.proposalId === p.id);
  const agreement = S.agreements.find((a) => a.proposalId === p.id);
  const project = opp?.projectId != null ? S.projects.find((x) => x.id === opp.projectId) : undefined;
  const contact = p.primaryContactId != null ? S.contacts.find((c) => c.id === p.primaryContactId) : undefined;
  const row = (kind: string, id: number, iconName: string, title: string, sub: string) =>
    `<div class="rec-row" onclick="openRecord('${kind}', ${id})"><span class="rec-row-icon">${icon(iconName, 15)}</span><div class="rec-row-main"><div class="rec-row-title">${recordLink(kind as any, id, title)}</div><div class="rec-row-sub">${escHtml(sub)}</div></div></div>`;
  const rows = [
    opp ? row('opportunity', opp.id, 'target', opp.name, `Opportunity · ${opp.stage}`) : '',
    agreement ? row('agreement', agreement.id, 'document', agreement.agrRef || 'Agreement', `Agreement · ${agreement.status || '—'}${agreement.serviceStatus ? ` · service ${agreement.serviceStatus.toLowerCase()}` : ''}`) : '',
    project ? row('project', project.id, 'briefcase', project.name, `Project · ${project.status}`) : '',
    contact ? row('contact', contact.id, 'people', contact.name || 'Contact', ['Contact', contact.role, contact.email].filter(Boolean).join(' · ')) : '',
  ].filter(Boolean);
  el.innerHTML = rows.join('');
  const sec = document.getElementById('prd-related-sec'); if (sec) sec.hidden = !rows.length;
}

function renderNotes(p: Proposal): void {
  const el = document.getElementById('prd-notes');
  if (!el) return;
  const notes = [...(p.notes || [])].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id);
  const count = document.getElementById('prd-notes-count'); if (count) count.textContent = notes.length ? String(notes.length) : '';
  el.innerHTML = renderFeed(notes.map((n) => ({ at: n.date || '', iconName: 'note', tone: 'muted' as const, html: escHtml(n.text || '') })), { empty: 'No notes yet.' });
}

export function addProposalPageNote(): void {
  const p = currentProposal();
  const input = document.getElementById('prd-note-input') as HTMLTextAreaElement | null;
  const text = input?.value.trim();
  if (!p || !text) return;
  p.notes = [...(p.notes || []), { id: Date.now(), date: today(), text }];
  if (input) input.value = '';
  persistProposals();
  renderNotes(p);
  window.setTimeout(() => void renderActivity(p), 400);
}
expose('addProposalPageNote', addProposalPageNote);

async function renderActivity(p: Proposal): Promise<void> {
  const el = document.getElementById('prd-activity');
  if (!el) return;
  // Notes have their own section above, so they stay out of the timeline.
  await renderRecordTimeline({ elId: 'prd-activity', record: { kind: 'proposal', id: p.id }, scopeToggle: false, skipPast: (action) => action === 'note_added' });
}

// ═══════════════ New proposal ═══════════════

interface BuilderPrefill {
  client?: string;
  opportunityId?: number;
  contactId?: number;
  lines?: CommercialLine[];
  currency?: string | null;
  businessEntityId?: number | null;
  contractMonths?: number | null;
  /** The proposal these lines were copied from. */
  basedOnId?: number | null;
}

let draftLines: CommercialLine[] = [];
let builderFolder: ProposalFolder | null = null;
// Several proposals in one go: `draftLines` and the term select are the active
// block's; the other blocks wait here as one line each (lib/proposalBlocks.ts).
let blocks: ProposalBlock[] = [emptyBlock()];
let activeBlock = 0;

const val = (id: string) => ((document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null)?.value || '').trim();
const setVal = (id: string, v: string) => { const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null; if (el) el.value = v; };
const setOptions = (id: string, opts: [string, string][], selected = '') => {
  const el = document.getElementById(id) as HTMLSelectElement | null;
  if (el) el.innerHTML = opts.map(([v, l]) => `<option value="${escHtml(v)}"${v === selected ? ' selected' : ''}>${escHtml(l)}</option>`).join('');
};

export function openProposalBuilder(prefill: BuilderPrefill = {}): void {
  if (S.currentTab !== 'database') w.switchTab('database');
  S.currentProposalId = null;
  S.proposalBuilderOpen = true;
  showView('builder');
  window.scrollTo(0, 0);
  const form = document.getElementById('prb-form') as HTMLFormElement | null;
  form?.reset();
  draftLines = (prefill.lines || []).map((l, i) => ({ ...l, sortOrder: i }));
  blocks = [{ ...emptyBlock(prefill.contractMonths ?? null), basedOnId: prefill.basedOnId ?? null }];
  activeBlock = 0;
  builderFolder = null;
  fromOpen = false;

  const entity = entityById(prefill.businessEntityId) || defaultEntity();
  setOptions('prb-entity', S.businessEntities.filter((e) => e.active).map((e) => [String(e.id), `${e.name} (${e.currency})`]), entity ? String(entity.id) : '');
  setOptions('prb-currency', CURRENCIES().map((c) => [c, c]), prefill.currency || entity?.currency || 'SAR');
  const me = currentUser();
  setOptions('prb-owner', [['', 'Not set'], ...activeTeam().map((t) => [String(t.id), t.name] as [string, string])], me ? String(me.id) : '');
  browseAll = false; showEntityFields = !!(prefill.currency && entity && prefill.currency !== entity.currency); showWorkflowFields = false;
  const reviewer = defaultReviewer();
  setOptions('prb-reviewer', [['', 'Not set'], ...reviewers().map((t) => [String(t.id), t.name] as [string, string])], reviewer ? String(reviewer.id) : '');
  setOptions('prb-source', [['', 'Not set'], ...LEAD_SOURCES.map((s) => [s, s] as [string, string])]);
  setVal('prb-received', today());
  setVal('prb-sent', today());
  setVal('prb-months', prefill.contractMonths ? String(prefill.contractMonths) : '');
  setVal('prb-client', prefill.client || '');
  setVal('prb-status', PS.REQUEST);
  prbStatusChanged();

  const client = document.getElementById('prb-client') as HTMLInputElement | null;
  if (client) attachCompanySelector(client, { onSelect: (name) => { client.value = name; prbClientChanged(); } });
  prbClientChanged(prefill.opportunityId, prefill.contactId);
  setVal('prb-service-q', '');
  setVal('prb-promised', '');
  renderServicePicker();
  prbRefreshLines();
  renderDefaultsLines();
  renderBlocks();
  const page = document.getElementById('pr-builder'); if (page) renderIcons(page);
  notifyNavigated();
  if (!prefill.client) window.setTimeout(() => client?.focus(), 50);
}
expose('openProposalBuilder', openProposalBuilder);

export function closeProposalBuilder(): void {
  closeProposalPage();
}
expose('closeProposalBuilder', closeProposalBuilder);

function builderCompanyMatches(name: string) {
  const n = name.trim().toLowerCase();
  const co = S.companies.find((c) => c.name.toLowerCase() === n);
  const match = <T,>(items: T[], id: (x: T) => number | null | undefined, nm: (x: T) => string | null | undefined) =>
    items.filter((x) => (co && id(x) === co.id) || (nm(x) || '').trim().toLowerCase() === n);
  return { co, match };
}

const lookupFolder = debounce(async () => {
  const client = val('prb-client');
  if (!client) { builderFolder = null; renderBuilderFolder(); return; }
  try {
    const info = await proposalFolderLookup(client, null);
    if (val('prb-client') !== client) return;
    builderFolder = info;
  } catch {
    builderFolder = { root: null, path: null, exists: false, files: [] };
  }
  renderBuilderFolder();
}, 350);

export function prbClientChanged(opportunityId?: number, contactId?: number): void {
  const client = val('prb-client');
  const info = document.getElementById('prb-client-info');
  const { co, match } = builderCompanyMatches(client);
  const proposals = client ? match(S.proposals, (p) => p.companyId, (p) => p.client) : [];
  const agreements = client ? match(S.agreements, (a) => a.companyId, (a) => a.client) : [];
  const contacts = client ? match(S.contacts, (c) => c.companyId, (c) => c.clientName) : [];
  const opps = client ? match(S.opportunities, (o) => o.companyId, (o) => o.companyName).filter((o) => !o.archived) : [];
  if (info) {
    if (!client) info.innerHTML = '';
    else if (!co && !proposals.length) {
      const similar = S.companies.filter((c) => { const a = c.name.toLowerCase(); const b = client.toLowerCase(); return b.length >= 3 && a !== b && (a.includes(b) || b.includes(a)); }).slice(0, 3);
      info.innerHTML = `<div class="prb-client-card new">${icon('plus', 14)}<div><strong>New client.</strong> ${escHtml(client)} will be added to Companies.${similar.length ? `<div class="prb-similar">Did you mean ${similar.map((c) => `<button type="button" class="rlink" onclick="prbPickClient('${escHtml(c.name.replace(/'/g, "\\'"))}')">${escHtml(c.name)}</button>`).join(', ')}?</div>` : ''}</div></div>`;
    } else {
      const open = proposals.filter((p) => !p.archived && !isClosed(p)).length;
      const signed = agreements.filter((a) => a.status === 'Signed' || a.serviceStatus === 'Active').length;
      const services = [...new Set(proposals.flatMap((p) => (p.lines || []).map((l) => l.serviceName)).filter(Boolean))].slice(0, 4);
      info.innerHTML = `<div class="prb-client-card">${icon('building', 14)}<div><strong>${escHtml(co?.name || client)}</strong> — ${proposals.length} proposal${proposals.length === 1 ? '' : 's'}${open ? ` (${open} open)` : ''}, ${signed} signed agreement${signed === 1 ? '' : 's'}, ${contacts.length} contact${contacts.length === 1 ? '' : 's'}.${services.length ? `<div class="prb-similar">Services on file: ${services.map(escHtml).join(', ')}</div>` : ''}</div></div>`;
    }
    renderIcons(info);
  }
  const selectedOpp = opportunityId != null ? String(opportunityId) : val('prb-opportunity');
  setOptions('prb-opportunity', [['', 'None'], ...opps.map((o) => [String(o.id), `${o.name} · ${o.stage}`] as [string, string])], opps.some((o) => String(o.id) === selectedOpp) ? selectedOpp : '');
  // Opportunity and contact appear once there's a company — the opportunity only when it has some.
  const links = document.getElementById('prb-links'); if (links) links.hidden = !client;
  const oppGrp = document.getElementById('prb-opportunity-grp'); if (oppGrp) oppGrp.hidden = !opps.length;
  const selectedContact = contactId != null ? String(contactId) : val('prb-contact');
  setOptions('prb-contact', [['', 'Not set'], ...contacts.map((c) => [String(c.id), [c.name, c.role].filter(Boolean).join(' · ')] as [string, string]), ['new', 'Add a new contact…']], contacts.some((c) => String(c.id) === selectedContact) ? selectedContact : '');
  prbContactChanged();
  builderFolder = null;
  renderBuilderFolder();
  lookupFolder();
  renderBuilderSummary();
}
expose('prbClientChanged', prbClientChanged);

export function prbPickClient(name: string): void {
  setVal('prb-client', name);
  prbClientChanged();
}
expose('prbPickClient', prbPickClient);

export function prbContactChanged(): void {
  const box = document.getElementById('prb-new-contact');
  if (box) box.hidden = val('prb-contact') !== 'new';
}
expose('prbContactChanged', prbContactChanged);

export function prbStatusChanged(): void {
  const grp = document.getElementById('prb-sent-grp');
  if (grp) grp.hidden = val('prb-status') !== PS.SENT;
  renderBuilderSummary();
  renderDefaultsLines();
}
expose('prbStatusChanged', prbStatusChanged);

export function prbEntityChanged(): void {
  const entity = entityById(Number(val('prb-entity')));
  if (entity) setVal('prb-currency', entity.currency);
  prbRefreshLines();
  renderDefaultsLines();
}
expose('prbEntityChanged', prbEntityChanged);

// Services: a search box and the five used most; the whole catalogue on demand.
let browseAll = false;
let serviceMenuIndex = 0;

/** The services used most on proposals so far (catalogue order when there's no history). */
function topServices(n = 5): typeof S.services {
  const counts = new Map<number, number>();
  for (const p of S.proposals) for (const l of p.lines || []) if (l.serviceId != null) counts.set(l.serviceId, (counts.get(l.serviceId) || 0) + 1);
  const active = activeServices();
  return [...active].sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0) || active.indexOf(a) - active.indexOf(b)).slice(0, n);
}

const chosenServices = () => new Set(draftLines.map((l) => l.serviceId).filter((x) => x != null));

function renderServicePicker(): void {
  const top = document.getElementById('prb-top');
  const el = document.getElementById('prb-service-picker');
  if (!top || !el) return;
  const chosen = chosenServices();
  // The rate card's price shows on hover; a coral dot marks a service already on the proposal.
  const currency = val('prb-currency') || 'SAR';
  const tip = (sv: { id: number }) => {
    const r = priceRange(serviceById(sv.id));
    return r ? (r.min === r.max ? fmtMoney(r.min, currency) : `${fmtMoney(r.min, currency)} – ${fmtMoney(r.max, currency)}`) : 'No rate card price';
  };
  const chip = (sv: { id: number; name: string }) => chosen.has(sv.id)
    ? `<button type="button" class="prb-chip is-added" aria-disabled="true" data-tip="On this proposal · ${escHtml(tip(sv))}"><span class="prb-chip-dot" aria-hidden="true"></span>${escHtml(sv.name)}</button>`
    : `<button type="button" class="prb-chip" onclick="prbAddService(${sv.id})" data-tip="${escHtml(tip(sv))}">${icon('plus', 11)}${escHtml(sv.name)}</button>`;
  const quick = topServices();
  top.innerHTML = `${quick.map(chip).join('')}<button type="button" class="btn-ghost btn-sm prb-browse" aria-expanded="${browseAll}" onclick="prbBrowseServices()">${browseAll ? 'Hide the list' : 'Browse all services'}</button>
    <button type="button" class="btn-ghost btn-sm prb-browse" aria-expanded="${fromOpen}" onclick="prbStartFromToggle()" data-tip="Copy the services, prices, term and entity of a proposal already made, for any client">Start from a past proposal</button>`;
  renderStartFrom();
  el.hidden = !browseAll;
  if (browseAll) {
    const groups = new Map<string, typeof S.services>();
    for (const sv of activeServices()) {
      const cat = sv.category || 'Other';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(sv);
    }
    el.innerHTML = [...groups.entries()].map(([cat, services]) => `<div class="prb-cat"><div class="prb-cat-name">${escHtml(cat)}</div><div class="prb-chips">${services.map(chip).join('')}</div></div>`).join('');
  }
  renderIcons(top); renderIcons(el);
}

// "Start from…": a past proposal's lines, term and entity (lib/startFrom.ts). The client and contact stay this form's.
let fromOpen = false;
let fromIndex = 0;

const fromMatches = () => startFromMatches(S.proposals, val('prb-from-q'));

function renderStartFrom(): void {
  const box = document.getElementById('prb-from');
  if (box) box.hidden = !fromOpen;
  const line = document.getElementById('prb-from-line');
  const basedOn = blocks[activeBlock]?.basedOnId ?? null;
  if (line) {
    line.hidden = basedOn == null;
    line.innerHTML = basedOn == null ? '' : `<span>Started from ${escHtml(basedOnLabel(basedOn, S.proposals))}</span><button type="button" class="rlink" onclick="prbStartFromClear()" data-tip="The services stay; the new proposal just won’t say where it started">Clear</button>`;
  }
}

function renderFromMenu(): void {
  const menu = document.getElementById('prb-from-menu');
  if (!menu) return;
  const items = fromMatches();
  menu.hidden = false;
  document.getElementById('prb-from-q')?.setAttribute('aria-expanded', 'true');
  menu.innerHTML = items.length ? items.map((p, i) => `<div class="company-selector-row prb-from-row${i === fromIndex ? ' active' : ''}" role="option" aria-selected="${i === fromIndex}" onmousedown="event.preventDefault();prbStartFrom(${p.id})">
    <span class="company-selector-name">${escHtml(startFromTitle(p))}</span><span class="company-selector-sub">${escHtml(startFromSub(p))}</span></div>`).join('')
    : `<div class="prb-from-none">No past proposal with services matches “${escHtml(val('prb-from-q'))}”.</div>`;
}

export function prbStartFromToggle(): void {
  fromOpen = !fromOpen;
  setVal('prb-from-q', '');
  renderServicePicker();
  if (fromOpen) document.getElementById('prb-from-q')?.focus();
}
expose('prbStartFromToggle', prbStartFromToggle);

export function prbFromSearch(): void {
  fromIndex = 0;
  renderFromMenu();
}
expose('prbFromSearch', prbFromSearch);

export function prbFromClose(): void {
  const menu = document.getElementById('prb-from-menu'); if (menu) menu.hidden = true;
  document.getElementById('prb-from-q')?.setAttribute('aria-expanded', 'false');
}
expose('prbFromClose', prbFromClose);

export function prbFromKey(e: KeyboardEvent): void {
  const items = fromMatches();
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!items.length) return;
    e.preventDefault();
    fromIndex = (fromIndex + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    renderFromMenu();
  } else if (e.key === 'Enter') {
    e.preventDefault(); // never submits the form
    if (items[fromIndex]) prbStartFrom(items[fromIndex].id);
  } else if (e.key === 'Escape') {
    e.stopPropagation();
    fromOpen = false;
    prbFromClose();
    renderServicePicker();
  }
}
expose('prbFromKey', prbFromKey);

/** This proposal's services, term and entity become the picked proposal's; Undo puts back what was there. */
export function prbStartFrom(id: number): void {
  const src = S.proposals.find((x) => x.id === id);
  if (!src) return;
  const before = { lines: draftLines, months: val('prb-months'), entity: val('prb-entity'), currency: val('prb-currency'), basedOnId: blocks[activeBlock]?.basedOnId ?? null };
  const put = (lines: CommercialLine[], months: string, entity: string, currency: string, basedOnId: number | null) => {
    draftLines = lines;
    const sel = document.getElementById('prb-months') as HTMLSelectElement | null;
    if (sel && months && ![...sel.options].some((o) => o.value === months)) sel.add(new Option(`${months} months`, months));
    setVal('prb-months', months);
    if (entity) setVal('prb-entity', entity);
    if (currency) setVal('prb-currency', currency);
    blocks[activeBlock] = { lines: draftLines, contractMonths: months ? Number(months) : null, basedOnId };
    renderServicePicker();
    prbRefreshLines();
    renderDefaultsLines();
    renderBlocks();
  };
  const copy = startFromCopy(src, nextLineId());
  // An entity that is no longer in use is not brought back: the form keeps its own.
  const entity = S.businessEntities.find((e) => e.id === copy.businessEntityId && e.active);
  fromOpen = false;
  prbFromClose();
  put(copy.lines, copy.contractMonths ? String(copy.contractMonths) : '', entity ? String(entity.id) : '', entity ? copy.currency || entity.currency : '', copy.basedOnId);
  undoToast(`Started from ${startFromTitle(src)}`, () => put(before.lines, before.months, before.entity, before.currency, before.basedOnId), undefined, undefined, { detail: 'Its services, prices, term and entity. The client and contact are this proposal’s own.' });
}
expose('prbStartFrom', prbStartFrom);

export function prbStartFromClear(): void {
  if (blocks[activeBlock]) blocks[activeBlock].basedOnId = null;
  renderStartFrom();
}
expose('prbStartFromClear', prbStartFromClear);

export function prbBrowseServices(): void {
  browseAll = !browseAll;
  renderServicePicker();
}
expose('prbBrowseServices', prbBrowseServices);

function serviceMatches(): typeof S.services {
  const q = val('prb-service-q').toLowerCase();
  if (!q) return [];
  const chosen = chosenServices();
  const all = activeServices().filter((sv) => !chosen.has(sv.id));
  const starts = all.filter((sv) => sv.name.toLowerCase().startsWith(q));
  const within = all.filter((sv) => !starts.includes(sv) && (sv.name.toLowerCase().includes(q) || (sv.category || '').toLowerCase().includes(q)));
  return [...starts, ...within].slice(0, 8);
}

export function prbServiceSearch(): void {
  serviceMenuIndex = 0;
  renderServiceMenu();
}
expose('prbServiceSearch', prbServiceSearch);

function renderServiceMenu(): void {
  const menu = document.getElementById('prb-service-menu');
  const input = document.getElementById('prb-service-q');
  if (!menu) return;
  const items = serviceMatches();
  menu.hidden = !items.length;
  input?.setAttribute('aria-expanded', String(!!items.length));
  menu.innerHTML = items.map((sv, i) => `<div class="company-selector-row${i === serviceMenuIndex ? ' active' : ''}" role="option" aria-selected="${i === serviceMenuIndex}" onmousedown="event.preventDefault();prbAddService(${sv.id})">
    <span class="company-selector-name">${escHtml(sv.name)}</span>${sv.category ? `<span class="company-selector-sub">${escHtml(sv.category)}</span>` : ''}</div>`).join('');
}

export function prbServiceKey(e: KeyboardEvent): void {
  const items = serviceMatches();
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!items.length) return;
    e.preventDefault();
    serviceMenuIndex = (serviceMenuIndex + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    renderServiceMenu();
  } else if (e.key === 'Enter') {
    e.preventDefault(); // never submits the form
    if (items[serviceMenuIndex]) prbAddService(items[serviceMenuIndex].id);
  } else if (e.key === 'Escape') {
    setVal('prb-service-q', '');
    prbServiceMenuClose();
  }
}
expose('prbServiceKey', prbServiceKey);

export function prbServiceMenuClose(): void {
  const menu = document.getElementById('prb-service-menu'); if (menu) menu.hidden = true;
  document.getElementById('prb-service-q')?.setAttribute('aria-expanded', 'false');
}
expose('prbServiceMenuClose', prbServiceMenuClose);

export function prbAddService(id: number): void {
  if (!draftLines.some((l) => l.serviceId === id)) draftLines.push(lineForService(S.services.find((sv) => sv.id === id) || null, draftLines.length));
  setVal('prb-service-q', '');
  prbServiceMenuClose();
  renderServicePicker();
  prbRefreshLines();
}
expose('prbAddService', prbAddService);

export function prbToggleService(id: number): void {
  const i = draftLines.findIndex((l) => l.serviceId === id);
  if (i >= 0) draftLines.splice(i, 1);
  else draftLines.push(lineForService(S.services.find((sv) => sv.id === id) || null, draftLines.length));
  renderServicePicker();
  prbRefreshLines();
}
expose('prbToggleService', prbToggleService);

// Terms and workflow: the usual choices as one line each; "Change" opens the fields.
let showEntityFields = false;
let showWorkflowFields = false;

function renderDefaultsLines(): void {
  const entityLine = document.getElementById('prb-entity-line');
  const entityFields = document.getElementById('prb-entity-fields');
  const entity = entityById(Number(val('prb-entity')));
  if (entityLine && entityFields) {
    entityFields.hidden = !showEntityFields;
    entityLine.hidden = showEntityFields;
    entityLine.innerHTML = `<span>${escHtml([entity?.name, val('prb-currency')].filter(Boolean).join(' · ') || 'No business entity')}</span><button type="button" class="rlink" onclick="prbShowDefaults('entity')">Change</button>`;
  }
  const wfLine = document.getElementById('prb-workflow-line');
  const wfFields = document.getElementById('prb-workflow-fields');
  if (wfLine && wfFields) {
    wfFields.hidden = !showWorkflowFields;
    wfLine.hidden = showWorkflowFields;
    const received = val('prb-received');
    const owner = teamMember(Number(val('prb-owner')));
    const reviewer = teamMember(Number(val('prb-reviewer')));
    const status = (document.getElementById('prb-status') as HTMLSelectElement | null)?.selectedOptions[0]?.textContent || '';
    wfLine.innerHTML = `<span>${escHtml([
      val('prb-status') === PS.REQUEST ? `Request received ${received === today() ? 'today' : fmtDate(received)}` : status,
      val('prb-promised') ? `Promised by ${fmtDate(val('prb-promised'))}` : '',
      owner ? `Owner ${owner.name}` : '', reviewer ? `Reviewer ${reviewer.name}` : '',
    ].filter(Boolean).join(' · '))}</span><button type="button" class="rlink" onclick="prbShowDefaults('workflow')">Change</button>`;
  }
}

export function prbShowDefaults(which: 'entity' | 'workflow'): void {
  if (which === 'entity') showEntityFields = true; else showWorkflowFields = true;
  renderDefaultsLines();
  document.getElementById(which === 'entity' ? 'prb-entity' : 'prb-status')?.focus();
}
expose('prbShowDefaults', prbShowDefaults);

export function prbRefreshLines(): void {
  // No table until the first service is added.
  if (!draftLines.length) {
    const el = document.getElementById('prb-lines'); if (el) el.innerHTML = '';
    renderBuilderSummary();
    renderBuilderFolder();
    return;
  }
  renderLinesEditor('builder', 'prb-lines', {
    lines: () => draftLines,
    setLines: (lines) => { draftLines = lines; },
    currency: () => val('prb-currency') || 'SAR',
    contractMonths: () => (val('prb-months') ? Number(val('prb-months')) : null),
    editable: true,
    onChange: () => { renderServicePicker(); if (!draftLines.length) prbRefreshLines(); renderBuilderSummary(); renderBuilderFolder(); },
  });
  renderBuilderSummary();
  renderBuilderFolder();
}
expose('prbRefreshLines', prbRefreshLines);

// ── Several proposals in one go ─────────────────────────────────────────────

/** The active block, as the form shows it now. */
function syncActiveBlock(): void {
  blocks[activeBlock] = { ...blocks[activeBlock], lines: draftLines, contractMonths: val('prb-months') ? Number(val('prb-months')) : null };
}

function loadBlock(i: number): void {
  activeBlock = Math.max(0, Math.min(i, blocks.length - 1));
  draftLines = blocks[activeBlock].lines;
  setVal('prb-months', blocks[activeBlock].contractMonths != null ? String(blocks[activeBlock].contractMonths) : '');
  setVal('prb-service-q', '');
  prbServiceMenuClose();
  renderServicePicker();
  prbRefreshLines();
  renderBlocks();
}

/** The other proposals as one line each; the active one's number when there are several. */
function renderBlocks(): void {
  const before = document.getElementById('prb-blocks-before');
  const after = document.getElementById('prb-blocks-after');
  const hd = document.getElementById('prb-block-hd');
  if (!before || !after || !hd) return;
  syncActiveBlock();
  const currency = val('prb-currency') || 'SAR';
  const line = (b: ProposalBlock, i: number) => `<div class="prb-block-line" data-drag-kind="prb-block" data-drag-id="${i}">
    <button type="button" class="rlink prb-block-open" onclick="prbActivateBlock(${i})">${escHtml(blockSummary(b, i, currency))}</button>
    <button type="button" class="rlink prb-block-remove" onclick="prbRemoveBlock(${i})">Remove</button></div>`;
  before.innerHTML = blocks.slice(0, activeBlock).map((b, i) => line(b, i)).join('');
  after.innerHTML = blocks.slice(activeBlock + 1).map((b, i) => line(b, activeBlock + 1 + i)).join('');
  const sub = document.getElementById('prb-subtitle');
  if (sub) sub.textContent = blocks.length < 2 ? 'One proposal, with a line for each service.' : `${blocks.length} proposals for one client, each its own document.`;
  hd.hidden = blocks.length < 2;
  hd.innerHTML = blocks.length < 2 ? '' : `<span>Proposal ${activeBlock + 1}</span><button type="button" class="rlink prb-block-remove" onclick="prbRemoveBlock(${activeBlock})">Remove</button>`;
}

/** Moves proposal `from` to position `to` in the builder, keeping the open one open. */
function moveBlock(from: number, to: number): void {
  if (from === to || from < 0 || to < 0 || from >= blocks.length || to >= blocks.length) return;
  syncActiveBlock();
  const open = blocks[activeBlock];
  const [b] = blocks.splice(from, 1);
  blocks.splice(to, 0, b);
  activeBlock = blocks.indexOf(open);
  loadBlock(activeBlock);
}

registerDragSource('prb-block');
registerDropTarget('prb-block-order', {
  accepts: ['prb-block'],
  onDrop: ({ ids }, { value, beforeId }) => {
    const from = ids[0];
    // Dropped among the proposals above the open one, or below it.
    let to = beforeId != null ? beforeId : value === 'before' ? activeBlock : blocks.length;
    if (from < to) to -= 1;
    moveBlock(from, to);
    return to;
  },
});

/** ⌥↑ / ⌥↓ in the builder (outside a text field) moves the open proposal (core/keys.ts). */
registerKey({ combo: 'alt+arrowup', label: 'Move the open proposal up / down', group: 'New proposal', when: () => S.proposalBuilderOpen && blocks.length > 1, run: () => moveBlock(activeBlock, activeBlock - 1) });
registerKey({ combo: 'alt+arrowdown', when: () => S.proposalBuilderOpen && blocks.length > 1, run: () => moveBlock(activeBlock, activeBlock + 1) });

export function prbAddBlock(): void {
  syncActiveBlock();
  // A new proposal starts with the same contract term; its services are its own.
  blocks.push(emptyBlock(blocks[activeBlock].contractMonths));
  loadBlock(blocks.length - 1);
  settleNew(document.getElementById('prb-block-hd'));
  document.getElementById('prb-service-q')?.focus();
}
expose('prbAddBlock', prbAddBlock);

export function prbActivateBlock(i: number): void {
  if (i === activeBlock) return;
  syncActiveBlock();
  loadBlock(i);
}
expose('prbActivateBlock', prbActivateBlock);

export function prbRemoveBlock(i: number): void {
  syncActiveBlock();
  if (blocks.length < 2) return;
  blocks.splice(i, 1);
  loadBlock(i < activeBlock ? activeBlock - 1 : Math.min(activeBlock, blocks.length - 1));
}
expose('prbRemoveBlock', prbRemoveBlock);

/** The running summary: only once there's a client or a service, and only what's known. */
/** The proposal card beside the builder (studio slice): it takes shape as the form is filled —
 * the client, entity and currency, a row per service, term and validity, and the contract value
 * as a display figure that rolls as services and term change. Other proposals stack below. */
function renderBuilderSummary(): void {
  const el = document.getElementById('prb-summary');
  if (!el) return;
  el.hidden = false;
  const client = val('prb-client');
  const currency = val('prb-currency') || 'SAR';
  const months = val('prb-months') ? Number(val('prb-months')) : null;
  const entity = entityById(Number(val('prb-entity')) || null);
  const valid = val('prb-valid');
  if (blocks.length > 1) syncActiveBlock();
  const lines = draftLines.filter((l) => l.serviceName.trim());
  const t = lineTotals(lines, months);
  const tile = client ? `<span class="prb-card-tile" style="background:${strColor(client)}">${escHtml(initialsOf(client))}</span>` : '<span class="prb-card-tile is-empty"></span>';
  const others = blocks.length > 1 ? blocks.map((b, i) => (i === activeBlock ? '' : `<div class="prb-mini">${escHtml(blockSummary(b, i, currency))}</div>`)).join('') : '';
  // Steps: done navy, the current one coral, the rest muted (Workflow has defaults, so it is never "missing").
  const done = [!!client, lines.length > 0, !!months, false];
  const currentStep = done.findIndex((d) => !d);
  document.querySelectorAll<HTMLElement>('#prb-form .prb-step').forEach((st, i) => {
    st.classList.toggle('is-done', done[i]);
    st.classList.toggle('is-current', i === currentStep);
  });
  el.innerHTML = `<div class="prb-card">
      <div class="prb-card-hd">${tile}<div class="prb-card-id"><div class="prb-card-client${client ? '' : ' is-empty'}">${escHtml(client || 'New proposal')}</div><div class="prb-card-sub">${escHtml([entity?.name, currency].filter(Boolean).join(' · '))}</div></div></div>
      ${lines.length ? `<ul class="prb-card-lines">${lines.map((l) => `<li>${escHtml(cardLine(l, currency))}</li>`).join('')}</ul>` : '<p class="prb-card-hint">Services appear here as you add them.</p>'}
      <dl class="prb-card-terms">
        <div><dt>Term</dt><dd>${months ? `${months} months` : '—'}</dd></div>
        <div><dt>Valid until</dt><dd>${valid ? escHtml(fmtDateShort(valid, true)) : '—'}</dd></div>
      </dl>
      <div class="prb-card-value"><span class="prb-card-value-l">Contract value${months ? ` · ${months} mo` : ''}</span><span class="prb-card-fig" data-roll="prb-value">${t.contractValue ? escHtml(fmtMoney(t.contractValue, currency)) : '—'}</span></div>
      ${t.monthly ? `<div class="prb-card-monthly"><span data-roll="prb-monthly">${escHtml(fmtMoney(t.monthly, currency))}</span> a month${t.oneTime ? ` · <span data-roll="prb-onetime">${escHtml(fmtMoney(t.oneTime, currency))}</span> one-time` : ''}</div>` : ''}
    </div>${others ? `<div class="prb-minis">${others}</div>` : ''}`;
}

expose('prbCardRefresh', () => renderBuilderSummary());

/** One line about the client's OneDrive folder, once there's a client. */
function renderBuilderFolder(): void {
  const el = document.getElementById('prb-folder');
  if (!el) return;
  const client = val('prb-client');
  el.hidden = !client || !builderFolder || !builderFolder.root;
  if (el.hidden) { el.innerHTML = ''; return; }
  const folderName = (builderFolder!.path || '').split('/').filter(Boolean).pop() || client;
  el.innerHTML = builderFolder!.exists
    ? `<div class="pr-folder-line" data-tip="${escHtml(builderFolder!.path || '')}">${icon('folder', 13)}<span>Saves in <strong>${escHtml(breadcrumb(builderFolder!.path) || folderName)}</strong></span></div>`
    : `<label class="check-label" data-tip="${escHtml(builderFolder!.path || '')}"><input type="checkbox" id="prb-create-folder" checked> Create a folder for <strong>${escHtml(client)}</strong></label>`;
  renderIcons(el);
}

export async function submitProposalBuilder(e: Event): Promise<void> {
  e.preventDefault();
  const client = val('prb-client');
  if (!client) { toast('Choose the client', { tone: 'error' }); document.getElementById('prb-client')?.focus(); return; }
  const status = val('prb-status') || PS.REQUEST;
  syncActiveBlock();
  if (blocks.some((b) => b.lines.some((l) => !l.serviceName.trim()))) { toast('Choose a service for every line, or remove the empty line', { tone: 'error' }); return; }
  const toSave = blocksToSave(blocks);
  if (status !== PS.REQUEST && toSave.some((b) => b.lines.length === 0)) { toast('Add at least one service', { tone: 'error', detail: 'Only a request that hasn’t been started can be saved without services.' }); return; }

  // From an opportunity: the proposal keeps the opportunity's company by id
  // while the client field still shows that company.
  const oppId = val('prb-opportunity') ? Number(val('prb-opportunity')) : null;
  const opp = oppId != null ? S.opportunities.find((o) => o.id === oppId) : undefined;
  const { companyId } = companyFromForm(opp ? contextFromOpportunity(S, opp) : null, client);

  // A new contact is created first so the proposal can point at it.
  let primaryContactId: number | null = val('prb-contact') && val('prb-contact') !== 'new' ? Number(val('prb-contact')) : null;
  if (val('prb-contact') === 'new' && val('prb-ct-name')) {
    const contact = { id: nextCtId(), clientName: client, companyId, name: val('prb-ct-name'), role: val('prb-ct-role') || null, email: val('prb-ct-email') || null, phone: val('prb-ct-phone') || null, whatsapp: null, service: null, lists: [] };
    S.contacts.push(contact);
    persistContacts();
    primaryContactId = contact.id;
  }

  const td = today();
  const received = val('prb-received') || td;
  const ownerId = val('prb-owner') ? Number(val('prb-owner')) : null;
  const reviewerId = val('prb-reviewer') ? Number(val('prb-reviewer')) : null;
  const sent = status === PS.SENT ? val('prb-sent') || td : null;
  const shared: SharedProposalFields = {
    client, companyId, status,
    sentDate: sent, dblSignedDate: null, kickoffDate: null, finance: null, hubspot: null,
    owner: teamMember(ownerId)?.name ?? null, remarks: val('prb-remarks') || null, dateAdded: received,
    monthlyFee: null, winLossReason: null, docLink: null,
    archived: false, archivedAt: null, snoozedUntil: null,
    dateSentToHassan: status === PS.REVIEW ? td : null, dateSentToClient: sent, dateSigned: null,
    businessEntityId: val('prb-entity') ? Number(val('prb-entity')) : null, currency: val('prb-currency') || 'SAR',
    primaryContactId, ownerId, reviewerId,
    reviewStatus: status === PS.REVIEW ? 'pending' : null, reviewRequestedAt: status === PS.REVIEW ? td : null,
    reviewedAt: null, reviewNote: null, validUntil: val('prb-valid') || null,
    folderPath: builderFolder?.exists ? builderFolder.path : null, leadSource: val('prb-source') || null,
    promisedBy: val('prb-promised') || null,
  };
  const created = proposalsFromBlocks(shared, blocks, nextId(), () => crypto.randomUUID());
  for (const p of created) { syncProposalTotals(p); S.proposals.push(p); }
  const p = created[0];
  persistProposals();

  if (opp) {
    opp.proposalId = p.id;
    void saveOpportunity(opp).then((saved) => {
      const i = S.opportunities.findIndex((x) => x.id === saved.id);
      if (i > -1) S.opportunities[i] = saved;
    }).catch((err) => toast('Proposal saved, but linking the opportunity failed', { tone: 'error', detail: String(err) }));
  }

  const createFolder = (document.getElementById('prb-create-folder') as HTMLInputElement | null)?.checked && builderFolder?.root && !builderFolder.exists;
  if (createFolder) {
    try {
      const info = await proposalFolderCreate(client);
      for (const x of created) x.folderPath = info.path;
      persistProposals();
    } catch (err) {
      toast('Proposal saved, but the folder could not be created', { tone: 'error', detail: String(err) });
    }
  }

  draftLines = [];
  blocks = [emptyBlock()];
  activeBlock = 0;
  S.proposalBuilderOpen = false;
  w.populateAllSelects?.();
  refreshAll();
  if (created.length === 1) {
    openProposalPage(p.id);
    toast(`Proposal SL# ${p.id} created`, { tone: 'success' });
  } else {
    // Several: the company page shows them together.
    w.openRecord('company', p.companyId ?? client);
    toast(`${created.length} proposals created (SL# ${created.map((x) => x.id).join(', ')})`, { tone: 'success' });
  }
}
expose('submitProposalBuilder', submitProposalBuilder);
