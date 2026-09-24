// Counts and keys for the Tasks rail (src/tabs/todo.ts).

import type { Todo } from './types';

/** Today's two numbers, from the tasks the Today list shows: the red badge
 * (overdue) and the count (due today). Both come from the same set, so the
 * count is never negative. */
export function todayRailCounts(todayList: Pick<Todo, 'dueDate'>[], today: string): { overdue: number; dueToday: number } {
  return {
    overdue: todayList.filter((t) => !!t.dueDate && t.dueDate < today).length,
    dueToday: todayList.filter((t) => t.dueDate === today).length,
  };
}

type CompanyRow = { id: number; name: string };

function companyIdByName(name: string, companies: CompanyRow[]): number | null {
  const n = name.trim().toLowerCase();
  return companies.find((c) => c.name.trim().toLowerCase() === n)?.id ?? null;
}

/** One key per company: `id:<id>` when the task has a company id or its client
 * name matches a company (any case), else `name:<client>`. */
export function taskCompanyKey(t: Pick<Todo, 'client' | 'companyId'>, companies: CompanyRow[]): string | null {
  if (!t.client && t.companyId == null) return null;
  if (t.companyId != null) return `id:${t.companyId}`;
  const id = companyIdByName(t.client!, companies);
  return id != null ? `id:${id}` : `name:${t.client}`;
}

/** A saved list key (`name:Acme Holdings` from before) reads as the company's id key when it has one. */
export function normalizeCompanyKey(key: string, companies: CompanyRow[]): string {
  if (!key.startsWith('name:')) return key;
  const id = companyIdByName(key.slice(5), companies);
  return id != null ? `id:${id}` : key;
}
