// Follow-up: a sent proposal needs a nudge when nothing has happened with the
// client for a while — not simply when it was sent long ago. "Last touch" is
// the latest of the proposal's own notes, an email from the client, a meeting
// with the client and a follow-up logged in one click (an email, call or
// WhatsApp, ours or theirs — touches.rs) since it was sent; else the send
// date. Pure.

import { proposalSentDate } from './commercial';
import type { EmailRecord, Meeting, Proposal, Touch } from './types';

export const FOLLOW_UP_AFTER_DAYS = 10;

export interface LastTouch {
  date: string;
  /** 'email' is the client's email (a synced one or a logged reply); 'email_out' ours. */
  kind: 'sent' | 'note' | 'email' | 'meeting' | 'email_out' | 'call' | 'whatsapp';
  days: number;
  /** A call or WhatsApp: who reached out. */
  by?: 'us' | 'client';
  /** The contact it was with, when known ("you emailed Sara"). */
  who?: string | null;
}

export interface TouchContext {
  emails: Pick<EmailRecord, 'companyId' | 'senderEmail' | 'receivedAt'>[];
  meetings: Pick<Meeting, 'companyId' | 'meetingDate' | 'isCancelled'>[];
  /** YYYY-MM-DD. */
  today: string;
  /** MENA BIG's own email domains: those emails are ours, not the client's. */
  ownDomains?: Set<string>;
  /** Follow-ups logged against proposals. */
  touches?: Pick<Touch, 'proposalId' | 'companyId' | 'kind' | 'direction' | 'at' | 'contactId'>[];
  /** A contact's first name, for "you emailed Sara". */
  contactName?: (id: number) => string | null;
}

type TouchRow = NonNullable<TouchContext['touches']>[number];

/** The touches about this proposal: logged on it, or on its company without a proposal. */
export function touchesOf<T extends TouchRow>(p: { id?: number; companyId?: number | null }, touches: T[]): T[] {
  return touches.filter((t) => t.proposalId === p.id || (t.proposalId == null && p.companyId != null && t.companyId === p.companyId));
}

/** Follow-ups from us since the latest send: our emails, calls and WhatsApps. */
export function followUpCount(p: Pick<Proposal, 'id' | 'companyId' | 'lastSentAt' | 'dateSentToClient' | 'sentDate'>, touches: TouchRow[]): number {
  const sent = day(proposalSentDate(p));
  if (!sent) return 0;
  return touchesOf(p, touches).filter((t) => t.direction === 'out' && t.kind !== 'meeting' && t.kind !== 'email_in' && day(t.at) >= sent).length;
}

const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : '');
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const domain = (email: string | null | undefined) => (email || '').split('@')[1]?.trim().toLowerCase() || '';

/** The latest contact on a sent proposal, counted from its latest send (a
 * revision's, else the first). Null when it has no send date. */
export function lastTouch(p: Pick<Proposal, 'lastSentAt' | 'dateSentToClient' | 'sentDate' | 'notes' | 'companyId'> & { id?: number }, ctx: TouchContext): LastTouch | null {
  const sent = day(proposalSentDate(p));
  if (!sent) return null;
  let best: Omit<LastTouch, 'days'> = { date: sent, kind: 'sent' };
  // Later wins; on the same day contact beats the send itself.
  const offer = (date: string, kind: LastTouch['kind'], extra: Partial<LastTouch> = {}) => { if (date && date >= best.date && date <= ctx.today) best = { date, kind, ...extra }; };
  for (const t of touchesOf(p, ctx.touches || [])) {
    const who = t.contactId != null ? ctx.contactName?.(t.contactId) ?? null : null;
    const by = t.direction === 'in' ? 'client' : 'us';
    const kind: LastTouch['kind'] = t.kind === 'email_in' ? 'email' : t.kind;
    offer(day(t.at), kind, { by, who });
  }
  for (const n of p.notes || []) offer(day(n.date), 'note');
  if (p.companyId != null) {
    for (const e of ctx.emails) {
      if (e.companyId !== p.companyId || ctx.ownDomains?.has(domain(e.senderEmail))) continue;
      const d = day(e.receivedAt);
      if (d > sent) offer(d, 'email');
    }
    for (const m of ctx.meetings) {
      if (m.isCancelled || m.companyId !== p.companyId) continue;
      const d = day(m.meetingDate);
      if (d > sent) offer(d, 'meeting');
    }
  }
  return { ...best, days: Math.max(0, daysBetween(best.date, ctx.today)) };
}

const ago = (n: number) => (n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);

/** What the last contact was: "you emailed Sara 3 days ago", "client called yesterday"; '' for the send itself. */
export function touchWhat(t: Omit<LastTouch, 'date'>): string {
  const whom = t.who ? ` ${t.who}` : '';
  switch (t.kind) {
    case 'email': return `client replied ${ago(t.days)}`;
    case 'email_out': return `you emailed${whom || ' the client'} ${ago(t.days)}`;
    case 'call': return t.by === 'client' ? `client called ${ago(t.days)}` : `you called${whom} ${ago(t.days)}`;
    case 'whatsapp': return t.by === 'client' ? `client sent a WhatsApp ${ago(t.days)}` : `WhatsApp ${ago(t.days)}`;
    case 'note': return `you logged a note ${ago(t.days)}`;
    case 'meeting': return `meeting ${ago(t.days)}`;
    default: return '';
  }
}

/** One line of the proposal page's contact list, without "ago": "you emailed Sara", "client called". */
export function touchDoing(t: Pick<Touch, 'kind' | 'direction'>, who: string | null): string {
  const whom = who ? ` ${who}` : '';
  if (t.kind === 'email_in') return `${who || 'client'} replied`;
  if (t.kind === 'email_out') return `you emailed${whom || ' the client'}`;
  if (t.kind === 'call') return t.direction === 'in' ? `${who || 'client'} called` : `you called${whom}`;
  if (t.kind === 'whatsapp') return t.direction === 'in' ? `WhatsApp from ${who || 'the client'}` : `WhatsApp${who ? ` to ${who}` : ''}`;
  return `met${whom}`;
}

/** The row's meta: "Sent 2 Sept · 2 follow-ups · you emailed Sara 3 days ago", or just "Sent 2 Sept". */
export function touchLabel(t: LastTouch, sentLabel: string, followUps = 0): string {
  return [`Sent ${sentLabel}`, followUps ? `${followUps} follow-up${followUps === 1 ? '' : 's'}` : '', touchWhat(t)].filter(Boolean).join(' · ');
}

/** "Wait longer — back in N days": the default, beyond the ten days a note gives anyway. */
export const WAIT_LONGER_DAYS = 30;

/** "Wait longer" from the notes dialog: the date the proposal returns (N kept within 1–90). */
export function backInDays(today: string, days: number): string {
  const n = Math.min(90, Math.max(1, Math.round(Number.isFinite(days) ? days : WAIT_LONGER_DAYS)));
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
