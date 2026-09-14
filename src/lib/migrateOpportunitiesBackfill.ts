// One-time Lead-Proposal → Opportunity backfill (Core Refinement & Product
// Maturity, Stage 2). Mirrors migrateNotesMarkdown.ts's safety pattern
// exactly: back up first, never delete/modify the source records, gate by
// an app_meta flag so it runs exactly once.
import { S } from './state';
import { getAppMeta, setAppMeta, exportBackupJson, writeTextFile, saveOpportunity } from './db';
import { today } from './utils';
import type { Opportunity } from './types';

const BACKFILL_FLAG = 'opportunities_leads_backfilled_v1';

export interface OpportunityBackfillReport {
  ran: boolean;
  migratedCount: number;
  backupPath: string | null;
  error?: string;
}

async function writeBackup(): Promise<string | null> {
  try {
    const { appDataDir, join } = await import('@tauri-apps/api/path');
    const json = await exportBackupJson();
    const dir = await appDataDir();
    const path = await join(dir, `opportunities-backfill-backup-${today()}-${Date.now()}.json`);
    await writeTextFile(path, json);
    return path;
  } catch (e) {
    console.error('Pre-backfill backup failed:', e);
    return null;
  }
}

/** Runs once (ever) per database. Returns null when there's nothing to do
 * (already run, or no Lead-status proposals exist) — the caller only shows a
 * report when this resolves to a real OpportunityBackfillReport. */
export async function migrateLeadsToOpportunitiesIfNeeded(): Promise<OpportunityBackfillReport | null> {
  if ((await getAppMeta(BACKFILL_FLAG)) === '1') return null;

  const leads = S.proposals.filter((p) => p.status === 'Lead' && !p.archived);
  if (leads.length === 0) {
    await setAppMeta(BACKFILL_FLAG, '1');
    return null;
  }

  const backupPath = await writeBackup();
  if (!backupPath) {
    return { ran: false, migratedCount: 0, backupPath: null, error: 'Could not write a backup file, so the Opportunity backfill was skipped for safety. It will be retried next time the app opens.' };
  }

  let migratedCount = 0;
  for (const p of leads) {
    const draft: Opportunity = {
      id: 0, name: p.client, companyId: null, companyName: p.client, owner: p.owner || null,
      stage: 'Lead', status: 'Open', estimatedValue: p.monthlyFee ?? null, currency: 'SAR',
      probability: null, expectedCloseDate: null, description: null, nextAction: null,
      proposalId: p.id, projectId: null, sortOrder: null, archived: false,
      createdAt: null, updatedAt: null, tags: [],
    };
    try {
      const saved = await saveOpportunity(draft);
      S.opportunities.push(saved);
      migratedCount++;
    } catch (e) {
      console.error(`Failed to backfill opportunity for proposal SL#${p.id}:`, e);
    }
  }

  await setAppMeta(BACKFILL_FLAG, '1');
  return { ran: true, migratedCount, backupPath };
}
