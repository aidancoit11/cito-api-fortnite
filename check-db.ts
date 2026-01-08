import { prisma } from './src/db/client.js';

async function checkData() {
  const [tournaments, results, orgs, players, rosters, earnings, transfers] = await Promise.all([
    prisma.tournament.count(),
    prisma.tournamentResult.count(),
    prisma.organization.count(),
    prisma.player.count(),
    prisma.teamRoster.count(),
    prisma.playerTournamentEarning.count(),
    prisma.transfer.count(),
  ]);

  console.log('=== DATABASE STATUS ===');
  console.log('Tournaments:', tournaments);
  console.log('Tournament Results:', results);
  console.log('Organizations:', orgs);
  console.log('Players:', players);
  console.log('Team Rosters:', rosters);
  console.log('Player Earnings:', earnings);
  console.log('Transfers:', transfers);

  // Check upcoming tournaments
  const upcoming = await prisma.tournament.count({
    where: { startDate: { gt: new Date() } }
  });
  console.log('\nUpcoming Tournaments:', upcoming);

  // Check completed tournaments
  const completed = await prisma.tournament.count({
    where: { isCompleted: true }
  });
  console.log('Completed Tournaments:', completed);

  // Sample recent tournament with results
  const sampleTournament = await prisma.tournament.findFirst({
    include: { results: { take: 5 } },
    orderBy: { startDate: 'desc' }
  });
  console.log('\n=== SAMPLE TOURNAMENT ===');
  console.log('Name:', sampleTournament?.name);
  console.log('Date:', sampleTournament?.startDate);
  console.log('Region:', sampleTournament?.region);
  console.log('Prize Pool:', sampleTournament?.prizePool);
  console.log('Results:', sampleTournament?.results?.length || 0);
  if (sampleTournament?.results?.[0]) {
    console.log('Top result:', sampleTournament.results[0].displayName, '- Rank', sampleTournament.results[0].rank);
  }

  // Check orgs with rosters
  const orgsWithRosters = await prisma.organization.count({
    where: { roster: { some: {} } }
  });
  console.log('\n=== ORG DATA ===');
  console.log('Orgs with rosters:', orgsWithRosters);

  // Sample org
  const sampleOrg = await prisma.organization.findFirst({
    where: { roster: { some: { isActive: true } } },
    include: { roster: { where: { isActive: true }, take: 3 } }
  });
  console.log('Sample Org:', sampleOrg?.name);
  console.log('Active roster:', sampleOrg?.roster?.map(r => r.playerName).join(', '));

  // Players with earnings
  const playersWithEarnings = await prisma.player.count({
    where: { tournamentEarnings: { some: {} } }
  });
  console.log('\n=== PLAYER DATA ===');
  console.log('Players with earnings:', playersWithEarnings);

  await prisma.$disconnect();
}

checkData().catch(console.error);
