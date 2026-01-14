import { prisma } from '../db/client.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * LoL Player Sync Job
 * Scrapes player data from Liquipedia using API and direct pages
 * Run daily at 2 AM UTC
 */

const LIQUIPEDIA_API_URL = 'https://liquipedia.net/leagueoflegends/api.php';
const REQUEST_DELAY_MS = 2500; // Respectful rate limiting

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface WikiPlayer {
  pageid: number;
  title: string;
  fullurl: string;
}

interface ScrapedPlayer {
  ign: string;
  realName: string | null;
  country: string | null;
  nationality: string | null;
  role: string | null;
  team: string | null;
  teamSlug: string | null;
  wikiUrl: string | null;
  isActive: boolean;
  birthDate: Date | null;
  imageUrl: string | null;
}

/**
 * Get players from Liquipedia API using category queries
 */
async function getPlayersFromCategory(category: string): Promise<WikiPlayer[]> {
  const players: WikiPlayer[] = [];
  let cmcontinue: string | undefined;

  do {
    try {
      const params: Record<string, string> = {
        action: 'query',
        list: 'categorymembers',
        cmtitle: category,
        cmlimit: '500',
        format: 'json',
      };
      if (cmcontinue) params.cmcontinue = cmcontinue;

      const response = await axios.get(LIQUIPEDIA_API_URL, {
        params,
        headers: {
          'User-Agent': 'CitoBot/1.0 (esports data aggregator; contact@cito.gg)',
          'Accept': 'application/json',
        },
        timeout: 30000,
      });

      const data = response.data;
      const members = data.query?.categorymembers || [];

      for (const member of members) {
        if (member.ns === 0) { // Main namespace only
          players.push({
            pageid: member.pageid,
            title: member.title,
            fullurl: `https://liquipedia.net/leagueoflegends/${encodeURIComponent(member.title.replace(/ /g, '_'))}`,
          });
        }
      }

      cmcontinue = data.continue?.cmcontinue;
      await delay(REQUEST_DELAY_MS);
    } catch (error: any) {
      console.error(`[LolPlayerSync] Error fetching category ${category}:`, error.message);
      break;
    }
  } while (cmcontinue);

  return players;
}

/**
 * Scrape player details from individual wiki page
 */
async function scrapePlayerDetails(url: string, playerName: string): Promise<ScrapedPlayer | null> {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'CitoBot/1.0 (esports data aggregator; contact@cito.gg)',
        'Accept': 'text/html',
      },
      timeout: 30000,
    });

    const $ = cheerio.load(response.data);
    const player: ScrapedPlayer = {
      ign: playerName,
      realName: null,
      country: null,
      nationality: null,
      role: null,
      team: null,
      teamSlug: null,
      wikiUrl: url,
      isActive: true,
      birthDate: null,
      imageUrl: null,
    };

    // Parse infobox
    const infobox = $('.infobox-cell-2');
    infobox.each((_, cell) => {
      const $cell = $(cell);
      const label = $cell.prev('.infobox-cell-1').text().toLowerCase().trim();
      const value = $cell.text().trim();

      if (label.includes('romanized') || (label.includes('name') && !label.includes('romanized'))) {
        if (!player.realName) player.realName = value;
      } else if (label.includes('nationality') || label.includes('born in')) {
        player.nationality = value.split('\n')[0]?.trim() || value;
        // Get country code from flag
        const flag = $cell.find('.flag img, .flagicon img').attr('alt');
        if (flag) player.country = flag.substring(0, 2).toUpperCase();
      } else if (label.includes('born')) {
        const dateMatch = value.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (dateMatch) {
          player.birthDate = new Date(dateMatch[0]);
        }
      } else if (label.includes('role') || label.includes('position')) {
        const roleLower = value.toLowerCase();
        if (roleLower.includes('top')) player.role = 'Top';
        else if (roleLower.includes('jungle') || roleLower.includes('jungler')) player.role = 'Jungle';
        else if (roleLower.includes('mid')) player.role = 'Mid';
        else if (roleLower.includes('adc') || roleLower.includes('bot') || roleLower.includes('marksman')) player.role = 'ADC';
        else if (roleLower.includes('support')) player.role = 'Support';
      } else if (label.includes('team')) {
        const teamLink = $cell.find('a').first();
        const teamName = teamLink.text().trim() || value;
        if (teamName && teamName !== 'None' && teamName !== '-' && !teamName.toLowerCase().includes('free agent')) {
          player.team = teamName;
          player.teamSlug = teamName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        }
      }
    });

    // Get image from infobox
    const image = $('.infobox-image img').attr('src');
    if (image && !image.includes('questionmark')) {
      player.imageUrl = image.startsWith('//') ? `https:${image}` : image;
    }

    // Check if inactive (retired, etc.)
    const statusText = $('.infobox').text().toLowerCase();
    if (statusText.includes('retired') || statusText.includes('inactive')) {
      player.isActive = false;
    }

    return player;
  } catch (error: any) {
    console.error(`[LolPlayerSync] Error scraping ${playerName}:`, error.message);
    return null;
  }
}

/**
 * Sync all players from Liquipedia categories
 */
async function syncPlayersFromLiquipedia(): Promise<number> {
  console.log('[LolPlayerSync] Fetching players from Liquipedia categories...');

  // Categories for active and notable players
  // Liquipedia uses "South Korean players", "Chinese players", etc.
  const categories = [
    'Category:South Korean players',
    'Category:Chinese players',
    'Category:Danish players',
    'Category:Swedish players',
    'Category:German players',
    'Category:French players',
    'Category:Polish players',
    'Category:American players',
    'Category:Canadian players',
    'Category:Taiwanese players',
    'Category:Vietnamese players',
    'Category:Brazilian players',
    'Category:Turkish players',
    'Category:Japanese players',
    'Category:Australian players',
    'Category:Spanish players',
    'Category:British players',
  ];

  const allPlayers = new Map<string, WikiPlayer>();

  for (const category of categories) {
    console.log(`[LolPlayerSync] Fetching ${category}...`);
    const players = await getPlayersFromCategory(category);
    console.log(`[LolPlayerSync] Found ${players.length} players in ${category}`);

    for (const player of players) {
      // Skip non-player pages
      if (player.title.includes(':') || player.title.includes('/')) continue;
      if (!allPlayers.has(player.title)) {
        allPlayers.set(player.title, player);
      }
    }
  }

  console.log(`[LolPlayerSync] Total unique players found: ${allPlayers.size}`);

  let synced = 0;
  let batchCount = 0;
  const batchSize = 100;

  for (const [playerName, wikiPlayer] of allPlayers) {
    try {
      // Scrape player details
      const details = await scrapePlayerDetails(wikiPlayer.fullurl, playerName);

      if (details) {
        const playerId = `lol-${playerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

        await prisma.lolPlayer.upsert({
          where: { lolPlayerId: playerId },
          create: {
            lolPlayerId: playerId,
            currentIgn: details.ign,
            realName: details.realName,
            country: details.country,
            nationality: details.nationality,
            role: details.role,
            wikiUrl: details.wikiUrl,
            imageUrl: details.imageUrl,
            birthDate: details.birthDate,
            isActive: details.isActive,
          },
          update: {
            currentIgn: details.ign,
            realName: details.realName || undefined,
            country: details.country || undefined,
            nationality: details.nationality || undefined,
            role: details.role || undefined,
            wikiUrl: details.wikiUrl || undefined,
            imageUrl: details.imageUrl || undefined,
            birthDate: details.birthDate || undefined,
            isActive: details.isActive,
            lastUpdated: new Date(),
          },
        });
        synced++;
      }

      batchCount++;
      if (batchCount % batchSize === 0) {
        console.log(`[LolPlayerSync] Progress: ${batchCount}/${allPlayers.size} players processed, ${synced} synced`);
      }

      await delay(REQUEST_DELAY_MS);
    } catch (error: any) {
      console.error(`[LolPlayerSync] Error syncing ${playerName}:`, error.message);
    }
  }

  return synced;
}

/**
 * Sync players from existing match data (fast)
 */
async function syncPlayersFromMatchData(): Promise<number> {
  console.log('[LolPlayerSync] Syncing players from match data...');

  const games = await prisma.lolGame.findMany({
    include: {
      playerStats: true,
    },
    take: 1000,
  });

  const playerSet = new Map<string, { ign: string; role: string | null }>();

  for (const game of games) {
    for (const stat of game.playerStats) {
      if (stat.playerName) {
        const key = stat.playerName.toLowerCase();
        if (!playerSet.has(key)) {
          playerSet.set(key, {
            ign: stat.playerName,
            role: stat.role,
          });
        }
      }
    }
  }

  let synced = 0;
  for (const [, playerData] of playerSet) {
    try {
      const playerId = `lol-${playerData.ign.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

      await prisma.lolPlayer.upsert({
        where: { lolPlayerId: playerId },
        create: {
          lolPlayerId: playerId,
          currentIgn: playerData.ign,
          role: playerData.role,
          isActive: true,
        },
        update: {
          role: playerData.role || undefined,
          lastUpdated: new Date(),
        },
      });
      synced++;
    } catch (error: any) {
      // Ignore duplicates
    }
  }

  return synced;
}

export async function runLolPlayerSync(_options?: { enrichLimit?: number }): Promise<{
  fromMatchData: number;
  fromLiquipedia: number;
  total: number;
}> {
  console.log('═══════════════════════════════════════════════');
  console.log('👤 Starting LoL Player Sync');
  console.log('═══════════════════════════════════════════════');

  const startTime = Date.now();

  try {
    // First sync from match data (fast)
    const fromMatchData = await syncPlayersFromMatchData();
    console.log(`[LolPlayerSync] Synced ${fromMatchData} players from match data`);

    // Then scrape from Liquipedia (comprehensive but slow)
    const fromLiquipedia = await syncPlayersFromLiquipedia();
    console.log(`[LolPlayerSync] Synced ${fromLiquipedia} players from Liquipedia`);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalPlayers = await prisma.lolPlayer.count();

    console.log('═══════════════════════════════════════════════');
    console.log('✅ LoL Player Sync Complete');
    console.log(`   From Match Data: ${fromMatchData}`);
    console.log(`   From Liquipedia: ${fromLiquipedia}`);
    console.log(`   Total Players: ${totalPlayers}`);
    console.log(`   Duration: ${duration}s`);
    console.log('═══════════════════════════════════════════════');

    return { fromMatchData, fromLiquipedia, total: totalPlayers };
  } catch (error) {
    console.error('❌ LoL Player Sync Failed:', error);
    throw error;
  }
}

// Run if called directly
const isMainModule = require.main === module;
if (isMainModule) {
  runLolPlayerSync()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
