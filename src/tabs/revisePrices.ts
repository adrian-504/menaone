// "Revise prices" on the latest deck of a proposal (1.66): the next version with only the prices, the price
// sentences, the term wording and the two dates changed, so the edits made by hand in the version before stay.
// The dialog first reads the deck and says what would change; when a price has no row it names it and offers to
// regenerate instead. The version it is made from is never modified.

import { S } from '../lib/state';
import { escHtml, expose, localIsoDate } from '../lib/utils';
import { toast } from '../lib/ui';
import { shake } from '../lib/motion';
import { proposalFolderLookup, proposalRevisePrices, filesOpen } from '../lib/db';
import { persistProposals, proposalsAndAgreementsSaved } from '../lib/persist';
import { applyGeneratedDocument, lineTotals, nextDeckFileName, proposalDecks } from '../lib/commercial';
import { defaultRound, reviseSummary, type ReviseResult, type Round } from '../lib/revisePrices';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

let revising: { proposalId: number; docId: number; fromVersion: number; next: number; round: Round; result: ReviseResult | null; busy: boolean } | null = null;

const proposal = () => (revising ? S.proposals.find((p) => p.id === revising!.proposalId) : undefined);

function request(dryRun: boolean) {
  const reason = revising!.round === 'client' ? $<HTMLInputElement>('revise-reason')?.value.trim() || null : null;
  return { proposalId: revising!.proposalId, documentId: revising!.docId, date: localIsoDate(new Date()), fileName: $<HTMLInputElement>('revise-file')?.value.trim() || '', round: revising!.round, roundReason: reason, dryRun };
}

function paint(): void {
  if (!revising) return;
  const { result, next, fromVersion, busy } = revising;
  const body = $('revise-result');
  const save = $<HTMLButtonElement>('revise-save');
  const regen = $('revise-regen');
  const form = $('revise-form');
  for (const b of document.querySelectorAll<HTMLElement>('#revise-round .seg-btn')) {
    const on = b.dataset.round === revising.round;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  }
  const reason = $('revise-reason-grp'); if (reason) reason.hidden = revising.round !== 'client';
  if (!body || !save || !regen || !form) return;
  if (!result) {
    body.innerHTML = `<p class="revise-wait">Reading V${fromVersion}…</p>`;
    save.hidden = true; regen.hidden = true; form.hidden = true;
    return;
  }
  const s = reviseSummary(result, next);
  body.innerHTML = `<div class="revise-box${s.ok ? '' : ' is-stop'}"><b>${escHtml(s.title)}</b>${s.lines.length ? `<ul>${s.lines.map((l) => `<li>${escHtml(l)}</li>`).join('')}</ul>` : ''}</div>`;
  // The round and the file name are for the version that is made, by either road.
  form.hidden = !s.ok && !s.regenerate;
  const file = $('revise-file')?.closest<HTMLElement>('.fgrp'); if (file) file.hidden = !s.ok;
  save.hidden = !s.ok;
  save.disabled = busy;
  save.textContent = busy ? `Saving V${next}…` : `Save V${next}`;
  regen.hidden = !s.regenerate;
  const cancel = $('revise-cancel'); if (cancel) cancel.textContent = s.ok || s.regenerate ? 'Cancel' : 'Close';
}

/** Opens on a version of the current proposal's deck and reads it (nothing is written). */
export async function openRevisePrices(docId: number): Promise<void> {
  const p = S.proposals.find((x) => x.id === S.currentProposalId);
  const d = (p?.documents || []).find((x) => x.id === docId);
  if (!p || !d) return;
  const next = Math.max(0, ...proposalDecks(p).map((x) => x.version ?? 0)) + 1;
  const start = defaultRound(p);
  revising = { proposalId: p.id, docId, fromVersion: d.version ?? 1, next, round: start.round, result: null, busy: false };
  const title = $('revise-title'); if (title) title.textContent = `Revise prices — V${next} from V${d.version ?? '?'}`;
  const sub = $('revise-sub'); if (sub) sub.textContent = `${p.client} · the proposal’s prices as they are now, written into a copy of ${d.fileName}`;
  const reason = $<HTMLInputElement>('revise-reason'); if (reason) reason.value = start.reason;
  const file = $<HTMLInputElement>('revise-file'); if (file) file.value = '';
  paint();
  $('modal-revise')?.classList.add('open');
  try {
    // The deck is revised from the saved proposal: pending edits first, so the prices are the page's.
    persistProposals();
    await proposalsAndAgreementsSaved();
    const folder = await proposalFolderLookup(p.client, p.folderPath ?? null).catch(() => null);
    const services = lineTotals(p.lines, p.contractMonths).serviceNames.join(' & ') || p.type || 'Services';
    if (file) file.value = nextDeckFileName(p, services, localIsoDate(new Date()), (folder?.files || []).map((f) => f.name));
    const result = await proposalRevisePrices(request(true));
    if (revising?.docId !== docId) return;
    revising.result = result;
    paint();
  } catch (err) {
    if (revising?.docId !== docId) return;
    closeRevisePrices();
    toast(`V${d.version ?? '?'} could not be read`, { tone: 'error', detail: String(err).replace(/^Error: /, '') });
  }
}
expose('proposalRevisePrices', openRevisePrices);

export function closeRevisePrices(): void {
  if (revising?.busy) return; // the file is being written; it closes itself when done
  revising = null;
  $('modal-revise')?.classList.remove('open');
}
expose('closeRevisePrices', closeRevisePrices);

export function reviseRound(round: Round): void {
  if (!revising) return;
  revising.round = round;
  paint();
  if (round === 'client') $('revise-reason')?.focus();
}
expose('reviseRound', reviseRound);

/** A client revision takes its one line; the box says so when it is empty. */
function reasonGiven(): boolean {
  if (revising?.round !== 'client') return true;
  const box = $<HTMLInputElement>('revise-reason');
  if (box?.value.trim()) return true;
  toast('Say in one line what the client asked for', { tone: 'error' });
  box?.focus();
  shake(box);
  return false;
}

export async function saveRevisePrices(): Promise<void> {
  if (!revising?.result?.canSave || revising.busy || !reasonGiven()) return;
  const { proposalId, next } = revising;
  revising.busy = true;
  paint();
  try {
    const result = await proposalRevisePrices(request(false));
    if (!result.document || !result.path) throw new Error(result.reason || 'The version was not recorded.');
    const p = S.proposals.find((x) => x.id === proposalId);
    if (p) {
      applyGeneratedDocument(p, result.document, null);
      persistProposals();
    }
    revising = null;
    $('modal-revise')?.classList.remove('open');
    (window as any).renderProposalPage?.();
    requestAnimationFrame(() => document.querySelector(`[data-doc-id="${result.document!.id}"]`)?.classList.add('just-added'));
    const path = result.path;
    toast(`V${next} saved in the client folder`, { tone: 'success', detail: result.line.replace(/^Prices revised from V\d+: /, ''), action: { label: 'Open', run: () => { void filesOpen(path); } } });
  } catch (err) {
    // Nothing was recorded and the version it was made from is untouched.
    if (!revising) return;
    revising.busy = false;
    paint();
    toast(`Couldn't save V${next}`, { tone: 'error', detail: String(err).replace(/^Error: /, '') });
  }
}
expose('saveRevisePrices', saveRevisePrices);

/** "Regenerate instead": the Generate dialog, for a version recorded as built afresh (hand edits not carried). */
export function reviseRegenerate(): void {
  if (!revising || !reasonGiven()) return;
  const { proposalId, fromVersion, round } = revising;
  const reason = round === 'client' ? $<HTMLInputElement>('revise-reason')?.value.trim() || null : null;
  revising = null;
  $('modal-revise')?.classList.remove('open');
  void (window as any).openGenerateProposal?.(proposalId, { round, roundReason: reason, notCarriedFrom: fromVersion });
}
expose('reviseRegenerate', reviseRegenerate);
