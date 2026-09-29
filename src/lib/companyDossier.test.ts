// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { dossierNext, dossierRecent, whenLabel } from './companyDossier';
import type { FutureRow } from './recordTimeline';
import type { ActivityEntry, Meeting } from './types';

const row = (key: string, date: string | null, overdue = false, time: string | null = null): FutureRow => ({ key, kind: 'task', date, time, label: key, overdue });
const act = (id: number, over: Partial<ActivityEntry>): ActivityEntry => ({ id, createdAt: '2026-09-20T10:00:00Z', actor: null, action: 'status_changed', entityType: 'proposal', entityId: 7, entityLabel: 'Contoso — Payroll', detail: null, companyId: 1, contactId: null, opportunityId: null, projectId: null, ...over } as ActivityEntry);
const meeting = (id: number, date: string, over: Partial<Meeting> = {}): Meeting => ({ id, title: `Meeting ${id}`, meetingDate: date, isCancelled: false, decisions: null, discussion: null, followUp: null, actionItems: null, ...over } as Meeting);
const TODAY = '2026-09-29';

describe('Next', () => {
  it('overdue first, then soonest, five at most', () => {
    const rows = [row('b', '2026-10-05'), row('late2', '2026-09-19', true), row('a', '2026-09-30'), row('late1', '2026-09-10', true), row('c', '2026-10-01', false, '09:00'), row('d', '2026-10-09'), row('e', '2026-11-01')];
    expect(dossierNext(rows).map((r) => r.key)).toEqual(['late1', 'late2', 'a', 'c', 'b']);
  });
});

describe('Recent', () => {
  it('keeps what matters, drops the plumbing, newest first, five at most', () => {
    const activity = [
      act(1, { detail: 'Drafting → Sent to Client', createdAt: '2026-09-28T09:00:00Z' }),
      act(2, { detail: 'Proposal Request Received → Drafting', createdAt: '2026-09-27T09:00:00Z' }),
      act(3, { action: 'created', entityType: 'contact', entityLabel: 'Sara', createdAt: '2026-09-26T09:00:00Z' }),
      act(4, { action: 'completed', entityType: 'task', entityLabel: 'Send renewal pack', createdAt: '2026-09-28T12:00:00Z' }),
      act(5, { action: 'kept', entityType: 'commitment', entityLabel: 'Revised quote', createdAt: '2026-09-25T09:00:00Z' }),
      act(6, { entityType: 'agreement', entityId: 3, entityLabel: 'CON_PAY_001', detail: 'Sent → Signed', createdAt: '2026-09-24T09:00:00Z' }),
      act(7, { action: 'created', entityType: 'opportunity', entityLabel: 'GOSI audit', createdAt: '2026-06-01T09:00:00Z' }),
      act(8, { action: 'created', entityType: 'opportunity', entityLabel: 'Audit', createdAt: '2026-09-15T09:00:00Z' }),
      act(9, { action: 'updated', entityType: 'proposal', createdAt: '2026-09-29T08:00:00Z' }),
    ];
    const meetings = [meeting(20, '2026-09-26', { decisions: 'Price on three people.' }), meeting(21, '2026-09-30'), meeting(22, '2026-09-27', { isCancelled: true })];
    const rows = dossierRecent(activity, meetings, TODAY);
    expect(rows.map((r) => [r.date, r.label, r.sub])).toEqual([
      ['2026-09-28', 'Send renewal pack', 'Task completed'],
      ['2026-09-28', 'Proposal sent', 'Contoso — Payroll'],
      ['2026-09-26', 'Meeting 20', 'Price on three people.'],
      ['2026-09-25', 'Revised quote', 'Promise kept'],
      ['2026-09-24', 'Agreement signed', 'CON_PAY_001'],
    ]);
    // An opportunity created within 30 days counts; an old one doesn't.
    const opps = dossierRecent(activity.filter((a) => a.entityType === 'opportunity'), [], TODAY).map((r) => r.label);
    expect(opps).toEqual(['Audit']);
  });

  it('labels the day', () => {
    expect(whenLabel('2026-09-29', TODAY)).toBe('Today');
    expect(whenLabel('2026-09-28', TODAY)).toBe('Yesterday');
    expect(whenLabel('2026-09-15', TODAY)).toBe('15 Sept');
  });
});

describe('the company page markup', () => {
  const html = Object.values(import.meta.glob('../../index.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const page = doc.getElementById('co-detail')!;

  it('has no Open threads or Timeline headings; the timeline is folded behind All activity', () => {
    const headings = [...page.querySelectorAll('h2')].map((h) => h.textContent?.trim());
    expect(headings).not.toContain('Open threads');
    expect(headings).not.toContain('Timeline');
    expect(doc.getElementById('co-sec-activity')!.hasAttribute('hidden')).toBe(true);
  });

  it('the notes input is hidden at rest, behind Add note', () => {
    const composer = doc.getElementById('co-notes-composer')!;
    expect(composer.hasAttribute('hidden')).toBe(true);
    expect(composer.contains(doc.getElementById('co-notes-text'))).toBe(true);
  });

  it('details, people and what to remember sit in the left column', () => {
    const side = page.querySelector('.co-dossier-side')!;
    expect(['co-panel-details', 'co-sec-contacts', 'co-panel-remember'].map((id) => side.querySelector(`#${id}`) != null)).toEqual([true, true, true]);
  });
});
