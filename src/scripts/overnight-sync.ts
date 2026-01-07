/**
 * Overnight Sync Script
 * Runs a complete sync of all orgs, rosters, and transfers
 * Designed to run on a DigitalOcean droplet overnight
 *
 * Usage:
 *   npx tsx src/scripts/overnight-sync.ts
 *
 * With proxies:
 *   PROXY_LIST="host:port:user:pass,..." npx tsx src/scripts/overnight-sync.ts
 */

import { prisma } from '../db/client.js';
import { orgService } from '../services/scraper/org.service.js';
import { playerService } from '../services/player.service.js';
import { proxyManager } from '../services/scraper/proxy-manager.js';

// Progress logging
const startTime = Date.now();
let totalOrgs = 0;
let syncedOrgs = 0;
let totalPlayers = 0;
let totalTransfers = 0;
let errors: string[] = [];

function log(message: string) {
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const hours = Math.floor(elapsed / 3600);
  const mins = Math.floor((elapsed % 3600) / 60);
  const secs = elapsed % 60;
  const timestamp = `[${hours}h ${mins}m ${secs}s]`;
  console.log(`${timestamp} ${message}`);
}

function logProgress() {
  const proxyStats = proxyManager.getStats();
  log(`Progress: ${syncedOrgs}/${totalOrgs} orgs | ${totalPlayers} players | Proxies: ${proxyStats.healthy}/${proxyStats.total} healthy`);
}

async function syncAllOrgs() {
  log('=== PHASE 1: Syncing Organization List ===');

  try {
    const synced = await orgService.syncOrgsToDatabase();
    log(`✓ Synced ${synced} organizations to database`);
  } catch (error: any) {
    log(`✗ Failed to sync org list: ${error.message}`);
    errors.push(`Org list sync: ${error.message}`);
  }
}

async function syncOrgDetails() {
  log('=== PHASE 2: Syncing Organization Details (logos, descriptions) ===');

  try {
    const result = await orgService.syncAllOrgsWithDetails();
    log(`✓ Synced details for ${result.synced} orgs (${result.logos} with logos)`);
  } catch (error: any) {
    log(`✗ Failed to sync org details: ${error.message}`);
    errors.push(`Org details sync: ${error.message}`);
  }
}

async function syncAllRosters() {
  log('=== PHASE 3: Syncing All Rosters + Player Details ===');

  const orgs = await prisma.organization.findMany({
    select: { slug: true, name: true },
    orderBy: { name: 'asc' },
  });

  totalOrgs = orgs.length;
  log(`Found ${totalOrgs} organizations to sync`);

  for (let i = 0; i < orgs.length; i++) {
    const org = orgs[i];
    syncedOrgs = i + 1;

    try {
      const count = await orgService.syncRosterToDatabase(org.slug);
      if (count > 0) {
        totalPlayers += count;
        log(`✓ [${i + 1}/${totalOrgs}] ${org.name}: ${count} players`);
      }

      // Log progress every 50 orgs
      if ((i + 1) % 50 === 0) {
        logProgress();
      }
    } catch (error: any) {
      log(`✗ [${i + 1}/${totalOrgs}] ${org.name}: ${error.message}`);
      errors.push(`${org.name}: ${error.message}`);
    }
  }
}

async function syncRecentTransfers() {
  log('=== PHASE 4: Syncing Recent Transfers ===');

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];

  // Sync current month and previous 3 months
  const now = new Date();

  for (let i = 0; i < 4; i++) {
    const date = new Date(now);
    date.setMonth(date.getMonth() - i);
    const year = date.getFullYear();
    const month = monthNames[date.getMonth()];

    try {
      log(`Syncing transfers for ${month} ${year}...`);
      const synced = await orgService.syncTransfers({ year, month, limit: 500 });
      totalTransfers += synced;
      log(`✓ ${month} ${year}: ${synced} transfers`);
    } catch (error: any) {
      log(`✗ ${month} ${year}: ${error.message}`);
      errors.push(`Transfers ${month} ${year}: ${error.message}`);
    }
  }
}

async function syncPlayerEarnings() {
  log('=== PHASE 5: Syncing Player Earnings ===');

  // Get all players with wiki URLs (those we can scrape earnings for)
  const players = await prisma.player.findMany({
    where: { wikiUrl: { not: null } },
    select: { playerId: true, currentIgn: true, wikiUrl: true },
  });

  log(`Found ${players.length} players with wiki URLs to sync earnings`);

  let syncedEarnings = 0;
  for (let i = 0; i < players.length; i++) {
    const player = players[i];

    try {
      await playerService.syncPlayerEarnings(player.playerId);
      syncedEarnings++;

      // Log progress every 100 players
      if ((i + 1) % 100 === 0) {
        log(`Earnings progress: ${i + 1}/${players.length} players`);
      }
    } catch {
      // Silently continue on earnings errors
    }
  }

  log(`✓ Synced earnings for ${syncedEarnings} players`);
}

async function main() {
  log('===========================================');
  log('   OVERNIGHT SYNC - FORTNITE ESPORTS API   ');
  log('===========================================');

  // Show proxy status
  const proxyStats = proxyManager.getStats();
  log(`Proxies loaded: ${proxyStats.total} (${proxyStats.healthy} healthy)`);

  try {
    // Phase 1: Org list
    await syncAllOrgs();

    // Phase 2: Org details
    await syncOrgDetails();

    // Phase 3: Rosters (this is the long one)
    await syncAllRosters();

    // Phase 4: Transfers
    await syncRecentTransfers();

    // Phase 5: Player earnings (optional - very long)
    // Uncomment if you want full earnings sync:
    // await syncPlayerEarnings();

  } catch (error: any) {
    log(`FATAL ERROR: ${error.message}`);
    errors.push(`Fatal: ${error.message}`);
  }

  // Final summary
  const totalTime = Math.round((Date.now() - startTime) / 1000);
  const hours = Math.floor(totalTime / 3600);
  const mins = Math.floor((totalTime % 3600) / 60);

  log('');
  log('===========================================');
  log('              SYNC COMPLETE                ');
  log('===========================================');
  log(`Total time: ${hours}h ${mins}m`);
  log(`Organizations: ${totalOrgs}`);
  log(`Players synced: ${totalPlayers}`);
  log(`Transfers synced: ${totalTransfers}`);
  log(`Errors: ${errors.length}`);

  if (errors.length > 0) {
    log('');
    log('Errors encountered:');
    errors.slice(0, 20).forEach(e => log(`  - ${e}`));
    if (errors.length > 20) {
      log(`  ... and ${errors.length - 20} more`);
    }
  }

  await prisma.$disconnect();
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch(console.error);
