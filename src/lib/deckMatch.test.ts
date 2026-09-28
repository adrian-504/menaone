import { describe, it, expect } from 'vitest';
import { deckVersion, matchDecks } from './deckMatch';
import type { CommercialLine, LocalFileItem, Proposal } from './types';

const line = (serviceName: string): CommercialLine => ({
  id: 1, serviceId: null, serviceName, description: null, billing: 'monthly', quantity: 1, unitPrice: 1000, commission: false, sortOrder: 0,
});
const file = (name: string, modified: string): LocalFileItem => ({
  path: `/Proposals/Acme Test Co/${name}`, name, isFolder: false, size: 1000, modifiedAt: `${modified}T10:00:00Z`, exists: true,
});
const proposal = { client: 'Acme Test Co', dateAdded: '2026-09-10', lines: [line('Payroll'), line('Admin & PRO')], contractMonths: 12 };
const names = (fs: LocalFileItem[]) => fs.map((f) => f.name);

describe('hand-made decks matched to their proposal', () => {
  it('matches a deck named with the client stem, and one naming the client as a whole word', () => {
    const files = [file('Acme Test Co_Payroll Proposal_12.09.2026.pptx', '2026-09-12'), file('Proposal for Acme Test Co.pdf', '2026-09-11')];
    expect(names(matchDecks(proposal, files, []))).toEqual(['Acme Test Co_Payroll Proposal_12.09.2026.pptx', 'Proposal for Acme Test Co.pdf']);
  });

  it("rejects other clients' decks, an xlsx, a file with no 'proposal', and a file older than the request", () => {
    const files = [
      file('Acme Test Company_Payroll Proposal.pptx', '2026-09-12'),
      file('Globex_Payroll Proposal.pptx', '2026-09-12'),
      file('Acme Test Co_Proposal commercials.xlsx', '2026-09-12'),
      file('Acme Test Co_Payroll deck.pptx', '2026-09-12'),
      file('Acme Test Co_Payroll Proposal_01.09.2026.pptx', '2026-09-01'),
    ];
    expect(matchDecks(proposal, files, [])).toEqual([]);
  });

  it('allows a day of clock slop before the request date', () => {
    expect(matchDecks(proposal, [file('Acme Test Co_Proposal.pptx', '2026-09-09')], [])).toHaveLength(1);
    expect(matchDecks(proposal, [file('Acme Test Co_Proposal.pptx', '2026-09-08')], [])).toHaveLength(0);
  });

  it('rejects a deck already recorded on any proposal', () => {
    const f = file('Acme Test Co_Payroll Proposal.pptx', '2026-09-12');
    const other = { documents: [{ id: 1, kind: 'proposal' as const, version: 1, fileName: f.name, path: f.path, url: null, notes: null, createdAt: null }] };
    expect(matchDecks(proposal, [f], [other])).toEqual([]);
  });

  it("ranks decks naming one of the proposal's services first (\"&\" read as \"and\"), then newest", () => {
    const files = [
      file('Acme Test Co_Proposal_20.09.2026.pptx', '2026-09-20'),
      file('Acme Test Co_Admin and PRO Proposal.pptx', '2026-09-13'),
      file('Acme Test Co_Payroll Proposal.pptx', '2026-09-15'),
      file('Acme Test Co_Payrollish Proposal.pptx', '2026-09-19'),
    ];
    expect(names(matchDecks(proposal, files, []))).toEqual([
      'Acme Test Co_Payroll Proposal.pptx',
      'Acme Test Co_Admin and PRO Proposal.pptx',
      'Acme Test Co_Proposal_20.09.2026.pptx',
      'Acme Test Co_Payrollish Proposal.pptx',
    ]);
  });
});

describe('deck version', () => {
  it('keeps the _V<n> in the name unless it is taken', () => {
    expect(deckVersion('Acme_Payroll Proposal_12.09.2026_V3.pptx', [1])).toBe(3);
    expect(deckVersion('Acme_Payroll Proposal_12.09.2026_V2.pptx', [1, 2])).toBe(3);
  });

  it('is the one after the recorded versions when the name has none', () => {
    expect(deckVersion('Acme_Payroll Proposal.pptx', [])).toBe(1);
    expect(deckVersion('Acme_Payroll Proposal.pptx', [1, 2])).toBe(3);
  });
});
