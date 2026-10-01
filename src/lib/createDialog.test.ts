// @vitest-environment jsdom
// The create dialogs: the shell's header and hints, "create and add another", and a task's typed line.
import { describe, expect, it } from 'vitest';

import { CREATE_KINDS, carryOver, dialogHead, dialogHints, highlightSegments, prefillFromParse, understoodChips } from './createDialog';
import { parseTaskInput } from './taskParse';

const ctx = { today: new Date(2026, 8, 30), projects: [{ id: 7, name: 'Retainer Delivery' }], companies: [{ id: 1, name: 'Sample Client' }] };

describe('the shell', () => {
  it('one for every kind that has a dialog; the proposal keeps its builder', () => {
    expect(CREATE_KINDS.map((k) => k.kind)).toEqual(['Task', 'Meeting', 'Promise', 'Company', 'Contact', 'Opportunity', 'Agreement', 'Project']);
    expect(new Set(CREATE_KINDS.map((k) => k.modal)).size).toBe(CREATE_KINDS.length);
  });
  it('the header reads the eyebrow and the kind from the title an opener wrote', () => {
    expect(dialogHead('New task', 'Task')).toEqual({ eyebrow: 'New', title: 'Task' });
    expect(dialogHead('New commitment', 'Promise')).toEqual({ eyebrow: 'New', title: 'Promise' });
    expect(dialogHead('Edit meeting', 'Meeting')).toEqual({ eyebrow: 'Edit', title: 'Meeting' });
    expect(dialogHead('New subtask of “Prepare the report”', 'Task')).toEqual({ eyebrow: 'New', title: 'Subtask of “Prepare the report”' });
    expect(dialogHead('Reassign', 'Task')).toEqual({ eyebrow: '', title: 'Reassign' });
    expect(dialogHead('', 'Task')).toEqual({ eyebrow: '', title: 'Task' });
  });
  it('the hints offer "add another" only when creating', () => {
    expect(dialogHints(false)).toBe('⌘↵ create · ⌘⇧↵ create and add another · Esc cancel');
    expect(dialogHints(true)).toBe('⌘↵ save · Esc cancel');
  });
});

describe('create and add another', () => {
  const task = CREATE_KINDS[0];
  it('keeps the client and the project; the title, the date and the rest start empty', () => {
    const before = { todoTitle: 'Send the quote', todoClient: 'Sample Client', todoProject: '7', todoDue: '2026-10-02', todoKind: 'task', todoPriority: 'High' };
    expect(carryOver(before, task)).toEqual({ todoClient: 'Sample Client', todoProject: '7', todoKind: 'task' });
  });
  it('a kept field left empty is not carried', () => {
    expect(carryOver({ todoClient: '', todoProject: '7' }, task)).toEqual({ todoProject: '7' });
    expect(carryOver({ companyName: 'X' }, CREATE_KINDS[3])).toEqual({});
  });
});

describe('a task\'s typed line', () => {
  const line = 'Send Sample Client the revised quote Friday 3pm !high #payroll';
  const parsed = parseTaskInput(line, ctx);
  it('the highlight covers every character once, in order', () => {
    const segs = highlightSegments(line, parsed.ranges);
    expect(segs.map((s) => s.text).join('')).toBe(line);
    expect(segs.filter((s) => s.kind).map((s) => [s.text, s.kind])).toEqual([['Sample Client', 'company'], ['Friday', 'date'], ['3pm', 'time'], ['!high', 'priority'], ['#payroll', 'tag']]);
  });
  it('a line with nothing to understand is one plain segment; overlapping or stray ranges are dropped', () => {
    expect(highlightSegments('Call the bank', [])).toEqual([{ text: 'Call the bank', kind: null }]);
    expect(highlightSegments('abcdef', [{ start: 1, end: 3, kind: 'tag' }, { start: 2, end: 4, kind: 'date' }, { start: 5, end: 9, kind: 'time' }]).map((s) => [s.text, s.kind]))
      .toEqual([['a', null], ['bc', 'tag'], ['def', null]]);
    expect(highlightSegments('', [])).toEqual([]);
  });
  it('"Understood as": the day and time, the client, the priority, the tags', () => {
    expect(understoodChips(parsed).map((c) => [c.kind, c.label, c.tone])).toEqual([['due', 'Fri 2 Oct · 15:00', 'amber'], ['company', 'Sample Client', 'blue'], ['priority', 'High', 'red'], ['tag', '# payroll', 'grey']]);
    expect(understoodChips(parseTaskInput('Call the bank', ctx))).toEqual([]);
    expect(understoodChips(parseTaskInput('Review every monday someday', ctx)).map((c) => c.kind)).toContain('someday');
  });
  it('the line fills the field tiles, leaves alone what was edited by hand, and empties what it no longer says', () => {
    const first = prefillFromParse(parsed, new Set(), new Set());
    expect(first.set).toEqual({ todoDue: '2026-10-02', todoClient: 'Sample Client', todoPriority: 'High' });
    expect([...first.filled].sort()).toEqual(['todoClient', 'todoDue', 'todoPriority']);
    // The client was changed by hand: the line no longer touches it.
    expect(prefillFromParse(parsed, new Set(['todoClient']), first.filled).set).toEqual({ todoDue: '2026-10-02', todoPriority: 'High' });
    // The date was deleted from the line: the field it had filled is emptied; the priority goes back to Medium.
    const later = prefillFromParse(parseTaskInput('Send Sample Client the revised quote', ctx), new Set(), first.filled);
    expect(later.set).toEqual({ todoDue: '', todoClient: 'Sample Client', todoPriority: 'Medium' });
  });
});
