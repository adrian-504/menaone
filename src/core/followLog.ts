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
import { escHtml, expose, today } from '../lib/utils';
import { plural } from '../lib/pageKit';
import { fmtDateShort } from '../lib/dates';
import { PS, activeTeam } from '../lib/commercial';
import { CHANNELS, channelOf, channelWord, kindOf, sentWith, type Channel } from '../lib/followRequests';
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

// ── The details dialog ──────────────────────────────────────────────────────
// Optional: "Followed up" and "Client replied" are one click from the menu. This is for the rest — another day,
// who did it, a line of what was said, "will revert after" — and for changing or deleting an entry afterwards.

interface EntryDialog {
  /** The proposals it was opened on. */
  ids: number[];
  /** From Follow-up's bar: one entry per ticked request. */
  groups: number[][] | null;
  /** The others sent with a single proposal: included while "also the N sent with it" is ticked. */
  also: number[];
  /** Editing: the rows of the entry. */
  editing: number[] | null;
  direction: 'out' | 'in';
}
let dialog: EntryDialog | null = null;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function paintDirection(): void {
  if (!dialog) return;
  const d = dialog.direction;
  document.querySelectorAll<HTMLElement>('#entry-direction button').forEach((b) => {
    const on = b.dataset.direction === d;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
  const channel = el<HTMLSelectElement>('entry-channel');
  if (channel) {
    const keep = channel.value;
    channel.innerHTML = CHANNELS[d].map(([v, label]) => `<option value="${v}">${label}</option>`).join('');
    if (CHANNELS[d].some(([v]) => v === keep)) channel.value = keep;
  }
  const who = el('entry-who-grp'); if (who) who.hidden = d === 'in';
  const revert = el('entry-revert-grp'); if (revert) revert.hidden = d !== 'in';
  const note = el('entry-note-lbl'); if (note) note.textContent = d === 'in' ? 'What they said (optional)' : 'What was said (optional)';
}

export function entryDirection(direction: 'out' | 'in'): void {
  if (!dialog) return;
  dialog.direction = direction;
  paintDirection();
}
expose('entryDirection', entryDirection);

/** Opens the details for a new entry on these proposals; with `touchId`, for changing that entry. */
export function openEntryDialog(ids: number[], touchId?: number, groups?: number[][]): void {
  const editing = touchId != null ? entryRows(touchId) : null;
  const first = editing?.[0] ?? null;
  const proposalIds = editing ? editing.map((t) => t.proposalId).filter((x): x is number => x != null) : ids;
  const proposals = S.proposals.filter((p) => proposalIds.includes(p.id));
  if (!proposals.length) return;
  // Opened on one proposal: the others sent with it are offered, ticked.
  const also = !editing && proposals.length === 1 ? withSentWith(proposals[0].id).filter((id) => id !== proposals[0].id) : [];
  dialog = { ids: proposalIds, groups: !editing && groups?.length ? groups : null, also, editing: editing ? editing.map((t) => t.id) : null, direction: first?.direction ?? 'out' };
  const clients = [...new Set(proposals.map((p) => p.client))];
  const set = (id: string, text: string) => { const x = el(id); if (x) x.textContent = text; };
  set('entry-title', editing ? 'Edit entry' : 'Follow-up details');
  set('entry-sub', clients.length > 1 ? `${plural(proposals.length, 'proposal')} for ${plural(clients.length, 'client')}` : `${clients[0]} — ${proposals.map((p) => p.type || 'Proposal').join(', ')}`);
  paintDirection();
  const channel = el<HTMLSelectElement>('entry-channel'); if (channel) channel.value = first ? channelOf(first.kind) : 'email';
  const date = el<HTMLInputElement>('entry-date'); if (date) { date.value = first ? first.at.slice(0, 10) : today(); date.max = today(); }
  const who = el<HTMLSelectElement>('entry-who');
  if (who) {
    const mine = first ? first.byMemberId ?? null : S.currentUserId;
    who.innerHTML = `<option value="">Not recorded</option>` + activeTeam().map((m) => `<option value="${m.id}"${m.id === mine ? ' selected' : ''}>${escHtml(m.name)}</option>`).join('');
  }
  const note = el<HTMLInputElement>('entry-note'); if (note) note.value = first?.note ?? '';
  const revert = el<HTMLInputElement>('entry-revert'); if (revert) revert.value = first?.revertAfter?.slice(0, 10) ?? '';
  const alsoWrap = el('entry-also-grp'); if (alsoWrap) alsoWrap.hidden = !also.length;
  const alsoBox = el<HTMLInputElement>('entry-also'); if (alsoBox) alsoBox.checked = true;
  set('entry-also-lbl', also.length ? `Also the ${also.length} sent with it` : '');
  const del = el('entry-delete'); if (del) del.hidden = !editing;
  set('entry-save', editing ? 'Save' : 'Log it');
  el('modal-entry')?.classList.add('open');
  note?.focus();
}
expose('openEntryDialog', openEntryDialog);

export function closeEntryDialog(): void {
  dialog = null;
  el('modal-entry')?.classList.remove('open');
}
expose('closeEntryDialog', closeEntryDialog);

export async function saveEntryDialog(): Promise<void> {
  if (!dialog) return;
  const d = dialog;
  const channel = (el<HTMLSelectElement>('entry-channel')?.value || 'email') as Channel;
  const at = el<HTMLInputElement>('entry-date')?.value || today();
  if (at > today()) { toast('The day cannot be in the future', { tone: 'error' }); el('entry-date')?.focus(); return; }
  const who = el<HTMLSelectElement>('entry-who')?.value;
  const draft = {
    kind: kindOf(channel, d.direction), direction: d.direction, at,
    byMemberId: d.direction === 'out' && who ? Number(who) : null,
    note: el<HTMLInputElement>('entry-note')?.value.trim() || null,
    revertAfter: d.direction === 'in' ? el<HTMLInputElement>('entry-revert')?.value || null : null,
  };
  const also = el<HTMLInputElement>('entry-also')?.checked ? d.also : [];
  closeEntryDialog();
  if (d.editing) { if (await changeEntry(d.editing, draft)) toast('Entry saved', { tone: 'success' }); return; }
  await logEntry({ ids: [...d.ids, ...also], groups: d.groups ?? undefined, ...draft });
}
expose('saveEntryDialog', saveEntryDialog);

export function deleteEntryFromDialog(): void {
  const rows = dialog?.editing;
  closeEntryDialog();
  if (rows) void removeEntry(rows);
}
expose('deleteEntryFromDialog', deleteEntryFromDialog);
