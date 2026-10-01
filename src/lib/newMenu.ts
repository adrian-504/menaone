// The New menu (1.63 "chrome"): what can be created, in three groups, with a
// tile each, a one-line helper where the kind needs one, and its shortcut from
// the key registry; type to filter, arrows to move. Pure: core/newMenu.ts draws
// it and runs the choice.

export type NewGroup = 'Here' | 'Work' | 'Clients' | 'Sales';

export interface NewItem {
  key: string;
  label: string;
  group: NewGroup;
  icon: string;
  /** The tile's tint (a colour token). */
  tint: string;
  /** One line under the label, for the kinds that need saying. */
  helper?: string;
  /** The key registry's id for its shortcut, when it has one. */
  shortcutId?: string;
}

export const NEW_ITEMS: NewItem[] = [
  { key: 'task', label: 'Task', group: 'Work', icon: 'check', tint: 'var(--blue)', helper: 'Type it in one line, dates included', shortcutId: 'new-task' },
  { key: 'meeting', label: 'Meeting', group: 'Work', icon: 'meeting', tint: 'var(--blue)' },
  { key: 'note', label: 'Note', group: 'Work', icon: 'note', tint: 'var(--sub)', shortcutId: 'new-note' },
  { key: 'promise', label: 'Promise', group: 'Work', icon: 'flag', tint: 'var(--coral-text)', helper: 'Something we owe or they owe' },
  { key: 'company', label: 'Company', group: 'Clients', icon: 'building', tint: 'var(--green)' },
  { key: 'contact', label: 'Contact', group: 'Clients', icon: 'people', tint: 'var(--green)' },
  { key: 'opportunity', label: 'Opportunity', group: 'Sales', icon: 'briefcase', tint: 'var(--amber)' },
  { key: 'proposal', label: 'Proposal', group: 'Sales', icon: 'database', tint: 'var(--navy)', helper: 'Opens the proposal builder' },
  { key: 'agreement', label: 'Agreement', group: 'Sales', icon: 'document', tint: 'var(--sub)' },
  { key: 'project', label: 'Project', group: 'Sales', icon: 'target', tint: 'var(--sub)' },
];

const ORDER: NewGroup[] = ['Here', 'Work', 'Clients', 'Sales'];

/** The items a typed filter leaves: every word typed starts a word of the label, the helper or the group. An empty
 * filter leaves them all. Pure. */
export function filterNewItems(items: NewItem[], query: string): NewItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((i) => {
    const hay = `${i.label} ${i.helper || ''} ${i.group}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return words.every((w) => hay.some((h) => h.startsWith(w)));
  });
}

/** In their groups, in the menu's order; a group with nothing left is not shown. The items keep one running order
 * (the order the arrows move in). Pure. */
export function groupNewItems(items: NewItem[]): { group: NewGroup; items: NewItem[] }[] {
  return ORDER.map((group) => ({ group, items: items.filter((i) => i.group === group) })).filter((g) => g.items.length);
}

/** The order the arrows move in: group by group. Pure. */
export const flatNewItems = (items: NewItem[]): NewItem[] => groupNewItems(items).flatMap((g) => g.items);

/** The next selection: down and up wrap around; an empty list has none. Pure. */
export function stepSelection(index: number, delta: number, length: number): number {
  return length ? (index + delta + length) % length : -1;
}
