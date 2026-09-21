// The Brief: one clean, read-only page on a company to read before a meeting
// or print (⌘P / Save as PDF prints it alone, in Light). Built from the same
// rules as Company 360 (lib/companyBrief.ts); nothing new is stored.

import { S } from '../lib/state';
import { escHtml, expose, fmtDate } from '../lib/utils';
import { renderIcons } from '../core/chrome';
import { icon } from '../lib/icons';
import { clauseText, companyRecords, lastContactByPerson, liveThreads, orderPeople, type BriefClause } from '../lib/companyBrief';
import { briefInputFor, companyStateFor, ensurePinnedNotes } from './companyState';

let openFor: string | null = null;
let returnFocus: HTMLElement | null = null;

function companyKey(name: string): { id: number | null; name: string } {
  return { id: S.companies.find((c) => c.name === name)?.id ?? null, name };
}

function briefHtml(name: string): string {
  const key = companyKey(name);
  const input = briefInputFor(key);
  const r = companyRecords(input);
  const threads = liveThreads(input, r);
  const last = lastContactByPerson(input, r);
  const people = orderPeople(r.contacts, last);
  const now = input.now || `${input.today}T12:00:00`;
  const next = r.meetings.filter((m) => m.meetingDate && m.meetingDate >= input.today && !(m.startAt && m.startAt <= now))
    .sort((a, b) => (a.startAt || a.meetingDate!).localeCompare(b.startAt || b.meetingDate!))[0];
  const ours = r.commitments.filter((c) => c.direction === 'ours');
  const theirs = r.commitments.filter((c) => c.direction === 'theirs');
  const promiseLine = (c: typeof ours[number]) => {
    const who = c.contactId != null ? S.contacts.find((x) => x.id === c.contactId)?.name : null;
    const late = c.dueDate && c.dueDate < input.today;
    return `<li>${escHtml(c.text)}${who ? ` <span class="bv-muted">— ${escHtml(who)}</span>` : ''}${c.dueDate ? ` <span class="bv-muted${late ? ' bv-late' : ''}">· due ${escHtml(fmtDate(c.dueDate))}${late ? ' (late)' : ''}</span>` : ''}</li>`;
  };
  const state = briefStateHtml(companyStateFor(key));
  const time = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
  return `<article class="bv-page">
    <header class="bv-head">
      <h1>${escHtml(name)}</h1>
      <div class="bv-date">Brief · ${escHtml(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</div>
    </header>
    <section class="bv-sec"><h2>Where we stand</h2>${state}</section>
    ${threads.length ? `<section class="bv-sec"><h2>Open threads</h2><ul>${threads.map((t) => `<li><strong>${escHtml(t.label || 'Engagement')}</strong> — ${escHtml(t.phrase)}</li>`).join('')}</ul></section>` : ''}
    ${people.length ? `<section class="bv-sec"><h2>People</h2><ul>${people.map((c) => {
      const lc = last.get(c.id);
      return `<li><strong>${escHtml(c.name || 'Unnamed')}</strong>${c.role ? ` — ${escHtml(c.role)}` : ''}${c.isDecisionMaker ? ' · <span class="bv-tag">Decision maker</span>' : ''}${lc ? ` <span class="bv-muted">· last contact ${escHtml(fmtDate(lc.date))}, ${escHtml(lc.label)}</span>` : ''}</li>`;
    }).join('')}</ul></section>` : ''}
    ${ours.length || theirs.length ? `<section class="bv-sec"><h2>Open commitments</h2>
      ${ours.length ? `<h3>We owe</h3><ul>${ours.map(promiseLine).join('')}</ul>` : ''}
      ${theirs.length ? `<h3>They owe</h3><ul>${theirs.map(promiseLine).join('')}</ul>` : ''}</section>` : ''}
    <section class="bv-sec"><h2>Next meeting</h2>${next
      ? `<p><strong>${escHtml(next.title)}</strong> — ${escHtml(fmtDate(next.meetingDate))}${next.startAt ? ` at ${escHtml(time(next.startAt))}` : ''}${next.location ? `, ${escHtml(next.location)}` : ''}</p>`
      : '<p class="bv-muted">None scheduled.</p>'}</section>
  </article>`;
}

/** The state clauses as plain sentences (links are for the screen; a brief is read on paper too). */
function briefStateHtml(clauses: BriefClause[]): string {
  return clauses.map((c) => `${c.quotes?.length ? c.quotes.map((q) => `<blockquote class="bv-quote">${escHtml(q)}</blockquote>`).join('') : ''}${clauseText(c) ? `<p${c.tone === 'amber' || c.tone === 'red' ? ' class="bv-flag"' : ''}>${escHtml(clauseText(c))}</p>` : ''}`).join('');
}

export function openCompanyBrief(name?: string | null): void {
  const company = name || S.currentCompany;
  if (!company) return;
  openFor = company;
  returnFocus = document.activeElement as HTMLElement | null;
  let el = document.getElementById('brief-view');
  if (!el) {
    el = document.createElement('div');
    el.id = 'brief-view';
    el.className = 'brief-view';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Brief');
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeCompanyBrief(); } });
    document.body.appendChild(el);
  }
  const render = () => {
    if (openFor !== company || !el) return;
    el.innerHTML = `<div class="bv-bar">
        <button class="btn-secondary btn-sm" onclick="closeCompanyBrief()">${icon('close', 12)} Close</button>
        <button class="btn-primary btn-sm" onclick="printCompanyBrief()">Print or save as PDF</button>
      </div>${briefHtml(company)}`;
    renderIcons(el);
  };
  render();
  ensurePinnedNotes(companyKey(company), render);
  document.body.classList.add('brief-open');
  el.hidden = false;
  el.querySelector<HTMLElement>('.bv-bar .btn-primary')?.focus();
}
expose('openCompanyBrief', openCompanyBrief);

export function closeCompanyBrief(): void {
  const el = document.getElementById('brief-view');
  if (el) { el.hidden = true; el.innerHTML = ''; }
  document.body.classList.remove('brief-open');
  openFor = null;
  returnFocus?.focus?.();
}
expose('closeCompanyBrief', closeCompanyBrief);

export function printCompanyBrief(): void {
  window.print();
}
expose('printCompanyBrief', printCompanyBrief);
