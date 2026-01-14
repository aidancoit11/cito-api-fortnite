import { prisma } from '../db/client.js';
import axios from 'axios';

/**
 * LoL Champion Sync Job
 * Syncs champion data from Riot Data Dragon API
 * Run weekly on Sunday at 1 AM UTC
 */

const DATA_DRAGON_BASE = 'https://ddragon.leagueoflegends.com';

interface DataDragonChampion {
  id: string;
  key: string;
  name: string;
  title: string;
  blurb: string;
  info: {
    attack: number;
    defense: number;
    magic: number;
    difficulty: number;
  };
  image: {
    full: string;
    sprite: string;
    group: string;
    x: number;
    y: number;
    w: number;
    h: number;
  };
  tags: string[];
  partype: string;
  stats: Record<string, number>;
}

interface DataDragonResponse {
  type: string;
  format: string;
  version: string;
  data: Record<string, DataDragonChampion>;
}

async function getLatestVersion(): Promise<string> {
  try {
    const response = await axios.get<string[]>(`${DATA_DRAGON_BASE}/api/versions.json`);
    return response.data[0] || '14.1.1';
  } catch (error) {
    console.error('[LolChampionSync] Error fetching version:', error);
    return '14.1.1';
  }
}

async function fetchChampions(version: string): Promise<DataDragonChampion[]> {
  try {
    const response = await axios.get<DataDragonResponse>(
      `${DATA_DRAGON_BASE}/cdn/${version}/data/en_US/champion.json`
    );
    return Object.values(response.data.data);
  } catch (error) {
    console.error('[LolChampionSync] Error fetching champions:', error);
    return [];
  }
}

// Map tags to role - kept for potential future use
function _mapRole(tags: string[]): string {
  if (tags.includes('Assassin')) return 'Assassin';
  if (tags.includes('Fighter')) return 'Fighter';
  if (tags.includes('Mage')) return 'Mage';
  if (tags.includes('Marksman')) return 'Marksman';
  if (tags.includes('Support')) return 'Support';
  if (tags.includes('Tank')) return 'Tank';
  return tags[0] || 'Unknown';
}
void _mapRole; // Suppress unused warning

export async function runLolChampionSync(): Promise<{
  synced: number;
  version: string;
}> {
  console.log('═══════════════════════════════════════════════');
  console.log('🏆 Starting LoL Champion Sync');
  console.log('═══════════════════════════════════════════════');

  const startTime = Date.now();

  try {
    // Get latest version
    const version = await getLatestVersion();
    console.log(`[LolChampionSync] Using Data Dragon version: ${version}`);

    // Fetch all champions
    const champions = await fetchChampions(version);
    console.log(`[LolChampionSync] Found ${champions.length} champions`);

    let synced = 0;

    for (const champion of champions) {
      try {
        const championId = parseInt(champion.key, 10);

        await prisma.lolChampion.upsert({
          where: { championId },
          create: {
            championId,
            name: champion.name,
            key: champion.id,
            title: champion.title,
            roles: champion.tags,
            imageUrl: `${DATA_DRAGON_BASE}/cdn/${version}/img/champion/${champion.image.full}`,
            splashUrl: `${DATA_DRAGON_BASE}/cdn/img/champion/splash/${champion.id}_0.jpg`,
            data: {
              info: champion.info,
              stats: champion.stats,
              partype: champion.partype,
              blurb: champion.blurb,
              version,
            },
          },
          update: {
            name: champion.name,
            title: champion.title,
            roles: champion.tags,
            imageUrl: `${DATA_DRAGON_BASE}/cdn/${version}/img/champion/${champion.image.full}`,
            splashUrl: `${DATA_DRAGON_BASE}/cdn/img/champion/splash/${champion.id}_0.jpg`,
            data: {
              info: champion.info,
              stats: champion.stats,
              partype: champion.partype,
              blurb: champion.blurb,
              version,
            },
            lastUpdated: new Date(),
          },
        });
        synced++;
      } catch (error: any) {
        console.error(`[LolChampionSync] Error syncing champion ${champion.name}:`, error.message);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalChampions = await prisma.lolChampion.count();

    console.log('═══════════════════════════════════════════════');
    console.log('✅ LoL Champion Sync Complete');
    console.log(`   Synced: ${synced}`);
    console.log(`   Version: ${version}`);
    console.log(`   Total Champions: ${totalChampions}`);
    console.log(`   Duration: ${duration}s`);
    console.log('═══════════════════════════════════════════════');

    // Show some champions
    const sampleChampions = await prisma.lolChampion.findMany({
      take: 10,
      orderBy: { name: 'asc' },
      select: { name: true, title: true, roles: true },
    });

    console.log('\n📊 SAMPLE CHAMPIONS:');
    console.log('─────────────────────────────────────────');
    for (const champ of sampleChampions) {
      const roles = Array.isArray(champ.roles) ? (champ.roles as string[]).join(', ') : 'Unknown';
      console.log(`  ${champ.name} - ${champ.title} (${roles})`);
    }

    return { synced, version };
  } catch (error) {
    console.error('❌ LoL Champion Sync Failed:', error);
    throw error;
  }
}

// Run if called directly
const isMainModule = require.main === module;
if (isMainModule) {
  runLolChampionSync()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
