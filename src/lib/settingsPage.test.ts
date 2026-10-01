// @vitest-environment jsdom
// Settings: the line under the title and what each pane says in the navigation.
import { describe, expect, it } from 'vitest';

import { PANES, settingsNavHints, settingsSubtitle } from './settingsPage';

const now = new Date(2026, 9, 1, 14, 5);
const secs = (d: Date) => Math.round(d.getTime() / 1000);
const base = { tint: 'blue' as const, teamCount: 2, signatureEmpty: false, outlookConnected: true, dailyBackupAt: secs(new Date(2026, 9, 1, 8, 30)), now };

describe('settings', () => {
  it('the subtitle says the version without its patch number', () => {
    expect(settingsSubtitle('1.63.0')).toBe('MENA One 1.63 · your preferences on this Mac.');
    expect(settingsSubtitle('')).toBe('MENA One · your preferences on this Mac.');
  });
  it('every pane has a title, a one-line description and an icon', () => {
    expect(PANES.map((p) => p.key)).toEqual(['general', 'appearance', 'team', 'business', 'templates', 'connections', 'data']);
    for (const p of PANES) expect(p.title && p.description.endsWith('.') && p.icon && p.tint).toBeTruthy();
  });
  it('the navigation says the tint, the team, Outlook and the last backup', () => {
    expect(settingsNavHints(base)).toEqual({ appearance: { text: 'Blue' }, team: { text: '2' }, connections: { text: 'Outlook', dot: 'green' }, data: { text: 'backed up 08:30' } });
  });
  it('a signature still to write is said in amber; Outlook not connected is a grey dot; an older backup says its day', () => {
    const h = settingsNavHints({ ...base, tint: 'grey', signatureEmpty: true, outlookConnected: false, dailyBackupAt: secs(new Date(2026, 8, 28, 23, 0)) });
    expect(h).toMatchObject({ appearance: { text: 'Grey' }, templates: { text: 'signature', tone: 'amber' }, connections: { dot: 'grey' }, data: { text: 'backed up 28 Sept' } });
  });
  it('what is not known is not said', () => {
    expect(settingsNavHints({ ...base, teamCount: 0, signatureEmpty: null, outlookConnected: null, dailyBackupAt: null })).toEqual({ appearance: { text: 'Blue' } });
  });
});
