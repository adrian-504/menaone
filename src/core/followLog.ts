// The follow-up log (1.65 "followup"). One entry is one contact with the
// client about one or several proposals: the same day, channel and direction
// written on each of them, tied by a batch id so it is counted once, edited
// once and removed once.
//
// "Followed up" stays one click (owner, 1-Oct-2026: "not an app where I'm
// supposed to log every call"): a click writes today, the channel and nothing
// more. Who did it, another day, a line of what was said and "will revert
// after" are optional details, added only when wanted.

import { S } from '../lib/state';
import { touchesAdd, touchesDelete, touchesUpdate, type TouchChange } from '../lib/db';
import { optimistic } from '../lib/optimistic';
import { refreshAll } from '../lib/registry';
import { undoToast, toast } from '../lib/ui';
import { today } from '../lib/utils';
import { plural } from '../lib/pageKit';
import { fmtDateShort } from '../lib/dates';
import { PS } from '../lib/commercial';
import { channelWord, sentWith } from '../lib/followRequests';
import type { Touch, TouchKind } from '../lib/types';

export interface EntryDraft {
  /** The proposals it is about: one entry (one batch) across them. */
  ids: number[];
  /** Or several entries written in one go, one per group (one per request ticked on Follow-up); `ids` is then ignored. */
  groups?: number[][];
  kind: TouchKind;
  direction?: 'out' | 'in';
  /** The day; today when not given. */
  at?: string;
  byMemberId?: number | null;
  note?: string | null;
  revertAfter?: string | null;
}

/** A proposal and the others sent with it (the same request), by SL#. */
export function withSentWith(id: number): number[] {
  const p = S.proposals.find((x) => x.id === id);
  if (!p || p.status !== PS.SENT) return [id];
  return [id, ...sentWith(p, S.proposals).map((x) => x.id)].sort((a, b) => a - b);
}

const redraw = (ids: number[]) => { refreshAll(); if (S.currentProposalId != null && ids.includes(S.currentProposalId)) (window as any).renderProposalPage?.(); };

/** "email today", "client replied by WhatsApp on 28 Sept". */
function entryWords(d: Pick<EntryDraft, 'kind' | 'direction' | 'at'>): string {
  const at = d.at && d.at !== today() ? ` on ${fmtDateShort(d.at, true)}` : ' today';
  return d.direction === 'in' || d.kind === 'email_in' ? `client replied by ${channelWord(d.kind)}${at}` : `${channelWord(d.kind)}${at}`;
}

/** Writes one entry on every proposal it is about: shown at once, saved behind (a failed save puts it back), and
 * undoable as one. Several proposals share a batch id. Returns the rows saved. */
export async function logEntry(d: EntryDraft): Promise<Touch[]> {
  const groups = (d.groups?.length ? d.groups : [d.ids]).map((ids) => ids.map((id) => S.proposals.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p)).filter((g) => g.length);
  const proposals = groups.flat();
  if (!proposals.length) return [];
  const at = d.at || today();
  const direction: 'out' | 'in' = d.kind === 'email_in' ? 'in' : d.kind === 'email_out' || d.kind === 'meeting' ? 'out' : d.direction === 'in' ? 'in' : 'out';
  const newBatch = () => crypto.randomUUID?.() ?? `b${Date.now()}${Math.random().toString(16).slice(2)}`;
  const drafts = groups.flatMap((group) => {
    // One entry per group: its proposals share a batch id (a single proposal needs none).
    const batchId = group.length > 1 ? newBatch() : null;
    return group.map((p) => ({
      proposalId: p.id, companyId: p.companyId ?? null, kind: d.kind, direction, at, contactId: p.primaryContactId ?? null,
      byMemberId: d.byMemberId ?? null, note: d.note?.trim() || null, batchId, revertAfter: direction === 'in' ? d.revertAfter || null : null,
    }));
  });
  const stamp = Date.now();
  const temps = drafts.map((x, n) => ({ ...x, id: -(stamp + n), subject: null, source: 'manual', sourceId: null, createdAt: new Date().toISOString() }) as unknown as Touch);
  const tempIds = new Set(temps.map((t) => t.id));
  const ids = proposals.map((p) => p.id);
  const saved = await optimistic({
    apply: () => { S.touches = [...S.touches, ...temps]; redraw(ids); },
    commit: async () => { const out: Touch[] = []; for (const x of drafts) out.push(await touchesAdd(x)); return out; },
    revert: () => { S.touches = S.touches.filter((x) => !tempIds.has(x.id)); redraw(ids); },
  });
  if (!saved) return [];
  const savedIds = new Set(saved.map((t) => t.id));
  S.touches = [...S.touches.filter((x) => !tempIds.has(x.id) && !savedIds.has(x.id)), ...saved];
  redraw(ids);
  undoToast(`Logged: ${entryWords({ kind: d.kind, direction, at })}`, () => { void removeEntry(saved.map((t) => t.id), true); }, undefined, undefined,
    { detail: groups.length > 1 ? `on ${plural(groups.length, 'request')}` : proposals.length > 1 ? `on the ${proposals.length} proposals sent together` : undefined });
  return saved;
}

/** The rows of the entry a touch belongs to: its batch, else itself. */
export function entryRows(touchId: number): Touch[] {
  const t = S.touches.find((x) => x.id === touchId);
  if (!t) return [];
  return t.batchId ? S.touches.filter((x) => x.batchId === t.batchId) : [t];
}

/** Removes an entry (every row of it). With `quiet` it is an undo and says nothing; otherwise it offers to put it back. */
export async function removeEntry(touchIds: number[], quiet = false): Promise<void> {
  const rows = S.touches.filter((t) => touchIds.includes(t.id));
  if (!rows.length) return;
  try {
    for (const t of rows) await touchesDelete(t.id);
  } catch (err) {
    toast("Couldn't remove the entry", { tone: 'error', detail: String(err) });
    return;
  }
  S.touches = S.touches.filter((t) => !touchIds.includes(t.id));
  const ids = rows.map((t) => t.proposalId).filter((x): x is number => x != null);
  redraw(ids);
  if (quiet) return;
  undoToast(`Entry removed${rows.length > 1 ? ` from ${plural(rows.length, 'proposal')}` : ''}`, () => {
    void (async () => {
      const back: Touch[] = [];
      for (const t of rows) back.push(await touchesAdd({ proposalId: t.proposalId, companyId: t.companyId, kind: t.kind, direction: t.direction, at: t.at, subject: t.subject, contactId: t.contactId, byMemberId: t.byMemberId ?? null, note: t.note ?? null, batchId: t.batchId ?? null, revertAfter: t.revertAfter ?? null }));
      S.touches = [...S.touches, ...back];
      redraw(ids);
    })();
  });
}

/** Changes an entry afterwards, on every row of it. */
export async function changeEntry(touchIds: number[], change: TouchChange): Promise<boolean> {
  const rows = S.touches.filter((t) => touchIds.includes(t.id));
  if (!rows.length) return false;
  try {
    const saved: Touch[] = [];
    for (const t of rows) saved.push(await touchesUpdate(t.id, change));
    const byId = new Map(saved.map((t) => [t.id, t]));
    S.touches = S.touches.map((t) => byId.get(t.id) ?? t);
  } catch (err) {
    toast("Couldn't save the entry", { tone: 'error', detail: String(err) });
    return false;
  }
  redraw(rows.map((t) => t.proposalId).filter((x): x is number => x != null));
  return true;
}
