import { prisma } from './src/db/client.js';

async function check() {
  console.log('\n=== TOP 20 EARNERS ===\n');

  const topEarners = await prisma.playerEarningsSummary.findMany({
    orderBy: { totalEarnings: 'desc' },
    take: 20,
    include: {
      player: {
        select: { currentIgn: true, wikiUrl: true }
      }
    }
  });

  for (let i = 0; i < topEarners.length; i++) {
    const e = topEarners[i];
    console.log(`${i + 1}. ${e.player.currentIgn}: $${Number(e.totalEarnings).toLocaleString()} (${e.tournamentCount} tournaments, ${e.firstPlaceCount} wins)`);
  }

  console.log('\n=== PLAYERS WITH WIKI URLs ===');
  const withWiki = await prisma.player.count({ where: { wikiUrl: { not: null } } });
  const total = await prisma.player.count();
  console.log(`${withWiki} / ${total} players have wiki URLs`);

  console.log('\n=== EARNINGS RECORDS ===');
  const earningsCount = await prisma.playerTournamentEarning.count();
  console.log(`Total earnings records: ${earningsCount.toLocaleString()}`);

  await prisma.$disconnect();
}

check();
