import { prisma } from '../db/client.js';
import { lolEarningsService } from '../services/lol/lol-earnings.service.js';

/**
 * LoL Earnings Sync Job
 * Syncs player earnings from Liquipedia
 * Run daily at 5 AM UTC
 */

export async function runLolEarningsSync() {
  console.log('═══════════════════════════════════════════════');
  console.log('💰 Starting LoL Earnings Sync');
  console.log('═══════════════════════════════════════════════');

  const startTime = Date.now();

  try {
    // Get all players with wiki URLs
    const players = await prisma.lolPlayer.findMany({
      where: { wikiUrl: { not: null } },
      orderBy: { lastUpdated: 'asc' },
    });

    console.log(`📊 Found ${players.length} players with wiki URLs\n`);

    let playersProcessed = 0;
    let totalTournaments = 0;
    let errors = 0;

    for (const player of players) {
      try {
        console.log(`Processing: ${player.currentIgn}...`);
        const synced = await lolEarningsService.syncLolPlayerEarnings(player.lolPlayerId);

        if (synced > 0) {
          totalTournaments += synced;
          playersProcessed++;
          console.log(`  ✅ ${synced} tournaments synced`);
        } else {
          console.log(`  ⚠️  No tournaments found`);
        }

        // Rate limiting - 2 second delay between players
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error: any) {
        errors++;
        console.error(`  ❌ Failed: ${error.message}`);
      }
    }

    // Update org summaries
    console.log('\n📈 Updating org earnings summaries...');
    const orgs = await prisma.lolOrganization.findMany({
      where: { isActive: true },
    });

    for (const org of orgs) {
      try {
        await lolEarningsService.updateLolOrgEarningsSummary(org.slug);
        console.log(`  ✅ ${org.name}`);
      } catch (error: any) {
        console.error(`  ❌ ${org.name}: ${error.message}`);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('═══════════════════════════════════════════════');
    console.log('✅ LoL Earnings Sync Complete');
    console.log(`   Players processed: ${playersProcessed}`);
    console.log(`   Total tournaments: ${totalTournaments}`);
    console.log(`   Errors: ${errors}`);
    console.log(`   Duration: ${duration}s`);
    console.log('═══════════════════════════════════════════════');

    // Show top earners
    const topEarners = await prisma.lolPlayerEarningsSummary.findMany({
      orderBy: { totalEarnings: 'desc' },
      take: 10,
      include: { player: true },
    });

    console.log('\n🏆 TOP 10 LOL EARNERS:');
    console.log('─────────────────────────────────────────');
    for (const e of topEarners) {
      const earnings = Number(e.totalEarnings).toLocaleString();
      const name = e.player.currentIgn.padEnd(15);
      const tournaments = String(e.tournamentCount).padStart(4);
      const firstPlaces = String(e.firstPlaceCount).padStart(3);
      console.log(`${name} | $${earnings.padStart(12)} | ${tournaments} tournaments | ${firstPlaces} 1st places`);
    }

    return { playersProcessed, totalTournaments, errors };
  } catch (error) {
    console.error('❌ LoL Earnings Sync Failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
const isMainModule = require.main === module;
if (isMainModule) {
  runLolEarningsSync()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
