import { describe, it, expect } from 'vitest';
import { checkSummary, checkWarns, type CheckLine, type SendCheck } from './sendCheck';

const line = (key: string, status: CheckLine['status']): CheckLine => ({ key, label: key, status, detail: '', slides: [] });
const check = (statuses: CheckLine['status'][], over: Partial<SendCheck> = {}): SendCheck => ({ fileName: 'Deck.pptx', checked: true, note: '', slideCount: 12, lines: statuses.map((s, i) => line(`l${i}`, s)), ...over });

describe('the check before sending, in one line', () => {
  it('all five pass', () => {
    const c = check(['pass', 'pass', 'pass', 'pass', 'pass']);
    expect(checkSummary(c)).toEqual({ text: 'All 5 pass', tone: 'green' });
    expect(checkWarns(c)).toBe(false);
  });
  it('counts what to fix and what to look at; red when anything fails, amber when it is only to check', () => {
    expect(checkSummary(check(['fail', 'check', 'fail', 'pass', 'pass']))).toEqual({ text: '2 to fix · 1 to check', tone: 'red' });
    expect(checkSummary(check(['pass', 'check', 'pass', 'pass', 'pass']))).toEqual({ text: '1 to check', tone: 'amber' });
    expect(checkWarns(check(['pass', 'check', 'pass', 'pass', 'pass']))).toBe(true);
  });
  it('a line that could not be checked is never a pass', () => {
    const c = check(['pass', 'pass', 'pass', 'not_checked', 'not_checked']);
    expect(checkSummary(c)).toEqual({ text: '3 pass · 2 not checked', tone: 'grey' });
    expect(checkWarns(c)).toBe(false);
    expect(checkSummary(check(['fail', 'pass', 'pass', 'not_checked', 'pass'])).text).toBe('1 to fix · 1 not checked');
  });
  it('a file that is not a PowerPoint says so', () => {
    const c = check([], { checked: false, note: 'Not a PowerPoint file, not checked' });
    expect(checkSummary(c)).toEqual({ text: 'Not a PowerPoint file, not checked', tone: 'grey' });
    expect(checkWarns(c)).toBe(false);
  });
});
