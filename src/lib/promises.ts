// Tasks → Promises: every open commitment across clients on one screen
// (owner, 24-Sep-2026). What we owe, what we're owed, and a folded list of
// what was kept or dropped in the last 30 days. The rows are the shared
// commitmentRow(); this file only decides what goes where, and in what order.

import type { Commitment } from './types';

export interface PromisesView {
  /** Open, ours: late first, then by due date, undated last. */
  owe: Commitment[];
  /** Open, theirs: same order. */
  owed: Commitment[];
  /** Kept or dropped in the last 30 days, most recent first. */
  closed: Commitment[];
}

export const CLOSED_WINDOW_DAYS = 30;

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Late (due before today), then dated, then undated; ties by due date, then oldest first. */
export function promiseOrder(today: string) {
  const rank = (c: Commitment) => (!c.dueDate ? 2 : c.dueDate < today ? 0 : 1);
  return (a: Commitment, b: Commitment): number =>
    rank(a) - rank(b) || (a.dueDate || '').localeCompare(b.dueDate || '') || a.id - b.id;
}

/** `today` is YYYY-MM-DD. */
export function promisesView(list: Commitment[], today: string): PromisesView {
  const order = promiseOrder(today);
  const open = list.filter((c) => c.status === 'open');
  const since = addDays(today, -CLOSED_WINDOW_DAYS);
  return {
    owe: open.filter((c) => c.direction === 'ours').sort(order),
    owed: open.filter((c) => c.direction === 'theirs').sort(order),
    closed: list.filter((c) => c.status !== 'open' && !!c.closedAt && c.closedAt.slice(0, 10) >= since)
      .sort((a, b) => (b.closedAt || '').localeCompare(a.closedAt || '')),
  };
}

/** The count beside "Promises" in the Tasks rail: open, both directions. */
export function openPromiseCount(list: Commitment[]): number {
  return list.filter((c) => c.status === 'open').length;
}

/** A plain nudge for something a client owes us; opened as a draft, never sent. */
export function nudgeMailto(to: string | null | undefined, text: string): string {
  const subject = `Following up: ${text}`;
  const body = `Hi, just following up on this: ${text}. Thanks.`;
  return `mailto:${encodeURIComponent(to || '').replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
