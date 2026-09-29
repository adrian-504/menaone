import { describe, it, expect } from 'vitest';
import { clientFolder, clientNotesList, clientsWithNotes, parseClientFolder, type CompanyEntry } from './clientNotes';
import type { Meeting, Note } from './types';

const note = (id: number, over: Partial<Note>): Note => ({ id, title: `Note ${id}`, content: '', folder: null, clientName: null, companyId: null, tags: [], pinned: false, createdAt: '2026-09-01', updatedAt: '2026-09-01', ...over } as unknown as Note);
const entry = (id: number, over: Partial<CompanyEntry>): CompanyEntry => ({ id, companyId: 1, companyName: 'Contoso Test', body: 'Entry', createdAt: '2026-09-01T09:00:00Z', updatedAt: null, ...over });
const meeting = (id: number, over: Partial<Meeting>): Meeting => ({ id, title: `Meeting ${id}`, meetingDate: '2026-09-01', startAt: null, companyId: 1, companyName: 'Contoso Test', isCancelled: false, agenda: null, discussion: null, decisions: null, followUp: null, actionItems: null, ...over } as Meeting);
const companies = [{ id: 1, name: 'Contoso Test' }, { id: 2, name: 'Globex Test' }];
const KEY = { id: 1, name: 'Contoso Test' };

describe('one client\'s notes from every source', () => {
  const notes = [note(1, { title: 'Kickoff notes', content: '# Plan\n- Payroll from **October**', companyId: 1, clientName: 'Contoso Test', updatedAt: '2026-09-20' }), note(2, { companyId: 2, clientName: 'Globex Test', updatedAt: '2026-09-25' }), note(3, { title: 'Old', clientName: 'Contoso Test', updatedAt: '2026-08-01' })];
  const entries = [entry(10, { body: 'Finance signs off above SAR 50k\nallow an extra week', createdAt: '2026-09-22T08:00:00Z', pinned: true }), entry(11, { companyId: 2, companyName: 'Globex Test' })];
  const meetings = [meeting(20, { title: 'Monthly check-in', meetingDate: '2026-09-15', decisions: 'Price on three people.' }), meeting(21, { meetingDate: '2026-09-28' }), meeting(22, { companyId: 2, decisions: 'Other.' })];

  it('merges notes, company page notes and meetings with notes, newest first, each saying where it lives', () => {
    const rows = clientNotesList(KEY, notes, entries, meetings);
    expect(rows.map((r) => [r.source, r.id, r.date])).toEqual([['company', 10, '2026-09-22'], ['note', 1, '2026-09-20'], ['meeting', 20, '2026-09-15'], ['note', 3, '2026-08-01']]);
    expect(rows[0]).toMatchObject({ title: 'Finance signs off above SAR 50k', excerpt: 'allow an extra week', pinned: true });
    expect(rows[1]).toMatchObject({ title: 'Kickoff notes', excerpt: 'Plan Payroll from October' });
    expect(rows[2]).toMatchObject({ title: 'Monthly check-in', excerpt: 'Price on three people.' });
  });

  it('search matches the title or the text, every word', () => {
    expect(clientNotesList(KEY, notes, entries, meetings, 'payroll').map((r) => r.id)).toEqual([1]);
    expect(clientNotesList(KEY, notes, entries, meetings, 'extra week').map((r) => r.id)).toEqual([10]);
    expect(clientNotesList(KEY, notes, entries, meetings, 'price three').map((r) => r.id)).toEqual([20]);
  });

  it('lists the companies with notes, most recent first, one entry per company even when kept by name', () => {
    expect(clientsWithNotes(notes, entries, meetings, companies)).toEqual([
      { key: { id: 2, name: 'Globex Test' }, count: 3, latest: '2026-09-25' },
      { key: { id: 1, name: 'Contoso Test' }, count: 4, latest: '2026-09-22' },
    ]);
    expect(clientsWithNotes([], [], [], companies)).toEqual([]);
  });

  it('folder values round-trip', () => {
    expect(parseClientFolder(clientFolder(KEY), companies)).toEqual(KEY);
    expect(parseClientFolder(clientFolder({ id: null, name: 'Loose Co' }), companies)).toEqual({ id: null, name: 'Loose Co' });
    expect(parseClientFolder('all', companies)).toBeNull();
  });
});
