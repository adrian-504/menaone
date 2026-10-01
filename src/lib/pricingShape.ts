// How a fee is charged (1.61): monthly, per person per month, per action, per
// hire, one-time or as a percentage — from the line and its service's rate
// card. An agreement's fees are listed grouped by it; a proposal whose lines
// are not monthly says its shape ("per person per month", "9% of the annual
// package", "one-time", "2 options") where a monthly figure would be blank.
// Pure: the card for a line is passed in.

import type { CommercialLine } from './types';
import type { PricingService } from './constants';
import { fmtMoney, lineAmount } from './commercial';

export type Basis = 'monthly' | 'per_person' | 'per_action' | 'per_hire' | 'one_time' | 'percentage';
export const BASIS_ORDER: Basis[] = ['monthly', 'per_person', 'per_action', 'per_hire', 'one_time', 'percentage'];
export const BASIS_LABEL: Record<Basis, string> = {
  monthly: 'Monthly', per_person: 'Per person per month', per_action: 'Per action', per_hire: 'Per hire', one_time: 'One-time', percentage: 'Percentage',
};

type Card = Pick<PricingService, 'percent' | 'perPerson' | 'perCountry' | 'hasPackages'> | null | undefined;
export type CardFor = (line: CommercialLine) => Card;

const percentOf = (line: CommercialLine, card: Card): number | null =>
  (line.rates || []).find((r) => r.percent != null)?.percent ?? card?.percent?.standard ?? null;

/** How one line is charged. A percentage of the annual package is a fee per hire; a price per person per month is
 * per person; a one-time price per country, or for several of something, is per action. Pure. */
export function lineBasis(line: CommercialLine, card: Card): Basis {
  if (card?.percent) return 'per_hire';
  if ((line.rates || []).some((r) => r.percent != null)) return 'percentage';
  if (card?.perPerson) return 'per_person';
  if (line.billing === 'one_time') return card?.perCountry || line.quantity > 1 ? 'per_action' : 'one_time';
  return 'monthly';
}

/** What one thing is, for a per-action fee: a visa, a country, else an action. */
function unitOf(line: CommercialLine, card: Card): string {
  if (/visa/i.test(`${line.serviceName} ${line.description || ''}`)) return 'visa';
  return card?.perCountry ? 'country' : 'action';
}

/** A line's shape in words: "per person per month", "9% of the annual package", "per visa", "one-time", "2 options",
 * "monthly". Pure. */
export function lineShape(line: CommercialLine, card: Card): string {
  const basis = lineBasis(line, card);
  if (basis === 'per_hire' || basis === 'percentage') {
    const pct = percentOf(line, card);
    const of = card?.percent?.basis ? ` ${card.percent.basis.replace(/^of\s+/i, 'of ')}` : '';
    return pct != null ? `${pct}%${of}` : basis === 'per_hire' ? 'per hire' : 'a percentage';
  }
  if (basis === 'per_person') return 'per person per month';
  if (basis === 'per_action') return `per ${unitOf(line, card)}`;
  if (basis === 'one_time') return 'one-time';
  // Monthly with no single price: packages to choose from, or priced by headcount.
  const priced = (line.rates || []).filter((r) => r.price != null);
  if (line.unitPrice == null && priced.length >= 2) return card?.hasPackages ? `${priced.length} options` : 'by headcount';
  return 'monthly';
}

/** What to say where a monthly figure would be blank: the lines' shapes, the first two. Null when there are no
 * lines to describe, or they add up to a monthly figure anyway. Pure. */
export function pricingShape(lines: CommercialLine[] | undefined, cardFor: CardFor): string | null {
  const ls = lines || [];
  if (!ls.length) return null;
  const monthly = ls.filter((l) => l.billing === 'monthly').map(lineAmount).some((v) => v != null);
  if (monthly) return null;
  const shapes = [...new Set(ls.map((l) => lineShape(l, cardFor(l))))];
  return shapes.slice(0, 2).join(' + ') + (shapes.length > 2 ? ` + ${shapes.length - 2} more` : '');
}

export interface FeeRow { id: number; service: string; detail: string; amount: string; rates: { label: string; value: string }[] }
export interface FeeGroup { basis: Basis; label: string; rows: FeeRow[]; /** The group's total, for the bases that add up. */ total: string | null }

const band = (r: { label: string; from?: number | null; to?: number | null }) => r.label || (r.from != null ? `${r.from}${r.to != null ? `–${r.to}` : '+'}` : '');

/** An agreement's lines grouped by how they are charged, in a fixed order, each with what it costs. Pure. */
export function feeGroups(lines: CommercialLine[] | undefined, cardFor: CardFor, currency: string): FeeGroup[] {
  const by = new Map<Basis, CommercialLine[]>();
  for (const l of lines || []) {
    const b = lineBasis(l, cardFor(l));
    if (!by.has(b)) by.set(b, []);
    by.get(b)!.push(l);
  }
  return BASIS_ORDER.filter((b) => by.has(b)).map((basis) => {
    const ls = by.get(basis)!;
    const rows: FeeRow[] = ls.map((l) => {
      const card = cardFor(l);
      const amount = lineAmount(l);
      const unit = basis === 'monthly' ? ' /mo' : basis === 'per_person' ? ' per person /mo' : basis === 'per_action' ? ` per ${unitOf(l, card)}` : '';
      const price = l.unitPrice != null ? `${fmtMoney(l.unitPrice, currency)}${unit}` : lineShape(l, card);
      const qty = l.quantity !== 1 && l.unitPrice != null ? `${l.quantity} × ` : '';
      return {
        id: l.id, service: l.serviceName || '—', detail: l.description || '',
        amount: basis === 'per_hire' || basis === 'percentage' ? lineShape(l, card) : basis === 'monthly' || basis === 'one_time' ? (amount != null ? `${fmtMoney(amount, currency)}${basis === 'monthly' ? ' /mo' : ''}` : price) : `${qty}${price}`,
        rates: (l.rates || []).map((r) => ({ label: band(r), value: r.percent != null ? `${r.percent}%` : r.price != null ? fmtMoney(r.price, currency) : '—' })),
      };
    });
    const sums = basis === 'monthly' || basis === 'one_time' ? ls.map(lineAmount).filter((v): v is number => v != null) : [];
    return { basis, label: BASIS_LABEL[basis], rows, total: sums.length > 1 ? `${fmtMoney(sums.reduce((a, b) => a + b, 0), currency)}${basis === 'monthly' ? ' /mo' : ''}` : null };
  });
}
