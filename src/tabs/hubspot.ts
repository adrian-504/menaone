import { S } from '../lib/state';
import { HS_STAGE_MAP, ST } from '../lib/constants';
import { escHtml, expose, statusDot } from '../lib/utils';
import { saveCsv } from '../lib/files';
import type { Proposal } from '../lib/types';

function fmtHSDate(s: string | null | undefined): string {
  // HubSpot accepts YYYY-MM-DD — dates are already stored as ISO, so this is a passthrough.
  return s || '';
}

function hsGetData(): Proposal[] {
  const newOnly = (document.getElementById('hs-new-only') as HTMLInputElement | null)?.checked;
  let data = S.proposals;
  if (newOnly) data = data.filter((p) => p.hubspot !== 'Yes');
  return data;
}

export async function exportHubSpotDeals(): Promise<void> {
  const data = hsGetData();
  const headers = ['Deal Name', 'Deal Stage', 'Create Date', 'Close Date', 'Associated Company', 'Pipeline', 'Deal Description', 'HubSpot Owner', 'MENA BIG SL#', 'MENA BIG Status'];
  const lines = [headers.join(',')];
  for (const p of data) {
    const dealName = `${p.client} — ${p.type && p.type !== '—' ? p.type : 'General'}`;
    const stage = HS_STAGE_MAP[p.status] || 'Appointment Scheduled';
    const desc = [p.type && p.type !== '—' ? `Type: ${p.type}` : '', p.remarks ? `Notes: ${p.remarks}` : ''].filter(Boolean).join(' | ');
    const row = [
      `"${dealName.replace(/"/g, '""')}"`, `"${stage}"`, fmtHSDate(p.sentDate), fmtHSDate(p.dblSignedDate),
      `"${(p.client || '').replace(/"/g, '""')}"`, 'default', `"${desc.replace(/"/g, '""')}"`,
      `"${(p.owner || '').replace(/"/g, '""')}"`, p.id, `"${(p.status || '').replace(/"/g, '""')}"`,
    ];
    lines.push(row.join(','));
  }
  await saveCsv('MENA_BIG_HubSpot_Deals', lines.join('\n'));
}
expose('exportHubSpotDeals', exportHubSpotDeals);

export async function exportHubSpotCompanies(): Promise<void> {
  const data = hsGetData();
  const clientMap: Record<string, { count: number; owners: Set<string>; remarks: string[] }> = {};
  data.forEach((p) => {
    if (!clientMap[p.client]) clientMap[p.client] = { count: 0, owners: new Set(), remarks: [] };
    clientMap[p.client].count++;
    if (p.owner) clientMap[p.client].owners.add(p.owner);
    if (p.remarks) clientMap[p.client].remarks.push(p.remarks);
  });
  const headers = ['Company Name', 'Number of Proposals', 'Lead Owner', 'Notes'];
  const lines = [headers.join(',')];
  for (const [name, info] of Object.entries(clientMap).sort((a, b) => a[0].localeCompare(b[0]))) {
    const row = [
      `"${name.replace(/"/g, '""')}"`, info.count,
      `"${[...info.owners].join(', ').replace(/"/g, '""')}"`,
      `"${[...new Set(info.remarks)].slice(0, 3).join(' | ').replace(/"/g, '""')}"`,
    ];
    lines.push(row.join(','));
  }
  await saveCsv('MENA_BIG_HubSpot_Companies', lines.join('\n'));
}
expose('exportHubSpotCompanies', exportHubSpotCompanies);

export function renderStageMappingTable(): void {
  const tbody = document.getElementById('stage-map-tbody');
  if (!tbody) return;
  tbody.innerHTML = Object.entries(HS_STAGE_MAP).map(([mena, hs]) => {
    const cfg = ST[mena] || { c: '#6B7280', ch: '#9CA3AF' };
    return `<tr>
      <td>
        ${statusDot(cfg, mena)}
      </td>
      <td class="fw-600">${escHtml(hs)}</td>
      <td class="t-muted t-meta">${
        mena === 'Signed by Both Parties' ? 'Won — signed by both parties' :
        mena === 'Lost' || mena === 'Withdrawn' ? 'Maps to Closed Lost' : ''
      }</td>
    </tr>`;
  }).join('');
}
expose('renderStageMappingTable', renderStageMappingTable);
