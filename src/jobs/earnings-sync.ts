import cron from 'node-cron';
import { config } from '../config/index.js';
import { prisma } from '../db/client.js';
import { earningsService } from '../services/scraper/earnings.service.js';

/**
 * Earnings Sync Job
 * Syncs player earnings from Liquipedia and updates org summaries
 *
 * Runs daily at 3 AM UTC
 * Rate limited to 1 request per 2 seconds to respect Liquipedia's servers
 */

const JOB_NAME = 'earnings-sync';
const SCHEDULE = '0 3 * * *'; // Daily at 3 AM UTC
const RATE_LIMIT_MS = 2000; // 2 seconds between requests (more conservative for earnings pages)

let isRunning = false;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function syncEarnings(): Promise<void> {
  if (isRunning) {
    console.log(`[${JOB_NAME}] ⏳ Job already running, skipping...`);
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  console.log(`[${JOB_NAME}] 🔄 Starting earnings sync...`);

  try {
    // Get all players with wiki URLs (sorted by least recently updated)
    const players = await prisma.player.findMany({
      where: {
        wikiUrl: { not: null },
      },
      select: {
        playerId: true,
        currentIgn: true,
        wikiUrl: true,
      },
      orderBy: { lastUpdated: 'asc' },
    });

    console.log(`[${JOB_NAME}] 📋 Found ${players.length} players to sync`);

    let playersProcessed = 0;
    let earningsRecords = 0;
    let failed = 0;

    for (const player of players) {
      try {
        console.log(`[${JOB_NAME}] 🔄 Syncing earnings for ${player.currentIgn}...`);
        const count = await earningsService.syncPlayerEarnings(player.playerId);
        earningsRecords += count;
        playersProcessed++;

        if (count > 0) {
          console.log(`[${JOB_NAME}] ✅ ${player.currentIgn}: synced ${count} earnings records`);
        }
      } catch (error: any) {
        failed++;
        console.error(`[${JOB_NAME}] ❌ Failed to sync ${player.currentIgn}:`, error.message);
      }

      // Rate limiting
      await sleep(RATE_LIMIT_MS);
    }

    // Update org summaries
    console.log(`[${JOB_NAME}] 📊 Updating org earnings summaries...`);

    const orgs = await prisma.organization.findMany({
      select: { slug: true, name: true },
    });

    for (const org of orgs) {
      try {
        await earningsService.updateOrgEarningsSummary(org.slug);
        console.log(`[${JOB_NAME}] ✅ Updated summary for ${org.name}`);
      } catch (error: any) {
        console.error(`[${JOB_NAME}] ❌ Failed to update ${org.name} summary:`, error.message);
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(
      `[${JOB_NAME}] ✅ Earnings sync complete: ${playersProcessed} players, ` +
        `${earningsRecords} records, ${failed} failed (${elapsed}s)`
    );

    // Notify via Discord if configured
    if (config.discord?.webhookUrl) {
      await notifyDiscord(
        `Earnings sync complete: ${playersProcessed} players, ${earningsRecords} records synced`
      );
    }
  } catch (error) {
    console.error(`[${JOB_NAME}] ❌ Earnings sync failed:`, error);

    if (config.discord?.webhookUrl) {
      await notifyDiscord(`Earnings sync failed: ${error}`);
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
        content: `💰 **Fortnite API - Earnings Sync**\n${message}`,
      }),
    });
  } catch {
    console.error(`[${JOB_NAME}] Failed to send Discord notification`);
  }
}

/**
 * Start the earnings sync cron job
 */
export function startEarningsSyncJob(): void {
  if (!config.cron.earningsAggregator) {
    console.log(`[${JOB_NAME}] ⏹️  Job disabled in config`);
    return;
  }

  console.log(`[${JOB_NAME}] 📅 Scheduling job: ${SCHEDULE}`);

  cron.schedule(SCHEDULE, syncEarnings, {
    scheduled: true,
    timezone: 'UTC',
  });

  console.log(`[${JOB_NAME}] ✅ Job scheduled - runs daily at 3 AM UTC`);
}

/**
 * Run earnings sync immediately (for manual triggers)
 */
export async function runEarningsSyncNow(): Promise<void> {
  await syncEarnings();
}

/**
 * Sync earnings for a specific player (for manual triggers)
 */
export async function syncPlayerEarningsNow(playerId: string): Promise<number> {
  console.log(`[${JOB_NAME}] 🔄 Manually syncing earnings for ${playerId}...`);
  const count = await earningsService.syncPlayerEarnings(playerId);
  console.log(`[${JOB_NAME}] ✅ Synced ${count} earnings records`);
  return count;
}

/**
 * Sync earnings for all players in an org
 */
export async function syncOrgEarningsNow(orgSlug: string): Promise<{ total: number; players: number }> {
  console.log(`[${JOB_NAME}] 🔄 Syncing earnings for all players in ${orgSlug}...`);

  const rosters = await prisma.teamRoster.findMany({
    where: { orgSlug },
    include: {
      player: {
        select: { playerId: true, currentIgn: true, wikiUrl: true },
      },
    },
  });

  let total = 0;
  let players = 0;

  for (const roster of rosters) {
    if (roster.player?.wikiUrl) {
      try {
        const count = await earningsService.syncPlayerEarnings(roster.player.playerId);
        total += count;
        players++;
        console.log(`[${JOB_NAME}] ✅ ${roster.player.currentIgn}: ${count} records`);
        await sleep(RATE_LIMIT_MS);
      } catch (error: any) {
        console.error(`[${JOB_NAME}] ❌ ${roster.player.currentIgn}: ${error.message}`);
      }
    }
  }

  // Update org summary
  await earningsService.updateOrgEarningsSummary(orgSlug);
  console.log(`[${JOB_NAME}] ✅ Updated org summary`);

  return { total, players };
}

// If running directly via CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];

  if (arg?.startsWith('org:')) {
    const orgSlug = arg.replace('org:', '');
    console.log(`🚀 Syncing earnings for org ${orgSlug}...\n`);
    syncOrgEarningsNow(orgSlug)
      .then(({ total, players }) => {
        console.log(`\n✅ Done! Synced ${total} records for ${players} players`);
        process.exit(0);
      })
      .catch((error) => {
        console.error('\n❌ Failed:', error);
        process.exit(1);
      });
  } else if (arg) {
    console.log(`🚀 Syncing earnings for player ${arg}...\n`);
    syncPlayerEarningsNow(arg)
      .then(() => {
        console.log('\n✅ Done!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('\n❌ Failed:', error);
        process.exit(1);
      });
  } else {
    console.log('🚀 Running full earnings sync manually...\n');
    runEarningsSyncNow()
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
