// @vitest-environment jsdom
// A Follow-up row (1.65): one request — its services as chips, the client's last word, the trail, its next steps.
import { describe, expect, it } from 'vitest';

import { S } from './state';
import { fuCard, requestRowHtml } from '../tabs/followup';
import { buildRequest, type RequestContext } from './followRequests';
import type { Proposal } from './types';

const T = '2026-10-01';
const sent = (over: Partial<Proposal> = {}): Proposal => ({ id: 9, client: 'Contoso Logistics', companyId: 7, type: 'Payroll', status: 'Sent to Client', sentDate: '2026-09-02',
  dblSignedDate: null, kickoffDate: null, finance: null, hubspot: null, owner: null, remarks: null, dateAdded: '2026-08-28', monthlyFee: 3000, contractMonths: 12,
  winLossReason: null, docLink: null, archived: false, archivedAt: null, snoozedUntil: null, dateSentToHassan: null, dateSentToClient: '2026-09-02', dateSigned: null,
  notes: [{ id: 1, date: '2026-09-10', text: 'Chased by phone' }], ...over });
const ctx: RequestContext = { today: T, emails: [], meetings: [], touches: [], hasContact: () => false };
const html = (s: string) => { const el = document.createElement('div'); el.innerHTML = s; return el; };

describe('a Follow-up row', () => {
  it('a request overdue for contact has Client asked for changes and Followed up ▾, plus "…"', () => {
    S.proposals = [sent()];
    const el = html(requestRowHtml(buildRequest([sent()], ctx), true));
    const buttons = [...el.querySelectorAll('.pk-acts button')];
    expect(buttons.map((b) => b.textContent!.trim())).toEqual(['Client asked for changes', 'Followed up']);
    expect(buttons.every((b) => b.classList.contains('btn-sm'))).toBe(true);
    expect(buttons[0].getAttribute('onclick')).toContain("fuAct(event, 9, 'changes')");
    expect(buttons[1].getAttribute('onclick')).toContain("fuAct(event, 9, 'followed_up')");
    expect(buttons[1].getAttribute('aria-haspopup')).toBe('menu');
    // One blue button on the page: the first due row's Followed up.
    expect(buttons.map((b) => b.classList.contains('btn-primary'))).toEqual([false, true]);
    expect(el.querySelector('.pk-more')?.getAttribute('aria-label')).toBe('More');
  });

  it('shows the send, the client\'s last word, the days without contact and the trail', () => {
    const el = html(requestRowHtml(buildRequest([sent()], ctx), false));
    const lines = [...el.querySelectorAll('.pk-meta')].map((m) => m.textContent);
    expect(lines[0]).toMatch(/^Sent 2 Sept/);
    expect(lines[1]).toBe('Never replied·no contact person');
    expect(el.querySelector('.fr-word .t-amber')!.textContent).toBe('no contact person');
    expect(el.querySelector('.pk-age span')!.textContent).toBe('without contact');
    expect(el.querySelector('.pk-mid .pk-trail .pk-pt.is-sent')).not.toBeNull();
    expect(el.querySelector('.pk-sl')!.textContent).toBe('SL# 9');
  });

  it('several proposals sent together are one row with a chip each, and open to show them', () => {
    const two = [sent(), sent({ id: 10, type: 'PRO', monthlyFee: 1500 })];
    S.proposals = two;
    const closed = html(requestRowHtml(buildRequest(two, ctx), false));
    expect([...closed.querySelectorAll('.fr-chip')].map((c) => c.textContent)).toEqual(['Payroll', 'PRO']);
    expect(closed.querySelector('.pk-val b')!.textContent).toBe('SAR 4,500');
    expect(closed.querySelector('.fr-count')!.textContent!.trim()).toBe('2 proposals');
    expect(closed.querySelector('.fr-count')!.getAttribute('aria-expanded')).toBe('false');
    expect(closed.querySelector('.fr-members')).toBeNull();
    expect(closed.querySelector('.fr-row')!.getAttribute('onclick')).toContain('fuOpenRow(9)');
  });

  it('a request to decide offers Snooze, Keep and Close as lost', () => {
    const old = sent({ dateSentToClient: '2026-06-01', sentDate: '2026-06-01', notes: [] });
    const el = html(requestRowHtml(buildRequest([old], ctx), false));
    expect([...el.querySelectorAll('.pk-acts button')].map((b) => b.textContent!.trim())).toEqual(['Snooze', 'Keep', 'Close as lost']);
    expect(el.querySelector('.pk-age span')!.textContent).toBe('since it was sent');
    expect(el.querySelector('.pk-age b')!.textContent).toBe('122 days');
  });

  it('an archived row has only Unarchive', () => {
    const el = html(fuCard(sent({ archived: true })));
    expect([...el.querySelectorAll('.btn-secondary')].map((b) => b.textContent!.trim())).toEqual(['Unarchive']);
  });
});
