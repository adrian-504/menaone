import { createListNav } from '../lib/listNav';
import { keepPlace } from '../lib/keepPlace';
import { PS, proposalSentDate, teamMember, defaultReviewer, fmtMoney, currencyOf } from '../lib/commercial';
import { ownDomains } from '../lib/clientMatch';
import { S } from '../lib/state';
import { emptyState, toast } from '../lib/ui';
import { companyLink } from '../lib/links';
import { today, fmtDate, daysSince, daysUntil, escHtml, expose, showConfirm, showDatePrompt, showTextPrompt } from '../lib/utils';
import { fmtDateShort } from '../lib/dates';
import { matchesProposalPeriod } from '../lib/period';
import { ageHtml, bucketOf, clearBucket, groupHeadHtml, plural, registerStrip, stripHtml, tileHtml, valueHtml } from '../lib/pageKit';
import { pricingShape } from '../lib/pricingShape';
import { cardFor } from '../lib/linesEditor';
import { closedThisMonth, proposalValue, type MetaBit, type Trail } from '../lib/pagesQueues';
import { DECIDE_DAYS, KEEP_DAYS, buildRequests, requestInBucket, requestStrip, statusList, type FollowRequest, type RequestActionKind, type RequestBucket, type RequestContext } from '../lib/followRequests';
import { pqMenu } from './pending';
import { proposalContact } from '../lib/pagePeople';
import { registerTabRenderer, refreshAll } from '../lib/registry';
import { persistProposals } from '../lib/persist';
import { contactFirstName, followUpMenu, getFollowups, getSnoozed, isSnoozed, openRevisionDialog, openWlModal } from '../core/proposals';
import { bulkApply } from '../core/proposalBulk';
import { logEntry, openEntryDialog } from '../core/followLog';
import { hideBulkBar, renderBulkBar, type BulkAction } from '../lib/bulkBar';
import { rangeIds } from '../lib/bulkProposals';
import { FOLLOW_UP_AFTER_DAYS, backInDays } from '../lib/followup';
import { menuHead, showContextMenu, showMenuAt } from '../lib/contextMenu';
import { icon } from '../lib/icons';
import type { Proposal, TouchKind } from '../lib/types';

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

const firstName = (name: string | null | undefined) => (name || '').trim().split(/\s+/)[0] || null;

/** What the request rows are built from: the log, the client's emails and meetings, who is who. */
function requestContext(): RequestContext {
  return {
    today: today(), emails: S.emails, meetings: S.meetings, ownDomains: ownDomains(), touches: S.touches, contactName: contactFirstName,
    memberName: (id) => firstName(teamMember(id)?.name), hasContact: (p) => !!proposalContact(p), shape: (p) => pricingShape(p.lines, cardFor),
  };
}

/** The requests on the page (after the search box), oldest first, a client's together. */
export function followRequests(): { rows: FollowRequest[]; props: Proposal[] } {
  const search = ((document.getElementById('fu-search') as HTMLInputElement | null)?.value || '').toLowerCase().trim();
  const props = withClients().filter((p) => !search || [p.client, p.type, p.owner, `sl# ${p.id}`, String(p.id)].some((v) => (v || '').toLowerCase().includes(search)));
  return { rows: buildRequests(props, requestContext()), props };
}

/** The request a row stands for, by its first proposal. */
function requestOf(lead: number): FollowRequest | null {
  return followRequests().rows.find((r) => r.ids.includes(lead)) ?? null;
}

/** Requests whose proposals are shown under their row. */
const fuOpen = new Set<string>();

const GROUPS: { bucket: RequestBucket; name: string; note: string; tone: 'red' | 'amber' | 'blue' }[] = [
  { bucket: 'decide', name: 'Decide', note: `${DECIDE_DAYS} days or more with no word from them: close it, keep it with a reason, or snooze it`, tone: 'red' },
  { bucket: 'due', name: 'Due a follow-up', note: `${FOLLOW_UP_AFTER_DAYS} days or more since the last contact`, tone: 'amber' },
  { bucket: 'waiting', name: 'Waiting on the client', note: 'Not due yet', tone: 'blue' },
];

/** Redrawn in place: the page keeps its scroll position and the focus stays on the row acted on. */
export function renderFollowup(): void {
  keepPlace(drawFollowup);
}

function drawFollowup(): void {
  (window as any).renderProposalViews?.();
  const el = document.getElementById('fu-list');
  if (!el) return;
  const search = ((document.getElementById('fu-search') as HTMLInputElement | null)?.value || '').toLowerCase().trim();
  const { rows, props } = followRequests();
  if (bucketOf('followup') && !rows.some((r) => requestInBucket(r, bucketOf('followup')))) clearBucket('followup');
  const bucket = bucketOf('followup');
  const strip = document.getElementById('fu-strip');
  if (strip) strip.innerHTML = rows.length ? stripHtml('followup', requestStrip(rows, props)) : '';

  let html = '';
  if (!rows.length) {
    html = `<div class="sec">${emptyState({ icon: 'check', title: search ? 'No proposal matches' : 'Nothing with clients', body: search ? 'Try another name or SL#.' : 'Proposals show here once they are sent to the client.' })}</div>`;
  } else {
    const shown = rows.filter((r) => requestInBucket(r, bucket));
    const primaryKey = shown.find((r) => r.urgent)?.key ?? null;
    html = GROUPS.map((g) => {
      const mine = shown.filter((r) => r.bucket === g.bucket);
      return mine.length ? `<section class="pk-group">${groupHeadHtml({ tone: g.tone, name: g.name, count: mine.length, note: g.note })}<div class="pk-list">${mine.map((r) => requestRowHtml(r, r.key === primaryKey)).join('')}</div></section>` : '';
    }).join('');
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
      ? `<section class="pk-group is-archived">${groupHeadHtml({ tone: 'grey', name: 'Archived', count: arch.length })}<div class="pq-list">${arch.map((p) => fuCard(p)).join('')}</div></section>`
      : `<div class="soft-note">No archived follow-up proposals.</div>`;
  }

  // This month's outcome, one quiet line.
  const { won, lost } = closedThisMonth(S.proposals, today());
  if (won.length || lost.length) {
    const list = (ps: Proposal[]) => ps.map((p) => `<b>${escHtml(p.client)} — ${escHtml(p.type || 'Proposal')}</b>${p.monthlyFee ? ` · ${escHtml(fmtMoney(p.monthlyFee, currencyOf(p)))} a month` : ''}`).join(', ');
    html += `<div class="pk-note"><span class="bars" aria-hidden="true"><i></i><i></i><i></i></span><span>Won this month: ${won.length ? list(won) : 'none'}. Lost: ${lost.length ? list(lost) : 'none'}.</span></div>`;
  }
  el.innerHTML = html;
  paintFuSelection();
}
registerTabRenderer('followup', renderFollowup);
registerStrip('followup', () => renderFollowup());

/** In a row's narrow trail two dates closer than this (percent of the line) would run into each other. */
const ROW_LABEL_GAP = 24;

/** The trail in a row: the line, the current silence when due, and a dot per date. */
export function trailHtml(t: Trail, due: boolean): string {
  if (!t.points.length) return '';
  const late = t.late ? `<span class="pk-trail-late" style="left:${t.late.from}%;width:${Math.max(0, t.late.to - t.late.from)}%"></span>` : '';
  // In the row's narrow trail "today" gives way to an expiry right beside it: the red date matters more.
  // The dates of the send, today and the expiry always show; a touch's date shows only with room either side.
  const expiry = t.points.find((p) => p.kind === 'expiry');
  const fixed = t.points.filter((p) => p.kind !== 'touch' && !(p.kind === 'today' && expiry && expiry.pos - p.pos < ROW_LABEL_GAP));
  const shown = new Set(fixed);
  for (const p of t.points) {
    if (p.kind !== 'touch' || !p.showLabel) continue;
    if ([...shown].every((q) => Math.abs(q.pos - p.pos) >= ROW_LABEL_GAP)) shown.add(p);
  }
  const dots = t.points.map((p) => `<span class="pk-pt is-${p.kind}${p.kind === 'today' && due ? ' is-late' : ''}" style="left:${p.pos}%">${shown.has(p) ? `<span>${escHtml(p.label)}</span>` : ''}</span>`).join('');
  return `<div class="pk-trail" aria-hidden="true"><span class="pk-trail-line"></span>${late}${dots}</div>`;
}

const sep = '<span class="pk-sep">·</span>';
const bitsHtml = (bits: MetaBit[]) => bits.map((m) => (m.chip ? `<span class="pk-chip t-${m.tone || 'amber'}">${escHtml(m.text)}</span>` : m.tone ? `<span class="t-${m.tone}">${escHtml(m.text)}</span>` : escHtml(m.text))).join(sep);

/** One request as a row: the client, a chip per service, what was sent and followed up, the client's last word, the
 * trail, what it is worth together, how long since the last contact, and its actions. A request of several proposals
 * opens to show them; a single one opens its proposal. */
export function requestRowHtml(r: FollowRequest, primary: boolean): string {
  const lead = r.ids[0];
  const many = r.ids.length > 1;
  const open = many && fuOpen.has(r.key);
  const chips = r.services.map((s) => `<span class="fr-chip">${escHtml(s)}</span>`).join('');
  const acts = r.actions.map((a, i) => {
    const blue = primary && i === r.actions.length - 1;
    const menu = a.kind === 'followed_up';
    return `<button class="${blue ? 'btn-primary' : 'btn-secondary'} btn-sm${a.kind === 'decide_lost' ? ' is-danger' : ''}" onclick="event.stopPropagation();fuAct(event, ${lead}, '${a.kind}')"${menu ? ' aria-haspopup="menu"' : ''}>${escHtml(a.label)}${menu ? ` ${icon('chevronDown', 11)}` : ''}</button>`;
  }).join('');
  const ticked = fuSelected.has(r.key);
  const row = `<div class="pq-row pk-row has-mid fr-row${open ? ' is-open' : ''}${ticked ? ' is-selected' : ''}" data-row-id="${lead}" onclick="if(!event.target.closest('a,button,input,label'))fuOpenRow(${lead})" oncontextmenu="fuMenu(event, ${lead})">
    <label class="pk-chk"><input type="checkbox" ${ticked ? 'checked' : ''} onclick="fuCheckClick(event, ${lead})" aria-label="Select ${escHtml(r.client)}, ${escHtml(r.services.join(', '))}"></label>${tileHtml(r.client)}
    <div class="pk-main">
      <div class="pk-title">${companyLink(r.companyId, r.client)}<span class="fr-chips">${chips}</span>${many
        ? `<button class="fr-count" onclick="event.stopPropagation();fuToggle(${lead})" aria-expanded="${open}" data-tip="${open ? 'Hide' : 'Show'} its proposals">${r.ids.length} proposals ${icon(open ? 'chevronDown' : 'chevronRight', 11)}</button>`
        : `<span class="pk-sl">SL# ${lead}</span>`}</div>
      <div class="pk-meta">${bitsHtml(r.meta)}</div>
      <div class="pk-meta fr-word">${bitsHtml(r.word)}</div>
    </div>
    <div class="pk-mid">${trailHtml(r.trail, r.bucket !== 'waiting')}</div>
    ${valueHtml(r.amount, r.amountCaption, r.amountShape)}
    ${ageHtml(r.age, r.ageCaption, r.tone)}
    <div class="pk-acts">${acts}</div>
    <button class="rec-icon-btn pk-more" onclick="event.stopPropagation();fuMenu(event, ${lead})" data-tip="More" aria-label="More">${icon('more', 14)}</button>
  </div>`;
  if (!open) return row;
  // Its proposals: the service, the SL#, the day sent and what each is worth.
  const members = r.ids.map((id) => S.proposals.find((p) => p.id === id)).filter((p): p is Proposal => !!p).map((p) => {
    const v = proposalValue(p, pricingShape(p.lines, cardFor));
    return `<div class="fr-member rec-row" tabindex="0" data-proposal-id="${p.id}" onclick="openRecord('proposal', ${p.id})" onkeydown="if(event.key==='Enter'&&event.target===this)this.click()">
      <span class="fr-member-t">${escHtml(p.type || 'Proposal')}</span><span class="pk-sl">SL# ${p.id}</span>
      <span class="fr-member-s">sent ${escHtml(fmtDateShort(proposalSentDate(p), true))}</span>
      <span class="fr-member-v">${v.amount ? `${escHtml(v.amount)} ${escHtml(v.caption)}` : escHtml(v.caption)}</span>
      <button class="rlink" onclick="event.stopPropagation();openRecord('proposal', ${p.id})">Open</button>
    </div>`;
  }).join('');
  return `${row}<div class="fr-members">${members}</div>`;
}

// ── Selection and the bar (1.65: "select multiple and set the same follow up status for them") ──

/** The requests ticked, by key. */
const fuSelected = new Set<string>();
let fuLastTicked: number | null = null;
const fuShownLeads = (): number[] => [...document.querySelectorAll<HTMLElement>('#fu-list .fr-row[data-row-id]')].map((el) => Number(el.dataset.rowId));

/** The ticked requests, as their proposals: one group per request. */
function selectedGroups(): number[][] {
  return followRequests().rows.filter((r) => fuSelected.has(r.key)).map((r) => r.ids);
}

function clearFuSelection(): void {
  fuSelected.clear();
  fuLastTicked = null;
}

/** The bar's actions on the ticked requests: what was done with all of them today, in one click each. */
function fuBulkActions(): BulkAction[] {
  const groups = () => selectedGroups();
  const ids = () => groups().flat();
  const log = (kind: TouchKind, direction: 'out' | 'in' = 'out') => () => { const g = groups(); clearFuSelection(); void logEntry({ ids: [], groups: g, kind, direction }); };
  const snooze = (days: number) => ({ label: `${days} days`, run: () => { const until = backInDays(today(), days); bulkApply(ids(), `Snoozed until ${fmtDateShort(backInDays(until, 1), true)}`, (p) => { p.snoozedUntil = until; }, { clear: clearFuSelection }); } });
  return [
    { label: 'Followed up', choices: () => [{ label: 'Email', run: log('email_out') }, { label: 'Call', run: log('call') }, { label: 'WhatsApp', run: log('whatsapp') }, { label: 'Met', run: log('meeting') }] },
    { label: 'Client replied', choices: () => [{ label: 'Email', run: log('email_in', 'in') }, { label: 'Call', run: log('call', 'in') }, { label: 'WhatsApp', run: log('whatsapp', 'in') }] },
    // The optional details for all of them at once: another day, who did it, what was said.
    { label: 'Add details…', run: () => { const g = groups(); clearFuSelection(); paintFuSelection(); openEntryDialog(g.flat(), undefined, g); } },
    // A request for changes is about one proposal: with several ticked, which one.
    { label: 'Client asked for changes', choices: () => proposalsOf(ids()).map((p) => ({ label: `${p.client} — ${p.type || 'Proposal'} · SL# ${p.id}`, run: () => { clearFuSelection(); paintFuSelection(); openRevisionDialog(p.id); } })) },
    { label: 'Snooze', choices: () => [snooze(3), snooze(7), snooze(14), { label: 'Until…', run: () => { const all = ids(); clearFuSelection(); paintFuSelection(); void snoozeRequest(all); } }] },
    { label: 'Mark lost', danger: true, run: () => { const all = ids(); if (!all.length) return; clearFuSelection(); paintFuSelection(); openWlModal(all[0], 'lost', { ids: all }); } },
  ];
}

function paintFuSelection(): void {
  // A request that left the page (lost, snoozed, signed) leaves the selection too.
  const keys = new Set(followRequests().rows.map((r) => r.key));
  for (const k of [...fuSelected]) if (!keys.has(k)) fuSelected.delete(k);
  document.getElementById('fu-list')?.classList.toggle('has-selection', fuSelected.size > 0);
  document.querySelectorAll<HTMLElement>('#fu-list .fr-row[data-row-id]').forEach((el) => {
    const on = fuSelected.has(requestOf(Number(el.dataset.rowId))?.key ?? '');
    el.classList.toggle('is-selected', on);
    const box = el.querySelector<HTMLInputElement>('.pk-chk input'); if (box) box.checked = on;
  });
  if (S.currentTab !== 'followup') { hideBulkBar('fu-bulk'); return; }
  renderBulkBar('fu-bulk', fuSelected.size, ['request', 'requests'], fuBulkActions(), 'fuClearSelection()', () => S.currentTab === 'followup' && S.currentProposalId == null);
}

/** A click on a row's checkbox: with Shift, every row from the last one ticked to this one takes this one's state. */
export function fuCheckClick(e: MouseEvent, lead: number): void {
  e.stopPropagation();
  const on = (e.currentTarget as HTMLInputElement).checked;
  const leads = e.shiftKey && fuLastTicked != null && fuLastTicked !== lead ? rangeIds(fuShownLeads(), fuLastTicked, lead) : [lead];
  for (const x of leads) { const key = requestOf(x)?.key; if (!key) continue; if (on) fuSelected.add(key); else fuSelected.delete(key); }
  fuLastTicked = lead;
  paintFuSelection();
}
expose('fuCheckClick', fuCheckClick);

export function fuClearSelection(): void {
  clearFuSelection();
  paintFuSelection();
}
expose('fuClearSelection', fuClearSelection);

/** A click on a row, or Enter: a request of several proposals opens to show them; a single one opens its proposal. */
export function fuOpenRow(lead: number): void {
  const r = requestOf(lead);
  if (r && r.ids.length > 1) fuToggle(lead);
  else (window as any).openRecord('proposal', lead);
}
expose('fuOpenRow', fuOpenRow);

export function fuToggle(lead: number): void {
  const r = requestOf(lead);
  if (!r) return;
  if (fuOpen.has(r.key)) fuOpen.delete(r.key); else fuOpen.add(r.key);
  renderFollowup();
}
expose('fuToggle', fuToggle);

const proposalsOf = (ids: number[]) => S.proposals.filter((p) => ids.includes(p.id));
const names = (ps: Proposal[]) => ps.map((p) => p.type || 'Proposal').join(', ');

/** "Keep" on a request to decide: why, and it stays out of Decide for 30 days. One undo. */
async function keepRequest(ids: number[]): Promise<void> {
  const ps = proposalsOf(ids);
  if (!ps.length) return;
  const reason = (await showTextPrompt({ title: `Keep ${ps[0].client}`, label: `Why keep ${ps.length > 1 ? 'these' : 'it'}? It comes back to Decide in ${KEEP_DAYS} days.`, placeholder: 'Budget in January, new decision maker…' }))?.trim();
  if (!reason) return;
  const until = backInDays(today(), KEEP_DAYS);
  bulkApply(ids, `Kept until ${fmtDateShort(until, true)}`, (p) => { p.keepReason = reason; p.keepUntil = until; });
}

/** "Snooze" on a request: to a date; it leaves the page until then. One undo. */
async function snoozeRequest(ids: number[]): Promise<void> {
  const ps = proposalsOf(ids);
  if (!ps.length) return;
  const until = await showDatePrompt({ title: `Snooze ${ps[0].client}`, label: `${ps.length > 1 ? 'They come' : 'It comes'} back on this day`, defaultValue: backInDays(today(), 14), confirmLabel: 'Snooze' });
  if (!until || until <= today()) return;
  // "Snoozed until" hides a proposal through the end of that day; it is back the morning after.
  const through = backInDays(until, -1);
  bulkApply(ids, `Snoozed until ${fmtDateShort(until, true)}`, (p) => { p.snoozedUntil = through; });
}

/** A request's action, by kind. */
export function fuAct(e: MouseEvent, lead: number, kind: RequestActionKind): void {
  const r = requestOf(lead);
  if (!r) return;
  const ps = proposalsOf(r.ids);
  switch (kind) {
    case 'followed_up': followUpMenu(e, r.ids); return;
    case 'changes':
      // The client asks for changes to one proposal: with several, which one.
      if (ps.length === 1) { openRevisionDialog(lead); return; }
      showMenuAt(e.currentTarget as HTMLElement, [{ label: 'Client asked for changes to', heading: true, run: () => {} }, ...ps.map((p) => ({ label: `${p.type || 'Proposal'} · SL# ${p.id}`, run: () => openRevisionDialog(p.id) }))]);
      return;
    case 'decide_lost': openWlModal(lead, 'lost', { ids: r.ids, reason: r.lastWord ? undefined : 'Client unresponsive' }); return;
    case 'decide_keep': void keepRequest(r.ids); return;
    case 'decide_snooze': void snoozeRequest(r.ids); return;
  }
}
expose('fuAct', fuAct);

/** A request's "…" menu (and right-click). A single proposal keeps the menu it has everywhere. */
export function fuMenu(e: MouseEvent, lead: number): void {
  const r = requestOf(lead);
  if (!r) return;
  if (r.ids.length === 1) { pqMenu(e, lead); return; }
  const ps = proposalsOf(r.ids);
  const items = [
    menuHead(`${r.client} — ${names(ps)}`, `${r.ids.length} proposals sent together · ${fmtDateShort(r.sent, true)}`, { name: r.client || '?' }),
    ...ps.map((p) => ({ label: `Open ${p.type || 'Proposal'} · SL# ${p.id}`, iconName: 'edit', run: () => (window as any).openRecord('proposal', p.id) })),
    { label: '', run: () => {}, separator: true },
    { label: 'Keep, with a reason…', iconName: 'pin', run: () => { void keepRequest(r.ids); } },
    { label: 'Snooze until…', iconName: 'calendar', run: () => { void snoozeRequest(r.ids); } },
    { label: '', run: () => {}, separator: true },
    { label: 'Mark lost…', iconName: 'close', danger: true, run: () => openWlModal(lead, 'lost', { ids: r.ids }) },
  ];
  if (e.type === 'contextmenu') showContextMenu(e, items); else showMenuAt(e.currentTarget as HTMLElement, items);
}
expose('fuMenu', fuMenu);

/** The page's "…" menu: the status list to paste to the reviewer (plain text, one line per request on the page,
 * oldest first — no amounts). */
export function fuPageMenu(e: MouseEvent): void {
  e.stopPropagation();
  const { rows } = followRequests();
  const who = firstName(defaultReviewer()?.name);
  showMenuAt(e.currentTarget as HTMLElement, [
    { label: `Copy status list${who ? ` for ${who}` : ''}`, iconName: 'copy', run: () => {
      if (!rows.length) { toast('Nothing with clients to list'); return; }
      (window as any).copyText(statusList(rows, today()), `Status list copied: ${plural(rows.length, 'request')}`);
    } },
  ]);
}
expose('fuPageMenu', fuPageMenu);

/** An archived sent proposal, with Unarchive. */
export function fuCard(p: Proposal): string {
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
  onOpen: (id) => fuOpenRow(id),
});
