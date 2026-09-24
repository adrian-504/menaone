import { describe, expect, it } from 'vitest';
import { normalizeCompanyKey, taskCompanyKey, todayRailCounts } from './taskRail';

const TODAY = '2026-09-24';
const companies = [{ id: 7, name: 'Acme Holdings' }, { id: 9, name: 'Northwind Trading' }];

describe('Tasks rail: Today', () => {
  it('overdue and due-today come from the same list, so the count is never negative', () => {
    const list = [{ dueDate: '2026-09-20' }, { dueDate: '2026-09-23' }, { dueDate: TODAY }];
    expect(todayRailCounts(list, TODAY)).toEqual({ overdue: 2, dueToday: 1 });
    // Only overdue tasks: the count is 0 beside the badge, not "-1".
    expect(todayRailCounts([{ dueDate: '2026-09-01' }], TODAY)).toEqual({ overdue: 1, dueToday: 0 });
    expect(todayRailCounts([], TODAY)).toEqual({ overdue: 0, dueToday: 0 });
  });
});

describe('Tasks rail: one entry per client', () => {
  it('a task with the company id and one with only its name share a key', () => {
    expect(taskCompanyKey({ client: 'Acme Holdings', companyId: 7 }, companies)).toBe('id:7');
    expect(taskCompanyKey({ client: 'Acme Holdings', companyId: null }, companies)).toBe('id:7');
    expect(taskCompanyKey({ client: 'acme holdings ', companyId: null }, companies)).toBe('id:7');
  });

  it('a name with no company stays a name; no client is no key', () => {
    expect(taskCompanyKey({ client: 'Globex', companyId: null }, companies)).toBe('name:Globex');
    expect(taskCompanyKey({ client: null, companyId: null }, companies)).toBeNull();
  });

  it('a list saved by name opens the company entry', () => {
    expect(normalizeCompanyKey('name:Acme Holdings', companies)).toBe('id:7');
    expect(normalizeCompanyKey('name:Globex', companies)).toBe('name:Globex');
    expect(normalizeCompanyKey('id:9', companies)).toBe('id:9');
  });
});
