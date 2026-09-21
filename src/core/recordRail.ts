// The list beside an open record: while a company, contact, proposal,
// agreement, opportunity, project or meeting is open, its module's records
// stay visible on the left so you can move between them without going back
// to the list. Toggled from the location bar; remembered on this device.
//
// Scope is deliberate. Tasks and Notes are NOT in `SUPPORTED` on purpose:
// their modules already keep their own list beside the open item (the task
// list with its detail panel, the notes sidebar beside the editor), so a
// second list would duplicate it. They still take part in routing, history,
// links and recents like every other record. Add a kind here only for a
// record that opens as a full page without its list.

import { S } from '../lib/state';
import { escHtml, expose, fmtDate } from '../lib/utils';
import { icon } from '../lib/icons';
import type { RecordKind } from '../lib/navHistory';

interface RailRow { key: number; title: string; sub: string; search: string }

const w = window as any;
const PREF_KEY = 'menaone.recordRail';
const SUPPORTED: Partial<Record<RecordKind, { label: string; rows: () => RailRow[] }>> = {
  company: {
    label: 'Companies',
    rows: () => S.companies.filter((c) => !c.archived).sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ key: c.id, title: c.name, sub: [c.industries?.[0], c.city || c.country].filter(Boolean).join(' · '), search: `${c.name} ${c.industries?.join(' ')} ${c.city || ''}` })),
  },
  contact: {
    label: 'Contacts',
    rows: () => [...S.contacts].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map((c) => ({ key: c.id, title: c.name || 'Unnamed contact', sub: [c.role, c.clientName].filter(Boolean).join(' · '), search: `${c.name} ${c.clientName} ${c.email} ${c.role}` })),
  },
  proposal: {
    label: 'Proposals',
    rows: () => S.proposals.filter((p) => !p.archived).sort((a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || '') || b.id - a.id)
      .map((p) => ({ key: p.id, title: p.client, sub: [p.status, p.type].filter(Boolean).join(' · '), search: `${p.client} ${p.type} ${p.status} ${p.id}` })),
  },
  agreement: {
    label: 'Agreements',
    rows: () => [...S.agreements].sort((a, b) => (b.createdAt || b.datePrepared || '').localeCompare(a.createdAt || a.datePrepared || '') || b.id - a.id)
      .map((a) => ({ key: a.id, title: a.client || a.agrRef || 'Agreement', sub: [a.agrRef, a.serviceStatus || a.status].filter(Boolean).join(' · '), search: `${a.client} ${a.agrRef} ${a.type}` })),
  },
  opportunity: {
    label: 'Opportunities',
    rows: () => S.opportunities.filter((o) => !o.archived).sort((a, b) => Number(a.status !== 'Open') - Number(b.status !== 'Open') || (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .map((o) => ({ key: o.id, title: o.name, sub: [o.companyName, o.stage].filter(Boolean).join(' · '), search: `${o.name} ${o.companyName} ${o.stage}` })),
  },
  project: {
    label: 'Projects',
    rows: () => S.projects.filter((p) => !p.archived).sort((a, b) => Number(a.status === 'Completed') - Number(b.status === 'Completed') || a.name.localeCompare(b.name))
      .map((p) => ({ key: p.id, title: p.name, sub: [p.companyName, p.status].filter(Boolean).join(' · '), search: `${p.name} ${p.companyName} ${p.status}` })),
  },
  meeting: {
    label: 'Meetings',
    rows: () => S.meetings.filter((m) => !m.isCancelled).sort((a, b) => (b.meetingDate || '').localeCompare(a.meetingDate || '') || b.id - a.id)
      .map((m) => ({ key: m.id, title: m.title, sub: [m.meetingDate ? fmtDate(m.meetingDate) : '', m.companyName].filter(Boolean).join(' · '), search: `${m.title} ${m.companyName} ${m.meetingDate}` })),
  },
};

let query = '';
let railKind: RecordKind | null = null;

export function railEnabled(): boolean {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return v == null ? window.innerWidth >= 1280 : v === 'on';
  } catch { return window.innerWidth >= 1280; }
}

export function supportsRail(kind: RecordKind | undefined): boolean {
  return !!kind && !!SUPPORTED[kind];
}

/** Called by the router whenever the place changes or records change. */
export function updateRecordRail(kind: RecordKind | undefined, key: number | string | undefined): void {
  const main = document.querySelector('main');
  const rail = document.getElementById('record-rail');
  const toggle = document.getElementById('loc-rail') as HTMLButtonElement | null;
  // Never beside a create page (the builder is proposal 'new').
  const supported = supportsRail(kind) && key != null && key !== 'new';
  if (toggle) {
    toggle.hidden = !supported;
    toggle.classList.toggle('active', supported && railEnabled());
    toggle.title = railEnabled() ? 'Hide the list' : 'Show the list beside the record';
  }
  const on = supported && railEnabled();
  main?.classList.toggle('with-rail', on);
  if (!rail) return;
  rail.hidden = !on;
  if (!on) return;
  // Company records are sometimes opened by name; highlight by id either way.
  const currentId = kind === 'company' && typeof key === 'string' ? S.companies.find((c) => c.name === key)?.id ?? null : Number(key);
  if (railKind !== kind) { railKind = kind!; query = ''; }
  const cfg = SUPPORTED[kind!]!;
  if (!rail.querySelector('.rr-search')) {
    rail.innerHTML = `<div class="rr-head"><span class="rr-title"></span><button class="rec-icon-btn" onclick="toggleRecordRail()" title="Hide the list" aria-label="Hide the list">${icon('sidebar', 14)}</button></div>
      <input type="text" class="rr-search" placeholder="Filter…" oninput="recordRailFilter(this.value)" onkeydown="recordRailKey(event)" aria-label="Filter the list">
      <div class="rr-list" role="listbox" tabindex="-1" onkeydown="recordRailKey(event)"></div>`;
  }
  const title = rail.querySelector('.rr-title'); if (title) title.textContent = cfg.label;
  const input = rail.querySelector<HTMLInputElement>('.rr-search');
  if (input && document.activeElement !== input && input.value !== query) input.value = query;
  const q = query.trim().toLowerCase();
  const rows = cfg.rows().filter((r) => !q || r.search.toLowerCase().includes(q));
  const list = rail.querySelector<HTMLElement>('.rr-list');
  if (!list) return;
  list.innerHTML = rows.length
    ? rows.map((r) => `<button class="rr-row${r.key === currentId ? ' current' : ''}" role="option" aria-selected="${r.key === currentId}" data-key="${r.key}" onclick="openRecord('${kind}', ${r.key})">
        <span class="rr-row-title">${escHtml(r.title)}</span>${r.sub ? `<span class="rr-row-sub">${escHtml(r.sub)}</span>` : ''}
      </button>`).join('')
    : `<div class="rr-empty">No matches</div>`;
  const current = list.querySelector<HTMLElement>('.rr-row.current');
  if (current) {
    const top = current.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - current.offsetHeight) list.scrollTop = Math.max(0, top - list.clientHeight / 3);
  }
}

export function toggleRecordRail(): void {
  try { localStorage.setItem(PREF_KEY, railEnabled() ? 'off' : 'on'); } catch { /* not remembered */ }
  w.refreshLocationChrome?.();
}
expose('toggleRecordRail', toggleRecordRail);

export function recordRailFilter(value: string): void {
  query = value;
  w.refreshLocationChrome?.();
}
expose('recordRailFilter', recordRailFilter);

/** ↑/↓ move to the previous/next record in the list; Enter opens the first match. */
export function recordRailKey(e: KeyboardEvent): void {
  if (!railKind) return;
  const rows = [...document.querySelectorAll<HTMLElement>('#record-rail .rr-row')];
  if (!rows.length) return;
  const idx = rows.findIndex((r) => r.classList.contains('current'));
  let target: HTMLElement | undefined;
  if (e.key === 'ArrowDown') target = rows[Math.min(rows.length - 1, idx + 1)];
  else if (e.key === 'ArrowUp') target = rows[Math.max(0, idx - 1)];
  else if (e.key === 'Enter' && (e.target as HTMLElement).classList.contains('rr-search')) target = rows[0];
  else if (e.key === 'Escape') { (e.target as HTMLElement).blur(); return; }
  if (!target) return;
  e.preventDefault();
  e.stopPropagation();
  w.openRecord(railKind, Number(target.dataset.key));
}
expose('recordRailKey', recordRailKey);
