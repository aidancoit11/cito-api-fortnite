import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ log: [] });

async function main() {
  const [leagues, tournaments, orgs, players, matches, champions, transfers] = await Promise.all([
    prisma.lolLeague.count(),
    prisma.lolTournament.count(),
    prisma.lolOrganization.count(),
    prisma.lolPlayer.count(),
    prisma.lolMatch.count(),
    prisma.lolChampion.count(),
    prisma.lolTransfer.count(),
  ]);
  
  console.log('═══════════════════════════════════════');
  console.log('📊 LOL DATABASE COUNTS');
  console.log('═══════════════════════════════════════');
  console.log(`Leagues:     ${leagues}`);
  console.log(`Tournaments: ${tournaments} (target: 3,546)`);
  console.log(`Teams/Orgs:  ${orgs} (target: 1,297)`);
  console.log(`Players:     ${players} (target: 5,514)`);
  console.log(`Matches:     ${matches}`);
  console.log(`Champions:   ${champions} (target: 172)`);
  console.log(`Transfers:   ${transfers} (target: 100+)`);
  console.log('═══════════════════════════════════════');
  
  await prisma.$disconnect();
}

main();
