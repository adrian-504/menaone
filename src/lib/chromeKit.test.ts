// @vitest-environment jsdom
// Menus, toasts and confirmations: order, the stack and its countdown, what a delete also removes.
import { describe, expect, it } from 'vitest';

import { UNDO_MS, agreementCascade, countdownLeft, isDestructive, meetingCascade, orderMenu, proposalCascade, stackAfterAdd, toastParts } from './chromeKit';

const sep = { label: '', separator: true };
const it_ = (label: string, over: Record<string, unknown> = {}) => ({ label, ...over });

describe('a menu\'s order', () => {
  it('the header first, the groups as given, what destroys last after a divider', () => {
    const out = orderMenu([it_('Delete', { danger: true }), it_('Open'), sep, it_('Duplicate'), it_('Sample', { head: true }), sep, it_('Mark lost', { danger: true })], sep);
    expect(out.map((i) => ('separator' in i && i.separator ? '—' : i.label))).toEqual(['Sample', 'Open', '—', 'Duplicate', '—', 'Delete', 'Mark lost']);
  });
  it('never two dividers in a row, none at either end', () => {
    expect(orderMenu([sep, it_('A'), sep, sep, it_('B'), sep], sep).map((i) => ('separator' in i && i.separator ? '—' : i.label))).toEqual(['A', '—', 'B']);
    expect(orderMenu([it_('Delete', { danger: true })], sep).map((i) => i.label)).toEqual(['Delete']);
  });
});

describe('undo toasts', () => {
  it('one message becomes a title and what it was about', () => {
    expect(toastParts('Kept: Send the revised quote')).toEqual({ title: 'Kept', meta: 'Send the revised quote' });
    expect(toastParts('Deleted proposal SL# 2')).toEqual({ title: 'Deleted proposal SL# 2', meta: '' });
    expect(toastParts('Followed up', 'Sample Client — Payroll · email')).toEqual({ title: 'Followed up', meta: 'Sample Client — Payroll · email' });
  });
  it('the stack holds three; the oldest leaves first', () => {
    expect(stackAfterAdd([1, 2], 3)).toEqual({ keep: [1, 2, 3], drop: [] });
    expect(stackAfterAdd([1, 2, 3], 4)).toEqual({ keep: [2, 3, 4], drop: [1] });
    expect(stackAfterAdd([], 1)).toEqual({ keep: [1], drop: [] });
  });
  it('the countdown runs from full to nothing over seven seconds', () => {
    expect(UNDO_MS).toBe(7000);
    expect([countdownLeft(1000, 1000), countdownLeft(1000, 4500), countdownLeft(1000, 8000), countdownLeft(1000, 9000), countdownLeft(1000, 500)]).toEqual([1, 0.5, 0, 0, 1]);
  });
});

describe('confirmations', () => {
  it('only what destroys is red', () => {
    expect(['Delete', 'Remove', 'Discard', 'Disconnect', 'delete 3 tasks'].map(isDestructive)).toEqual([true, true, true, true, true]);
    expect(['Archive', 'Move', 'Sort all', 'Rename', 'Confirm', '', undefined].map(isDestructive)).toEqual([false, false, false, false, false, false, false]);
  });
  it('a proposal: its revisions and deck records go, the files never; its agreement stays', () => {
    const c = proposalCascade({ id: 2, client: 'Sample Client', type: 'Recruitment', revisions: [{}, {}] as never, documents: [{}] as never, notes: [] }, { agreementRef: 'SC_ADM_001' });
    expect(c).toEqual({
      named: 'Recruitment for Sample Client, SL# 2',
      also: ['2 revisions and 1 generated deck record (the file stays in OneDrive)', "its place in Sample Client's timeline"],
      stays: ['Its agreement SC_ADM_001 stays, without the link.'],
    });
    expect(proposalCascade({ id: 9, client: 'Sample Client', type: null, revisions: [], documents: [], notes: [] }).also).toEqual(["its place in Sample Client's timeline"]);
    expect(proposalCascade({ id: 9, client: 'Acme Holdings', type: null, revisions: [], documents: [], notes: [] }).also).toEqual(["its place in Acme Holdings' timeline"]);
  });
  it('an agreement: its lines; and the warning when its proposal is still signed', () => {
    const c = agreementCascade({ agrRef: 'SC_ADM_001', client: 'Sample Client', lines: [{}, {}, {}] as never, proposalId: 2 }, { proposalStillSigned: true, renewals: 1 });
    expect(c.named).toBe('SC_ADM_001 for Sample Client');
    expect(c.also).toEqual(['3 service lines', "its place in Sample Client's timeline"]);
    expect(c.stays).toHaveLength(2);
    expect(agreementCascade({ agrRef: null, client: null, lines: [], proposalId: null })).toEqual({ named: 'Agreement for this client', also: [], stays: [] });
  });
  it('a meeting: what was written in it', () => {
    expect(meetingCascade({ title: 'Renewal call', agenda: 'x', discussion: 'y', decisions: 'z', followUp: null }).also).toEqual(['its agenda, discussion and decisions']);
    expect(meetingCascade({ title: 'Empty', agenda: null, discussion: null, decisions: null, followUp: null }).also).toEqual([]);
  });
});
