import axios from 'axios';
import * as cheerio from 'cheerio';
import { prisma } from '../../db/client.js';
import { proxyManager } from '../../utils/proxy-manager.js';
import NodeCache from 'node-cache';

/**
 * LoL Player Earnings Service
 * Scrapes League of Legends player earnings from Liquipedia
 * Uses liquipedia.net/leagueoflegends player pages
 */

const cache = new NodeCache({ stdTTL: 1800 }); // 30-minute cache

const headers = {
  'User-Agent': 'LoLCompetitiveAPI/1.0 (Educational/Research)',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ========== INTERFACES ==========

export interface LolScrapedEarning {
  tournamentId: string;
  tournamentName: string;
  tournamentDate: Date;
  placement: number;
  earnings: number;
  prizePool?: number;
  tier?: string;
  league?: string;
  wikiUrl?: string;
  teamSize: number;
  teammates?: string[];
  teamName?: string;
}

export interface LolPlayerEarningsData {
  lolPlayerId: string;
  ign: string;
  totalEarnings: number;
  tournamentCount: number;
  earnings: LolScrapedEarning[];
}

export interface LolEarningsFilters {
  league?: string;
  tier?: string;
  year?: number;
  minEarnings?: number;
}

// ========== PARSING UTILITIES ==========

/**
 * Parse earnings amount from string (e.g., "$50,000" -> 50000)
 */
function parseEarnings(text: string): number {
  const match = text.replace(/[^0-9.,]/g, '').replace(/,/g, '');
  const value = parseFloat(match);
  return isNaN(value) ? 0 : value;
}

/**
 * Parse placement from string (e.g., "1st", "2nd", "5th-8th", "Top 4")
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
 * Extract tier from text (S-Tier, A-Tier, etc.)
 */
function extractTier(text: string): string | undefined {
  const tierPatterns = [
    /S[- ]?Tier/i,
    /A[- ]?Tier/i,
    /B[- ]?Tier/i,
    /C[- ]?Tier/i,
    /D[- ]?Tier/i,
    /Premier/i,
    /Major/i,
    /World[s]?\s*Championship/i,
    /MSI/i,
    /Qualifier/i,
  ];

  for (const pattern of tierPatterns) {
    const match = text.match(pattern);
    if (match) {
      const tier = match[0].toLowerCase().replace(/[- ]/g, '-');
      if (tier.includes('s-tier') || tier.includes('stier')) return 'S-Tier';
      if (tier.includes('a-tier') || tier.includes('atier')) return 'A-Tier';
      if (tier.includes('b-tier') || tier.includes('btier')) return 'B-Tier';
      if (tier.includes('c-tier') || tier.includes('ctier')) return 'C-Tier';
      if (tier.includes('d-tier') || tier.includes('dtier')) return 'D-Tier';
      if (tier.includes('premier')) return 'S-Tier';
      if (tier.includes('major')) return 'S-Tier';
      if (tier.includes('world')) return 'S-Tier';
      if (tier.includes('msi')) return 'S-Tier';
      if (tier.includes('qualifier')) return 'Qualifier';
    }
  }
  return undefined;
}

/**
 * Extract league from tournament name or URL
 */
function extractLeague(text: string): string | undefined {
  const lowerText = text.toLowerCase();

  if (lowerText.includes('lck')) return 'LCK';
  if (lowerText.includes('lpl')) return 'LPL';
  if (lowerText.includes('lec')) return 'LEC';
  if (lowerText.includes('lcs')) return 'LCS';
  if (lowerText.includes('worlds') || lowerText.includes('world_championship')) return 'Worlds';
  if (lowerText.includes('msi') || lowerText.includes('mid-season')) return 'MSI';
  if (lowerText.includes('lco')) return 'LCO';
  if (lowerText.includes('cblol')) return 'CBLOL';
  if (lowerText.includes('lla')) return 'LLA';
  if (lowerText.includes('ljl')) return 'LJL';
  if (lowerText.includes('pcs')) return 'PCS';
  if (lowerText.includes('vcs')) return 'VCS';
  if (lowerText.includes('lcl')) return 'LCL';
  if (lowerText.includes('tcl')) return 'TCL';

  return undefined;
}

/**
 * Generate tournament ID from name and date
 */
function generateTournamentId(name: string, date: Date): string {
  const dateStr = date.toISOString().split('T')[0];
  const normalizedName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);
  return `lol-${dateStr}-${normalizedName}`;
}

// ========== SCRAPING FUNCTIONS ==========

/**
 * Scrape earnings for a LoL player from their Liquipedia Results page
 */
export async function scrapeLolPlayerEarnings(wikiUrl: string): Promise<LolScrapedEarning[]> {
  const cacheKey = `lol_earnings_${wikiUrl}`;
  const cached = cache.get<LolScrapedEarning[]>(cacheKey);
  if (cached) return cached;

  console.log(`[LolEarnings] Scraping earnings from ${wikiUrl}`);

  try {
    // Construct the /Results page URL
    const resultsUrl = wikiUrl.replace(/\/?$/, '/Results');
    let html: string;

    // Get proxy configuration for axios
    const proxyConfig = proxyManager.getAxiosConfig();

    try {
      const response = await axios.get(resultsUrl, {
        headers,
        timeout: 20000,
        ...proxyConfig,
      });
      html = response.data;
    } catch {
      // /Results page doesn't exist, try main player page
      const response = await axios.get(wikiUrl, {
        headers,
        timeout: 20000,
        ...proxyConfig,
      });
      html = response.data;
    }

    const $ = cheerio.load(html);
    const earnings: LolScrapedEarning[] = [];
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

      // Check if this is a results table (has Date and Prize columns)
      const hasDate = headerTexts.some(h => h.includes('date'));
      const hasPrize = headerTexts.some(h => h.includes('prize') || h.includes('winnings') || h.includes('result'));
      if (!hasDate || !hasPrize) return;

      // Find column indices
      const dateIdx = headerTexts.findIndex(h => h.includes('date'));
      const placeIdx = headerTexts.findIndex(h => h.includes('place'));
      const tierIdx = headerTexts.findIndex(h => h.includes('tier'));
      const teamIdx = headerTexts.findIndex(h => h.includes('team'));

      // Process data rows
      $table.find('tbody tr').each((_, row) => {
        const $row = $(row);

        // Skip header rows and separator rows
        if ($row.find('th').length > 0) return;

        const cells = $row.find('td');
        if (cells.length < 3) return;

        // Extract date
        const dateText = cells.eq(dateIdx >= 0 ? dateIdx : 0).text().trim();
        const tournamentDate = parseDate(dateText);
        if (!tournamentDate) return;

        // Extract placement
        let placement = 999;
        const placeCell = cells.eq(placeIdx >= 0 ? placeIdx : 1);
        const placeText = placeCell.find('.placement-text').text().trim() || placeCell.text().trim();
        if (placeText) {
          placement = parsePlacement(placeText);
        }

        // Extract tier
        let tier: string | undefined;
        if (tierIdx >= 0) {
          const tierCell = cells.eq(tierIdx);
          const tierText = tierCell.attr('data-sort-value') || tierCell.text().trim();
          tier = extractTier(tierText);
        }

        // Check other cells for tier if not found
        if (!tier) {
          cells.each((_, cell) => {
            if (tier) return;
            const $cell = $(cell);
            const cellText = $cell.text().trim();
            const sortVal = $cell.attr('data-sort-value') || '';
            tier = extractTier(sortVal) || extractTier(cellText);
          });
        }

        // Extract tournament name and wiki URL
        let tournamentName = '';
        let tournamentWikiUrl: string | undefined;

        // Check data-sort-value attributes for tournament names
        cells.each((_, cell) => {
          if (tournamentName) return;
          const $cell = $(cell);
          const sortVal = $cell.attr('data-sort-value');
          if (sortVal && sortVal.length > 10 &&
              !sortVal.includes('Tier') && !sortVal.includes('-Tier')) {
            const parts = sortVal.split(' / ');
            if (parts.length <= 1 || (parts[0] && parts[0].length > 20)) {
              tournamentName = sortVal;
              const link = $cell.find('a[href*="/leagueoflegends/"]').first();
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
            const links = $cell.find('a[href*="/leagueoflegends/"]');
            links.each((_, link) => {
              if (tournamentName) return;
              const $link = $(link);
              const href = $link.attr('href') || '';
              const text = $link.attr('title') || $link.text().trim();
              if (href.includes('_Tournaments') || href.includes('index.php') ||
                  text.includes('-Tier')) {
                return;
              }
              if (text && text.length > 5) {
                tournamentName = text;
                tournamentWikiUrl = href.startsWith('http') ? href : `https://liquipedia.net${href}`;
              }
            });
          });
        }

        if (!tournamentName) return;

        // Extract league from tournament name
        const league = extractLeague(tournamentName) || extractLeague(tournamentWikiUrl || '');

        // Extract tier from tournament name if not found
        if (!tier) {
          tier = extractTier(tournamentName);
        }

        // Extract team name if available
        let teamName: string | undefined;
        if (teamIdx >= 0) {
          const teamCell = cells.eq(teamIdx);
          teamName = teamCell.attr('data-sort-value') || teamCell.text().trim();
        }

        // Extract prize amount - look for Prize or Result column (usually last column)
        let teamEarnings = 0;
        const prizeIdx = headerTexts.findIndex(h => h.includes('prize') || h.includes('winnings'));
        if (prizeIdx >= 0) {
          const prizeCell = cells.eq(prizeIdx);
          const prizeText = prizeCell.text().trim();
          teamEarnings = parseEarnings(prizeText);
        } else {
          // Try last column
          const lastCell = cells.last();
          const prizeText = lastCell.text().trim();
          teamEarnings = parseEarnings(prizeText);
        }

        // IMPORTANT: Include ALL tournaments, even with $0 prize
        // This matches Liquipedia exactly (qualifiers, group stages, etc.)

        // IMPORTANT: Liquipedia Results table shows TEAM earnings
        // Divide by team size to get individual player earnings
        // LoL is 5v5
        const teamSize = 5;
        const individualEarnings = teamEarnings > 0 ? teamEarnings / teamSize : 0;

        // Generate unique tournament ID
        const tournamentId = generateTournamentId(tournamentName, tournamentDate);

        // Skip duplicates
        if (seenTournaments.has(tournamentId)) return;
        seenTournaments.add(tournamentId);

        // Extract teammates from team column if present
        let teammates: string[] | undefined;
        if (teamIdx >= 0) {
          const teamCell = cells.eq(teamIdx);
          const teamText = teamCell.attr('data-sort-value') || teamCell.text();
          const parts = teamText.split(/[,\/]/).map(s => s.trim()).filter(s => s.length > 1);
          if (parts.length > 1) {
            teammates = parts;
          }
        }

        earnings.push({
          tournamentId,
          tournamentName,
          tournamentDate,
          placement,
          earnings: individualEarnings, // Individual share (team prize / 5)
          prizePool: teamEarnings, // Store team total as prize pool
          tier,
          league,
          wikiUrl: tournamentWikiUrl,
          teamSize,
          teammates,
          teamName,
        });
      });
    });

    // Sort by date descending
    earnings.sort((a, b) => b.tournamentDate.getTime() - a.tournamentDate.getTime());

    if (earnings.length > 0) {
      cache.set(cacheKey, earnings);
    }

    console.log(`[LolEarnings] Found ${earnings.length} tournaments for ${wikiUrl}`);
    return earnings;
  } catch (error: any) {
    console.error(`[LolEarnings] Failed to scrape ${wikiUrl}:`, error.message);
    return [];
  }
}

// ========== SYNC FUNCTIONS ==========

/**
 * Sync earnings for a specific LoL player
 */
export async function syncLolPlayerEarnings(lolPlayerId: string): Promise<number> {
  const player = await prisma.lolPlayer.findUnique({
    where: { lolPlayerId },
    include: {
      rosterHistory: {
        where: { status: 'current' },
        take: 1,
      },
    },
  });

  if (!player) {
    console.log(`[LolEarnings] Player not found: ${lolPlayerId}`);
    return 0;
  }

  if (!player.wikiUrl) {
    console.log(`[LolEarnings] No wiki URL for player: ${player.currentIgn}`);
    return 0;
  }

  console.log(`[LolEarnings] Syncing earnings for ${player.currentIgn}...`);

  const scrapedEarnings = await scrapeLolPlayerEarnings(player.wikiUrl);
  let synced = 0;

  const currentOrg = player.rosterHistory[0]?.orgSlug;

  for (const earning of scrapedEarnings) {
    try {
      await prisma.lolPlayerTournamentEarning.upsert({
        where: {
          lolPlayerId_tournamentId: {
            lolPlayerId,
            tournamentId: earning.tournamentId,
          },
        },
        create: {
          lolPlayerId,
          tournamentId: earning.tournamentId,
          tournamentName: earning.tournamentName,
          tournamentDate: earning.tournamentDate,
          placement: earning.placement,
          earnings: earning.earnings,
          prizePool: earning.prizePool,
          tier: earning.tier,
          league: earning.league,
          teamSize: earning.teamSize,
          teammates: earning.teammates,
          orgSlugAtTime: currentOrg,
          wikiUrl: earning.wikiUrl,
          source: 'liquipedia',
        },
        update: {
          tournamentName: earning.tournamentName,
          placement: earning.placement,
          earnings: earning.earnings,
          tier: earning.tier,
          league: earning.league,
        },
      });
      synced++;
    } catch (error: any) {
      console.error(`[LolEarnings] Failed to sync tournament ${earning.tournamentName}:`, error.message);
    }
  }

  // Update summary
  await updateLolPlayerEarningsSummary(lolPlayerId);

  console.log(`[LolEarnings] Synced ${synced} tournaments for ${player.currentIgn}`);
  return synced;
}

/**
 * Update player earnings summary (aggregated stats)
 */
export async function updateLolPlayerEarningsSummary(lolPlayerId: string): Promise<void> {
  const earnings = await prisma.lolPlayerTournamentEarning.findMany({
    where: { lolPlayerId },
    orderBy: { tournamentDate: 'desc' },
  });

  if (earnings.length === 0) return;

  const totalEarnings = earnings.reduce((sum, e) => sum + Number(e.earnings), 0);
  const tournamentCount = earnings.length;
  const firstPlaceCount = earnings.filter(e => e.placement === 1).length;
  const top3Count = earnings.filter(e => e.placement <= 3).length;
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

  // Calculate earnings by league
  const earningsByLeague: Record<string, number> = {};
  for (const e of earnings) {
    if (e.league) {
      earningsByLeague[e.league] = (earningsByLeague[e.league] || 0) + Number(e.earnings);
    }
  }

  // Count Worlds and MSI appearances/wins
  const worldsAppearances = earnings.filter(e =>
    e.tournamentName.toLowerCase().includes('worlds') ||
    e.tournamentName.toLowerCase().includes('world championship')
  ).length;
  const worldsWins = earnings.filter(e =>
    (e.tournamentName.toLowerCase().includes('worlds') ||
    e.tournamentName.toLowerCase().includes('world championship')) &&
    e.placement === 1
  ).length;
  const msiAppearances = earnings.filter(e =>
    e.tournamentName.toLowerCase().includes('msi') ||
    e.tournamentName.toLowerCase().includes('mid-season invitational')
  ).length;
  const msiWins = earnings.filter(e =>
    (e.tournamentName.toLowerCase().includes('msi') ||
    e.tournamentName.toLowerCase().includes('mid-season invitational')) &&
    e.placement === 1
  ).length;

  await prisma.lolPlayerEarningsSummary.upsert({
    where: { lolPlayerId },
    create: {
      lolPlayerId,
      totalEarnings,
      tournamentCount,
      firstPlaceCount,
      top3Count,
      avgPlacement,
      bestPlacement,
      highestEarning,
      earningsByYear,
      earningsByLeague,
      worldsAppearances,
      worldsWins,
      msiAppearances,
      msiWins,
      lastTournamentDate,
    },
    update: {
      totalEarnings,
      tournamentCount,
      firstPlaceCount,
      top3Count,
      avgPlacement,
      bestPlacement,
      highestEarning,
      earningsByYear,
      earningsByLeague,
      worldsAppearances,
      worldsWins,
      msiAppearances,
      msiWins,
      lastTournamentDate,
      lastUpdated: new Date(),
    },
  });
}

/**
 * Update org earnings summary
 */
export async function updateLolOrgEarningsSummary(orgSlug: string): Promise<void> {
  // Get all earnings where player was on this org
  const earnings = await prisma.lolPlayerTournamentEarning.findMany({
    where: { orgSlugAtTime: orgSlug },
    include: { player: true },
  });

  if (earnings.length === 0) return;

  const totalEarnings = earnings.reduce((sum, e) => sum + Number(e.earnings), 0);
  const tournamentCount = new Set(earnings.map(e => e.tournamentId)).size;
  const firstPlaceCount = earnings.filter(e => e.placement === 1).length;

  // Count Worlds and MSI wins
  const worldsWins = new Set(
    earnings
      .filter(e =>
        (e.tournamentName.toLowerCase().includes('worlds') ||
        e.tournamentName.toLowerCase().includes('world championship')) &&
        e.placement === 1
      )
      .map(e => e.tournamentId)
  ).size;
  const msiWins = new Set(
    earnings
      .filter(e =>
        (e.tournamentName.toLowerCase().includes('msi') ||
        e.tournamentName.toLowerCase().includes('mid-season invitational')) &&
        e.placement === 1
      )
      .map(e => e.tournamentId)
  ).size;

  // Count regional titles (assume tier S or A with placement 1)
  const regionalTitles = new Set(
    earnings
      .filter(e =>
        e.placement === 1 &&
        (e.tier === 'S-Tier' || e.tier === 'A-Tier') &&
        !e.tournamentName.toLowerCase().includes('worlds') &&
        !e.tournamentName.toLowerCase().includes('msi')
      )
      .map(e => e.tournamentId)
  ).size;

  // Calculate earnings by year
  const earningsByYear: Record<string, number> = {};
  for (const e of earnings) {
    const year = e.tournamentDate.getFullYear().toString();
    earningsByYear[year] = (earningsByYear[year] || 0) + Number(e.earnings);
  }

  await prisma.lolOrgEarningsSummary.upsert({
    where: { orgSlug },
    create: {
      orgSlug,
      totalEarnings,
      tournamentCount,
      firstPlaceCount,
      worldsWins,
      msiWins,
      regionalTitles,
      earningsByYear,
    },
    update: {
      totalEarnings,
      tournamentCount,
      firstPlaceCount,
      worldsWins,
      msiWins,
      regionalTitles,
      earningsByYear,
      lastUpdated: new Date(),
    },
  });
}

/**
 * Sync all LoL players' earnings
 */
export async function syncAllLolPlayerEarnings(): Promise<{
  playersProcessed: number;
  totalTournaments: number;
}> {
  const players = await prisma.lolPlayer.findMany({
    where: {
      wikiUrl: { not: null },
    },
    orderBy: { lastUpdated: 'asc' },
  });

  console.log(`[LolEarnings] Syncing earnings for ${players.length} players...`);

  let playersProcessed = 0;
  let totalTournaments = 0;

  for (const player of players) {
    try {
      const synced = await syncLolPlayerEarnings(player.lolPlayerId);
      if (synced > 0) {
        totalTournaments += synced;
        playersProcessed++;
      }

      // Rate limiting - be nice to Liquipedia
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error: any) {
      console.error(`[LolEarnings] Failed to sync ${player.currentIgn}:`, error.message);
    }
  }

  // Update all org summaries
  const orgs = await prisma.lolOrganization.findMany({
    where: { isActive: true },
  });

  for (const org of orgs) {
    await updateLolOrgEarningsSummary(org.slug);
  }

  console.log(`[LolEarnings] Sync complete: ${playersProcessed} players, ${totalTournaments} tournaments`);
  return { playersProcessed, totalTournaments };
}

// ========== API FUNCTIONS ==========

/**
 * Get player earnings with summary
 */
export async function getLolPlayerEarnings(lolPlayerId: string): Promise<{
  summary: any;
  history: any[];
} | null> {
  const player = await prisma.lolPlayer.findUnique({
    where: { lolPlayerId },
    include: {
      earningsSummary: true,
      tournamentEarnings: {
        orderBy: { tournamentDate: 'desc' },
        take: 100,
      },
    },
  });

  if (!player) return null;

  return {
    summary: player.earningsSummary,
    history: player.tournamentEarnings,
  };
}

/**
 * Get top LoL earners with optional filters
 */
export async function getTopLolEarners(
  limit: number = 50,
  filters?: LolEarningsFilters
): Promise<any[]> {
  // Build where clause for filtering
  let whereClause: any = {};

  if (filters) {
    if (filters.minEarnings) {
      whereClause.totalEarnings = { gte: filters.minEarnings };
    }
  }

  const summaries = await prisma.lolPlayerEarningsSummary.findMany({
    where: whereClause,
    orderBy: { totalEarnings: 'desc' },
    take: limit,
    include: {
      player: {
        include: {
          rosterHistory: {
            where: { status: 'current' },
            take: 1,
            include: { organization: true },
          },
        },
      },
    },
  });

  // Apply additional filters if needed
  let results = summaries.map(s => ({
    playerId: s.lolPlayerId,
    ign: s.player.currentIgn,
    realName: s.player.realName,
    role: s.player.role,
    nationality: s.player.nationality,
    currentTeam: s.player.rosterHistory[0]?.organization?.name || null,
    currentTeamSlug: s.player.rosterHistory[0]?.orgSlug || null,
    totalEarnings: Number(s.totalEarnings),
    tournamentCount: s.tournamentCount,
    firstPlaceCount: s.firstPlaceCount,
    top3Count: s.top3Count,
    avgPlacement: s.avgPlacement ? Number(s.avgPlacement) : null,
    bestPlacement: s.bestPlacement,
    highestEarning: s.highestEarning ? Number(s.highestEarning) : null,
    earningsByYear: s.earningsByYear,
    earningsByLeague: s.earningsByLeague,
    worldsAppearances: s.worldsAppearances,
    worldsWins: s.worldsWins,
    msiAppearances: s.msiAppearances,
    msiWins: s.msiWins,
    lastTournamentDate: s.lastTournamentDate,
  }));

  // Filter by year if specified
  if (filters?.year) {
    const yearStr = filters.year.toString();
    results = results.filter(r => {
      const yearEarnings = r.earningsByYear as Record<string, number> | null;
      return yearEarnings && yearEarnings[yearStr] && yearEarnings[yearStr] > 0;
    });
    // Re-sort by that year's earnings
    results.sort((a, b) => {
      const aYearEarnings = (a.earningsByYear as Record<string, number> | null)?.[yearStr] || 0;
      const bYearEarnings = (b.earningsByYear as Record<string, number> | null)?.[yearStr] || 0;
      return bYearEarnings - aYearEarnings;
    });
  }

  // Filter by league if specified
  if (filters?.league) {
    const leagueFilter = filters.league;
    results = results.filter(r => {
      const leagueEarnings = r.earningsByLeague as Record<string, number> | null;
      return leagueEarnings && leagueEarnings[leagueFilter] && leagueEarnings[leagueFilter] > 0;
    });
    // Re-sort by that league's earnings
    results.sort((a, b) => {
      const aLeagueEarnings = (a.earningsByLeague as Record<string, number> | null)?.[leagueFilter] || 0;
      const bLeagueEarnings = (b.earningsByLeague as Record<string, number> | null)?.[leagueFilter] || 0;
      return bLeagueEarnings - aLeagueEarnings;
    });
  }

  return results.slice(0, limit);
}

/**
 * Get top earning organizations
 */
export async function getTopLolOrgEarnings(limit: number = 20): Promise<any[]> {
  const summaries = await prisma.lolOrgEarningsSummary.findMany({
    orderBy: { totalEarnings: 'desc' },
    take: limit,
    include: {
      organization: true,
    },
  });

  return summaries.map(s => ({
    orgSlug: s.orgSlug,
    name: s.organization.name,
    region: s.organization.region,
    logoUrl: s.organization.logoUrl,
    totalEarnings: Number(s.totalEarnings),
    tournamentCount: s.tournamentCount,
    firstPlaceCount: s.firstPlaceCount,
    worldsWins: s.worldsWins,
    msiWins: s.msiWins,
    regionalTitles: s.regionalTitles,
    earningsByYear: s.earningsByYear,
  }));
}

// ========== EXPORT SERVICE ==========

export const lolEarningsService = {
  scrapeLolPlayerEarnings,
  syncLolPlayerEarnings,
  syncAllLolPlayerEarnings,
  updateLolPlayerEarningsSummary,
  updateLolOrgEarningsSummary,
  getLolPlayerEarnings,
  getTopLolEarners,
  getTopLolOrgEarnings,
};
