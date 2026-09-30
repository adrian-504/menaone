// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { statusLines } from './settingsData';
import type { HousekeepingStatus } from '../lib/types';

const status = (over: Partial<HousekeepingStatus> = {}): HousekeepingStatus => ({
  dailyLast: null, onedriveLast: null, onedriveKept: 14, onedriveError: null, integrity: null, installBackups: 62, installBackupsTidy: null, ...over,
}) as HousekeepingStatus;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

describe('Settings → Data status lines', () => {
  afterEach(() => vi.useRealTimers());

  it('a full timestamp shows its time', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
    const [backup, check] = statusLines(status({ onedriveLast: '2026-09-30T09:04:00Z', integrity: { at: '2026-09-30T09:03:00Z', ok: true, detail: null } }));
    expect(backup.text).toContain(`OneDrive copy today ${hhmm('2026-09-30T09:04:00Z')} (14 kept)`);
    expect(check.text).toBe(`Database check: ok · today ${hhmm('2026-09-30T09:03:00Z')}`);
  });

  it('a date alone (written by 1.50) shows the day and no made-up time', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 30, 14, 0));
    const [backup, check] = statusLines(status({ onedriveLast: '2026-09-30', integrity: { at: '2026-09-29', ok: true, detail: null } }));
    expect(backup.text).toContain('OneDrive copy today (14 kept)');
    expect(check.text).toBe('Database check: ok · yesterday');
    expect(`${backup.text} ${check.text}`).not.toMatch(/\d{2}:\d{2}/);
  });
});
