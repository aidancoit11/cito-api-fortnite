import { config } from '../config/index.js';
import { tokenManager } from '../services/epic/token-manager.js';
import { startTokenRefreshJob } from './token-refresh.js';
import { startRosterSyncJob } from './roster-sync.js';
import { startEarningsSyncJob } from './earnings-sync.js';

/**
 * Jobs Manager
 * Initializes and starts all background cron jobs
 *
 * Jobs included:
 * - Token Refresh (every 4 hours)
 * - Roster Sync (every 12 hours)
 * - Earnings Sync (daily at 3 AM UTC)
 * - Tournament Scraper (TBD)
 * - Transfer Scraper (TBD)
 * - Stats Refresh (TBD)
 */

export async function initializeJobs(): Promise<void> {
  console.log('\n🔧 Initializing background jobs...\n');

  // Initialize token manager first (needed for Epic API jobs)
  try {
    await tokenManager.initialize();
  } catch (error) {
    console.warn('⚠️  Token manager initialization failed - Epic API jobs will not work');
    console.warn('   Run "npm run generate-auth" to set up device auth credentials\n');
  }

  // Start cron jobs
  const jobs = [
    { name: 'Token Refresh', enabled: config.cron.tokenRefresh, start: startTokenRefreshJob },
    { name: 'Roster Sync', enabled: config.cron.rosterScraper, start: startRosterSyncJob },
    { name: 'Earnings Sync', enabled: config.cron.earningsAggregator, start: startEarningsSyncJob },
    // Future jobs will be added here:
    // { name: 'Tournament Scraper', enabled: config.cron.tournamentScraper, start: startTournamentScraperJob },
    // { name: 'Transfer Scraper', enabled: config.cron.transferScraper, start: startTransferScraperJob },
    // { name: 'Stats Refresh', enabled: config.cron.statsRefresh, start: startStatsRefreshJob },
  ];

  let startedCount = 0;
  let skippedCount = 0;

  for (const job of jobs) {
    if (job.enabled) {
      try {
        job.start();
        startedCount++;
      } catch (error) {
        console.error(`❌ Failed to start ${job.name}:`, error);
      }
    } else {
      console.log(`⏹️  ${job.name}: disabled`);
      skippedCount++;
    }
  }

  console.log(`\n📊 Jobs summary: ${startedCount} started, ${skippedCount} disabled\n`);
}

// If running directly via CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🚀 Starting all jobs manually...\n');
  initializeJobs()
    .then(() => {
      console.log('✅ Jobs initialized. Press Ctrl+C to stop.\n');
    })
    .catch((error) => {
      console.error('❌ Failed to initialize jobs:', error);
      process.exit(1);
    });
}
