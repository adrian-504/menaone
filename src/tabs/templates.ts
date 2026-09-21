// Proposal templates (under Services) and the Generate proposal dialog.
// A template is a .pptx plus rules: which slides are always in, which belong
// to which services or entity, and plain-text replacements for decks that
// don't use {{tokens}} yet. Generating writes the next version of the deck
// into the client's OneDrive folder and records it on the proposal.

import { S } from '../lib/state';
import { escHtml, expose, localIsoDate, showConfirm } from '../lib/utils';
import { icon } from '../lib/icons';
import { emptyState, toast } from '../lib/ui';
import { templatesList, templateInspect, templateDetail, templateSave, templateDelete, templateTokens, proposalGenerate, proposalLibrary, filesOpen, proposalFolderLookup } from '../lib/db';
import { persistProposals, proposalsAndAgreementsSaved } from '../lib/persist';
import { renderIcons } from '../core/chrome';
import { lineTotals, nextDeckFileName, entityById, applyGeneratedDocument, proposalDecks } from '../lib/commercial';
import type { ProposalTemplate, SlideRule, TemplateDetail, TemplateInspection, TokenInfo, GenerateResult } from '../lib/types';

const w = window as any;
let templates: ProposalTemplate[] = [];
let tokens: TokenInfo[] = [];
/** Template being edited: saved detail, or a new file not saved yet. */
let editing: { template: ProposalTemplate; inspection: TemplateInspection; rules: SlideRule[] } | null = null;

async function ensureTokens(): Promise<TokenInfo[]> {
  if (!tokens.length) tokens = await templateTokens().catch(() => []);
  return tokens;
}

export async function loadTemplates(): Promise<ProposalTemplate[]> {
  templates = await templatesList().catch(() => []);
  return templates;
}

// ═══════════════ Services → Templates view ═══════════════

export async function renderTemplatesView(container: HTMLElement): Promise<void> {
  if (editing) { renderEditor(container); return; }
  await loadTemplates();
  container.innerHTML = `
    <section class="sec tpl-intro">
      <div class="rec-section-hd"><h2>Proposal templates</h2><div class="rec-section-actions"><button class="btn-secondary" onclick="addProposalTemplate()">${icon('plus', 13)} Add template…</button></div></div>
      <p class="settings-card-desc">A template is a PowerPoint deck. For each proposal, MENA One keeps the slides it needs, fills in the client's details and the fee table, and saves the result in the client's OneDrive folder.</p>
      ${guideHtml()}
    </section>
    ${templates.length ? `<section class="sec"><div class="rec-list">${templates.map((t) => `<div class="rec-row${t.exists ? '' : ' is-unavailable'}" onclick="editProposalTemplate(${t.id})">
      <span class="rec-row-icon">${icon('document', 15)}</span>
      <div class="rec-row-main">
        <div class="rec-row-title">${escHtml(t.name)} ${t.isDefault ? '<span class="rec-badge tone-accent">Default</span>' : ''} ${t.exists ? '' : '<span class="rec-badge tone-red">File missing</span>'}</div>
        <div class="rec-row-sub">${[entityById(t.businessEntityId)?.name || 'Any entity', t.slideCount ? `${t.slideCount} slides` : '', t.config.slides.filter((s) => s.include === 'services').length ? `${t.config.slides.filter((s) => s.include === 'services').length} service slides` : ''].filter(Boolean).map(escHtml).join(' · ')}</div>
      </div>
      <div class="rec-row-actions"><button class="rec-icon-btn" onclick="event.stopPropagation();removeProposalTemplate(${t.id})" title="Remove" aria-label="Remove template">${icon('trash', 13)}</button></div>
    </div>`).join('')}</div></section>`
    : `<section class="sec">${emptyState({ icon: 'document', title: 'No template yet', body: 'Add the master proposal deck when it is ready. You can also try one of the current single-service templates in the meantime.', compact: true })}</section>`}`;
  renderIcons(container);
}

function guideHtml(): string {
  return `<details class="settings-help tpl-guide">
    <summary>How to prepare the master deck</summary>
    <ol>
      <li>Put every slide any proposal might need in one file: cover, letter, agenda, a module per service, commercials, terms, About MENA BIG, back cover.</li>
      <li>In each slide's <strong>speaker notes</strong>, say when it's used: <code class="inline-code">[always]</code>, <code class="inline-code">[services: Payroll, PRO]</code> (service or category names from the catalog), <code class="inline-code">[entity: KSA]</code> or <code class="inline-code">[never]</code>. Rules can also be set here after adding the file.</li>
      <li>Type placeholders where details go, e.g. <code class="inline-code">{{client_name}}</code> or <code class="inline-code">{{proposal_date_ordinal}}</code>. The full list is shown when you edit a template.</li>
      <li>For the fee table, make one row with <code class="inline-code">{{line.service}}</code>, <code class="inline-code">{{line.billing}}</code>, <code class="inline-code">{{line.amount}}</code> — it is repeated for each service. Put totals like <code class="inline-code">{{monthly_total}}</code> below it.</li>
      <li>Set text boxes that hold a client name to "Shrink text on overflow", and drop typed page numbers from the agenda (slides are removed per proposal).</li>
    </ol>
  </details>`;
}

export async function addProposalTemplate(): Promise<void> {
  let path: string | null = null;
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ multiple: false, directory: false, filters: [{ name: 'PowerPoint', extensions: ['pptx'] }], title: 'Choose the proposal template' });
    path = typeof picked === 'string' ? picked : null;
  } catch (err) {
    toast('Could not open the file picker', { tone: 'error', detail: String(err) });
    return;
  }
  if (!path) return;
  try {
    const inspection = await templateInspect(path);
    const name = path.split('/').pop()!.replace(/\.pptx$/i, '');
    const template: ProposalTemplate = { id: 0, name, path, businessEntityId: null, config: { smartFields: true, slides: [], replacements: [] }, slideCount: inspection.slideCount, fileModifiedAt: null, isDefault: templates.length === 0, exists: true };
    editing = { template, inspection, rules: defaultRules(inspection) };
    w.renderPricingTab?.();
  } catch (err) {
    toast('That file can’t be used as a template', { tone: 'error', detail: String(err) });
  }
}
expose('addProposalTemplate', addProposalTemplate);

function defaultRules(inspection: TemplateInspection): SlideRule[] {
  return inspection.slides.map((s) => ({
    slideId: s.slideId,
    include: s.tags.never ? 'never' : s.tags.services.length ? 'services' : 'always',
    services: s.tags.services,
    entity: s.tags.entity,
  }));
}

export async function editProposalTemplate(id: number): Promise<void> {
  try {
    const detail: TemplateDetail = await templateDetail(id);
    editing = { template: detail.template, inspection: detail.inspection, rules: detail.rules };
    w.renderPricingTab?.();
  } catch (err) {
    toast('Could not open the template', { tone: 'error', detail: String(err) });
  }
}
expose('editProposalTemplate', editProposalTemplate);

export async function removeProposalTemplate(id: number): Promise<void> {
  const t = templates.find((x) => x.id === id);
  if (!t || !(await showConfirm(`Remove "${t.name}" from MENA One? The PowerPoint file itself is not touched.`, { confirmLabel: 'Remove' }))) return;
  await templateDelete(id);
  w.renderPricingTab?.();
}
expose('removeProposalTemplate', removeProposalTemplate);

export function closeTemplateEditor(): void {
  editing = null;
  w.renderPricingTab?.();
}
expose('closeTemplateEditor', closeTemplateEditor);

function serviceOptions(): string[] {
  return [...new Set([...S.services.filter((s) => s.active).map((s) => s.name), ...S.services.map((s) => s.category || '').filter(Boolean)])].sort((a, b) => a.localeCompare(b));
}

function renderEditor(container: HTMLElement): void {
  if (!editing) return;
  const { template, inspection, rules } = editing;
  void ensureTokens().then((list) => {
    const el = document.getElementById('tpl-tokens');
    if (!el) return;
    const known = new Set(list.map((t) => t.token));
    const used = inspection.tokens;
    el.innerHTML = `${used.length ? `<p class="settings-card-desc">Placeholders in this deck:</p><div class="chip-row">${used.map((t) => `<span class="rec-badge ${known.has(t) ? 'tone-green' : 'tone-red'}" title="${known.has(t) ? 'Filled automatically' : 'MENA One doesn’t know this one'}">{{${escHtml(t)}}}</span>`).join('')}</div>` : '<p class="settings-card-desc">This deck has no {{placeholders}} yet — use replacements below, or add placeholders to the file.</p>'}
      <details class="settings-help"><summary>All placeholders you can use (${list.length})</summary><div class="tpl-token-list">${list.map((t) => `<div><code class="inline-code">{{${escHtml(t.token)}}}</code><span>${escHtml(t.label)}</span><span class="t-muted">${escHtml(t.example)}</span></div>`).join('')}</div></details>`;
    renderReplacements();
  });
  const opts = serviceOptions();
  container.innerHTML = `
    <section class="sec tpl-editor">
      <div class="rec-section-hd"><h2>${template.id ? 'Edit template' : 'New template'}</h2>
        <div class="rec-section-actions"><button class="btn-secondary" onclick="closeTemplateEditor()">Cancel</button><button class="btn-primary" onclick="saveProposalTemplate()">Save template</button></div></div>
      <div class="fg">
        <div class="fgrp"><label class="flbl" for="tpl-name">Name</label><input class="finp" id="tpl-name" value="${escHtml(template.name)}"></div>
        <div class="fgrp"><label class="flbl" for="tpl-entity">Used for</label><select class="finp" id="tpl-entity"><option value="">Any entity</option>${S.businessEntities.map((e) => `<option value="${e.id}"${e.id === template.businessEntityId ? ' selected' : ''}>${escHtml(e.name)}</option>`).join('')}</select></div>
        <div class="fgrp fgrp-full"><label class="check-label"><input type="checkbox" id="tpl-default"${template.isDefault ? ' checked' : ''}> Default template for this entity</label><div class="form-hint"><code class="path-code">${escHtml(template.path)}</code></div></div>
      </div>
      <label class="check-label tpl-smart"><input type="checkbox" id="tpl-smart"${template.config.smartFields !== false ? ' checked' : ''} onchange="editingSmartFields(this.checked)">
        <span><strong>Fill it like the team does by hand</strong> — client name, cover and letter dates, the country under "Attn", the client logo in the "Logo" box, agenda page numbers, and fee amounts that match the proposal's services. For templates without {{placeholders}}.</span></label>
      <div id="tpl-tokens"></div>
      <div class="settings-subsection">
        <div class="settings-subsection-title">Text to replace</div>
        <p class="settings-card-desc">For decks without placeholders: replace text exactly as it's typed on the slides.</p>
        <div id="tpl-replacements"></div>
      </div>
    </section>
    <section class="sec tpl-slides">
      <div class="rec-section-hd"><h2>Slides</h2><span class="rec-count">${inspection.slideCount}</span>
        <div class="rec-section-actions"><button class="btn-secondary btn-sm" onclick="setAllSlideRules('always')">All always</button></div></div>
      <datalist id="tpl-service-options">${opts.map((o) => `<option value="${escHtml(o)}">`).join('')}</datalist>
      <div class="tpl-slide-list">${inspection.slides.map((s, i) => {
        const r = rules[i];
        return `<div class="tpl-slide${r.include === 'never' ? ' is-unavailable' : ''}">
          <span class="tpl-slide-num">${s.index}</span>
          <div class="tpl-slide-main">
            <div class="tpl-slide-title">${escHtml(s.title || 'Untitled slide')}${s.hasLineTable ? ' <span class="rec-badge tone-accent">Fee table</span>' : ''}</div>
            <div class="tpl-slide-text">${escHtml(s.text.replace(/\n/g, ' · ').slice(0, 160))}</div>
            ${s.notes ? `<div class="tpl-slide-notes">${icon('note', 11)} ${escHtml(s.notes.slice(0, 120))}</div>` : ''}
            ${template.config.smartFields !== false && s.smartFields?.length ? `<div class="chip-row">${s.smartFields.map((f) => `<span class="rec-badge${/amount/.test(f) ? ' tone-amber' : ' tone-accent'}">${escHtml(f)}</span>`).join('')}</div>` : ''}
          </div>
          <div class="tpl-slide-rule">
            <select class="td-select" onchange="setSlideRule(${i}, 'include', this.value)" aria-label="When slide ${s.index} is used">
              <option value="always"${r.include === 'always' ? ' selected' : ''}>Always</option>
              <option value="services"${r.include === 'services' ? ' selected' : ''}>For services…</option>
              <option value="never"${r.include === 'never' ? ' selected' : ''}>Never</option>
            </select>
            ${r.include === 'services' ? `<div class="chip-row">${r.services.map((sv, k) => `<span class="prb-chip on">${escHtml(sv)}<button class="tpl-chip-x" onclick="setSlideRule(${i}, 'removeService', '${k}')" aria-label="Remove ${escHtml(sv)}">×</button></span>`).join('')}
              <input class="td-input tpl-add-service" list="tpl-service-options" placeholder="Add service…" onchange="setSlideRule(${i}, 'addService', this.value)"></div>` : ''}
            <select class="td-select tpl-entity" onchange="setSlideRule(${i}, 'entity', this.value)" aria-label="Entity for slide ${s.index}">
              <option value="">Any entity</option>${S.businessEntities.map((e) => `<option value="${escHtml(e.code)}"${r.entity === e.code ? ' selected' : ''}>Only ${escHtml(e.code)}</option>`).join('')}
            </select>
          </div>
        </div>`;
      }).join('')}</div>
    </section>`;
  renderIcons(container);
}

function renderReplacements(): void {
  const el = document.getElementById('tpl-replacements');
  if (!el || !editing) return;
  const reps = editing.template.config.replacements;
  const tokenOpts = (sel: string) => tokens.filter((t) => !t.token.startsWith('line.')).map((t) => `<option value="${escHtml(t.token)}"${t.token === sel ? ' selected' : ''}>${escHtml(t.label)}</option>`).join('');
  el.innerHTML = reps.map((r, i) => `<div class="tpl-rep">
      <input class="finp" value="${escHtml(r.find)}" placeholder="Text on the slides" onchange="setReplacement(${i}, 'find', this.value)">
      <span class="t-muted">→</span>
      <select class="finp" onchange="setReplacement(${i}, 'token', this.value)">${tokenOpts(r.token)}</select>
      <button class="rec-icon-btn" onclick="setReplacement(${i}, 'remove', '')" aria-label="Remove replacement">${icon('close', 13)}</button>
    </div>`).join('') + `<button class="btn-secondary btn-sm" onclick="setReplacement(-1, 'add', '')">${icon('plus', 12)} Add replacement</button>`;
  renderIcons(el);
}

export function editingSmartFields(on: boolean): void {
  if (!editing) return;
  syncNameFields();
  editing.template.config.smartFields = on;
  w.renderPricingTab?.();
}
expose('editingSmartFields', editingSmartFields);

export function setReplacement(i: number, field: string, value: string): void {
  if (!editing) return;
  const reps = editing.template.config.replacements;
  if (field === 'add') reps.push({ find: '', token: 'client_name' });
  else if (field === 'remove') reps.splice(i, 1);
  else if (reps[i]) (reps[i] as any)[field] = value;
  renderReplacements();
}
expose('setReplacement', setReplacement);

export function setSlideRule(i: number, field: string, value: string): void {
  if (!editing) return;
  const r = editing.rules[i];
  if (!r) return;
  if (field === 'include') r.include = value as SlideRule['include'];
  else if (field === 'entity') r.entity = value || null;
  else if (field === 'addService' && value.trim() && !r.services.includes(value.trim())) r.services.push(value.trim());
  else if (field === 'removeService') r.services.splice(Number(value), 1);
  syncNameFields();
  w.renderPricingTab?.();
}
expose('setSlideRule', setSlideRule);

export function setAllSlideRules(include: SlideRule['include']): void {
  if (!editing) return;
  editing.rules.forEach((r) => { r.include = include; });
  syncNameFields();
  w.renderPricingTab?.();
}
expose('setAllSlideRules', setAllSlideRules);

/** Keeps typed name/entity/default when the editor re-renders. */
function syncNameFields(): void {
  if (!editing) return;
  const name = document.getElementById('tpl-name') as HTMLInputElement | null;
  const entity = document.getElementById('tpl-entity') as HTMLSelectElement | null;
  const def = document.getElementById('tpl-default') as HTMLInputElement | null;
  if (name) editing.template.name = name.value;
  if (entity) editing.template.businessEntityId = entity.value ? Number(entity.value) : null;
  if (def) editing.template.isDefault = def.checked;
}

export async function saveProposalTemplate(): Promise<void> {
  if (!editing) return;
  syncNameFields();
  const template: ProposalTemplate = { ...editing.template, config: { smartFields: editing.template.config.smartFields !== false, slides: editing.rules, replacements: editing.template.config.replacements.filter((r) => r.find.trim()) } };
  try {
    await templateSave(template);
    editing = null;
    toast('Template saved', { tone: 'success' });
    w.renderPricingTab?.();
  } catch (err) {
    toast('Could not save the template', { tone: 'error', detail: String(err) });
  }
}
expose('saveProposalTemplate', saveProposalTemplate);

// ═══════════════ Generate proposal dialog ═══════════════

let generating: { proposalId: number; preview: GenerateResult | null; keep: Set<number> | null } | null = null;

export async function openGenerateProposal(proposalId: number): Promise<void> {
  const p = S.proposals.find((x) => x.id === proposalId);
  if (!p) return;
  const [, library] = await Promise.all([loadTemplates(), proposalLibrary().catch(() => null)]);
  const usable = templates.filter((t) => t.exists);
  const hasLibrary = !!library?.templates.length;
  const hasMaster = !!library?.master;
  if (!usable.length && !hasLibrary && !hasMaster) {
    toast('No proposal templates found', { detail: 'MENA One looks for "Proposals Templates/Proposals New Logo" next to your Proposals folder, or add a template in Services → Templates', action: { label: 'Open', run: () => { w.navToModule('pricing'); w.setServicesView('templates'); } } });
    return;
  }
  // The team's own templates, combined per service, come first.
  const preferred = hasLibrary || hasMaster ? null : usable.find((t) => t.isDefault && t.businessEntityId === p.businessEntityId) || usable.find((t) => t.businessEntityId === p.businessEntityId) || usable.find((t) => t.isDefault) || usable[0];
  const sel = document.getElementById('gen-template') as HTMLSelectElement | null;
  if (sel) {
    sel.innerHTML = (hasMaster ? `<option value="master" selected>2026 design — MENA BIG Proposal Master</option>` : '')
      + (hasLibrary ? `<option value="library"${hasMaster ? '' : ' selected'}>Current design — built from your service templates (${library!.templates.length} in Proposals New Logo)</option>` : '')
      + usable.map((t) => `<option value="${t.id}"${t.id === preferred?.id ? ' selected' : ''}>${escHtml(t.name)}</option>`).join('');
  }
  const folder = await proposalFolderLookup(p.client, p.folderPath ?? null).catch(() => null);
  const services = lineTotals(p.lines, p.contractMonths).serviceNames.join(' & ') || p.type || 'Services';
  const name = document.getElementById('gen-file-name') as HTMLInputElement | null;
  if (name) name.value = nextDeckFileName(p, services, localIsoDate(new Date()), (folder?.files || []).map((f) => f.name));
  const logos = (folder?.files || []).filter((f) => !f.isFolder && /\.(png|jpe?g)$/i.test(f.name));
  const likely = logos.filter((f) => /logo/i.test(f.name));
  const logoSel = document.getElementById('gen-logo') as HTMLSelectElement | null;
  if (logoSel) {
    logoSel.innerHTML = `<option value="">No logo — remove the "Logo" box</option>` + [...likely, ...logos.filter((f) => !likely.includes(f))]
      .map((f, i) => `<option value="${escHtml(f.path)}"${i === 0 && likely.length ? ' selected' : ''}>${escHtml(f.name)}${/logo/i.test(f.name) ? '' : ' (image in the client folder)'}</option>`).join('');
  }
  generating = { proposalId, preview: null, keep: null };
  document.getElementById('modal-generate')?.classList.add('open');
  await refreshGeneratePreview();
}
expose('openGenerateProposal', openGenerateProposal);

export function closeGenerateProposal(): void {
  generating = null;
  document.getElementById('modal-generate')?.classList.remove('open');
}
expose('closeGenerateProposal', closeGenerateProposal);

function request(dryRun: boolean) {
  const chosen = (document.getElementById('gen-template') as HTMLSelectElement).value;
  const fromLibrary = chosen === 'library';
  const fromMaster = chosen === 'master';
  const templateId = fromLibrary || fromMaster ? 0 : Number(chosen);
  const fileName = (document.getElementById('gen-file-name') as HTMLInputElement).value.trim();
  const logoPath = (document.getElementById('gen-logo') as HTMLSelectElement | null)?.value || null;
  return { proposalId: generating!.proposalId, templateId, date: localIsoDate(new Date()), fileName, keep: generating!.keep ? [...generating!.keep] : null, logoPath, dryRun, fromLibrary, fromMaster };
}

export async function refreshGeneratePreview(resetSlides = false): Promise<void> {
  if (!generating) return;
  if (resetSlides) generating.keep = null;
  const body = document.getElementById('gen-preview');
  if (body) body.innerHTML = '<div class="feed-empty">Putting the deck together…</div>';
  try {
    const preview = await proposalGenerate(request(true));
    if (!generating) return;
    generating.preview = preview;
    if (!generating.keep) generating.keep = new Set(preview.slides.filter((s) => s.included).map((s) => s.index));
    renderGeneratePreview();
  } catch (err) {
    if (body) body.innerHTML = `<p class="t-red">${escHtml(String(err))}</p>`;
  }
}
expose('refreshGeneratePreview', refreshGeneratePreview);

function renderGeneratePreview(): void {
  const body = document.getElementById('gen-preview');
  if (!body || !generating?.preview) return;
  const pv = generating.preview;
  const keep = generating.keep!;
  const filled = Object.entries(pv.values).filter(([, v]) => v);
  const empty = Object.entries(pv.values).filter(([, v]) => !v).map(([k]) => k);
  const errors = pv.errors || [];
  const confirm = document.getElementById('gen-confirm') as HTMLButtonElement | null;
  if (confirm) { confirm.disabled = errors.length > 0; confirm.title = errors.length ? 'Fix what is missing first' : ''; }
  body.innerHTML = `
    ${errors.length ? `<div class="gen-errors" role="alert"><div class="gen-errors-title">${icon('warning', 13)} Cannot generate this proposal. Missing:</div><ul>${errors.map((e) => `<li>${escHtml(e)}</li>`).join('')}</ul></div>` : ''}
    <div class="gen-basis">${icon('document', 13)}<span id="gen-version-note">${versionNote()}</span></div>
    ${[...pv.warnings, ...(pv.report?.smart?.warnings || [])].length ? `<div class="gen-warnings">${[...pv.warnings, ...(pv.report?.smart?.warnings || [])].map((x) => `<div>${icon('warning', 13)} ${escHtml(x)}</div>`).join('')}</div>` : ''}
    ${pv.baseTemplate ? `<div class="gen-basis">${icon('document', 13)} Starts from <b>${escHtml(pv.baseTemplate)}</b>${pv.servicesTitle ? ` · cover reads <b>${escHtml(pv.servicesTitle)}</b>` : ''}</div>` : ''}
    ${pv.report?.smart?.filled.length ? `<div class="gen-filled">${pv.report.smart.filled.map((x) => `<span class="rec-badge tone-green">${icon('check', 11)} ${escHtml(x)}</span>`).join('')}</div>` : ''}
    ${pv.report?.smart?.checks?.length ? `<details class="gen-fees gen-checks" open><summary>${icon('warning', 12)} Check before sending · ${pv.report.smart.checks.length}</summary><ul>${pv.report.smart.checks.map((f) => `<li>${escHtml(f)}</li>`).join('')}</ul></details>` : ''}
    ${pv.report?.smart?.feesToCheck.length ? `<details class="gen-fees"><summary>${pv.report.smart.feesToCheck.length} amount${pv.report.smart.feesToCheck.length === 1 ? '' : 's'} left as in the template — check them in PowerPoint</summary><ul>${pv.report.smart.feesToCheck.map((f) => `<li>${escHtml(f)}</li>`).join('')}</ul></details>` : ''}
    <div class="gen-folder">${icon('folder', 13)} ${pv.folderExists ? 'Saves to' : 'Creates and saves to'} <code class="path-code">${escHtml(pv.folder || 'No Proposals folder set')}</code></div>
    <div class="gen-columns">
      <div>
        <div class="settings-subsection-title">Slides <span class="t-muted">${keep.size} of ${pv.slides.length}</span></div>
        <div class="gen-slides">${pv.slides.map((s) => `<label class="gen-slide${keep.has(s.index) ? '' : ' off'}">
          <input type="checkbox" ${keep.has(s.index) ? 'checked' : ''} onchange="toggleGenerateSlide(${s.index}, this.checked)">
          <span class="tpl-slide-num">${s.index}</span><span class="gen-slide-title">${escHtml(s.title || 'Untitled')}</span><span class="t-meta t-muted">${escHtml(s.source && s.source !== pv.baseTemplate ? `From ${shortTemplateName(s.source)} · ${s.reason}` : s.reason)}</span>
        </label>`).join('')}</div>
      </div>
      <div>
        <div class="settings-subsection-title">Filled in</div>
        <dl class="gen-values">${filled.map(([k, v]) => `<div><dt>${escHtml(k)}</dt><dd>${escHtml(v)}</dd></div>`).join('')}</dl>
        ${empty.length ? `<p class="t-meta t-muted">Blank on this proposal: ${empty.map(escHtml).join(', ')}</p>` : ''}
      </div>
    </div>`;
  renderIcons(body);
}

/** "Labor Law - HR - Manpower Consultancy Services Proposal Template" → "Labor Law - HR - Manpower Consultancy". */
export function shortTemplateName(name: string): string {
  return name.replace(/[_ ]*(services?)?[_ ]*(package[_ ]*)?proposal([_ ]*(template|v\d+))*$/i, '').replace(/_/g, ' ').trim() || name;
}

export async function chooseGenerateLogo(): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ multiple: false, directory: false, filters: [{ name: 'Logo', extensions: ['png', 'jpg', 'jpeg'] }], title: 'Choose the client logo' });
    if (typeof picked !== 'string') return;
    const sel = document.getElementById('gen-logo') as HTMLSelectElement | null;
    if (sel) {
      if (![...sel.options].some((o) => o.value === picked)) sel.insertAdjacentHTML('beforeend', `<option value="${escHtml(picked)}">${escHtml(picked.split('/').pop() || picked)}</option>`);
      sel.value = picked;
    }
    await refreshGeneratePreview();
  } catch (err) {
    toast('Could not open the file picker', { tone: 'error', detail: String(err) });
  }
}
expose('chooseGenerateLogo', chooseGenerateLogo);

export function toggleGenerateSlide(index: number, on: boolean): void {
  if (!generating?.keep) return;
  if (on) generating.keep.add(index); else generating.keep.delete(index);
  renderGeneratePreview();
}
expose('toggleGenerateSlide', toggleGenerateSlide);

/** "Will be saved as V3 — the 2 earlier versions stay as they are", matching the version the generator records. */
function versionNote(): string {
  if (!generating) return '';
  const decks = proposalDecks(S.proposals.find((x) => x.id === generating!.proposalId) || {});
  const fileName = (document.getElementById('gen-file-name') as HTMLInputElement | null)?.value || '';
  const named = Number((fileName.match(/_V(\d+)\.pptx$/i) || [])[1] || 0);
  const version = Math.max(Math.max(0, ...decks.map((d) => d.version ?? 0)) + 1, named);
  const kept = decks.length === 0 ? '' : decks.length === 1 ? ` — V${decks[0].version} stays as it is` : ` — the ${decks.length} earlier versions stay as they are`;
  return `Will be saved as <b>V${version}</b>${kept}`;
}

export function updateGenerateVersionNote(): void {
  const el = document.getElementById('gen-version-note');
  if (el) el.innerHTML = versionNote();
}
expose('updateGenerateVersionNote', updateGenerateVersionNote);

export async function confirmGenerateProposal(): Promise<void> {
  if (!generating) return;
  const proposalId = generating.proposalId;
  const btn = document.getElementById('gen-confirm') as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  let generated = false;
  try {
    // The generator reads the proposal from the database: save any pending edits first,
    // so the deck matches the page and a queued save can't drop the new version.
    persistProposals();
    await proposalsAndAgreementsSaved();
    const result = await proposalGenerate(request(false));
    const p = S.proposals.find((x) => x.id === proposalId);
    if (!result.document || !result.path) throw new Error('The proposal was not recorded.');
    if (p) {
      applyGeneratedDocument(p, result.document, result.folder);
      persistProposals();
    }
    generated = true;
    closeGenerateProposal();
    const missing = [...(result.report?.smart?.checks?.length ? [`${result.report.smart.checks.length} sentences to read`] : []), ...(result.report?.smart?.feesToCheck.length ? [`${result.report.smart.feesToCheck.length} amounts to check`] : [])];
    toast(`V${result.document.version} generated`, {
      tone: 'success',
      detail: `${result.fileName}${result.report ? ` · ${result.report.slidesAfter} slides` : ''}${missing.length ? `\nCheck in PowerPoint: ${missing.join(', ')}` : ''}`,
      action: { label: 'Open', run: () => void filesOpen(result.path!) },
      duration: 8000,
    });
    w.renderProposalPage?.();
    requestAnimationFrame(() => document.querySelector(`[data-doc-id="${result.document!.id}"]`)?.classList.add('just-added'));
  } catch (err) {
    // Nothing was recorded: earlier versions are unchanged. Keep the dialog open to fix and retry.
    toast('Could not generate the proposal', { tone: 'error', detail: String(err).replace(/^Error: /, '') });
    if (generating) void refreshGeneratePreview();
  } finally {
    if (btn && !generated) { btn.disabled = false; btn.textContent = 'Generate'; }
    if (btn && generated) btn.textContent = 'Generate';
  }
}
expose('confirmGenerateProposal', confirmGenerateProposal);
