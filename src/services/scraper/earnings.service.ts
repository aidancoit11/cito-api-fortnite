import axios from 'axios';
import * as cheerio from 'cheerio';
import { prisma } from '../../db/client.js';
import NodeCache from 'node-cache';

/**
 * Earnings Scraping Service
 * Scrapes Fortnite player earnings from Liquipedia
 * IMPORTANT: Only scrapes from liquipedia.net/fortnite - Fortnite data only
 */

const cache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache

const headers = {
  'User-Agent': 'FortniteCompetitiveAPI/1.0 (Educational/Research)',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

export interface ScrapedEarning {
  tournamentId: string;
  tournamentName: string;
  tournamentDate: Date;
  placement: number;
  earnings: number;
  prizePool?: number;
  tier?: string;
  gameMode?: string;
  region?: string;
  season?: string;
  wikiUrl?: string;
  teamSize: number;
  teammates?: string[];
}

export interface PlayerEarningsData {
  playerId: string;
  ign: string;
  totalEarnings: number;
  tournamentCount: number;
  earnings: ScrapedEarning[];
}

/**
 * Parse earnings amount from string (e.g., "$50,000" -> 50000)
 */
function parseEarnings(text: string): number {
  const match = text.replace(/[^0-9.,]/g, '').replace(/,/g, '');
  const value = parseFloat(match);
  return isNaN(value) ? 0 : value;
}

/**
 * Parse placement from string (e.g., "1st", "2nd", "5th-8th", "Top 10")
 */
function parsePlacement(text: string): number {
  const lowerText = text.toLowerCase().trim();

  // Direct number match (1st, 2nd, etc.)
  const directMatch = lowerText.match(/^(\d+)/);
  if (directMatch && directMatch[1]) {
    return parseInt(directMatch[1], 10);
  }

  // Range match (5th-8th -> 5)
  const rangeMatch = lowerText.match(/(\d+)[a-z]*\s*[-–]\s*(\d+)/);
  if (rangeMatch && rangeMatch[1]) {
    return parseInt(rangeMatch[1], 10);
  }

  // Top X match
  const topMatch = lowerText.match(/top\s*(\d+)/);
  if (topMatch && topMatch[1]) {
    return parseInt(topMatch[1], 10);
  }

  return 999; // Unknown placement
}

/**
 * Parse date from string (various formats)
 */
function parseDate(text: string): Date | null {
  const cleanText = text.trim();

  // Try YYYY-MM-DD format
  const isoMatch = cleanText.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(cleanText);
  }

  // Try "Month DD, YYYY" format
  const monthDayYear = cleanText.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (monthDayYear) {
    const date = new Date(`${monthDayYear[1]} ${monthDayYear[2]}, ${monthDayYear[3]}`);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // Try "DD Month YYYY" format
  const dayMonthYear = cleanText.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (dayMonthYear) {
    const date = new Date(`${dayMonthYear[2]} ${dayMonthYear[1]}, ${dayMonthYear[3]}`);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

/**
 * Extract region from tournament name or text
 */
function extractRegion(text: string): string | undefined {
  const regionPatterns: Record<string, string> = {
    'NAE': 'NAE',
    'NA East': 'NAE',
    'NA-East': 'NAE',
    'NAW': 'NAW',
    'NA West': 'NAW',
    'NA-West': 'NAW',
    'EU': 'EU',
    'Europe': 'EU',
    'BR': 'BR',
    'Brazil': 'BR',
    'OCE': 'OCE',
    'Oceania': 'OCE',
    'ASIA': 'ASIA',
    'ME': 'ME',
    'Middle East': 'ME',
  };

  for (const [pattern, region] of Object.entries(regionPatterns)) {
    if (text.includes(pattern)) {
      return region;
    }
  }

  return undefined;
}

/**
 * Extract tier from cell or text (S-Tier, A-Tier, etc.)
 */
function extractTier(text: string): string | undefined {
  const tierPatterns = [
    /S[- ]?Tier/i,
    /A[- ]?Tier/i,
    /B[- ]?Tier/i,
    /C[- ]?Tier/i,
    /D[- ]?Tier/i,
    /Weekly/i,
    /Monthly/i,
    /Qualifier/i,
  ];

  for (const pattern of tierPatterns) {
    const match = text.match(pattern);
    if (match) {
      // Normalize the tier
      const tier = match[0].toLowerCase().replace(/[- ]/g, '-');
      if (tier.includes('s-tier') || tier.includes('stier')) return 'S-Tier';
      if (tier.includes('a-tier') || tier.includes('atier')) return 'A-Tier';
      if (tier.includes('b-tier') || tier.includes('btier')) return 'B-Tier';
      if (tier.includes('c-tier') || tier.includes('ctier')) return 'C-Tier';
      if (tier.includes('d-tier') || tier.includes('dtier')) return 'D-Tier';
      if (tier.includes('weekly')) return 'Weekly';
      if (tier.includes('monthly')) return 'Monthly';
      if (tier.includes('qualifier')) return 'Qualifier';
    }
  }
  return undefined;
}

/**
 * Extract game mode from tournament name (Solo, Duo, Trios, Squads)
 */
function extractGameMode(text: string): string | undefined {
  const lowerText = text.toLowerCase();

  if (lowerText.includes('solo')) return 'Solo';
  if (lowerText.includes('duo')) return 'Duo';
  if (lowerText.includes('trio')) return 'Trios';
  if (lowerText.includes('squad')) return 'Squads';

  return undefined;
}

/**
 * Extract season from tournament name or context
 * Format: "Chapter X Season Y" or "CX:SY"
 */
function extractSeason(text: string): string | undefined {
  // Pattern: "Chapter X Season Y" or variations
  const chapterSeasonMatch = text.match(/Chapter\s*(\d+)\s*[-:]\s*Season\s*(\d+)/i);
  if (chapterSeasonMatch) {
    return `C${chapterSeasonMatch[1]}:S${chapterSeasonMatch[2]}`;
  }

  // Pattern: "C1:S1" format
  const shortMatch = text.match(/C(\d+)\s*[:]\s*S(\d+)/i);
  if (shortMatch) {
    return `C${shortMatch[1]}:S${shortMatch[2]}`;
  }

  // Pattern: "Season X" alone (legacy)
  const seasonOnlyMatch = text.match(/Season\s*(\d+)/i);
  if (seasonOnlyMatch) {
    return `Season ${seasonOnlyMatch[1]}`;
  }

  // Pattern: "FNCS Chapter X"
  const fncsMatch = text.match(/FNCS\s*(?:Chapter\s*)?(\d+)/i);
  if (fncsMatch) {
    return `FNCS Chapter ${fncsMatch[1]}`;
  }

  return undefined;
}

/**
 * Scrape earnings for a specific player from their Liquipedia page
 * Handles the actual Liquipedia table format:
 * | Date | Place | Tier | Tournament (icon) | Tournament (name) | Team | Prize |
 */
export async function scrapePlayerEarnings(wikiUrl: string): Promise<ScrapedEarning[]> {
  const cacheKey = `earnings_${wikiUrl}`;
  const cached = cache.get<ScrapedEarning[]>(cacheKey);
  if (cached) return cached;

  try {
    // Try /Results page first (has ALL results), fallback to main player page
    // The main player page only shows ~10 top results, /Results has full history
    const resultsUrl = wikiUrl.replace(/\/?$/, '/Results');
    let response;
    try {
      response = await axios.get(resultsUrl, { headers });
    } catch {
      // /Results page doesn't exist, try main player page
      response = await axios.get(wikiUrl, { headers });
    }

    const $ = cheerio.load(response.data);
    const earnings: ScrapedEarning[] = [];
    const seenTournaments = new Set<string>();

    // Look for sortable wikitables (Liquipedia's results format)
    $('table.wikitable.sortable').each((_, table) => {
      const $table = $(table);

      // Get headers to understand column structure
      const headerCells = $table.find('tr').first().find('th');
      const headerTexts: string[] = [];
      headerCells.each((_, th) => {
        headerTexts.push($(th).text().toLowerCase().trim());
      });

      // Check if this is a results table (has Date, Place/Tier, Tournament, Prize columns)
      const hasDate = headerTexts.some(h => h.includes('date'));
      const hasPrize = headerTexts.some(h => h.includes('prize'));
      if (!hasDate || !hasPrize) return;

      // Find column indices
      const dateIdx = headerTexts.findIndex(h => h.includes('date'));
      const placeIdx = headerTexts.findIndex(h => h.includes('place'));

      // Process data rows
      $table.find('tbody tr').each((_, row) => {
        const $row = $(row);

        // Skip header rows and separator rows
        if ($row.find('th').length > 0) return;

        const cells = $row.find('td');
        if (cells.length < 4) return;

        // Extract date (usually first column, format: YYYY-MM-DD)
        const dateText = cells.eq(dateIdx >= 0 ? dateIdx : 0).text().trim();
        const tournamentDate = parseDate(dateText);
        if (!tournamentDate) return;

        // Extract placement from cell with class placement-X or text like "1st", "2nd"
        let placement = 999;
        const placeCell = cells.eq(placeIdx >= 0 ? placeIdx : 1);
        const placeText = placeCell.find('.placement-text').text().trim() || placeCell.text().trim();
        if (placeText) {
          placement = parsePlacement(placeText);
        }

        // Extract tier from tier column (usually column 2 or 3)
        let tier: string | undefined;
        cells.each((_, cell) => {
          if (tier) return;
          const $cell = $(cell);
          const cellText = $cell.text().trim();
          const sortVal = $cell.attr('data-sort-value') || '';
          // Check for tier in sort value or text
          tier = extractTier(sortVal) || extractTier(cellText);
        });

        // Extract tournament name and wiki URL
        let tournamentName = '';
        let tournamentWikiUrl: string | undefined;

        // First check data-sort-value attributes (columns 3 and 4 usually have tournament info)
        cells.each((_, cell) => {
          if (tournamentName) return; // Already found
          const $cell = $(cell);
          const sortVal = $cell.attr('data-sort-value');
          // Tournament names are usually longer than 10 chars and don't contain tier info
          if (sortVal && sortVal.length > 10 &&
              !sortVal.includes('Tier') && !sortVal.includes('S-Tier') &&
              !sortVal.includes('A-Tier') && !sortVal.includes('B-Tier') &&
              !sortVal.includes('C-Tier') && !sortVal.includes('D-Tier') &&
              !sortVal.includes('Weekly')) {
            // Skip player/team entries (usually have / separator and short words)
            const parts = sortVal.split(' / ');
            if (parts.length <= 1 || (parts[0] && parts[0].length > 20)) {
              tournamentName = sortVal;
              // Also grab the tournament link
              const link = $cell.find('a[href*="/fortnite/"]').first();
              const href = link.attr('href');
              if (href && !href.includes('index.php')) {
                tournamentWikiUrl = href.startsWith('http') ? href : `https://liquipedia.net${href}`;
              }
            }
          }
        });

        // Fallback: look for tournament links
        if (!tournamentName) {
          cells.each((_, cell) => {
            if (tournamentName) return;
            const $cell = $(cell);
            const links = $cell.find('a[href*="/fortnite/"]');
            links.each((_, link) => {
              if (tournamentName) return;
              const $link = $(link);
              const href = $link.attr('href') || '';
              const text = $link.attr('title') || $link.text().trim();
              // Skip tier links, player links, and edit links
              if (href.includes('_Tournaments') || href.includes('index.php') ||
                  text.includes('S-Tier') || text.includes('A-Tier') ||
                  text.includes('B-Tier') || text.includes('C-Tier') ||
                  text.includes('D-Tier') || text.includes('Weekly')) {
                return; // continue
              }
              // Accept if it looks like a tournament (longer text, valid link)
              if (text && text.length > 8) {
                tournamentName = text;
                tournamentWikiUrl = href.startsWith('http') ? href : `https://liquipedia.net${href}`;
              }
            });
          });
        }

        if (!tournamentName) return;

        // Extract game mode and season from tournament name
        const gameMode = extractGameMode(tournamentName);
        const season = extractSeason(tournamentName);

        // Also try to extract tier from tournament name if not found in tier column
        if (!tier) {
          tier = extractTier(tournamentName);
        }

        // Extract prize amount - ALWAYS use last column (colspan in headers causes index mismatch)
        let earningsAmount = 0;
        const prizeCell = cells.eq(cells.length - 1);
        const prizeText = prizeCell.text().trim();
        earningsAmount = parseEarnings(prizeText);
        if (earningsAmount <= 0) return;

        // Extract teammates from Team column
        const teammates: string[] = [];
        cells.each((_, cell) => {
          const $cell = $(cell);
          // Look for player blocks or team members
          $cell.find('.block-player .name a, .block-players-wrapper a').each((_, a) => {
            const name = $(a).text().trim();
            // Skip self-links and invalid names
            if (name && name.length < 50 && !$(a).hasClass('mw-selflink')) {
              teammates.push(name);
            }
          });
        });

        // Generate unique tournament ID
        const dateStr = tournamentDate.toISOString().split('T')[0];
        const tournamentId = `${dateStr}-${tournamentName}`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .substring(0, 100);

        // Skip duplicates
        if (seenTournaments.has(tournamentId)) return;
        seenTournaments.add(tournamentId);

        const region = extractRegion(tournamentName);
        const teamSize = teammates.length > 0 ? teammates.length + 1 : 1;

        earnings.push({
          tournamentId,
          tournamentName,
          tournamentDate,
          placement,
          earnings: earningsAmount,
          tier,
          gameMode,
          region,
          season,
          wikiUrl: tournamentWikiUrl,
          teamSize,
          teammates: teammates.length > 0 ? teammates : undefined,
        });
      });
    });

    // Sort by date descending
    earnings.sort((a, b) => b.tournamentDate.getTime() - a.tournamentDate.getTime());

    console.log(`Scraped ${earnings.length} earnings for ${wikiUrl}`);
    cache.set(cacheKey, earnings, 1800); // 30 min cache
    return earnings;
  } catch (error: any) {
    console.error(`Failed to scrape earnings from ${wikiUrl}:`, error.message);
    return [];
  }
}

/**
 * Sync player earnings to database
 */
export async function syncPlayerEarnings(playerId: string): Promise<number> {
  const player = await prisma.player.findUnique({
    where: { playerId },
  });

  if (!player?.wikiUrl) {
    console.warn(`Player ${playerId} has no wiki URL`);
    return 0;
  }

  const earnings = await scrapePlayerEarnings(player.wikiUrl);
  let synced = 0;

  // Get current org for the player
  const currentRoster = await prisma.teamRoster.findFirst({
    where: { playerId, status: 'current' },
  });

  for (const earning of earnings) {
    try {
      await prisma.playerTournamentEarning.upsert({
        where: {
          playerId_tournamentId: {
            playerId,
            tournamentId: earning.tournamentId,
          },
        },
        create: {
          playerId,
          tournamentId: earning.tournamentId,
          tournamentName: earning.tournamentName,
          tournamentDate: earning.tournamentDate,
          placement: earning.placement,
          earnings: earning.earnings,
          tier: earning.tier,
          gameMode: earning.gameMode,
          region: earning.region,
          season: earning.season,
          wikiUrl: earning.wikiUrl,
          teamSize: earning.teamSize,
          teammates: earning.teammates,
          orgSlugAtTime: currentRoster?.orgSlug,
        },
        update: {
          tournamentName: earning.tournamentName,
          tournamentDate: earning.tournamentDate,
          placement: earning.placement,
          earnings: earning.earnings,
          tier: earning.tier,
          gameMode: earning.gameMode,
          region: earning.region,
          season: earning.season,
          wikiUrl: earning.wikiUrl,
          teamSize: earning.teamSize,
          teammates: earning.teammates,
        },
      });
      synced++;
    } catch (error: any) {
      console.error(`Failed to sync earning for ${earning.tournamentName}:`, error.message);
    }
  }

  // Update player earnings summary
  await updatePlayerEarningsSummary(playerId);

  return synced;
}

/**
 * Update player earnings summary (aggregated stats)
 */
export async function updatePlayerEarningsSummary(playerId: string): Promise<void> {
  const earnings = await prisma.playerTournamentEarning.findMany({
    where: { playerId },
    orderBy: { tournamentDate: 'desc' },
  });

  if (earnings.length === 0) return;

  const totalEarnings = earnings.reduce((sum, e) => sum + Number(e.earnings), 0);
  const firstPlaceCount = earnings.filter(e => e.placement === 1).length;
  const top10Count = earnings.filter(e => e.placement <= 10).length;
  const avgPlacement = earnings.reduce((sum, e) => sum + e.placement, 0) / earnings.length;
  const bestPlacement = Math.min(...earnings.map(e => e.placement));
  const highestEarning = Math.max(...earnings.map(e => Number(e.earnings)));
  const lastTournamentDate = earnings[0]?.tournamentDate;

  // Calculate earnings by year
  const earningsByYear: Record<string, number> = {};
  for (const e of earnings) {
    const year = e.tournamentDate.getFullYear().toString();
    earningsByYear[year] = (earningsByYear[year] || 0) + Number(e.earnings);
  }

  // Calculate earnings by region
  const earningsByRegion: Record<string, number> = {};
  for (const e of earnings) {
    if (e.region) {
      earningsByRegion[e.region] = (earningsByRegion[e.region] || 0) + Number(e.earnings);
    }
  }

  await prisma.playerEarningsSummary.upsert({
    where: { playerId },
    create: {
      playerId,
      totalEarnings,
      tournamentCount: earnings.length,
      firstPlaceCount,
      top10Count,
      avgPlacement,
      bestPlacement,
      highestEarning,
      earningsByYear,
      earningsByRegion,
      lastTournamentDate,
    },
    update: {
      totalEarnings,
      tournamentCount: earnings.length,
      firstPlaceCount,
      top10Count,
      avgPlacement,
      bestPlacement,
      highestEarning,
      earningsByYear,
      earningsByRegion,
      lastTournamentDate,
      lastUpdated: new Date(),
    },
  });
}

/**
 * Update org earnings summary (sum of players' earnings while on roster)
 */
export async function updateOrgEarningsSummary(orgSlug: string): Promise<void> {
  // Get all earnings where players were on this org
  const earnings = await prisma.playerTournamentEarning.findMany({
    where: { orgSlugAtTime: orgSlug },
    include: { player: true },
  });

  if (earnings.length === 0) return;

  const totalEarnings = earnings.reduce((sum, e) => sum + Number(e.earnings), 0);
  const firstPlaceCount = earnings.filter(e => e.placement === 1).length;

  // Unique players
  const playerIds = new Set(earnings.map(e => e.playerId));
  const playerCount = playerIds.size;

  // Earnings by year
  const earningsByYear: Record<string, number> = {};
  for (const e of earnings) {
    const year = e.tournamentDate.getFullYear().toString();
    earningsByYear[year] = (earningsByYear[year] || 0) + Number(e.earnings);
  }

  // Top earners by player
  const earningsByPlayer: Record<string, { ign: string; earnings: number; tournaments: number }> = {};
  for (const e of earnings) {
    const key = e.playerId;
    if (!earningsByPlayer[key]) {
      earningsByPlayer[key] = {
        ign: e.player.currentIgn,
        earnings: 0,
        tournaments: 0,
      };
    }
    earningsByPlayer[key].earnings += Number(e.earnings);
    earningsByPlayer[key].tournaments += 1;
  }

  // Sort and take top 10
  const topEarners = Object.entries(earningsByPlayer)
    .sort((a, b) => b[1].earnings - a[1].earnings)
    .slice(0, 10)
    .map(([playerId, data]) => ({
      playerId,
      ...data,
    }));

  await prisma.orgEarningsSummary.upsert({
    where: { orgSlug },
    create: {
      orgSlug,
      totalEarnings,
      tournamentCount: earnings.length,
      firstPlaceCount,
      playerCount,
      earningsByYear,
      earningsByPlayer: topEarners,
    },
    update: {
      totalEarnings,
      tournamentCount: earnings.length,
      firstPlaceCount,
      playerCount,
      earningsByYear,
      earningsByPlayer: topEarners,
      lastUpdated: new Date(),
    },
  });
}

/**
 * Get org earnings summary
 */
export async function getOrgEarningsSummary(orgSlug: string): Promise<any> {
  return await prisma.orgEarningsSummary.findUnique({
    where: { orgSlug },
  });
}

/**
 * Get org earnings history (detailed)
 */
export async function getOrgEarningsHistory(
  orgSlug: string,
  options?: { limit?: number; offset?: number }
): Promise<any[]> {
  const { limit = 20, offset = 0 } = options || {};

  return await prisma.playerTournamentEarning.findMany({
    where: { orgSlugAtTime: orgSlug },
    include: { player: true },
    orderBy: { tournamentDate: 'desc' },
    take: limit,
    skip: offset,
  });
}

export const earningsService = {
  scrapePlayerEarnings,
  syncPlayerEarnings,
  updatePlayerEarningsSummary,
  updateOrgEarningsSummary,
  getOrgEarningsSummary,
  getOrgEarningsHistory,
};
