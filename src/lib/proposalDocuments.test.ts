// @vitest-environment jsdom
// The proposal page's version history after generation: the new version shows
// straight away as Latest, earlier versions stay listed, a moved file is
// flagged, and the proposal keeps its client folder.
import { describe, it, expect } from 'vitest';
import { applyGeneratedDocument, nextDeckFileName } from './commercial';
import { proposalDeckRows, deckStatus } from './proposalDocuments';
import type { Proposal, ProposalDocument } from './types';

const deck = (id: number, version: number, fileName: string, notes = 'Generated from Standard deck'): ProposalDocument =>
  ({ id, kind: 'proposal', version, fileName, path: `/OneDrive/Proposals/Contoso/${fileName}`, url: null, notes, createdAt: '2026-09-15' });

const versions = (html: string) => [...html.matchAll(/class="pr-deck-version">(V\d+)</g)].map((m) => m[1]);

describe('proposal documents after generation', () => {
  it('shows V1, then V2 as Latest above V1, without a reload', () => {
    const p = { id: 7, client: 'Contoso Logistics', folderPath: null, documents: [] } as unknown as Proposal;
    applyGeneratedDocument(p, deck(1, 1, 'Contoso Logistics_Recruitment Proposal_15.09.2026.pptx'), '/OneDrive/Proposals/Contoso');
    let html = proposalDeckRows(p, new Map());
    expect(versions(html)).toEqual(['V1']);
    expect(p.folderPath).toBe('/OneDrive/Proposals/Contoso');

    expect(nextDeckFileName(p, 'Recruitment', '2026-09-15', [])).toBe('Contoso Logistics_Recruitment Proposal_15.09.2026_V2.pptx');
    applyGeneratedDocument(p, deck(2, 2, 'Contoso Logistics_Recruitment Proposal_15.09.2026_V2.pptx'), '/elsewhere');
    html = proposalDeckRows(p, new Map());
    expect(versions(html)).toEqual(['V2', 'V1']);
    expect(html.indexOf('Latest')).toBeLessThan(html.indexOf('V1<'));
    expect(html.match(/Latest/g)).toHaveLength(1);
    expect(p.folderPath).toBe('/OneDrive/Proposals/Contoso');

    // The same recorded document applied twice (a refresh) doesn't duplicate it.
    applyGeneratedDocument(p, deck(2, 2, 'Contoso Logistics_Recruitment Proposal_15.09.2026_V2.pptx'), null);
    expect(versions(proposalDeckRows(p, new Map()))).toEqual(['V2', 'V1']);
  });

  it('marks where each deck came from and a file that is no longer there', () => {
    const generated = deck(1, 1, 'a.pptx');
    const attached = deck(2, 2, 'b.pptx', '');
    const files = new Map([[generated.path!, true], [attached.path!, false]]);
    expect(deckStatus(generated, files)).toEqual({ label: 'Generated', tone: 'green' });
    expect(deckStatus(attached, files)).toEqual({ label: 'File missing', tone: 'red' });
    expect(deckStatus(attached, new Map())).toEqual({ label: 'Added from folder', tone: 'muted' });
    const html = proposalDeckRows({ documents: [generated, attached] }, files);
    // A missing file can't be opened or revealed, but can still be removed from the proposal.
    const missingRow = html.split('data-doc-id="1"')[0];
    expect(missingRow).not.toContain('proposalOpenFile');
    expect(missingRow).toContain('proposalRemoveDocument(2)');
    expect(html.split('data-doc-id="1"')[1]).toContain('proposalRevealFile');
  });
});
