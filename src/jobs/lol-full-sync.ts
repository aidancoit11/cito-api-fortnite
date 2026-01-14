import { prisma } from '../db/client.js';
import { runLolTournamentSync } from './lol-tournament-sync.js';
import { runLolTeamSync } from './lol-team-sync.js';
import { runLolPlayerSync } from './lol-player-sync.js';
import { runLolChampionSync } from './lol-champion-sync.js';
import { runLolTransferSync } from './lol-transfer-sync.js';
import { runLolScheduleSync } from './lol-schedule-sync.js';
import { runLolEarningsSync } from './lol-earnings-sync.js';

/**
 * LoL Full Sync Job
 * Master job that runs all LoL sync jobs in sequence
 * Designed for overnight runs on droplet
 * Run daily at 1 AM UTC
 */

interface SyncResults {
  tournaments: any;
  teams: any;
  players: any;
  champions: any;
  transfers: any;
  schedule: any;
  earnings: any;
  totalDuration: string;
  errors: string[];
}

export async function runLolFullSync(options?: {
  skipEarnings?: boolean;
  skipTransfers?: boolean;
  playerEnrichLimit?: number;
  teamEnrichLimit?: number;
}): Promise<SyncResults> {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                    LOL FULL SYNC STARTED                      ║');
  console.log('║                    Overnight Data Scraper                     ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');

  const fullStartTime = Date.now();
  const errors: string[] = [];
  const results: Partial<SyncResults> = {};

  // 1. Tournament Sync (leagues, tournaments, schedule, standings)
  console.log('\n[1/7] Tournament Sync...');
  try {
    results.tournaments = await runLolTournamentSync();
  } catch (error: any) {
    errors.push(`Tournament sync failed: ${error.message}`);
    console.error('Tournament sync failed:', error.message);
  }

  // 2. Team Sync
  console.log('\n[2/7] Team Sync...');
  try {
    results.teams = await runLolTeamSync({
      enrichLimit: options?.teamEnrichLimit || 100,
    });
  } catch (error: any) {
    errors.push(`Team sync failed: ${error.message}`);
    console.error('Team sync failed:', error.message);
  }

  // 3. Player Sync
  console.log('\n[3/7] Player Sync...');
  try {
    results.players = await runLolPlayerSync({
      enrichLimit: options?.playerEnrichLimit || 200,
    });
  } catch (error: any) {
    errors.push(`Player sync failed: ${error.message}`);
    console.error('Player sync failed:', error.message);
  }

  // 4. Champion Sync
  console.log('\n[4/7] Champion Sync...');
  try {
    results.champions = await runLolChampionSync();
  } catch (error: any) {
    errors.push(`Champion sync failed: ${error.message}`);
    console.error('Champion sync failed:', error.message);
  }

  // 5. Transfer Sync
  if (!options?.skipTransfers) {
    console.log('\n[5/7] Transfer Sync...');
    try {
      results.transfers = await runLolTransferSync();
    } catch (error: any) {
      errors.push(`Transfer sync failed: ${error.message}`);
      console.error('Transfer sync failed:', error.message);
    }
  } else {
    console.log('\n[5/7] Transfer Sync... SKIPPED');
    results.transfers = { skipped: true };
  }

  // 6. Schedule Sync (upcoming matches)
  console.log('\n[6/7] Schedule Sync...');
  try {
    results.schedule = await runLolScheduleSync();
  } catch (error: any) {
    errors.push(`Schedule sync failed: ${error.message}`);
    console.error('Schedule sync failed:', error.message);
  }

  // 7. Earnings Sync (takes longest due to rate limiting)
  if (!options?.skipEarnings) {
    console.log('\n[7/7] Earnings Sync...');
    try {
      results.earnings = await runLolEarningsSync();
    } catch (error: any) {
      errors.push(`Earnings sync failed: ${error.message}`);
      console.error('Earnings sync failed:', error.message);
    }
  } else {
    console.log('\n[7/7] Earnings Sync... SKIPPED');
    results.earnings = { skipped: true };
  }

  const totalDuration = ((Date.now() - fullStartTime) / 1000 / 60).toFixed(1);

  // Final Summary
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                    LOL FULL SYNC COMPLETE                     ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Get final counts
  const counts = await prisma.$transaction([
    prisma.lolLeague.count(),
    prisma.lolTournament.count(),
    prisma.lolOrganization.count(),
    prisma.lolPlayer.count(),
    prisma.lolMatch.count(),
    prisma.lolChampion.count(),
    prisma.lolTransfer.count(),
    prisma.lolStanding.count(),
  ]);

  console.log('📊 FINAL DATABASE COUNTS:');
  console.log('─────────────────────────────────────────');
  console.log(`   Leagues:       ${counts[0].toLocaleString()}`);
  console.log(`   Tournaments:   ${counts[1].toLocaleString()}`);
  console.log(`   Teams:         ${counts[2].toLocaleString()}`);
  console.log(`   Players:       ${counts[3].toLocaleString()}`);
  console.log(`   Matches:       ${counts[4].toLocaleString()}`);
  console.log(`   Champions:     ${counts[5].toLocaleString()}`);
  console.log(`   Transfers:     ${counts[6].toLocaleString()}`);
  console.log(`   Standings:     ${counts[7].toLocaleString()}`);
  console.log('');
  console.log(`⏱️  Total Duration: ${totalDuration} minutes`);

  if (errors.length > 0) {
    console.log('');
    console.log('⚠️  ERRORS:');
    console.log('─────────────────────────────────────────');
    for (const error of errors) {
      console.log(`   ❌ ${error}`);
    }
  }

  console.log('');

  return {
    ...results,
    totalDuration: `${totalDuration} minutes`,
    errors,
  } as SyncResults;
}

// Run if called directly
const isMainModule = require.main === module;
if (isMainModule) {
  const args = process.argv.slice(2);
  const skipEarnings = args.includes('--skip-earnings');
  const skipTransfers = args.includes('--skip-transfers');

  runLolFullSync({ skipEarnings, skipTransfers })
    .then((results) => {
      if (results.errors.length > 0) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch(() => process.exit(1));
}
