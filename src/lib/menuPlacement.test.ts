// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { menuPlacement } from './utils';

// A 1,080 × 940 window; the record page scrolls below a 48px bar.
const bounds = { top: 48, bottom: 940, width: 1080 };
const button = (top: number) => ({ top, bottom: top + 26, left: 900, right: 1000 });
const menu = { width: 180, height: 300 };

describe('where a button menu opens', () => {
  it('below the button, right-aligned, 4px gap, when there is room below', () => {
    expect(menuPlacement(button(400), menu, bounds)).toEqual({ top: 430, left: 820, above: false });
  });

  it('still below when it also fits above (the Followed up menu opened upwards)', () => {
    expect(menuPlacement(button(500), menu, bounds).above).toBe(false);
  });

  it('above only when the room below is too small and there is more above', () => {
    const p = menuPlacement(button(800), menu, bounds);
    expect(p).toEqual({ top: 496, left: 820, above: true });
  });

  it('near the top with little room anywhere: below, clamped inside the visible area', () => {
    const tall = { width: 180, height: 900 };
    const p = menuPlacement(button(60), tall, bounds);
    expect(p.above).toBe(false);
    expect(p.top).toBe(54);
  });

  it('never past the right edge', () => {
    expect(menuPlacement({ top: 400, bottom: 426, left: 1000, right: 1078 }, menu, bounds).left).toBe(1080 - 180 - 6);
  });
});
