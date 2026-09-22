// The proposal templates list (under Services) and the Generate proposal dialog.
// Proposals are built from the service templates in "Proposals New Logo" (current
// design) or the 2026 master. Generating writes the next version of the deck into
// the client's OneDrive folder and records it on the proposal.

import { S } from '../lib/state';
import { escHtml, expose, localIsoDate } from '../lib/utils';
import { icon } from '../lib/icons';
import { emptyState, toast } from '../lib/ui';
import { proposalGenerate, proposalLibrary, filesOpen, proposalFolderLookup } from '../lib/db';
import { persistProposals, proposalsAndAgreementsSaved } from '../lib/persist';
import { renderIcons } from '../core/chrome';
import { lineTotals, nextDeckFileName, applyGeneratedDocument, proposalDecks } from '../lib/commercial';
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

// ═══════════════ Generate proposal dialog ═══════════════

let generating: { proposalId: number; preview: GenerateResult | null; keep: Set<number> | null } | null = null;

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
  const sel = document.getElementById('gen-template') as HTMLSelectElement | null;
  if (sel) {
    sel.innerHTML = designOptions(hasLibrary ? { count: library!.templates.length } : null, hasMaster)
      .map((o) => `<option value="${escHtml(o.value)}"${o.selected ? ' selected' : ''}>${escHtml(o.label)}</option>`).join('');
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
  const templateId = 0;
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
