import { describe, it, expect } from 'vitest';
import { statusTone, statusBadge } from './statusTone';
import { ST, AGR_ST, SERVICE_STATUSES } from './constants';

describe('status tones', () => {
  it('every proposal, agreement and service status has a colour meaning', () => {
    for (const s of Object.keys(ST)) expect(statusTone('proposal', s), s).not.toBe(undefined);
    for (const s of Object.keys(AGR_ST)) expect(['green', 'red', 'amber', 'accent']).toContain(statusTone('agreement', s));
    for (const s of SERVICE_STATUSES) expect(statusTone('service', s)).toMatch(/green|accent|muted/);
  });
  it('outcomes read the same across records', () => {
    expect([statusTone('proposal', 'Signed by Both Parties'), statusTone('agreement', 'Signed'), statusTone('opportunity', 'Won'), statusTone('project', 'Completed'), statusTone('task', 'Done')]).toEqual(['green', 'green', 'green', 'green', 'green']);
    expect([statusTone('proposal', 'Lost'), statusTone('agreement', 'Canceled'), statusTone('opportunity', 'Lost'), statusTone('project', 'Cancelled'), statusTone('meeting', 'Cancelled')]).toEqual(['red', 'red', 'red', 'red', 'red']);
  });
  it('unknown statuses are muted and labels are escaped', () => {
    expect(statusTone('project', 'Something new')).toBe('muted');
    expect(statusBadge('opportunity', 'Won', 'Won <b>')).toBe('<span class="rec-badge tone-green">Won &#60;b&#62;</span>');
  });
});
