// Microsoft Files — first-run (and revisitable) setup wizard that bulk-links
// a OneDrive folder's immediate subfolders to MENA One Companies. Two steps
// in one modal: pick a folder (a small self-contained browser, deliberately
// separate from the main Files tab's own browsing state so opening the
// wizard never disturbs wherever the user was in the main tab), then review
// the suggested Company match for each subfolder before anything is saved.
//
// Matching runs entirely client-side against the same "existing Companies"
// list the rest of the app already treats as the practical company list
// (tabs/companies.ts's getAllCompanies() — every distinct client name across
// Proposals/Contacts/Agreements), not just the narrower numeric `companies`
// table (which today only has rows for companies an Opportunity has touched).
// Saving a confirmed match find-or-creates that row via the existing
// Opportunities find-or-create command, then links through the same generic
// entity_links Work Graph already used everywhere else in the app.
//
// Also hosts the single-item "Link to Company…" / "Link to Project…" modal
// (Section 10's individual-file linking) — the file browser's context menu
// opens it directly on one file or folder, same underlying primitives as the
// bulk wizard above, just for one item instead of a whole subfolder set.
import { escHtml, expose } from '../lib/utils';
import { toast } from '../lib/ui';
import { S } from '../lib/state';
import {
  filesListRoots, filesListFolder, filesGetOrCreateMsfile, filesResolveCompanyId,
  getLinksFor, setLinksFrom, getCompanies, setAppMeta,
} from '../lib/db';
import { getAllCompanies } from '../tabs/companies';
import { icon } from '../lib/icons';
import type { LocalFileItem } from '../lib/types';

interface Crumb { path: string | null; name: string }
interface ReviewRow { folderPath: string; folderName: string; suggested: string; confidence: 'high' | 'medium' | 'none' }

let pickerCrumbs: Crumb[] = [{ path: null, name: 'OneDrive' }];
let pickerItems: LocalFileItem[] = [];
let reviewRows: ReviewRow[] = [];
let onWizardDone: (() => void) | null = null;

// ── Matching ─────────────────────────────────────────────────

const LEGAL_SUFFIX_RE = /\b(ltd|llc|inc|corp|corporation|co|company|group|holdings|holding|est|establishment|trading|sa|ksa|saudi arabia)\b/g;

function normalize(s: string): string {
  return s.toLowerCase()
    .replace(/[.,&'’\-_/]/g, ' ')
    .replace(LEGAL_SUFFIX_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 0..1 similarity between a folder name and a candidate Company name — exact
 * normalized match, then containment (covers "INDRA" vs "Indra Sistemas"),
 * then word-overlap as a fallback for reordered/partial names. */
function scoreMatch(folderName: string, companyName: string): number {
  const a = normalize(folderName);
  const b = normalize(companyName);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 3 && b.length >= 3 && (b.includes(a) || a.includes(b))) return 0.85;
  const at = new Set(a.split(' ').filter(Boolean));
  const bt = new Set(b.split(' ').filter(Boolean));
  const inter = [...at].filter((t) => bt.has(t)).length;
  const denom = at.size + bt.size;
  return denom === 0 ? 0 : (2 * inter) / denom;
}

function bestMatch(folderName: string, companyNames: string[]): { name: string; score: number } | null {
  let best: { name: string; score: number } | null = null;
  for (const c of companyNames) {
    const s = scoreMatch(folderName, c);
    if (!best || s > best.score) best = { name: c, score: s };
  }
  return best;
}

function confidenceFor(score: number): 'high' | 'medium' | 'none' {
  if (score >= 0.999) return 'high';
  if (score >= 0.6) return 'medium';
  return 'none';
}

// ── Wizard open/close ─────────────────────────────────────────────────

export function openMsFilesSetupWizard(onDone?: () => void): void {
  onWizardDone = onDone || null;
  pickerCrumbs = [{ path: null, name: 'OneDrive' }];
  pickerItems = [];
  document.getElementById('msfw-step-pick')!.style.display = '';
  document.getElementById('msfw-step-review')!.style.display = 'none';
  document.getElementById('modal-msfiles-setup')?.classList.add('open');
  void loadPickerLevel();
}
expose('openMsFilesSetupWizard', openMsFilesSetupWizard);

export function closeMsFilesSetupWizard(): void {
  document.getElementById('modal-msfiles-setup')?.classList.remove('open');
}
expose('closeMsFilesSetupWizard', closeMsFilesSetupWizard);

// ── Step 1: folder picker (folders only — files aren't a valid pick here) ──

async function loadPickerLevel(): Promise<void> {
  const body = document.getElementById('msfw-picker-body')!;
  body.innerHTML = `<div class="empty pad-24">Loading…</div>`;
  const current = pickerCrumbs[pickerCrumbs.length - 1];
  try {
    const all = current.path == null ? await filesListRoots() : await filesListFolder(current.path);
    pickerItems = all.filter((i) => i.isFolder);
  } catch (e) {
    body.innerHTML = `<div class="empty pad-24 t-red">${escHtml(String(e))}</div>`;
    return;
  }
  renderPicker();
}

function renderPicker(): void {
  const backBtn = document.getElementById('msfw-back-btn') as HTMLButtonElement | null;
  if (backBtn) backBtn.disabled = pickerCrumbs.length <= 1;
  const useBtn = document.getElementById('msfw-use-folder-btn') as HTMLButtonElement | null;
  if (useBtn) useBtn.disabled = pickerCrumbs.length <= 1;

  const crumbEl = document.getElementById('msfw-breadcrumb')!;
  crumbEl.innerHTML = pickerCrumbs.map((c, i) => {
    const isLast = i === pickerCrumbs.length - 1;
    return isLast
      ? `<span class="msf-crumb-current">${escHtml(c.name)}</span>`
      : `<span class="msf-crumb" onclick="msfwGoToCrumb(${i})">${escHtml(c.name)}</span><span class="msf-crumb-sep">/</span>`;
  }).join('');

  const body = document.getElementById('msfw-picker-body')!;
  if (pickerItems.length === 0) {
    body.innerHTML = `<div class="empty pad-24">No subfolders here.</div>`;
    return;
  }
  body.innerHTML = pickerItems.map((it) => `
    <div class="msfw-picker-row" onclick="msfwDescend('${escHtml(it.path).replace(/'/g, "\\'")}','${escHtml(it.name).replace(/'/g, "\\'")}')">
      <span class="msf-row-icon">${icon('folder', 16)}</span>
      <span class="msfw-picker-name">${escHtml(it.name)}</span>
    </div>`).join('');
}

export function msfwDescend(path: string, name: string): void {
  pickerCrumbs.push({ path, name });
  void loadPickerLevel();
}
expose('msfwDescend', msfwDescend);

export function msfwGoBack(): void {
  if (pickerCrumbs.length <= 1) return;
  pickerCrumbs.pop();
  void loadPickerLevel();
}
expose('msfwGoBack', msfwGoBack);

export function msfwGoToCrumb(index: number): void {
  if (index >= pickerCrumbs.length - 1) return;
  pickerCrumbs = pickerCrumbs.slice(0, index + 1);
  void loadPickerLevel();
}
expose('msfwGoToCrumb', msfwGoToCrumb);

export function msfwBackToPicker(): void {
  document.getElementById('msfw-step-review')!.style.display = 'none';
  document.getElementById('msfw-step-pick')!.style.display = '';
}
expose('msfwBackToPicker', msfwBackToPicker);

// ── Step 2: review ─────────────────────────────────────────────────

export async function msfwUseCurrentFolder(): Promise<void> {
  const current = pickerCrumbs[pickerCrumbs.length - 1];
  if (current.path == null) return;
  const body = document.getElementById('msfw-picker-body')!;
  body.innerHTML = `<div class="empty pad-24">Reading subfolders…</div>`;
  let children: LocalFileItem[];
  try {
    children = await filesListFolder(current.path);
  } catch (e) {
    body.innerHTML = `<div class="empty pad-24 t-red">${escHtml(String(e))}</div>`;
    return;
  }
  const subfolders = children.filter((i) => i.isFolder);
  if (subfolders.length === 0) {
    body.innerHTML = `<div class="empty pad-24">"${escHtml(current.name)}" has no subfolders to match — pick a different folder.</div>`;
    return;
  }

  const companyNames = getAllCompanies();
  reviewRows = subfolders.map((f) => {
    const match = bestMatch(f.name, companyNames);
    const confidence = match ? confidenceFor(match.score) : 'none';
    return { folderPath: f.path, folderName: f.name, suggested: confidence === 'none' ? '' : (match?.name || ''), confidence };
  });

  const datalist = document.getElementById('msfw-companies-datalist')!;
  datalist.innerHTML = companyNames.map((n) => `<option value="${escHtml(n)}">`).join('');

  document.getElementById('msfw-review-count')!.textContent = String(subfolders.length);
  document.getElementById('msfw-review-plural')!.textContent = subfolders.length === 1 ? '' : 's';
  document.getElementById('msfw-review-folder-name')!.textContent = current.name;
  renderReview();
  document.getElementById('msfw-step-pick')!.style.display = 'none';
  document.getElementById('msfw-step-review')!.style.display = '';
}
expose('msfwUseCurrentFolder', msfwUseCurrentFolder);

function renderReview(): void {
  const list = document.getElementById('msfw-review-list')!;
  const confidenceLabel = { high: 'Exact match', medium: 'Suggested', none: 'No match' };
  const onlyUnmatched = (document.getElementById('msfw-unmatched-only') as HTMLInputElement | null)?.checked ?? false;

  const countEl = document.getElementById('msfw-unmatched-count');
  if (countEl) countEl.textContent = String(reviewRows.filter((r) => r.confidence === 'none').length);

  // Indices into the full reviewRows array — kept as data-row-index on each
  // row/badge (rather than relying on DOM position) so msfwUpdateRow below
  // still finds/updates the right row when the "unmatched only" filter has
  // hidden some rows from the list.
  const indices = reviewRows.map((_, i) => i).filter((i) => !onlyUnmatched || reviewRows[i].confidence === 'none');
  if (indices.length === 0) {
    list.innerHTML = `<div class="feed-empty">${onlyUnmatched ? 'No unmatched folders — every folder here already has a match.' : 'No subfolders.'}</div>`;
    return;
  }
  list.innerHTML = indices.map((i) => {
    const r = reviewRows[i];
    return `
    <div class="msfw-review-row">
      <div class="msfw-review-folder">${icon('folder', 14)} ${escHtml(r.folderName)}</div>
      <input type="text" class="finp" list="msfw-companies-datalist" placeholder="No match — type to assign, or leave blank to skip"
        value="${escHtml(r.suggested)}" oninput="msfwUpdateRow(${i},this.value)">
      <span class="msfw-confidence ${r.confidence}" data-row-index="${i}">${confidenceLabel[r.confidence]}</span>
    </div>`;
  }).join('');
}

/** Zero-arg wrapper for the "Show only unmatched" checkbox's onchange (needs
 * a global with no arguments, matching this file's other inline-handler
 * wrappers) — just re-renders with the checkbox's current state applied. */
export function renderReviewFromToggle(): void { renderReview(); }
expose('renderReviewFromToggle', renderReviewFromToggle);

export function msfwUpdateRow(index: number, value: string): void {
  const row = reviewRows[index];
  if (!row) return;
  row.suggested = value;
  // Once hand-edited, the confidence badge should stop implying an
  // auto-detected suggestion — it's now just whatever the user typed.
  row.confidence = value.trim() ? (row.confidence === 'none' ? 'medium' : row.confidence) : 'none';
  const badge = document.querySelector(`.msfw-confidence[data-row-index="${index}"]`) as HTMLElement | null;
  if (badge) {
    const label = value.trim() ? (row.confidence === 'high' ? 'Exact match' : 'Suggested') : 'No match';
    badge.className = `msfw-confidence ${row.confidence}`;
    badge.textContent = label;
  }
  const countEl = document.getElementById('msfw-unmatched-count');
  if (countEl) countEl.textContent = String(reviewRows.filter((r) => r.confidence === 'none').length);
}
expose('msfwUpdateRow', msfwUpdateRow);

export async function msfwSaveMatches(): Promise<void> {
  const toLink = reviewRows.filter((r) => r.suggested.trim());
  const failed: string[] = [];
  for (const row of toLink) {
    try {
      const companyId = await filesResolveCompanyId(row.suggested.trim());
      const msfileId = await filesGetOrCreateMsfile(row.folderPath, row.folderName, 'folder');
      const existing = await getLinksFor('msfile', msfileId);
      const others = existing.filter((l) => l.fromType === 'msfile' && l.fromId === msfileId && l.toType !== 'company');
      await setLinksFrom('msfile', msfileId, [
        ...others,
        { fromType: 'msfile', fromId: msfileId, toType: 'company', toId: companyId },
      ]);
    } catch (e) {
      console.error(`Could not link "${row.folderName}":`, e);
      failed.push(row.folderName);
    }
  }
  S.companies = await getCompanies();
  if (failed.length) {
    // Leave the failed rows in the review list (and the wizard open) instead
    // of silently closing — previously a failure here was console-only and
    // the wizard closed as if every row had linked successfully.
    reviewRows = toLink.filter((r) => failed.includes(r.folderName));
    renderReview();
    toast(`${failed.length} folder${failed.length === 1 ? '' : 's'} could not be linked — still listed below to try again`, { tone: 'error', detail: failed.join(', ') });
    return;
  }
  await setAppMeta('msfiles_setup_done', '1');
  closeMsFilesSetupWizard();
  onWizardDone?.();
}
expose('msfwSaveMatches', msfwSaveMatches);

// ── Single-item link modal ("Link to Company…" / "Link to Project…") ──

interface LinkTarget { path: string; name: string; isFolder: boolean; kind: 'company' | 'project' }
let linkTarget: LinkTarget | null = null;

export function openMsFilesLinkModal(path: string, name: string, isFolder: boolean, kind: 'company' | 'project'): void {
  linkTarget = { path, name, isFolder, kind };
  document.getElementById('msfl-title')!.textContent = kind === 'company' ? 'Link to Company' : 'Link to Project';
  document.getElementById('msfl-label')!.textContent = kind === 'company' ? 'Company' : 'Project';
  document.getElementById('msfl-item-name')!.textContent = name;
  const input = document.getElementById('msfl-input') as HTMLInputElement;
  input.value = '';
  const errorEl = document.getElementById('msfl-error') as HTMLElement;
  errorEl.style.display = 'none';
  const datalist = document.getElementById('msfl-datalist')!;
  const names = kind === 'company' ? getAllCompanies() : S.projects.filter((p) => !p.archived).map((p) => p.name);
  datalist.innerHTML = names.map((n) => `<option value="${escHtml(n)}">`).join('');
  document.getElementById('modal-msfiles-link')?.classList.add('open');
  setTimeout(() => input.focus(), 0);
}
expose('openMsFilesLinkModal', openMsFilesLinkModal);

export function closeMsFilesLinkModal(): void {
  document.getElementById('modal-msfiles-link')?.classList.remove('open');
  linkTarget = null;
}
expose('closeMsFilesLinkModal', closeMsFilesLinkModal);

function showLinkError(msg: string): void {
  const errorEl = document.getElementById('msfl-error') as HTMLElement;
  errorEl.textContent = msg;
  errorEl.style.display = '';
}

export async function msFilesSaveLink(): Promise<void> {
  if (!linkTarget) return;
  const value = (document.getElementById('msfl-input') as HTMLInputElement).value.trim();
  if (!value) { showLinkError('Type or pick a name first.'); return; }

  let targetId: number;
  if (linkTarget.kind === 'company') {
    targetId = await filesResolveCompanyId(value);
  } else {
    // Unlike Company, Projects aren't find-or-create here — creating one
    // needs type/status/owner the way openProjectModal() already collects,
    // so this only links to an EXISTING Project rather than silently
    // fabricating a bare one from a typed name.
    const proj = S.projects.find((p) => p.name === value);
    if (!proj) { showLinkError('Pick an existing Project from the list — new Projects are created from the Projects tab.'); return; }
    targetId = proj.id;
  }

  const msfileId = await filesGetOrCreateMsfile(linkTarget.path, linkTarget.name, linkTarget.isFolder ? 'folder' : 'file');
  const existing = await getLinksFor('msfile', msfileId);
  const others = existing.filter((l) => l.fromType === 'msfile' && l.fromId === msfileId && l.toType !== linkTarget!.kind);
  await setLinksFrom('msfile', msfileId, [
    ...others,
    { fromType: 'msfile', fromId: msfileId, toType: linkTarget.kind, toId: targetId },
  ]);
  if (linkTarget.kind === 'company') S.companies = await getCompanies();
  closeMsFilesLinkModal();
}
expose('msFilesSaveLink', msFilesSaveLink);
