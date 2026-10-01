import { describe, it, expect } from 'vitest';
import { defaultRound, reviseSummary, slideList, type ReviseResult } from './revisePrices';

const report = (over: Partial<ReviseResult['report']> = {}) => ({ amounts: 0, amountSlides: [], termSlides: [], dateSlides: [], rowsFound: 0, unplaced: [], blocked: [], checks: [], termsStated: [], ...over });
const result = (over: Partial<ReviseResult> = {}): ReviseResult => ({ report: report(), canSave: false, reason: '', line: '', fromVersion: 1, fileName: 'Deck_V2.pptx', path: null, document: null, ...over });

describe('revise prices (1.66)', () => {
  it('says what the next version changes, and that the rest stays', () => {
    const s = reviseSummary(result({ canSave: true, report: report({ amounts: 3, amountSlides: [14, 15], termSlides: [8], dateSlides: [1, 2], rowsFound: 5, checks: ['Slide 12 still shows 5,000 SAR somewhere: check it.'] }) }), 2);
    expect(s).toEqual({
      ok: true, regenerate: false,
      title: 'V2 changes only this; everything else in V1 stays as it is',
      lines: ['3 amounts on slides 14 and 15', 'The contract term on slide 8', 'The cover and letter date (slides 1 and 2)', 'Slide 12 still shows 5,000 SAR somewhere: check it.'],
    });
    expect(reviseSummary(result({ canSave: true, report: report({ amounts: 1, amountSlides: [9], dateSlides: [1], rowsFound: 1 }) }), 3).lines).toEqual(['1 amount on slide 9', 'The cover and letter date (slide 1)']);
  });

  it('a price with no row stops it, names the lines and offers to regenerate', () => {
    const s = reviseSummary(result({ reason: 'Some prices have no row in V1: Payroll; Admin PRO: 16–30 employees.', report: report({ rowsFound: 2, unplaced: ['Payroll', 'Admin PRO: 16–30 employees'] }) }), 2);
    expect(s.ok).toBe(false);
    expect(s.regenerate).toBe(true);
    expect(s.title).toBe('Some prices have no row in V1');
    expect(s.lines).toEqual(['Payroll', 'Admin PRO: 16–30 employees', 'Regenerate instead builds V2 from the templates; edits made by hand in V1 are not carried.']);
    const one = reviseSummary(result({ report: report({ rowsFound: 2, unplaced: ['Payroll'] }) }), 2);
    expect(one.title).toBe('One price has no row in V1');
    const blocked = reviseSummary(result({ report: report({ rowsFound: 2, blocked: ['The contract term changed from 6 to 9 months, and that wording cannot be changed in place.'] }) }), 2);
    expect(blocked.title).toBe('V1 cannot be revised in place');
    expect(blocked.lines[0]).toBe('The contract term changed from 6 to 9 months, and that wording cannot be changed in place.');
  });

  it('a deck with no fee table it recognises says so; one that already matches has nothing to make', () => {
    const none = reviseSummary(result({ reason: 'No fee table was recognised in V1, so nothing was changed.' }), 2);
    expect([none.ok, none.title, none.regenerate]).toEqual([false, 'No fee table was recognised in V1, so nothing was changed.', true]);
    const same = reviseSummary(result({ reason: 'The prices and the term in V1 already match the proposal.', report: report({ rowsFound: 3 }) }), 2);
    expect(same).toEqual({ ok: false, title: 'The prices and the term in V1 already match the proposal.', lines: [], regenerate: false });
  });

  it('a new version is an internal round until the proposal has gone to the client', () => {
    expect(defaultRound({ status: 'Drafting', revisions: [] })).toEqual({ round: 'internal', reason: '' });
    expect(defaultRound({ status: 'In Internal Review', revisions: [] })).toEqual({ round: 'internal', reason: '' });
    expect(defaultRound({ status: 'Sent to Client', revisions: [] })).toEqual({ round: 'client', reason: '' });
    // The client asked for changes: back in drafting, and what they asked is the reason.
    const revisions = [{ id: 1, number: 1, requestedAt: '2026-09-28', requestedByContactId: null, reason: 'Price for 40 employees\nand a shorter notice', linesBeforeJson: '[]', sentAt: null }];
    expect(defaultRound({ status: 'Drafting', revisions })).toEqual({ round: 'client', reason: 'Price for 40 employees' });
    expect(slideList([4])).toBe('slide 4');
    expect(slideList([4, 9, 12])).toBe('slides 4, 9 and 12');
  });
});
