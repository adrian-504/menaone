// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./db', () => {
  const ok = () => vi.fn(async () => {});
  const links = () => vi.fn(async (): Promise<{ id: number; companyId: number | null }[]> => []);
  return {
    persist: async (_label: string, fn: () => Promise<unknown>) => { try { await fn(); } catch { /* toast in the real app */ } },
    persistReturning: async (_label: string, fn: () => Promise<unknown>) => { try { return await fn(); } catch { return undefined; } },
    upsertProposals: links(), deleteProposals: ok(), upsertContacts: links(), deleteContacts: ok(),
    upsertAgreements: links(), deleteAgreements: ok(), upsertTodos: links(), deleteTodos: ok(),
    upsertCommitments: links(), deleteCommitments: ok(), commitmentsAdd: vi.fn(),
    upsertNotes: links(), deleteNotes: ok(), getCompanies: vi.fn(async () => []), saveNoteFolders: ok(), saveContactLists: ok(),
    saveCompanyNote: ok(), saveProject: ok(), saveMilestones: ok(), saveOpportunity: ok(), saveMeeting: ok(), createCompany: ok(),
  };
});

import { S } from './state';
import { markLoadedAsSaved } from './persist';
import { nudgeMailto, openPromiseCount, promisesView } from './promises';
import { renderPromisesView } from '../tabs/commitments';
import type { Commitment, Todo } from './types';

let nextId = 1;
const c = (over: Partial<Commitment> = {}): Commitment => ({
  id: nextId++, direction: 'ours', text: 'Send the quote', contactId: null, dueDate: null, status: 'open', closedAt: null,
  dropReason: null, companyId: null, opportunityId: null, projectId: null, sourceType: 'manual', sourceId: null, sourceKey: null,
  todoId: null, createdAt: null, updatedAt: null, ...over,
});
const TODAY = '2026-09-24';

describe('promisesView', () => {
  it('orders late first, then by due date, undated last', () => {
    const undated = c({ text: 'undated' });
    const later = c({ text: 'later', dueDate: '2026-10-05' });
    const late = c({ text: 'late', dueDate: '2026-09-20' });
    const soon = c({ text: 'soon', dueDate: '2026-09-24' });
    const veryLate = c({ text: 'very late', dueDate: '2026-09-01' });
    expect(promisesView([undated, later, late, soon, veryLate], TODAY).owe.map((x) => x.text)).toEqual(['very late', 'late', 'soon', 'later', 'undated']);
  });

  it('splits by direction and leaves closed ones out of both', () => {
    const v = promisesView([
      c({ text: 'ours' }), c({ text: 'theirs', direction: 'theirs' }),
      c({ text: 'kept ours', status: 'kept', closedAt: '2026-09-23T10:00:00Z' }),
      c({ text: 'dropped theirs', direction: 'theirs', status: 'dropped', closedAt: '2026-09-22T10:00:00Z' }),
    ], TODAY);
    expect(v.owe.map((x) => x.text)).toEqual(['ours']);
    expect(v.owed.map((x) => x.text)).toEqual(['theirs']);
    expect(v.closed.map((x) => x.text)).toEqual(['kept ours', 'dropped theirs']);
  });

  it('folds only what was kept or dropped in the last 30 days', () => {
    const v = promisesView([
      c({ text: 'yesterday', status: 'kept', closedAt: '2026-09-23T09:00:00Z' }),
      c({ text: '30 days', status: 'kept', closedAt: '2026-08-25T09:00:00Z' }),
      c({ text: '31 days', status: 'dropped', closedAt: '2026-08-24T09:00:00Z' }),
      c({ text: 'no date', status: 'kept', closedAt: null }),
    ], TODAY);
    expect(v.closed.map((x) => x.text)).toEqual(['yesterday', '30 days']);
  });

  it('the rail count is every open promise, both directions', () => {
    expect(openPromiseCount([c(), c({ direction: 'theirs' }), c({ status: 'kept' })])).toBe(2);
  });

  it('a nudge is a draft to whoever promised it, never a send', () => {
    const url = nudgeMailto('jane@acme.test', 'the signed contract');
    expect(url.startsWith('mailto:jane@acme.test?')).toBe(true);
    expect(decodeURIComponent(url)).toContain('subject=Following up: the signed contract');
    expect(nudgeMailto(null, 'x').startsWith('mailto:?')).toBe(true);
  });
});

describe('Tasks → Promises on screen', () => {
  const task = (over: Partial<Todo> = {}): Todo => ({ id: 50, title: 'Send the quote', type: 'general', client: null, priority: 'Medium', dueDate: '2026-09-20', status: 'Pending', description: null,
    createdAt: null, completedAt: null, projectId: null, parentId: null, areaId: null, section: null, sortOrder: null, recurrenceRule: null, tags: [], meetingId: null, ...over });
  const settle = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    document.body.innerHTML = '<div id="todo-list"></div>';
    S.proposals = []; S.contacts = []; S.companies = []; S.meetings = []; S.notes = [];
    S.todos = [task()];
    S.commitments = [
      c({ id: 900, text: 'Send the quote', dueDate: '2026-09-20', todoId: 50 }),
      c({ id: 901, text: 'Signed contract', direction: 'theirs' }),
    ];
    markLoadedAsSaved();
  });

  it('shows You owe and Owed to you, each with its rows', () => {
    renderPromisesView('todo-list');
    expect(document.querySelector('#pm-owe .cm-row')?.getAttribute('data-commitment-id')).toBe('900');
    expect(document.querySelector('#pm-owed .cm-row')?.getAttribute('data-commitment-id')).toBe('901');
    expect(document.querySelector('#pm-owe .rec-count')?.textContent).toContain('1 late');
  });

  it('an empty section is one quiet line after the full one', () => {
    S.commitments = [c({ id: 902, direction: 'theirs', text: 'Headcount' })];
    renderPromisesView('todo-list');
    const secs = [...document.querySelectorAll('#todo-list > .pm-sec')];
    expect(secs.map((s) => s.id)).toEqual(['pm-owed', 'pm-owe']);
    expect(secs[1].classList.contains('is-empty')).toBe(true);
    expect(secs[1].querySelector('.cm-row')).toBeNull();
  });

  it('Mark kept from the view completes the linked task', async () => {
    renderPromisesView('todo-list');
    // The checkbox calls the shared handler (jsdom doesn't run inline handlers against window).
    const check = document.querySelector('#pm-owe .cm-row .task-check') as HTMLButtonElement;
    expect(check.getAttribute('onclick')).toBe('toggleCommitmentKept(900)');
    (window as any).toggleCommitmentKept(900);
    await settle();
    expect(S.commitments.find((x) => x.id === 900)?.status).toBe('kept');
    expect(S.todos[0].status).toBe('Done');
    // The view redraws: the promise has moved to the folded kept list.
    expect(document.querySelector('#pm-owe .cm-row')).toBeNull();
    expect(document.querySelector('.pm-closed .cm-row')?.getAttribute('data-commitment-id')).toBe('900');
  });
});
