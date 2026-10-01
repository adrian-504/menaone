// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatLike, parseNumber, rollNumber, startRollingNumbers } from './rollNumber';

afterEach(() => vi.useRealTimers());
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('rolling numbers', () => {
  it('reads and writes numbers the way they were shown', () => {
    expect(parseNumber('SAR 15,000')).toBe(15000);
    expect(parseNumber('3 contacts')).toBe(3);
    expect(parseNumber('—')).toBeNull();
    expect(formatLike('SAR 15,000', 12345)).toBe('SAR 12,345');
    expect(formatLike('3 contacts', 7)).toBe('7 contacts');
    expect(formatLike('SAR 1,234.50', 99.5)).toBe('SAR 99.50');
  });

  it('counts through the middle and always lands on the real text', () => {
    vi.useFakeTimers();
    const el = document.createElement('span');
    el.textContent = 'SAR 20,000';
    document.body.appendChild(el);
    rollNumber(el, 10000, 20000);
    expect(el.textContent).toBe('SAR 10,000');
    vi.advanceTimersByTime(400);
    expect(el.textContent).toBe('SAR 20,000');
  });

  it('a badge changed in place rolls; a number seen for the first time does not', async () => {
    startRollingNumbers();
    document.body.innerHTML = '<span class="sb-badge" id="b">3</span><div id="host"></div>';
    const badge = document.getElementById('b')!;
    badge.textContent = '5';
    await tick();
    // Rolling from 3. A frame may already have run on a busy machine, so the roll is read as "not there yet".
    expect(parseNumber(badge.textContent!)).toBeGreaterThanOrEqual(3);
    expect(badge.textContent).not.toBe('5');
    document.getElementById('host')!.innerHTML = '<dd data-roll="t-value">SAR 5,000</dd>';
    await tick();
    expect(document.querySelector('[data-roll]')!.textContent).toBe('SAR 5,000'); // first time: no roll
    document.getElementById('host')!.innerHTML = '<dd data-roll="t-value">SAR 9,000</dd>';
    await tick();
    // Redrawn: rolls from the last value.
    const shown = parseNumber(document.querySelector('[data-roll]')!.textContent!)!;
    expect(shown).toBeGreaterThanOrEqual(5000);
    expect(shown).toBeLessThan(9000);
  });
});
