// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { backoffMinutes, isOfflineError, noteSync } from './offline';
import { S } from './state';

afterEach(() => vi.useRealTimers());

describe('offline awareness (Outlook)', () => {
  it('tells offline from a real error', () => {
    expect(isOfflineError('Could not reach Microsoft Graph: error sending request for url')).toBe(true);
    expect(isOfflineError(new Error('Could not reach Microsoft sign-in servers: dns error: failed to lookup address'))).toBe(true);
    expect(isOfflineError('operation timed out')).toBe(true);
    expect(isOfflineError('Microsoft Graph returned 403: Access is denied')).toBe(false);
    expect(isOfflineError('MS365_UNAUTHORIZED')).toBe(false);
  });

  it('tries again after 1, 2, then every 5 minutes', () => {
    expect([0, 1, 2, 3, 9].map(backoffMinutes)).toEqual([1, 2, 5, 5, 5]);
  });

  it('offline: a quiet state and a retry; the next success clears it', async () => {
    vi.useFakeTimers();
    S.ms365Offline = false;
    const retry = vi.fn(async () => undefined);
    expect(noteSync('calendar', 'Could not reach Microsoft Graph: timeout', retry)).toBe(true);
    expect(S.ms365Offline).toBe(true);
    vi.advanceTimersByTime(59_000);
    expect(retry).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(retry).toHaveBeenCalledOnce();
    expect(noteSync('calendar', null, retry)).toBe(false);
    expect(S.ms365Offline).toBe(false);
  });

  it('a real error is left to the caller', () => {
    S.ms365Offline = false;
    expect(noteSync('flagged', 'Microsoft Graph returned 403', async () => undefined)).toBe(false);
    expect(S.ms365Offline).toBe(false);
  });
});
