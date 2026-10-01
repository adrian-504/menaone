// A custom line (1.66): a named service outside the catalogue with its own
// price, unit and a short scope text. Its unit decides its billing, so the two
// can never disagree — billing stays the only thing totals read:
//
// - per month → billing 'monthly'; one-time → billing 'one_time'. The amount is
//   the line's unit price, and it counts in the totals.
// - per person per month → 'monthly'; per visa and % of annual package →
//   'one_time'. These are not a sum: the price lives in the line's one priced
//   row (as the catalogue's per-person and percentage lines already do) and
//   the unit price is empty, so no total, anywhere, can count it.
//
// The same rule runs when lines are saved (commercial.rs normalize_custom_line).
// Pure.

import type { CommercialLine, LineUnit } from './types';

export const LINE_UNITS: [LineUnit, string][] = [
  ['per_month', 'Per month'], ['per_person_per_month', 'Per person per month'], ['per_visa', 'Per visa'],
  ['one_time', 'One-time'], ['percent_of_annual_package', '% of annual package'],
];
const LABEL = Object.fromEntries(LINE_UNITS) as Record<LineUnit, string>;
export const unitLabel = (u: LineUnit): string => LABEL[u];

/** Units whose price is a sum that counts: per month and one-time. */
export const unitCounts = (u: LineUnit | null | undefined): boolean => u === 'per_month' || u === 'one_time';
export const isCustomLine = (l: Pick<CommercialLine, 'unit'>): boolean => !!l.unit;

/** A custom line's price, whatever its unit: the unit price, or its priced row's price or percentage. */
export function customPrice(l: Pick<CommercialLine, 'unit' | 'unitPrice' | 'rates'>): number | null {
  if (!l.unit) return l.unitPrice ?? null;
  if (unitCounts(l.unit)) return l.unitPrice ?? null;
  const row = l.rates?.[0];
  return (l.unit === 'percent_of_annual_package' ? row?.percent : row?.price) ?? null;
}

/** A custom line as it is saved: billing follows the unit, and a price that is not a sum sits in its priced row. A
 * line with no unit (a catalogue line) or a unit it does not know comes back unchanged (the unknown unit dropped). */
export function normalizeCustomLine<T extends CommercialLine>(l: T): T {
  const unit = l.unit;
  if (!unit) return l.unit === undefined ? l : { ...l, unit: null };
  if (!(unit in LABEL)) return { ...l, unit: null };
  if (unit === 'per_month') return { ...l, billing: 'monthly' };
  if (unit === 'one_time') return { ...l, billing: 'one_time' };
  const price = l.unitPrice ?? customPrice(l);
  const row = { label: LABEL[unit] };
  return { ...l, billing: unit === 'per_person_per_month' ? 'monthly' : 'one_time', unitPrice: null, quantity: 1,
    rates: [unit === 'percent_of_annual_package' ? { ...row, percent: price } : { ...row, price }] };
}

/** "SAR 150 per person per month", "12% of annual package", "SAR 4,000 per month": how a custom line reads. */
export function customPriceText(l: Pick<CommercialLine, 'unit' | 'unitPrice' | 'rates'>, money: (n: number) => string): string {
  if (!l.unit) return '';
  const price = customPrice(l);
  if (price == null) return unitLabel(l.unit).toLowerCase();
  return l.unit === 'percent_of_annual_package' ? `${price}% of annual package` : `${money(price)} ${unitLabel(l.unit).toLowerCase()}`;
}
