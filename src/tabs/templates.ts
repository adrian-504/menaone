// The proposal templates list (under Services) and the Generate proposal studio
// (studio slice: a sheet from the right, the slides as tiles, the summary in
// plain words, the generating moment and what to do next).
// Proposals are built from the service templates in "Proposals New Logo" (current
// design) or the 2026 master. Generating writes the next version of the deck into
// the client's OneDrive folder and records it on the proposal.

import { S } from '../lib/state';
import { escHtml, expose, localIsoDate, strColor } from '../lib/utils';
import { icon } from '../lib/icons';
import { emptyState, toast } from '../lib/ui';
import { proposalGenerate, proposalLibrary, filesOpen, filesRevealInFinder, proposalFolderLookup } from '../lib/db';
import { breadcrumb, feeLine, fillList, miniCoverHtml, slideGroups } from '../lib/studio';
import { initialsOf } from '../lib/appearance';
import { quickLook } from '../lib/quickLook';
import { errorReport } from '../lib/errors';
import { fmtDateShort } from '../lib/dates';
import pkg from '../../package.json';
import { persistProposals, proposalsAndAgreementsSaved } from '../lib/persist';
import { renderIcons } from '../core/chrome';
import { lineTotals, nextDeckFileName, applyGeneratedDocument, proposalDecks, PS } from '../lib/commercial';
import { designOptions } from '../lib/generateChoice';
import type { GenerateResult } from '../lib/types';

const w = window as any;

// ═══════════════ Services → Templates view ═══════════════
// Read-only: which service templates the generator reads, the 2026 master, and
// files in the folder it leaves alone. Templates are edited in PowerPoint.

export async function renderTemplatesView(container: HTMLElement): Promise<void> {
  const library = await proposalLibrary().catch(() => null);
  const templates = library?.templates || [];
  const ignored = library?.ignored || [];
  container.innerHTML = `
    <section class="sec tpl-intro">
      <div class="rec-section-hd"><h2>Proposal templates</h2></div>
      <p class="settings-card-desc">Proposals are built from the service templates in ${escHtml(library?.dir || 'Proposals Templates/Proposals New Logo')}: only files named “… Template.pptx” are read, and the proposal's first service leads the deck. Edit a template in PowerPoint; MENA One reads the new version the next time it generates.</p>
    </section>
    ${templates.length ? `<section class="sec"><div class="rec-list">${templates.map((t) => `<div class="rec-row">
      <span class="rec-row-icon">${icon('document', 15)}</span>
      <div class="rec-row-main">
        <div class="rec-row-title">${escHtml(t.name)}</div>
        <div class="rec-row-sub">${[t.services.join(', '), `${t.slideCount} slides`].filter(Boolean).map(escHtml).join(' · ')}</div>
      </div>
    </div>`).join('')}</div></section>`
    : `<section class="sec">${emptyState({ icon: 'document', title: 'No service templates found', body: 'MENA One looks for "Proposals Templates/Proposals New Logo" next to your Proposals folder.', compact: true })}</section>`}
    <section class="sec"><p class="settings-card-desc">2026 design: ${library?.master ? escHtml(library.master.split('/').pop() || '') : 'not found'}${ignored.length ? ` · Not read as templates: ${ignored.map(escHtml).join(', ')}` : ''}</p></section>`;
  renderIcons(container);
}

// ═══════════════ Generate proposal: the studio sheet ═══════════════

type Phase = 'edit' | 'working' | 'done';
let generating: { proposalId: number; preview: GenerateResult | null; keep: Set<number> | null; phase: Phase; result?: GenerateResult; error?: string } | null = null;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
const current = () => (generating ? S.proposals.find((x) => x.id === generating!.proposalId) : undefined);

/** The version this generation records, as the generator will (past recorded decks and the file name's _Vn). */
function nextVersion(): number {
  const decks = proposalDecks(current() || {});
  const fileName = $<HTMLInputElement>('gen-file-name')?.value || '';
  const named = Number((fileName.match(/_V(\d+)\.pptx$/i) || [])[1] || 0);
  return Math.max(Math.max(0, ...decks.map((d) => d.version ?? 0)) + 1, named);
}

function templateLabel(): string {
  const sel = $<HTMLSelectElement>('gen-template');
  return (sel?.selectedOptions[0]?.textContent || '').split(' — ')[0] || 'Current design';
}

/** The sheet's header: tile, "Acme Holdings — Payroll proposal", "Generate V2 · Current design", and the button's label. */
function paintHeader(): void {
  const p = current();
  if (!p) return;
  const services = lineTotals(p.lines, p.contractMonths).serviceNames.join(' & ') || p.type || 'Services';
  const tile = $('gen-tile');
  if (tile) { tile.textContent = initialsOf(p.client); tile.style.background = strColor(p.client); }
  const title = $('gen-title'); if (title) title.textContent = `${p.client} — ${services} proposal`;
  const v = nextVersion();
  const sub = $('gen-sub'); if (sub) sub.textContent = `Generate V${v} · ${templateLabel()}`;
  const btn = $<HTMLButtonElement>('gen-confirm'); if (btn && generating?.phase === 'edit') btn.textContent = `Generate V${v}`;
}

export async function openGenerateProposal(proposalId: number): Promise<void> {
  const p = S.proposals.find((x) => x.id === proposalId);
  if (!p) return;
  const library = await proposalLibrary().catch(() => null);
  const hasLibrary = !!library?.templates.length;
  const hasMaster = !!library?.master;
  if (!hasLibrary && !hasMaster) {
    toast('No proposal templates found', { detail: 'MENA One looks for "Proposals Templates/Proposals New Logo" next to your Proposals folder', action: { label: 'Open', run: () => { w.navToModule('pricing'); w.setServicesView('templates'); } } });
    return;
  }
  // The current design (the team's service templates, combined) is the default; the 2026 master is second.
  const sel = $<HTMLSelectElement>('gen-template');
  if (sel) {
    sel.innerHTML = designOptions(hasLibrary ? { count: library!.templates.length } : null, hasMaster)
      .map((o) => `<option value="${escHtml(o.value)}"${o.selected ? ' selected' : ''}>${escHtml(o.label)}</option>`).join('');
  }
  const folder = await proposalFolderLookup(p.client, p.folderPath ?? null).catch(() => null);
  const services = lineTotals(p.lines, p.contractMonths).serviceNames.join(' & ') || p.type || 'Services';
  const name = $<HTMLInputElement>('gen-file-name');
  if (name) name.value = nextDeckFileName(p, services, localIsoDate(new Date()), (folder?.files || []).map((f) => f.name));
  const logos = (folder?.files || []).filter((f) => !f.isFolder && /\.(png|jpe?g)$/i.test(f.name));
  const likely = logos.filter((f) => /logo/i.test(f.name));
  const logoSel = $<HTMLSelectElement>('gen-logo');
  if (logoSel) {
    logoSel.innerHTML = `<option value="">No logo — remove the "Logo" box</option>` + [...likely, ...logos.filter((f) => !likely.includes(f))]
      .map((f, i) => `<option value="${escHtml(f.path)}"${i === 0 && likely.length ? ' selected' : ''}>${escHtml(f.name)}${/logo/i.test(f.name) ? '' : ' (image in the client folder)'}</option>`).join('');
  }
  generating = { proposalId, preview: null, keep: null, phase: 'edit' };
  resetFooter();
  const controls = $('gen-controls'); if (controls) controls.hidden = false;
  paintHeader();
  $('modal-generate')?.classList.add('open');
  renderIcons($('modal-generate')!);
  await refreshGeneratePreview();
}
expose('openGenerateProposal', openGenerateProposal);

export function closeGenerateProposal(): void {
  if (generating?.phase === 'working') return; // the deck is being written; it closes itself when done
  generating = null;
  $('modal-generate')?.classList.remove('open');
}
expose('closeGenerateProposal', closeGenerateProposal);

function request(dryRun: boolean) {
  const chosen = $<HTMLSelectElement>('gen-template')!.value;
  const fromLibrary = chosen === 'library';
  const fromMaster = chosen === 'master';
  const templateId = 0;
  const fileName = $<HTMLInputElement>('gen-file-name')!.value.trim();
  const logoPath = $<HTMLSelectElement>('gen-logo')?.value || null;
  return { proposalId: generating!.proposalId, templateId, date: localIsoDate(new Date()), fileName, keep: generating!.keep ? [...generating!.keep] : null, logoPath, dryRun, fromLibrary, fromMaster };
}

export async function refreshGeneratePreview(resetSlides = false): Promise<void> {
  if (!generating) return;
  if (resetSlides) generating.keep = null;
  paintHeader();
  const body = $('gen-preview');
  if (body && !generating.preview) body.innerHTML = '<div class="studio-loading"><span class="studio-bar"></span>Putting the deck together…</div>';
  try {
    const preview = await proposalGenerate(request(true));
    if (!generating) return;
    generating.preview = preview;
    if (!generating.keep) generating.keep = new Set(preview.slides.filter((s) => s.included).map((s) => s.index));
    renderGeneratePreview();
  } catch (err) {
    if (body) body.innerHTML = `<p class="studio-err">${escHtml(String(err).replace(/^Error: /, ''))}</p>`;
  }
}
expose('refreshGeneratePreview', refreshGeneratePreview);

function savedAsHtml(): string {
  const decks = proposalDecks(current() || {}).slice().sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
  const last = decks[0];
  const kept = !last ? '' : decks.length === 1 ? `V${last.version}${last.createdAt ? ` of ${fmtDateShort(last.createdAt)}` : ''} stays as it is` : `the ${decks.length} earlier versions stay as they are`;
  return `<b>V${nextVersion()}</b>${kept ? ` <span class="studio-muted">· ${escHtml(kept)}</span>` : ''}`;
}

function slidesHtml(pv: GenerateResult, keep: Set<number>, client: string): string {
  const groups = slideGroups(pv.slides, keep, pv.baseTemplate, shortTemplateName);
  const first = pv.slides[0]?.index;
  return groups.map((g) => `<div class="studio-group"><div class="eyebrow studio-group-hd">${escHtml(g.label)}</div><div class="slide-grid">${g.slides.map((s) => `
    <label class="slide-tile${s.on ? '' : ' off'}">
      ${s.index === first ? miniCoverHtml(client, pv.servicesTitle || 'Proposal') : `<span class="slide-face"><span class="slide-face-title">${escHtml(s.title)}</span></span>`}
      <span class="slide-meta"><span class="slide-no">${s.number}</span><span class="slide-name">${escHtml(s.title)}</span><input type="checkbox" ${s.on ? 'checked' : ''} onchange="toggleGenerateSlide(${s.index}, this.checked)" aria-label="Include ${escHtml(s.title)}"></span>
    </label>`).join('')}</div></div>`).join('');
}

function summaryHtml(pv: GenerateResult): string {
  const p = current();
  const smart = pv.report?.smart;
  const fills = fillList(pv.values);
  const blank = Object.entries(pv.values).filter(([, v]) => !v || !v.trim()).map(([k]) => k);
  const checks = [...pv.warnings, ...(smart?.warnings || []), ...(smart?.checks || []), ...(smart?.feesToCheck || []).map(feeLine)];
  const where = pv.folder ? `<span data-tip="${escHtml(pv.folder)}">${escHtml(breadcrumb(pv.folder))}</span>` : 'No Proposals folder set';
  return `
    ${pv.errors?.length ? `<div class="studio-errors" role="alert"><b>Can't generate yet.</b> ${pv.errors.map(escHtml).join(' · ')}</div>` : ''}
    <dl class="studio-sum">
      <div><dt>Client</dt><dd>${escHtml(p?.client || '')}</dd></div>
      <div><dt>Template</dt><dd>${escHtml(templateLabel())}${pv.baseTemplate ? ` <span class="studio-muted">· starts from ${escHtml(shortTemplateName(pv.baseTemplate))}</span>` : ''}</dd></div>
      <div><dt>Saved as</dt><dd id="gen-version-note">${savedAsHtml()}</dd></div>
      <div><dt>${pv.folderExists ? 'Saves to' : 'Creates'}</dt><dd>${where}</dd></div>
    </dl>
    ${fills.length || smart?.filled.length ? `<h3 class="studio-h">Filled in</h3><ul class="studio-fill">${fills.map((f) => `<li>${icon('check', 12)}<span class="studio-fill-l">${escHtml(f.label)}</span><span class="studio-fill-v">${escHtml(f.value)}</span></li>`).join('')}${(smart?.filled || []).map((f) => `<li>${icon('check', 12)}<span class="studio-fill-v">${escHtml(f)}</span></li>`).join('')}</ul>` : ''}
    ${blank.length ? `<p class="studio-muted studio-blank">Blank on this proposal: ${blank.map((k) => escHtml(fillList({ [k]: '-' })[0]?.label || k)).join(', ')}</p>` : ''}
    ${checks.length ? `<h3 class="studio-h">Check in PowerPoint</h3><ul class="studio-checks">${checks.map((c) => `<li>${icon('warning', 12)}<span>${escHtml(c)}</span></li>`).join('')}</ul>` : ''}`;
}

function renderGeneratePreview(): void {
  const body = $('gen-preview');
  if (!body || !generating?.preview || generating.phase !== 'edit') return;
  const pv = generating.preview;
  const keep = generating.keep!;
  const btn = $<HTMLButtonElement>('gen-confirm');
  if (btn) { btn.disabled = (pv.errors || []).length > 0; btn.dataset.tip = btn.disabled ? 'Fix what is missing first' : ''; }
  body.innerHTML = `
    ${generating.error ? `<div class="studio-errors" role="alert"><b>${escHtml(generating.error)}</b> <button class="rlink" type="button" onclick="copyGenerateError()">Copy details</button></div>` : ''}
    <div class="studio-panes">
      <section class="studio-slides" aria-label="Slides"><div class="studio-pane-hd"><h3 class="studio-h">Slides</h3><span class="studio-muted">${keep.size} of ${pv.slides.length}</span></div>${slidesHtml(pv, keep, current()?.client || '')}</section>
      <section class="studio-summary" aria-label="Summary">${summaryHtml(pv)}</section>
    </div>`;
  renderIcons(body);
  paintHeader();
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
    const sel = $<HTMLSelectElement>('gen-logo');
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

export function updateGenerateVersionNote(): void {
  const el = $('gen-version-note');
  if (el) el.innerHTML = savedAsHtml();
  paintHeader();
}
expose('updateGenerateVersionNote', updateGenerateVersionNote);

// ── The generating moment ──
// The engine writes the deck in one call (proposal_generate), so nothing is
// faked: one bar while it works, then each real step ticks as it completes.

function resetFooter(): void {
  const actions = $('gen-actions');
  if (actions) actions.innerHTML = `<button class="btn-secondary" type="button" onclick="closeGenerateProposal()">Cancel</button><button class="btn-primary" id="gen-confirm" type="button" onclick="confirmGenerateProposal()">Generate</button>`;
  const prog = $('gen-progress'); if (prog) { prog.hidden = true; prog.innerHTML = ''; }
}

function progressHtml(steps: { label: string; done: boolean }[], working: boolean): string {
  return `${working ? '<span class="studio-bar" aria-hidden="true"></span>' : ''}<ol class="studio-steps">${steps.map((s) => `<li class="${s.done ? 'is-done' : ''}">${s.done ? icon('check', 12) : '<span class="studio-step-dot"></span>'}${escHtml(s.label)}</li>`).join('')}</ol>`;
}

export async function confirmGenerateProposal(): Promise<void> {
  if (!generating || generating.phase !== 'edit') return;
  const proposalId = generating.proposalId;
  const v = nextVersion();
  const wasRequest = current()?.status === PS.REQUEST;
  const steps = [{ label: `Writing V${v} from the templates`, done: false }, { label: 'Saved to the client folder', done: false }, { label: `Recorded on the proposal as V${v}`, done: false }, ...(wasRequest ? [{ label: 'Moved to Drafting', done: false }] : [])];
  const prog = $('gen-progress');
  const actions = $('gen-actions');
  const paint = (working: boolean) => { if (prog) { prog.hidden = false; prog.innerHTML = progressHtml(steps, working); renderIcons(prog); } };
  generating.phase = 'working';
  generating.error = undefined;
  if (actions) actions.hidden = true;
  const controls = $('gen-controls'); if (controls) controls.hidden = true;
  paint(true);
  try {
    // The generator reads the proposal from the database: save any pending edits first,
    // so the deck matches the page and a queued save can't drop the new version.
    persistProposals();
    await proposalsAndAgreementsSaved();
    const result = await proposalGenerate(request(false));
    if (!result.document || !result.path) throw new Error('The proposal was not recorded.');
    steps[0].done = true; steps[1].done = true; paint(true);
    const p = S.proposals.find((x) => x.id === proposalId);
    if (p) {
      applyGeneratedDocument(p, result.document, result.folder);
      persistProposals();
    }
    steps[2].done = true; if (wasRequest && p?.status === PS.DRAFTING) steps[3].done = true; paint(false);
    if (generating) { generating.phase = 'done'; generating.result = result; }
    w.renderProposalPage?.();
    requestAnimationFrame(() => document.querySelector(`[data-doc-id="${result.document!.id}"]`)?.classList.add('just-added'));
    renderSuccess(result);
  } catch (err) {
    // Nothing was recorded: earlier versions are unchanged. The panes stay, to fix and retry.
    if (!generating) return;
    generating.phase = 'edit';
    generating.error = `Couldn't generate V${v}: ${String(err).replace(/^Error: /, '')}`;
    (generating as any).errorObj = err;
    resetFooter();
    if (actions) actions.hidden = false;
    if (controls) controls.hidden = false;
    renderGeneratePreview();
  }
}
expose('confirmGenerateProposal', confirmGenerateProposal);

export function copyGenerateError(): void {
  const err = (generating as any)?.errorObj ?? generating?.error;
  void navigator.clipboard.writeText(errorReport(err, { version: pkg.version, page: 'proposal · generate' })).then(() => toast('Details copied'));
}
expose('copyGenerateError', copyGenerateError);

function renderSuccess(r: GenerateResult): void {
  const body = $('gen-preview');
  const smart = r.report?.smart;
  const toCheck = [...(smart?.checks || []), ...(smart?.feesToCheck || []).map(feeLine)];
  if (body) {
    body.innerHTML = `<div class="studio-done">
      <span class="bars lg studio-done-bars" aria-hidden="true"><i></i><i></i><i></i></span>
      <h3 class="studio-done-title">Saved to the client folder</h3>
      <div class="studio-done-file">${escHtml(r.fileName)}</div>
      <div class="studio-muted" data-tip="${escHtml(r.folder || '')}">${escHtml(breadcrumb(r.folder))}${r.report ? ` · ${r.report.slidesAfter} slides` : ''}</div>
      ${toCheck.length ? `<ul class="studio-checks">${toCheck.map((c) => `<li>${icon('warning', 12)}<span>${escHtml(c)}</span></li>`).join('')}</ul>` : ''}
    </div>`;
    renderIcons(body);
  }
  const actions = $('gen-actions');
  if (actions) {
    actions.hidden = false;
    actions.innerHTML = `<button class="btn-secondary" type="button" onclick="closeGenerateProposal()">Done</button>
      <button class="btn-secondary" type="button" onclick="generatedQuickLook()">Quick Look</button>
      <button class="btn-secondary" type="button" onclick="generatedReveal()">Show in Finder</button>
      <button class="btn-primary" type="button" onclick="generatedOpen()">Open in PowerPoint</button>`;
  }
  const sub = $('gen-sub'); if (sub) sub.textContent = `V${r.document?.version ?? ''} generated · ${templateLabel()}`;
}

const lastPath = () => generating?.result?.path || null;
expose('generatedOpen', () => { const p = lastPath(); if (p) void filesOpen(p).catch((e) => toast("Couldn't open the deck", { tone: 'error', detail: String(e) })); });
expose('generatedReveal', () => { const p = lastPath(); if (p) void filesRevealInFinder(p).catch((e) => toast("Couldn't show the deck", { tone: 'error', detail: String(e) })); });
expose('generatedQuickLook', () => { const p = lastPath(); if (p) void quickLook(p); });
