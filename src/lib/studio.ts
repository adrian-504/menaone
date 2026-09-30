// The proposal studio (studio slice): what the Generate sheet, the builder's
// proposal card and the deck tiles say, in plain words. The engine
// (generator.rs, smartfill.rs) is untouched; this only reads what it returns.
// Pure, except miniCoverHtml's escaping.

import { escHtml } from './utils';
import { fmtMoney, lineAmount } from './commercial';
import type { CommercialLine } from './types';

/** What each template placeholder is, as the generator's token list names it (generator.rs TOKENS). */
const FILL_LABELS: Record<string, string> = {
  client_name: 'Client name', client_legal_name: 'Legal name', client_city: 'City', client_country: 'Country', client_country_line: 'Country line',
  contact_name: 'Contact', contact_title: "Contact's role", contact_email: "Contact's email",
  proposal_ref: 'Reference', proposal_date: 'Date', proposal_date_ordinal: 'Date (with ordinal)', proposal_date_weekday: 'Date (with weekday)', proposal_date_short: 'Short date',
  valid_until: 'Valid until', services: 'Services', services_title: 'Cover title', currency: 'Currency',
  monthly_total: 'Monthly fee', one_time_total: 'One-time fee', contract_value: 'Contract value', contract_term: 'Term', vat_rate: 'VAT rate',
  entity_name: 'MENA BIG entity', entity_region: 'Entity region', owner_name: 'Proposal owner', owner_title: "Owner's role", owner_email: "Owner's email",
};

/** "client_name" → "Client name"; an unknown key is made readable, never shown raw. */
export function fillLabel(key: string): string {
  if (FILL_LABELS[key]) return FILL_LABELS[key];
  const words = key.replace(/^line\./, 'fee row ').replace(/[._]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The Filled in list: filled values in plain words, the short variants of the same date left out. */
export function fillList(values: Record<string, string>): { label: string; value: string }[] {
  const skip = new Set(['proposal_date_ordinal', 'proposal_date_weekday', 'proposal_date_short', 'client_country_line', 'entity_region']);
  return Object.entries(values).filter(([k, v]) => v && v.trim() && !skip.has(k)).map(([k, v]) => ({ label: fillLabel(k), value: v.trim() }));
}

/** "Slide 9: SAR 3,500 — Fees breakdown" → a sentence that names the slide and the amount. */
export function feeLine(raw: string): string {
  const m = /^Slide (\d+):\s*(.+?)(?:\s+—\s+(.+))?$/.exec(raw.trim());
  if (!m) return raw;
  const [, slide, amount, label] = m;
  if (/a percentage; set it by hand/.test(raw)) return `Slide ${slide} · ${amount.replace(/ — a percentage.*$/, '')} is a percentage — set it by hand in PowerPoint`;
  return `Slide ${slide}${label ? ` · ${label}` : ''} keeps the template's amount (${amount}) — check it in PowerPoint`;
}

/** A folder path as a breadcrumb from the OneDrive (or home) folder: "OneDrive › MENA BD 2026 › Proposals › Acme". */
export function breadcrumb(path: string | null | undefined, home = '/Users/'): string {
  if (!path) return '';
  const parts = path.split('/').filter(Boolean);
  const od = parts.findIndex((p) => /^OneDrive/i.test(p));
  if (od >= 0) return ['OneDrive', ...parts.slice(od + 1)].join(' › ');
  if (path.startsWith(home)) return ['Home', ...parts.slice(2)].join(' › ');
  return parts.join(' › ');
}

export interface SlideGroup { label: string; slides: { index: number; title: string; reason: string; on: boolean; number: string }[] }

/** Slides in template order, grouped where the source template changes ("Standard" for the deck it starts from). */
export function slideGroups(slides: { index: number; title: string; source?: string; reason: string }[], keep: Set<number>, base: string | null | undefined, short: (name: string) => string): SlideGroup[] {
  const out: SlideGroup[] = [];
  let n = 0;
  for (const s of slides) {
    const label = !s.source || s.source === base ? 'Standard' : short(s.source);
    if (!out.length || out[out.length - 1].label !== label) out.push({ label, slides: [] });
    const on = keep.has(s.index);
    if (on) n++;
    out[out.length - 1].slides.push({ index: s.index, title: s.title || 'Untitled', reason: s.reason, on, number: on ? String(n).padStart(2, '0') : '—' });
  }
  return out;
}

/** The brand mini-cover: navy block, three coral bars, the client in Saira. */
export function miniCoverHtml(client: string, label: string, sub = ''): string {
  return `<div class="mini-cover"><span class="bars" aria-hidden="true"><i></i><i></i><i></i></span><span class="mini-cover-client">${escHtml(client)}</span><span class="mini-cover-label">${escHtml(label)}${sub ? ` <span class="mini-cover-sub">· ${escHtml(sub)}</span>` : ''}</span></div>`;
}

/** A service row on the builder's proposal card: "Payroll · Monthly · SAR 5,000". Pure. */
export function cardLine(l: Pick<CommercialLine, 'serviceName' | 'billing' | 'unitPrice' | 'quantity'>, currency: string): string {
  const amount = lineAmount(l);
  return [l.serviceName.trim() || 'Service', l.billing === 'one_time' ? 'One-time' : 'Monthly', amount != null ? fmtMoney(amount, currency) : 'price to set'].join(' · ');
}
