// Every mention of a record is a live link: `recordLink()` renders it, the
// router's `openRecordLink` opens it, and hovering shows a small preview card.

import { activeMrr, fmtMoneyByCurrency, ownerName, agreementMonthly } from './commercial';
import { S } from './state';
import { escHtml, fmtDate, inCompany } from './utils';
import type { RecordKind } from './navHistory';

export interface LinkOptions {
  /** Pill-shaped chip instead of inline underlined text. */
  chip?: boolean;
  className?: string;
}

/** A link to one record. `key` is its id; a company may also be keyed by
 * name when it has no Company record yet. Without a key, plain text. */
export function recordLink(kind: RecordKind, key: number | string | null | undefined, label: string | null | undefined, opts: LinkOptions = {}): string {
  const text = escHtml(label ?? '');
  if (key == null || key === '' || !label) return text;
  const keyAttr = typeof key === 'number' ? `data-rid="${key}"` : `data-rname="${escHtml(key)}"`;
  const cls = ['rlink', opts.chip ? 'rlink-chip' : '', opts.className ?? ''].filter(Boolean).join(' ');
  return `<a class="${cls}" href="#" data-rkind="${kind}" ${keyAttr} onclick="return openRecordLink(event,this)">${text}</a>`;
}

/** Link to a company from a record's company fields (id preferred, name as fallback). */
export function companyLink(companyId: number | null | undefined, name: string | null | undefined, opts: LinkOptions = {}): string {
  if (!name) return '';
  const id = companyId ?? S.companies.find((c) => c.name === name)?.id ?? null;
  return recordLink('company', id ?? name, name, opts);
}

// ── Hover preview ───────────────────────────────────────────────────────────

const KIND_LABEL: Record<RecordKind, string> = {
  company: 'Company', contact: 'Contact', proposal: 'Proposal', agreement: 'Agreement', opportunity: 'Opportunity',
  project: 'Project', meeting: 'Meeting', note: 'Note', task: 'Task',
};

function rows(pairs: [string, string | number | null | undefined][]): string {
  const shown = pairs.filter(([, v]) => v != null && v !== '');
  return shown.length ? `<dl class="rlink-preview-rows">${shown.map(([k, v]) => `<dt>${escHtml(k)}</dt><dd>${escHtml(String(v))}</dd>`).join('')}</dl>` : '';
}

const money = (v: number | null | undefined, cur?: string | null) => (v ? `${cur || 'SAR'} ${Math.round(v).toLocaleString()}` : null);

/** Title and a few key facts for a record, or null if it no longer exists. */
export function previewContent(kind: RecordKind, key: number | string): { title: string; body: string } | null {
  const id = typeof key === 'number' ? key : Number(key);
  switch (kind) {
    case 'company': {
      const co = typeof key === 'number' ? S.companies.find((c) => c.id === key) : S.companies.find((c) => c.name === key);
      const name = co?.name ?? (typeof key === 'string' ? key : null);
      if (!name) return null;
      const ref = { id: co?.id ?? null, name };
      const proposals = S.proposals.filter((p) => inCompany(ref, p.companyId, p.client));
      const mrr = activeMrr(S.agreements.filter((a) => inCompany(ref, a.companyId, a.client)));
      const openOpps = S.opportunities.filter((o) => inCompany(ref, o.companyId, o.companyName) && o.status === 'Open' && !o.archived).length;
      return {
        title: name,
        body: rows([
          ['Industry', co?.industries.join(', ')],
          ['Owner', co?.owner],
          ['Contacts', S.contacts.filter((c) => inCompany(ref, c.companyId, c.clientName)).length],
          ['Proposals', proposals.length || null],
          ['Open opportunities', openOpps || null],
          ['Active MRR', Object.keys(mrr).length ? fmtMoneyByCurrency(mrr) : null],
        ]),
      };
    }
    case 'contact': {
      const c = S.contacts.find((x) => x.id === id);
      return c ? { title: c.name || 'Unnamed contact', body: rows([['Role', c.role], ['Company', c.clientName], ['Email', c.email], ['Phone', c.phone]]) } : null;
    }
    case 'proposal': {
      const p = S.proposals.find((x) => x.id === id);
      return p ? { title: `${p.client} — ${p.type || 'Proposal'}`, body: rows([['SL#', p.id], ['Status', p.status], ['Sent', p.sentDate ? fmtDate(p.sentDate) : null], ['Monthly fee', money(p.monthlyFee, p.currency)], ['Owner', ownerName(p) || null]]) } : null;
    }
    case 'agreement': {
      const a = S.agreements.find((x) => x.id === id);
      return a ? { title: a.agrRef || `${a.client} agreement`, body: rows([['Client', a.client], ['Type', a.type], ['Status', a.status], ['Service', a.serviceStatus], ['Monthly fee', money(agreementMonthly(a), a.currency)], ['Ends', a.endDate ? fmtDate(a.endDate) : null]]) } : null;
    }
    case 'opportunity': {
      const o = S.opportunities.find((x) => x.id === id);
      return o ? { title: o.name, body: rows([['Company', o.companyName], ['Stage', o.stage], ['Value', money(o.estimatedValue, o.currency)], ['Expected close', o.expectedCloseDate ? fmtDate(o.expectedCloseDate) : null], ['Next action', o.nextAction]]) } : null;
    }
    case 'project': {
      const p = S.projects.find((x) => x.id === id);
      return p ? { title: p.name, body: rows([['Company', p.companyName], ['Status', p.status], ['Progress', `${p.progressOverride ?? p.computedProgress ?? 0}%`], ['Target', p.targetDate ? fmtDate(p.targetDate) : null], ['Owner', p.owner]]) } : null;
    }
    case 'meeting': {
      const m = S.meetings.find((x) => x.id === id);
      return m ? { title: m.title, body: rows([['Date', m.meetingDate ? fmtDate(m.meetingDate) : null], ['Company', m.companyName], ['Attendees', (m.attendees || []).length || null]]) } : null;
    }
    case 'note': {
      const n = S.notes.find((x) => x.id === id);
      if (!n) return null;
      const snippet = (n.content || '').replace(/[#*_>`\[\]-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
      return { title: n.title || 'Untitled note', body: rows([['Company', n.clientName], ['Folder', n.folder]]) + (snippet ? `<div class="hover-preview-snippet">${escHtml(snippet)}${snippet.length === 140 ? '…' : ''}</div>` : '') };
    }
    case 'task': {
      const t = S.todos.find((x) => x.id === id);
      return t ? { title: t.title, body: rows([['Status', t.status], ['Due', t.dueDate ? fmtDate(t.dueDate) : null], ['Priority', t.priority], ['Company', t.client]]) } : null;
    }
  }
}

let hoverTimer: number | undefined;
let hideTimer: number | undefined;
let activeLink: HTMLElement | null = null;

function previewEl(): HTMLElement {
  let el = document.getElementById('rlink-preview');
  if (!el) {
    el = document.createElement('div');
    el.id = 'rlink-preview';
    el.className = 'rlink-preview';
    el.setAttribute('role', 'tooltip');
    el.addEventListener('mouseenter', () => window.clearTimeout(hideTimer));
    el.addEventListener('mouseleave', scheduleHide);
    document.body.appendChild(el);
  }
  return el;
}

function scheduleHide(): void {
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => { previewEl().classList.remove('open'); activeLink = null; }, 120);
}

function showPreview(link: HTMLElement): void {
  const kind = link.dataset.rkind as RecordKind;
  const key = link.dataset.rid != null ? Number(link.dataset.rid) : link.dataset.rname;
  if (!kind || key == null || !link.isConnected) return;
  const content = previewContent(kind, key);
  if (!content) return;
  const el = previewEl();
  el.innerHTML = `<div class="rlink-preview-kind">${KIND_LABEL[kind]}</div><div class="rlink-preview-title">${escHtml(content.title)}</div>${content.body}<div class="rlink-preview-hint">Click to open</div>`;
  const r = link.getBoundingClientRect();
  const width = 280;
  const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
  el.style.left = `${left}px`;
  el.style.top = '0px';
  el.classList.add('open');
  const h = el.offsetHeight;
  const below = r.bottom + 6;
  el.style.top = `${below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below}px`;
}

document.addEventListener('mouseover', (e) => {
  const link = (e.target as HTMLElement).closest?.('.rlink') as HTMLElement | null;
  if (!link || link === activeLink) { if (link) window.clearTimeout(hideTimer); return; }
  activeLink = link;
  window.clearTimeout(hoverTimer);
  window.clearTimeout(hideTimer);
  hoverTimer = window.setTimeout(() => showPreview(link), 450);
});

document.addEventListener('mouseout', (e) => {
  const link = (e.target as HTMLElement).closest?.('.rlink');
  if (!link || link.contains(e.relatedTarget as Node)) return;
  window.clearTimeout(hoverTimer);
  scheduleHide();
});

// A click, scroll or key press means the preview is no longer wanted.
for (const ev of ['mousedown', 'keydown', 'scroll'] as const) {
  window.addEventListener(ev, () => { window.clearTimeout(hoverTimer); previewEl().classList.remove('open'); activeLink = null; }, { passive: true, capture: true });
}
