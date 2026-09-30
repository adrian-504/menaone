// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
vi.mock('./db', () => ({
  filesQuickLook: vi.fn(async (p: string) => { calls.push(p); }),
  filesOpen: vi.fn(), filesRevealInFinder: vi.fn(),
}));

import { qlPathOf, quickLook } from './quickLook';

describe('Quick Look', () => {
  it('finds the file a row stands for', () => {
    document.body.innerHTML = `<div class="rec-row" tabindex="0" data-ql-path="/Users/x/OneDrive/Deck.pptx"><span id="in">Deck</span></div><div id="out"></div>`;
    expect(qlPathOf(document.getElementById('in'))).toBe('/Users/x/OneDrive/Deck.pptx');
    expect(qlPathOf(document.getElementById('out'))).toBeNull();
    expect(qlPathOf(null)).toBeNull();
  });

  it('gives the keyboard back to the row when the preview closes', async () => {
    document.body.innerHTML = `<div class="rec-row" tabindex="0" id="row" data-ql-path="/p/Deck.pdf"></div><input id="other">`;
    (document.getElementById('other') as HTMLInputElement).focus();
    await quickLook('/p/Deck.pdf', () => document.getElementById('row'));
    expect(calls).toEqual(['/p/Deck.pdf']);
    expect(document.activeElement?.id).toBe('row');
  });
});
