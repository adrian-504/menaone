// A proposal's generated decks as a version history: newest first, each with
// its version, file, type, date, where it came from and whether the file is
// still where it was saved. Rendering only — the proposal page wires it up.

import { escHtml } from './utils';
import { fmtDateShort } from './dates';
import { miniCoverHtml } from './studio';
import { icon } from './icons';
import { proposalDecks } from './commercial';
import type { Proposal, ProposalDocument } from './types';

/** Whether each deck's file is still at its path: true, false, or unknown (not checked yet / outside OneDrive). */
export type FileStatus = Map<string, boolean>;

export function deckStatus(d: ProposalDocument, files: FileStatus): { label: string; tone: 'green' | 'red' | 'muted' } {
  if (d.path && files.get(d.path) === false) return { label: 'File missing', tone: 'red' };
  if ((d.notes || '').startsWith('Generated')) return { label: 'Generated', tone: 'green' };
  return { label: 'Added from folder', tone: 'muted' };
}

function fileType(name: string): string {
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  return ext === 'pptx' || ext === 'ppt' ? 'PowerPoint' : ext === 'pdf' ? 'PDF' : ext === 'key' ? 'Keynote' : ext ? ext.toUpperCase() : 'Document';
}

const attr = (v: string) => escHtml(v.replace(/'/g, "\\'"));

/** A deck's status line: "sent 2 Sept" for the version the client has, else "draft" (studio slice). */
export function deckStatusLine(d: ProposalDocument, latest: boolean, p: Partial<Pick<Proposal, 'status' | 'dateSentToClient' | 'lastSentAt' | 'sentDate'>>): string {
  const sent = p.lastSentAt || p.dateSentToClient || p.sentDate;
  const withClient = !!sent && !!p.status && !/Request|Drafting|Review/i.test(p.status);
  // The client has this version only if it existed when the proposal was sent.
  if (latest && withClient && (!d.createdAt || d.createdAt.slice(0, 10) <= sent!.slice(0, 10))) return `sent ${fmtDateShort(sent!)}`;
  if (!latest && withClient && d.createdAt && sent && d.createdAt <= sent) return 'earlier version';
  return 'draft';
}

/** The "Proposal documents" section (studio slice): each version a card with the brand mini-cover, newest first. */
export function proposalDeckRows(p: Pick<Proposal, 'documents'> & Partial<Pick<Proposal, 'client' | 'status' | 'dateSentToClient' | 'lastSentAt' | 'sentDate'>>, files: FileStatus): string {
  const decks = proposalDecks(p);
  return decks.map((d, i) => {
    const status = deckStatus(d, files);
    const canOpen = !!d.path && files.get(d.path) !== false;
    const byHand = status.label === 'Added from folder';
    const line = status.tone === 'red' ? status.label : deckStatusLine(d, i === 0, p);
    const path = d.path ? attr(d.path) : '';
    return `<div class="deck-tile pr-deck${canOpen ? '' : ' is-missing'}" data-doc-id="${d.id}"${canOpen ? ` tabindex="0" data-ql-path="${path}" onkeydown="if(event.key==='Enter'&&event.target===this)this.click()" onclick="proposalOpenFile('${path}')"` : ''}>
      ${miniCoverHtml(p.client || '', `V${d.version ?? '?'}`, d.createdAt ? fmtDateShort(d.createdAt) : '')}
      <div class="deck-tile-meta">
        <span class="pr-deck-version">V${d.version ?? '?'}</span>${i === 0 ? '<span class="deck-latest">Latest</span>' : ''}
        <span class="deck-line${status.tone === 'red' ? ' t-red' : ''}">${escHtml(line)}</span>${byHand ? '<span class="deck-hand">made by hand</span>' : ''}
      </div>
      <div class="deck-tile-file" title="${escHtml(d.fileName)}">${escHtml(d.fileName)} · ${escHtml(fileType(d.fileName))}</div>
      <div class="deck-tile-acts">
        ${canOpen ? `<button class="rec-icon-btn" onclick="event.stopPropagation();proposalOpenFile('${path}')" data-tip="Open" aria-label="Open ${escHtml(d.fileName)}">${icon('document', 13)}</button>
        <button class="rec-icon-btn" onclick="event.stopPropagation();proposalRevealFile('${path}')" data-tip="Show in Finder" aria-label="Show ${escHtml(d.fileName)} in Finder">${icon('folder', 13)}</button>
        <button class="rec-icon-btn" onclick="event.stopPropagation();quickLookPath('${path}')" data-tip="Quick Look" aria-label="Quick Look ${escHtml(d.fileName)}">${icon('eye', 13)}</button>` : ''}
        <button class="rec-icon-btn" onclick="event.stopPropagation();proposalRemoveDocument(${d.id})" data-tip="Remove from this proposal (the file stays)" aria-label="Remove ${escHtml(d.fileName)} from this proposal">${icon('close', 13)}</button>
      </div>
    </div>`;
  }).join('');
}
