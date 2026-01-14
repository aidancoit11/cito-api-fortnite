import { prisma } from '../db/client.js';
import { lolTransferService } from '../services/lol/lol-transfer.service.js';

/**
 * LoL Transfer Sync Job
 * Syncs latest player transfers from Liquipedia
 * Run daily at 6 AM UTC
 */

export async function runLolTransferSync(): Promise<{
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}> {
  console.log('═══════════════════════════════════════════════');
  console.log('🔄 Starting LoL Transfer Sync');
  console.log('═══════════════════════════════════════════════');

  const startTime = Date.now();

  try {
    // Sync transfers from Liquipedia
    console.log('[LolTransferSync] Syncing transfers...');
    const result = await lolTransferService.syncTransfers();

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalTransfers = await prisma.lolTransfer.count();

    console.log('═══════════════════════════════════════════════');
    console.log('✅ LoL Transfer Sync Complete');
    console.log(`   Created: ${result.created}`);
    console.log(`   Updated: ${result.updated}`);
    console.log(`   Skipped: ${result.skipped}`);
    console.log(`   Errors: ${result.errors.length}`);
    console.log(`   Total Transfers: ${totalTransfers}`);
    console.log(`   Duration: ${duration}s`);
    console.log('═══════════════════════════════════════════════');

    // Show recent transfers
    const recentTransfers = await lolTransferService.getRecentTransfers({ limit: 5 });
    if (recentTransfers.length > 0) {
      console.log('\n📋 RECENT TRANSFERS:');
      console.log('─────────────────────────────────────────');
      for (const transfer of recentTransfers) {
        const from = transfer.fromOrg?.name || 'Free Agent';
        const to = transfer.toOrg?.name || 'Free Agent';
        console.log(`  ${transfer.player?.currentIgn || 'Unknown'}: ${from} → ${to}`);
      }
    }

    return {
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors.length,
    };
  } catch (error) {
    console.error('❌ LoL Transfer Sync Failed:', error);
    throw error;
  }
}

// Run if called directly
const isMainModule = require.main === module;
if (isMainModule) {
  runLolTransferSync()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
