// @vitest-environment jsdom
// The proposal page's version history after generation: the new version shows
// straight away as Latest, earlier versions stay listed, a moved file is
// flagged, and the proposal keeps its client folder.
import { describe, it, expect } from 'vitest';
import { applyGeneratedDocument, nextDeckFileName } from './commercial';
import { proposalDeckRows, deckMarks, deckStatus, deckStatusLine, editedSince, heldDeck, leadDeck, markSentVersion, orderedDecks, revisionReport, sentDayFor, sentDeck } from './proposalDocuments';
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

  it('a card says "sent" only for the version the client has', () => {
    const sentP = { status: 'Sent to Client', dateSentToClient: '2026-09-02' };
    const v1 = { ...deck(1, 1, 'a.pptx'), createdAt: '2026-09-01' };
    const v2 = { ...deck(2, 2, 'b.pptx'), createdAt: '2026-09-30' };
    expect(deckStatusLine(v1, heldDeck({ ...sentP, documents: [v1] }), sentP)).toBe('sent 2 Sept');
    // A version made after the send is a draft, and the one that went still says so.
    const held = heldDeck({ ...sentP, documents: [v1, v2] });
    expect(held?.id).toBe(1);
    expect([deckStatusLine(v2, held, sentP), deckStatusLine(v1, held, sentP)]).toEqual(['draft', 'sent 2 Sept']);
    // Nothing has gone while it is being drafted.
    expect(heldDeck({ status: 'Drafting', documents: [v1] })).toBeNull();
    expect(deckStatusLine(v1, null, { status: 'Drafting' })).toBe('draft');
    // A version made only after the send: the client has none of these files.
    expect(heldDeck({ ...sentP, documents: [v2] })).toBeNull();
  });
});

describe('the sent file is the record (1.66)', () => {
  const v = (id: number, version: number, over: Partial<ProposalDocument> = {}) => ({ ...deck(id, version, `Deck_V${version}.pptx`), ...over });

  it('the version marked as sent to the client leads; the rest follow newest first', () => {
    const p = { documents: [v(1, 1), v(2, 2, { sentToClientAt: '2026-10-02' }), v(3, 3)] };
    expect(orderedDecks(p).map((d) => d.version)).toEqual([2, 3, 1]);
    expect(sentDeck(p)?.version).toBe(2);
    expect(leadDeck(p)?.version).toBe(2);
    // Nothing marked: newest first, and the check reads the latest.
    const none = { documents: [v(1, 1), v(3, 3), v(2, 2)] };
    expect(orderedDecks(none).map((d) => d.version)).toEqual([3, 2, 1]);
    expect([sentDeck(none), leadDeck(none)?.version]).toEqual([null, 3]);
    const html = proposalDeckRows({ ...p, client: 'Contoso', status: 'Sent to Client', dateSentToClient: '2026-10-02' }, new Map());
    expect(versions(html)).toEqual(['V2', 'V3', 'V1']);
    // The mark says which one the client has; "Latest" stays on the newest; no other card says sent.
    expect(html.match(/sent to the client 2 Oct/g)).toHaveLength(1);
    expect(html.match(/is-sent/g)).toHaveLength(1);
    expect(html.match(/>Latest</g)).toHaveLength(1);
    expect(html.split('data-doc-id="3"')[1].split('data-doc-id=')[0]).toContain('>draft<');
    expect(html.split('data-doc-id="1"')[1]).toContain('>earlier version<');
    // A price revision is MENA One's own file, not one made by hand.
    expect(proposalDeckRows({ documents: [v(2, 2, { notes: 'Prices revised from V1: 3 amounts updated on slide 9' })] }, new Map())).not.toContain('made by hand');
  });

  it('a file MENA One wrote and someone edited since is flagged; one recorded before 1.66 never is', () => {
    const generated = v(1, 1, { generatedSha256: 'aaa' });
    const old = v(2, 2);
    const prints = new Map<string, string | null>([[generated.path!, 'bbb'], [old.path!, 'ccc']]);
    expect(editedSince(generated, prints)).toBe(true);
    expect(editedSince(generated, new Map([[generated.path!, 'aaa']]))).toBe(false);
    expect(editedSince(generated, new Map())).toBe(false);
    expect(editedSince(generated, new Map([[generated.path!, null]]))).toBe(false);
    expect(editedSince(old, prints)).toBe(false);
    expect(deckMarks(generated, prints)).toEqual([{ text: 'edited after generation', tone: 'amber' }]);
    expect(proposalDeckRows({ documents: [generated, old] }, new Map(), prints).match(/edited after generation/g)).toHaveLength(1);
  });

  it('a version says its round, a client revision its reason, and hand edits that were not carried', () => {
    expect(deckMarks(v(1, 1, { round: 'internal' }), new Map())).toEqual([{ text: 'internal round' }]);
    expect(deckMarks(v(2, 2, { round: 'client', roundReason: 'Price on three people' }), new Map())).toEqual([{ text: 'client revision: Price on three people' }]);
    expect(deckMarks(v(3, 3, { round: 'client', notCarried: true, carriedFromVersion: 2 }), new Map())).toEqual([{ text: 'client revision' }, { text: 'hand edits from V2 not carried', tone: 'amber' }]);
    expect(deckMarks(v(4, 4), new Map())).toEqual([]);
    const report = 'Prices revised from V1: 9 amounts updated on slides 14, 15; dates on slides 1 and 2';
    expect(revisionReport(v(2, 2, { notes: report }))).toBe(report);
    expect(revisionReport(v(1, 1))).toBe('');
    expect(proposalDeckRows({ documents: [v(2, 2, { notes: report, round: 'internal', carriedFromVersion: 1 })] }, new Map())).toContain('9 amounts updated on slides 14, 15');
  });

  it('any version can be marked as the one sent', () => {
    const html = proposalDeckRows({ documents: [v(1, 1), v(2, 2, { sentToClientAt: '2026-10-02' })] }, new Map());
    expect(html.match(/proposalMarkSentVersion\(/g)).toHaveLength(2);
    expect(html.split('data-doc-id="2"')[1].split('data-doc-id=')[0]).toContain('aria-pressed="true"');
    expect(html.split('data-doc-id="1"')[1]).toContain('aria-pressed="false"');
  });

  it('the mark moves: one version carries it, and it takes the day the version went', () => {
    const p = { documents: [v(1, 1, { sentToClientAt: '2026-09-02' }), v(2, 2), { ...v(3, 3), kind: 'supporting' as const, sentToClientAt: null }] };
    markSentVersion(p, 2, '2026-10-01');
    expect(p.documents.map((d) => d.sentToClientAt)).toEqual([null, '2026-10-01', null]);
    markSentVersion(p, null, '2026-10-01');
    expect(p.documents.every((d) => !d.sentToClientAt)).toBe(true);
    // A version that was there when the proposal was sent went that day; one made after it goes today.
    expect(sentDayFor({ dateSentToClient: '2026-09-02' }, { createdAt: '2026-09-01' }, '2026-10-01')).toBe('2026-09-02');
    expect(sentDayFor({ dateSentToClient: '2026-09-02', lastSentAt: '2026-09-20' }, { createdAt: '2026-09-15' }, '2026-10-01')).toBe('2026-09-20');
    expect(sentDayFor({ dateSentToClient: '2026-09-02' }, { createdAt: '2026-09-28' }, '2026-10-01')).toBe('2026-10-01');
    expect(sentDayFor({}, { createdAt: '2026-09-28' }, '2026-10-01')).toBe('2026-10-01');
  });
});
