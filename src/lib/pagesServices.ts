// Services (Catalog) in My Day's language (1.60 "pages-2"): one card per
// category with what's in it, what each service costs (from its rate card)
// and who is using it under an active agreement. Pure: tabs/pricing.ts draws it.

import type { Agreement, Proposal, RateCard, Service } from './types';
import { PS, isAgreementActive } from './commercial';
import { plural } from './pageKit';

type Line = { serviceId: number | null; serviceName: string };
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** Does a record's lines (or, without lines, its type) name this service? Names match whatever their capitals. */
const usesService = (lines: Line[] | undefined, fallbackType: string | null | undefined, s: Pick<Service, 'id' | 'name'>): boolean =>
  lines?.length ? lines.some((l) => l.serviceId === s.id || same(l.serviceName, s.name)) : (fallbackType || '').split(/\s*[+,]\s*/).some((t) => same(t, s.name));

const sar = (n: number) => Math.round(n).toLocaleString('en-US');

/** What a service costs, as the catalogue says it: "SAR 1,200–15,000 /mo", "SAR 1,800 /mo", "12% of annual package",
 * "per head", "package", "per country", "SAR 9,000 once"; "" when nothing is set. Pure. */
export function servicePrice(s: Pick<Service, 'billing' | 'defaultPrice' | 'rateCardId'>, rateCards: Pick<RateCard, 'id' | 'pricing'>[]): string {
  const p = s.rateCardId != null ? rateCards.find((r) => r.id === s.rateCardId)?.pricing : null;
  const per = s.billing === 'one_time' ? 'once' : '/mo';
  if (p?.percent) return `${p.percent.standard}% of annual package`;
  if (p?.perCountry) return 'per country';
  let range: { min: number; max: number } | null = null;
  if (p?.hasTranches && p.tranches?.length) {
    const mins = p.tranches.map((t) => t.noCommMin).filter((v): v is number => v != null);
    const maxs = p.tranches.map((t) => t.noCommMax).filter((v): v is number => v != null);
    if (mins.length && maxs.length) range = { min: Math.min(...mins), max: Math.max(...maxs) };
  } else if (p?.hasPackages && p.packages?.length) {
    range = { min: Math.min(...p.packages.map((x) => x.min)), max: Math.max(...p.packages.map((x) => x.max)) };
  } else if (p && p.noCommMin != null && p.noCommMax != null) {
    range = { min: p.noCommMin, max: p.noCommMax };
  } else if (s.defaultPrice != null) {
    range = { min: s.defaultPrice, max: s.defaultPrice };
  }
  if (!range) return p?.perPerson ? 'per head' : p?.hasPackages ? 'package' : '';
  const amount = range.min === range.max ? `SAR ${sar(range.min)}` : `SAR ${sar(range.min)}–${sar(range.max)}`;
  return p?.perPerson ? `${amount} per head` : `${amount} ${per}`;
}

export interface CatalogService { id: number; name: string; price: string; clients: number; active: boolean; mergedInto: number | null }
export interface CatalogGroup {
  category: string;
  /** "01", "02", … in the order shown. */
  no: string;
  services: CatalogService[];
  /** Companies with an active agreement on any of its services. */
  activeClients: number;
  inProposals: number;
  lost: number;
  /** Under the count on the right: "active clients", "2 in proposals", "1 lost", "clients". */
  caption: string;
}

export interface CatalogInput {
  services: Service[];
  rateCards: Pick<RateCard, 'id' | 'pricing'>[];
  agreements: Pick<Agreement, 'companyId' | 'client' | 'status' | 'serviceStatus' | 'endDate' | 'lines' | 'type'>[];
  proposals: Pick<Proposal, 'id' | 'status' | 'archived' | 'lines' | 'type'>[];
  today: string;
}

const OPEN = new Set<string>([PS.REQUEST, PS.DRAFTING, PS.REVIEW, PS.SENT, PS.CLIENT_SIGNED]);

/** The catalogue as category cards: the most used first (active clients, then open proposals, then by name). Pure. */
export function catalogGroups(i: CatalogInput): CatalogGroup[] {
  const live = i.agreements.filter((a) => isAgreementActive(a as Agreement, i.today));
  const clientKey = (a: { companyId?: number | null; client?: string | null }) => (a.companyId != null ? `id:${a.companyId}` : `n:${(a.client || '').toLowerCase()}`);
  const byCat = new Map<string, Service[]>();
  for (const s of i.services) {
    const c = s.category || 'Other';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c)!.push(s);
  }
  const groups = [...byCat.entries()].map(([category, list]) => {
    const services = list.map((s) => ({
      id: s.id, name: s.name, price: servicePrice(s, i.rateCards), active: s.active, mergedInto: s.mergedInto,
      clients: new Set(live.filter((a) => usesService(a.lines, a.type, s)).map(clientKey)).size,
    })).sort((a, b) => b.clients - a.clients || a.name.localeCompare(b.name));
    const anyOf = (lines: Line[] | undefined, type: string | null | undefined) => list.some((s) => usesService(lines, type, s));
    const activeClients = new Set(live.filter((a) => anyOf(a.lines, a.type)).map(clientKey)).size;
    const inProposals = i.proposals.filter((p) => !p.archived && OPEN.has(p.status) && anyOf(p.lines, p.type)).length;
    const lost = i.proposals.filter((p) => !p.archived && p.status === PS.LOST && anyOf(p.lines, p.type)).length;
    const caption = activeClients ? (activeClients === 1 ? 'active client' : 'active clients') : inProposals ? `${inProposals} in proposals` : lost ? `${lost} lost` : 'clients';
    return { category, no: '', services, activeClients, inProposals, lost, caption };
  }).sort((a, b) => b.activeClients - a.activeClients || b.inProposals - a.inProposals || b.lost - a.lost || a.category.localeCompare(b.category));
  groups.forEach((g, n) => { g.no = String(n + 1).padStart(2, '0'); });
  return groups;
}

/** How many category cards show before "show all N categories". */
export const CATALOG_FIRST = 6;

/** "2 services" under a category's name. */
export const servicesLabel = (n: number): string => plural(n, 'service');

/** A category's tile colour (1–6): its place among all categories by name, so it stays put as usage changes. Pure. */
export function categoryTile(category: string, all: string[]): number {
  const names = [...new Set(all)].sort((a, b) => a.localeCompare(b));
  return (Math.max(0, names.indexOf(category)) % 6) + 1;
}
