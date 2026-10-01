// Revise prices (1.66), as the proposal page asks for it: the next version of
// a deck with only its prices, the price sentences, the term wording and the
// two dates changed (src-tauri/src/reprice.rs), or the plain reason it cannot
// be done in place. Pure.

import type { Proposal, ProposalDocument } from './types';
import { PS, stageIndex } from './commercial';
import { openRevision } from './revisions';

export interface RepriceReport {
  /** Amounts that changed. */
  amounts: number;
  amountSlides: number[];
  termSlides: number[];
  dateSlides: number[];
  /** Fee rows recognised as a price of the proposal. None: no fee table was recognised. */
  rowsFound: number;
  /** Prices of the proposal with no row in the deck. */
  unplaced: string[];
  /** Other reasons it cannot be done in place. */
  blocked: string[];
  /** Worth a look in the new version; they do not stop it. */
  checks: string[];
  termsStated: number[];
}

export interface ReviseResult {
  report: RepriceReport;
  canSave: boolean;
  /** Why not, in one sentence. */
  reason: string;
  /** The line kept in the new version's notes. */
  line: string;
  fromVersion: number | null;
  fileName: string;
  path: string | null;
  document: ProposalDocument | null;
}

export type Round = 'internal' | 'client';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "slide 4", "slides 4 and 9", "slides 4, 9 and 12". */
export function slideList(slides: number[]): string {
  if (!slides.length) return '';
  if (slides.length === 1) return `slide ${slides[0]}`;
  return `slides ${slides.slice(0, -1).join(', ')} and ${slides[slides.length - 1]}`;
}

/** The round a new version belongs to, before anyone says: a client revision once the proposal has gone to the
 * client (an open revision's request is its reason), else an internal round. */
export function defaultRound(p: Pick<Proposal, 'status' | 'revisions'>): { round: Round; reason: string } {
  const open = openRevision(p);
  if (open) return { round: 'client', reason: (open.reason || '').split('\n')[0].trim().slice(0, 120) };
  return { round: stageIndex(p.status) >= stageIndex(PS.SENT) ? 'client' : 'internal', reason: '' };
}

export interface ReviseSummary {
  /** Can it be saved as the next version? */
  ok: boolean;
  title: string;
  lines: string[];
  /** Offer "Regenerate instead": the deck could not be revised in place, and building it afresh would do it. */
  regenerate: boolean;
}

/** What the dialog says before anything is saved. */
export function reviseSummary(r: ReviseResult, next: number): ReviseSummary {
  const from = `V${r.fromVersion ?? '?'}`;
  const rep = r.report;
  if (r.canSave) {
    const lines = [
      rep.amounts ? `${plural(rep.amounts, 'amount')} on ${slideList(rep.amountSlides)}` : '',
      rep.termSlides.length ? `The contract term on ${slideList(rep.termSlides)}` : '',
      rep.dateSlides.length ? `The cover and letter date (${slideList(rep.dateSlides)})` : '',
      ...rep.checks,
    ].filter(Boolean);
    return { ok: true, title: `V${next} changes only this; everything else in ${from} stays as it is`, lines, regenerate: false };
  }
  // The prices already match: there is nothing to make, by either road.
  const nothing = rep.rowsFound > 0 && !rep.unplaced.length && !rep.blocked.length;
  const lines = rep.unplaced.length ? rep.unplaced : rep.blocked;
  return {
    ok: false,
    title: rep.unplaced.length ? `${rep.unplaced.length === 1 ? 'One price has' : 'Some prices have'} no row in ${from}` : rep.blocked.length ? `${from} cannot be revised in place` : r.reason,
    lines: nothing ? [] : [...lines, `Regenerate instead builds V${next} from the templates; edits made by hand in ${from} are not carried.`].filter((l, i, all) => all.indexOf(l) === i),
    regenerate: !nothing,
  };
}
