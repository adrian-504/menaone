// "Start from…" in the proposal builder (1.66): a new proposal that begins as a
// past one did — any client's. Its lines (with their priced rows and options),
// its term and its entity and currency are copied; the client and the contact
// never are. The new proposal remembers where it started (`basedOnId`). Pure.

import type { CommercialLine, Proposal } from './types';
import { fmtMoney, lineTotals, proposalSentDate } from './commercial';
import { fmtDate } from './dates';

type Source = Pick<Proposal, 'id' | 'client' | 'type' | 'status' | 'lines' | 'contractMonths' | 'currency' | 'businessEntityId' | 'dateAdded' | 'lastSentAt' | 'dateSentToClient' | 'sentDate'>;

const services = (p: Pick<Proposal, 'lines' | 'contractMonths' | 'type'>) => lineTotals(p.lines || [], p.contractMonths).serviceNames.join(' & ') || p.type || 'Proposal';
const when = (p: Source) => (proposalSentDate(p) || p.dateAdded || '').slice(0, 10);

/** "Acme Holdings — Payroll & PRO". */
export const startFromTitle = (p: Pick<Proposal, 'client' | 'lines' | 'contractMonths' | 'type'>): string => `${p.client} — ${services(p)}`;

/** "SAR 15,000 a month · 12 months · Signed by Both · 10 Jan 2026": what it was, so the right one is picked. */
export function startFromSub(p: Source): string {
  const t = lineTotals(p.lines || [], p.contractMonths);
  const currency = p.currency || 'SAR';
  const day = when(p);
  return [
    t.monthly ? `${fmtMoney(t.monthly, currency)} a month` : t.oneTime ? `${fmtMoney(t.oneTime, currency)} one-time` : '',
    p.contractMonths ? `${p.contractMonths} months` : '',
    p.status,
    day ? fmtDate(day) : '',
  ].filter(Boolean).join(' · ');
}

/** Past proposals a new one can start from: any client's, with at least one service. Found by client, service or
 * SL#; the most recent first. With nothing typed, the most recent ones. */
export function startFromMatches<T extends Source>(proposals: T[], q: string, limit = 8): T[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const text = (p: T) => `${p.client} ${services(p)} ${(p.lines || []).map((l) => l.serviceName).join(' ')} sl# ${p.id} ${p.id}`.toLowerCase();
  return proposals
    .filter((p) => (p.lines || []).some((l) => l.serviceName.trim()))
    .filter((p) => words.every((w) => text(p).includes(w)))
    .sort((a, b) => when(b).localeCompare(when(a)) || b.id - a.id)
    .slice(0, limit);
}

/** What a new proposal takes from the one it starts from: its lines (new ids, their own copies of the priced
 * rows), term, entity and currency. Not the client, the contact, the dates, the status or the documents. */
export function startFromCopy(p: Pick<Proposal, 'id' | 'lines' | 'contractMonths' | 'businessEntityId' | 'currency'>, firstLineId: number): { lines: CommercialLine[]; contractMonths: number | null; businessEntityId: number | null; currency: string | null; basedOnId: number } {
  const lines = (p.lines || []).filter((l) => l.serviceName.trim()).map((l, i) => ({ ...l, id: firstLineId + i, sortOrder: i, rates: l.rates?.map((r) => ({ ...r })) }));
  return { lines, contractMonths: p.contractMonths ?? null, businessEntityId: p.businessEntityId ?? null, currency: p.currency ?? null, basedOnId: p.id };
}

/** The one line a proposal says about where it started: "Acme Holdings — Payroll & PRO · SL# 1". A proposal that
 * is no longer in the app is said by its number alone. */
export function basedOnLabel(basedOnId: number | null | undefined, proposals: Pick<Proposal, 'id' | 'client' | 'lines' | 'contractMonths' | 'type'>[]): string {
  if (basedOnId == null) return '';
  const src = proposals.find((p) => p.id === basedOnId);
  return src ? `${startFromTitle(src)} · SL# ${src.id}` : `SL# ${basedOnId}`;
}
