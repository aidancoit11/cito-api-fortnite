import { prisma } from './src/db/client.js';

async function check() {
  const playerName = process.argv[2] || 'peterbot';

  const player = await prisma.player.findFirst({
    where: { currentIgn: { equals: playerName, mode: 'insensitive' } },
    include: { earningsSummary: true }
  });

  if (player) {
    console.log('\n=== Player:', player.currentIgn, '===');
    console.log('Wiki URL:', player.wikiUrl || 'NOT SET');
    if (player.earningsSummary) {
      console.log('Total Earnings: $' + Number(player.earningsSummary.totalEarnings).toLocaleString());
      console.log('Tournament Count:', player.earningsSummary.tournamentCount);
      console.log('First Places:', player.earningsSummary.firstPlaceCount);
      console.log('Top 10s:', player.earningsSummary.top10Count);
    } else {
      console.log('No earnings summary yet');
    }

    const earningsCount = await prisma.playerTournamentEarning.count({
      where: { playerId: player.playerId }
    });
    console.log('Earnings records:', earningsCount);
  } else {
    console.log('Player not found:', playerName);
  }

  await prisma.$disconnect();
}

check();
