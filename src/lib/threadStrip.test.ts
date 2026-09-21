// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { threadStripHtml } from './threadStrip';
import type { EngagementThread } from './workGraph';

const node = (kind: 'proposal' | 'agreement', id: number, label: string, others?: { id: number; label: string }[]) =>
  ({ kind, id, label, status: 'Signed', tone: 'green', date: '2026-09-01', dateLabel: 'Signed', others });

describe('threadStripHtml', () => {
  it("names with apostrophes still give working onclick handlers", () => {
    const t: EngagementThread = {
      nodes: [node('proposal', 1, 'Payroll'), node('agreement', 2, "O'Brien's payroll", [{ id: 3, label: "O'Brien \\ second" }])],
      gaps: [{ days: 3 }], after: null, missing: [], next: null, closed: false, show: true,
    } as unknown as EngagementThread;
    const host = document.createElement('div');
    host.innerHTML = threadStripHtml(t, { kind: 'proposal', id: 1 });
    const btn = host.querySelector<HTMLButtonElement>('.ts-more')!;
    const code = btn.getAttribute('onclick')!;
    let got: unknown = null;
    new Function('event', 'threadOthersMenu', code)({}, (_e: unknown, json: string) => { got = JSON.parse(json); });
    expect(got).toEqual([{ id: 3, label: "O'Brien \\ second" }]);
  });

  it('the open record shows only its step name; the prefix and labelCurrent are for Company 360', () => {
    const t = { nodes: [node('proposal', 1, 'Payroll (SL# 1)')], gaps: [], after: null, missing: ['agreement'], next: null, closed: false, show: true } as unknown as EngagementThread;
    const page = document.createElement('div');
    page.innerHTML = threadStripHtml(t, { kind: 'proposal', id: 1 });
    expect(page.querySelector('[aria-current="page"]')!.textContent!.trim()).toBe('Proposal');
    expect(page.querySelector('.is-missing')!.textContent!.trim()).toBe('Agreement');
    const company = document.createElement('div');
    company.innerHTML = threadStripHtml(t, null, { prefix: 'Payroll', labelCurrent: true });
    expect(company.querySelector('.ts-prefix')!.textContent).toBe('Payroll');
    expect(company.querySelector('a.ts-name')!.textContent).toBe('Payroll (SL# 1)');
  });
});
