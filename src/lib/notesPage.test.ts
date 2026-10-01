// Notes: what kind of note it is, and the excerpt a list row shows.
import { describe, expect, it } from 'vitest';

import { noteExcerpt, noteKind } from './notesPage';

describe('what kind of note', () => {
  it('a meeting\'s note first, then a client\'s, else a note', () => {
    const meetings = new Set([3]);
    expect(noteKind({ id: 3, clientName: 'Sample Client' }, meetings)).toBe('Meeting note');
    expect(noteKind({ id: 2, clientName: 'Sample Client' }, meetings)).toBe('Client note');
    expect(noteKind({ id: 1, clientName: null }, meetings)).toBe('Note');
    expect(noteKind({ id: 1, clientName: '  ' }, meetings)).toBe('Note');
  });
});

describe('the excerpt in the list', () => {
  it('does not repeat the title the note opens with', () => {
    expect(noteExcerpt('# Payroll Requirements\n\nPayroll cycle requirements gathered from finance.', 'Payroll Requirements')).toBe('Payroll cycle requirements gathered from finance.');
    expect(noteExcerpt('Payroll cycle requirements.', 'Payroll Requirements')).toBe('Payroll cycle requirements.');
  });
  it('reads as plain words: no list marks, checkboxes, promise marks, links or emphasis', () => {
    expect(noteExcerpt('## To do\n- [x] Collect **headcount**\n- [ ] Confirm [GOSI](https://example.com)\n- >> Revised quote\nSee [[Kickoff]]', 'Other')).toBe('To do Collect headcount Confirm GOSI Revised quote See Kickoff');
  });
  it('is cut at 160 characters; nothing gives nothing', () => {
    expect(noteExcerpt('word '.repeat(60), 'T')).toHaveLength(160);
    expect(noteExcerpt(null, 'T')).toBe('');
    expect(noteExcerpt('# T', 'T')).toBe('');
  });
});
