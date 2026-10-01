// Who a list row is with (1.59 "pages"): a proposal's contact — its primary
// contact, else the company's decision maker, else its first contact — and the
// company's industry, as a small round tile and "Lina Saleh · Retail".

import { S } from './state';
import { escHtml, strColor } from './utils';
import { initialsOf } from './appearance';
import type { Contact, Proposal } from './types';

export function proposalContact(p: Pick<Proposal, 'primaryContactId' | 'companyId'>): Contact | null {
  if (p.primaryContactId != null) {
    const c = S.contacts.find((x) => x.id === p.primaryContactId);
    if (c) return c;
  }
  if (p.companyId == null) return null;
  const theirs = S.contacts.filter((c) => c.companyId === p.companyId);
  return theirs.find((c) => c.isDecisionMaker) || theirs[0] || null;
}

export function companyIndustry(companyId: number | null | undefined): string {
  if (companyId == null) return '';
  return S.companies.find((c) => c.id === companyId)?.industries?.[0] || '';
}

/** A person's round tile and "Name · sub"; with no name, a grey "—" and `none`. */
export function personHtml(name: string | null, sub: string, none = 'No contact yet'): string {
  const tile = name
    ? `<span class="pk-person" style="background:${strColor(name)}" aria-hidden="true">${escHtml(initialsOf(name))}</span>`
    : '<span class="pk-person is-none" aria-hidden="true">—</span>';
  return `${tile}<span class="pk-who-t">${escHtml([name || none, sub].filter(Boolean).join(' · '))}</span>`;
}
