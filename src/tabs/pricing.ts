import type { PricingService } from '../lib/constants';
import { S } from '../lib/state';
import { emptyState, toast } from '../lib/ui';
import { escHtml, expose } from '../lib/utils';
import { registerTabRenderer } from '../lib/registry';
import { saveService, saveRateCard, getCommercialSetup } from '../lib/db';
import { AGR_TYPES } from '../lib/constants';
import { priceRange, fmtMoney } from '../lib/commercial';
import { renderIcons } from '../core/chrome';
import { renderTemplatesView } from './templates';
import type { RateCard, Service } from '../lib/types';

// Services: the editable catalog (what we sell, how it's billed, what
// agreement it becomes) and the rate card behind suggested prices.

let view: 'catalog' | 'rates' | 'templates' = 'catalog';

export function setServicesView(v: 'catalog' | 'rates' | 'templates'): void {
  view = v;
  document.querySelectorAll<HTMLElement>('[data-svc-view]').forEach((b) => b.classList.toggle('active', b.dataset.svcView === v));
  renderPricingTab();
}
expose('setServicesView', setServicesView);

// ── Pricing Reference Tab
//
// Redesigned from one long flat table (tranche rows, package rows and flat
// rows all interleaved in the same 5 columns) into one card per service.
// Each card renders only the pricing shape that service actually has —
// a mini tranche table, a 2-up package grid, or a single flat range — so
// scanning the reference no longer means parsing ~35 rows of a table whose
// column meaning changed depending on which kind of row you were looking at.

function fmtSarRange(min: number, max: number): string {
  return `SAR ${min.toLocaleString()}–${max.toLocaleString()}`;
}

function renderRateCard(svc: PricingService): string {
  let body = '';
  if (svc.hasTranches && svc.tranches) {
    body += `<table class="price-mini-table"><thead><tr><th>${escHtml(svc.trancheLabel || 'Tier')}</th><th>Without Comm.</th><th>With Comm.</th>${svc.tranches.some((t) => t.volMin) ? '<th>Volume</th>' : ''}</tr></thead><tbody>`;
    svc.tranches.forEach((tr) => {
      const commRange = tr.commMin ? fmtSarRange(tr.commMin, tr.commMax!) : '<span class="t-muted">N/A</span>';
      const volCell = svc.tranches!.some((t) => t.volMin) ? `<td>${tr.volMin ? `SAR ${tr.volMin.toLocaleString()}` : '<span class="t-muted">—</span>'}</td>` : '';
      body += `<tr><td>${escHtml(tr.label)}</td><td class="price-range">${fmtSarRange(tr.noCommMin, tr.noCommMax)}</td><td>${commRange}</td>${volCell}</tr>`;
    });
    body += '</tbody></table>';
  } else if (svc.hasPackages && svc.packages) {
    body += `<div class="price-pkg-grid">${svc.packages.map((pkg) => `<div class="price-pkg-chip"><div class="price-pkg-chip-name">${escHtml(pkg.name)}</div><div class="price-pkg-chip-range">${fmtSarRange(pkg.min, pkg.max)}</div></div>`).join('')}</div>`;
  } else if (svc.percent) {
    body += `<div><div class="price-flat-range">${svc.percent.standard}%<span class="t-meta t-sub fw-400"> ${escHtml(svc.percent.basis)}</span></div><div class="price-flat-sub">Range ${svc.percent.min}–${svc.percent.max}%</div></div>`;
  } else if (svc.rows?.length || svc.perCountry) {
    // Shown below.
  } else if (svc.noCommMin != null && svc.noCommMax != null) {
    const commLine = svc.commMin ? `<div class="price-flat-sub">With commission: ${fmtSarRange(svc.commMin, svc.commMax!)}</div>` : '';
    const standard = svc.standard != null ? `<div class="price-flat-sub">Standard SAR ${svc.standard.toLocaleString()}</div>` : '';
    body += `<div><div class="price-flat-range">${fmtSarRange(svc.noCommMin, svc.noCommMax)}${!svc.oneTime ? '<span class="t-meta t-sub fw-400">/mo</span>' : ''}</div>${standard}${commLine}</div>`;
  }
  const notes = [
    svc.showBands ? `Proposals show ${svc.showBands} bands around the client's` : '',
    svc.perPerson ? 'Per person per month' : '',
    svc.minimumMonths ? `${svc.minimumMonths}-month minimum` : '',
  ].filter(Boolean);
  if (svc.rows?.length) body += `<table class="price-mini-table"><thead><tr><th>Proposal rows</th><th>Range</th><th>Standard</th></tr></thead><tbody>${svc.rows.map((r) => `<tr><td>${escHtml(r.label)}</td><td>${r.percent ? `${r.min}–${r.max}%` : fmtSarRange(r.min, r.max)}</td><td>${r.percent ? `${r.standard}%` : `SAR ${r.standard.toLocaleString()}`}</td></tr>`).join('')}</tbody></table>`;
  if (svc.perCountry) body += '<div class="price-flat-sub">Priced per country on each proposal</div>';
  if (svc.milestones?.length) body += `<ul class="price-milestones">${svc.milestones.map((m) => `<li>${escHtml(m)}</li>`).join('')}</ul>`;
  if (notes.length) body += `<div class="price-flat-sub">${notes.map(escHtml).join(' · ')}</div>`;
  const bundleStrip = svc.bundles && svc.bundles.length > 0
    ? `<div class="price-bundle-strip">${svc.bundles.map((b) => `<span class="price-bundle">${escHtml(b.name)}: SAR ${b.price.toLocaleString()}</span>`).join('')}</div>`
    : '';
  return `<div class="price-card">
    <div class="price-card-hd">
      <div><div class="price-card-name">${escHtml(svc.name)}</div><div class="price-card-cat">${escHtml(svc.cat || '')}</div></div>
      ${svc.oneTime ? '<span class="price-card-onetime">One-time</span>' : ''}
    </div>
    <div class="price-card-body">${body}${bundleStrip}</div>
  </div>`;
}

function usage(service: Service): number {
  return S.proposals.filter((p) => (p.lines || []).some((l) => l.serviceId === service.id || l.serviceName === service.name)).length;
}

function renderCatalog(search: string, cat: string): string {
  const showInactive = (document.getElementById('svc-show-inactive') as HTMLInputElement | null)?.checked || false;
  const services = S.services.filter((s) => (showInactive || s.active) && (!cat || s.category === cat) && (!search || `${s.name} ${s.category || ''} ${s.agreementType || ''}`.toLowerCase().includes(search)));
  if (!services.length) return emptyState({ icon: 'search', title: 'No services match', body: 'Try a different search or category.', compact: true });
  const groups = new Map<string, Service[]>();
  for (const s of services) {
    const c = s.category || 'Other';
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(s);
  }
  return [...groups.entries()].map(([category, list]) => `<section class="card svc-group">
    <div class="rec-section-hd"><h2>${escHtml(category)}</h2><span class="rec-count">${list.length}</span></div>
    <div class="rec-list">${list.map((s) => {
      const range = priceRange(s);
      const pct = S.rateCards.find((r) => r.id === s.rateCardId)?.pricing?.percent;
      const card = S.rateCards.find((r) => r.id === s.rateCardId);
      const used = usage(s);
      return `<div class="rec-row${s.active ? '' : ' is-unavailable'}" onclick="openServiceEditor(${s.id})">
        <span class="rec-row-icon">${escHtml(s.name.slice(0, 1))}</span>
        <div class="rec-row-main">
          <div class="rec-row-title">${escHtml(s.name)}${s.active ? '' : ' <span class="rec-badge">Retired</span>'}</div>
          <div class="rec-row-sub">${[s.billing === 'one_time' ? 'One-time' : 'Monthly', s.agreementType ? `${s.agreementType} agreement` : '', card ? `Rate card: ${card.name}` : 'No rate card', used ? `On ${used} proposal${used === 1 ? '' : 's'}` : ''].filter(Boolean).map(escHtml).join(' · ')}</div>
        </div>
        <span class="rec-row-value">${pct ? `${pct.standard}% (${pct.min}–${pct.max}%)` : range ? (range.min === range.max ? fmtMoney(range.min) : `SAR ${range.min.toLocaleString()}–${range.max.toLocaleString()}`) : s.defaultPrice != null ? fmtMoney(s.defaultPrice) : ''}</span>
      </div>`;
    }).join('')}</div>
  </section>`).join('');
}

function renderRates(search: string, cat: string): string {
  const cards = S.rateCards.filter((r) => r.pricing && (!cat || r.category === cat) && (!search || r.name.toLowerCase().includes(search)));
  let html = cards.length
    ? `<div class="price-cards">${cards.map((r) => `<div class="price-card-wrap" role="button" tabindex="0" title="Edit prices" onclick="openRateCardEditor(${r.id})" onkeydown="if(event.key==='Enter')openRateCardEditor(${r.id})">${renderRateCard({ ...r.pricing!, name: r.name, cat: r.category || '' })}</div>`).join('')}</div>`
    : emptyState({ icon: 'search', title: 'No rate cards match', body: 'Try a different term or clear the category filter.', compact: true });
  const addons = S.rateCards.filter((r) => !cat || r.category === cat).flatMap((r) => (r.addons || []).map((a) => ({ ...a, svc: r.name })))
    .filter((a) => !search || a.action.toLowerCase().includes(search) || a.svc.toLowerCase().includes(search));
  if (addons.length) {
    html += '<div class="price-section-hd">Add-on fees</div>';
    const bySvc = new Map<string, typeof addons>();
    addons.forEach((a) => { if (!bySvc.has(a.svc)) bySvc.set(a.svc, []); bySvc.get(a.svc)!.push(a); });
    [...bySvc.entries()].forEach(([svcName, items]) => {
      html += `<details class="price-addons-group"${search ? ' open' : ''}><summary>${escHtml(svcName)} <span class="t-meta t-muted fw-400">${items.length} item${items.length !== 1 ? 's' : ''}</span></summary>
        <table class="price-table"><tbody>${items.map((a) => `<tr><td>${escHtml(a.action)}</td><td class="price-fee">${escHtml(a.fee)}</td></tr>`).join('')}</tbody></table>
      </details>`;
    });
  }
  return html;
}

export function renderPricingTab(): void {
  const search = ((document.getElementById('price-search') as HTMLInputElement | null)?.value || '').toLowerCase();
  const filter = document.getElementById('price-filter') as HTMLSelectElement | null;
  const cat = filter?.value || '';
  if (filter) {
    const cats = [...new Set([...S.services.map((s) => s.category), ...S.rateCards.map((r) => r.category)].filter(Boolean) as string[])].sort();
    filter.innerHTML = `<option value="">All categories</option>` + cats.map((c) => `<option${c === cat ? ' selected' : ''}>${escHtml(c)}</option>`).join('');
  }
  const inactive = document.getElementById('svc-inactive-wrap'); if (inactive) inactive.hidden = view !== 'catalog';
  const filters = document.querySelector<HTMLElement>('#tab-pricing .fbar'); if (filters) filters.hidden = view === 'templates';
  const container = document.getElementById('pricing-content');
  if (!container) return;
  if (view === 'templates') { void renderTemplatesView(container); return; }
  container.innerHTML = view === 'catalog' ? renderCatalog(search, cat) : renderRates(search, cat);
  renderIcons(container);
}
expose('renderPricingTab', renderPricingTab);
registerTabRenderer('pricing', renderPricingTab);

// ── Editing a service ──

let editingId: number | null = null;

export function openServiceEditor(id: number | null): void {
  editingId = id;
  const s = id != null ? S.services.find((x) => x.id === id) : undefined;
  const f = document.getElementById('service-form') as HTMLFormElement | null;
  if (!f) return;
  f.reset();
  const set = (name: string, v: string) => { const el = f.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null; if (el) el.value = v; };
  const cats = [...new Set(S.services.map((x) => x.category).filter(Boolean) as string[])].sort();
  const dl = document.getElementById('svc-cat-list'); if (dl) dl.innerHTML = cats.map((c) => `<option value="${escHtml(c)}">`).join('');
  const agr = document.getElementById('svc-agr-type'); if (agr) agr.innerHTML = `<option value="">Not set</option>` + AGR_TYPES.map((t) => `<option>${escHtml(t)}</option>`).join('');
  const rc = document.getElementById('svc-rate-card'); if (rc) rc.innerHTML = `<option value="">None</option>` + S.rateCards.map((r) => `<option value="${r.id}">${escHtml(r.name)}</option>`).join('');
  const title = document.getElementById('svc-modal-title'); if (title) title.textContent = s ? `Edit ${s.name}` : 'New service';
  set('svcName', s?.name || '');
  set('svcCategory', s?.category || '');
  set('svcBilling', s?.billing || 'monthly');
  set('svcAgreementType', s?.agreementType || '');
  set('svcRateCard', s?.rateCardId != null ? String(s.rateCardId) : '');
  set('svcPrice', s?.defaultPrice != null ? String(s.defaultPrice) : '');
  set('svcDescription', s?.description || '');
  const active = f.elements.namedItem('svcActive') as HTMLInputElement | null; if (active) active.checked = s ? s.active : true;
  const used = s ? usage(s) : 0;
  const hint = document.getElementById('svc-usage'); if (hint) hint.textContent = used ? `Used on ${used} proposal${used === 1 ? '' : 's'}. Renaming keeps those lines as they were written.` : '';
  document.getElementById('modal-service')?.classList.add('open');
  window.setTimeout(() => (f.elements.namedItem('svcName') as HTMLInputElement | null)?.focus(), 50);
}
expose('openServiceEditor', openServiceEditor);

export function closeServiceEditor(): void {
  document.getElementById('modal-service')?.classList.remove('open');
}
expose('closeServiceEditor', closeServiceEditor);

export async function submitServiceEditor(e: Event): Promise<void> {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  const get = (name: string) => ((f.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value || '').trim();
  const existing = editingId != null ? S.services.find((x) => x.id === editingId) : undefined;
  const service: Service = {
    id: existing?.id ?? 0,
    name: get('svcName'),
    category: get('svcCategory') || null,
    description: get('svcDescription') || null,
    agreementType: get('svcAgreementType') || null,
    billing: get('svcBilling') === 'one_time' ? 'one_time' : 'monthly',
    defaultPrice: get('svcPrice') ? Number(get('svcPrice')) : null,
    rateCardId: get('svcRateCard') ? Number(get('svcRateCard')) : null,
    templateKey: existing?.templateKey ?? null,
    active: (f.elements.namedItem('svcActive') as HTMLInputElement | null)?.checked ?? true,
    sortOrder: existing?.sortOrder ?? null,
  };
  try {
    const saved = await saveService(service);
    const i = S.services.findIndex((x) => x.id === saved.id);
    if (i > -1) S.services[i] = saved; else S.services.push(saved);
    closeServiceEditor();
    renderPricingTab();
    toast(existing ? 'Service updated' : 'Service added', { tone: 'success' });
  } catch (err) {
    toast('Could not save the service', { tone: 'error', detail: String(err) });
  }
}
expose('submitServiceEditor', submitServiceEditor);

// ── Editing a rate card ──

type Pricing = NonNullable<RateCard['pricing']>;
let rcEditing: { card: RateCard; pricing: Pricing } | null = null;

const NUM = (v: string): number | null => (v.trim() === '' ? null : Number(v));

function rcField(label: string, path: string, value: number | null | undefined, suffix = ''): string {
  return `<label class="rc-field"><span>${escHtml(label)}</span><span class="rc-input"><input class="td-input" type="number" min="0" step="any" value="${value ?? ''}" onchange="rcSet('${path}', this.value)">${suffix ? `<span class="t-muted">${suffix}</span>` : ''}</span></label>`;
}

function rcTable(title: string, key: 'tranches' | 'packages' | 'rows' | 'bundles', cols: [string, string, 'text' | 'number'][]): string {
  const items = ((rcEditing!.pricing as any)[key] || []) as any[];
  return `<section class="rc-section"><div class="settings-subsection-title">${escHtml(title)}</div>
    <div class="tbl-wrap"><table class="price-mini-table rc-table"><thead><tr>${cols.map(([l]) => `<th>${escHtml(l)}</th>`).join('')}<th></th></tr></thead><tbody>
    ${items.map((it, i) => `<tr>${cols.map(([, f, t]) => `<td><input class="td-input" type="${t}"${t === 'number' ? ' step="any" min="0"' : ''} value="${escHtml(String(it[f] ?? ''))}" onchange="rcSet('${key}.${i}.${f}', this.value, '${t}')"></td>`).join('')}
      <td><button type="button" class="rec-icon-btn" onclick="rcRemove('${key}', ${i})" aria-label="Remove">×</button></td></tr>`).join('')}
    </tbody></table></div>
    <button type="button" class="btn-secondary btn-compact" onclick="rcAdd('${key}')">+ Add</button></section>`;
}

function renderRateCardEditor(): void {
  const body = document.getElementById('rate-card-body');
  if (!body || !rcEditing) return;
  const p = rcEditing.pricing;
  const parts: string[] = [];
  if (p.percent) {
    parts.push(`<section class="rc-section"><div class="settings-subsection-title">Percentage ${escHtml(p.percent.basis || '')}</div><div class="rc-grid">${rcField('Minimum', 'percent.min', p.percent.min, '%')}${rcField('Standard', 'percent.standard', p.percent.standard, '%')}${rcField('Maximum', 'percent.max', p.percent.max, '%')}</div></section>`);
  }
  if (!p.hasTranches && !p.hasPackages && !p.rows?.length && !p.perCountry && !p.percent) {
    parts.push(`<section class="rc-section"><div class="settings-subsection-title">Price${p.oneTime ? ' (one-time)' : ' per month'}</div><div class="rc-grid">
      ${rcField('Minimum', 'noCommMin', p.noCommMin)}${rcField('Standard', 'standard', p.standard)}${rcField('Maximum', 'noCommMax', p.noCommMax)}
      ${rcField('With commission, minimum', 'commMin', p.commMin)}${rcField('With commission, maximum', 'commMax', p.commMax)}</div></section>`);
  }
  if (p.hasTranches) {
    parts.push(rcTable(p.trancheLabel === 'Employee Type' ? 'Employee categories (per person per month)' : 'Employee tranches (per month)', 'tranches', [['Label', 'label', 'text'], ['Min', 'noCommMin', 'number'], ['Max', 'noCommMax', 'number'], ['Comm. min', 'commMin', 'number'], ['Comm. max', 'commMax', 'number']]));
  }
  if (p.rows?.length) parts.push(rcTable('Rows a proposal lists', 'rows', [['Label', 'label', 'text'], ['Min', 'min', 'number'], ['Standard', 'standard', 'number'], ['Max', 'max', 'number']]));
  if (p.hasPackages) parts.push(rcTable('Packages', 'packages', [['Package', 'name', 'text'], ['Min', 'min', 'number'], ['Max', 'max', 'number']]));
  if (p.bundles?.length) parts.push(rcTable('Small plans', 'bundles', [['Plan', 'name', 'text'], ['Price', 'price', 'number']]));
  if (p.perCountry) parts.push('<p class="form-hint">Mobilization is priced per country on each proposal; there is nothing to set here.</p>');
  parts.push(`<section class="rc-section"><div class="rc-grid">${p.hasTranches && p.trancheLabel !== 'Employee Type' ? rcField('Tranches shown in a proposal', 'showBands', p.showBands) : ''}${rcField('Minimum contract (months)', 'minimumMonths', p.minimumMonths)}</div></section>`);
  body.innerHTML = parts.join('');
}

export function openRateCardEditor(id: number): void {
  const card = S.rateCards.find((r) => r.id === id);
  if (!card?.pricing) return;
  rcEditing = { card, pricing: JSON.parse(JSON.stringify(card.pricing)) };
  const title = document.getElementById('rate-card-title'); if (title) title.textContent = `${card.name} — rate card`;
  renderRateCardEditor();
  document.getElementById('modal-rate-card')?.classList.add('open');
}
expose('openRateCardEditor', openRateCardEditor);

export function closeRateCardEditor(): void {
  rcEditing = null;
  document.getElementById('modal-rate-card')?.classList.remove('open');
}
expose('closeRateCardEditor', closeRateCardEditor);

export function rcSet(path: string, value: string, type: 'text' | 'number' = 'number'): void {
  if (!rcEditing) return;
  const keys = path.split('.');
  let target: any = rcEditing.pricing;
  for (const k of keys.slice(0, -1)) target = target[/^\d+$/.test(k) ? Number(k) : k];
  const last = keys[keys.length - 1];
  target[last] = type === 'text' ? value.trim() : NUM(value);
}
expose('rcSet', rcSet);

export function rcAdd(key: 'tranches' | 'packages' | 'rows' | 'bundles'): void {
  if (!rcEditing) return;
  const p = rcEditing.pricing as any;
  const blank = { tranches: { label: '', noCommMin: 0, noCommMax: 0, commMin: null, commMax: null }, packages: { name: '', min: 0, max: 0 }, rows: { label: '', min: 0, standard: 0, max: 0, percent: !!p.rows?.[0]?.percent }, bundles: { name: '', price: 0 } }[key];
  p[key] = [...(p[key] || []), blank];
  renderRateCardEditor();
}
expose('rcAdd', rcAdd);

export function rcRemove(key: 'tranches' | 'packages' | 'rows' | 'bundles', index: number): void {
  if (!rcEditing) return;
  const p = rcEditing.pricing as any;
  p[key] = (p[key] || []).filter((_: unknown, i: number) => i !== index);
  renderRateCardEditor();
}
expose('rcRemove', rcRemove);

export async function saveRateCardEditor(): Promise<void> {
  if (!rcEditing) return;
  const p = rcEditing.pricing as any;
  const bad = [...(p.tranches || []), ...(p.packages || []), ...(p.rows || [])].some((r: any) => {
    const [min, max] = [r.noCommMin ?? r.min, r.noCommMax ?? r.max];
    return min != null && max != null && min > max;
  }) || (p.noCommMin != null && p.noCommMax != null && p.noCommMin > p.noCommMax);
  if (bad) { toast('A minimum is higher than its maximum', { tone: 'error' }); return; }
  try {
    const saved = await saveRateCard({ ...rcEditing.card, pricing: p });
    const i = S.rateCards.findIndex((r) => r.id === saved.id);
    if (i > -1) S.rateCards[i] = saved;
    closeRateCardEditor();
    renderPricingTab();
    toast('Rate card saved', { tone: 'success', detail: 'New proposal lines use these prices' });
  } catch (err) {
    toast('Could not save the rate card', { tone: 'error', detail: String(err) });
  }
}
expose('saveRateCardEditor', saveRateCardEditor);

export async function reloadCommercialSetup(): Promise<void> {
  (window as any).applyCommercialSetup?.(await getCommercialSetup());
}
