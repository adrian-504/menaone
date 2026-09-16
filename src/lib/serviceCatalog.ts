// The service catalogue decisions from the owner session on 16 September 2026
// (docs/service-catalog-decisions.md), as something the app can offer to apply
// one at a time. Nothing here runs on its own: each row is confirmed in
// Services → Catalog, the same way company merges are confirmed.
//
// A rename keeps the service and changes what clients see. A merge keeps both
// rows — the retired one points at the survivor — so proposals already sent
// still read as they were written.

import type { Service } from './types';

export type CatalogueAction = 'rename' | 'merge' | 'review';

export interface CatalogueDecision {
  action: CatalogueAction;
  /** The catalogue name as it exists today. */
  from: string;
  /** What it becomes: a new name (rename) or the service it joins (merge). */
  to: string;
  why: string;
}

/** Order matters: "Admin PRO" becomes "Administration and PRO" before "PRO" merges into it. */
export const CATALOGUE_DECISIONS: CatalogueDecision[] = [
  { action: 'rename', from: 'Company Constitution', to: 'Business Setup', why: 'The service was renamed; the old name stays searchable.' },
  { action: 'rename', from: 'Workforce', to: 'Employer of Record', why: 'One client-facing name for this service.' },
  { action: 'rename', from: 'Consultancy', to: 'Labour Law Consultancy', why: 'The main consultancy service, named for what it is.' },
  { action: 'rename', from: 'Admin PRO', to: 'Administration and PRO', why: 'Administration and PRO are always sold together.' },
  { action: 'merge', from: 'PRO', to: 'Administration and PRO', why: 'Same service under a shorter name.' },
  { action: 'merge', from: 'Company Constitution & Maintenance Package', to: 'Business Setup and Maintenance Package', why: 'Two names for the same package.' },
  { action: 'merge', from: 'Payroll and GOSI', to: 'Payroll', why: 'GOSI becomes an option on the proposal line, on by default.' },
  { action: 'merge', from: 'Accountancy and VAT', to: 'Accountancy', why: 'VAT becomes an option on the proposal line.' },
  { action: 'review', from: 'Admin PRO and Payroll', to: 'Administration and PRO + Payroll', why: 'Not a package: each proposal using it should become two lines. Needs a decision per proposal.' },
];

export interface PendingDecision extends CatalogueDecision {
  service: Service;
  /** The surviving service for a merge; null when it isn't in the catalogue. */
  target: Service | null;
  /** True when the decision can't be applied yet (a merge with no target). */
  blocked: boolean;
}

const byName = (services: Service[], name: string) =>
  services.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase()) ?? null;

/**
 * The decisions that still apply to this catalogue. A rename disappears once
 * the service carries its new name; a merge disappears once the old service is
 * gone or already merged.
 */
export function pendingDecisions(services: Service[]): PendingDecision[] {
  const out: PendingDecision[] = [];
  for (const d of CATALOGUE_DECISIONS) {
    const service = byName(services, d.from);
    if (!service || service.mergedInto != null) continue;
    const target = d.action === 'merge' ? byName(services, d.to) : null;
    if (d.action === 'rename' && byName(services, d.to)) {
      // The new name already exists as its own service: that is a merge, not a
      // rename, and the app must not silently pick one of them.
      out.push({ ...d, action: 'merge', service, target: byName(services, d.to), blocked: false });
      continue;
    }
    out.push({ ...d, service, target, blocked: d.action === 'merge' && !target });
  }
  return out;
}

/** What each line of the review list says. */
export function decisionSummary(d: PendingDecision): string {
  if (d.action === 'review') return `${d.from} — needs splitting per proposal`;
  if (d.action === 'rename') return `${d.from} → ${d.to}`;
  return d.blocked ? `${d.from} → ${d.to} (not in the catalogue yet)` : `${d.from} → ${d.to}`;
}
