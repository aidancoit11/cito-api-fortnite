import { prisma } from '../db/client.js';
import * as tournamentService from '../services/scraper/tournament.service.js';
import * as orgService from '../services/scraper/org.service.js';
import { earningsService } from '../services/scraper/earnings.service.js';

/**
 * INCREMENTAL SYNC JOBS
 *
 * These jobs are designed to be FAST by only syncing NEW data.
 * Historical data doesn't change, so we skip it.
 */

const JOB_NAME = 'incremental-sync';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// 1. INCREMENTAL TOURNAMENT SYNC
// Only scrapes tournaments we don't have or that are incomplete
// ============================================================

export async function syncNewTournaments(): Promise<{
  newTournaments: number;
  updatedTournaments: number;
  skipped: number;
  errors: number;
}> {
  console.log(`\n[${JOB_NAME}] ========== SYNCING NEW TOURNAMENTS ==========\n`);
  const startTime = Date.now();

  const stats = {
    newTournaments: 0,
    updatedTournaments: 0,
    skipped: 0,
    errors: 0,
  };

  try {
    // Get all tournaments from Liquipedia portal
    console.log(`[${JOB_NAME}] Fetching tournament list from Liquipedia...`);
    const scrapedTournaments = await tournamentService.scrapeAllTournaments();
    console.log(`[${JOB_NAME}] Found ${scrapedTournaments.length} tournaments on Liquipedia`);

    // Get existing tournament slugs from our DB
    const existingTournaments = await prisma.tournament.findMany({
      select: {
        tournamentId: true,
        name: true,
        isCompleted: true,
        _count: { select: { results: true } },
      },
    });

    const existingMap = new Map(
      existingTournaments.map(t => [t.tournamentId, t])
    );

    console.log(`[${JOB_NAME}] We have ${existingTournaments.length} tournaments in DB`);

    for (const tournament of scrapedTournaments) {
      try {
        const existing = existingMap.get(tournament.slug);

        // Skip if tournament exists, is completed, and has results
        if (existing && existing.isCompleted && existing._count.results > 0) {
          stats.skipped++;
          continue;
        }

        // Need to scrape this tournament
        if (!tournament.wikiUrl) {
          stats.skipped++;
          continue;
        }

        console.log(`[${JOB_NAME}] Scraping: ${tournament.name}`);
        const details = await tournamentService.scrapeTournamentDetails(tournament.wikiUrl);

        if (!details) {
          stats.errors++;
          continue;
        }

        // Upsert tournament
        await prisma.tournament.upsert({
          where: { tournamentId: tournament.slug },
          create: {
            tournamentId: tournament.slug,
            name: details.name || tournament.name,
            startDate: details.startDate,
            endDate: details.endDate,
            prizePool: details.prizePool,
            region: details.region || tournament.region,
            tier: details.tier || tournament.tier,
            format: details.format,
            organizer: details.organizer,
            url: tournament.wikiUrl,
            isCompleted: details.status === 'completed',
          },
          update: {
            name: details.name || tournament.name,
            startDate: details.startDate,
            endDate: details.endDate,
            prizePool: details.prizePool,
            region: details.region || tournament.region,
            tier: details.tier || tournament.tier,
            format: details.format,
            organizer: details.organizer,
            isCompleted: details.status === 'completed',
            lastUpdated: new Date(),
          },
        });

        // Save results if available
        if (details.results && details.results.length > 0) {
          for (const result of details.results) {
            try {
              await prisma.tournamentResult.upsert({
                where: {
                  tournamentId_accountId: {
                    tournamentId: tournament.slug,
                    accountId: result.accountId || `player_${result.rank}`,
                  },
                },
                create: {
                  tournamentId: tournament.slug,
                  accountId: result.accountId || `player_${result.rank}`,
                  displayName: result.playerName,
                  rank: result.rank,
                  points: result.points || 0,
                  earnings: result.earnings,
                },
                update: {
                  displayName: result.playerName,
                  rank: result.rank,
                  points: result.points || 0,
                  earnings: result.earnings,
                },
              });
            } catch {
              // Skip duplicate/error
            }
          }
        }

        if (existing) {
          stats.updatedTournaments++;
        } else {
          stats.newTournaments++;
        }

        await sleep(500); // Rate limit
      } catch (error: any) {
        console.error(`[${JOB_NAME}] Error processing ${tournament.name}: ${error.message}`);
        stats.errors++;
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n[${JOB_NAME}] ========== TOURNAMENT SYNC COMPLETE ==========`);
    console.log(`[${JOB_NAME}] Time: ${elapsed}s`);
    console.log(`[${JOB_NAME}] New: ${stats.newTournaments}, Updated: ${stats.updatedTournaments}, Skipped: ${stats.skipped}, Errors: ${stats.errors}`);

    return stats;
  } catch (error) {
    console.error(`[${JOB_NAME}] Tournament sync failed:`, error);
    throw error;
  }
}

// ============================================================
// 2. INCREMENTAL EARNINGS SYNC
// Only syncs earnings for tournaments AFTER player's last known date
// ============================================================

export async function syncIncrementalEarnings(): Promise<{
  playersChecked: number;
  newEarnings: number;
  errors: number;
}> {
  console.log(`\n[${JOB_NAME}] ========== SYNCING INCREMENTAL EARNINGS ==========\n`);
  const startTime = Date.now();

  const stats = {
    playersChecked: 0,
    newEarnings: 0,
    errors: 0,
  };

  try {
    // Get players with wiki URLs and their last tournament date
    const players = await prisma.player.findMany({
      where: { wikiUrl: { not: null } },
      select: {
        playerId: true,
        currentIgn: true,
        wikiUrl: true,
        earningsSummary: {
          select: { lastTournamentDate: true, tournamentCount: true },
        },
      },
      orderBy: { lastUpdated: 'asc' }, // Oldest first
    });

    console.log(`[${JOB_NAME}] Checking ${players.length} players for new earnings...`);

    for (const player of players) {
      try {
        stats.playersChecked++;

        // Sync earnings (the service will handle incremental logic)
        const count = await earningsService.syncPlayerEarnings(player.playerId);

        if (count > 0) {
          const oldCount = player.earningsSummary?.tournamentCount || 0;
          const newCount = count;
          if (newCount > oldCount) {
            console.log(`[${JOB_NAME}] ${player.currentIgn}: +${newCount - oldCount} new earnings`);
            stats.newEarnings += (newCount - oldCount);
          }
        }

        // Progress update every 100 players
        if (stats.playersChecked % 100 === 0) {
          console.log(`[${JOB_NAME}] Checked ${stats.playersChecked}/${players.length} players...`);
        }

        await sleep(1500); // Rate limit - be nice to Liquipedia
      } catch (error: any) {
        console.error(`[${JOB_NAME}] Error syncing ${player.currentIgn}: ${error.message}`);
        stats.errors++;
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n[${JOB_NAME}] ========== EARNINGS SYNC COMPLETE ==========`);
    console.log(`[${JOB_NAME}] Time: ${elapsed}s (${Math.round(elapsed / 60)}m)`);
    console.log(`[${JOB_NAME}] Players checked: ${stats.playersChecked}, New earnings: ${stats.newEarnings}, Errors: ${stats.errors}`);

    return stats;
  } catch (error) {
    console.error(`[${JOB_NAME}] Earnings sync failed:`, error);
    throw error;
  }
}

// ============================================================
// 3. NEW PLAYER DISCOVERY
// Finds players on Liquipedia that we don't have yet
// ============================================================

export async function discoverNewPlayers(): Promise<{
  discovered: number;
  alreadyExist: number;
  errors: number;
}> {
  console.log(`\n[${JOB_NAME}] ========== DISCOVERING NEW PLAYERS ==========\n`);
  const startTime = Date.now();

  const stats = {
    discovered: 0,
    alreadyExist: 0,
    errors: 0,
  };

  try {
    // Get all player wiki URLs we already have
    const existingPlayers = await prisma.player.findMany({
      where: { wikiUrl: { not: null } },
      select: { wikiUrl: true, currentIgn: true },
    });

    const existingUrls = new Set(existingPlayers.map(p => p.wikiUrl!.toLowerCase()));
    const existingIgns = new Set(existingPlayers.map(p => p.currentIgn.toLowerCase()));

    console.log(`[${JOB_NAME}] We have ${existingPlayers.length} players with wiki URLs`);

    // Scrape player portals for new players
    const playerUrls = [
      'https://liquipedia.net/fortnite/Portal:Players',
      'https://liquipedia.net/fortnite/Portal:Statistics/Player_earnings',
    ];

    const newPlayers: { ign: string; wikiUrl: string }[] = [];

    for (const portalUrl of playerUrls) {
      try {
        console.log(`[${JOB_NAME}] Checking: ${portalUrl}`);
        const players = await tournamentService.scrapePlayersFromPortal?.(portalUrl) || [];

        for (const player of players) {
          if (!player.wikiUrl) continue;

          const urlLower = player.wikiUrl.toLowerCase();
          const ignLower = player.ign.toLowerCase();

          if (!existingUrls.has(urlLower) && !existingIgns.has(ignLower)) {
            newPlayers.push(player);
            existingUrls.add(urlLower);
            existingIgns.add(ignLower);
          }
        }

        await sleep(500);
      } catch (error: any) {
        console.log(`[${JOB_NAME}] Error scraping ${portalUrl}: ${error.message}`);
      }
    }

    console.log(`[${JOB_NAME}] Found ${newPlayers.length} potentially new players`);

    // Create new player records
    for (const player of newPlayers) {
      try {
        const existing = await prisma.player.findFirst({
          where: {
            OR: [
              { wikiUrl: player.wikiUrl },
              { currentIgn: { equals: player.ign, mode: 'insensitive' } },
            ],
          },
        });

        if (existing) {
          stats.alreadyExist++;
          continue;
        }

        await prisma.player.create({
          data: {
            playerId: crypto.randomUUID(),
            currentIgn: player.ign,
            wikiUrl: player.wikiUrl,
          },
        });

        console.log(`[${JOB_NAME}] Discovered: ${player.ign}`);
        stats.discovered++;
      } catch (error: any) {
        stats.errors++;
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n[${JOB_NAME}] ========== PLAYER DISCOVERY COMPLETE ==========`);
    console.log(`[${JOB_NAME}] Time: ${elapsed}s`);
    console.log(`[${JOB_NAME}] New players: ${stats.discovered}, Already exist: ${stats.alreadyExist}, Errors: ${stats.errors}`);

    return stats;
  } catch (error) {
    console.error(`[${JOB_NAME}] Player discovery failed:`, error);
    throw error;
  }
}

// ============================================================
// 4. ROSTER/TRANSFER UPDATE
// Updates current team affiliations only
// ============================================================

export async function updateRosters(): Promise<{
  orgsChecked: number;
  rostersUpdated: number;
  transfersDetected: number;
  errors: number;
}> {
  console.log(`\n[${JOB_NAME}] ========== UPDATING ROSTERS ==========\n`);
  const startTime = Date.now();

  const stats = {
    orgsChecked: 0,
    rostersUpdated: 0,
    transfersDetected: 0,
    errors: 0,
  };

  try {
    // Get all orgs with wiki URLs
    const orgs = await prisma.organization.findMany({
      where: { wikiUrl: { not: null } },
      select: { slug: true, name: true, wikiUrl: true },
    });

    console.log(`[${JOB_NAME}] Checking rosters for ${orgs.length} organizations...`);

    for (const org of orgs) {
      try {
        stats.orgsChecked++;

        if (!org.wikiUrl) continue;

        // Get current roster from DB
        const currentRoster = await prisma.teamRoster.findMany({
          where: { orgSlug: org.slug, isActive: true },
          select: { playerId: true, playerName: true },
        });

        const currentPlayerIds = new Set(currentRoster.map(r => r.playerId).filter(Boolean));

        // Scrape current roster from wiki
        const scrapedRoster = await orgService.scrapeOrgRoster?.(org.wikiUrl);

        if (!scrapedRoster || scrapedRoster.length === 0) {
          continue;
        }

        // Check for changes
        for (const scraped of scrapedRoster) {
          const isNew = !currentRoster.some(
            r => r.playerName.toLowerCase() === scraped.name.toLowerCase()
          );

          if (isNew) {
            stats.transfersDetected++;
            console.log(`[${JOB_NAME}] New on ${org.name}: ${scraped.name}`);
          }
        }

        // Sync the roster
        await orgService.syncRosterToDatabase?.(org.slug, scrapedRoster, true);
        stats.rostersUpdated++;

        await sleep(500);
      } catch (error: any) {
        stats.errors++;
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n[${JOB_NAME}] ========== ROSTER UPDATE COMPLETE ==========`);
    console.log(`[${JOB_NAME}] Time: ${elapsed}s`);
    console.log(`[${JOB_NAME}] Orgs: ${stats.orgsChecked}, Updated: ${stats.rostersUpdated}, Transfers: ${stats.transfersDetected}, Errors: ${stats.errors}`);

    return stats;
  } catch (error) {
    console.error(`[${JOB_NAME}] Roster update failed:`, error);
    throw error;
  }
}

// ============================================================
// 5. EPIC EVENTS CHECK
// Checks Epic Games API for live/upcoming events
// ============================================================

export async function checkEpicEvents(): Promise<{
  eventsFound: number;
  liveEvents: number;
  upcomingEvents: number;
}> {
  console.log(`\n[${JOB_NAME}] ========== CHECKING EPIC EVENTS ==========\n`);

  const stats = {
    eventsFound: 0,
    liveEvents: 0,
    upcomingEvents: 0,
  };

  try {
    // Import the events service dynamically to avoid circular deps
    const { getActiveEvents } = await import('../services/epic/events.service.js');

    const events = await getActiveEvents();
    stats.eventsFound = events.length;

    const now = new Date();

    for (const event of events) {
      if (event.windows && event.windows.length > 0) {
        for (const window of event.windows) {
          const start = new Date(window.beginTime);
          const end = new Date(window.endTime);

          if (start <= now && end >= now) {
            stats.liveEvents++;
            console.log(`[${JOB_NAME}] LIVE: ${event.displayDataId || event.eventId}`);
          } else if (start > now) {
            stats.upcomingEvents++;
          }
        }
      }
    }

    console.log(`\n[${JOB_NAME}] ========== EPIC EVENTS CHECK COMPLETE ==========`);
    console.log(`[${JOB_NAME}] Total: ${stats.eventsFound}, Live: ${stats.liveEvents}, Upcoming: ${stats.upcomingEvents}`);

    return stats;
  } catch (error) {
    console.error(`[${JOB_NAME}] Epic events check failed:`, error);
    throw error;
  }
}

// ============================================================
// CLI RUNNER
// ============================================================

const commands: Record<string, () => Promise<any>> = {
  tournaments: syncNewTournaments,
  earnings: syncIncrementalEarnings,
  players: discoverNewPlayers,
  rosters: updateRosters,
  epic: checkEpicEvents,
  all: async () => {
    console.log('\n🚀 Running ALL incremental syncs...\n');
    await syncNewTournaments();
    await discoverNewPlayers();
    await updateRosters();
    await syncIncrementalEarnings();
    await checkEpicEvents();
    console.log('\n✅ All syncs complete!\n');
  },
};

// Check if running directly
const args = process.argv.slice(2);
const command = args[0] || 'all';

if (commands[command]) {
  console.log(`\n🚀 Running: ${command}\n`);
  commands[command]()
    .then(() => {
      console.log('\n✅ Done!\n');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Failed:', error);
      process.exit(1);
    });
} else {
  console.log('Available commands: tournaments, earnings, players, rosters, epic, all');
  process.exit(1);
}
