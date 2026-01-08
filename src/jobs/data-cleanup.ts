import { prisma } from '../db/client.js';
import * as tournamentService from '../services/scraper/tournament.service.js';

/**
 * Data Cleanup Job
 * Fills in missing metadata for tournaments
 */

const JOB_NAME = 'data-cleanup';

interface CleanupStats {
  tournamentsFixed: number;
  tournamentsSkipped: number;
  errors: number;
}

/**
 * Find and fix tournaments with missing metadata
 */
export async function cleanupTournamentMetadata(): Promise<CleanupStats> {
  console.log(`[${JOB_NAME}] Starting tournament metadata cleanup...`);

  const stats: CleanupStats = {
    tournamentsFixed: 0,
    tournamentsSkipped: 0,
    errors: 0,
  };

  try {
    // Find tournaments with missing data
    const tournamentsWithMissingData = await prisma.tournament.findMany({
      where: {
        OR: [
          { startDate: null },
          { region: null },
          { prizePool: null },
        ],
        url: { not: null }, // Must have a URL to scrape
      },
      select: {
        tournamentId: true,
        name: true,
        url: true,
        startDate: true,
        region: true,
        prizePool: true,
      },
      take: 100, // Process in batches
    });

    console.log(`[${JOB_NAME}] Found ${tournamentsWithMissingData.length} tournaments with missing data`);

    for (const tournament of tournamentsWithMissingData) {
      try {
        if (!tournament.url) {
          stats.tournamentsSkipped++;
          continue;
        }

        console.log(`[${JOB_NAME}] Processing: ${tournament.name}`);

        // Try to scrape tournament details
        const details = await tournamentService.scrapeTournamentDetails(tournament.url);

        if (!details) {
          console.log(`[${JOB_NAME}]   No details found, skipping`);
          stats.tournamentsSkipped++;
          continue;
        }

        // Build update data only for missing fields
        const updateData: any = {};

        if (!tournament.startDate && details.startDate) {
          updateData.startDate = details.startDate;
        }
        if (!tournament.region && details.region) {
          updateData.region = details.region;
        }
        if (!tournament.prizePool && details.prizePool) {
          updateData.prizePool = details.prizePool;
        }
        if (details.endDate) {
          updateData.endDate = details.endDate;
        }
        if (details.organizer) {
          updateData.organizer = details.organizer;
        }
        if (details.format) {
          updateData.format = details.format;
        }

        if (Object.keys(updateData).length > 0) {
          updateData.lastUpdated = new Date();

          await prisma.tournament.update({
            where: { tournamentId: tournament.tournamentId },
            data: updateData,
          });

          console.log(`[${JOB_NAME}]   Updated: ${Object.keys(updateData).join(', ')}`);
          stats.tournamentsFixed++;
        } else {
          console.log(`[${JOB_NAME}]   No new data to update`);
          stats.tournamentsSkipped++;
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        console.error(`[${JOB_NAME}]   Error processing ${tournament.name}:`, error.message);
        stats.errors++;
      }
    }

    console.log(`[${JOB_NAME}] Cleanup complete:`, stats);
    return stats;
  } catch (error: any) {
    console.error(`[${JOB_NAME}] Cleanup failed:`, error);
    throw error;
  }
}

/**
 * Fix tournaments without results by scraping them
 */
export async function scrapeEmptyTournaments(): Promise<CleanupStats> {
  console.log(`[${JOB_NAME}] Finding tournaments without results...`);

  const stats: CleanupStats = {
    tournamentsFixed: 0,
    tournamentsSkipped: 0,
    errors: 0,
  };

  try {
    // Find completed tournaments with no results
    const emptyTournaments = await prisma.tournament.findMany({
      where: {
        isCompleted: true,
        url: { not: null },
        results: { none: {} },
      },
      select: {
        tournamentId: true,
        name: true,
        url: true,
      },
      take: 50,
    });

    console.log(`[${JOB_NAME}] Found ${emptyTournaments.length} completed tournaments without results`);

    for (const tournament of emptyTournaments) {
      try {
        if (!tournament.url) {
          stats.tournamentsSkipped++;
          continue;
        }

        console.log(`[${JOB_NAME}] Scraping results for: ${tournament.name}`);

        const results = await tournamentService.scrapeTournamentResults(tournament.url);

        if (results && results.length > 0) {
          // Save results
          for (const result of results) {
            await prisma.tournamentResult.upsert({
              where: {
                tournamentId_accountId: {
                  tournamentId: tournament.tournamentId,
                  accountId: result.accountId || `unknown_${result.rank}`,
                },
              },
              create: {
                tournamentId: tournament.tournamentId,
                accountId: result.accountId || `unknown_${result.rank}`,
                displayName: result.displayName,
                rank: result.rank,
                points: result.points || 0,
                kills: result.kills,
                earnings: result.earnings,
              },
              update: {
                displayName: result.displayName,
                rank: result.rank,
                points: result.points || 0,
                kills: result.kills,
                earnings: result.earnings,
              },
            });
          }

          console.log(`[${JOB_NAME}]   Added ${results.length} results`);
          stats.tournamentsFixed++;
        } else {
          console.log(`[${JOB_NAME}]   No results found`);
          stats.tournamentsSkipped++;
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error: any) {
        console.error(`[${JOB_NAME}]   Error:`, error.message);
        stats.errors++;
      }
    }

    console.log(`[${JOB_NAME}] Results scraping complete:`, stats);
    return stats;
  } catch (error: any) {
    console.error(`[${JOB_NAME}] Failed:`, error);
    throw error;
  }
}

/**
 * Link players to their tournament earnings
 */
export async function linkPlayersToEarnings(): Promise<{ linked: number; errors: number }> {
  console.log(`[${JOB_NAME}] Linking players to earnings...`);

  let linked = 0;
  let errors = 0;

  try {
    // Find earnings without player links
    const unlinkedEarnings = await prisma.playerTournamentEarning.findMany({
      where: {
        playerId: { not: null },
        player: {
          earningsSummary: null,
        },
      },
      select: {
        playerId: true,
      },
      distinct: ['playerId'],
      take: 100,
    });

    console.log(`[${JOB_NAME}] Found ${unlinkedEarnings.length} players needing summary calculation`);

    for (const { playerId } of unlinkedEarnings) {
      try {
        // Calculate earnings summary
        const earnings = await prisma.playerTournamentEarning.aggregate({
          where: { playerId },
          _sum: { earnings: true },
          _count: true,
          _min: { placement: true },
          _avg: { placement: true },
        });

        const firstPlaces = await prisma.playerTournamentEarning.count({
          where: { playerId, placement: 1 },
        });

        const top10s = await prisma.playerTournamentEarning.count({
          where: { playerId, placement: { lte: 10 } },
        });

        const highestEarning = await prisma.playerTournamentEarning.findFirst({
          where: { playerId },
          orderBy: { earnings: 'desc' },
          select: { earnings: true },
        });

        const lastTournament = await prisma.playerTournamentEarning.findFirst({
          where: { playerId },
          orderBy: { tournamentDate: 'desc' },
          select: { tournamentDate: true },
        });

        // Upsert summary
        await prisma.playerEarningsSummary.upsert({
          where: { playerId },
          create: {
            playerId,
            totalEarnings: earnings._sum.earnings || 0,
            tournamentCount: earnings._count,
            firstPlaceCount: firstPlaces,
            top10Count: top10s,
            avgPlacement: earnings._avg.placement || null,
            bestPlacement: earnings._min.placement || null,
            highestEarning: highestEarning?.earnings || null,
            lastTournamentDate: lastTournament?.tournamentDate || null,
          },
          update: {
            totalEarnings: earnings._sum.earnings || 0,
            tournamentCount: earnings._count,
            firstPlaceCount: firstPlaces,
            top10Count: top10s,
            avgPlacement: earnings._avg.placement || null,
            bestPlacement: earnings._min.placement || null,
            highestEarning: highestEarning?.earnings || null,
            lastTournamentDate: lastTournament?.tournamentDate || null,
            lastUpdated: new Date(),
          },
        });

        linked++;
      } catch (error: any) {
        console.error(`[${JOB_NAME}]   Error linking player ${playerId}:`, error.message);
        errors++;
      }
    }

    console.log(`[${JOB_NAME}] Linked ${linked} players to earnings summaries`);
    return { linked, errors };
  } catch (error: any) {
    console.error(`[${JOB_NAME}] Failed:`, error);
    throw error;
  }
}

/**
 * Run all cleanup tasks
 */
export async function runFullCleanup(): Promise<void> {
  console.log(`\n[${JOB_NAME}] ========== STARTING FULL DATA CLEANUP ==========\n`);

  const startTime = Date.now();

  try {
    // 1. Fix tournament metadata
    console.log(`\n[${JOB_NAME}] === Step 1: Tournament Metadata ===\n`);
    const metadataStats = await cleanupTournamentMetadata();

    // 2. Scrape empty tournaments
    console.log(`\n[${JOB_NAME}] === Step 2: Empty Tournament Results ===\n`);
    const resultsStats = await scrapeEmptyTournaments();

    // 3. Link players to earnings
    console.log(`\n[${JOB_NAME}] === Step 3: Player Earnings Links ===\n`);
    const linkStats = await linkPlayersToEarnings();

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    console.log(`\n[${JOB_NAME}] ========== CLEANUP COMPLETE ==========`);
    console.log(`[${JOB_NAME}] Time: ${elapsed}s`);
    console.log(`[${JOB_NAME}] Tournament metadata: ${metadataStats.tournamentsFixed} fixed`);
    console.log(`[${JOB_NAME}] Tournament results: ${resultsStats.tournamentsFixed} scraped`);
    console.log(`[${JOB_NAME}] Player earnings: ${linkStats.linked} linked`);
    console.log(`[${JOB_NAME}] ======================================\n`);
  } catch (error) {
    console.error(`[${JOB_NAME}] Full cleanup failed:`, error);
    throw error;
  }
}

// CLI runner
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  const task = args[0] || 'full';

  console.log(`Running data cleanup task: ${task}\n`);

  let promise: Promise<any>;

  switch (task) {
    case 'metadata':
      promise = cleanupTournamentMetadata();
      break;
    case 'results':
      promise = scrapeEmptyTournaments();
      break;
    case 'earnings':
      promise = linkPlayersToEarnings();
      break;
    case 'full':
    default:
      promise = runFullCleanup();
      break;
  }

  promise
    .then(() => {
      console.log('\nDone!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\nFailed:', error);
      process.exit(1);
    });
}
