// Hand-made decks (owner, 28-Sep-2026): Ahmad often builds the PowerPoint
// himself instead of generating it. The client folder's files that look like
// *this* proposal's deck are offered first on the proposal page, like the
// client-folder matching. Pure: the page (tabs/proposalPage.ts) lists and adds them.

import { cleanFileName, lineTotals } from './commercial';
import type { LocalFileItem, Proposal } from './types';

const DECK = /\.(pptx|ppt|pdf|key)$/i;
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole word inside a file name, where "_" separates words too. */
const hasWord = (name: string, word: string) => !!word && new RegExp(`(^|[^a-z0-9])${escRe(word)}([^a-z0-9]|$)`, 'i').test(name);
const dayBefore = (iso: string) => { const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

/** The words that say a file is about one of the proposal's services ("&" also read as "and"). */
function serviceWords(p: Pick<Proposal, 'lines' | 'contractMonths'>): string[] {
  return lineTotals(p.lines, p.contractMonths).serviceNames.flatMap((n) => {
    const name = cleanFileName(n);
    return name.includes('&') ? [name, name.replace(/\s*&\s*/g, ' and ')] : [name];
  }).filter(Boolean);
}

/** The folder files that look like this proposal's deck, best first: a deck file
 * named for the client with "proposal" in it, saved since the request came in,
 * and not already on any proposal. Naming one of its services ranks first. */
export function matchDecks(
  p: Pick<Proposal, 'client' | 'dateAdded' | 'lines' | 'contractMonths'>,
  files: LocalFileItem[],
  allProposals: Pick<Proposal, 'documents'>[],
): LocalFileItem[] {
  const client = cleanFileName(p.client).toLowerCase();
  if (!client) return [];
  const recorded = new Set(allProposals.flatMap((x) => (x.documents || []).map((d) => d.path)).filter(Boolean));
  const since = p.dateAdded ? dayBefore(p.dateAdded) : '';
  const services = serviceWords(p);
  const scored = files.filter((f) => {
    if (f.isFolder || !DECK.test(f.name) || !/proposal/i.test(f.name) || recorded.has(f.path)) return false;
    // Starting with the client the way suggestedFileName names it ("<Client>_…"),
    // or naming it anywhere; always as a whole word ("Acme" is not "Acme Group").
    if (!hasWord(f.name, client)) return false;
    return !since || (!!f.modifiedAt && f.modifiedAt.slice(0, 10) >= since);
  }).map((f) => ({ f, service: services.some((w) => hasWord(f.name, w)) }));
  return scored
    .sort((a, b) => Number(b.service) - Number(a.service) || (b.f.modifiedAt || '').localeCompare(a.f.modifiedAt || ''))
    .map((x) => x.f);
}

/** The version a deck is recorded as: the `_V<n>` in its name unless that one
 * is taken, else the one after the recorded versions. */
export function deckVersion(fileName: string, taken: number[]): number {
  const named = fileName.match(/_V(\d+)\.[a-z0-9]+$/i);
  const wanted = named ? Number(named[1]) : null;
  if (wanted != null && !taken.includes(wanted)) return wanted;
  return Math.max(0, ...taken) + 1;
}
