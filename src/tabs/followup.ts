import { createListNav } from '../lib/listNav';
import { PS, proposalSentDate } from '../lib/commercial';
import { S } from '../lib/state';
import { emptyState } from '../lib/ui';
import { companyLink } from '../lib/links';
import { today, fmtDate, daysSince, daysUntil, escHtml, expose, showConfirm } from '../lib/utils';
import { matchesProposalPeriod } from '../lib/period';
import { bucketOf, clearBucket, groupHeadHtml, registerStrip, stripHtml } from '../lib/pageKit';
import { closedThisMonth, followRow, followStrip, inBucket, type FollowRow, type Trail } from '../lib/pagesQueues';
import { queueRowHtml, whoOf } from './pending';
import { registerTabRenderer, refreshAll } from '../lib/registry';
import { persistProposals } from '../lib/persist';
import { getFollowups, getSnoozed, isSnoozed, proposalLastTouch } from '../core/proposals';
import { followUpCount, FOLLOW_UP_AFTER_DAYS } from '../lib/followup';
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

/** Sent proposals on this page: live, in the period, not put aside. */
export function withClients(): Proposal[] {
  return S.proposals.filter((p) => !p.archived && p.status === PS.SENT && !isSnoozed(p) && matchesProposalPeriod(p));
}

function rowFor(p: Proposal): FollowRow | null {
  return followRow(p, { today: today(), touch: proposalLastTouch(p), followUps: followUpCount(p, S.touches), touches: S.touches });
}

export function renderFollowup(): void {
  (window as any).renderProposalViews?.();
  const el = document.getElementById('fu-list');
  if (!el) return;
  const search = ((document.getElementById('fu-search') as HTMLInputElement | null)?.value || '').toLowerCase().trim();
  const props = withClients().filter((p) => !search || [p.client, p.type, p.owner, `sl# ${p.id}`, String(p.id)].some((v) => (v || '').toLowerCase().includes(search)));
  const rows = props.map(rowFor).filter((r): r is FollowRow => !!r).sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
  if (bucketOf('followup') && !rows.some((r) => inBucket(r, bucketOf('followup')))) clearBucket('followup');
  const bucket = bucketOf('followup');
  const strip = document.getElementById('fu-strip');
  if (strip) strip.innerHTML = rows.length ? stripHtml('followup', followStrip(rows, props)) : '';

  let html = '';
  if (!rows.length) {
    html = `<div class="sec">${emptyState({ icon: 'check', title: search ? 'No proposal matches' : 'Nothing with clients', body: search ? 'Try another name or SL#.' : 'Proposals show here once they are sent to the client.' })}</div>`;
  } else {
    const shown = rows.filter((r) => inBucket(r, bucket));
    const primaryId = shown.find((r) => r.urgent)?.id ?? null;
    const group = (b: 'due' | 'waiting', name: string, note: string, tone: 'amber' | 'blue') => {
      const mine = shown.filter((r) => r.bucket === b);
      return mine.length ? `<section class="pk-group">${groupHeadHtml({ tone, name, count: mine.length, note })}<div class="pk-list">${mine.map((r) => fuRowHtml(r, r.id === primaryId)).join('')}</div></section>` : '';
    };
    html = group('due', 'Due a follow-up', `${FOLLOW_UP_AFTER_DAYS} days or more since you last heard from them`, 'amber')
      + group('waiting', 'Waiting on the client', 'Not due yet', 'blue');
  }

  const snoozed = getSnoozed();
  if (snoozed.length > 0) {
    html += `<section class="pk-group is-muted">${groupHeadHtml({ tone: 'grey', name: 'Snoozed', count: snoozed.length, note: 'They come back by themselves' })}
      <div class="pq-list">${snoozed.map((p) => {
        const du = daysUntil(p.snoozedUntil);
        return `<div class="pq-row" onclick="if(!event.target.closest('a,button'))openRecord('proposal', ${p.id})">
          <span class="pq-age is-snoozed">${icon('clock', 13)}</span>
          <div class="pq-main"><div class="pq-title">${companyLink(p.companyId, p.client)}<span class="pq-services">${escHtml(p.type || '')}</span></div>
          <div class="pq-meta">Sent ${fmtDate(proposalSentDate(p))}<span class="pq-sep">·</span>back ${du === 0 ? 'tomorrow' : `in ${du} day${du === 1 ? '' : 's'}`} (${fmtDate(p.snoozedUntil)})</div></div>
          <div class="pq-actions"><button class="btn-secondary btn-sm" onclick="unsnoozeProposal(${p.id})">Wake up</button></div>
        </div>`;
      }).join('')}</div>
    </section>`;
  }

  if (S.fuShowArchived) {
    const arch = S.proposals.filter((p) => p.archived && p.status === PS.SENT && p.sentDate && (daysSince(p.sentDate) || 0) > 10);
    html += arch.length
      ? `<section class="pk-group is-archived">${groupHeadHtml({ tone: 'grey', name: 'Archived', count: arch.length })}<div class="pq-list">${arch.map((p) => fuCard(p, true)).join('')}</div></section>`
      : `<div class="soft-note">No archived follow-up proposals.</div>`;
  }

  // This month's outcome, one quiet line.
  const { won, lost } = closedThisMonth(S.proposals, today());
  if (won.length || lost.length) {
    const list = (ps: Proposal[]) => ps.map((p) => `<b>${escHtml(p.client)} — ${escHtml(p.type || 'Proposal')}</b>${p.monthlyFee ? ` · ${escHtml(fmtMoney(p.monthlyFee, currencyOf(p)))} a month` : ''}`).join(', ');
    html += `<div class="pk-note"><span class="bars" aria-hidden="true"><i></i><i></i><i></i></span><span>Won this month: ${won.length ? list(won) : 'none'}. Lost: ${lost.length ? list(lost) : 'none'}.</span></div>`;
  }
  el.innerHTML = html;
}
registerTabRenderer('followup', renderFollowup);
registerStrip('followup', () => renderFollowup());

/** The trail under a row: the line, the current silence when due, and a dot per date. */
export function trailHtml(t: Trail, due: boolean): string {
  if (!t.points.length) return '';
  const late = t.late ? `<span class="pk-trail-late" style="left:${t.late.from}%;width:${Math.max(0, t.late.to - t.late.from)}%"></span>` : '';
  const dots = t.points.map((p) => `<span class="pk-pt is-${p.kind}${p.kind === 'today' && due ? ' is-late' : ''}" style="left:${p.pos}%">${p.showLabel ? `<span>${escHtml(p.label)}</span>` : ''}</span>`).join('');
  return `<div class="pk-trail" aria-hidden="true"><span class="pk-trail-line"></span>${late}${dots}</div>`;
}

function fuRowHtml(r: FollowRow, primary: boolean, p = S.proposals.find((x) => x.id === r.id)!): string {
  return queueRowHtml(r, { primary, who: whoOf(p), below: trailHtml(r.trail, r.bucket === 'due') });
}

/** A sent proposal waiting for an answer, as a row; archived ones get Unarchive. */
export function fuCard(p: Proposal, isArchived: boolean): string {
  if (!isArchived) {
    const r = rowFor(p);
    return r ? fuRowHtml(r, false, p) : '';
  }
  return `<div class="pq-row is-archived" data-row-id="${p.id}" onclick="if(!event.target.closest('a,button'))openRecord('proposal', ${p.id})">
    <div class="pq-main"><div class="pq-title">${companyLink(p.companyId, p.client)}<span class="pq-services">${escHtml(p.type || '')}</span></div>
    <div class="pq-meta">Sent ${fmtDate(proposalSentDate(p))} · archived ${fmtDate(p.archivedAt || '')}</div></div>
    <div class="pq-actions"><button class="btn-secondary btn-sm" onclick="unarchiveProposal(${p.id});renderFollowup()">Unarchive</button></div>
  </div>`;
}
expose('renderFollowup', renderFollowup);

// ↑↓ or j k move through the rows, Enter opens one (delight 7).
createListNav<number>({
  tabId: 'followup',
  getItems: () => [...document.querySelectorAll<HTMLElement>('#tab-followup .pq-row[data-row-id]')].map((el) => Number(el.dataset.rowId)),
  getEl: (id) => document.querySelector<HTMLElement>(`#tab-followup .pq-row[data-row-id="${id}"]`),
  onOpen: (id) => (window as any).openRecord('proposal', id),
});
