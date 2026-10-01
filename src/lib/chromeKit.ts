// Menus, toasts and confirmations (1.63 "chrome"): a menu's order (groups kept,
// what destroys last, in red), an undo toast's two lines and how the stack
// holds three, and what a confirmation says a delete also removes — worked
// out from the record, never including files on disk. Pure: lib/contextMenu.ts,
// lib/ui.ts and lib/utils.ts draw them.

import type { Agreement, Meeting, Proposal } from './types';
import { plural } from './pageKit';

// ── Menus ───────────────────────────────────────────────────────────────────

export interface MenuItemLike { label: string; danger?: boolean; separator?: boolean; heading?: boolean; head?: unknown }

/** A menu in its order: the header first, the groups as given (never two dividers in a row, none first or last),
 * and the destructive items together at the bottom after a divider. Pure. */
export function orderMenu<T extends MenuItemLike>(items: T[], separator: T): T[] {
  const head = items.filter((i) => i.head);
  const rest = items.filter((i) => !i.head && !i.danger);
  const danger = items.filter((i) => !i.head && i.danger);
  const tidy: T[] = [];
  for (const i of rest) {
    if (i.separator && (!tidy.length || tidy[tidy.length - 1].separator)) continue;
    tidy.push(i);
  }
  while (tidy.length && tidy[tidy.length - 1].separator) tidy.pop();
  return [...head, ...tidy, ...(danger.length && tidy.length ? [separator] : []), ...danger];
}

// ── Undo toasts ─────────────────────────────────────────────────────────────

export interface ToastParts { title: string; meta: string }

/** A toast's two lines from one message: "Kept: Send the quote" is a title and what it was about; a message with
 * no colon is all title. A detail given apart always wins as the second line. Pure. */
export function toastParts(message: string, detail?: string | null): ToastParts {
  if (detail) return { title: message, meta: detail };
  const at = message.indexOf(': ');
  return at > 0 && at < 40 ? { title: message.slice(0, at), meta: message.slice(at + 2) } : { title: message, meta: '' };
}

export const UNDO_STACK_MAX = 3;
export const UNDO_MS = 7000;

/** The stack after one more: three at most, the oldest leaving first. Returns what stays (oldest first, the new one
 * last) and what leaves. Pure. */
export function stackAfterAdd<T>(stack: T[], added: T, max = UNDO_STACK_MAX): { keep: T[]; drop: T[] } {
  const all = [...stack, added];
  return { keep: all.slice(-max), drop: all.slice(0, Math.max(0, all.length - max)) };
}

/** How much of the window to undo is left, from 1 (just shown) to 0 (gone). Pure. */
export function countdownLeft(startedAt: number, now: number, ms = UNDO_MS): number {
  return Math.max(0, Math.min(1, 1 - (now - startedAt) / ms));
}

// ── Confirmations ───────────────────────────────────────────────────────────

/** Does the button destroy something? Delete, Remove, Discard — by its label. Pure. */
export const isDestructive = (confirmLabel: string | null | undefined): boolean => /^(delete|remove|discard|disconnect)\b/i.test((confirmLabel || '').trim());

/** "Sample Client's", "Acme Holdings'". */
const possessive = (name: string): string => `${name}${/s$/i.test(name) ? "'" : "'s"}`;

export interface Cascade {
  /** The record, named: "Recruitment for Sample Client, SL# 2". */
  named: string;
  /** What else goes with it; empty when nothing does. */
  also: string[];
  /** What stays and is worth saying. */
  stays: string[];
}

/** Deleting a proposal: its revisions and its deck records go (the decks themselves stay in OneDrive), and so does
 * its place in the client's timeline; an agreement made from it stays, without the link. Pure. */
export function proposalCascade(p: Pick<Proposal, 'id' | 'client' | 'type' | 'revisions' | 'documents' | 'notes'>, o: { agreementRef?: string | null } = {}): Cascade {
  const revisions = p.revisions?.length ?? 0;
  const decks = p.documents?.length ?? 0;
  const notes = p.notes?.length ?? 0;
  const also = [
    [revisions ? plural(revisions, 'revision') : '', decks ? `${plural(decks, 'generated deck record')} (the ${decks === 1 ? 'file stays' : 'files stay'} in OneDrive)` : ''].filter(Boolean).join(' and '),
    notes ? plural(notes, 'note') : '',
    p.client ? `its place in ${possessive(p.client)} timeline` : 'its place in the timeline',
  ].filter(Boolean);
  return { named: `${p.type || 'Proposal'} for ${p.client || 'this client'}, SL# ${p.id}`, also, stays: o.agreementRef != null ? [`Its agreement ${o.agreementRef || ''} stays, without the link.`.replace('  ', ' ')] : [] };
}

/** Deleting an agreement: its service lines go; a proposal still signed by both parties would create a new one. Pure. */
export function agreementCascade(a: Pick<Agreement, 'agrRef' | 'client' | 'lines' | 'proposalId'>, o: { proposalStillSigned?: boolean; renewals?: number } = {}): Cascade {
  const lines = a.lines?.length ?? 0;
  return {
    named: `${a.agrRef || 'Agreement'} for ${a.client || 'this client'}`,
    also: [lines ? plural(lines, 'service line') : '', a.client ? `its place in ${possessive(a.client)} timeline` : ''].filter(Boolean),
    stays: [
      ...(o.proposalStillSigned && a.proposalId != null ? [`Its proposal (SL# ${a.proposalId}) is still signed by both parties, so a new agreement will be created for it. To stop that, change the proposal's status first.`] : []),
      ...(o.renewals ? [`${o.renewals === 1 ? 'The renewal' : `${o.renewals} renewals`} drafted from it ${o.renewals === 1 ? 'stays' : 'stay'}.`] : []),
    ],
  };
}

/** Deleting a meeting: what was written in it goes with it. Pure. */
export function meetingCascade(m: Pick<Meeting, 'title' | 'agenda' | 'discussion' | 'decisions' | 'followUp'>): Cascade {
  const parts = [m.agenda ? 'agenda' : '', m.discussion ? 'discussion' : '', m.decisions ? 'decisions' : '', m.followUp ? 'follow-up' : ''].filter(Boolean);
  return { named: m.title || 'This meeting', also: parts.length ? [`its ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]}`] : [], stays: [] };
}
