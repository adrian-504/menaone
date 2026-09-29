// @vitest-environment jsdom
// Meeting notes are findable: the palette shows where a search matched, and
// the Meetings list shows what was noted instead of a "Notes" mark.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/db', async (orig) => ({
  ...(await orig<typeof import('../lib/db')>()),
  searchWorkspace: vi.fn(async () => [{ entityType: 'meeting', entityId: 9, title: 'Renewal call', snippet: '…the renewal terms were agreed…' }]),
}));
vi.mock('./recordRail', () => ({ updateRecordRail: vi.fn() }));
vi.mock('../lib/bulkBar', () => ({ syncBulkBars: vi.fn() }));

import { S } from '../lib/state';
import { openCommandPalette, onPaletteInput } from './commandPalette';
import '../tabs/meetings';
import type { Meeting } from '../lib/types';

const meeting = (over: Partial<Meeting>): Meeting => ({
  id: 9, title: 'Renewal call', meetingDate: '2026-09-20', startAt: null, endAt: null, companyName: 'Acme Test Co', companyId: null,
  attendees: [], isCancelled: false, source: 'manual', agenda: null, discussion: 'So the renewal terms were agreed. Invoice monthly.',
  decisions: null, followUp: null, actionItems: null, ...over,
} as Meeting);

describe('meeting notes in the palette and the Meetings list', () => {
  it('a meeting hit renders a second line with the part of the meeting and the match', async () => {
    S.meetings = [meeting({})];
    document.body.innerHTML = '<div id="cmdk-ov"><input id="cmdk-input"><div id="cmdk-list"></div></div>';
    openCommandPalette();
    onPaletteInput('renewal');
    await new Promise((r) => setTimeout(r, 250));
    const item = [...document.querySelectorAll('#cmdk-list .cmdk-item')].find((el) => el.textContent?.includes('Renewal call'))!;
    expect(item.querySelector('.cmdk-label')?.textContent).toBe('Renewal call');
    expect(item.querySelector('.cmdk-sub')?.textContent).toBe('Discussion · …the renewal terms were agreed…');
  });

  it('a meeting with decisions shows its first sentence and no "Notes" mark', () => {
    S.meetings = [meeting({ decisions: 'Invoice monthly from October. Fees stay.' }), meeting({ id: 10, title: 'Empty one', discussion: null })];
    S.todos = [];
    document.body.innerHTML = '<div id="meeting-list"></div><input id="meeting-search"><span id="meeting-count"></span>';
    (window as any).renderMeetingsTab();
    const rows = document.querySelectorAll('#meeting-list .meeting-row');
    expect(rows[0].querySelector('.row-excerpt')?.textContent).toBe('Invoice monthly from October.');
    expect(rows[0].textContent).not.toMatch(/\bNotes\b/);
    expect(rows[1].querySelector('.row-excerpt')).toBeNull();
  });
});
