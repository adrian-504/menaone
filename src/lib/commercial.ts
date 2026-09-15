// Commercial rules shared by every module: what each proposal status means,
// line totals, money in several currencies, and which agreements make a
// company an active client. Kept free of DOM code so it can be unit-tested.

import { S } from './state';
import type { Proposal, Agreement, CommercialLine, Service, TeamMember, BusinessEntity } from './types';

// ── Proposal statuses ──────────────────────────────────────────────────────

export const PS = {
  REQUEST: 'Proposal Request Received',
  DRAFTING: 'Drafting',
  REVIEW: 'In Internal Review',
  SENT: 'Sent to Client',
  CLIENT_SIGNED: 'Signed by Client',
  WON: 'Signed by Both Parties',
  LOST: 'Lost',
  WITHDRAWN: 'Withdrawn',
} as const;

/** Stages a live proposal moves through, in order (Lost/Withdrawn end it). */
export const PROPOSAL_STAGES = [PS.REQUEST, PS.DRAFTING, PS.REVIEW, PS.SENT, PS.CLIENT_SIGNED, PS.WON] as const;

type HasStatus = Pick<Proposal, 'status'>;
export const isWon = (p: HasStatus): boolean => p.status === PS.WON;
export const isLost = (p: HasStatus): boolean => p.status === PS.LOST;
export const isWithdrawn = (p: HasStatus): boolean => p.status === PS.WITHDRAWN;
/** Won, lost or withdrawn — nothing more will happen on it. */
export const isClosed = (p: HasStatus): boolean => isWon(p) || isLost(p) || isWithdrawn(p);
/** Still being worked on or waiting for the client. */
export const isOpenProposal = (p: HasStatus): boolean => !isClosed(p);
/** Not yet with the client: request, drafting or internal review. */
export const isInPreparation = (p: HasStatus): boolean => p.status === PS.REQUEST || p.status === PS.DRAFTING || p.status === PS.REVIEW;
export const isAwaitingClient = (p: HasStatus): boolean => p.status === PS.SENT || p.status === PS.CLIENT_SIGNED;

export function stageIndex(status: string): number {
  return (PROPOSAL_STAGES as readonly string[]).indexOf(status);
}

// ── Lines and totals ───────────────────────────────────────────────────────

export function lineAmount(l: Pick<CommercialLine, 'unitPrice' | 'quantity'>): number | null {
  return l.unitPrice == null ? null : l.unitPrice * (l.quantity > 0 ? l.quantity : 1);
}

export interface LineTotals {
  monthly: number | null;
  oneTime: number | null;
  /** Monthly × contract months + one-time. Null when nothing is priced. */
  contractValue: number | null;
  serviceNames: string[];
}

export function lineTotals(lines: CommercialLine[] | undefined, contractMonths: number | null | undefined): LineTotals {
  const ls = lines || [];
  const sum = (billing: CommercialLine['billing']): number | null => {
    const priced = ls.filter((l) => l.billing === billing).map(lineAmount).filter((v): v is number => v != null);
    return priced.length ? priced.reduce((a, b) => a + b, 0) : null;
  };
  const monthly = sum('monthly');
  const oneTime = sum('one_time');
  const months = contractMonths && contractMonths > 0 ? contractMonths : null;
  const contractValue = monthly == null && oneTime == null ? null : (monthly ?? 0) * (months ?? 1) + (oneTime ?? 0);
  const serviceNames: string[] = [];
  for (const l of ls) {
    const n = l.serviceName.trim();
    if (n && !serviceNames.includes(n)) serviceNames.push(n);
  }
  return { monthly, oneTime, contractValue, serviceNames };
}

/** Keeps the summary fields older screens and exports read (`type`,
 * `monthlyFee`, `oneTimeFee`) in step with the lines. Same rule as
 * commercial.rs::derive_totals. */
export function syncProposalTotals(p: Proposal): void {
  if (!p.lines || p.lines.length === 0) return;
  const t = lineTotals(p.lines, p.contractMonths);
  p.type = t.serviceNames.length ? t.serviceNames.join(' + ') : p.type;
  p.monthlyFee = t.monthly;
  p.oneTimeFee = t.oneTime;
}

export function syncAgreementTotals(a: Agreement): void {
  if (!a.lines || a.lines.length === 0) return;
  a.monthlyFee = lineTotals(a.lines, a.contractMonths).monthly;
}

// Ids handed out but not saved yet (lines on a new proposal that's still
// being written) must not be handed out twice.
let lastLineId = 0;
let lastDocumentId = 0;

/** Line ids are assigned here, unique across proposals and agreements. */
export function nextLineId(): number {
  let max = lastLineId;
  for (const p of S.proposals) for (const l of p.lines || []) max = Math.max(max, l.id);
  for (const a of S.agreements) for (const l of a.lines || []) max = Math.max(max, l.id);
  lastLineId = max + 1;
  return lastLineId;
}

export function nextDocumentId(): number {
  let max = lastDocumentId;
  for (const p of S.proposals) for (const d of p.documents || []) max = Math.max(max, d.id);
  lastDocumentId = max + 1;
  return lastDocumentId;
}

export function newLine(service: Service | null, sortOrder: number, unitPrice: number | null = null): CommercialLine {
  return {
    id: nextLineId(),
    serviceId: service?.id ?? null,
    serviceName: service?.name ?? '',
    description: null,
    billing: service?.billing ?? 'monthly',
    quantity: 1,
    unitPrice: unitPrice ?? service?.defaultPrice ?? null,
    commission: false,
    sortOrder,
    rates: [],
    employeeCount: null,
    withRecruitment: false,
  };
}

// ── Money ──────────────────────────────────────────────────────────────────

export const REPORTING_CURRENCY = 'SAR';

export function currencyOf(r: { currency?: string | null }): string {
  return (r.currency || REPORTING_CURRENCY).toUpperCase();
}

export function fmtMoney(amount: number | null | undefined, currency: string = REPORTING_CURRENCY): string {
  if (amount == null || isNaN(amount)) return '—';
  const rounded = Math.round(amount * 100) / 100;
  return `${currency} ${rounded.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** Amounts per currency, e.g. { SAR: 12000, EUR: 3000 }. */
export type MoneyByCurrency = Record<string, number>;

export function addMoney(into: MoneyByCurrency, currency: string, amount: number | null | undefined): void {
  if (amount == null || isNaN(amount)) return;
  into[currency] = (into[currency] || 0) + amount;
}

/** "SAR 12,000 · EUR 3,000", or "SAR 0" when empty. */
export function fmtMoneyByCurrency(m: MoneyByCurrency): string {
  const entries = Object.entries(m).filter(([, v]) => v !== 0);
  if (!entries.length) return fmtMoney(0);
  entries.sort(([a], [b]) => (a === REPORTING_CURRENCY ? -1 : b === REPORTING_CURRENCY ? 1 : a.localeCompare(b)));
  return entries.map(([c, v]) => fmtMoney(v, c)).join(' · ');
}

/** Everything converted to SAR with the rates set in Settings. Null when a
 * currency in the mix has no rate yet (so a total is never silently wrong). */
export function toReporting(m: MoneyByCurrency, rates: Record<string, number> = S.fxRates): number | null {
  let total = 0;
  for (const [currency, amount] of Object.entries(m)) {
    if (currency === REPORTING_CURRENCY) { total += amount; continue; }
    const rate = rates[currency];
    if (!rate) return null;
    total += amount * rate;
  }
  return total;
}

export function missingRates(m: MoneyByCurrency, rates: Record<string, number> = S.fxRates): string[] {
  return Object.keys(m).filter((c) => c !== REPORTING_CURRENCY && m[c] !== 0 && !rates[c]);
}

// ── Agreements, active clients, MRR ────────────────────────────────────────

export function agreementMonthly(a: Agreement): number | null {
  if (a.lines && a.lines.length) return lineTotals(a.lines, a.contractMonths).monthly;
  return a.monthlyFee ?? null;
}

/** An agreement whose service is running today. */
export function isAgreementActive(a: Agreement, onDate: string = localToday()): boolean {
  if (a.status === 'Canceled') return false;
  if (a.serviceStatus !== 'Active') return false;
  if (a.endDate && a.endDate < onDate) return false;
  return true;
}

/** MRR from active agreements, per currency. */
export function activeMrr(agreements: Agreement[] = S.agreements): MoneyByCurrency {
  const out: MoneyByCurrency = {};
  for (const a of agreements) if (isAgreementActive(a)) addMoney(out, currencyOf(a), agreementMonthly(a));
  return out;
}

/** Monthly value of open proposals (not won, lost or withdrawn), per currency. */
export function pipelineMonthly(proposals: Proposal[]): MoneyByCurrency {
  const out: MoneyByCurrency = {};
  for (const p of proposals) {
    if (p.archived || isClosed(p)) continue;
    addMoney(out, currencyOf(p), p.lines?.length ? lineTotals(p.lines, p.contractMonths).monthly : p.monthlyFee);
  }
  return out;
}

export function agreementsForCompany(companyId: number | null | undefined, name?: string | null): Agreement[] {
  const n = (name || '').trim().toLowerCase();
  return S.agreements.filter((a) => (companyId != null && a.companyId === companyId) || (!!n && (a.client || '').trim().toLowerCase() === n));
}

/** Agreements ending within `days` (or ended in the last week) whose service is active. */
export function renewalsDue(days = 60): Agreement[] {
  const today = localToday();
  return S.agreements
    .filter((a) => a.status !== 'Canceled' && a.serviceStatus === 'Active' && a.endDate)
    .filter((a) => {
      const d = daysBetween(today, a.endDate!);
      return d <= days && d >= -7;
    })
    .sort((a, b) => (a.endDate || '').localeCompare(b.endDate || ''));
}

// ── Team, entities, catalog ────────────────────────────────────────────────

export const teamMember = (id: number | null | undefined): TeamMember | undefined => (id == null ? undefined : S.team.find((t) => t.id === id));
export const reviewers = (): TeamMember[] => S.team.filter((t) => t.active && t.isReviewer);
export const defaultReviewer = (): TeamMember | undefined => reviewers()[0];
export const activeTeam = (): TeamMember[] => S.team.filter((t) => t.active);

/** The owner's display name: the linked team member, else the free text on older records. */
export function ownerName(r: { ownerId?: number | null; owner?: string | null }): string {
  return teamMember(r.ownerId)?.name || (r.owner || '').trim();
}

export const entityById = (id: number | null | undefined): BusinessEntity | undefined => (id == null ? undefined : S.businessEntities.find((e) => e.id === id));
export const defaultEntity = (): BusinessEntity | undefined => S.businessEntities.find((e) => e.active && e.code === 'KSA') || S.businessEntities.find((e) => e.active);

export const serviceById = (id: number | null | undefined): Service | undefined => (id == null ? undefined : S.services.find((s) => s.id === id));
export const serviceByName = (name: string | null | undefined): Service | undefined => {
  const n = (name || '').trim().toLowerCase();
  return n ? S.services.find((s) => s.name.toLowerCase() === n) : undefined;
};
export const activeServices = (): Service[] => S.services.filter((s) => s.active);

/** Suggested monthly (or one-time) price range for a service from its rate card. */
export function priceRange(service: Service | undefined, commission = false): { min: number; max: number } | null {
  const card = service?.rateCardId != null ? S.rateCards.find((r) => r.id === service.rateCardId) : undefined;
  const p = card?.pricing;
  if (!p) return service?.defaultPrice != null ? { min: service.defaultPrice, max: service.defaultPrice } : null;
  if (p.hasTranches && p.tranches?.length) {
    const mins = p.tranches.map((t) => (commission ? t.commMin : t.noCommMin)).filter((v): v is number => v != null);
    const maxs = p.tranches.map((t) => (commission ? t.commMax : t.noCommMax)).filter((v): v is number => v != null);
    return mins.length ? { min: Math.min(...mins), max: Math.max(...maxs) } : null;
  }
  if (p.hasPackages && p.packages?.length) {
    return { min: Math.min(...p.packages.map((x) => x.min)), max: Math.max(...p.packages.map((x) => x.max)) };
  }
  const min = commission ? p.commMin : p.noCommMin;
  const max = commission ? p.commMax : p.noCommMax;
  return min != null && max != null ? { min, max } : null;
}

// ── Proposal files ─────────────────────────────────────────────────────────

/** `DD.MM.YYYY`, the date format used in proposal file names. */
export function fileDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Highest `_V<n>` among existing deck files (a file without a suffix counts as V1). */
export function latestVersion(fileNames: string[]): number {
  let max = 0;
  for (const name of fileNames) {
    if (!/\.(pptx|pdf|key)$/i.test(name) || !/proposal/i.test(name)) continue;
    const m = name.match(/_V(\d+)\.[a-z]+$/i);
    max = Math.max(max, m ? Number(m[1]) : 1);
  }
  return max;
}

/** `<Client>_<Service> Proposal_<DD.MM.YYYY>[_V<n>].pptx`, matching the
 * naming already used in the client folders. */
export function suggestedFileName(client: string, serviceLabel: string, isoDate: string, existing: string[]): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  const stem = `${clean(client)}_${clean(serviceLabel) || 'Services'} Proposal`;
  // Versions count per proposal deck: only files for the same client and services.
  const next = latestVersion(existing.filter((n) => n.toLowerCase().startsWith(stem.toLowerCase()))) + 1;
  const base = `${stem}_${fileDate(isoDate)}`;
  return next <= 1 ? `${base}.pptx` : `${base}_V${next}.pptx`;
}

/** The proposal's generated decks, newest version first. */
export function proposalDecks(p: Pick<Proposal, 'documents'>): NonNullable<Proposal['documents']> {
  return (p.documents || []).filter((d) => d.kind === 'proposal').sort((a, b) => (b.version ?? 0) - (a.version ?? 0) || b.id - a.id);
}

/** Puts a deck the generator recorded onto the proposal as the app holds it
 * (replacing a copy with the same id), and remembers the client folder. */
export function applyGeneratedDocument(p: Proposal, doc: NonNullable<Proposal['documents']>[number], folder: string | null): void {
  p.documents = [...(p.documents || []).filter((d) => d.id !== doc.id), doc];
  if (folder && !p.folderPath) p.folderPath = folder;
}

/** The file name for the proposal's next deck: past the files in the client
 * folder and past every version already recorded on the proposal (a recorded
 * V2 whose file was moved still counts), so it matches the version the
 * generator records. */
export function nextDeckFileName(p: Pick<Proposal, 'client' | 'documents'>, serviceLabel: string, isoDate: string, folderFiles: string[]): string {
  const decks = proposalDecks(p);
  const name = suggestedFileName(p.client, serviceLabel, isoDate, [...folderFiles, ...decks.map((d) => d.fileName)]);
  const recorded = Math.max(0, ...decks.map((d) => d.version ?? 0));
  const m = name.match(/_V(\d+)\.pptx$/i);
  const version = m ? Number(m[1]) : 1;
  if (version > recorded) return name;
  return name.replace(/(_V\d+)?\.pptx$/i, `_V${recorded + 1}.pptx`);
}

// ── Dates ──────────────────────────────────────────────────────────────────

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + 'T12:00:00').getTime();
  const b = new Date(toIso + 'T12:00:00').getTime();
  return Math.round((b - a) / 86400000);
}

/** Last day of a contract that starts on `startIso` and runs `months` months. */
export function contractEndDate(startIso: string | null | undefined, months: number | null | undefined): string | null {
  if (!startIso || !months || months <= 0) return null;
  const [y, m, d] = startIso.split('-').map(Number);
  const end = new Date(y, m - 1 + months, d - 1, 12);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
}
