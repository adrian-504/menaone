// Settings in the app's look (1.63 "chrome"): the panes with their icon tiles
// and one-line descriptions, the line under the title, and the small status
// each pane shows in the navigation — the tint in use, how many are on the
// team, a signature still to write, whether Outlook is connected, when the
// last backup was made. Pure: tabs/settings.ts draws it.

import { fmtDateShort } from './dates';

export type SettingsPane = 'general' | 'appearance' | 'team' | 'business' | 'templates' | 'connections' | 'data';

export interface PaneInfo { key: SettingsPane; title: string; description: string; icon: string; tint: string }

export const PANES: PaneInfo[] = [
  { key: 'general', title: 'General', description: 'Reminders and the extras on My Day.', icon: 'gear', tint: 'var(--blue)' },
  { key: 'appearance', title: 'Appearance', description: 'The tint, the theme, the sidebar and the photo on My Day.', icon: 'sun', tint: 'var(--coral-text)' },
  { key: 'team', title: 'Team', description: 'Who owns proposals, reviews them and prepares agreements.', icon: 'people', tint: 'var(--green)' },
  { key: 'business', title: 'Business', description: 'The MENA BIG entities, their currencies and where proposals live.', icon: 'dollar', tint: 'var(--amber)' },
  { key: 'templates', title: 'Templates', description: 'The emails offered on every company page, and your signature.', icon: 'mail', tint: 'var(--blue)' },
  { key: 'connections', title: 'Connections', description: 'Microsoft 365 and your OneDrive folders.', icon: 'link', tint: 'var(--sub)' },
  { key: 'data', title: 'Data', description: 'The version, the backups and the database check.', icon: 'archive', tint: 'var(--sub)' },
];

/** "MENA One 1.63 · your preferences on this Mac.": the version without its patch number. Pure. */
export function settingsSubtitle(version: string): string {
  const short = version.split('.').slice(0, 2).join('.');
  return `MENA One${short ? ` ${short}` : ''} · your preferences on this Mac.`;
}

export interface NavHint { text: string; tone?: 'amber'; dot?: 'green' | 'grey' }

export interface NavHintInput {
  tint: 'blue' | 'grey';
  /** Active team members. */
  teamCount: number;
  /** True when no signature is written yet; null while it is not known. */
  signatureEmpty: boolean | null;
  /** Microsoft 365: connected or not; null while it is not known. */
  outlookConnected: boolean | null;
  /** When the last daily backup was made (Unix seconds), or null. */
  dailyBackupAt: number | null;
  now: Date;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** What each pane says beside its name. A pane with nothing to say has no entry. Pure. */
export function settingsNavHints(i: NavHintInput): Partial<Record<SettingsPane, NavHint>> {
  const out: Partial<Record<SettingsPane, NavHint>> = { appearance: { text: i.tint === 'grey' ? 'Grey' : 'Blue' } };
  if (i.teamCount > 0) out.team = { text: String(i.teamCount) };
  if (i.signatureEmpty) out.templates = { text: 'signature', tone: 'amber' };
  if (i.outlookConnected != null) out.connections = { text: 'Outlook', dot: i.outlookConnected ? 'green' : 'grey' };
  if (i.dailyBackupAt) {
    const at = new Date(i.dailyBackupAt * 1000);
    out.data = { text: `backed up ${isoDay(at) === isoDay(i.now) ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : fmtDateShort(isoDay(at), true)}` };
  }
  return out;
}
