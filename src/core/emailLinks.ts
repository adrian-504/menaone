// Reusable "linked emails" section for entity workspaces (Project, Company,
// Contact) — Part 4's requirement that emails linked from Action Required
// stay visible in the work graph, not just on the email's own row. Lives
// outside src/tabs/ so projects.ts/companies.ts/contacts.ts can import it
// without reaching into actionRequired.ts (same reasoning as the
// company/project view-refresher hooks in registry.ts).
import { escHtml, fmtDate } from '../lib/utils';
import { getLinksFor, ms365GetEmailsByIds, ms365GetEmailsByCompany } from '../lib/db';
import type { EntityKind, EmailRecord } from '../lib/types';
import { icon } from '../lib/icons';

function flagNote(status: string): string {
  if (status === 'flagged') return '';
  if (status === 'complete') return ' &bull; <span class="t-positive">completed</span>';
  return ' &bull; <span class="t-muted">no longer flagged</span>';
}

function emailRowCompact(e: EmailRecord): string {
  return `<div class="rec-row">
    <span class="rec-row-icon">${icon('mail', 14)}</span>
    <div class="rec-row-main">
      <div class="rec-row-title">${escHtml(e.subject || '(No subject)')}</div>
      <div class="rec-row-sub">${escHtml(e.senderName || e.senderEmail || 'Unknown sender')}${e.receivedAt ? ` &bull; ${escHtml(fmtDate(e.receivedAt))}` : ''}${flagNote(e.flagStatus)}</div>
    </div>
    ${e.webLink ? `<a href="${escHtml(e.webLink)}" target="_blank" rel="noopener" class="btn-sm">Open</a>` : ''}
  </div>`;
}

/** Renders into `containerId` and hides/empties it when there's nothing
 * linked — this is a supplementary section, not a primary tab, so it should
 * never show an empty-state card of its own. */
export async function renderLinkedEmails(entityType: EntityKind, entityId: number, containerId: string): Promise<void> {
  const el = document.getElementById(containerId);
  if (!el) return;
  const links = await getLinksFor(entityType, entityId);
  const emailIds = links.filter((l) => l.fromType === 'email' && l.toType === entityType).map((l) => l.fromId);
  if (emailIds.length === 0) {
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }
  const emails = await ms365GetEmailsByIds(emailIds);
  if (document.getElementById(containerId) !== el) return; // view navigated away while awaiting
  if (emails.length === 0) {
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  el.innerHTML = `<div class="group-label">Linked Emails (${emails.length})</div>${emails.map(emailRowCompact).join('')}`;
}

/** Company variant: emails carry a `company_id` (resolved from the company
 * name they were tagged with) rather than an entity_links row. */
export async function renderLinkedEmailsForCompany(companyId: number, containerId: string): Promise<void> {
  const el = document.getElementById(containerId);
  if (!el) return;
  const emails = await ms365GetEmailsByCompany(companyId);
  if (document.getElementById(containerId) !== el) return;
  if (emails.length === 0) {
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  el.innerHTML = `<div class="group-label">Linked Emails (${emails.length})</div>${emails.map(emailRowCompact).join('')}`;
}
