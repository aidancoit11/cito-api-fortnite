import cron from 'node-cron';
import { config } from '../config/index.js';
import { prisma } from '../db/client.js';
import { orgService } from '../services/scraper/org.service.js';

/**
 * Roster Sync Job
 * Syncs organization rosters from Liquipedia every 12 hours
 *
 * Rate limited to 1 request per second to respect Liquipedia's servers
 */

const JOB_NAME = 'roster-sync';
const SCHEDULE = '0 */12 * * *'; // Every 12 hours
const RATE_LIMIT_MS = 1000; // 1 second between requests

let isRunning = false;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function syncRosters(): Promise<void> {
  if (isRunning) {
    console.log(`[${JOB_NAME}] ⏳ Job already running, skipping...`);
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  console.log(`[${JOB_NAME}] 🔄 Starting roster sync...`);

  try {
    // Get all organizations from database
    const orgs = await prisma.organization.findMany({
      select: { slug: true, name: true },
      orderBy: { lastUpdated: 'asc' }, // Sync oldest first
    });

    console.log(`[${JOB_NAME}] 📋 Found ${orgs.length} organizations to sync`);

    let synced = 0;
    let failed = 0;

    for (const org of orgs) {
      try {
        console.log(`[${JOB_NAME}] 🔄 Syncing ${org.name} (${org.slug})...`);
        const count = await orgService.syncRosterToDatabase(org.slug);
        synced++;
        console.log(`[${JOB_NAME}] ✅ ${org.name}: synced ${count} members`);
      } catch (error: any) {
        failed++;
        console.error(`[${JOB_NAME}] ❌ Failed to sync ${org.name}:`, error.message);
      }

      // Rate limiting
      await sleep(RATE_LIMIT_MS);
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[${JOB_NAME}] ✅ Roster sync complete: ${synced} synced, ${failed} failed (${elapsed}s)`);

    // Notify via Discord if configured
    if (config.discord?.webhookUrl) {
      await notifyDiscord(`Roster sync complete: ${synced} orgs synced, ${failed} failed`);
    }
  } catch (error) {
    console.error(`[${JOB_NAME}] ❌ Roster sync failed:`, error);

    if (config.discord?.webhookUrl) {
      await notifyDiscord(`Roster sync failed: ${error}`);
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
        content: `📋 **Fortnite API - Roster Sync**\n${message}`,
      }),
    });
  } catch {
    console.error(`[${JOB_NAME}] Failed to send Discord notification`);
  }
}

/**
 * Start the roster sync cron job
 */
export function startRosterSyncJob(): void {
  if (!config.cron.rosterScraper) {
    console.log(`[${JOB_NAME}] ⏹️  Job disabled in config`);
    return;
  }

  console.log(`[${JOB_NAME}] 📅 Scheduling job: ${SCHEDULE}`);

  cron.schedule(SCHEDULE, syncRosters, {
    scheduled: true,
    timezone: 'UTC',
  });

  console.log(`[${JOB_NAME}] ✅ Job scheduled - runs every 12 hours`);
}

/**
 * Run roster sync immediately (for manual triggers)
 */
export async function runRosterSyncNow(): Promise<void> {
  await syncRosters();
}

/**
 * Sync a specific org roster (for manual triggers)
 */
export async function syncSingleOrg(slug: string): Promise<number> {
  console.log(`[${JOB_NAME}] 🔄 Manually syncing ${slug}...`);
  const count = await orgService.syncRosterToDatabase(slug);
  console.log(`[${JOB_NAME}] ✅ ${slug}: synced ${count} members`);
  return count;
}

// If running directly via CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const orgSlug = process.argv[2];

  if (orgSlug) {
    console.log(`🚀 Syncing roster for ${orgSlug}...\n`);
    syncSingleOrg(orgSlug)
      .then(() => {
        console.log('\n✅ Done!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('\n❌ Failed:', error);
        process.exit(1);
      });
  } else {
    console.log('🚀 Running full roster sync manually...\n');
    runRosterSyncNow()
      .then(() => {
        console.log('\n✅ Done!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('\n❌ Failed:', error);
        process.exit(1);
      });
  }
}
