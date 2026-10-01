// The check before sending (1.66), as the proposal page shows it: the five
// lines the backend reads from the deck (src-tauri/src/sendcheck.rs), each
// pass, fail, "check these" or "not found, not checked". It warns; it never
// blocks. Pure.

export type CheckStatus = 'pass' | 'fail' | 'check' | 'not_checked';
export interface CheckLine { key: string; label: string; status: CheckStatus; detail: string; slides: number[] }
export interface SendCheck { fileName: string; checked: boolean; note: string; lines: CheckLine[]; slideCount: number }

export const CHECK_TONE: Record<CheckStatus, 'green' | 'red' | 'amber' | 'grey'> = { pass: 'green', fail: 'red', check: 'amber', not_checked: 'grey' };
export const CHECK_GLYPH: Record<CheckStatus, string> = { pass: '✓', fail: '✕', check: '!', not_checked: '–' };

/** The check in one line: "All 5 pass", "2 to fix · 1 to check", "Not a PowerPoint file, not checked". A line that
 * could not be checked is never counted as a pass. */
export function checkSummary(c: SendCheck): { text: string; tone: 'green' | 'red' | 'amber' | 'grey' } {
  if (!c.checked) return { text: c.note || 'Not checked', tone: 'grey' };
  const n = (s: CheckStatus) => c.lines.filter((l) => l.status === s).length;
  const fail = n('fail'), check = n('check'), skipped = n('not_checked'), pass = n('pass');
  if (!fail && !check && !skipped) return { text: `All ${pass} pass`, tone: 'green' };
  const bits = [fail ? `${fail} to fix` : '', check ? `${check} to check` : '', skipped ? `${skipped} not checked` : ''].filter(Boolean);
  if (!fail && !check) bits.unshift(`${pass} pass`);
  return { text: bits.join(' · '), tone: fail ? 'red' : check ? 'amber' : 'grey' };
}

/** Does anything on the list need a look before it goes? (It still never blocks.) */
export const checkWarns = (c: SendCheck): boolean => c.checked && c.lines.some((l) => l.status === 'fail' || l.status === 'check');
