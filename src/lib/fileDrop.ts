// Files dropped from Finder (foundations F2). Where they land decides what
// happens:
//   a company page  — copied into that company's folder (its linked folder,
//                     else its client folder under Proposals), then linked;
//   a proposal page — copied into its client folder; a deck (the attach
//                     rule: pptx/key/pdf named "…proposal…") is offered
//                     "Attach as deck" (a Request then moves to Drafting, as
//                     attaching always does); anything else shows in the
//                     folder list, ready for "Add to proposal";
//   anywhere else   — Files: into the folder open there, after asking.
// Copies, never moves: the original stays where it was. Apps and scripts are
// refused. While a file hovers, the target shows a 1px accent outline.

import { S } from './state';
import { toast } from './ui';
import { isDeckFile, proposalAttachFile, proposalRefreshFolder } from '../tabs/proposalPage';
import { filesCopyInto, filesGetByIds, filesGetOrCreateMsfile, getLinksFor, proposalFolderCreate, proposalFolderLookup, setLinksFrom } from './db';
import { showConfirm } from './utils';
import { refreshCompanyViewIfOpen } from './registry';

export type DropKind = 'company' | 'proposal' | 'files';

/** Which kind of drop an element under the pointer means. Pure. */
export function dropKindAt(el: Element | null): DropKind {
  if (el?.closest('#co-detail.open')) return 'company';
  if (el?.closest('#pr-detail') && S.currentProposalId != null && !S.proposalBuilderOpen) return 'proposal';
  return 'files';
}

const w = () => window as any;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

function outline(kind: DropKind | null): void {
  document.querySelectorAll('.file-drop-target').forEach((n) => n.classList.remove('file-drop-target'));
  if (!kind) return;
  const el = kind === 'company' ? document.getElementById('co-detail') : kind === 'proposal' ? document.getElementById('pr-detail') : document.querySelector('.tab.active');
  el?.classList.add('file-drop-target');
}

function refusedToast(refused: string[]): void {
  if (refused.length) toast(`Not added: ${refused.slice(0, 3).join(', ')}${refused.length > 3 ? '…' : ''}`, { tone: 'error', detail: 'Apps, scripts and folders are never copied in.' });
}

async function companyFolder(companyId: number | null, name: string): Promise<string | null> {
  if (companyId != null) {
    const ids = (await getLinksFor('company', companyId)).filter((l) => l.fromType === 'msfile' && l.toType === 'company').map((l) => l.fromId);
    const folder = (await filesGetByIds(ids)).find((f) => f.isFolder);
    if (folder) return folder.path;
  }
  const info = await proposalFolderLookup(name, null);
  if (info.exists && info.path) return info.path;
  if (!info.root) return null;
  return (await proposalFolderCreate(name)).path;
}

async function dropOnCompany(paths: string[]): Promise<void> {
  const name = S.currentCompany;
  if (!name) return;
  const company = S.companies.find((c) => c.name === name);
  const dir = await companyFolder(company?.id ?? null, name);
  if (!dir) { toast('No folder for this company yet', { tone: 'error', detail: 'Match its folder in Files, or choose the Proposals folder in Settings.' }); return; }
  const { copied, refused } = await filesCopyInto(paths, dir);
  refusedToast(refused);
  if (company) {
    for (const p of copied) {
      const id = await filesGetOrCreateMsfile(p, p.split('/').pop() || p, 'file');
      await setLinksFrom('msfile', id, [{ fromType: 'msfile', fromId: id, toType: 'company', toId: company.id }]);
    }
  }
  if (copied.length) toast(`Added ${plural(copied.length, 'file')} to ${name}`, { tone: 'success' });
  refreshCompanyViewIfOpen();
}

async function dropOnProposal(paths: string[]): Promise<void> {
  const p = S.proposals.find((x) => x.id === S.currentProposalId);
  if (!p) return;
  let info = await proposalFolderLookup(p.client, p.folderPath ?? null);
  if (!info.exists && info.root) info = await proposalFolderCreate(p.client);
  if (!info.path) { toast('No client folder yet', { tone: 'error', detail: 'Choose the Proposals folder in Settings.' }); return; }
  const { copied, refused } = await filesCopyInto(paths, info.path);
  refusedToast(refused);
  if (!copied.length) return;
  await proposalRefreshFolder();
  for (const path of copied) {
    const name = path.split('/').pop() || path;
    if (isDeckFile(name) && (await showConfirm(`Attach "${name}" as the proposal deck?`, { title: 'Attach as deck', confirmLabel: 'Attach as deck' }))) proposalAttachFile(path);
  }
  toast(`Copied ${plural(copied.length, 'file')} into ${p.client}'s folder`, { tone: 'success' });
}

async function dropOnFiles(paths: string[]): Promise<void> {
  if (S.currentTab !== 'files') w().switchTab?.('files');
  const dir = w().msFilesCurrentFolder?.() as string | null;
  if (!dir) { toast('Open a folder in Files, then drop the files there'); return; }
  const folder = dir.split('/').pop();
  if (!(await showConfirm(`Copy ${plural(paths.length, 'file')} into "${folder}"?`, { title: 'Add to Files', confirmLabel: 'Copy' }))) return;
  const { copied, refused } = await filesCopyInto(paths, dir);
  refusedToast(refused);
  if (copied.length) toast(`Copied ${plural(copied.length, 'file')} into ${folder}`, { tone: 'success' });
  await w().msFilesReloadCurrent?.();
}

export async function startFileDrop(): Promise<void> {
  if (!(window as any).__TAURI_INTERNALS__?.invoke) return;
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  const at = (pos: { x: number; y: number }) => document.elementFromPoint(pos.x / devicePixelRatio, pos.y / devicePixelRatio);
  await getCurrentWebview().onDragDropEvent((e) => {
    const p = e.payload;
    if (p.type === 'enter' || p.type === 'over') { outline(dropKindAt(at(p.position))); return; }
    outline(null);
    if (p.type !== 'drop' || !p.paths.length) return;
    const kind = dropKindAt(at(p.position));
    const run = kind === 'company' ? dropOnCompany : kind === 'proposal' ? dropOnProposal : dropOnFiles;
    void run(p.paths).catch((err) => toast("Couldn't add the files", { tone: 'error', detail: String(err) }));
  });
}
