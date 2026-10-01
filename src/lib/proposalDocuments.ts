// A proposal's generated decks as a version history: newest first, each with
// its version, file, type, date, where it came from and whether the file is
// still where it was saved. Rendering only — the proposal page wires it up.

import { escHtml } from './utils';
import { fmtDateShort } from './dates';
import { miniCoverHtml } from './studio';
import { icon } from './icons';
import { proposalDecks } from './commercial';
import type { Proposal, ProposalDocument } from './types';
import { CHECK_GLYPH, CHECK_TONE, checkSummary, type SendCheck } from './sendCheck';

/** Whether each deck's file is still at its path: true, false, or unknown (not checked yet / outside OneDrive). */
export type FileStatus = Map<string, boolean>;

export function deckStatus(d: ProposalDocument, files: FileStatus): { label: string; tone: 'green' | 'red' | 'muted' } {
  if (d.path && files.get(d.path) === false) return { label: 'File missing', tone: 'red' };
  // MENA One wrote it: generated, or a price revision of an earlier version (which carries a fingerprint, 1.66).
  if (/^(Generated|Prices revised)/.test(d.notes || '') || d.generatedSha256) return { label: 'Generated', tone: 'green' };
  return { label: 'Added from folder', tone: 'muted' };
}

function fileType(name: string): string {
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  return ext === 'pptx' || ext === 'ppt' ? 'PowerPoint' : ext === 'pdf' ? 'PDF' : ext === 'key' ? 'Keynote' : ext ? ext.toUpperCase() : 'Document';
}

const attr = (v: string) => escHtml(v.replace(/'/g, "\\'"));

/** The file's fingerprint as it is now, by path (null: it could not be read). Not there: not looked at yet. */
export type Fingerprints = Map<string, string | null>;

/** The version marked as the one sent to the client (the latest mark, should two carry one). */
export function sentDeck(p: Pick<Proposal, 'documents'>): ProposalDocument | null {
  return proposalDecks(p).filter((d) => !!d.sentToClientAt).sort((a, b) => (b.sentToClientAt || '').localeCompare(a.sentToClientAt || '') || (b.version ?? 0) - (a.version ?? 0))[0] ?? null;
}

/** The decks as the section shows them: the one sent to the client leads (the sent file is the record), then the
 * rest newest first. */
export function orderedDecks(p: Pick<Proposal, 'documents'>): ProposalDocument[] {
  const sent = sentDeck(p);
  const decks = proposalDecks(p);
  return sent ? [sent, ...decks.filter((d) => d.id !== sent.id)] : decks;
}


/** The day a version went to the client, when it is marked now: the proposal's latest send if the version was there
 * by then, else today (a version made after the send went later). */
export function sentDayFor(p: Partial<Pick<Proposal, 'dateSentToClient' | 'lastSentAt' | 'sentDate'>>, d: Pick<ProposalDocument, 'createdAt'>, today: string): string {
  const sent = (p.lastSentAt || p.dateSentToClient || p.sentDate || '').slice(0, 10);
  return sent && sent <= today && (!d.createdAt || d.createdAt.slice(0, 10) <= sent) ? sent : today;
}

/** Marks one version as the one sent to the client; one version carries the mark, so it comes off the others.
 * `id` null takes the mark off. Supporting documents are left alone. */
export function markSentVersion(p: Pick<Proposal, 'documents'>, id: number | null, day: string): void {
  for (const d of p.documents || []) {
    if (d.kind !== 'proposal') continue;
    d.sentToClientAt = d.id === id ? day : null;
  }
}

/** A file MENA One wrote that has been changed since: its fingerprint now differs from the one recorded. A version
 * recorded before 1.66 has no fingerprint and is never called edited; nor is a file not looked at yet. */
export function editedSince(d: Pick<ProposalDocument, 'path' | 'generatedSha256'>, prints: Fingerprints): boolean {
  if (!d.generatedSha256 || !d.path) return false;
  const now = prints.get(d.path);
  return !!now && now !== d.generatedSha256;
}

/** What a version says about itself under its status: the review round (and a client revision's reason), hand
 * edits that a regeneration left behind, and that the file was edited after MENA One wrote it. No diffs. */
export function deckMarks(d: ProposalDocument, prints: Fingerprints): { text: string; tone?: 'amber' }[] {
  const out: { text: string; tone?: 'amber' }[] = [];
  if (d.round === 'internal') out.push({ text: 'internal round' });
  if (d.round === 'client') out.push({ text: d.roundReason ? `client revision: ${d.roundReason}` : 'client revision' });
  if (d.notCarried) out.push({ text: `hand edits from V${d.carriedFromVersion ?? '?'} not carried`, tone: 'amber' });
  if (editedSince(d, prints)) out.push({ text: 'edited after generation', tone: 'amber' });
  return out;
}

/** A price revision's report, kept in the version's notes: "Prices revised from V1: 9 amounts updated on slides 14,
 * 15; dates on slides 1 and 2". Empty for any other note. */
export const revisionReport = (d: Pick<ProposalDocument, 'notes'>): string => ((d.notes || '').startsWith('Prices revised') ? d.notes! : '');

type SentFacts = Partial<Pick<Proposal, 'status' | 'dateSentToClient' | 'lastSentAt' | 'sentDate'>>;

/** The version the client has: the one marked as sent; without a mark, once the proposal is with the client, the
 * newest version that was there the day it was last sent. Null while nothing has gone. */
export function heldDeck(p: Pick<Proposal, 'documents'> & SentFacts): ProposalDocument | null {
  const marked = sentDeck(p);
  if (marked) return marked;
  const sent = (p.lastSentAt || p.dateSentToClient || p.sentDate || '').slice(0, 10);
  if (!sent || !p.status || /Request|Drafting|Review/i.test(p.status)) return null;
  return proposalDecks(p).find((d) => !d.createdAt || d.createdAt.slice(0, 10) <= sent) ?? null;
}

/** A deck's status line: "sent to the client 2 Oct" for the version marked as sent; without a mark, "sent 2 Sept"
 * for the version the client has by its date. A version made after that one is a "draft", one before it an
 * "earlier version"; while nothing has gone, every version is a draft. */
export function deckStatusLine(d: ProposalDocument, held: ProposalDocument | null, p: SentFacts): string {
  if (d.sentToClientAt && held?.id === d.id) return `sent to the client ${fmtDateShort(d.sentToClientAt)}`;
  if (!held) return 'draft';
  if (held.id === d.id) return `sent ${fmtDateShort((p.lastSentAt || p.dateSentToClient || p.sentDate)!)}`;
  return (d.version ?? 0) > (held.version ?? 0) ? 'draft' : 'earlier version';
}

/** The "Proposal documents" section (studio slice): each version a card with the brand mini-cover. The version sent
 * to the client leads; the rest follow newest first. */
export function proposalDeckRows(p: Pick<Proposal, 'documents'> & Partial<Pick<Proposal, 'client' | 'status' | 'dateSentToClient' | 'lastSentAt' | 'sentDate'>>, files: FileStatus, prints: Fingerprints = new Map(), panel: { afterId: number; html: string } | null = null): string {
  const decks = orderedDecks(p);
  const sent = sentDeck(p);
  const held = heldDeck(p);
  const newest = proposalDecks(p)[0]?.id;
  return decks.map((d) => {
    const status = deckStatus(d, files);
    const canOpen = !!d.path && files.get(d.path) !== false;
    const byHand = status.label === 'Added from folder';
    const latest = d.id === newest;
    const isSent = sent?.id === d.id;
    const line = status.tone === 'red' ? status.label : deckStatusLine(d, held, p);
    const marks = deckMarks(d, prints);
    const report = revisionReport(d);
    const path = d.path ? attr(d.path) : '';
    return `<div class="deck-tile pr-deck${canOpen ? '' : ' is-missing'}${isSent ? ' is-sent' : ''}" data-doc-id="${d.id}"${canOpen ? ` tabindex="0" data-ql-path="${path}" onkeydown="if(event.key==='Enter'&&event.target===this)this.click()" onclick="proposalOpenFile('${path}')"` : ''}>
      ${miniCoverHtml(p.client || '', `V${d.version ?? '?'}`, d.createdAt ? fmtDateShort(d.createdAt) : '')}
      <div class="deck-tile-meta">
        <span class="pr-deck-version">V${d.version ?? '?'}</span>${latest ? '<span class="deck-latest">Latest</span>' : ''}
        <span class="deck-line${status.tone === 'red' ? ' t-red' : held?.id === d.id ? ' t-green' : ''}">${escHtml(line)}</span>${byHand ? '<span class="deck-hand">made by hand</span>' : ''}
      </div>
      ${marks.length ? `<div class="deck-tile-marks">${marks.map((m) => `<span${m.tone ? ` class="t-${m.tone}"` : ''}>${escHtml(m.text)}</span>`).join('<i>·</i>')}</div>` : ''}
      ${report ? `<div class="deck-tile-note" data-tip="${escHtml(report)}">${escHtml(report)}</div>` : ''}
      <div class="deck-tile-file" title="${escHtml(d.fileName)}">${escHtml(d.fileName)} · ${escHtml(fileType(d.fileName))}</div>
      <div class="deck-tile-acts">
        ${canOpen ? `<button class="rec-icon-btn" onclick="event.stopPropagation();proposalOpenFile('${path}')" data-tip="Open" aria-label="Open ${escHtml(d.fileName)}">${icon('document', 13)}</button>
        <button class="rec-icon-btn" onclick="event.stopPropagation();proposalRevealFile('${path}')" data-tip="Show in Finder" aria-label="Show ${escHtml(d.fileName)} in Finder">${icon('folder', 13)}</button>
        <button class="rec-icon-btn" onclick="event.stopPropagation();quickLookPath('${path}')" data-tip="Quick Look" aria-label="Quick Look ${escHtml(d.fileName)}">${icon('eye', 13)}</button>` : ''}
        <button class="rec-icon-btn" onclick="event.stopPropagation();proposalMarkSentVersion(${d.id})" data-tip="${isSent ? 'Not the one sent to the client' : 'This is the one sent to the client'}" aria-label="${isSent ? 'Unmark' : 'Mark'} ${escHtml(d.fileName)} as sent to the client" aria-pressed="${isSent}">${icon('mail', 13)}</button>
        <button class="rec-icon-btn" onclick="event.stopPropagation();proposalRemoveDocument(${d.id})" data-tip="Remove from this proposal (the file stays)" aria-label="Remove ${escHtml(d.fileName)} from this proposal">${icon('close', 13)}</button>
      </div>
    </div>${panel?.afterId === d.id ? panel.html : ''}`;
  }).join('');
}

/** The deck the check before sending reads: the latest version while the client does not have it yet (a draft).
 * Null once the latest is the one that went, or when there is no deck. */
export function draftDeck(p: Pick<Proposal, 'documents'> & SentFacts): ProposalDocument | null {
  const latest = proposalDecks(p)[0] ?? null;
  const held = heldDeck(p);
  return latest && (!held || (latest.version ?? 0) > (held.version ?? 0)) ? latest : null;
}

/** The check before sending, beside the version it read: its five lines, and "Mark as sent" (which also marks this
 * version as the one the client has). It warns and never blocks. `check` null: still reading. `narrow`: one card
 * wide, when other versions share the row, so the section stays one row tall. */
export function sendCheckHtml(d: Pick<ProposalDocument, 'id' | 'version' | 'fileName'>, check: SendCheck | null, o: { canSend?: boolean; narrow?: boolean } = {}): string {
  const head = `<div class="deck-check-hd"><b>Before sending</b><span>V${d.version ?? '?'}</span>${check ? `<em class="t-${checkSummary(check).tone}">${escHtml(checkSummary(check).text)}</em>` : '<em>Reading the file…</em>'}</div>`;
  const lines = !check ? '' : !check.checked ? `<p class="deck-check-note">${escHtml(check.note)}</p>`
    : `<ul class="deck-check-list">${check.lines.map((l) => `<li class="t-${CHECK_TONE[l.status]}"><i aria-hidden="true">${CHECK_GLYPH[l.status]}</i><span><b>${escHtml(l.label)}</b>${l.detail ? `<small>${escHtml(l.detail)}</small>` : ''}</span></li>`).join('')}</ul>`;
  const send = o.canSend !== false ? `<button class="btn-secondary btn-sm" onclick="proposalSendVersion(${d.id})" data-tip="Marks the proposal as sent and this version as the one the client has">Mark as sent</button>` : '';
  return `<div class="deck-check${o.narrow ? ' is-narrow' : ''}" data-check-for="${d.id}">${head}${lines}<div class="deck-check-ft"><button class="rlink" onclick="proposalRecheck()">Check again</button>${send}</div></div>`;
}
