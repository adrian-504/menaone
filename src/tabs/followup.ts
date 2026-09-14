import { PS } from '../lib/commercial';
import { S } from '../lib/state';
import { emptyState } from '../lib/ui';
import { companyLink } from '../lib/links';
import { today, fmtDate, daysSince, daysUntil, escHtml, expose, showConfirm } from '../lib/utils';
import { registerTabRenderer, refreshAll } from '../lib/registry';
import { persistProposals } from '../lib/persist';
import { getFollowups, getSnoozed } from '../core/proposals';
import { fmtMoney, currencyOf } from '../lib/commercial';
import { icon } from '../lib/icons';
import type { Proposal } from '../lib/types';

export function toggleFuArchived(): void {
  S.fuShowArchived = !S.fuShowArchived;
  const btn = document.getElementById('fu-toggle-archived');
  if (btn) {
    btn.classList.toggle('active', S.fuShowArchived);
    btn.textContent = S.fuShowArchived ? 'Hide archived' : 'Show archived';
  }
  renderFollowup();
}
expose('toggleFuArchived', toggleFuArchived);

export async function archiveAllFollowup(): Promise<void> {
  const fu = getFollowups();
  if (fu.length === 0) return;
  if (!(await showConfirm(`Archive all ${fu.length} follow-up proposal${fu.length > 1 ? 's' : ''}?\n\nThey will be hidden from this tab but stay under Proposals with “Show archived”.`, { confirmLabel: 'Archive all' }))) return;
  fu.forEach((p) => { p.archived = true; p.archivedAt = today(); });
  persistProposals();
  refreshAll();
}
expose('archiveAllFollowup', archiveAllFollowup);

export function renderFollowup(): void {
  (window as any).renderProposalViews?.();
  const fu = getFollowups();
  const el = document.getElementById('fu-list');
  if (!el) return;
  let html = '';

  if (fu.length === 0) {
    html = `<div class="card">${emptyState({ icon: 'check', title: 'All clear', body: 'Every sent proposal has been updated within the last 10 days.' })}</div>`;
  } else {
    html = `<section class="card pq-group"><div class="pq-list">${fu.map((p) => fuCard(p, false)).join('')}</div></section>`;
  }

  const snoozed = getSnoozed();
  if (snoozed.length > 0) {
    html += `<section class="card pq-group is-muted">
      <div class="rec-section-hd"><h2>Snoozed</h2><span class="rec-count">${snoozed.length}</span><span class="rec-muted">They come back by themselves</span></div>
      <div class="pq-list">${snoozed.map((p) => {
        const du = daysUntil(p.snoozedUntil);
        return `<div class="pq-row" onclick="if(!event.target.closest('a,button'))openRecord('proposal', ${p.id})">
          <span class="pq-age is-snoozed" title="Snoozed">${icon('clock', 13)}</span>
          <div class="pq-main"><div class="pq-title">${companyLink(p.companyId, p.client)}<span class="pq-services">${escHtml(p.type || '')}</span></div>
          <div class="pq-meta">Sent ${fmtDate(p.dateSentToClient || p.sentDate)}<span class="pq-sep">·</span>back ${du === 0 ? 'tomorrow' : `in ${du} day${du === 1 ? '' : 's'}`} (${fmtDate(p.snoozedUntil)})</div></div>
          <div class="pq-actions"><button class="btn-sm" onclick="unsnoozeProposal(${p.id})">Wake up</button></div>
        </div>`;
      }).join('')}</div>
    </section>`;
  }

  if (S.fuShowArchived) {
    const arch = S.proposals.filter((p) => p.archived && p.status === PS.SENT && p.sentDate && (daysSince(p.sentDate) || 0) > 10);
    if (arch.length > 0) {
      html += `<section class="card pq-group is-muted">
        <div class="rec-section-hd"><h2>Archived</h2><span class="rec-count">${arch.length}</span></div>
        <div class="pq-list">${arch.map((p) => fuCard(p, true)).join('')}</div>
      </section>`;
    } else {
      html += `<div class="soft-note">No archived follow-up proposals.</div>`;
    }
  }
  el.innerHTML = html;
}
registerTabRenderer('followup', renderFollowup);

/** A sent proposal waiting for an answer: how long, the last note, and the outcome buttons. */
export function fuCard(p: Proposal, isArchived: boolean): string {
  const sent = p.dateSentToClient || p.sentDate;
  const days = daysSince(sent) || 0;
  const tone = days > 30 ? 'age-urgent' : days > 20 ? 'age-late' : 'age-warn';
  const notes = p.notes || [];
  const latest = notes[notes.length - 1];
  const meta = [`Sent ${fmtDate(sent)}`, `SL# ${p.id}`, p.owner ? escHtml(p.owner) : '', p.winLossReason ? `previously: ${escHtml(p.winLossReason)}` : ''].filter(Boolean).join('<span class="pq-sep">·</span>');
  return `<div class="pq-row${isArchived ? ' is-archived' : ''}" onclick="if(!event.target.closest('a,button'))openRecord('proposal', ${p.id})" oncontextmenu="pqMenu(event, ${p.id})">
    <span class="pq-age ${isArchived ? '' : tone}" title="${days} days since it was sent">${days}<small>d</small></span>
    <div class="pq-main">
      <div class="pq-title">${companyLink(p.companyId, p.client)}<span class="pq-services">${escHtml(p.type || '')}</span></div>
      <div class="pq-meta">${meta}</div>
      ${latest?.text ? `<button class="pq-note" onclick="openNotesModal(${p.id})" title="All notes">${icon('note', 11)} <strong>${fmtDate(latest.date)}</strong> ${escHtml(latest.text.length > 120 ? `${latest.text.slice(0, 120)}…` : latest.text)}</button>` : ''}
    </div>
    ${p.monthlyFee ? `<span class="pq-fee">${fmtMoney(p.monthlyFee, currencyOf(p))}<small>/mo</small></span>` : '<span class="pq-fee"></span>'}
    <div class="pq-actions">
      ${isArchived ? `<button class="btn-sm" onclick="unarchiveProposal(${p.id});renderFollowup()">Unarchive</button>` : `
      <button class="btn-secondary btn-compact" onclick="openNotesModal(${p.id})" title="Log what the client said">Log follow-up</button>
      <button class="btn-secondary btn-compact pq-won" onclick="openWlModal(${p.id},'won')" title="Signed by both parties">Won</button>
      <button class="btn-secondary btn-compact pq-lost" onclick="openWlModal(${p.id},'lost')">Lost</button>`}
      <button class="rec-icon-btn" onclick="pqMenu(event, ${p.id})" title="More" aria-label="More">${icon('more', 14)}</button>
    </div>
  </div>`;
}
expose('renderFollowup', renderFollowup);
