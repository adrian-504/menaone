// Create proposal, several at once (owner, 27-Sep-2026): a client often asks for
// proposals that can't be one document. The form's header (client, contact,
// dates, status, entity, owner…) is filled once; each proposal is a block with
// its own services, lines and contract term. Save makes one proposal per block
// that has a service, all sharing the header and, when there are several, one
// request group. Pure: the page (tabs/proposalPage.ts) holds the blocks.

import { fmtMoney, lineTotals } from './commercial';
import type { CommercialLine, Proposal } from './types';

export interface ProposalBlock {
  lines: CommercialLine[];
  contractMonths: number | null;
}

export const emptyBlock = (contractMonths: number | null = null): ProposalBlock => ({ lines: [], contractMonths });

const withService = (lines: CommercialLine[]) => lines.filter((l) => l.serviceName.trim());

/** The blocks that become proposals: every block with a service. With none,
 * the first block alone (a request can be saved before its services are known). */
export function blocksToSave(blocks: ProposalBlock[]): ProposalBlock[] {
  const filled = blocks.filter((b) => withService(b.lines).length > 0);
  if (filled.length) return filled;
  return blocks.length ? [blocks[0]] : [];
}

/** Everything a block doesn't decide: the form's header. */
export type SharedProposalFields = Omit<Proposal, 'id' | 'type' | 'lines' | 'contractMonths' | 'requestGroup' | 'notes' | 'documents'>;

/** One proposal per block to save, ids from `firstId` up; several share a new request group. */
export function proposalsFromBlocks(shared: SharedProposalFields, blocks: ProposalBlock[], firstId: number, newGroup: () => string): Proposal[] {
  const save = blocksToSave(blocks);
  const group = save.length > 1 ? newGroup() : null;
  return save.map((b, i) => {
    const lines = withService(b.lines).map((l, n) => ({ ...l, sortOrder: n }));
    return {
      ...shared,
      id: firstId + i,
      type: lines.length ? null : '—',
      lines,
      contractMonths: b.contractMonths,
      requestGroup: group,
      notes: [],
      documents: [],
    };
  });
}

/** A collapsed block's one line: "Proposal 2 · Recruitment · SAR 45,000". */
export function blockSummary(block: ProposalBlock, index: number, currency: string): string {
  const lines = withService(block.lines);
  if (!lines.length) return `Proposal ${index + 1} · no services yet`;
  const t = lineTotals(lines, block.contractMonths);
  const total = t.contractValue || t.oneTime || t.monthly;
  return `Proposal ${index + 1} · ${t.serviceNames.join(', ')}${total ? ` · ${fmtMoney(total, currency)}` : ''}`;
}
