/**
 * Tournament Scraping Service
 * Scrapes ALL Fortnite tournaments from Liquipedia
 * Handles: historical tournaments, results, top 500 placements
 * Links results to existing players/orgs in database
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { prisma } from '../../db/client.js';
import NodeCache from 'node-cache';
import { proxyManager } from '../../utils/proxy-manager.js';

const cache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache

const LIQUIPEDIA_BASE = 'https://liquipedia.net';
const LIQUIPEDIA_FORTNITE = `${LIQUIPEDIA_BASE}/fortnite`;

const headers = {
  'User-Agent': 'FortniteCompetitiveAPI/1.0 (Educational/Research)',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Fetch URL with rotating proxy support
 */
async function fetchWithProxy(url: string, retries = 3): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const proxyConfig = proxyManager.getAxiosConfig();
      const response = await axios.get(url, {
        headers,
        timeout: 20000,
        ...proxyConfig,
      });
      return response.data;
    } catch (error: any) {
      lastError = error;
      console.log(`[Tournament] Request failed (attempt ${attempt + 1}/${retries}): ${error.message}`);

      // If proxy failed, try next one
      if (attempt < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  throw lastError || new Error('Failed to fetch URL');
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
  participantCount: number | null;
}

export interface TournamentDetails extends ScrapedTournament {
  description: string | null;
  venue: string | null;
  gameMode: string | null;
  teamSize: number | null;
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

// ============ MAJOR TOURNAMENT SERIES ============

const MAJOR_TOURNAMENT_SERIES = [
  'Fortnite_Champion_Series', // FNCS (main competitive series)
  'Fortnite_World_Cup',
  'FNCS_Global_Championship',
  'FNCS_Invitational',
  'Cash_Cup',
  'Champion_Cash_Cup',
  'Contender_Cash_Cup',
  'DreamHack',
  'Twitch_Rivals',
  'Elite_Cup',
  'Reload_Elite_Series',
];

// Years to scrape for historical data
const HISTORICAL_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

// ============ SCRAPING FUNCTIONS ============

/**
 * Scrape all tournaments from Liquipedia Portal using correct CSS selectors
 */
export async function scrapeAllTournaments(options?: {
  years?: number[];
  limit?: number;
  includeSeriesPages?: boolean;
}): Promise<ScrapedTournament[]> {
  const { limit, includeSeriesPages = true } = options || {};

  const allTournaments: ScrapedTournament[] = [];
  const seenSlugs = new Set<string>();

  // 1. Scrape main Portal:Tournaments page (uses gridTable structure)
  console.log('Scraping Portal:Tournaments...');
  try {
    const portalTournaments = await scrapeTournamentsPortal();
    for (const tournament of portalTournaments) {
      if (!seenSlugs.has(tournament.slug)) {
        seenSlugs.add(tournament.slug);
        allTournaments.push(tournament);
        if (limit && allTournaments.length >= limit) return allTournaments;
      }
    }
    console.log(`Found ${portalTournaments.length} tournaments from portal`);
  } catch (error: any) {
    console.error('Failed to scrape portal:', error.message);
  }

  // 2. Scrape major tournament series pages for historical data
  if (includeSeriesPages) {
    for (const series of MAJOR_TOURNAMENT_SERIES) {
      try {
        console.log(`Scraping series: ${series}...`);
        const seriesTournaments = await scrapeTournamentSeriesPage(series);

        for (const tournament of seriesTournaments) {
          if (!seenSlugs.has(tournament.slug)) {
            seenSlugs.add(tournament.slug);
            allTournaments.push(tournament);
            if (limit && allTournaments.length >= limit) return allTournaments;
          }
        }
        console.log(`Found ${seriesTournaments.length} tournaments from ${series}`);
        await sleep(300); // Rate limit
      } catch (error: any) {
        console.error(`Failed to scrape ${series}:`, error.message);
      }
    }

    // 3. Scrape FNCS by year (main source of historical tournaments)
    for (const year of HISTORICAL_YEARS) {
      try {
        const fncsYearUrl = `${LIQUIPEDIA_FORTNITE}/Fortnite_Champion_Series/${year}`;
        console.log(`Scraping FNCS ${year}...`);
        const yearTournaments = await scrapeTournamentsFromPage(fncsYearUrl);

        for (const tournament of yearTournaments) {
          if (!seenSlugs.has(tournament.slug)) {
            seenSlugs.add(tournament.slug);
            allTournaments.push(tournament);
          }
        }
        console.log(`Found ${yearTournaments.length} tournaments from FNCS ${year}`);
        await sleep(300);
      } catch (error: any) {
        // FNCS didn't exist before 2019, ignore 404s
        if (!error.message?.includes('404')) {
          console.error(`Failed to scrape FNCS ${year}:`, error.message);
        }
      }
    }
  }

  console.log(`Total tournaments found: ${allTournaments.length}`);
  return allTournaments;
}

/**
 * Scrape main tournaments portal - uses gridTable.tournamentCard structure
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

  // Parse gridTable tournamentCard structure (current Liquipedia format)
  $('.gridTable.tournamentCard').each((_, table) => {
    const $table = $(table);

    // Process each gridRow
    $table.find('.gridRow').each((_, row) => {
      const $row = $(row);
      const tournament = parseGridRow($, $row);
      if (tournament && !tournaments.find(t => t.slug === tournament.slug)) {
        tournaments.push(tournament);
      }
    });
  });

  // Also process any divTable structure (alternative format)
  $('.divTable').each((_, table) => {
    const $table = $(table);
    $table.find('.divRow').each((_, row) => {
      const $row = $(row);
      const tournament = parseDivRow($, $row);
      if (tournament && !tournaments.find(t => t.slug === tournament.slug)) {
        tournaments.push(tournament);
      }
    });
  });

  cache.set(cacheKey, tournaments);
  return tournaments;
}

/**
 * Parse a gridRow from the tournament portal
 */
function parseGridRow($: cheerio.CheerioAPI, $row: any): ScrapedTournament | null {
  // Find tournament link in the Tournament cell
  const tournamentCell = $row.find('.gridCell.Tournament');
  const tournamentLink = tournamentCell.find('a[href*="/fortnite/"]').filter((_: number, el: any) => {
    const href = $(el).attr('href') || '';
    return !href.includes('Category:') && !href.includes('Portal:');
  }).last(); // Last link is usually the specific tournament

  if (!tournamentLink.length) return null;

  const href = tournamentLink.attr('href') || '';
  const name = tournamentLink.attr('title') || tournamentLink.text().trim();

  if (!name || name.length < 3) return null;

  const slug = createSlug(href.split('/fortnite/')[1] || name);

  // Parse tier
  const tierCell = $row.find('.gridCell.Tier');
  const tier = parseTierFromCell(tierCell, $);

  // Parse date
  const dateCell = $row.find('.gridCell.Date');
  const dateText = dateCell.text().trim();
  const { startDate, endDate } = parseDateRange(dateText);

  // Parse prize pool
  const prizeCell = $row.find('.gridCell.Prize');
  const prizePool = parsePrizePool(prizeCell.text());

  // Parse region/location
  const locationCell = $row.find('.gridCell.Location');
  const region = parseRegionFromCell(locationCell, $);

  // Parse participant count
  const participantCell = $row.find('.gridCell.PlayerNumber');
  const participantCount = parseParticipantCount(participantCell.text());

  // Get logo URL
  const logoImg = tournamentCell.find('img').first();
  let logoUrl: string | null = null;
  const logoSrc = logoImg.attr('src') || logoImg.attr('data-src');
  if (logoSrc && !logoSrc.includes('placeholder')) {
    logoUrl = logoSrc.startsWith('http') ? logoSrc : `${LIQUIPEDIA_BASE}${logoSrc}`;
  }

  // Determine status
  const now = new Date();
  let status: 'upcoming' | 'ongoing' | 'completed' = 'completed';
  if (startDate && startDate > now) status = 'upcoming';
  else if (endDate && endDate >= now && startDate && startDate <= now) status = 'ongoing';

  // Check for TBD winner to determine if upcoming/ongoing
  const winnerCell = $row.find('.gridCell.FirstPlace');
  if (winnerCell.text().includes('TBD')) {
    if (startDate && startDate > now) status = 'upcoming';
    else status = 'ongoing';
  }

  return {
    slug,
    name,
    tier,
    startDate,
    endDate,
    prizePool,
    region,
    format: null,
    organizer: 'Epic Games',
    status,
    wikiUrl: `${LIQUIPEDIA_BASE}${href}`,
    logoUrl,
    participantCount,
  };
}

/**
 * Parse divRow format (alternative table structure)
 */
function parseDivRow(_$: cheerio.CheerioAPI, $row: any): ScrapedTournament | null {
  const link = $row.find('a[href*="/fortnite/"]').first();
  const href = link.attr('href');
  const name = link.text().trim() || link.attr('title');

  if (!href || !name || name.length < 3) return null;
  if (href.includes('Portal:') || href.includes('Category:')) return null;

  const slug = createSlug(href.split('/fortnite/')[1] || name);
  const text = $row.text();

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
    participantCount: null,
  };
}

/**
 * Scrape a tournament series main page (e.g., FNCS main page)
 */
async function scrapeTournamentSeriesPage(seriesName: string): Promise<ScrapedTournament[]> {
  const url = `${LIQUIPEDIA_FORTNITE}/${seriesName}`;

  try {
    const html = await fetchWithProxy(url);
    const $ = cheerio.load(html);
    const tournaments: ScrapedTournament[] = [];

    // Look for tournament links in navigation boxes, tables, etc.
    $('a[href*="/fortnite/"]').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href') || '';
      const name = $el.text().trim() || $el.attr('title') || '';

      // Skip non-tournament links
      if (!href ||
          href.includes('Category:') ||
          href.includes('Portal:') ||
          href.includes('Player_Transfers') ||
          href === `/fortnite/${seriesName}` ||
          name.length < 5) {
        return;
      }

      // Check if looks like a tournament event
      const isTournament =
        href.includes('Major') ||
        href.includes('Finals') ||
        href.includes('Grand_Finals') ||
        href.includes('Invitational') ||
        href.includes('Championship') ||
        href.includes('Week') ||
        href.includes('Round') ||
        href.includes('Qualifier') ||
        href.includes('Season') ||
        href.includes('Chapter');

      if (isTournament) {
        const slug = createSlug(href.split('/fortnite/')[1] || name);

        if (!tournaments.find(t => t.slug === slug)) {
          tournaments.push({
            slug,
            name,
            tier: seriesName.includes('Champion') ? 'S' : 'A',
            startDate: null,
            endDate: null,
            prizePool: null,
            region: parseRegion(name),
            format: null,
            organizer: 'Epic Games',
            status: 'completed',
            wikiUrl: `${LIQUIPEDIA_BASE}${href}`,
            logoUrl: null,
            participantCount: null,
          });
        }
      }
    });

    return tournaments;
  } catch (error: any) {
    if (error.response?.status === 404) {
      return [];
    }
    throw error;
  }
}

/**
 * Scrape tournaments from any Liquipedia page
 */
async function scrapeTournamentsFromPage(url: string): Promise<ScrapedTournament[]> {
  try {
    const html = await fetchWithProxy(url);
    const $ = cheerio.load(html);
    const tournaments: ScrapedTournament[] = [];

    // Parse gridTable structure
    $('.gridTable.tournamentCard .gridRow, .gridTable .gridRow').each((_, row) => {
      const $row = $(row);
      const tournament = parseGridRow($, $row);
      if (tournament && !tournaments.find(t => t.slug === tournament.slug)) {
        tournaments.push(tournament);
      }
    });

    // Parse wikitable structure
    $('table.wikitable tbody tr').each((_, row) => {
      const $row = $(row);
      const cells = $row.find('td');
      if (cells.length < 2) return;

      const tournament = parseTournamentTableRow($, $row, cells);
      if (tournament && !tournaments.find(t => t.slug === tournament.slug)) {
        tournaments.push(tournament);
      }
    });

    // Find tournament links in content
    $('.mw-parser-output a[href*="/fortnite/"]').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href') || '';
      const name = $el.text().trim();

      if (!href || href.includes('Category:') || href.includes('Portal:') || !name) return;

      // Check if this looks like a tournament
      const isTournament =
        href.includes('Finals') ||
        href.includes('Major') ||
        href.includes('Grand_Finals') ||
        href.includes('Week_') ||
        (href.includes('FNCS') && !href.includes('Fortnite_Champion_Series/'));

      if (isTournament) {
        const slug = createSlug(href.split('/fortnite/')[1] || name);
        if (!tournaments.find(t => t.slug === slug)) {
          tournaments.push({
            slug,
            name,
            tier: 'A',
            startDate: null,
            endDate: null,
            prizePool: null,
            region: parseRegion(name) || parseRegion(href),
            format: null,
            organizer: 'Epic Games',
            status: 'completed',
            wikiUrl: `${LIQUIPEDIA_BASE}${href}`,
            logoUrl: null,
            participantCount: null,
          });
        }
      }
    });

    return tournaments;
  } catch (error: any) {
    if (error.response?.status === 404) {
      return [];
    }
    throw error;
  }
}

/**
 * Parse tournament from wikitable row
 */
function parseTournamentTableRow(
  $: cheerio.CheerioAPI,
  $row: any,
  _cells: any
): ScrapedTournament | null {
  const tournamentLink = $row.find('a[href*="/fortnite/"]').filter((_: number, el: any) => {
    const href = $(el).attr('href') || '';
    return !href.includes('Portal:') && !href.includes('Category:');
  }).first();

  if (!tournamentLink.length) return null;

  const href = tournamentLink.attr('href') || '';
  const name = tournamentLink.text().trim() || tournamentLink.attr('title') || '';

  if (!name || name.length < 3) return null;

  const slug = createSlug(href.split('/fortnite/')[1] || name);
  const rowText = $row.text();

  return {
    slug,
    name,
    tier: parseTier(rowText),
    startDate: parseDateRange(rowText).startDate,
    endDate: parseDateRange(rowText).endDate,
    prizePool: parsePrizePool(rowText),
    region: parseRegion(rowText),
    format: null,
    organizer: null,
    status: 'completed',
    wikiUrl: `${LIQUIPEDIA_BASE}${href}`,
    logoUrl: null,
    participantCount: null,
  };
}

/**
 * Scrape detailed tournament info and results (top 500)
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

    // Parse infobox for tournament metadata
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

    // Parse infobox (multiple possible formats)
    $('.infobox-cell-2, .infobox tr, .fo-nttax-infobox div, .infobox-description').each((_, el) => {
      const $el = $(el);
      const label = $el.find('.infobox-cell-1, th').text().toLowerCase();
      const value = $el.find('.infobox-cell-2, td').text() || $el.text();

      if (label.includes('tier') || label.includes('type')) {
        tier = parseTier(value);
      }
      if (label.includes('date') || label.includes('start')) {
        const dates = parseDateRange(value);
        if (dates.startDate) startDate = dates.startDate;
        if (dates.endDate) endDate = dates.endDate;
      }
      if (label.includes('prize') || label.includes('pool')) {
        prizePool = parsePrizePool(value);
      }
      if (label.includes('region') || label.includes('server')) {
        region = parseRegion(value) || extractRegionText(value);
      }
      if (label.includes('format') || label.includes('mode')) {
        format = extractFormatText(value);
        gameMode = extractGameMode(value);
      }
      if (label.includes('organizer') || label.includes('host')) {
        organizer = extractOrganizerText($el, $);
      }
      if (label.includes('venue') || label.includes('location')) {
        venue = extractVenueText(value);
      }
      if (label.includes('team size') || label.includes('players per')) {
        teamSize = extractTeamSize(value);
      }
      if (label.includes('participant') || label.includes('teams') || label.includes('players')) {
        participantCount = extractParticipantCountNum(value);
      }
    });

    // Get description
    const description = $('.mw-parser-output > p').first().text().trim() || null;

    // Get logo
    let logoUrl: string | null = null;
    const logoImg = $('.infobox-image img, .tournament-logo img, .infobox img').first();
    const logoSrc = logoImg.attr('src') || logoImg.attr('data-src');
    if (logoSrc && !logoSrc.includes('placeholder')) {
      logoUrl = logoSrc.startsWith('http') ? logoSrc : `${LIQUIPEDIA_BASE}${logoSrc}`;
    }

    // Determine status
    const now = new Date();
    let status: 'upcoming' | 'ongoing' | 'completed' = 'completed';
    const sd = startDate as Date | null;
    const ed = endDate as Date | null;
    if (sd && sd > now) status = 'upcoming';
    else if (ed && sd && ed >= now && sd <= now) status = 'ongoing';

    // Scrape results (top 500 placements)
    const results = scrapeTournamentResults($);

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
      participantCount,
      description,
      venue,
      gameMode,
      teamSize,
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

  // 1. Look for prizepooltable (most common format)
  $('.prizepooltable, .csstable-widget').each((_, table) => {
    const $table = $(table);

    $table.find('.csstable-widget-row, .prizepooltable-row, tr').each((_, row) => {
      const $row = $(row);
      const placement = parsePrizePoolTableRow($, $row, seenPlayers);
      if (placement) {
        results.push(placement);
      }
    });
  });

  // 2. Look for results tables (wikitable format)
  $('table.wikitable').each((_, table) => {
    const $table = $(table);
    const tableText = $table.text().toLowerCase();

    // Skip non-results tables
    if (!tableText.includes('place') &&
        !tableText.includes('rank') &&
        !tableText.includes('result') &&
        !tableText.includes('prize') &&
        !tableText.includes('winner')) {
      return;
    }

    $table.find('tbody tr, tr').each((_, row) => {
      const $row = $(row);
      if ($row.find('th').length > 0) return; // Skip header

      const cells = $row.find('td');
      if (cells.length < 2) return;

      const placement = parseResultsTableRow($, $row, cells, seenPlayers);
      if (placement) {
        results.push(placement);
      }
    });
  });

  // 3. Look for bracket results
  $('.bracket-game, .bracket-team-top, .bracket-team-bottom').each((_, el) => {
    const $el = $(el);
    const placement = parseBracketResult($, $el, seenPlayers);
    if (placement) {
      results.push(placement);
    }
  });

  // Sort by rank and limit to top 500
  results.sort((a, b) => a.rank - b.rank);
  return results.slice(0, 500);
}

/**
 * Parse prize pool table row (common Liquipedia format)
 */
function parsePrizePoolTableRow(
  $: cheerio.CheerioAPI,
  $row: any,
  seenPlayers: Set<string>
): TournamentPlacement | null {
  const text = $row.text();

  // Look for rank (1st, 2nd, 3rd, etc.)
  const rankMatch = text.match(/(\d+)(?:st|nd|rd|th)?(?:\s*[-–]?\s*\d+(?:st|nd|rd|th)?)?/);
  if (!rankMatch) return null;

  const rank = parseInt(rankMatch[1], 10);
  if (rank <= 0 || rank > 500) return null;

  // Find player/team link
  const playerLink = $row.find('a[href*="/fortnite/"]').filter((_: number, el: any) => {
    const href = $(el).attr('href') || '';
    return !href.includes('Category:') &&
           !href.includes('Portal:') &&
           !href.includes('Tournament') &&
           !href.includes('Cup') &&
           !href.includes('Championship');
  }).first();

  let playerName = playerLink.text().trim();
  let playerWikiUrl = playerLink.attr('href');

  // Also try span with player name
  if (!playerName) {
    const nameSpan = $row.find('.name, .block-player .name, .team-template-text').first();
    playerName = nameSpan.text().trim();
  }

  if (!playerName || playerName === 'TBD' || seenPlayers.has(playerName.toLowerCase())) {
    return null;
  }
  seenPlayers.add(playerName.toLowerCase());

  // Parse additional stats
  const earnings = parsePrizePool(text);
  const points = parsePoints(text);
  const kills = parseKills(text);

  // Parse team info
  const teamName = parseTeamNameFromRow($, $row);
  const teamMembers = parseTeamMembersFromRow($, $row);

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
 * Parse results from standard wikitable row
 */
function parseResultsTableRow(
  $: cheerio.CheerioAPI,
  $row: any,
  cells: any,
  seenPlayers: Set<string>
): TournamentPlacement | null {
  // Find rank (usually first numeric cell)
  let rank = 0;
  for (let i = 0; i < cells.length; i++) {
    const cellText = cells.eq(i).text().trim();
    const rankMatch = cellText.match(/^(\d+)(st|nd|rd|th)?$/i);
    if (rankMatch && rankMatch[1]) {
      rank = parseInt(rankMatch[1], 10);
      break;
    }
  }

  if (!rank || rank > 500) return null;

  // Find player link
  const playerLink = $row.find('a[href*="/fortnite/"]').filter((_: number, el: any) => {
    const href = $(el).attr('href') || '';
    return !href.includes('Portal:') &&
           !href.includes('Category:') &&
           !href.includes('Tournament');
  }).first();

  let playerName = playerLink.text().trim();
  const playerWikiUrl = playerLink.attr('href');

  // If no link, look for text in cells
  if (!playerName) {
    for (let i = 1; i < Math.min(cells.length, 4); i++) {
      const cellText = cells.eq(i).text().trim();
      if (cellText &&
          cellText.length > 1 &&
          cellText.length < 50 &&
          !cellText.match(/^\$/) &&
          !cellText.match(/^\d+$/) &&
          cellText !== 'TBD') {
        playerName = cellText;
        break;
      }
    }
  }

  if (!playerName || seenPlayers.has(playerName.toLowerCase())) return null;
  seenPlayers.add(playerName.toLowerCase());

  const rowText = $row.text();

  return {
    rank,
    playerName,
    playerWikiUrl: playerWikiUrl ? `${LIQUIPEDIA_BASE}${playerWikiUrl}` : null,
    points: parsePoints(rowText),
    kills: parseKills(rowText),
    earnings: parsePrizePool(rowText),
    teamName: parseTeamNameFromRow($, $row),
    teamMembers: parseTeamMembersFromRow($, $row),
  };
}

/**
 * Parse bracket result
 */
function parseBracketResult(
  _$: cheerio.CheerioAPI,
  $el: any,
  seenPlayers: Set<string>
): TournamentPlacement | null {
  const text = $el.text();
  const playerLink = $el.find('a[href*="/fortnite/"]').first();
  const playerName = playerLink.text().trim();
  const playerWikiUrl = playerLink.attr('href');

  if (!playerName || playerName === 'TBD' || seenPlayers.has(playerName.toLowerCase())) {
    return null;
  }

  // Try to determine rank from bracket position
  let rank = 999;
  if ($el.hasClass('bracket-team-top') || text.includes('Winner')) rank = 1;
  else if ($el.hasClass('bracket-team-bottom') || text.includes('Runner')) rank = 2;

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
 * Sync all tournaments to database with player/org linking
 */
export async function syncTournamentsToDatabase(options?: {
  years?: number[];
  scrapeDetails?: boolean;
  scrapeResults?: boolean;
}): Promise<{ tournaments: number; results: number }> {
  const { years, scrapeDetails = false, scrapeResults = false } = options || {};

  console.log('Starting tournament sync to database...');
  const tournaments = await scrapeAllTournaments({ years, includeSeriesPages: true });

  let syncedTournaments = 0;
  let syncedResults = 0;

  for (const tournament of tournaments) {
    try {
      // Get details if requested
      let details: TournamentDetails | null = null;
      if (scrapeDetails || scrapeResults) {
        details = await scrapeTournamentDetails(tournament.wikiUrl);
        await sleep(250); // Rate limit
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
            participantCount: tournament.participantCount || details?.participantCount,
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
            participantCount: tournament.participantCount || details?.participantCount,
            source: 'liquipedia',
          },
          lastUpdated: new Date(),
        },
      });
      syncedTournaments++;

      // Sync results with player/org linking
      if (scrapeResults && details?.results) {
        for (const result of details.results) {
          try {
            const linkedData = await linkResultToPlayerAndOrg(result);

            // Create unique account ID
            const accountId = linkedData.playerId ||
              (result.playerWikiUrl
                ? `wiki-${result.playerWikiUrl.split('/').pop()}`
                : `wiki-${result.playerName.toLowerCase().replace(/[^a-z0-9]/g, '')}`);

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
                teamName: linkedData.orgName || result.teamName,
                data: {
                  teamMembers: result.teamMembers,
                  playerWikiUrl: result.playerWikiUrl,
                  linkedPlayerId: linkedData.playerId,
                  linkedOrgSlug: linkedData.orgSlug,
                  source: 'liquipedia',
                },
              },
              update: {
                displayName: result.playerName,
                rank: result.rank,
                points: result.points || 0,
                kills: result.kills,
                earnings: result.earnings,
                teamName: linkedData.orgName || result.teamName,
                data: {
                  teamMembers: result.teamMembers,
                  playerWikiUrl: result.playerWikiUrl,
                  linkedPlayerId: linkedData.playerId,
                  linkedOrgSlug: linkedData.orgSlug,
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

      // Log progress
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
 * Link tournament result to existing player and org in database
 */
async function linkResultToPlayerAndOrg(result: TournamentPlacement): Promise<{
  playerId: string | null;
  orgSlug: string | null;
  orgName: string | null;
}> {
  let playerId: string | null = null;
  let orgSlug: string | null = null;
  let orgName: string | null = null;

  try {
    // Try to find player by name (case-insensitive search)
    const player = await prisma.player.findFirst({
      where: {
        OR: [
          { currentIgn: { equals: result.playerName, mode: 'insensitive' } },
          { currentIgn: { contains: result.playerName, mode: 'insensitive' } },
        ],
      },
      include: {
        rosterHistory: {
          where: { isActive: true },
          include: { organization: true },
          take: 1,
        },
      },
    });

    if (player) {
      playerId = player.playerId;

      // If player has an active org roster, use it
      const activeRoster = player.rosterHistory?.[0];
      if (activeRoster?.organization) {
        orgSlug = activeRoster.organization.slug;
        orgName = activeRoster.organization.name;
      }
    }

    // If result has team name, try to find that org
    if (!orgSlug && result.teamName) {
      const org = await prisma.organization.findFirst({
        where: {
          OR: [
            { name: { equals: result.teamName, mode: 'insensitive' } },
            { name: { contains: result.teamName, mode: 'insensitive' } },
            { slug: { equals: result.teamName.toLowerCase().replace(/[^a-z0-9]/g, '-'), mode: 'insensitive' } },
          ],
        },
      });

      if (org) {
        orgSlug = org.slug;
        orgName = org.name;
      }
    }
  } catch (error) {
    // Linking is optional, continue without it
  }

  return { playerId, orgSlug, orgName };
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
      const linkedData = await linkResultToPlayerAndOrg(result);

      const accountId = linkedData.playerId ||
        (result.playerWikiUrl
          ? `wiki-${result.playerWikiUrl.split('/').pop()}`
          : `wiki-${result.playerName.toLowerCase().replace(/[^a-z0-9]/g, '')}`);

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
          teamName: linkedData.orgName || result.teamName,
          data: {
            teamMembers: result.teamMembers,
            playerWikiUrl: result.playerWikiUrl,
            linkedPlayerId: linkedData.playerId,
            linkedOrgSlug: linkedData.orgSlug,
          },
        },
        update: {
          displayName: result.playerName,
          rank: result.rank,
          points: result.points || 0,
          kills: result.kills,
          earnings: result.earnings,
          teamName: linkedData.orgName || result.teamName,
          data: {
            teamMembers: result.teamMembers,
            playerWikiUrl: result.playerWikiUrl,
            linkedPlayerId: linkedData.playerId,
            linkedOrgSlug: linkedData.orgSlug,
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
 * Get upcoming tournaments
 */
export async function getUpcomingTournaments(limit = 20): Promise<any[]> {
  return prisma.tournament.findMany({
    where: {
      OR: [
        { startDate: { gt: new Date() } },
        {
          AND: [
            { startDate: { lte: new Date() } },
            { isCompleted: false },
          ],
        },
      ],
    },
    orderBy: { startDate: 'asc' },
    take: limit,
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
 * Get tournament results with player/org info
 */
export async function getTournamentResults(
  tournamentId: string,
  options?: { limit?: number; offset?: number }
): Promise<any[]> {
  const { limit = 100, offset = 0 } = options || {};

  const results = await prisma.tournamentResult.findMany({
    where: { tournamentId },
    orderBy: { rank: 'asc' },
    take: limit,
    skip: offset,
  });

  // Enrich with linked player/org data
  const enrichedResults = await Promise.all(
    results.map(async (result) => {
      const data = result.data as any;
      let player = null;
      let org = null;

      if (data?.linkedPlayerId) {
        player = await prisma.player.findUnique({
          where: { playerId: data.linkedPlayerId },
          select: { playerId: true, currentIgn: true, imageUrl: true },
        });
      }

      if (data?.linkedOrgSlug) {
        org = await prisma.organization.findUnique({
          where: { slug: data.linkedOrgSlug },
          select: { slug: true, name: true, logoUrl: true },
        });
      }

      return {
        ...result,
        linkedPlayer: player,
        linkedOrg: org,
      };
    })
  );

  return enrichedResults;
}

/**
 * Get player's tournament history
 */
export async function getPlayerTournamentHistory(
  playerIdentifier: string,
  options?: { limit?: number }
): Promise<any[]> {
  const { limit = 50 } = options || {};

  // Try to find by account ID first, then by display name
  const results = await prisma.tournamentResult.findMany({
    where: {
      OR: [
        { accountId: playerIdentifier },
        { displayName: { equals: playerIdentifier, mode: 'insensitive' } },
        {
          data: {
            path: ['linkedPlayerId'],
            equals: playerIdentifier
          }
        },
      ],
    },
    include: {
      tournament: {
        select: {
          tournamentId: true,
          name: true,
          startDate: true,
          prizePool: true,
          region: true,
        },
      },
    },
    orderBy: { tournament: { startDate: 'desc' } },
    take: limit,
  });

  return results;
}

/**
 * Get org's tournament history (all players from that org)
 */
export async function getOrgTournamentHistory(
  orgSlug: string,
  options?: { limit?: number }
): Promise<any[]> {
  const { limit = 100 } = options || {};

  const results = await prisma.tournamentResult.findMany({
    where: {
      OR: [
        { teamName: { contains: orgSlug, mode: 'insensitive' } },
        {
          data: {
            path: ['linkedOrgSlug'],
            equals: orgSlug
          }
        },
      ],
    },
    include: {
      tournament: {
        select: {
          tournamentId: true,
          name: true,
          startDate: true,
          prizePool: true,
          region: true,
        },
      },
    },
    orderBy: { tournament: { startDate: 'desc' } },
    take: limit,
  });

  return results;
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
  if (lower.includes('s-tier') || lower.includes('premier') || lower.includes('world cup') || lower.includes('global championship')) return 'S';
  if (lower.includes('a-tier') || lower.includes('major') || lower.includes('grand finals')) return 'A';
  if (lower.includes('b-tier') || lower.includes('invitational')) return 'B';
  if (lower.includes('c-tier') || lower.includes('weekly') || lower.includes('cash cup')) return 'C';
  if (lower.includes('monthly')) return 'Monthly';
  if (lower.includes('qualifier')) return 'Qualifier';
  return null;
}

function parseTierFromCell($cell: any, _$: cheerio.CheerioAPI): string | null {
  const text = $cell.text().toLowerCase();
  const link = $cell.find('a').first();
  const title = link.attr('title')?.toLowerCase() || '';

  if (text.includes('s-tier') || title.includes('premier')) return 'S';
  if (text.includes('a-tier') || title.includes('major')) return 'A';
  if (text.includes('b-tier')) return 'B';
  if (text.includes('qualifier')) return 'Qualifier';

  return parseTier(text);
}

function parseRegionFromCell($cell: any, _$: cheerio.CheerioAPI): string | null {
  const text = $cell.text();
  const flagImg = $cell.find('img[alt]').first();
  const alt = flagImg.attr('alt') || '';

  // Check flag image alt text
  if (alt) {
    if (alt.includes('Europe')) return 'Europe';
    if (alt.includes('North America') || alt.includes('UsCa')) return 'NA';
    if (alt.includes('Brazil')) return 'Brazil';
    if (alt.includes('Asia')) return 'Asia';
    if (alt.includes('Oceania') || alt.includes('Anz')) return 'Oceania';
    if (alt.includes('Middle East')) return 'Middle East';
  }

  return parseRegion(text);
}

function parseDateRange(text: string): { startDate: Date | null; endDate: Date | null } {
  // Try various date formats

  // Format: "Jan 15, 2024" or "January 15, 2024"
  const monthDayYear = text.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/g);
  if (monthDayYear && monthDayYear.length > 0 && monthDayYear[0]) {
    const startDate = new Date(monthDayYear[0]);
    if (!isNaN(startDate.getTime())) {
      const endDate = monthDayYear.length > 1 && monthDayYear[1] ? new Date(monthDayYear[1]) : startDate;
      return { startDate, endDate: isNaN(endDate.getTime()) ? startDate : endDate };
    }
  }

  // Format: "2024-01-15"
  const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/g);
  if (isoMatch && isoMatch.length >= 1 && isoMatch[0]) {
    const startDate = new Date(isoMatch[0]);
    const endDate = isoMatch.length > 1 && isoMatch[1] ? new Date(isoMatch[1]) : startDate;
    return { startDate, endDate };
  }

  // Format: "Apr 12, 2026"
  const shortMonth = text.match(/([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})/);
  if (shortMonth && shortMonth[0]) {
    const startDate = new Date(shortMonth[0]);
    if (!isNaN(startDate.getTime())) {
      return { startDate, endDate: startDate };
    }
  }

  return { startDate: null, endDate: null };
}

function parsePrizePool(text: string): number | null {
  const cleaned = text.replace(/,/g, '').replace(/\s/g, '');

  // $X.XM (millions)
  const millionMatch = cleaned.match(/\$([\d.]+)[mM]/);
  if (millionMatch && millionMatch[1]) {
    return parseFloat(millionMatch[1]) * 1000000;
  }

  // $X.XK (thousands)
  const thousandMatch = cleaned.match(/\$([\d.]+)[kK]/);
  if (thousandMatch && thousandMatch[1]) {
    return parseFloat(thousandMatch[1]) * 1000;
  }

  // Plain dollar amount $X,XXX or $X.XX
  const dollarMatch = cleaned.match(/\$([\d.]+)/);
  if (dollarMatch && dollarMatch[1]) {
    const value = parseFloat(dollarMatch[1]);
    return value > 0 ? value : null;
  }

  return null;
}

function parseRegion(text: string): string | null {
  const lower = text.toLowerCase();

  if (lower.includes('na-east') || lower.includes('nae') || lower.includes('na_east')) return 'NA East';
  if (lower.includes('na-west') || lower.includes('naw') || lower.includes('na_west')) return 'NA West';
  if (lower.includes('europe') || lower.match(/[^a-z]eu[^a-z]/) || lower.includes('eu-') || lower.includes('/eu')) return 'Europe';
  if (lower.includes('brazil') || lower.match(/[^a-z]br[^a-z]/) || lower.includes('br-')) return 'Brazil';
  if (lower.includes('asia') || lower.includes('apac') || lower.includes('/asia')) return 'Asia';
  if (lower.includes('oceania') || lower.match(/[^a-z]oce[^a-z]/) || lower.includes('oce-')) return 'Oceania';
  if (lower.includes('middle east') || lower.match(/[^a-z]me[^a-z]/) || lower.includes('middle_east')) return 'Middle East';
  if (lower.includes('north america') || lower.match(/[^a-z]na[^a-z]/)) return 'NA';
  if (lower.includes('global') || lower.includes('worldwide') || lower.includes('world')) return 'Global';

  return null;
}

function parseParticipantCount(text: string): number | null {
  const match = text.match(/(\d+)\s*(?:participants?|players?|teams?)?/i);
  return match && match[1] ? parseInt(match[1], 10) : null;
}

function parsePoints(text: string): number | null {
  const match = text.match(/(\d+)\s*(?:pts?|points?)/i);
  return match && match[1] ? parseInt(match[1], 10) : null;
}

function parseKills(text: string): number | null {
  const match = text.match(/(\d+)\s*(?:kills?|elims?|eliminations?)/i);
  return match && match[1] ? parseInt(match[1], 10) : null;
}

function parseTeamNameFromRow(_$: cheerio.CheerioAPI, $row: any): string | null {
  // Look for team template
  const teamSpan = $row.find('.team-template-text, [data-highlighting-class]').first();
  if (teamSpan.length) {
    const team = teamSpan.text().trim() || teamSpan.attr('data-highlighting-class');
    if (team && team.length > 1) return team;
  }
  return null;
}

function parseTeamMembersFromRow($: cheerio.CheerioAPI, $row: any): string[] | null {
  const members: string[] = [];
  $row.find('a[href*="/fortnite/"]').each((_: number, el: any) => {
    const href = $(el).attr('href') || '';
    if (!href.includes('Portal:') && !href.includes('Category:') && !href.includes('Tournament')) {
      const name = $(el).text().trim();
      if (name && name.length > 1 && name.length < 50 && !members.includes(name)) {
        members.push(name);
      }
    }
  });
  return members.length > 1 ? members : null;
}

function extractRegionText(text: string): string | null {
  const match = text.match(/(?:region|location|server)[:\s]+([^,\n]+)/i);
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

function extractParticipantCountNum(text: string): number | null {
  const match = text.match(/(\d+)/);
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
  getUpcomingTournaments,
  getTournamentById,
  getTournamentResults,
  getPlayerTournamentHistory,
  getOrgTournamentHistory,
};
