// Companies: List or Grid. List is the default (owner, 24-Sep-2026); the
// choice is remembered on this device.

export type CompaniesView = 'grid' | 'list';
export const COMPANIES_VIEW_KEY = 'menaone.companiesView';

/** The view to open with, from what this device stored (anything else: List). */
export function initialCompaniesView(stored: string | null | undefined): CompaniesView {
  return stored === 'grid' || stored === 'list' ? stored : 'list';
}
