// The figures row in a record's header (brand slice): two or three display
// numbers with a small label, laid out like My Day's index row, so a record
// page opens on what matters about it rather than on a list. No new data:
// every figure is a field or a rule the app already has. Pure.

import type { Agreement, Contact, Meeting, Milestone, Project, Proposal } from './types';
import { addMoney, agreementMonthly, currencyOf, fmtMoney, fmtMoneyByCurrency, isAgreementActive, isOpenProposal, lineTotals, type MoneyByCurrency } from './commercial';
import { proposalWaitingOn } from './commitments';
import { daysBetween } from './pipeline';
import { fmtDateShort } from './dates';
import { escHtml } from './utils';

export interface Figure { value: string; label: string; tone?: 'coral' | 'red' | 'green' | 'amber' }

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const MAX = 3;

export function companyFigures(r: { clientAgreements: Agreement[]; proposals: Proposal[]; meetings: Pick<Meeting, 'meetingDate' | 'isCancelled'>[] }, today: string): Figure[] {
  const out: Figure[] = [];
  const mrr: MoneyByCurrency = {};
  for (const a of r.clientAgreements) if (isAgreementActive(a, today)) addMoney(mrr, currencyOf(a), agreementMonthly(a));
  if (Object.values(mrr).some((v) => v)) out.push({ value: fmtMoneyByCurrency(mrr), label: 'a month' });
  const ends = r.clientAgreements.map((a) => a.endDate).filter((d): d is string => !!d && d >= today).sort()[0];
  const next = r.meetings.filter((m) => !m.isCancelled && m.meetingDate && m.meetingDate >= today).map((m) => m.meetingDate!).sort()[0];
  if (ends) out.push({ value: fmtDateShort(ends, true), label: 'agreement ends', tone: (daysBetween(today, ends) ?? 99) <= 60 ? 'amber' : undefined });
  else if (next) out.push({ value: next === today ? 'Today' : fmtDateShort(next, true), label: 'next meeting' });
  const open = r.proposals.filter((p) => isOpenProposal(p) && !p.archivedAt).length;
  if (open) out.push({ value: String(open), label: plural(open, 'open proposal', 'open proposals') });
  return out.slice(0, MAX);
}

export function proposalFigures(p: Proposal & { lines?: Parameters<typeof lineTotals>[0] }, today: string): Figure[] {
  const out: Figure[] = [];
  const t = lineTotals(p.lines, p.contractMonths);
  const monthly = t.monthly ?? p.monthlyFee;
  if (monthly) out.push({ value: fmtMoney(monthly, currencyOf(p)), label: 'a month' });
  else if (t.contractValue) out.push({ value: fmtMoney(t.contractValue, currencyOf(p)), label: 'value' });
  out.push({ value: p.status, label: 'status' });
  const on = proposalWaitingOn(p.status, !!p.archivedAt);
  const since = on === 'them' ? (p.lastSentAt || p.dateSentToClient || p.sentDate) : on === 'us' ? p.dateAdded : null;
  const days = since ? daysBetween(since.slice(0, 10), today) : null;
  if (days != null && days >= 0) out.push({ value: String(days), label: on === 'them' ? plural(days, 'day with the client', 'days with the client') : plural(days, 'day with us', 'days with us'), tone: on === 'us' && days > 7 ? 'coral' : undefined });
  return out.slice(0, MAX);
}

export function projectFigures(p: Pick<Project, 'progressOverride' | 'computedProgress'>, milestones: Pick<Milestone, 'status' | 'targetDate'>[], today: string): Figure[] {
  const out: Figure[] = [{ value: `${Math.round(p.progressOverride ?? p.computedProgress ?? 0)}%`, label: 'done' }];
  const next = milestones.filter((m) => m.status !== 'Done' && m.targetDate).map((m) => m.targetDate!).sort()[0];
  if (next) out.push({ value: fmtDateShort(next, true), label: 'next milestone', tone: next < today ? 'red' : undefined });
  return out;
}

export function agreementFigures(a: Agreement, today: string): Figure[] {
  const out: Figure[] = [];
  const t = lineTotals(a.lines, a.contractMonths);
  const value = t.contractValue ?? (a.monthlyFee && a.contractMonths ? a.monthlyFee * a.contractMonths : null);
  if (value) out.push({ value: fmtMoney(value, currencyOf(a)), label: 'contracted' });
  const monthly = agreementMonthly(a);
  if (monthly) out.push({ value: fmtMoney(monthly, currencyOf(a)), label: 'a month' });
  if (a.endDate) out.push({ value: fmtDateShort(a.endDate, true), label: a.endDate < today ? 'ended' : 'ends', tone: a.endDate >= today && (daysBetween(today, a.endDate) ?? 99) <= 60 ? 'amber' : undefined });
  return out.slice(0, MAX);
}

export function contactFigures(c: Pick<Contact, 'role' | 'clientName'>, lastContact: string | null): Figure[] {
  const out: Figure[] = [];
  if (c.role) out.push({ value: c.role, label: 'role' });
  if (c.clientName) out.push({ value: c.clientName, label: 'company' });
  if (lastContact) out.push({ value: fmtDateShort(lastContact, true), label: 'last contact' });
  return out.slice(0, MAX);
}

export function figuresHtml(figs: Figure[]): string {
  return figs.map((f) => `<div class="rec-fig"><span class="rec-fig-n${f.tone ? ` t-${f.tone}` : ''}">${escHtml(f.value)}</span><span class="rec-fig-l">${escHtml(f.label)}</span></div>`).join('');
}

/** Fills a header's figures row (empty → hidden). */
export function paintFigures(id: string, figs: Figure[]): void {
  const el = document.getElementById(id);
  if (!el) return;
  const html = figuresHtml(figs);
  if (el.innerHTML !== html) el.innerHTML = html;
  el.hidden = !figs.length;
}
