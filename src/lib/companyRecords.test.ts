// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { COMPANY_RECORD_SECTIONS, companyNavItems, layoutCompanyRecords } from './companyRecords';

function page(): HTMLElement {
  const host = document.createElement('div');
  host.id = 'co-records';
  // Deliberately out of order: the layout sets the order.
  for (const [id, label] of [...COMPANY_RECORD_SECTIONS].reverse()) {
    const el = document.createElement('section');
    el.id = `co-sec-${id}`;
    el.innerHTML = `<div class="rec-section-hd"><h2>${label}</h2><div class="rec-section-actions"><button>+ New</button></div></div>`;
    host.append(el);
  }
  return host;
}

const open = (host: HTMLElement) => [...host.children].filter((el) => !(el as HTMLElement).hidden && !el.classList.contains('is-empty')).map((el) => el.id.replace('co-sec-', ''));
const collapsed = (host: HTMLElement) => [...host.children].filter((el) => el.classList.contains('is-empty')).map((el) => el.id.replace('co-sec-', ''));

describe('Company 360 record sections', () => {
  it('a company with N populated kinds shows N open sections in the fixed order, the rest as lines after them', () => {
    const host = page();
    const counts = { proposals: 3, agreements: 1, opportunities: 0, projects: 0, meetings: 2, tasks: 0, commitments: 1, notes: 0, files: 0, emails: 4 };
    const shown = layoutCompanyRecords(host, counts);
    expect(shown).toEqual(['proposals', 'agreements', 'meetings', 'commitments', 'emails']);
    expect(open(host)).toEqual(shown);
    expect(collapsed(host)).toEqual(['opportunities', 'projects', 'tasks', 'notes', 'files']);
    // Populated first, then the collapsed lines.
    expect([...host.children].map((el) => el.id.replace('co-sec-', ''))).toEqual([...shown, 'opportunities', 'projects', 'tasks', 'notes', 'files']);
  });

  it('there is no group to open: nothing with content is folded away', () => {
    const host = page();
    layoutCompanyRecords(host, { proposals: 5, agreements: 2 });
    expect(host.querySelector('.co-records-hd, [aria-expanded]')).toBeNull();
    expect(open(host).slice(0, 2)).toEqual(['proposals', 'agreements']);
  });

  it('linked emails are hidden when there are none (no "+ New" line), and while loading', () => {
    const host = page();
    layoutCompanyRecords(host, { proposals: 1, emails: 0 });
    expect((host.querySelector('#co-sec-emails') as HTMLElement).hidden).toBe(true);
    layoutCompanyRecords(host, { proposals: 1, emails: null });
    expect((host.querySelector('#co-sec-emails') as HTMLElement).hidden).toBe(true);
    layoutCompanyRecords(host, { proposals: 1, emails: 2 });
    expect((host.querySelector('#co-sec-emails') as HTMLElement).hidden).toBe(false);
    expect(open(host)).toContain('emails');
  });

  it('a count still loading (files) keeps its section open until it arrives', () => {
    const host = page();
    layoutCompanyRecords(host, { proposals: 1, files: null });
    expect(host.querySelector('#co-sec-files')?.classList.contains('is-empty')).toBe(false);
    layoutCompanyRecords(host, { proposals: 1, files: 0 });
    expect(host.querySelector('#co-sec-files')?.classList.contains('is-empty')).toBe(true);
  });

  it('the section bar lists the fixed items, then only the populated record sections with counts', () => {
    const items = companyNavItems({ contacts: 2, proposals: 3, agreements: 0, meetings: 1, emails: null });
    expect(items.map((i) => i.label)).toEqual(['Overview', 'People', 'Timeline', 'Notes', 'Proposals', 'Meetings']);
    expect(items.find((i) => i.id === 'proposals')?.count).toBe(3);
    expect(items.find((i) => i.id === 'contacts')?.count).toBe(2);
  });
});
