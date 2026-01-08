import axios from 'axios';
import * as cheerio from 'cheerio';
import { prisma } from '../db/client.js';
import { proxyManager } from '../utils/proxy-manager.js';
import { earningsService } from '../services/scraper/earnings.service.js';
import { findOrCreatePlayer } from '../services/player.service.js';

/**
 * FULL PLAYER SYNC JOB
 *
 * This is the comprehensive scraper that gets ALL player data from Liquipedia.
 * It scrapes:
 * 1. ALL players from the earnings statistics portal (top earners list)
 * 2. ALL players from team rosters
 * 3. ALL individual player pages for complete earnings history
 *
 * This is the "get everything" solution.
 */

const JOB_NAME = 'full-player-sync';
const LIQUIPEDIA_BASE = 'https://liquipedia.net';
const LIQUIPEDIA_FORTNITE = `${LIQUIPEDIA_BASE}/fortnite`;

const headers = {
  'User-Agent': 'FortniteCompetitiveAPI/1.0 (Educational/Research)',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

interface ScrapedPlayer {
  ign: string;
  realName?: string;
  wikiUrl: string;
  nationality?: string;
  totalEarnings?: number;
  imageUrl?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithProxy(url: string, retries = 3): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const proxyConfig = proxyManager.getAxiosConfig();
      const response = await axios.get(url, {
        headers,
        timeout: 30000,
        ...proxyConfig,
      });
      return response.data;
    } catch (error: any) {
      lastError = error;
      console.log(`[${JOB_NAME}] Request failed (attempt ${attempt + 1}/${retries}): ${error.message}`);
      if (attempt < retries - 1) {
        await sleep(2000);
      }
    }
  }

  throw lastError || new Error('Failed to fetch URL');
}

/**
 * Scrape ALL players from Liquipedia's earnings statistics pages
 * This gets the complete list of ALL players who have ever earned money
 */
async function scrapeAllPlayersFromEarningsPortal(): Promise<ScrapedPlayer[]> {
  console.log(`[${JOB_NAME}] Scraping ALL players from Liquipedia earnings portal...`);

  const allPlayers: ScrapedPlayer[] = [];
  const seenUrls = new Set<string>();

  // Liquipedia has multiple earnings pages - scrape them all
  const earningsPages = [
    `${LIQUIPEDIA_FORTNITE}/Portal:Statistics/Player_earnings`,
    `${LIQUIPEDIA_FORTNITE}/Earnings/Top_100`,
    `${LIQUIPEDIA_FORTNITE}/Earnings/Top_200`,
    `${LIQUIPEDIA_FORTNITE}/Earnings/Top_500`,
    `${LIQUIPEDIA_FORTNITE}/Earnings`,
  ];

  for (const pageUrl of earningsPages) {
    try {
      console.log(`[${JOB_NAME}] Fetching: ${pageUrl}`);
      const html = await fetchWithProxy(pageUrl);
      const $ = cheerio.load(html);

      // Find all player links in tables
      $('table.wikitable tr, .wikitable tr').each((_, row) => {
        const $row = $(row);

        // Skip header rows
        if ($row.find('th').length > 0) return;

        // Find player link
        const playerLinks = $row.find('a[href*="/fortnite/"]').filter((_, el) => {
          const href = $(el).attr('href') || '';
          // Filter to only player pages (not tournaments, portals, etc.)
          return !href.includes('Portal:') &&
                 !href.includes('Category:') &&
                 !href.includes('Tournament') &&
                 !href.includes('S-Tier') &&
                 !href.includes('A-Tier') &&
                 !href.includes('B-Tier') &&
                 !href.includes('Earnings') &&
                 !href.includes('index.php');
        });

        playerLinks.each((_, link) => {
          const $link = $(link);
          const href = $link.attr('href');
          if (!href) return;

          const fullUrl = href.startsWith('http') ? href : `${LIQUIPEDIA_BASE}${href}`;

          // Skip if already seen
          if (seenUrls.has(fullUrl)) return;
          seenUrls.add(fullUrl);

          const ign = $link.text().trim();
          if (!ign || ign.length < 2 || ign.length > 50) return;

          // Try to get nationality from flag
          const flagImg = $row.find('img[src*="flag"]').first();
          const flagSrc = flagImg.attr('src') || '';
          const nationalityMatch = flagSrc.match(/\/([a-z]{2})\.png/i);

          // Try to get earnings from the row
          let totalEarnings: number | undefined;
          $row.find('td').each((_, td) => {
            const text = $(td).text().trim();
            if (text.startsWith('$')) {
              const amount = parseFloat(text.replace(/[$,]/g, ''));
              if (!isNaN(amount) && amount > 0) {
                totalEarnings = amount;
              }
            }
          });

          allPlayers.push({
            ign,
            wikiUrl: fullUrl,
            nationality: nationalityMatch?.[1]?.toUpperCase(),
            totalEarnings,
          });
        });
      });

      await sleep(500); // Rate limit
    } catch (error: any) {
      console.log(`[${JOB_NAME}] Failed to scrape ${pageUrl}: ${error.message}`);
    }
  }

  console.log(`[${JOB_NAME}] Found ${allPlayers.length} unique players from earnings pages`);
  return allPlayers;
}

/**
 * Scrape additional players from the Players portal
 */
async function scrapePlayersPortal(): Promise<ScrapedPlayer[]> {
  console.log(`[${JOB_NAME}] Scraping players portal...`);

  const players: ScrapedPlayer[] = [];
  const seenUrls = new Set<string>();

  // Players portal pages
  const portalPages = [
    `${LIQUIPEDIA_FORTNITE}/Portal:Players`,
    `${LIQUIPEDIA_FORTNITE}/Portal:Players/Europe`,
    `${LIQUIPEDIA_FORTNITE}/Portal:Players/North_America`,
    `${LIQUIPEDIA_FORTNITE}/Portal:Players/Brazil`,
    `${LIQUIPEDIA_FORTNITE}/Portal:Players/Oceania`,
    `${LIQUIPEDIA_FORTNITE}/Portal:Players/Asia`,
    `${LIQUIPEDIA_FORTNITE}/Portal:Players/Middle_East`,
  ];

  for (const pageUrl of portalPages) {
    try {
      console.log(`[${JOB_NAME}] Fetching: ${pageUrl}`);
      const html = await fetchWithProxy(pageUrl);
      const $ = cheerio.load(html);

      // Find all player links
      $('a[href*="/fortnite/"]').each((_, link) => {
        const $link = $(link);
        const href = $link.attr('href') || '';

        // Filter to player pages only
        if (href.includes('Portal:') ||
            href.includes('Category:') ||
            href.includes('Tournament') ||
            href.includes('Team') ||
            href.includes('index.php')) {
          return;
        }

        const fullUrl = href.startsWith('http') ? href : `${LIQUIPEDIA_BASE}${href}`;
        if (seenUrls.has(fullUrl)) return;
        seenUrls.add(fullUrl);

        const ign = $link.text().trim();
        if (!ign || ign.length < 2 || ign.length > 50) return;

        // Get nationality from nearby flag if possible
        const parentEl = $link.parent();
        const flagImg = parentEl.find('img[src*="flag"]').first();
        const flagSrc = flagImg.attr('src') || '';
        const nationalityMatch = flagSrc.match(/\/([a-z]{2})\.png/i);

        players.push({
          ign,
          wikiUrl: fullUrl,
          nationality: nationalityMatch?.[1]?.toUpperCase(),
        });
      });

      await sleep(500);
    } catch (error: any) {
      console.log(`[${JOB_NAME}] Failed to scrape ${pageUrl}: ${error.message}`);
    }
  }

  console.log(`[${JOB_NAME}] Found ${players.length} players from portal pages`);
  return players;
}

/**
 * Scrape detailed info from a player's wiki page
 */
async function scrapePlayerDetails(wikiUrl: string): Promise<{
  realName?: string;
  nationality?: string;
  country?: string;
  birthDate?: Date;
  imageUrl?: string;
}> {
  try {
    const html = await fetchWithProxy(wikiUrl);
    const $ = cheerio.load(html);

    const result: {
      realName?: string;
      nationality?: string;
      country?: string;
      birthDate?: Date;
      imageUrl?: string;
    } = {};

    // Get image
    const imgSrc = $('.infobox-image img').first().attr('src');
    if (imgSrc && !imgSrc.includes('placeholder') && !imgSrc.includes('NoImage')) {
      result.imageUrl = imgSrc.startsWith('http') ? imgSrc : `${LIQUIPEDIA_BASE}${imgSrc}`;
    }

    // Parse infobox
    const parseDate = (text: string): Date | null => {
      if (!text) return null;
      const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (isoMatch) {
        return new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`);
      }
      const parsed = new Date(text.replace(/\([^)]*\)/g, '').trim());
      if (!isNaN(parsed.getTime())) return parsed;
      return null;
    };

    // Try fo-nttax-infobox format (Fortnite specific)
    $('.fo-nttax-infobox').children('div').each((_, div) => {
      const text = $(div).text().trim();
      if (!text.includes(':')) return;

      const colonIdx = text.indexOf(':');
      const label = text.substring(0, colonIdx).toLowerCase().trim();
      const value = text.substring(colonIdx + 1).trim();

      if (label === 'name' && !result.realName && value.length < 100) {
        result.realName = value;
      }

      if ((label === 'born' || label.includes('birth')) && !result.birthDate) {
        const date = parseDate(value);
        if (date && date.getFullYear() > 1980 && date.getFullYear() < 2015) {
          result.birthDate = date;
        }
      }

      if (label === 'nationality' && !result.nationality) {
        const flagImg = $(div).find('img[src*="flag"]').first();
        const flagSrc = flagImg.attr('src') || '';
        const match = flagSrc.match(/\/([a-z]{2})\.png/i);
        if (match?.[1]) result.nationality = match[1].toUpperCase();

        const countryText = $(div).find('a').first().text().trim() || value;
        if (countryText && countryText.length < 50) {
          result.country = countryText;
        }
      }
    });

    // Fallback to standard infobox
    if (!result.realName || !result.birthDate) {
      $('.infobox tr').each((_, row) => {
        const label = $(row).find('th').first().text().toLowerCase().trim();
        const value = $(row).find('td').first().text().trim();

        if (label.includes('name') && !label.includes('nick') && !result.realName && value.length < 100) {
          result.realName = value;
        }

        if ((label.includes('born') || label.includes('birth')) && !result.birthDate) {
          const date = parseDate(value);
          if (date && date.getFullYear() > 1980 && date.getFullYear() < 2015) {
            result.birthDate = date;
          }
        }
      });
    }

    return result;
  } catch {
    return {};
  }
}

/**
 * MAIN: Full sync of ALL players and ALL earnings
 */
export async function runFullPlayerSync(options?: {
  skipPlayerDetails?: boolean;
}): Promise<{
  playersFound: number;
  playersCreated: number;
  playersUpdated: number;
  earningsSynced: number;
  errors: number;
}> {
  const { skipPlayerDetails = false } = options || {};

  console.log(`\n[${JOB_NAME}] ========== STARTING FULL PLAYER SYNC ==========\n`);
  const startTime = Date.now();

  const stats = {
    playersFound: 0,
    playersCreated: 0,
    playersUpdated: 0,
    earningsSynced: 0,
    errors: 0,
  };

  try {
    // Step 1: Scrape ALL players from earnings pages and portals
    console.log(`\n[${JOB_NAME}] === Step 1: Discovering ALL players ===\n`);

    const [earningsPlayers, portalPlayers] = await Promise.all([
      scrapeAllPlayersFromEarningsPortal(),
      scrapePlayersPortal(),
    ]);

    // Merge and dedupe by wikiUrl
    const playerMap = new Map<string, ScrapedPlayer>();
    for (const p of [...earningsPlayers, ...portalPlayers]) {
      const existing = playerMap.get(p.wikiUrl);
      if (!existing || (p.totalEarnings && (!existing.totalEarnings || p.totalEarnings > existing.totalEarnings))) {
        playerMap.set(p.wikiUrl, p);
      }
    }

    const allPlayers = Array.from(playerMap.values());
    stats.playersFound = allPlayers.length;
    console.log(`[${JOB_NAME}] Total unique players found: ${allPlayers.length}`);

    // Sort by earnings (highest first) so we get the important players done first
    allPlayers.sort((a, b) => (b.totalEarnings || 0) - (a.totalEarnings || 0));

    // Step 2: Create/update ALL player records
    console.log(`\n[${JOB_NAME}] === Step 2: Creating/updating player records ===\n`);

    for (let i = 0; i < allPlayers.length; i++) {
      const player = allPlayers[i]!;

      try {
        // Check if player exists
        const existing = await prisma.player.findFirst({
          where: {
            OR: [
              { wikiUrl: player.wikiUrl },
              { currentIgn: { equals: player.ign, mode: 'insensitive' } },
            ],
          },
        });

        let playerDetails: Awaited<ReturnType<typeof scrapePlayerDetails>> = {};

        // Scrape details if needed and not skipping
        if (!skipPlayerDetails && (!existing || !existing.imageUrl || !existing.realName)) {
          playerDetails = await scrapePlayerDetails(player.wikiUrl);
          await sleep(300); // Rate limit
        }

        if (existing) {
          // Update with wikiUrl if missing
          const updateData: Record<string, unknown> = { lastUpdated: new Date() };
          if (!existing.wikiUrl) updateData.wikiUrl = player.wikiUrl;
          if (!existing.imageUrl && playerDetails.imageUrl) updateData.imageUrl = playerDetails.imageUrl;
          if (!existing.realName && playerDetails.realName) updateData.realName = playerDetails.realName;
          if (!existing.nationality && (player.nationality || playerDetails.nationality)) {
            updateData.nationality = player.nationality || playerDetails.nationality;
          }
          if (!existing.country && playerDetails.country) updateData.country = playerDetails.country;
          if (!existing.birthDate && playerDetails.birthDate) updateData.birthDate = playerDetails.birthDate;

          if (Object.keys(updateData).length > 1) {
            await prisma.player.update({
              where: { playerId: existing.playerId },
              data: updateData,
            });
            stats.playersUpdated++;
          }
        } else {
          // Create new player
          await findOrCreatePlayer(player.ign, {
            wikiUrl: player.wikiUrl,
            realName: playerDetails.realName || player.realName,
            nationality: playerDetails.nationality || player.nationality,
            country: playerDetails.country,
            birthDate: playerDetails.birthDate,
            imageUrl: playerDetails.imageUrl,
          });
          stats.playersCreated++;
        }

        if ((i + 1) % 50 === 0) {
          console.log(`[${JOB_NAME}] Processed ${i + 1}/${allPlayers.length} players...`);
        }
      } catch (error: any) {
        console.error(`[${JOB_NAME}] Error processing ${player.ign}: ${error.message}`);
        stats.errors++;
      }
    }

    console.log(`[${JOB_NAME}] Created ${stats.playersCreated}, updated ${stats.playersUpdated} players`);

    // Step 3: Sync ALL earnings for ALL players with wikiUrls
    console.log(`\n[${JOB_NAME}] === Step 3: Syncing ALL earnings ===\n`);

    const playersWithWikiUrls = await prisma.player.findMany({
      where: { wikiUrl: { not: null } },
      select: { playerId: true, currentIgn: true, wikiUrl: true },
      orderBy: { lastUpdated: 'asc' },
    });

    console.log(`[${JOB_NAME}] Syncing earnings for ${playersWithWikiUrls.length} players...`);

    for (let i = 0; i < playersWithWikiUrls.length; i++) {
      const player = playersWithWikiUrls[i];

      try {
        const count = await earningsService.syncPlayerEarnings(player.playerId);
        stats.earningsSynced += count;

        if (count > 0) {
          console.log(`[${JOB_NAME}] ${player.currentIgn}: synced ${count} earnings`);
        }

        if ((i + 1) % 25 === 0) {
          console.log(`[${JOB_NAME}] Synced earnings for ${i + 1}/${playersWithWikiUrls.length} players...`);
        }

        await sleep(1500); // Rate limit - be respectful
      } catch (error: any) {
        console.error(`[${JOB_NAME}] Error syncing ${player.currentIgn}: ${error.message}`);
        stats.errors++;
      }
    }

    // Step 4: Update ALL player earnings summaries
    console.log(`\n[${JOB_NAME}] === Step 4: Recalculating ALL earnings summaries ===\n`);

    const playersWithEarnings = await prisma.playerTournamentEarning.findMany({
      select: { playerId: true },
      distinct: ['playerId'],
    });

    console.log(`[${JOB_NAME}] Recalculating summaries for ${playersWithEarnings.length} players...`);

    for (const { playerId } of playersWithEarnings) {
      try {
        await earningsService.updatePlayerEarningsSummary(playerId);
      } catch (error: any) {
        stats.errors++;
      }
    }

    // Step 5: Update org earnings summaries
    console.log(`\n[${JOB_NAME}] === Step 5: Updating org earnings summaries ===\n`);

    const orgs = await prisma.organization.findMany({ select: { slug: true } });
    for (const org of orgs) {
      try {
        await earningsService.updateOrgEarningsSummary(org.slug);
      } catch {
        stats.errors++;
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    console.log(`\n[${JOB_NAME}] ========== FULL SYNC COMPLETE ==========`);
    console.log(`[${JOB_NAME}] Time: ${elapsed}s (${Math.round(elapsed / 60)}m)`);
    console.log(`[${JOB_NAME}] Players found: ${stats.playersFound}`);
    console.log(`[${JOB_NAME}] Players created: ${stats.playersCreated}`);
    console.log(`[${JOB_NAME}] Players updated: ${stats.playersUpdated}`);
    console.log(`[${JOB_NAME}] Earnings records synced: ${stats.earningsSynced}`);
    console.log(`[${JOB_NAME}] Errors: ${stats.errors}`);
    console.log(`[${JOB_NAME}] ==========================================\n`);

    return stats;
  } catch (error) {
    console.error(`[${JOB_NAME}] Full sync failed:`, error);
    throw error;
  }
}

/**
 * Quick sync - just sync earnings for existing players (faster)
 */
export async function runQuickEarningsSync(): Promise<number> {
  console.log(`\n[${JOB_NAME}] Running quick earnings sync...\n`);

  const players = await prisma.player.findMany({
    where: { wikiUrl: { not: null } },
    select: { playerId: true, currentIgn: true },
    orderBy: { lastUpdated: 'asc' },
  });

  let totalSynced = 0;

  for (const player of players) {
    try {
      const count = await earningsService.syncPlayerEarnings(player.playerId);
      totalSynced += count;
      if (count > 0) {
        console.log(`[${JOB_NAME}] ${player.currentIgn}: ${count} earnings`);
      }
      await sleep(1500);
    } catch (error: any) {
      console.error(`[${JOB_NAME}] Error: ${player.currentIgn}: ${error.message}`);
    }
  }

  // Update all summaries
  const playersWithEarnings = await prisma.playerTournamentEarning.findMany({
    select: { playerId: true },
    distinct: ['playerId'],
  });

  for (const { playerId } of playersWithEarnings) {
    await earningsService.updatePlayerEarningsSummary(playerId);
  }

  console.log(`\n[${JOB_NAME}] Quick sync complete: ${totalSynced} earnings synced\n`);
  return totalSynced;
}

/**
 * Sync a specific player by IGN or wikiUrl
 */
export async function syncSpecificPlayer(identifier: string): Promise<number> {
  console.log(`[${JOB_NAME}] Syncing player: ${identifier}`);

  // Check if it's a URL
  const isUrl = identifier.startsWith('http');

  let player = await prisma.player.findFirst({
    where: isUrl
      ? { wikiUrl: identifier }
      : { currentIgn: { equals: identifier, mode: 'insensitive' } },
  });

  // If not found and it's a URL, create the player
  if (!player && isUrl) {
    const details = await scrapePlayerDetails(identifier);
    const ign = identifier.split('/').pop()?.replace(/_/g, ' ') || 'Unknown';
    player = await findOrCreatePlayer(ign, {
      wikiUrl: identifier,
      ...details,
    });
  }

  // If still not found, try to find them on Liquipedia
  if (!player && !isUrl) {
    const wikiUrl = `${LIQUIPEDIA_FORTNITE}/${identifier.replace(/ /g, '_')}`;
    try {
      const details = await scrapePlayerDetails(wikiUrl);
      player = await findOrCreatePlayer(identifier, {
        wikiUrl,
        ...details,
      });
    } catch {
      console.error(`[${JOB_NAME}] Could not find player: ${identifier}`);
      return 0;
    }
  }

  if (!player) {
    console.error(`[${JOB_NAME}] Player not found: ${identifier}`);
    return 0;
  }

  // Sync earnings
  const count = await earningsService.syncPlayerEarnings(player.playerId);
  console.log(`[${JOB_NAME}] Synced ${count} earnings for ${player.currentIgn}`);

  return count;
}
