import { describe, it, expect } from 'vitest';
import changelogMd from '../../CHANGELOG.md?raw';
import packageJson from '../../package.json?raw';
import { parseChangelog, shortVersion, versionLine } from './changelog';
import { checkRelease } from '../../scripts/release-check.mjs';
import { buildAttention, type MyDayInput } from './myday';

const MD = `# MENA One — changes

Intro line that is not an entry.

## 1.50 — 2026-09-30
First line.
Second line.

## 1.49 — 2026-09-29
One line.
`;

describe('the changelog', () => {
  it('reads each entry: version, date and its lines, newest first', () => {
    expect(parseChangelog(MD)).toEqual([
      { version: '1.50', date: '2026-09-30', lines: ['First line.', 'Second line.'] },
      { version: '1.49', date: '2026-09-29', lines: ['One line.'] },
    ]);
  });

  it('the version line says when it was installed', () => {
    expect(shortVersion('1.50.0')).toBe('1.50');
    expect(versionLine('1.50.0', parseChangelog(MD))).toBe('MENA One 1.50 · installed 30 Sept 2026');
    expect(versionLine('1.51.0', parseChangelog(MD))).toBe('MENA One 1.51');
  });

  it('the real changelog has an entry for the real version, two lines at most each', () => {
    const version = shortVersion(JSON.parse(packageJson).version);
    const entries = parseChangelog(changelogMd);
    expect(entries[0].version).toBe(version);
    expect(entries.every((e) => e.lines.length >= 1 && e.lines.length <= 2)).toBe(true);
  });
});

describe('the release check', () => {
  it('passes when the versions agree and the changelog has the entry', () => {
    expect(checkRelease({ packageVersion: '1.50.0', confVersion: '1.50.0', changelog: MD })).toEqual([]);
  });
  it('fails when package.json and tauri.conf.json differ', () => {
    expect(checkRelease({ packageVersion: '1.50.0', confVersion: '1.49.0', changelog: MD })).toEqual(['Versions differ: package.json 1.50.0, tauri.conf.json 1.49.0.']);
  });
  it('fails when the changelog has no entry for the version', () => {
    expect(checkRelease({ packageVersion: '1.51.0', confVersion: '1.51.0', changelog: MD })).toEqual(['CHANGELOG.md has no entry "## 1.51 — YYYY-MM-DD".']);
  });
});

describe('My Day and the database check', () => {
  const input = (over: Partial<MyDayInput>): MyDayInput => ({
    today: '2026-09-30', now: new Date('2026-09-30T11:00:00'), proposals: [], opportunities: [], pipelineFacts: [], agreements: [], meetings: [],
    todos: [], projects: [], emails: [], inboxCount: 0, reviewerName: () => 'Reviewer', ownDomains: new Set(), snoozed: {}, ...over,
  });
  it('a failed check is one red row on top; a good one adds nothing', () => {
    const rows = buildAttention(input({ integrityFailed: true, inboxCount: 2 }));
    expect(rows[0]).toMatchObject({ key: 'db:integrity', tone: 'red', title: 'Database check failed — back up and tell Ahmad' });
    expect(buildAttention(input({ integrityFailed: false })).some((r) => r.key === 'db:integrity')).toBe(false);
  });
});
