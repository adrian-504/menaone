// Table columns people can show, hide and sort by. Which columns are shown
// and the sort are per-device conveniences, so they live in localStorage.

import { escHtml, daysSince, fmtDate } from './utils';
import { showMenuAt } from './contextMenu';

export interface Column<T> {
  key: string;
  label: string;
  /** Shown until someone changes the table's columns. */
  shown: boolean;
  /** Always shown and not listed in the picker. */
  fixed?: boolean;
  /** Value to sort by; columns without one aren't sortable. */
  sort?: (row: T) => string | number | null;
  /** Numbers and dates sort high to low first. */
  descFirst?: boolean;
  cell: (row: T) => string;
  className?: string;
}

export interface SortState { key: string; dir: 'asc' | 'desc' }

const KEY = 'menaone.columns';

function readAll(): Record<string, { shown?: string[]; sort?: SortState }> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

function writeTable(table: string, patch: { shown?: string[]; sort?: SortState }): void {
  const all = readAll();
  all[table] = { ...all[table], ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* not persisted this time */ }
}

export function shownColumns<T>(table: string, columns: Column<T>[]): Column<T>[] {
  const saved = readAll()[table]?.shown;
  return columns.filter((c) => c.fixed || (saved ? saved.includes(c.key) : c.shown));
}

export function sortState<T>(table: string, columns: Column<T>[], fallback: SortState): SortState {
  const saved = readAll()[table]?.sort;
  return saved && columns.some((c) => c.key === saved.key && c.sort) ? saved : fallback;
}

export function setSort<T>(table: string, columns: Column<T>[], key: string, fallback: SortState): SortState {
  const col = columns.find((c) => c.key === key);
  if (!col?.sort) return sortState(table, columns, fallback);
  const cur = sortState(table, columns, fallback);
  const dir: SortState['dir'] = cur.key === key ? (cur.dir === 'asc' ? 'desc' : 'asc') : col.descFirst ? 'desc' : 'asc';
  const next = { key, dir };
  writeTable(table, { sort: next });
  return next;
}

/** Sorts rows by a column; empty values always go last. */
export function sortRows<T>(rows: T[], columns: Column<T>[], state: SortState): T[] {
  const col = columns.find((c) => c.key === state.key);
  if (!col?.sort) return rows;
  const values = new Map(rows.map((r) => [r, col.sort!(r)] as const));
  const empty = (v: string | number | null) => v === null || v === '' || (typeof v === 'number' && Number.isNaN(v));
  return [...rows].sort((a, b) => {
    const va = values.get(a)!, vb = values.get(b)!;
    if (empty(va) || empty(vb)) return empty(va) === empty(vb) ? 0 : empty(va) ? 1 : -1;
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { sensitivity: 'base', numeric: true });
    return state.dir === 'asc' ? cmp : -cmp;
  });
}

/** Header cells for the shown columns; `onSort` is a global function name called with the column key. */
export function headerCells<T>(columns: Column<T>[], state: SortState, onSort: string): string {
  return columns.map((c) => {
    if (!c.sort) return `<th class="${c.className || ''}">${escHtml(c.label)}</th>`;
    const on = state.key === c.key;
    const aria = on ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none';
    return `<th class="th-sortable${on ? ' is-sorted' : ''} ${c.className || ''}" aria-sort="${aria}"><button class="th-sort" onclick="${onSort}('${c.key}')">${escHtml(c.label)}<span class="th-sort-ind">${on ? (state.dir === 'asc' ? '↑' : '↓') : ''}</span></button></th>`;
  }).join('');
}

/** Menu of the table's optional columns; ticking one shows or hides it. */
export function openColumnPicker<T>(anchor: HTMLElement, table: string, columns: Column<T>[], onChange: () => void): void {
  const shown = new Set(shownColumns(table, columns).map((c) => c.key));
  const optional = columns.filter((c) => !c.fixed);
  showMenuAt(anchor, [
    ...optional.map((c) => ({
      label: `${shown.has(c.key) ? '✓ ' : '    '}${c.label}`,
      run: () => {
        if (shown.has(c.key)) shown.delete(c.key); else shown.add(c.key);
        writeTable(table, { shown: optional.filter((x) => shown.has(x.key)).map((x) => x.key) });
        onChange();
      },
    })),
    { label: '', run: () => {}, separator: true },
    { label: 'Reset columns', iconName: 'repeat', run: () => { writeTable(table, { shown: undefined }); onChange(); } },
  ]);
}

/** "3 days ago", "5 weeks ago" — with the full date on hover. */
export function agoLabel(date: string | null): string {
  if (!date) return '<span class="t-muted">—</span>';
  const days = daysSince(date.slice(0, 10));
  if (days == null) return '<span class="t-muted">—</span>';
  const text = days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 14 ? `${days} days ago` : days < 60 ? `${Math.round(days / 7)} weeks ago` : days < 365 ? `${Math.round(days / 30)} months ago` : `${Math.round(days / 365)} year${Math.round(days / 365) === 1 ? '' : 's'} ago`;
  return `<span title="${fmtDate(date.slice(0, 10))}">${text}</span>`;
}
