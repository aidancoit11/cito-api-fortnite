import cron from 'node-cron';
import { config } from '../config/index.js';
import { tournamentService } from '../services/scraper/tournament.service.js';
import { eventsService } from '../services/epic/events.service.js';

/**
 * Tournament Sync Job
 *
 * Two-part job:
 * 1. Historical sync (daily at 4 AM UTC) - Scrapes all tournaments from Liquipedia
 * 2. Live sync (every 5 minutes) - Updates live event leaderboards from Epic API
 */

const JOB_NAME = 'tournament-sync';
const HISTORICAL_SCHEDULE = '0 4 * * *'; // Daily at 4 AM UTC
const LIVE_SCHEDULE = '*/5 * * * *'; // Every 5 minutes

let isHistoricalRunning = false;
let isLiveRunning = false;

/**
 * Sync historical tournaments from Liquipedia
 * Runs daily, scrapes all years
 */
async function syncHistoricalTournaments(): Promise<void> {
  if (isHistoricalRunning) {
    console.log(`[${JOB_NAME}] ⏳ Historical sync already running, skipping...`);
    return;
  }

  isHistoricalRunning = true;
  const startTime = Date.now();
  console.log(`[${JOB_NAME}] 🔄 Starting historical tournament sync...`);

  try {
    // Sync tournaments for all years (no details/results by default - too slow)
    const result = await tournamentService.syncTournamentsToDatabase({
      scrapeDetails: false,
      scrapeResults: false,
    });

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[${JOB_NAME}] ✅ Historical sync complete: ${result.tournaments} tournaments (${elapsed}s)`);

    // Notify via Discord if configured
    if (config.discord?.webhookUrl) {
      await notifyDiscord(`Historical tournament sync complete: ${result.tournaments} tournaments`);
    }
  } catch (error) {
    console.error(`[${JOB_NAME}] ❌ Historical sync failed:`, error);

    if (config.discord?.webhookUrl) {
      await notifyDiscord(`Historical tournament sync failed: ${error}`);
    }
  } finally {
    isHistoricalRunning = false;
  }
}

/**
 * Sync live events from Epic API
 * Runs every 5 minutes to update leaderboards
 */
async function syncLiveEvents(): Promise<void> {
  if (isLiveRunning) {
    console.log(`[${JOB_NAME}] ⏳ Live sync already running, skipping...`);
    return;
  }

  isLiveRunning = true;

  try {
    // Check if there are any live events
    const liveEvents = await eventsService.getLiveEvents();

    if (liveEvents.length === 0) {
      // No live events, skip sync
      return;
    }

    console.log(`[${JOB_NAME}] 🔄 Found ${liveEvents.length} live events, syncing...`);

    const result = await eventsService.syncAllLiveEvents();

    if (result.events > 0) {
      console.log(`[${JOB_NAME}] ✅ Live sync: ${result.events} events, ${result.results} results, ${result.matches} matches`);
    }
  } catch (error) {
    console.error(`[${JOB_NAME}] ❌ Live sync failed:`, error);
  } finally {
    isLiveRunning = false;
  }
}

/**
 * Sync tournament with full results (for manual triggers or specific tournaments)
 */
async function syncTournamentWithResults(tournamentId: string): Promise<void> {
  console.log(`[${JOB_NAME}] 🔄 Syncing results for ${tournamentId}...`);

  try {
    const synced = await tournamentService.syncTournamentResults(tournamentId);
    console.log(`[${JOB_NAME}] ✅ Synced ${synced} results for ${tournamentId}`);
  } catch (error) {
    console.error(`[${JOB_NAME}] ❌ Failed to sync ${tournamentId}:`, error);
  }
}

async function notifyDiscord(message: string): Promise<void> {
  if (!config.discord?.webhookUrl) return;

  try {
    await fetch(config.discord.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🏆 **Fortnite API - Tournament Sync**\n${message}`,
      }),
    });
  } catch {
    console.error(`[${JOB_NAME}] Failed to send Discord notification`);
  }
}

/**
 * Start the tournament sync cron jobs
 */
export function startTournamentSyncJob(): void {
  if (!config.cron.tournamentScraper) {
    console.log(`[${JOB_NAME}] ⏹️  Job disabled in config`);
    return;
  }

  console.log(`[${JOB_NAME}] 📅 Scheduling historical sync: ${HISTORICAL_SCHEDULE} (daily at 4 AM UTC)`);
  console.log(`[${JOB_NAME}] 📅 Scheduling live sync: ${LIVE_SCHEDULE} (every 5 minutes)`);

  // Historical sync - daily
  cron.schedule(HISTORICAL_SCHEDULE, syncHistoricalTournaments, {
    scheduled: true,
    timezone: 'UTC',
  });

  // Live sync - every 5 minutes
  cron.schedule(LIVE_SCHEDULE, syncLiveEvents, {
    scheduled: true,
    timezone: 'UTC',
  });

  console.log(`[${JOB_NAME}] ✅ Jobs scheduled`);
}

/**
 * Run historical sync immediately (for manual triggers)
 */
export async function runHistoricalSyncNow(): Promise<void> {
  await syncHistoricalTournaments();
}

/**
 * Run live sync immediately (for manual triggers)
 */
export async function runLiveSyncNow(): Promise<void> {
  await syncLiveEvents();
}

/**
 * Sync specific tournament with results (for manual triggers)
 */
export async function syncTournament(tournamentId: string): Promise<void> {
  await syncTournamentWithResults(tournamentId);
}

/**
 * Full sync with results (for overnight/manual runs)
 * Warning: This is very slow - scrapes ALL tournament details and results
 */
export async function runFullSyncWithResults(options?: {
  years?: number[];
}): Promise<void> {
  const { years } = options || {};

  console.log(`[${JOB_NAME}] 🚀 Starting FULL tournament sync with results...`);
  console.log(`[${JOB_NAME}] ⚠️  This will take several hours!`);

  const startTime = Date.now();

  try {
    const result = await tournamentService.syncTournamentsToDatabase({
      years,
      scrapeDetails: true,
      scrapeResults: true,
    });

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const hours = Math.floor(elapsed / 3600);
    const mins = Math.floor((elapsed % 3600) / 60);

    console.log(`[${JOB_NAME}] ✅ Full sync complete:`);
    console.log(`   Tournaments: ${result.tournaments}`);
    console.log(`   Results: ${result.results}`);
    console.log(`   Time: ${hours}h ${mins}m`);

    if (config.discord?.webhookUrl) {
      await notifyDiscord(`Full tournament sync complete!\nTournaments: ${result.tournaments}\nResults: ${result.results}\nTime: ${hours}h ${mins}m`);
    }
  } catch (error) {
    console.error(`[${JOB_NAME}] ❌ Full sync failed:`, error);

    if (config.discord?.webhookUrl) {
      await notifyDiscord(`Full tournament sync failed: ${error}`);
    }
  }
}

// If running directly via CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];

  if (arg === '--live') {
    console.log('🚀 Running live tournament sync manually...\n');
    runLiveSyncNow()
      .then(() => {
        console.log('\n✅ Done!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('\n❌ Failed:', error);
        process.exit(1);
      });
  } else if (arg === '--full') {
    const years = process.argv[3]
      ? process.argv[3].split(',').map(y => parseInt(y.trim(), 10))
      : undefined;

    console.log('🚀 Running FULL tournament sync with results...');
    if (years) console.log(`   Years: ${years.join(', ')}`);
    console.log('   ⚠️  This will take several hours!\n');

    runFullSyncWithResults({ years })
      .then(() => {
        console.log('\n✅ Done!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('\n❌ Failed:', error);
        process.exit(1);
      });
  } else if (arg) {
    // Assume it's a tournament ID
    console.log(`🚀 Syncing results for tournament: ${arg}\n`);
    syncTournament(arg)
      .then(() => {
        console.log('\n✅ Done!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('\n❌ Failed:', error);
        process.exit(1);
      });
  } else {
    console.log('🚀 Running historical tournament sync manually...\n');
    runHistoricalSyncNow()
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
