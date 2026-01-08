import { prisma } from './src/db/client.js';

async function stats() {
  console.log('\n=== COMPLETE DATABASE STATUS ===\n');

  const players = await prisma.player.count();
  const playersWithWiki = await prisma.player.count({ where: { wikiUrl: { not: null } } });
  const playerSummaries = await prisma.playerEarningsSummary.count();
  const tournaments = await prisma.tournament.count();
  const tourneysWithResults = await prisma.tournament.count({ where: { results: { some: {} } } });
  const results = await prisma.tournamentResult.count();
  const earnings = await prisma.playerTournamentEarning.count();
  const orgs = await prisma.organization.count();
  const roster = await prisma.teamRoster.count();
  const transfers = await prisma.playerTransfer.count();
  const matches = await prisma.matchResult.count();
  const oauth = await prisma.oAuthToken.count();
  const deviceAuth = await prisma.deviceAuthCredential.count();

  console.log('Players:', players.toLocaleString());
  console.log('Players with Wiki URL:', playersWithWiki.toLocaleString());
  console.log('Players with Earnings Summary:', playerSummaries.toLocaleString());
  console.log('Tournaments:', tournaments.toLocaleString());
  console.log('Tournaments with Results:', tourneysWithResults.toLocaleString());
  console.log('Tournament Results (placements):', results.toLocaleString());
  console.log('Player Tournament Earnings:', earnings.toLocaleString());
  console.log('Organizations:', orgs.toLocaleString());
  console.log('Roster Entries:', roster.toLocaleString());
  console.log('Player Transfers:', transfers.toLocaleString());
  console.log('Match Results:', matches.toLocaleString());
  console.log('OAuth Tokens:', oauth.toLocaleString());
  console.log('Device Auth Credentials:', deviceAuth.toLocaleString());

  console.log('\n=== DATA GAPS ===');
  const playersNoEarnings = await prisma.player.count({
    where: { earningsSummary: null }
  });
  console.log('Players WITHOUT earnings summary:', playersNoEarnings.toLocaleString());

  const orgsNoRoster = await prisma.organization.count({
    where: { roster: { none: {} } }
  });
  console.log('Orgs WITHOUT roster:', orgsNoRoster);

  await prisma.$disconnect();
}
stats();
