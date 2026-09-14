import { describe, it, expect } from 'vitest';
import { parseTaskInput, friendlyDate } from './taskParse';

// Sunday 13 September 2026.
const ctx = {
  today: new Date(2026, 8, 13),
  projects: [{ id: 4, name: 'Saudization Advisory' }, { id: 5, name: 'Website Refresh' }],
  companies: [{ id: 1, name: 'Globex' }, { id: 2, name: 'Acme Test Co' }, { id: 3, name: 'AB' }],
};

describe('task quick add', () => {
  it('reads the example from the plan', () => {
    const t = parseTaskInput('Call Globex tomorrow 3pm #Saudization !high', ctx);
    expect(t.title).toBe('Call Globex');
    expect(t.dueDate).toBe('2026-09-14');
    expect(t.dueTime).toBe('15:00');
    expect(t.projectId).toBe(4);
    expect(t.priority).toBe('High');
    expect(t.companyName).toBe('Globex');
    expect(t.tokens.map((k) => k.kind).sort()).toEqual(['company', 'date', 'priority', 'project', 'time']);
  });

  it('understands the usual ways of writing a date', () => {
    const due = (s: string) => parseTaskInput(`Send pack ${s}`, ctx).dueDate;
    expect(due('today')).toBe('2026-09-13');
    expect(due('fri')).toBe('2026-09-18');
    expect(due('next monday')).toBe('2026-09-21');
    expect(due('next week')).toBe('2026-09-14');
    expect(due('in 3 days')).toBe('2026-09-16');
    expect(due('15 sep')).toBe('2026-09-15');
    expect(due('sep 20')).toBe('2026-09-20');
    expect(due('1/9')).toBe('2027-09-01'); // already passed this year
    expect(due('2026-12-31')).toBe('2026-12-31');
    expect(parseTaskInput('Send pack', ctx).dueDate).toBeNull();
  });

  it('handles times, someday, repeats, tags and explicit companies', () => {
    expect(parseTaskInput('Standup at 9', ctx)).toMatchObject({ dueTime: '09:00', dueDate: '2026-09-13', title: 'Standup' });
    expect(parseTaskInput('Review 14:30 fri', ctx)).toMatchObject({ dueTime: '14:30', dueDate: '2026-09-18' });
    expect(parseTaskInput('Learn Arabic someday', ctx)).toMatchObject({ someday: true, dueDate: null, title: 'Learn Arabic' });
    expect(parseTaskInput('Payroll check every month', ctx)).toMatchObject({ recurrence: 'monthly', title: 'Payroll check' });
    expect(parseTaskInput('Draft post #marketing !l', ctx)).toMatchObject({ tags: ['marketing'], priority: 'Low', projectId: null });
    expect(parseTaskInput('Renewal pack @"Acme Test Co"', ctx)).toMatchObject({ companyName: 'Acme Test Co', title: 'Renewal pack' });
  });

  it('matches company names only as whole words, and respects dismissed tokens', () => {
    expect(parseTaskInput('Update the ABC deck', ctx).companyName).toBeNull();
    expect(parseTaskInput('Abstract for Acme Test Co renewal', ctx).companyName).toBe('Acme Test Co');
    const t = parseTaskInput('Call Globex tomorrow', ctx, new Set(['tomorrow', 'globex']));
    expect(t).toMatchObject({ dueDate: null, companyName: null, title: 'Call Globex tomorrow' });
  });

  it('describes dates in friendly terms', () => {
    expect(friendlyDate('2026-09-13', ctx.today)).toBe('Today');
    expect(friendlyDate('2026-09-14', ctx.today)).toBe('Tomorrow');
    expect(friendlyDate('2026-09-16', ctx.today)).toBe('Wed');
    expect(friendlyDate('2026-10-02', ctx.today)).toBe('2 Oct');
    expect(friendlyDate('2027-01-05', ctx.today)).toBe('5 Jan 2027');
  });
});
