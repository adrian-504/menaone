// A list page's "…" in the header (owner, 30-Sep-2026): the header keeps only
// "+ New <thing>" and a period select; exports and set-up tools live here.

import { showMenuAt, type ContextMenuItem } from '../lib/contextMenu';
import { expose } from '../lib/utils';

const w = window as any;

export const PAGE_MORE: Record<string, ContextMenuItem[]> = {
  proposals: [{ label: 'Export CSV', iconName: 'document', run: () => w.exportFiltered?.() }],
  agreements: [
    { label: 'Draft from proposals', iconName: 'document', run: () => w.draftAgreementsFromProposals?.() },
    { label: 'Export CSV', iconName: 'document', run: () => w.exportAgreementsCSV?.() },
  ],
  contacts: [
    { label: 'Manage lists', iconName: 'list', run: () => w.openCtListsModal?.() },
    { label: 'Export to ActiveCampaign', iconName: 'document', run: () => w.exportAcContacts?.() },
  ],
  files: [{ label: 'Match folders to companies…', iconName: 'folder', run: () => w.msFilesOpenSetupWizard?.() }],
};

export function pageMoreMenu(e: MouseEvent, page: string): void {
  e.stopPropagation();
  const items = PAGE_MORE[page];
  if (items?.length) showMenuAt(e.currentTarget as HTMLElement, items);
}
expose('pageMoreMenu', pageMoreMenu);
