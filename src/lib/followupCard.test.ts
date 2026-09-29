// @vitest-environment jsdom
// A Follow-up row carries one action: Log follow-up (Won and Lost are in "…").
import { describe, expect, it } from 'vitest';

import { S } from './state';
import { fuCard } from '../tabs/followup';
import type { Proposal } from './types';

const sent = (over: Partial<Proposal> = {}): Proposal => ({ id: 9, client: 'Contoso Logistics', companyId: 7, type: 'Payroll', status: 'Sent to Client', sentDate: '2026-09-02',
  dblSignedDate: null, kickoffDate: null, finance: null, hubspot: null, owner: null, remarks: null, dateAdded: '2026-08-28', monthlyFee: 3000, contractMonths: 12,
  winLossReason: null, docLink: null, archived: false, archivedAt: null, snoozedUntil: null, dateSentToHassan: null, dateSentToClient: '2026-09-02', dateSigned: null,
  notes: [{ id: 1, date: '2026-09-10', text: 'Chased by phone' }], ...over });

const html = (s: string) => { const el = document.createElement('div'); el.innerHTML = s; return el; };

describe('fuCard', () => {
  it('an active row has Followed up ▾ (one click) and Log follow-up (to write it down), plus "…"', () => {
    S.emails = []; S.meetings = []; S.touches = [];
    const el = html(fuCard(sent(), false));
    const buttons = [...el.querySelectorAll('.btn-secondary')];
    expect(buttons.map((b) => b.textContent!.trim())).toEqual(['Followed up', 'Log follow-up']);
    expect(buttons[0].getAttribute('onclick')).toContain('followUpMenu(event');
    expect(el.querySelector('.rec-icon-btn')?.getAttribute('aria-label')).toBe('More');
    expect(el.querySelector('.pq-won, .pq-lost')).toBeNull();
    expect(buttons[1].getAttribute('onclick')).toContain("'followup'");
  });

  it('an archived row has only Unarchive', () => {
    const el = html(fuCard(sent({ archived: true }), true));
    expect([...el.querySelectorAll('.btn-secondary')].map((b) => b.textContent!.trim())).toEqual(['Unarchive']);
  });

  it('shows days since the last contact and what it was', () => {
    S.emails = []; S.meetings = [];
    const el = html(fuCard(sent(), false));
    expect(el.querySelector('.pq-meta')!.textContent).toMatch(/^Sent .*·\s*you logged a note/);
    expect(el.querySelector('.pq-age')!.getAttribute('title')).toMatch(/since the last contact$/);
  });
});
