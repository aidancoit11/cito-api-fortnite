import { prisma } from '../db/client.js';
import { lolEsportsApiService } from '../services/lol/lol-esports-api.service.js';

/**
 * LoL Schedule/Upcoming Matches Sync Job
 * Syncs upcoming and recent matches from LoL Esports API
 * Run every 30 minutes
 */

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runLolScheduleSync(): Promise<{
  matchesSynced: number;
  teamsCreated: number;
  errors: number;
}> {
  console.log('═══════════════════════════════════════════════');
  console.log('📅 Starting LoL Schedule Sync');
  console.log('═══════════════════════════════════════════════');

  const startTime = Date.now();
  let matchesSynced = 0;
  let teamsCreated = 0;
  let errors = 0;

  try {
    // Get all active leagues
    const leagues = await prisma.lolLeague.findMany({
      where: { isActive: true },
      orderBy: { priority: 'asc' },
    });

    console.log(`[LolScheduleSync] Processing ${leagues.length} leagues...`);

    for (const league of leagues) {
      if (!league.esportsApiId) continue;

      try {
        console.log(`[LolScheduleSync] Fetching schedule for ${league.name}...`);
        const schedule = await lolEsportsApiService.getSchedule(league.esportsApiId);

        for (const event of schedule.events) {
          if (!event.match) continue;

          const match = event.match;
          const team1 = match.teams[0];
          const team2 = match.teams[1];

          if (!team1 || !team2) continue;

          // Generate slugs
          const team1Slug = team1.slug || team1.code?.toLowerCase() || team1.name?.toLowerCase().replace(/\s+/g, '-');
          const team2Slug = team2.slug || team2.code?.toLowerCase() || team2.name?.toLowerCase().replace(/\s+/g, '-');

          if (!team1Slug || !team2Slug) continue;

          // Ensure teams exist
          for (const [team, slug] of [[team1, team1Slug], [team2, team2Slug]] as const) {
            const existing = await prisma.lolOrganization.findUnique({
              where: { slug },
            });

            if (!existing) {
              await prisma.lolOrganization.create({
                data: {
                  slug,
                  esportsApiId: team.id,
                  name: team.name,
                  shortName: team.code,
                  logoUrl: team.image,
                  region: league.region,
                  isActive: true,
                },
              });
              teamsCreated++;
            }
          }

          // Find tournament
          const tournament = await prisma.lolTournament.findFirst({
            where: { leagueId: league.leagueId },
            orderBy: { startDate: 'desc' },
          });

          if (!tournament) continue;

          // Determine winner
          const winnerSlug = team1.result?.outcome === 'win' ? team1Slug :
                            team2.result?.outcome === 'win' ? team2Slug : null;

          // Upsert match
          await prisma.lolMatch.upsert({
            where: { esportsApiId: match.id },
            create: {
              matchId: `lol-match-${match.id}`,
              esportsApiId: match.id,
              tournamentId: tournament.tournamentId,
              blockName: event.blockName,
              team1Slug,
              team2Slug,
              team1Score: team1.result?.gameWins ?? null,
              team2Score: team2.result?.gameWins ?? null,
              winnerSlug,
              strategy: match.strategy ? `Bo${match.strategy.count}` : null,
              startTime: event.startTime ? new Date(event.startTime) : null,
              state: event.state,
            },
            update: {
              team1Score: team1.result?.gameWins ?? null,
              team2Score: team2.result?.gameWins ?? null,
              winnerSlug,
              state: event.state,
              lastUpdated: new Date(),
            },
          });
          matchesSynced++;
        }

        await delay(300);
      } catch (error: any) {
        console.error(`[LolScheduleSync] Error for ${league.name}:`, error.message);
        errors++;
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // Get upcoming match count
    const upcomingCount = await prisma.lolMatch.count({
      where: {
        state: { in: ['unstarted', 'inProgress'] },
        startTime: { gte: new Date() },
      },
    });

    console.log('═══════════════════════════════════════════════');
    console.log('✅ LoL Schedule Sync Complete');
    console.log(`   Matches Synced: ${matchesSynced}`);
    console.log(`   Teams Created: ${teamsCreated}`);
    console.log(`   Errors: ${errors}`);
    console.log(`   Upcoming Matches: ${upcomingCount}`);
    console.log(`   Duration: ${duration}s`);
    console.log('═══════════════════════════════════════════════');

    // Show upcoming matches
    const upcoming = await prisma.lolMatch.findMany({
      where: {
        state: { in: ['unstarted', 'inProgress'] },
        startTime: { gte: new Date() },
      },
      include: {
        team1: { select: { name: true, shortName: true } },
        team2: { select: { name: true, shortName: true } },
        tournament: { select: { name: true, league: { select: { name: true } } } },
      },
      orderBy: { startTime: 'asc' },
      take: 10,
    });

    if (upcoming.length > 0) {
      console.log('\n📅 UPCOMING MATCHES:');
      console.log('─────────────────────────────────────────');
      for (const match of upcoming) {
        const time = match.startTime ? match.startTime.toISOString().slice(0, 16) : 'TBD';
        const team1 = match.team1?.shortName || match.team1Slug;
        const team2 = match.team2?.shortName || match.team2Slug;
        const league = match.tournament?.league?.name || 'Unknown';
        console.log(`  ${time} | ${league.padEnd(10)} | ${team1} vs ${team2}`);
      }
    }

    return { matchesSynced, teamsCreated, errors };
  } catch (error) {
    console.error('❌ LoL Schedule Sync Failed:', error);
    throw error;
  }
}

// Run if called directly
const isMainModule = require.main === module;
if (isMainModule) {
  runLolScheduleSync()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
