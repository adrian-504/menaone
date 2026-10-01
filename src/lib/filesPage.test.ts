// @vitest-environment jsdom
// Files: matched and unmatched client folders, the banner as progress, covers by type.
import { describe, expect, it } from 'vitest';

import { classifyFolders, clientPlaces, companyForPath, coverKind, extBadge, folderLine, matchProgress } from './filesPage';

const R = '/od/Proposals';
const folder = (name: string, over: Record<string, unknown> = {}) => ({ path: `${R}/${name}`, name, isFolder: true, fileCount: 3, folderCount: 0, modifiedAt: '2026-09-22T10:00:00Z', ...over });
const link = (name: string, company: string, over: Record<string, unknown> = {}) => ({ path: `${R}/${name}`, linkedToType: 'company' as const, linkedToName: company, isFolder: true, exists: true, ...over });

describe('matched and unmatched folders', () => {
  const items = [folder('Sample Client'), folder('Another Co'), folder('Old pitches'), { path: `${R}/Readme.txt`, name: 'Readme.txt', isFolder: false, modifiedAt: null }];
  const linked = [link('Sample Client', 'Sample Client Ltd'), link('Another Co', 'A project', { linkedToType: 'project' as const }), { ...link('Sample Client/Deck.pptx', 'Sample Client Ltd'), isFolder: false }];
  it('a folder is matched when it is itself linked to a company; files are not folders', () => {
    expect(classifyFolders(items, linked).map((f) => [f.name, f.company])).toEqual([['Sample Client', 'Sample Client Ltd'], ['Another Co', null], ['Old pitches', null]]);
  });
  it('the banner says how far the matching got, and offers the rest', () => {
    const p = matchProgress(classifyFolders(items, linked))!;
    expect(p).toMatchObject({ matched: 1, total: 3, left: 2, headline: '1 of 3 client folders is matched to a company', action: 'Match 2 folders' });
    expect(p.body).toBe("Folders under Proposals become the company's files automatically. 2 still need a match.");
    const five = matchProgress([{ company: 'a' }, { company: 'b' }, { company: 'c' }, { company: 'd' }, { company: 'e' }, { company: null }, { company: null }])!;
    expect([five.headline, five.action]).toEqual(['5 of 7 client folders are matched to companies', 'Match 2 folders']);
    expect(matchProgress([{ company: 'a' }, { company: null }])!.body).toContain('1 still needs a match.');
  });
  it('says nothing when all are matched, or there are none', () => {
    expect(matchProgress([{ company: 'a' }, { company: 'b' }])).toBeNull();
    expect(matchProgress([])).toBeNull();
  });
});

describe('what a folder and a file say', () => {
  const T = '2026-10-01';
  it('how much is in a folder and when it last changed', () => {
    expect(folderLine({ fileCount: 9, folderCount: 1, modifiedAt: '2026-10-01T08:00:00Z' }, T)).toBe('9 files · today');
    expect(folderLine({ fileCount: 1, folderCount: 0, modifiedAt: '2026-09-27T08:00:00Z' }, T)).toBe('1 file · 27 Sept');
    expect(folderLine({ fileCount: 0, folderCount: 2, modifiedAt: '2026-09-30T08:00:00Z' }, T)).toBe('2 folders · yesterday');
    expect(folderLine({ fileCount: 0, folderCount: 0, modifiedAt: null }, T)).toBe('empty');
    expect(folderLine({ fileCount: null, folderCount: null, modifiedAt: '2025-03-02T08:00:00Z' }, T)).toBe('2 Mar 2025');
  });
  it('a file belongs to the company of the nearest matched folder above it', () => {
    const linked = [link('Sample Client', 'Sample Client Ltd'), link('Sample Client/Subsidiary', 'Subsidiary Co'), link('Other', 'A project', { linkedToType: 'project' as const })];
    expect(companyForPath(`${R}/Sample Client/Deck.pptx`, linked)).toBe('Sample Client Ltd');
    expect(companyForPath(`${R}/Sample Client/Subsidiary/Deck.pptx`, linked)).toBe('Subsidiary Co');
    expect(companyForPath(`${R}/Sample Client Two/Deck.pptx`, linked)).toBeNull();
    expect(companyForPath(`${R}/Other/Deck.pptx`, linked)).toBeNull();
  });
  it('covers by type, and the badge', () => {
    expect(['a.pptx', 'a.key', 'b.xlsx', 'b.csv', 'c.pdf', 'd.docx', 'd.txt', 'e.png', 'f.zip', 'noext'].map(coverKind)).toEqual(['deck', 'deck', 'sheet', 'sheet', 'pdf', 'doc', 'doc', 'image', 'file', 'file']);
    expect(['a.pptx', 'b.numbers', 'noext'].map(extBadge)).toEqual(['PPTX', 'NUMB', 'FILE']);
  });
  it('the rail lists each company with a matched folder once, with its file count when known', () => {
    const linked = [link('Sample Client', 'Sample Client Ltd'), link('Zed', 'Alpha Co'), link('Sample Client/Archive', 'Sample Client Ltd'), link('Gone', 'Gone Co', { exists: false }), { ...link('Zed/Deck.pptx', 'File Co'), isFolder: false }];
    expect(clientPlaces(linked, [{ path: `${R}/Sample Client`, fileCount: 9 }])).toEqual([{ company: 'Alpha Co', path: `${R}/Zed`, files: null }, { company: 'Sample Client Ltd', path: `${R}/Sample Client`, files: 9 }]);
  });
});
