// Rate-card pricing as the team uses it. Every price is a range with a usual
// ("standard") figure. Services priced by rows — employee tranches (Admin &
// PRO, Payroll & GOSI), workforce categories, accountancy rows, recruitment
// staff types, mobilization countries — carry those rows on the proposal line,
// each with its own price, and the deck's fee table lists exactly them
// (generator.rs / smartfill.rs). Pure.

import type { PricingService } from './constants';
import type { CommercialLine, LineRate } from './types';

export type PriceUnit = 'month' | 'one_time' | 'percent';

export interface PriceOption {
  label: string;
  min: number;
  standard: number;
  max: number;
  unit: PriceUnit;
}

/** How a service's proposal rows work. */
export type RowKind = 'tranche' | 'category' | 'row' | 'percent' | 'country';

export interface RowPreset {
  label: string;
  from: number | null;
  to: number | null;
  min: number;
  standard: number;
  max: number;
  percent: boolean;
  counts: boolean;
}

const round50 = (n: number) => Math.round(n / 50) * 50;
const standardOf = (min: number, max: number, standard?: number) => (standard != null && standard >= min && standard <= max ? standard : round50((min + max) / 2));

/** "1–5 employees" → 1..5; "25 employees and below" → 1..25. */
export function parseRange(label: string): { from: number; to: number } | null {
  const range = label.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (range) return { from: Number(range[1]), to: Number(range[2]) };
  const below = label.match(/(\d+)\s*employees?\s*and\s*below/i);
  return below ? { from: 1, to: Number(below[1]) } : null;
}

export function trancheLabel(from: number | null | undefined, to: number | null | undefined): string {
  if (from != null && to != null) return `${from}–${to} employees`;
  if (to != null) return `Up to ${to} employees`;
  return from != null ? `${from}+ employees` : '';
}

export function rowKind(card: PricingService | null | undefined): RowKind | null {
  if (!card) return null;
  if (card.perCountry) return 'country';
  if (card.rows?.length) return card.rows.every((r) => r.percent) ? 'percent' : 'row';
  if (card.hasTranches && card.tranches?.length) return card.tranches.every((t) => parseRange(t.label)) ? 'tranche' : 'category';
  return null;
}

/** Rows a rate card suggests for a proposal, with or without commission. */
export function rowPresets(card: PricingService | null | undefined, commission = false): RowPreset[] {
  const kind = rowKind(card);
  if (!card || !kind) return [];
  if (kind === 'row' || kind === 'percent') {
    return (card.rows || []).map((r) => ({ label: r.label, from: null, to: null, min: r.min, standard: standardOf(r.min, r.max, r.standard), max: r.max, percent: !!r.percent, counts: !!r.counts }));
  }
  if (kind === 'country') return [];
  return (card.tranches || []).flatMap((t) => {
    const [min, max] = commission ? [t.commMin, t.commMax] : [t.noCommMin, t.noCommMax];
    if (min == null || max == null) return [];
    const range = parseRange(t.label);
    return [{ label: t.label, from: range?.from ?? null, to: range?.to ?? null, min, max, standard: standardOf(min, max), percent: false, counts: false }];
  });
}

/** The preset a row came from: same band limits, else the same label. */
export function presetFor(presets: RowPreset[], rate: LineRate): RowPreset | null {
  if (rate.to != null) {
    const band = presets.find((p) => p.to === rate.to && (p.from ?? null) === (rate.from ?? null));
    if (band) return band;
  }
  const label = rate.label.trim().toLowerCase();
  return presets.find((p) => p.label.toLowerCase() === label) || null;
}

const toRate = (p: RowPreset): LineRate => ({
  label: p.label,
  from: p.from,
  to: p.to,
  price: p.percent ? null : p.standard,
  percent: p.percent ? p.standard : null,
  counts: p.counts,
});

/**
 * The rows a new line starts with: three tranches (around the client's band
 * when the employee count is known), every workforce category and accountancy
 * row, the first recruitment staff type, one empty country.
 */
export function defaultRates(card: PricingService | null | undefined, commission = false, employeeCount?: number | null): LineRate[] {
  const kind = rowKind(card);
  const presets = rowPresets(card, commission);
  switch (kind) {
    case 'tranche': {
      const count = card?.showBands || 3;
      const at = employeeCount ? Math.max(0, presets.findIndex((p) => p.to != null && employeeCount <= p.to)) : 0;
      const start = Math.max(0, Math.min(at - 1, presets.length - count));
      return presets.slice(start, start + count).map(toRate);
    }
    case 'category':
    case 'row':
      return presets.map(toRate);
    case 'percent':
      return presets.slice(0, 1).map(toRate);
    case 'country':
      return [{ label: '', price: null, counts: false }];
    default:
      return [];
  }
}

/**
 * Monthly invoice for a number of employees across the tranches. Band 1 is a
 * minimum; above it, each extra employee costs (band price ÷ band upper limit),
 * added on top of the invoice at the previous band's limit.
 */
export function trancheInvoice(rates: LineRate[], employees: number): number | null {
  const bands = rates.filter((r) => r.to != null && r.to > 0 && r.price != null).sort((a, b) => a.to! - b.to!);
  if (!bands.length || employees <= 0) return null;
  let total = bands[0].price!;
  let prev = bands[0].to!;
  if (employees <= prev) return total;
  for (let i = 1; i < bands.length && prev < employees; i++) {
    const per = bands[i].price! / bands[i].to!;
    const upto = Math.min(employees, bands[i].to!);
    total += per * (upto - prev);
    prev = upto;
  }
  if (employees > prev) {
    const last = bands[bands.length - 1];
    total += (last.price! / last.to!) * (employees - prev);
  }
  return Math.round(total);
}

export interface LineValue {
  /** Monthly (or one-time) value used in totals; null when only rates are quoted. */
  value: number | null;
  /** How it was worked out, for the editor. */
  basis: 'employees' | 'minimum' | 'rows' | 'rates' | 'price';
}

export function lineValue(line: Pick<CommercialLine, 'rates' | 'employeeCount' | 'unitPrice' | 'quantity'>, card: PricingService | null | undefined): LineValue {
  const kind = rowKind(card);
  const rates = line.rates || [];
  if (!kind || !rates.length) return { value: line.unitPrice, basis: 'price' };
  if (kind === 'tranche') {
    if (line.employeeCount && line.employeeCount > 0) return { value: trancheInvoice(rates, line.employeeCount), basis: 'employees' };
    const lowest = rates.filter((r) => r.price != null).sort((a, b) => (a.to ?? Infinity) - (b.to ?? Infinity))[0];
    return { value: lowest?.price ?? null, basis: 'minimum' };
  }
  if (kind === 'row' || kind === 'country') {
    const counted = rates.filter((r) => r.counts && r.price != null);
    return counted.length ? { value: counted.reduce((a, r) => a + r.price!, 0), basis: 'rows' } : { value: null, basis: 'rates' };
  }
  return { value: null, basis: 'rates' };
}

// ── Single-range cards (Maintenance, Labor Law, Constitution, Liquidation…) ──

/** The standard price and range of a card priced as one figure. */
export function singleRange(card: PricingService | null | undefined, commission = false): PriceOption | null {
  if (!card || rowKind(card)) return null;
  const unit: PriceUnit = card.oneTime ? 'one_time' : 'month';
  if (card.percent) return { label: '', min: card.percent.min, standard: card.percent.standard, max: card.percent.max, unit: 'percent' };
  const [min, max] = commission && card.commMin != null && card.commMax != null ? [card.commMin, card.commMax] : [card.noCommMin, card.noCommMax];
  if (min == null || max == null) return null;
  return { label: '', min, max, standard: standardOf(min, max, commission ? undefined : card.standard), unit };
}

export type RangeCheck = 'below' | 'within' | 'above';

export function checkPrice(range: { min: number; max: number } | null, price: number | null | undefined): RangeCheck | null {
  if (!range || price == null) return null;
  return price < range.min ? 'below' : price > range.max ? 'above' : 'within';
}
