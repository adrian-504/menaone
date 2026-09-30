// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../tabs/proposalPage', () => ({
  isDeckFile: (name: string) => /\.(pptx|ppt|key|pdf)$/i.test(name) && /proposal/i.test(name),
  proposalAttachFile: vi.fn(),
  proposalRefreshFolder: vi.fn(),
}));

import { dropKindAt } from './fileDrop';
import { S } from './state';

describe('where a file dropped from Finder lands', () => {
  it('an open company page takes it', () => {
    document.body.innerHTML = `<div id="co-detail" class="record-page open"><p id="in">x</p></div>`;
    expect(dropKindAt(document.getElementById('in'))).toBe('company');
  });

  it('a closed company page does not', () => {
    document.body.innerHTML = `<div id="co-detail" class="record-page"><p id="in">x</p></div>`;
    expect(dropKindAt(document.getElementById('in'))).toBe('files');
  });

  it('the proposal page takes it while a proposal is open, not in the builder', () => {
    document.body.innerHTML = `<div id="pr-detail" class="record-page open"><p id="in">x</p></div>`;
    S.currentProposalId = 7;
    S.proposalBuilderOpen = false;
    expect(dropKindAt(document.getElementById('in'))).toBe('proposal');
    S.proposalBuilderOpen = true;
    expect(dropKindAt(document.getElementById('in'))).toBe('files');
    S.proposalBuilderOpen = false;
    S.currentProposalId = null;
    expect(dropKindAt(document.getElementById('in'))).toBe('files');
  });

  it('anywhere else goes to Files', () => {
    document.body.innerHTML = `<div class="tab active"><p id="in">x</p></div>`;
    expect(dropKindAt(document.getElementById('in'))).toBe('files');
    expect(dropKindAt(null)).toBe('files');
  });
});
