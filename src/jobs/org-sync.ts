import { config } from '../config/index.js';
import * as orgService from '../services/scraper/org.service.js';

/**
 * Org Sync Job
 * Syncs all organizations from Liquipedia Portal:Organizations
 * Then syncs their rosters with details
 */

const JOB_NAME = 'org-sync';

let isRunning = false;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function syncOrgs(): Promise<void> {
  if (isRunning) {
    console.log(`[${JOB_NAME}] Job already running, skipping...`);
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  console.log(`[${JOB_NAME}] Starting org sync...`);

  try {
    // First, sync all orgs from Liquipedia portal
    console.log(`[${JOB_NAME}] Syncing all orgs from Liquipedia...`);
    const orgCount = await orgService.syncOrgsToDatabase();
    console.log(`[${JOB_NAME}] Synced ${orgCount} organizations`);

    // Then sync all orgs with their details and rosters
    console.log(`[${JOB_NAME}] Syncing org details and rosters...`);
    const result = await orgService.syncAllOrgsWithDetails();
    console.log(`[${JOB_NAME}] Details sync: ${result.synced} synced, ${result.failed} failed`);

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[${JOB_NAME}] Org sync complete in ${elapsed}s`);

    // Notify via Discord if configured
    if (config.discord?.webhookUrl) {
      await notifyDiscord(`Org sync complete: ${orgCount} orgs, ${result.synced} with details`);
    }
  } catch (error) {
    console.error(`[${JOB_NAME}] Org sync failed:`, error);

    if (config.discord?.webhookUrl) {
      await notifyDiscord(`Org sync failed: ${error}`);
    }
  } finally {
    isRunning = false;
  }
}

async function notifyDiscord(message: string): Promise<void> {
  if (!config.discord?.webhookUrl) return;

  try {
    await fetch(config.discord.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `**Fortnite API - Org Sync**\n${message}`,
      }),
    });
  } catch {
    console.error(`[${JOB_NAME}] Failed to send Discord notification`);
  }
}

/**
 * Run org sync (for manual triggers or CLI)
 */
export async function runOrgSyncNow(): Promise<void> {
  await syncOrgs();
}

// If running directly via CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Starting full org sync...\n');
  runOrgSyncNow()
    .then(() => {
      console.log('\nDone!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\nFailed:', error);
      process.exit(1);
    });
}
