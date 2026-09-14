// Service lines editor shared by the proposal page, the new-proposal page
// and the agreement page: one row per service with billing, quantity and
// price, and live totals. Services priced by rows (employee tranches,
// workforce categories, accountancy rows, staff types, countries) show those
// rows under the service, each with its own price and the rate card's range.

import { S } from './state';
import { escHtml, expose } from './utils';
import { icon } from './icons';
import { activeServices, fmtMoney, lineAmount, lineTotals, newLine, serviceById, serviceByName } from './commercial';
import { checkPrice, defaultRates, lineValue, presetFor, rowKind, rowPresets, singleRange, trancheLabel, type RowKind, type RowPreset } from './pricing';
import type { PricingService } from './constants';
import type { CommercialLine, LineRate, Service } from './types';

export interface LinesEditorContext {
  lines: () => CommercialLine[];
  setLines: (lines: CommercialLine[]) => void;
  currency: () => string;
  contractMonths: () => number | null;
  editable: boolean;
  /** Called after every change, with the lines already set. */
  onChange: () => void;
}

const editors = new Map<string, { containerId: string; ctx: LinesEditorContext }>();

function serviceOptions(selectedId: number | null, selectedName: string): string {
  const groups = new Map<string, string[]>();
  let found = false;
  for (const s of activeServices()) {
    const cat = s.category || 'Other';
    if (!groups.has(cat)) groups.set(cat, []);
    const sel = selectedId === s.id || (!selectedId && selectedName && s.name.toLowerCase() === selectedName.toLowerCase());
    if (sel) found = true;
    groups.get(cat)!.push(`<option value="${s.id}"${sel ? ' selected' : ''}>${escHtml(s.name)}</option>`);
  }
  const custom = !found && selectedName ? `<option value="custom" selected>${escHtml(selectedName)}</option>` : '';
  return `<option value=""${!found && !selectedName ? ' selected' : ''}>Choose a service…</option>${custom}`
    + [...groups.entries()].map(([cat, opts]) => `<optgroup label="${escHtml(cat)}">${opts.join('')}</optgroup>`).join('');
}

function cardFor(line: CommercialLine): PricingService | null {
  const service = serviceById(line.serviceId) || serviceByName(line.serviceName);
  const card = service?.rateCardId != null ? S.rateCards.find((r) => r.id === service.rateCardId) : undefined;
  return card?.pricing ?? null;
}

const n = (v: number) => v.toLocaleString();

function isWorkforce(line: CommercialLine): boolean {
  const service = serviceById(line.serviceId) || serviceByName(line.serviceName);
  return /workforce/i.test(`${line.serviceName} ${service?.category || ''}`) && !/mobili/i.test(line.serviceName);
}

function hasCommissionPrices(card: PricingService | null): boolean {
  return !!card && (card.commMin != null || !!card.tranches?.some((t) => t.commMin != null));
}

/** Keeps the line's price in step with its rows (tranche minimum, employees, counted rows). */
function syncValue(line: CommercialLine): void {
  const card = cardFor(line);
  if (!rowKind(card) || !(line.rates || []).length) return;
  line.unitPrice = lineValue(line, card).value;
  line.quantity = 1;
}

const ROW_NOUN: Record<RowKind, string> = { tranche: 'tranche', category: 'category', row: 'row', percent: 'staff type', country: 'country' };

function rateHint(rate: LineRate, preset: RowPreset | null, currency: string): string {
  if (!preset || currency !== 'SAR') return '';
  const value = preset.percent ? rate.percent : rate.price;
  const check = checkPrice(preset, value);
  const unit = preset.percent ? '%' : '';
  const range = preset.min === preset.max ? `${n(preset.min)}${unit}` : `${n(preset.min)}–${n(preset.max)}${unit}`;
  const flag = check === 'above' ? '<span class="le-flag">Above the rate card</span> ' : check === 'below' ? '<span class="le-flag">Below the rate card</span> ' : '';
  return `<span class="le-hint${check && check !== 'within' ? ' le-hint-off' : ''}">${flag}Standard ${n(preset.standard)}${unit} · ${range}</span>`;
}

function ratesBlock(key: string, line: CommercialLine, card: PricingService, kind: RowKind, currency: string): string {
  const rates = line.rates || [];
  const presets = rowPresets(card, line.commission);
  const unused = presets.filter((p) => !rates.some((r) => presetFor([p], r)));
  const noun = ROW_NOUN[kind];
  const value = lineValue(line, card);
  const summary = kind === 'tranche'
    ? value.basis === 'employees' && value.value != null ? `≈ ${fmtMoney(value.value, currency)}/month for ${line.employeeCount} employees` : value.value != null ? `Minimum ${fmtMoney(value.value, currency)}/month — add the number of employees for an estimate` : ''
    : kind === 'row' || kind === 'country' ? (value.value != null ? `${fmtMoney(value.value, currency)} counted in the totals` : 'Tick the rows that count in the totals') : 'Rates only — not counted in the totals';
  const row = (r: LineRate, i: number) => {
    const preset = presetFor(presets, r);
    const attr = (field: string) => `onchange="linesRate('${key}', ${line.id}, ${i}, '${field}', this.value)"`;
    return `<div class="le-rate">
      <input class="td-input le-rate-label" value="${escHtml(r.label)}" placeholder="${kind === 'country' ? 'Country' : 'Label'}" aria-label="Row label" ${attr('label')}>
      ${kind === 'tranche' ? `<span class="le-rate-range"><input class="td-input le-rate-num" type="number" min="1" value="${r.from ?? ''}" aria-label="From employees" ${attr('from')}><span>–</span><input class="td-input le-rate-num" type="number" min="1" value="${r.to ?? ''}" aria-label="To employees" ${attr('to')}></span>` : ''}
      ${kind === 'percent'
        ? `<span class="le-rate-value"><input class="td-input le-rate-price" type="number" min="0" max="100" step="0.5" value="${r.percent ?? ''}" aria-label="Percentage" ${attr('percent')}><span class="t-muted">%</span></span>`
        : `<span class="le-rate-value"><input class="td-input le-rate-price" type="number" min="0" step="50" value="${r.price ?? ''}" placeholder="0" aria-label="Price" ${attr('price')}><span class="t-muted">${kind === 'category' ? '/person' : ''}</span></span>`}
      ${kind === 'row' || kind === 'country' ? `<label class="le-comm" title="Counts in the proposal's monthly value"><input type="checkbox"${r.counts ? ' checked' : ''} onchange="linesRate('${key}', ${line.id}, ${i}, 'counts', this.checked ? '1' : '')"> In totals</label>` : ''}
      ${rateHint(r, preset, currency)}
      <button type="button" class="rec-icon-btn le-rate-remove" onclick="linesRate('${key}', ${line.id}, ${i}, 'remove', '')" title="Remove ${noun}" aria-label="Remove ${noun}">${icon('close', 12)}</button>
    </div>`;
  };
  return `<div class="le-rates">
    <div class="le-pricing-row">
      ${kind === 'tranche' ? `<label class="le-comm">Employees <input class="td-input le-rate-num" type="number" min="0" value="${line.employeeCount ?? ''}" placeholder="?" onchange="linesEdit('${key}', ${line.id}, 'employeeCount', this.value)"></label>` : ''}
      ${hasCommissionPrices(card) || line.commission ? `<label class="le-comm"><input type="checkbox"${line.commission ? ' checked' : ''} onchange="linesEdit('${key}', ${line.id}, 'commission', this.checked ? '1' : '')"> With commission</label>` : ''}
      ${kind === 'category' && isWorkforce(line) ? `<label class="le-comm"><input type="checkbox"${line.withRecruitment ? ' checked' : ''} onchange="linesEdit('${key}', ${line.id}, 'withRecruitment', this.checked ? '1' : '')"> Includes recruitment</label>` : ''}
      ${summary ? `<span class="le-hint">${escHtml(summary)}</span>` : ''}
    </div>
    ${rates.map(row).join('')}
    <select class="td-select le-rate-add" aria-label="Add ${noun}" onchange="linesRate('${key}', ${line.id}, -1, 'add', this.value)">
      <option value="">+ Add ${noun}…</option>
      ${unused.map((p) => `<option value="${escHtml(p.label)}">${escHtml(p.label)} · ${p.percent ? `${p.standard}%` : n(p.standard)}</option>`).join('')}
      <option value="__custom">Custom ${noun}</option>
    </select>
  </div>`;
}

function singleHint(key: string, line: CommercialLine, card: PricingService | null, currency: string): string {
  const o = singleRange(card, line.commission);
  if (!o || currency !== 'SAR') return '';
  if (o.unit === 'percent') return `<div class="le-hint">Usually ${o.standard}% (${o.min}–${o.max}%)</div>`;
  const check = checkPrice(o, line.unitPrice);
  const range = o.min === o.max ? n(o.min) : `${n(o.min)}–${n(o.max)}`;
  const use = line.unitPrice !== o.standard ? ` <button type="button" class="le-use" onclick="linesEdit('${key}', ${line.id}, 'unitPrice', '${o.standard}')" title="Use the standard price">Use ${n(o.standard)}</button>` : '';
  const flag = check === 'above' ? '<span class="le-flag">Above the rate card</span> ' : check === 'below' ? '<span class="le-flag">Below the rate card</span> ' : '';
  return `<div class="le-hint${check && check !== 'within' ? ' le-hint-off' : ''}">${flag}Standard ${n(o.standard)} · ${range}${use}</div>`;
}

function readOnlyRates(line: CommercialLine, currency: string): string {
  const rates = line.rates || [];
  if (!rates.length) return '';
  return `<ul class="le-rates-list">${rates.map((r) => {
    const label = r.label || trancheLabel(r.from, r.to);
    const value = r.percent != null ? `${r.percent}%` : r.price != null ? fmtMoney(r.price, currency) : '—';
    return `<li><span>${escHtml(label)}</span><span>${escHtml(value)}</span></li>`;
  }).join('')}</ul>${line.employeeCount ? `<div class="le-desc-text">${line.employeeCount} employees</div>` : ''}`;
}

export function renderLinesEditor(key: string, containerId: string, ctx: LinesEditorContext): void {
  editors.set(key, { containerId, ctx });
  const el = document.getElementById(containerId);
  if (!el) return;
  const lines = ctx.lines();
  const currency = ctx.currency();
  const k = escHtml(key);
  const totals = lineTotals(lines, ctx.contractMonths());
  const rows = lines.map((l) => {
    const amount = lineAmount(l);
    if (!ctx.editable) {
      return `<tr>
        <td><div class="le-service">${escHtml(l.serviceName || '—')}</div>${l.description ? `<div class="le-desc-text">${escHtml(l.description)}</div>` : ''}${readOnlyRates(l, currency)}</td>
        <td class="le-billing">${l.billing === 'one_time' ? 'One-time' : 'Monthly'}</td>
        <td class="num">${l.quantity}</td>
        <td class="num">${l.unitPrice != null ? fmtMoney(l.unitPrice, currency) : '—'}</td>
        <td class="num strong">${amount != null ? fmtMoney(amount, currency) : '—'}</td>
      </tr>`;
    }
    const card = cardFor(l);
    const kind = rowKind(card);
    // Older lines (before priced rows) keep their single price until switched.
    const byRows = !!kind && !!card && (l.rates || []).length > 0;
    return `<tr data-line-id="${l.id}"${byRows ? ' class="le-has-rates"' : ''}>
      <td class="le-service-cell">
        <select class="td-select le-service-sel" aria-label="Service" onchange="linesEdit('${k}', ${l.id}, 'service', this.value)">${serviceOptions(l.serviceId, l.serviceName)}</select>
        ${!byRows && kind ? `<div class="le-pricing-row"><button type="button" class="le-use" onclick="linesEdit('${k}', ${l.id}, 'useRows', '')">Price by ${kind === 'category' ? 'categories' : kind === 'percent' ? 'staff type' : kind === 'country' ? 'country' : ROW_NOUN[kind] + 's'}</button></div>` : ''}
        ${!byRows && hasCommissionPrices(card) ? `<div class="le-pricing-row"><label class="le-comm"><input type="checkbox"${l.commission ? ' checked' : ''} onchange="linesEdit('${k}', ${l.id}, 'commission', this.checked ? '1' : '')"> With commission</label></div>` : ''}
        <input class="td-input le-desc" value="${escHtml(l.description || '')}" placeholder="Scope or notes (optional)" aria-label="Description" onchange="linesEdit('${k}', ${l.id}, 'description', this.value)">
      </td>
      <td><select class="td-select le-billing-sel" aria-label="Billing" onchange="linesEdit('${k}', ${l.id}, 'billing', this.value)">
        <option value="monthly"${l.billing === 'monthly' ? ' selected' : ''}>Monthly</option>
        <option value="one_time"${l.billing === 'one_time' ? ' selected' : ''}>One-time</option>
      </select></td>
      <td class="num">${byRows ? '<span class="t-muted">—</span>' : `<input class="td-input le-qty" type="number" min="1" step="1" value="${l.quantity}" aria-label="Quantity" onchange="linesEdit('${k}', ${l.id}, 'quantity', this.value)">`}</td>
      <td class="num">
        ${byRows
          ? `<span class="le-computed" title="Worked out from the rows below">${l.unitPrice != null ? n(l.unitPrice) : 'Rates'}</span>`
          : `<input class="td-input le-price" type="number" min="0" step="50" value="${l.unitPrice ?? ''}" placeholder="0" aria-label="Unit price" onchange="linesEdit('${k}', ${l.id}, 'unitPrice', this.value)">${singleHint(k, l, card, currency)}`}
      </td>
      <td class="num strong le-amount">${amount != null ? fmtMoney(amount, currency) : '—'}</td>
      <td class="le-remove"><button type="button" class="rec-icon-btn" onclick="linesEdit('${k}', ${l.id}, 'remove', '')" title="Remove service" aria-label="Remove service">${icon('close', 13)}</button></td>
    </tr>${byRows ? `<tr class="le-rates-tr" data-line-id="${l.id}"><td colspan="6">${ratesBlock(k, l, card!, kind!, currency)}</td></tr>` : ''}`;
  }).join('');
  const months = ctx.contractMonths();
  el.innerHTML = `
    <div class="tbl-wrap le-wrap"><table class="le-table">
      <thead><tr><th>Service</th><th>Billing</th><th class="num">Qty</th><th class="num">Price (${escHtml(currency)})</th><th class="num">Amount</th>${ctx.editable ? '<th></th>' : ''}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${ctx.editable ? 6 : 5}" class="le-empty">No services yet${ctx.editable ? ' — add the first one below.' : '.'}</td></tr>`}</tbody>
    </table></div>
    <div class="le-footer">
      ${ctx.editable ? `<button type="button" class="btn-secondary btn-compact" onclick="linesEdit('${k}', 0, 'add', '')">${icon('plus', 13)} Add service</button>` : '<span></span>'}
      <dl class="le-totals">
        <div><dt>Monthly</dt><dd>${totals.monthly != null ? fmtMoney(totals.monthly, currency) : '—'}</dd></div>
        <div><dt>One-time</dt><dd>${totals.oneTime != null ? fmtMoney(totals.oneTime, currency) : '—'}</dd></div>
        <div class="le-total-main"><dt>Contract value${months ? ` · ${months} mo` : ''}</dt><dd>${totals.contractValue != null ? fmtMoney(totals.contractValue, currency) : '—'}</dd></div>
      </dl>
    </div>`;
}

/** A new line for a service, starting with its rate card's rows and standard price. */
export function lineForService(service: Service | null, sortOrder: number): CommercialLine {
  const l = newLine(service, sortOrder);
  const card = cardFor(l);
  l.rates = defaultRates(card, false, null);
  if (rowKind(card)) syncValue(l);
  else if (l.unitPrice == null) {
    const single = singleRange(card, false);
    if (single && single.unit !== 'percent') l.unitPrice = single.standard;
  }
  return l;
}

function commit(key: string, lines: CommercialLine[], focusLast = false): void {
  const entry = editors.get(key);
  if (!entry) return;
  const { ctx, containerId } = entry;
  lines.forEach((l, idx) => { l.sortOrder = idx; });
  ctx.setLines(lines);
  renderLinesEditor(key, containerId, ctx);
  ctx.onChange();
  if (focusLast) {
    const sels = document.querySelectorAll<HTMLSelectElement>(`#${containerId} .le-service-sel`);
    sels[sels.length - 1]?.focus();
  }
}

export function linesEdit(key: string, lineId: number, field: string, value: string): void {
  const entry = editors.get(key);
  if (!entry) return;
  const lines: CommercialLine[] = entry.ctx.lines().map((l) => ({ ...l, rates: (l.rates || []).map((r) => ({ ...r })) }));
  if (field === 'add') {
    lines.push(newLine(null, lines.length));
    commit(key, lines, true);
    return;
  }
  const i = lines.findIndex((l) => l.id === lineId);
  if (i < 0) return;
  const l = lines[i];
  switch (field) {
    case 'remove': lines.splice(i, 1); break;
    case 'service': {
      if (value === 'custom') break;
      const svc = S.services.find((s) => s.id === Number(value));
      l.serviceId = svc?.id ?? null;
      l.serviceName = svc?.name ?? '';
      if (svc) l.billing = svc.billing;
      const card = cardFor(l);
      l.rates = defaultRates(card, l.commission, l.employeeCount);
      if (rowKind(card)) {
        syncValue(l);
      } else {
        if (l.unitPrice == null && svc?.defaultPrice != null) l.unitPrice = svc.defaultPrice;
        // A single-range card (Constitution, Liquidation, Maintenance) suggests its standard straight away.
        const single = singleRange(card, l.commission);
        if (l.unitPrice == null && single && single.unit !== 'percent') l.unitPrice = single.standard;
      }
      break;
    }
    case 'description': l.description = value.trim() || null; break;
    case 'commission': {
      const before = rowPresets(cardFor(l), l.commission);
      l.commission = value === '1';
      const after = rowPresets(cardFor(l), l.commission);
      // Rows still at the old standard move to the new one.
      for (const r of l.rates || []) {
        const was = presetFor(before, r);
        const now = presetFor(after, r);
        if (was && now && !was.percent && r.price === was.standard) r.price = now.standard;
      }
      const wasSingle = singleRange(cardFor({ ...l, commission: !l.commission }), !l.commission);
      const nowSingle = singleRange(cardFor(l), l.commission);
      if (wasSingle && nowSingle && l.unitPrice === wasSingle.standard) l.unitPrice = nowSingle.standard;
      syncValue(l);
      break;
    }
    case 'employeeCount': l.employeeCount = value.trim() === '' ? null : Math.max(0, Math.round(Number(value) || 0)) || null; syncValue(l); break;
    case 'withRecruitment': l.withRecruitment = value === '1'; break;
    case 'useRows': l.rates = defaultRates(cardFor(l), l.commission, l.employeeCount); syncValue(l); break;
    case 'billing': l.billing = value === 'one_time' ? 'one_time' : 'monthly'; break;
    case 'quantity': l.quantity = Math.max(1, Number(value) || 1); break;
    case 'unitPrice': l.unitPrice = value.trim() === '' ? null : Math.max(0, Number(value)); break;
  }
  commit(key, lines);
}
expose('linesEdit', linesEdit);

/** Edits one priced row of a line; index -1 with 'add' adds a preset or a custom row. */
export function linesRate(key: string, lineId: number, index: number, field: string, value: string): void {
  const entry = editors.get(key);
  if (!entry) return;
  const lines: CommercialLine[] = entry.ctx.lines().map((l) => ({ ...l, rates: (l.rates || []).map((r) => ({ ...r })) }));
  const l = lines.find((x) => x.id === lineId);
  if (!l) return;
  const card = cardFor(l);
  const kind = rowKind(card);
  const rates = (l.rates = l.rates || []);
  const num = (v: string) => (v.trim() === '' ? null : Math.max(0, Number(v)));
  if (field === 'add') {
    if (!value) return;
    const preset = rowPresets(card, l.commission).find((p) => p.label === value);
    const last = [...rates].reverse().find((r) => r.to != null);
    rates.push(preset
      ? { label: preset.label, from: preset.from, to: preset.to, price: preset.percent ? null : preset.standard, percent: preset.percent ? preset.standard : null, counts: false }
      : kind === 'tranche' ? { label: '', from: last?.to != null ? last.to + 1 : 1, to: null, price: null, counts: false }
      : kind === 'percent' ? { label: '', percent: 10, counts: false }
      : { label: '', price: null, counts: false });
    if (kind === 'tranche') rates.sort((a, b) => (a.to ?? Infinity) - (b.to ?? Infinity));
  } else {
    const r = rates[index];
    if (!r) return;
    switch (field) {
      case 'remove': rates.splice(index, 1); break;
      case 'label': r.label = value.trim(); break;
      case 'from': case 'to': {
        const v = num(value);
        r[field] = v == null ? null : Math.round(v);
        const wasAuto = !r.label || /^\d+\s*[-–]\s*\d+ employees$|^Up to \d+ employees$|^\d+\+ employees$/.test(r.label);
        if (wasAuto) r.label = trancheLabel(r.from, r.to);
        rates.sort((a, b) => (a.to ?? Infinity) - (b.to ?? Infinity));
        break;
      }
      case 'price': r.price = num(value); break;
      case 'percent': r.percent = num(value); break;
      case 'counts': r.counts = value === '1'; break;
    }
  }
  syncValue(l);
  commit(key, lines);
}
expose('linesRate', linesRate);
