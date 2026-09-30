// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { collapseRow, collapseRows, settleNew } from './motion';

afterEach(() => vi.useRealTimers());
const noReducedMotion = () => vi.stubGlobal('matchMedia', () => ({ matches: false }));

describe('rows leave (collapseRow)', () => {
  it('resolves at once where animation is unavailable', async () => {
    noReducedMotion();
    const el = document.createElement('div');
    await expect(collapseRow(el)).resolves.toBeUndefined();
    await expect(collapseRow(null)).resolves.toBeUndefined();
  });

  it('fades, then closes up, and never waits on a paused window', async () => {
    noReducedMotion();
    vi.useFakeTimers();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const frames: Keyframe[][] = [];
    // An animation whose "finished" never settles, as in a hidden window.
    (el as any).animate = (k: Keyframe[]) => { frames.push(k); return { finished: new Promise(() => {}) }; };
    const done = collapseRow(el);
    await vi.advanceTimersByTimeAsync(500);
    await done;
    expect(frames.map((k) => Object.keys(k[1]).sort().join(','))).toEqual(['opacity', 'height,marginBottom,marginTop,paddingBottom,paddingTop']);
    expect(el.style.pointerEvents).toBe('none');
  });

  it('a table row only fades (it cannot shrink)', async () => {
    noReducedMotion();
    const table = document.createElement('table');
    const tr = table.insertRow();
    const calls: number[] = [];
    (tr as any).animate = () => { calls.push(1); return { finished: Promise.resolve() }; };
    await collapseRows([tr]);
    expect(calls).toHaveLength(1);
  });
});

describe('new items settle in (settleNew)', () => {
  it('marks the element and clears the mark', () => {
    noReducedMotion();
    vi.useFakeTimers();
    const el = document.createElement('div');
    settleNew(el);
    expect(el.classList.contains('is-new')).toBe(true);
    vi.advanceTimersByTime(500);
    expect(el.classList.contains('is-new')).toBe(false);
  });

  it('does nothing with reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const el = document.createElement('div');
    settleNew(el);
    expect(el.classList.contains('is-new')).toBe(false);
  });
});

describe('travelling focus (keyTravel)', () => {
  it('puts one ring in the list, slides it, marks long jumps, hides on a press', async () => {
    const { keyTravel } = await import('./motion');
    document.body.innerHTML = '<div id="list"><div class="r">a</div><div class="r">b</div><div class="r">c</div></div>';
    const list = document.getElementById('list')!;
    const rows = [...list.querySelectorAll<HTMLElement>('.r')];
    rows.forEach((r, i) => { r.getBoundingClientRect = () => ({ top: i * 40, left: 0, width: 300, height: 40, bottom: i * 40 + 40, right: 300 } as DOMRect); });
    list.getBoundingClientRect = () => ({ top: 0, left: 0, width: 300, height: 120, bottom: 120, right: 300 } as DOMRect);
    keyTravel(rows[0], list);
    const hl = list.querySelector<HTMLElement>('.key-hl')!;
    expect(list.querySelectorAll('.key-hl')).toHaveLength(1);
    expect(hl.style.transform).toBe('translate(0px, 0px)');
    keyTravel(rows[1], list);
    expect(hl.style.transform).toBe('translate(0px, 40px)');
    expect(hl.classList.contains('is-jump')).toBe(false);
    keyTravel(rows[0], list);
    keyTravel(rows[2], list);
    expect(hl.classList.contains('is-jump')).toBe(true);
    list.dispatchEvent(new Event('pointerdown'));
    expect(hl.style.opacity).toBe('0');
  });
});
