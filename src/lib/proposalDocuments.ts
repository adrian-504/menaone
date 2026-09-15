// A proposal's generated decks as a version history: newest first, each with
// its version, file, type, date, where it came from and whether the file is
// still where it was saved. Rendering only — the proposal page wires it up.

import { escHtml, fmtDate } from './utils';
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

/** The rows of the "Proposal documents" section. */
export function proposalDeckRows(p: Pick<Proposal, 'documents'>, files: FileStatus): string {
  const decks = proposalDecks(p);
  return decks.map((d, i) => {
    const status = deckStatus(d, files);
    const canOpen = !!d.path && files.get(d.path) !== false;
    return `<div class="rec-row pr-deck" data-doc-id="${d.id}"${canOpen ? ` onclick="proposalOpenFile('${attr(d.path!)}')"` : ''}>
      <span class="pr-deck-version">V${d.version ?? '?'}</span>
      <div class="rec-row-main">
        <div class="rec-row-title" title="${escHtml(d.fileName)}">${escHtml(d.fileName)}</div>
        <div class="pr-deck-meta">${i === 0 ? '<span class="rec-badge tone-accent">Latest</span>' : ''}<span class="rec-badge tone-${status.tone}">${status.label}</span><span class="rec-row-sub">${[fileType(d.fileName), d.createdAt ? fmtDate(d.createdAt) : '', d.notes || ''].filter(Boolean).map(escHtml).join(' · ')}</span></div>
      </div>
      <div class="rec-row-actions">
        ${canOpen ? `<button class="rec-icon-btn" onclick="event.stopPropagation();proposalOpenFile('${attr(d.path!)}')" title="Open" aria-label="Open ${escHtml(d.fileName)}">${icon('document', 13)}</button>
        <button class="rec-icon-btn" onclick="event.stopPropagation();proposalRevealFile('${attr(d.path!)}')" title="Show in Finder" aria-label="Show ${escHtml(d.fileName)} in Finder">${icon('folder', 13)}</button>` : ''}
        <button class="rec-icon-btn" onclick="event.stopPropagation();proposalRemoveDocument(${d.id})" title="Remove from this proposal (the file stays)" aria-label="Remove ${escHtml(d.fileName)} from this proposal">${icon('close', 13)}</button>
      </div>
    </div>`;
  }).join('');
}
