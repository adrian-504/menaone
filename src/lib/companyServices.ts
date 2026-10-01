// The company page's services (1.61): one line per service the company is
// getting — what it costs a month, the agreement it is under, when that
// expires and where it stands: Live, Past term · still active, No agreement
// (a service that has started with no agreement line covering it) or One-time
// work. Unknown is not none: an agreement with no end date reads Live, expires
// "not recorded". Pure: tabs/companyDossier.ts draws it.

import type { Agreement, CommercialLine, Proposal } from './types';
import { PS, currencyOf, fmtMoney, lineAmount } from './commercial';
import { fmtDateShort } from './dates';
import { endFact, pastTermActive, serviceLive } from './agreementTerms';

export type ServiceStatus = 'Live' | 'Past term · still active' | 'No agreement' | 'One-time work';
export interface ServiceRow {
  key: string;
  service: string;
  /** "SAR 9,000", or "one-time", or "—". */
  monthly: string;
  agreement: { id: number; ref: string } | null;
  /** The proposal a service without an agreement started from. */
  proposalId: number | null;
  expires: { text: string; known: boolean };
  status: ServiceStatus;
  tone: 'green' | 'amber' | 'grey';
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const TONE: Record<ServiceStatus, ServiceRow['tone']> = { Live: 'green', 'Past term · still active': 'amber', 'No agreement': 'amber', 'One-time work': 'grey' };
const ORDER: ServiceStatus[] = ['Past term · still active', 'No agreement', 'Live', 'One-time work'];

/** The lines of a record, or — an agreement with none — its type as the one service. */
function servicesOf(lines: CommercialLine[] | undefined, type: string | null | undefined, fee: number | null | undefined): { name: string; billing: 'monthly' | 'one_time'; amount: number | null }[] {
  if (lines?.length) return lines.map((l) => ({ name: l.serviceName, billing: l.billing, amount: lineAmount(l) }));
  return type ? type.split(/\s*\+\s*/).filter(Boolean).map((name, i) => ({ name, billing: 'monthly' as const, amount: i === 0 ? fee ?? null : null })) : [];
}

/** A company's services, one line each. `agreements` and `proposals` are the company's own. A service is running
 * when its agreement's service is active, or a signed proposal for it has started; cancelled and ended agreements
 * deliver nothing. Pure. */
export function companyServiceRows(i: { today: string; agreements: Agreement[]; proposals: Proposal[] }): ServiceRow[] {
  const rows: ServiceRow[] = [];
  const started = i.proposals.filter((p) => !p.archived && p.status === PS.WON && !!p.serviceStartedAt);
  const startedNames = started.flatMap((p) => servicesOf(p.lines, p.type, p.monthlyFee).map((s) => s.name));
  const standing = i.agreements.filter((a) => a.status !== 'Canceled' && a.serviceStatus !== 'Ended');
  const covered: string[] = [];
  for (const a of standing) {
    const services = servicesOf(a.lines, a.type, a.monthlyFee);
    for (const s of services) covered.push(s.name);
    const live = serviceLive(a);
    for (const s of services) {
      // Running: the agreement's service is active, or the proposal for this service has started.
      if (!live && !startedNames.some((n) => same(n, s.name))) continue;
      const oneTime = s.billing === 'one_time';
      const end = endFact(a);
      const status: ServiceStatus = oneTime ? 'One-time work' : pastTermActive({ ...a, serviceStatus: 'Active' }, i.today) ? 'Past term · still active' : 'Live';
      rows.push({
        key: `a${a.id}:${s.name}`, service: s.name, monthly: oneTime ? 'one-time' : s.amount != null ? fmtMoney(s.amount, currencyOf(a)) : '—',
        agreement: { id: a.id, ref: a.agrRef || `Agreement ${a.id}` }, proposalId: null,
        expires: end.kind === 'fixed' ? { text: fmtDateShort(a.endDate!, true), known: true } : { text: end.text, known: end.known },
        status, tone: TONE[status],
      });
    }
  }
  // Started from a signed proposal, with no agreement line for it.
  for (const p of started) {
    for (const s of servicesOf(p.lines, p.type, p.monthlyFee)) {
      if (covered.some((n) => same(n, s.name)) || rows.some((r) => r.proposalId != null && same(r.service, s.name))) continue;
      const oneTime = s.billing === 'one_time';
      const status: ServiceStatus = oneTime ? 'One-time work' : 'No agreement';
      rows.push({
        key: `p${p.id}:${s.name}`, service: s.name, monthly: oneTime ? 'one-time' : s.amount != null ? fmtMoney(s.amount, currencyOf(p)) : '—',
        agreement: null, proposalId: p.id, expires: { text: '—', known: true }, status, tone: TONE[status],
      });
    }
  }
  return rows.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.service.localeCompare(b.service));
}
