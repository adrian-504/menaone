// Follow-up: a sent proposal needs a nudge when nothing has happened with the
// client for a while — not simply when it was sent long ago. "Last touch" is
// the latest of the proposal's own notes, an email from the client and a
// meeting with the client since it was sent; else the send date. Pure.

import type { EmailRecord, Meeting, Proposal } from './types';

export const FOLLOW_UP_AFTER_DAYS = 10;

export interface LastTouch {
  date: string;
  kind: 'sent' | 'note' | 'email' | 'meeting';
  days: number;
}

export interface TouchContext {
  emails: Pick<EmailRecord, 'companyId' | 'senderEmail' | 'receivedAt'>[];
  meetings: Pick<Meeting, 'companyId' | 'meetingDate' | 'isCancelled'>[];
  /** YYYY-MM-DD. */
  today: string;
  /** MENA BIG's own email domains: those emails are ours, not the client's. */
  ownDomains?: Set<string>;
}

const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : '');
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const domain = (email: string | null | undefined) => (email || '').split('@')[1]?.trim().toLowerCase() || '';

/** The latest contact on a sent proposal. Null when it has no send date. */
export function lastTouch(p: Pick<Proposal, 'dateSentToClient' | 'sentDate' | 'notes' | 'companyId'>, ctx: TouchContext): LastTouch | null {
  const sent = day(p.dateSentToClient || p.sentDate);
  if (!sent) return null;
  let best: { date: string; kind: LastTouch['kind'] } = { date: sent, kind: 'sent' };
  // Later wins; on the same day contact beats the send itself.
  const offer = (date: string, kind: LastTouch['kind']) => { if (date && date >= best.date && date <= ctx.today) best = { date, kind }; };
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

/** The row's meta: "Sent 2 Sept · client emailed 3 days ago", or just "Sent 2 Sept". */
export function touchLabel(t: LastTouch, sentLabel: string): string {
  const what = t.kind === 'email' ? `client emailed ${ago(t.days)}` : t.kind === 'note' ? `you logged a note ${ago(t.days)}` : t.kind === 'meeting' ? `meeting ${ago(t.days)}` : '';
  return what ? `Sent ${sentLabel} · ${what}` : `Sent ${sentLabel}`;
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
