#!/usr/bin/env npx tsx

/**
 * Runner script for full player sync
 * Usage: npx tsx run-full-sync.ts [mode]
 * Modes: full (default), quick, player <name>
 */

import { runFullPlayerSync, runQuickEarningsSync, syncSpecificPlayer } from './src/jobs/full-player-sync.js';

const args = process.argv.slice(2);
const mode = args[0] || 'full';

console.log(`\n🚀 Running full-player-sync in ${mode} mode...\n`);

async function main() {
  switch (mode) {
    case 'quick':
      return await runQuickEarningsSync();
    case 'player':
      const playerArg = args[1];
      if (!playerArg) {
        console.error('Usage: npx tsx run-full-sync.ts player <ign or wiki-url>');
        process.exit(1);
      }
      return await syncSpecificPlayer(playerArg);
    case 'full':
    default:
      return await runFullPlayerSync({ skipPlayerDetails: args.includes('--skip-details') });
  }
}

main()
  .then((result) => {
    console.log('\n✅ Done!', result);
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  });
