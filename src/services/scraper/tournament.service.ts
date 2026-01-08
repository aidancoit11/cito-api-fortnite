/**
 * Tournament Scraping Service
 * Scrapes ALL Fortnite tournaments from Liquipedia
 * Handles: historical tournaments, results, top 500 placements
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { prisma } from '../../db/client.js';
import NodeCache from 'node-cache';
import { proxyManager } from './proxy-manager.js';

const cache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache

const LIQUIPEDIA_BASE = 'https://liquipedia.net';
const LIQUIPEDIA_FORTNITE = `${LIQUIPEDIA_BASE}/fortnite`;

const headers = {
  'User-Agent': 'FortniteCompetitiveAPI/1.0 (Educational/Research)',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Fetch URL using proxy manager with fallback to direct
 */
async function fetchWithProxy(url: string): Promise<string> {
  try {
    return await proxyManager.fetch(url);
  } catch (error) {
    const response = await axios.get(url, { headers, timeout: 15000 });
    return response.data;
  }
}

// ============ TYPES ============

export interface ScrapedTournament {
  slug: string;
  name: string;
  tier: string | null;
  startDate: Date | null;
  endDate: Date | null;
  prizePool: number | null;
  region: string | null;
  format: string | null;
  organizer: string | null;
  status: 'upcoming' | 'ongoing' | 'completed';
  wikiUrl: string;
  logoUrl: string | null;
}

export interface TournamentDetails extends ScrapedTournament {
  description: string | null;
  venue: string | null;
  gameMode: string | null;
  teamSize: number | null;
  participantCount: number | null;
  results: TournamentPlacement[];
}

export interface TournamentPlacement {
  rank: number;
  playerName: string;
  playerWikiUrl: string | null;
  points: number | null;
  kills: number | null;
  earnings: number | null;
  teamName: string | null;
  teamMembers: string[] | null;
}

// ============ SCRAPING FUNCTIONS ============

/**
 * Scrape all tournaments from Liquipedia Portal
 * Gets tournaments from multiple year pages for complete history
 */
export async function scrapeAllTournaments(options?: {
  years?: number[];
  limit?: number;
}): Promise<ScrapedTournament[]> {
  const { years, limit } = options || {};

  // Default to all years from 2018 to current
  const currentYear = new Date().getFullYear();
  const targetYears = years || Array.from(
    { length: currentYear - 2017 },
    (_, i) => 2018 + i
  );

  const allTournaments: ScrapedTournament[] = [];
  const seenSlugs = new Set<string>();

  console.log(`Scraping tournaments for years: ${targetYears.join(', ')}`);

  for (const year of targetYears) {
    try {
      const yearTournaments = await scrapeTournamentsForYear(year);

      for (const tournament of yearTournaments) {
        if (!seenSlugs.has(tournament.slug)) {
          seenSlugs.add(tournament.slug);
          allTournaments.push(tournament);

          if (limit && allTournaments.length >= limit) {
            return allTournaments;
          }
        }
      }

      // Delay between years to be respectful
      await sleep(300);
    } catch (error: any) {
      console.error(`Failed to scrape tournaments for ${year}:`, error.message);
    }
  }

  // Also scrape the main tournaments portal for any we missed
  try {
    const portalTournaments = await scrapeTournamentsPortal();
    for (const tournament of portalTournaments) {
      if (!seenSlugs.has(tournament.slug)) {
        seenSlugs.add(tournament.slug);
        allTournaments.push(tournament);
      }
    }
  } catch (error: any) {
    console.error('Failed to scrape tournaments portal:', error.message);
  }

  console.log(`Total tournaments found: ${allTournaments.length}`);
  return allTournaments;
}

/**
 * Scrape tournaments for a specific year
 */
async function scrapeTournamentsForYear(year: number): Promise<ScrapedTournament[]> {
  const cacheKey = `tournaments_${year}`;
  const cached = cache.get<ScrapedTournament[]>(cacheKey);
  if (cached) return cached;

  const url = `${LIQUIPEDIA_FORTNITE}/Tournaments/${year}`;
  console.log(`Fetching: ${url}`);

  try {
    const html = await fetchWithProxy(url);
    const $ = cheerio.load(html);
    const tournaments: ScrapedTournament[] = [];

    // Process tournament tables
    $('table.wikitable').each((_, table) => {
      const $table = $(table);

      $table.find('tbody tr').each((_, row) => {
        const $row = $(row);
        const cells = $row.find('td');

        if (cells.length < 3) return;

        const tournament = parseTournamentRow($, $row, cells);
        if (tournament) {
          tournaments.push(tournament);
        }
      });
    });

    // Also look for tournament grids/divs
    $('.tournament-card, .gridRow, [class*="tournament"]').each((_, el) => {
      const tournament = parseTournamentElement($, $(el));
      if (tournament && !tournaments.find(t => t.slug === tournament.slug)) {
        tournaments.push(tournament);
      }
    });

    cache.set(cacheKey, tournaments);
    console.log(`Found ${tournaments.length} tournaments for ${year}`);
    return tournaments;
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.log(`No tournaments page for ${year}`);
      return [];
    }
    throw error;
  }
}

/**
 * Scrape main tournaments portal
 */
async function scrapeTournamentsPortal(): Promise<ScrapedTournament[]> {
  const cacheKey = 'tournaments_portal';
  const cached = cache.get<ScrapedTournament[]>(cacheKey);
  if (cached) return cached;

  const url = `${LIQUIPEDIA_FORTNITE}/Portal:Tournaments`;
  console.log(`Fetching: ${url}`);

  const html = await fetchWithProxy(url);
  const $ = cheerio.load(html);
  const tournaments: ScrapedTournament[] = [];

  // Process all tournament links on the portal
  $('a[href*="/fortnite/"]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';
    const name = $el.text().trim();

    // Skip non-tournament links
    if (!href ||
        href.includes('Portal:') ||
        href.includes('Category:') ||
        href.includes('Player_Transfers') ||
        href.includes('Teams') ||
        !name ||
        name.length < 3) {
      return;
    }

    // Check if this looks like a tournament
    const isTournament =
      href.includes('Cup') ||
      href.includes('Championship') ||
      href.includes('Tournament') ||
      href.includes('Series') ||
      href.includes('Finals') ||
      href.includes('FNCS') ||
      href.includes('World_Cup') ||
      href.includes('Cash_Cup') ||
      href.includes('Champion');

    if (isTournament) {
      const slug = href.split('/fortnite/')[1]?.replace(/\//g, '-').toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .replace(/--+/g, '-')
        .replace(/^-|-$/g, '');

      if (slug && slug.length > 2 && !tournaments.find(t => t.slug === slug)) {
        tournaments.push({
          slug,
          name,
          tier: null,
          startDate: null,
          endDate: null,
          prizePool: null,
          region: null,
          format: null,
          organizer: null,
          status: 'completed',
          wikiUrl: `${LIQUIPEDIA_BASE}${href}`,
          logoUrl: null,
        });
      }
    }
  });

  cache.set(cacheKey, tournaments);
  return tournaments;
}

/**
 * Parse tournament from table row
 */
function parseTournamentRow(
  $: cheerio.CheerioAPI,
  $row: any,
  cells: any
): ScrapedTournament | null {
  // Find tournament link
  const tournamentLink = $row.find('a[href*="/fortnite/"]').filter((_: number, el: any) => {
    const href = $(el).attr('href') || '';
    return !href.includes('Portal:') &&
           !href.includes('Category:') &&
           !href.includes('Player_Transfers');
  }).first();

  if (!tournamentLink.length) return null;

  const href = tournamentLink.attr('href') || '';
  const name = tournamentLink.text().trim() || tournamentLink.attr('title') || '';

  if (!name || name.length < 3) return null;

  const slug = createSlug(name);

  // Parse tier from first column or class
  let tier: string | null = null;
  const tierCell = cells.eq(0).text().trim().toLowerCase();
  if (tierCell.includes('s-tier') || tierCell.includes('premier')) tier = 'S';
  else if (tierCell.includes('a-tier') || tierCell.includes('major')) tier = 'A';
  else if (tierCell.includes('b-tier') || tierCell.includes('minor')) tier = 'B';
  else if (tierCell.includes('c-tier') || tierCell.includes('weekly')) tier = 'C';
  else if (tierCell.includes('monthly')) tier = 'Monthly';
  else if (tierCell.includes('show') || tierCell.includes('showmatch')) tier = 'Showmatch';

  // Parse dates
  const dateText = $row.find('td').map((_: number, cell: any) => $(cell).text()).get().join(' ');
  const { startDate, endDate } = parseDateRange(dateText);

  // Parse prize pool
  const prizePool = parsePrizePool($row.text());

  // Parse region
  const region = parseRegion($row.text());

  // Determine status
  const now = new Date();
  let status: 'upcoming' | 'ongoing' | 'completed' = 'completed';
  if (startDate && startDate > now) status = 'upcoming';
  else if (endDate && endDate >= now && startDate && startDate <= now) status = 'ongoing';

  return {
    slug,
    name,
    tier,
    startDate,
    endDate,
    prizePool,
    region,
    format: null,
    organizer: null,
    status,
    wikiUrl: `${LIQUIPEDIA_BASE}${href}`,
    logoUrl: null,
  };
}

/**
 * Parse tournament from div/card element
 */
function parseTournamentElement(
  _$: cheerio.CheerioAPI,
  $el: any
): ScrapedTournament | null {
  const link = $el.find('a[href*="/fortnite/"]').first();
  const href = link.attr('href');
  const name = link.text().trim() || link.attr('title') || '';

  if (!href || !name || name.length < 3) return null;
  if (href.includes('Portal:') || href.includes('Category:')) return null;

  const slug = createSlug(name);
  const text = $el.text();

  return {
    slug,
    name,
    tier: parseTier(text),
    startDate: parseDateRange(text).startDate,
    endDate: parseDateRange(text).endDate,
    prizePool: parsePrizePool(text),
    region: parseRegion(text),
    format: null,
    organizer: null,
    status: 'completed',
    wikiUrl: `${LIQUIPEDIA_BASE}${href}`,
    logoUrl: null,
  };
}

/**
 * Scrape detailed tournament info and results
 */
export async function scrapeTournamentDetails(wikiUrl: string): Promise<TournamentDetails | null> {
  const cacheKey = `tournament_details_${wikiUrl}`;
  const cached = cache.get<TournamentDetails>(cacheKey);
  if (cached) return cached;

  try {
    console.log(`Scraping tournament details: ${wikiUrl}`);
    const html = await fetchWithProxy(wikiUrl);
    const $ = cheerio.load(html);

    // Get basic info
    const name = $('h1').first().text().trim() ||
                 $('.firstHeading').text().trim();
    const slug = createSlug(name);

    // Parse infobox
    let tier: string | null = null;
    let startDate: Date | null = null;
    let endDate: Date | null = null;
    let prizePool: number | null = null;
    let region: string | null = null;
    let format: string | null = null;
    let organizer: string | null = null;
    let venue: string | null = null;
    let gameMode: string | null = null;
    let teamSize: number | null = null;
    let participantCount: number | null = null;

    // Parse from infobox
    $('.infobox-cell-2, .infobox tr, .fo-nttax-infobox div').each((_, el) => {
      const $el = $(el);
      const text = $el.text().toLowerCase();
      const value = $el.text();

      if (text.includes('tier')) {
        tier = parseTier(value);
      }
      if (text.includes('date') || text.includes('start')) {
        const dates = parseDateRange(value);
        if (dates.startDate) startDate = dates.startDate;
        if (dates.endDate) endDate = dates.endDate;
      }
      if (text.includes('prize') || text.includes('pool')) {
        prizePool = parsePrizePool(value);
      }
      if (text.includes('region') || text.includes('location')) {
        region = parseRegion(value) || extractRegionText(value);
      }
      if (text.includes('format') || text.includes('type')) {
        format = extractFormatText(value);
      }
      if (text.includes('organizer') || text.includes('host')) {
        organizer = extractOrganizerText($el, $);
      }
      if (text.includes('venue') || text.includes('location')) {
        venue = extractVenueText(value);
      }
      if (text.includes('mode') || text.includes('game mode')) {
        gameMode = extractGameMode(value);
      }
      if (text.includes('team size') || text.includes('players per')) {
        teamSize = extractTeamSize(value);
      }
      if (text.includes('participant') || text.includes('teams')) {
        participantCount = extractParticipantCount(value);
      }
    });

    // Get description from first paragraph
    const description = $('.mw-parser-output > p').first().text().trim() || null;

    // Get logo
    let logoUrl: string | null = null;
    const logoImg = $('.infobox-image img, .tournament-logo img').first();
    const logoSrc = logoImg.attr('src') || logoImg.attr('data-src');
    if (logoSrc && !logoSrc.includes('placeholder')) {
      logoUrl = logoSrc.startsWith('http') ? logoSrc : `${LIQUIPEDIA_BASE}${logoSrc}`;
    }

    // Determine status
    const now = new Date();
    let status: 'upcoming' | 'ongoing' | 'completed' = 'completed';
    if (startDate && (startDate as Date) > now) status = 'upcoming';
    else if (endDate && (endDate as Date) >= now && startDate && (startDate as Date) <= now) status = 'ongoing';

    // Scrape results
    const results = await scrapeTournamentResults($);

    const details: TournamentDetails = {
      slug,
      name,
      tier,
      startDate,
      endDate,
      prizePool,
      region,
      format,
      organizer,
      status,
      wikiUrl,
      logoUrl,
      description,
      venue,
      gameMode,
      teamSize,
      participantCount,
      results,
    };

    cache.set(cacheKey, details, 1800); // 30 min cache
    return details;
  } catch (error: any) {
    console.error(`Failed to scrape tournament details from ${wikiUrl}:`, error.message);
    return null;
  }
}

/**
 * Scrape tournament results/placements from page
 */
function scrapeTournamentResults($: cheerio.CheerioAPI): TournamentPlacement[] {
  const results: TournamentPlacement[] = [];
  const seenPlayers = new Set<string>();

  // Look for results tables
  $('table.wikitable, table.prizepooltable, .resulttable').each((_, table) => {
    const $table = $(table);
    const tableText = $table.text().toLowerCase();

    // Skip non-results tables
    if (!tableText.includes('place') &&
        !tableText.includes('rank') &&
        !tableText.includes('result') &&
        !tableText.includes('winner')) {
      return;
    }

    // Process rows
    $table.find('tbody tr, tr').each((_, row) => {
      const $row = $(row);
      const cells = $row.find('td');

      if (cells.length < 2) return;

      // Skip header rows
      if ($row.find('th').length > 0) return;

      const placement = parseRow($, $row, cells, seenPlayers);
      if (placement) {
        results.push(placement);
      }
    });
  });

  // Also check for prize pool templates (common on Liquipedia)
  $('.csstable-widget-row, .bracket-game').each((_, el) => {
    const $el = $(el);
    const placement = parsePrizePoolRow($, $el, seenPlayers);
    if (placement) {
      results.push(placement);
    }
  });

  // Sort by rank
  results.sort((a, b) => a.rank - b.rank);

  return results.slice(0, 500); // Top 500
}

/**
 * Parse placement from table row
 */
function parseRow(
  $: cheerio.CheerioAPI,
  $row: any,
  cells: any,
  seenPlayers: Set<string>
): TournamentPlacement | null {
  // Find rank (usually first cell with a number)
  let rank = 0;
  let rankFound = false;
  cells.each((_: number, cell: any) => {
    if (rankFound) return;
    const text = $(cell).text().trim();
    const rankMatch = text.match(/^(\d+)(st|nd|rd|th)?$/i);
    if (rankMatch && rankMatch[1]) {
      rank = parseInt(rankMatch[1], 10);
      rankFound = true;
    }
  });

  if (!rank || rank > 500) return null;

  // Find player/team
  const playerLink = $row.find('a[href*="/fortnite/"]').filter((_: number, el: any) => {
    const href = $(el).attr('href') || '';
    return !href.includes('Portal:') &&
           !href.includes('Category:') &&
           !href.includes('Tournament');
  }).first();

  let playerName = playerLink.text().trim();
  let playerWikiUrl = playerLink.attr('href');

  // If no link, try text content
  if (!playerName) {
    // Look for player name in cells (usually 2nd or 3rd column)
    for (let i = 1; i < cells.length && i < 4; i++) {
      const cellText = cells.eq(i).text().trim();
      if (cellText && cellText.length > 1 && cellText.length < 50 &&
          !cellText.match(/^\$/) && !cellText.match(/^\d+$/)) {
        playerName = cellText;
        break;
      }
    }
  }

  if (!playerName || seenPlayers.has(playerName.toLowerCase())) return null;
  seenPlayers.add(playerName.toLowerCase());

  // Parse earnings
  const rowText = $row.text();
  const earnings = parsePrizePool(rowText);

  // Parse points
  const points = parsePoints(rowText);

  // Parse kills
  const kills = parseKills(rowText);

  // Parse team info
  const teamName = parseTeamName($, $row);
  const teamMembers = parseTeamMembers($, $row);

  return {
    rank,
    playerName,
    playerWikiUrl: playerWikiUrl ? `${LIQUIPEDIA_BASE}${playerWikiUrl}` : null,
    points,
    kills,
    earnings,
    teamName,
    teamMembers,
  };
}

/**
 * Parse prize pool row (common template format)
 */
function parsePrizePoolRow(
  _$: cheerio.CheerioAPI,
  $el: any,
  seenPlayers: Set<string>
): TournamentPlacement | null {
  const text = $el.text();

  // Look for rank
  const rankMatch = text.match(/(\d+)(st|nd|rd|th)/i);
  if (!rankMatch) return null;
  const rank = parseInt(rankMatch[1], 10);
  if (rank > 500) return null;

  // Look for player
  const playerLink = $el.find('a[href*="/fortnite/"]').first();
  let playerName = playerLink.text().trim();
  const playerWikiUrl = playerLink.attr('href');

  if (!playerName || seenPlayers.has(playerName.toLowerCase())) return null;
  seenPlayers.add(playerName.toLowerCase());

  return {
    rank,
    playerName,
    playerWikiUrl: playerWikiUrl ? `${LIQUIPEDIA_BASE}${playerWikiUrl}` : null,
    points: parsePoints(text),
    kills: parseKills(text),
    earnings: parsePrizePool(text),
    teamName: null,
    teamMembers: null,
  };
}

// ============ DATABASE SYNC ============

/**
 * Sync all tournaments to database
 */
export async function syncTournamentsToDatabase(options?: {
  years?: number[];
  scrapeDetails?: boolean;
  scrapeResults?: boolean;
}): Promise<{ tournaments: number; results: number }> {
  const { years, scrapeDetails = false, scrapeResults = false } = options || {};

  console.log('Starting tournament sync to database...');
  const tournaments = await scrapeAllTournaments({ years });

  let syncedTournaments = 0;
  let syncedResults = 0;

  for (const tournament of tournaments) {
    try {
      // Get details if requested
      let details: TournamentDetails | null = null;
      if (scrapeDetails || scrapeResults) {
        details = await scrapeTournamentDetails(tournament.wikiUrl);
        await sleep(200); // Rate limit
      }

      // Upsert tournament
      await prisma.tournament.upsert({
        where: { tournamentId: tournament.slug },
        create: {
          tournamentId: tournament.slug,
          name: tournament.name,
          organizer: details?.organizer || tournament.organizer,
          startDate: tournament.startDate,
          endDate: tournament.endDate,
          region: tournament.region,
          prizePool: tournament.prizePool,
          format: details?.format || tournament.format,
          url: tournament.wikiUrl,
          isCompleted: tournament.status === 'completed',
          data: {
            tier: tournament.tier,
            logoUrl: tournament.logoUrl,
            description: details?.description,
            venue: details?.venue,
            gameMode: details?.gameMode,
            teamSize: details?.teamSize,
            participantCount: details?.participantCount,
            source: 'liquipedia',
          },
        },
        update: {
          name: tournament.name,
          organizer: details?.organizer || tournament.organizer,
          startDate: tournament.startDate,
          endDate: tournament.endDate,
          region: tournament.region,
          prizePool: tournament.prizePool,
          format: details?.format || tournament.format,
          url: tournament.wikiUrl,
          isCompleted: tournament.status === 'completed',
          data: {
            tier: tournament.tier,
            logoUrl: tournament.logoUrl,
            description: details?.description,
            venue: details?.venue,
            gameMode: details?.gameMode,
            teamSize: details?.teamSize,
            participantCount: details?.participantCount,
            source: 'liquipedia',
          },
          lastUpdated: new Date(),
        },
      });
      syncedTournaments++;

      // Sync results if we have them
      if (scrapeResults && details?.results) {
        for (const result of details.results) {
          try {
            // Create a unique account ID for wiki-sourced data
            const accountId = result.playerWikiUrl
              ? `wiki-${result.playerWikiUrl.split('/').pop()}`
              : `wiki-${result.playerName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

            await prisma.tournamentResult.upsert({
              where: {
                tournamentId_accountId: {
                  tournamentId: tournament.slug,
                  accountId,
                },
              },
              create: {
                tournamentId: tournament.slug,
                accountId,
                displayName: result.playerName,
                rank: result.rank,
                points: result.points || 0,
                kills: result.kills,
                earnings: result.earnings,
                teamName: result.teamName,
                data: {
                  teamMembers: result.teamMembers,
                  playerWikiUrl: result.playerWikiUrl,
                  source: 'liquipedia',
                },
              },
              update: {
                displayName: result.playerName,
                rank: result.rank,
                points: result.points || 0,
                kills: result.kills,
                earnings: result.earnings,
                teamName: result.teamName,
                data: {
                  teamMembers: result.teamMembers,
                  playerWikiUrl: result.playerWikiUrl,
                  source: 'liquipedia',
                },
              },
            });
            syncedResults++;
          } catch (error: any) {
            console.error(`Failed to sync result for ${result.playerName}:`, error.message);
          }
        }
      }

      // Log progress every 50 tournaments
      if (syncedTournaments % 50 === 0) {
        console.log(`Progress: ${syncedTournaments}/${tournaments.length} tournaments synced`);
      }
    } catch (error: any) {
      console.error(`Failed to sync tournament ${tournament.name}:`, error.message);
    }
  }

  console.log(`Sync complete: ${syncedTournaments} tournaments, ${syncedResults} results`);
  return { tournaments: syncedTournaments, results: syncedResults };
}

/**
 * Sync results for a specific tournament
 */
export async function syncTournamentResults(tournamentSlug: string): Promise<number> {
  const tournament = await prisma.tournament.findUnique({
    where: { tournamentId: tournamentSlug },
  });

  if (!tournament?.url) {
    console.error(`Tournament ${tournamentSlug} not found or has no URL`);
    return 0;
  }

  const details = await scrapeTournamentDetails(tournament.url);
  if (!details?.results) return 0;

  let synced = 0;
  for (const result of details.results) {
    try {
      const accountId = result.playerWikiUrl
        ? `wiki-${result.playerWikiUrl.split('/').pop()}`
        : `wiki-${result.playerName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

      await prisma.tournamentResult.upsert({
        where: {
          tournamentId_accountId: {
            tournamentId: tournamentSlug,
            accountId,
          },
        },
        create: {
          tournamentId: tournamentSlug,
          accountId,
          displayName: result.playerName,
          rank: result.rank,
          points: result.points || 0,
          kills: result.kills,
          earnings: result.earnings,
          teamName: result.teamName,
          data: {
            teamMembers: result.teamMembers,
            playerWikiUrl: result.playerWikiUrl,
          },
        },
        update: {
          displayName: result.playerName,
          rank: result.rank,
          points: result.points || 0,
          kills: result.kills,
          earnings: result.earnings,
          teamName: result.teamName,
          data: {
            teamMembers: result.teamMembers,
            playerWikiUrl: result.playerWikiUrl,
          },
        },
      });
      synced++;
    } catch (error: any) {
      console.error(`Failed to sync result for ${result.playerName}:`, error.message);
    }
  }

  return synced;
}

// ============ QUERY FUNCTIONS ============

/**
 * Get tournaments from database
 */
export async function getTournaments(options?: {
  status?: 'upcoming' | 'ongoing' | 'completed';
  region?: string;
  year?: number;
  tier?: string;
  limit?: number;
  offset?: number;
}): Promise<any[]> {
  const { status, region, year, tier, limit = 50, offset = 0 } = options || {};

  const where: any = {};

  if (status === 'upcoming') {
    where.startDate = { gt: new Date() };
  } else if (status === 'ongoing') {
    where.AND = [
      { startDate: { lte: new Date() } },
      { OR: [{ endDate: { gte: new Date() } }, { endDate: null }] },
    ];
  } else if (status === 'completed') {
    where.isCompleted = true;
  }

  if (region) {
    where.region = { contains: region, mode: 'insensitive' };
  }

  if (year) {
    where.startDate = {
      ...where.startDate,
      gte: new Date(`${year}-01-01`),
      lt: new Date(`${year + 1}-01-01`),
    };
  }

  if (tier) {
    where.data = { path: ['tier'], equals: tier };
  }

  return prisma.tournament.findMany({
    where,
    orderBy: { startDate: 'desc' },
    take: limit,
    skip: offset,
  });
}

/**
 * Get tournament by ID with results
 */
export async function getTournamentById(tournamentId: string): Promise<any> {
  return prisma.tournament.findUnique({
    where: { tournamentId },
    include: {
      results: {
        orderBy: { rank: 'asc' },
        take: 500,
      },
    },
  });
}

/**
 * Get tournament results
 */
export async function getTournamentResults(
  tournamentId: string,
  options?: { limit?: number; offset?: number }
): Promise<any[]> {
  const { limit = 100, offset = 0 } = options || {};

  return prisma.tournamentResult.findMany({
    where: { tournamentId },
    orderBy: { rank: 'asc' },
    take: limit,
    skip: offset,
  });
}

// ============ HELPER FUNCTIONS ============

function createSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseTier(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes('s-tier') || lower.includes('premier') || lower.includes('major')) return 'S';
  if (lower.includes('a-tier')) return 'A';
  if (lower.includes('b-tier')) return 'B';
  if (lower.includes('c-tier') || lower.includes('weekly')) return 'C';
  if (lower.includes('monthly')) return 'Monthly';
  if (lower.includes('qualifier')) return 'Qualifier';
  return null;
}

function parseDateRange(text: string): { startDate: Date | null; endDate: Date | null } {
  // Try ISO format: 2024-01-15
  const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/g);
  if (isoMatch && isoMatch.length >= 1 && isoMatch[0]) {
    const startDate = new Date(isoMatch[0]);
    const endDate = isoMatch.length > 1 && isoMatch[1] ? new Date(isoMatch[1]) : startDate;
    return { startDate, endDate };
  }

  // Try "Month Day, Year" format
  const dateRegex = /(\w+)\s+(\d{1,2}),?\s+(\d{4})/g;
  const matches = [...text.matchAll(dateRegex)];
  if (matches.length > 0 && matches[0] && matches[0][0]) {
    const startDate = new Date(matches[0][0]);
    const endDate = matches.length > 1 && matches[1] && matches[1][0] ? new Date(matches[1][0]) : startDate;
    if (!isNaN(startDate.getTime())) {
      return { startDate, endDate: isNaN(endDate.getTime()) ? startDate : endDate };
    }
  }

  // Try "Day Month Year" format
  const euDateRegex = /(\d{1,2})\s+(\w+)\s+(\d{4})/g;
  const euMatches = [...text.matchAll(euDateRegex)];
  if (euMatches.length > 0 && euMatches[0] && euMatches[0][0]) {
    const startDate = new Date(euMatches[0][0]);
    if (!isNaN(startDate.getTime())) {
      const endDate = euMatches.length > 1 && euMatches[1] && euMatches[1][0] ? new Date(euMatches[1][0]) : startDate;
      return { startDate, endDate };
    }
  }

  return { startDate: null, endDate: null };
}

function parsePrizePool(text: string): number | null {
  // Remove commas and find dollar amounts
  const cleaned = text.replace(/,/g, '');

  // Match $X.XM (millions)
  const millionMatch = cleaned.match(/\$\s*([\d.]+)\s*[mM]/);
  if (millionMatch && millionMatch[1]) {
    return parseFloat(millionMatch[1]) * 1000000;
  }

  // Match $X.XK (thousands)
  const thousandMatch = cleaned.match(/\$\s*([\d.]+)\s*[kK]/);
  if (thousandMatch && thousandMatch[1]) {
    return parseFloat(thousandMatch[1]) * 1000;
  }

  // Match plain dollar amount
  const dollarMatch = cleaned.match(/\$\s*([\d.]+)/);
  if (dollarMatch && dollarMatch[1]) {
    const value = parseFloat(dollarMatch[1]);
    return value > 0 ? value : null;
  }

  return null;
}

function parseRegion(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes('na-east') || lower.includes('nae')) return 'NA East';
  if (lower.includes('na-west') || lower.includes('naw')) return 'NA West';
  if (lower.includes('europe') || lower.includes(' eu ') || lower.includes('eu-')) return 'Europe';
  if (lower.includes('brazil') || lower.includes(' br ') || lower.includes('br-')) return 'Brazil';
  if (lower.includes('asia') || lower.includes('apac')) return 'Asia';
  if (lower.includes('oceania') || lower.includes(' oce ') || lower.includes('oce-')) return 'Oceania';
  if (lower.includes('middle east') || lower.includes(' me ')) return 'Middle East';
  if (lower.includes('north america') || lower.includes(' na ')) return 'NA';
  if (lower.includes('global') || lower.includes('worldwide')) return 'Global';
  return null;
}

function parsePoints(text: string): number | null {
  const match = text.match(/(\d+)\s*(?:pts?|points)/i);
  return match && match[1] ? parseInt(match[1], 10) : null;
}

function parseKills(text: string): number | null {
  const match = text.match(/(\d+)\s*(?:kills?|elims?|eliminations?)/i);
  return match && match[1] ? parseInt(match[1], 10) : null;
}

function parseTeamName(_$: cheerio.CheerioAPI, $row: any): string | null {
  // Look for team in specific cells or data attributes
  const teamSpan = $row.find('[data-highlighting-class]').first();
  if (teamSpan.length) {
    const team = teamSpan.attr('data-highlighting-class');
    if (team && team.length > 1) return team;
  }
  return null;
}

function parseTeamMembers($: cheerio.CheerioAPI, $row: any): string[] | null {
  const members: string[] = [];
  $row.find('a[href*="/fortnite/"]').each((_: number, el: any) => {
    const href = $(el).attr('href') || '';
    if (!href.includes('Portal:') && !href.includes('Category:')) {
      const name = $(el).text().trim();
      if (name && name.length > 1 && name.length < 50 && !members.includes(name)) {
        members.push(name);
      }
    }
  });
  return members.length > 1 ? members : null;
}

function extractRegionText(text: string): string | null {
  // Extract region from format like "Region: Europe"
  const match = text.match(/(?:region|location)[:\s]+([^,\n]+)/i);
  return match && match[1] ? match[1].trim() : null;
}

function extractFormatText(text: string): string | null {
  const match = text.match(/(?:format|type)[:\s]+([^,\n]+)/i);
  return match && match[1] ? match[1].trim() : null;
}

function extractOrganizerText($el: any, _$: cheerio.CheerioAPI): string | null {
  const link = $el.find('a').first();
  return link.text().trim() || $el.text().replace(/organizer/i, '').replace(/:/g, '').trim() || null;
}

function extractVenueText(text: string): string | null {
  const match = text.match(/(?:venue|location)[:\s]+([^,\n]+)/i);
  return match && match[1] ? match[1].trim() : null;
}

function extractGameMode(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes('solo')) return 'Solo';
  if (lower.includes('duo')) return 'Duos';
  if (lower.includes('trio')) return 'Trios';
  if (lower.includes('squad')) return 'Squads';
  return null;
}

function extractTeamSize(text: string): number | null {
  const match = text.match(/(\d+)\s*(?:players?|per team)/i);
  return match && match[1] ? parseInt(match[1], 10) : null;
}

function extractParticipantCount(text: string): number | null {
  const match = text.match(/(\d+)\s*(?:teams?|participants?|players?)/i);
  return match && match[1] ? parseInt(match[1], 10) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ EXPORTS ============

export const tournamentService = {
  scrapeAllTournaments,
  scrapeTournamentDetails,
  syncTournamentsToDatabase,
  syncTournamentResults,
  getTournaments,
  getTournamentById,
  getTournamentResults,
};
