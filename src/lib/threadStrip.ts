// The thread strip: one slim row under a record's header showing where this
// piece of work stands — opportunity · gap · proposal · gap · agreement · gap
// · project — with the current record highlighted, the others as links, and
// the one next action for the first missing step. Opportunity, proposal,
// agreement and project pages share it; Company 360 will too.

import { escHtml } from './utils';
import { recordLink } from './links';
import type { EngagementThread, ThreadGap, ThreadKind, ThreadNode } from './workGraph';

const KIND_LABEL: Record<ThreadKind, string> = { opportunity: 'Opportunity', proposal: 'Proposal', agreement: 'Agreement', project: 'Project' };

function nodeHtml(n: ThreadNode, current: { kind: ThreadKind; id: number }): string {
  const isCurrent = n.kind === current.kind && n.id === current.id;
  const title = `${KIND_LABEL[n.kind]}: ${n.label}${n.status ? ` — ${n.status}` : ''}${n.date ? ` · ${n.dateLabel} ${n.date}` : ''}`;
  const name = isCurrent ? `<span class="ts-name" aria-current="page">${escHtml(n.label)}</span>` : recordLink(n.kind, n.id, n.label, { className: 'ts-name' });
  const more = n.others?.length ? `<button class="ts-more" onclick="threadOthersMenu(event, '${escHtml(JSON.stringify(n.others).replace(/'/g, '&#39;'))}')" title="${n.others.length} more agreement${n.others.length === 1 ? '' : 's'}">+${n.others.length}</button>` : '';
  return `<span class="ts-node tone-${n.tone}${isCurrent ? ' is-current' : ''}" title="${escHtml(title)}">
    <span class="ts-kind">${KIND_LABEL[n.kind]}</span><span class="ts-dot" aria-hidden="true"></span>${name}${more}</span>`;
}

function gapHtml(g: ThreadGap | null): string {
  if (!g || g.days == null) return '<span class="ts-gap" aria-hidden="true"><span class="ts-line"></span></span>';
  const who = g.waitingOn === 'them' ? ' · with client' : g.waitingOn === 'us' ? ' · with us' : '';
  return `<span class="ts-gap${g.late ? ' is-late' : ''}" title="${g.days} days${who ? who.replace(' · ', ', ') : ''}"><span class="ts-line"></span><span class="ts-days">${g.days}d<span class="ts-who">${escHtml(who)}</span></span><span class="ts-line"></span></span>`;
}

/** The strip's HTML, or '' when there is nothing worth showing. */
export function threadStripHtml(t: EngagementThread, current: { kind: ThreadKind; id: number }): string {
  if (!t.show) return '';
  const parts: string[] = [];
  t.nodes.forEach((n, i) => {
    if (i > 0) parts.push(gapHtml(t.gaps[i - 1]));
    parts.push(nodeHtml(n, current));
  });
  const nextBtn = (n: NonNullable<EngagementThread['next']>) => `<button class="btn-ghost btn-sm ts-next" onclick="threadNext('${n.action}', '${n.kind}', ${n.id})">${escHtml(n.label)}</button>`;
  // A next step on an existing record (e.g. the proposal's own) comes straight
  // after it; one that creates the next record sits in that record's place.
  const ownStep = t.next?.action === 'open' ? t.next : null;
  if (ownStep) parts.push(`${gapHtml(t.after)}<span class="ts-node is-missing">${nextBtn(ownStep)}</span>`);
  t.missing.forEach((kind, i) => {
    const first = i === 0 && !ownStep;
    parts.push(gapHtml(first ? t.after : null));
    parts.push(first && t.next
      ? `<span class="ts-node is-missing"><span class="ts-kind">${KIND_LABEL[kind]}</span>${nextBtn(t.next)}</span>`
      : `<span class="ts-node is-missing"><span class="ts-kind">${KIND_LABEL[kind]}</span><span class="ts-dot" aria-hidden="true"></span><span class="ts-name">Not yet</span></span>`);
  });
  if (!t.missing.length && !ownStep && t.after) parts.push(gapHtml(t.after));
  return `<nav class="thread-strip" aria-label="Where this work stands">${parts.join('')}</nav>`;
}
