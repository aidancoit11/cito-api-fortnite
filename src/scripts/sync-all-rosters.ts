/**
 * Sync complete rosters for ALL organizations from Liquipedia
 * Includes: player details (birthDate, country, etc.) + earnings
 * This WILL take a long time (several hours for 600+ orgs)
 */

import { prisma } from '../db/client.js';
import { orgService } from '../services/scraper/org.service.js';
import { playerService } from '../services/player.service.js';

async function syncAllRosters() {
  console.log('Starting FULL roster sync for all organizations...\n');
  console.log('This includes player details + earnings - will take several hours.\n');

  // Get all org slugs
  const orgs = await prisma.organization.findMany({
    select: { slug: true, name: true },
    orderBy: { name: 'asc' },
  });

  console.log(`Found ${orgs.length} organizations to sync\n`);

  let synced = 0;
  let failed = 0;
  let totalPlayers = 0;
  let playersWithEarnings = 0;

  for (let i = 0; i < orgs.length; i++) {
    const org = orgs[i];
    const progress = `[${i + 1}/${orgs.length}]`;

    try {
      // Full sync with player details (no skipPlayerDetails)
      const count = await orgService.syncRosterToDatabase(org.slug);
      if (count > 0) {
        console.log(`${progress} ✓ ${org.name}: ${count} players (syncing earnings...)`);
        totalPlayers += count;
        synced++;

        // Get the roster players and sync their earnings
        const roster = await prisma.teamRoster.findMany({
          where: { orgSlug: org.slug },
          include: { player: true },
        });

        for (const member of roster) {
          if (member.player?.wikiUrl) {
            try {
              await playerService.syncPlayerEarnings(member.player.playerId);
              playersWithEarnings++;
            } catch {
              // Ignore earnings errors, continue
            }
          }
        }
      } else {
        console.log(`${progress} - ${org.name}: no roster data`);
      }
    } catch (error: any) {
      console.log(`${progress} ✗ ${org.name}: ${error.message}`);
      failed++;
    }

    // Rate limiting delay
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n========== SYNC COMPLETE ==========');
  console.log(`Organizations with rosters: ${synced}`);
  console.log(`Failed/No data: ${orgs.length - synced}`);
  console.log(`Total players synced: ${totalPlayers}`);
  console.log(`Players with earnings: ${playersWithEarnings}`);
  console.log('====================================\n');

  await prisma.$disconnect();
}

syncAllRosters().catch(console.error);
