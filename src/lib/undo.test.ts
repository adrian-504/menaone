// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = vi.hoisted(() => ({
  activityForget: vi.fn(async () => 0),
  upsertProposals: vi.fn(async () => []),
  deleteProposals: vi.fn(async () => undefined),
  upsertNotes: vi.fn(async () => []),
  deleteNotes: vi.fn(async () => undefined),
  addInboxItem: vi.fn(async (itemType: string, content: string) => ({ id: 99, itemType, content, createdAt: null, processed: false, convertedToType: null, convertedToId: null })),
  deleteInboxItem: vi.fn(async () => undefined),
}));
vi.mock('./db', async (orig) => ({ ...(await orig<typeof import('./db')>()), ...db }));

import { S } from './state';
import { undoToast, withUndo, pendingUndo } from './ui';
import { registerAppKeys } from '../core/appKeys';
import { startKeys } from '../core/keys';

// ⌘Z is a registered key (foundations O4).
registerAppKeys();
startKeys();
import { snapshotProposal, snoozeProposal } from '../core/proposals';
import { deleteNote } from '../tabs/notes';
import { dismissInboxItem } from '../tabs/inbox';
import type { Note, Proposal } from './types';

const flush = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => { document.body.innerHTML = ''; Object.values(db).forEach((f) => f.mockClear()); });
afterEach(() => vi.useRealTimers());

describe('the undo toast', () => {
  it('three at most, bottom-left, each gone after 7 s; the newest is what ⌘Z runs', () => {
    vi.useFakeTimers();
    const live = () => [...document.querySelectorAll('#undo-stack .toast-undo:not(.leaving) .toast-msg')].map((m) => m.textContent);
    const ran: string[] = [];
    for (const name of ['First', 'Second', 'Third']) undoToast(name, () => ran.push(name));
    expect(live()).toEqual(['First', 'Second', 'Third']);
    // A fourth: the oldest leaves.
    undoToast('Fourth', () => ran.push('Fourth'));
    expect(live()).toEqual(['Second', 'Third', 'Fourth']);
    pendingUndo()!();
    expect(ran).toEqual(['Fourth']);
    expect(live()).toEqual(['Second', 'Third']);
    vi.advanceTimersByTime(7000);
    expect(pendingUndo()).toBeNull();
    expect(live()).toEqual([]);
  });

  it('a message written "Title: what" is a title and a line; a detail given apart is the line', () => {
    undoToast('Kept: Send the revised quote', () => {});
    undoToast('Followed up', () => {}, 7000, undefined, { detail: 'Sample Client — Payroll · email', icon: 'flag' });
    const cards = [...document.querySelectorAll('#undo-stack .toast-undo:not(.leaving)')];
    expect(cards.map((c) => [c.querySelector('.toast-msg')?.textContent, c.querySelector('.toast-detail')?.textContent])).toEqual([['Kept', 'Send the revised quote'], ['Followed up', 'Sample Client — Payroll · email']]);
    expect(cards.map((c) => !!c.querySelector('.undo-tile.is-coral'))).toEqual([false, true]);
  });

  it('⌘Z runs the latest undo, but not while typing', () => {
    const undo = vi.fn();
    withUndo('Done', () => 1, undo);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    expect(undo).not.toHaveBeenCalled();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    expect(undo).toHaveBeenCalledOnce();
    expect(pendingUndo()).toBeNull();
  });
});

describe('undo pairs', () => {
  const proposal = (): Proposal => ({ id: 3, client: 'Northwind Test', status: 'In Internal Review', reviewStatus: 'approved', snoozedUntil: null, notes: [], lines: [] } as unknown as Proposal);

  it('a proposal change goes back exactly, and its timeline rows go after the save', async () => {
    const p = proposal();
    S.proposals = [p];
    const restore = snapshotProposal(p);
    p.status = 'Sent to Client';
    (p as any).dateSentToClient = '2026-09-30';
    restore();
    expect(S.proposals[0]).toMatchObject({ status: 'In Internal Review' });
    expect((S.proposals[0] as any).dateSentToClient).toBeUndefined();
    await flush(); await flush();
    expect(db.activityForget).toHaveBeenCalledWith('proposal', 3, expect.stringMatching(/^\d{4}-\d\d-\d\dT/));
  });

  it('snooze is undone', () => {
    S.proposals = [proposal()];
    snoozeProposal(3, 7);
    expect(S.proposals[0].snoozedUntil).toBeTruthy();
    pendingUndo()!();
    expect(S.proposals[0].snoozedUntil).toBeNull();
  });

  it('a deleted note comes back, and is only deleted from the database after the window', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="notes-list"></div>';
    const n = { id: 5, title: 'Kickoff', content: 'x', folder: '', tags: [], pinned: false } as unknown as Note;
    S.notes = [n];
    S.notesPendingDelete = [];
    await deleteNote(5);
    expect(S.notes).toEqual([]);
    expect(S.notesPendingDelete.map((x) => x.id)).toEqual([5]);
    pendingUndo()!();
    expect(S.notes.map((x) => x.id)).toEqual([5]);
    expect(S.notesPendingDelete).toEqual([]);
    await vi.advanceTimersByTimeAsync(8000);
    expect(db.deleteNotes).not.toHaveBeenCalled();
  });

  it('an Inbox item dismissed by mistake comes back', async () => {
    S.inboxItems = [{ id: 1, itemType: 'idea', content: 'Call Omar', createdAt: null, processed: false, convertedToType: null, convertedToId: null } as any];
    await dismissInboxItem(1);
    expect(S.inboxItems).toEqual([]);
    expect(db.deleteInboxItem).toHaveBeenCalledWith(1);
    pendingUndo()!();
    await flush();
    expect(db.addInboxItem).toHaveBeenCalledWith('idea', 'Call Omar');
    expect(S.inboxItems.map((i) => i.content)).toEqual(['Call Omar']);
  });
});
