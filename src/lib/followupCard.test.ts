// @vitest-environment jsdom
// A Follow-up row (1.59): its next steps, the age without contact and the trail; Won and Lost are in "…".
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
  it('a row overdue for contact has Client asked for changes and Followed up ▾, plus "…"', () => {
    S.emails = []; S.meetings = []; S.touches = []; S.contacts = []; S.companies = [];
    const el = html(fuCard(sent(), false));
    const buttons = [...el.querySelectorAll('.pk-acts button')];
    expect(buttons.map((b) => b.textContent!.trim())).toEqual(['Client asked for changes', 'Followed up']);
    expect(buttons.every((b) => b.classList.contains('btn-sm'))).toBe(true);
    expect(buttons[0].getAttribute('onclick')).toContain("queueAct(event, 9, 'changes')");
    expect(buttons[1].getAttribute('onclick')).toContain("queueAct(event, 9, 'followed_up')");
    expect(buttons[1].getAttribute('aria-haspopup')).toBe('menu');
    expect(el.querySelector('.pk-more')?.getAttribute('aria-label')).toBe('More');
  });

  it('an archived row has only Unarchive', () => {
    const el = html(fuCard(sent({ archived: true }), true));
    expect([...el.querySelectorAll('.btn-secondary')].map((b) => b.textContent!.trim())).toEqual(['Unarchive']);
  });

  it('shows the send, the days without contact and the trail', () => {
    S.emails = []; S.meetings = []; S.touches = [];
    const el = html(fuCard(sent(), false));
    expect(el.querySelector('.pk-meta')!.textContent).toMatch(/^Sent 2 Sept/);
    expect(el.querySelector('.pk-age span')!.textContent).toBe('without contact');
    expect(el.querySelector('.pk-trail .pk-pt.is-sent')).not.toBeNull();
  });
});
