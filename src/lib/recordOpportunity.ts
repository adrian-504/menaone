// The opportunity page in the record anatomy (1.61 "records"): the header's
// four figures, the prompt shown when there is no next step with its
// suggestions (a fixed list per stage — rules, nothing generated), the files
// as cover cards, and what else is true at the company. Pure:
// tabs/opportunities.ts draws it.

import type { Agreement, Opportunity, Proposal } from './types';
import { PS, agreementMonthly, currencyOf, fmtMoney, fmtMoneyByCurrency, isAgreementActive, isOpenProposal, type MoneyByCurrency } from './commercial';
import { LONG_IN_STAGE_DAYS, daysBetween, type OpportunityHealth } from './pipeline';
import { fmtDateShort } from './dates';
import { plural } from './pageKit';
import type { Figure } from './recordFigures';

const day = (s: string | null | undefined) => (s || '').slice(0, 10);

// ── Header ──────────────────────────────────────────────────────────────────

type FigHealth = Pick<OpportunityHealth, 'daysInStage' | 'stalled'>;

/** Value · probability (with its bar) · days in the stage · the close date. An open opportunity says what is not set;
 * a decided one says when it was won or lost instead. Pure. */
export function opportunityHeaderFigures(o: Opportunity, h: FigHealth, today: string, stageEnteredAt?: string | null): Figure[] {
  const open = o.status === 'Open';
  const out: Figure[] = [];
  if (o.estimatedValue != null) out.push({ value: fmtMoney(o.estimatedValue, o.currency || 'SAR'), label: 'value', tone: o.stage === 'Lost' ? undefined : 'green' });
  else if (open) out.push({ value: '—', label: 'value not set' });
  if (!open) {
    const on = day(stageEnteredAt || o.updatedAt || o.createdAt);
    if (on) out.push({ value: fmtDateShort(on, true), label: o.stage === 'Won' ? 'won' : o.stage === 'Lost' ? 'lost' : 'on hold since' });
    return out;
  }
  if (o.probability != null) out.push({ value: `${o.probability}%`, label: 'probability', bar: { pct: o.probability } });
  else out.push({ value: '—', label: 'probability not set' });
  if (h.daysInStage != null && h.daysInStage >= 0) {
    out.push({ value: plural(h.daysInStage, 'day'), label: `in ${o.stage.toLowerCase()}`, tone: h.stalled ? 'red' : h.daysInStage > LONG_IN_STAGE_DAYS ? 'amber' : undefined });
  }
  if (o.expectedCloseDate) {
    const left = daysBetween(today, o.expectedCloseDate) ?? 0;
    out.push({ value: fmtDateShort(o.expectedCloseDate, true), label: left < 0 ? `close date · ${plural(-left, 'day')} ago` : left === 0 ? 'close date · today' : `close date · in ${plural(left, 'day')}`, tone: left < 0 ? 'red' : undefined });
  } else {
    out.push({ value: '—', label: 'close date not set' });
  }
  return out;
}

// ── No next step ────────────────────────────────────────────────────────────

export interface NextPrompt { headline: string; body: string }

/** The amber prompt: only for an open opportunity with no next step (no text, no open task, no promise of ours). Pure. */
export function nextStepPrompt(o: Pick<Opportunity, 'status' | 'archived'>, h: Pick<OpportunityHealth, 'noNextAction' | 'stalled' | 'daysSinceActivity'>): NextPrompt | null {
  if (o.archived || o.status !== 'Open' || !h.noNextAction) return null;
  const quiet = h.daysSinceActivity;
  return {
    headline: h.stalled && quiet != null ? `No next step, and nothing has happened for ${plural(quiet, 'day')}` : 'No next step yet',
    body: 'Decide what moves this forward, or close it. It stays on My Day until it has a next step.',
  };
}

export type SuggestionKind = 'text' | 'proposal' | 'won' | 'lost';
export interface Suggestion { label: string; kind: SuggestionKind }

const text = (label: string): Suggestion => ({ label, kind: 'text' });
const LOST: Suggestion = { label: 'Mark lost', kind: 'lost' };
const PROPOSAL: Suggestion = { label: 'Create the proposal', kind: 'proposal' };

/** What usually comes next at each stage: a fixed list, the service and the contact's first name filled in where
 * they are known. A text suggestion becomes the next step; the others open the proposal builder or the won / lost
 * dialog. Pure. */
export function nextStepSuggestions(o: Pick<Opportunity, 'stage' | 'proposalId'>, ctx: { service?: string | null; contact?: string | null } = {}): Suggestion[] {
  const who = ctx.contact?.trim().split(/\s+/)[0] || 'the client';
  const checklist = text(ctx.service ? `Send the ${ctx.service} checklist` : 'Send the checklist');
  const proposal = o.proposalId != null ? text('Follow up on the proposal') : PROPOSAL;
  switch (o.stage) {
    case 'Lead': return [text(`Call ${who} to qualify`), text('Book an intro meeting'), LOST];
    case 'Qualified': return [text('Book a discovery meeting'), text('Send the company profile'), LOST];
    case 'Discovery': return [text('Book a scoping meeting'), checklist, proposal, LOST];
    case 'Meeting': return [text('Send the meeting summary'), text('Book the follow-up meeting'), proposal, LOST];
    case 'Solution Design': return [text(`Agree the scope with ${who}`), proposal, LOST];
    case 'Proposal': return [proposal, text('Book a walkthrough of the proposal'), LOST];
    case 'Negotiation': return [text('Send the revised terms'), text(`Call ${who} to close`), LOST];
    case 'Verbal Commitment': return [text('Send the agreement for signature'), { label: 'Mark won', kind: 'won' }, LOST];
    default: return [];
  }
}

/** The catalogue service an opportunity's name mentions (the longest that matches), or null. Pure. */
export function serviceInName(name: string, services: { name: string }[]): string | null {
  const n = name.toLowerCase();
  const hit = services.filter((s) => s.name.trim() && n.includes(s.name.trim().toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
  return hit ? hit.name.trim() : null;
}

// ── Files as cards ──────────────────────────────────────────────────────────

export type FileCover = 'deck' | 'sheet' | 'doc';
export interface FileCard { name: string; path: string; cover: FileCover; label: string; date: string }

export function coverOf(name: string): FileCover {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase();
  return ['pptx', 'ppt', 'key'].includes(ext) ? 'deck' : ['xlsx', 'xls', 'csv', 'numbers'].includes(ext) ? 'sheet' : 'doc';
}

/** What the cover says: a deck named "<Client>_<Service> Proposal_<date>[_V2]" reads "Service · V2"; anything else
 * its name without the extension. Pure. */
export function coverLabel(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '');
  if (coverOf(name) !== 'deck') return base;
  const parts = base.split('_');
  const service = (parts[1] || '').replace(/\s*Proposal$/i, '').trim();
  if (parts.length < 2 || !service) return base;
  return `${service} · V${/_V(\d+)$/i.exec(base)?.[1] ?? '1'}`;
}

/** The linked proposal's documents first, then the rest of the client folder, newest first; eight at most. Pure. */
export function fileCards(docs: { fileName: string; path: string | null; kind?: string | null; version?: number | null; createdAt?: string | null }[], folder: { name: string; path: string; modifiedAt?: string | null }[]): FileCard[] {
  const seen = new Set<string>();
  const out: FileCard[] = [];
  for (const d of docs) {
    if (!d.path || seen.has(d.path)) continue;
    seen.add(d.path);
    const cover = coverOf(d.fileName);
    const label = cover === 'deck' && d.version ? coverLabel(d.fileName).replace(/ · V\d+$/, '') + ` · V${d.version}` : d.kind === 'commercials' ? 'Commercials' : coverLabel(d.fileName);
    out.push({ name: d.fileName, path: d.path, cover, label, date: day(d.createdAt) });
  }
  const rest = folder.filter((f) => !seen.has(f.path)).sort((a, b) => (b.modifiedAt || '').localeCompare(a.modifiedAt || ''));
  for (const f of rest) out.push({ name: f.name, path: f.path, cover: coverOf(f.name), label: coverLabel(f.name), date: day(f.modifiedAt) });
  return out.slice(0, 8);
}

// ── At the company ──────────────────────────────────────────────────────────

export interface AtOpen { kind: 'proposal' | 'opportunity'; id: number; text: string }
export interface AtCompany { relationship: string; agreement: { id: number; text: string } | null; open: AtOpen[] }

export interface AtCompanyInput {
  today: string;
  /** "Active client", "Prospect", … as the company page says it. */
  relationship: string;
  /** The company's agreements, proposals and opportunities. */
  agreements: Agreement[];
  proposals: Proposal[];
  opportunities: Opportunity[];
  reviewer: (p: Proposal) => string;
}

/** What else is true at the company: the relationship with its monthly, the agreement that ends first, and the other
 * open proposals and opportunities (this one, and the proposal it became, left out). Pure. */
export function atCompany(o: Pick<Opportunity, 'id' | 'proposalId'>, i: AtCompanyInput): AtCompany {
  const active = i.agreements.filter((a) => isAgreementActive(a, i.today));
  const mrr: MoneyByCurrency = {};
  for (const a of active) { const m = agreementMonthly(a); if (m) mrr[currencyOf(a)] = (mrr[currencyOf(a)] || 0) + m; }
  const relationship = `${i.relationship}${Object.keys(mrr).length ? ` · ${fmtMoneyByCurrency(mrr)} /mo` : ''}`;
  const ending = active.filter((a) => a.endDate).sort((a, b) => (a.endDate || '').localeCompare(b.endDate || ''))[0];
  const props = i.proposals.filter((p) => !p.archived && isOpenProposal(p));
  const open: AtOpen[] = props.filter((p) => p.id !== o.proposalId).map((p) => {
    const where = p.status === PS.REQUEST ? 'requested' : p.status === PS.DRAFTING ? 'in drafting' : p.status === PS.REVIEW ? `in review with ${i.reviewer(p).split(' ')[0]}` : 'with the client';
    return { kind: 'proposal' as const, id: p.id, text: `${p.type || 'Proposal'}, SL# ${p.id} ${where}` };
  });
  const taken = new Set(props.map((p) => p.id));
  for (const x of i.opportunities) {
    if (x.id === o.id || x.archived || x.status !== 'Open' || (x.proposalId != null && taken.has(x.proposalId))) continue;
    open.push({ kind: 'opportunity', id: x.id, text: `${x.name} · ${x.stage.toLowerCase()}` });
  }
  return { relationship, agreement: ending ? { id: ending.id, text: `ends ${fmtDateShort(ending.endDate, true)}` } : null, open: open.slice(0, 4) };
}
