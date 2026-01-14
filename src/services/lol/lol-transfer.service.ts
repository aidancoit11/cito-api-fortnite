import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { prisma } from '../../db/client.js';

/**
 * LoL Transfer Service
 * Scrapes and manages player transfers from Liquipedia
 * Source: https://liquipedia.net/leagueoflegends/Portal:Transfers
 */

const LIQUIPEDIA_BASE_URL = 'https://liquipedia.net';

// Rate limiting for Liquipedia (be respectful)
const REQUEST_DELAY_MS = 2000;
let lastRequestTime = 0;

// Create axios instance for Liquipedia
const liquipediaApi: AxiosInstance = axios.create({
  baseURL: LIQUIPEDIA_BASE_URL,
  headers: {
    'User-Agent': 'CitoEsportsAPI/1.0 (esports data aggregator; contact@cito.gg)',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
  },
  timeout: 30000,
});

// ============== TYPES ==============

export interface ScrapedTransfer {
  playerName: string;
  fromTeam: string | null;
  fromTeamSlug: string | null;
  toTeam: string | null;
  toTeamSlug: string | null;
  transferDate: Date;
  transferType: TransferType;
  role?: string;
  announcementUrl?: string;
  details?: string;
  region?: string;
}

export type TransferType =
  | 'signed'
  | 'released'
  | 'loan'
  | 'loan_end'
  | 'trade'
  | 'retired'
  | 'unretired'
  | 'role_swap'
  | 'promoted'
  | 'demoted'
  | 'contract_extension'
  | 'unknown';

export interface TransferFilters {
  fromDate?: Date;
  toDate?: Date;
  team?: string;
  player?: string;
  type?: TransferType;
  region?: string;
  limit?: number;
  offset?: number;
}

export interface TransferWithDetails {
  id: string;
  playerName: string;
  fromOrg: {
    slug: string | null;
    name: string | null;
    logoUrl: string | null;
    region: string | null;
  } | null;
  toOrg: {
    slug: string | null;
    name: string | null;
    logoUrl: string | null;
    region: string | null;
  } | null;
  transferDate: Date;
  transferType: string;
  role: string | null;
  announcementUrl: string | null;
  details: string | null;
  player: {
    lolPlayerId: string;
    currentIgn: string;
    realName: string | null;
    nationality: string | null;
    imageUrl: string | null;
  } | null;
}

export interface TransferWindowSummary {
  season: string;
  totalTransfers: number;
  signings: number;
  releases: number;
  trades: number;
  retirements: number;
  topAcquiringTeams: Array<{
    teamSlug: string;
    teamName: string;
    acquisitions: number;
  }>;
  topReleasingTeams: Array<{
    teamSlug: string;
    teamName: string;
    releases: number;
  }>;
  transfersByRegion: Record<string, number>;
  transfersByRole: Record<string, number>;
  dateRange: {
    start: Date | null;
    end: Date | null;
  };
}

// ============== HELPER FUNCTIONS ==============

/**
 * Rate limit requests to Liquipedia
 */
async function rateLimitedRequest<T>(requestFn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < REQUEST_DELAY_MS) {
    await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS - timeSinceLastRequest));
  }

  lastRequestTime = Date.now();
  return requestFn();
}

/**
 * Convert team name to slug format
 */
function teamNameToSlug(name: string | null): string | null {
  if (!name) return null;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * Parse transfer type from context
 */
function parseTransferType(fromTeam: string | null, toTeam: string | null, details?: string): TransferType {
  const lowerDetails = (details || '').toLowerCase();

  if (lowerDetails.includes('retire')) return 'retired';
  if (lowerDetails.includes('unretire') || lowerDetails.includes('return')) return 'unretired';
  if (lowerDetails.includes('loan end') || lowerDetails.includes('loan return')) return 'loan_end';
  if (lowerDetails.includes('loan')) return 'loan';
  if (lowerDetails.includes('trade')) return 'trade';
  if (lowerDetails.includes('role swap') || lowerDetails.includes('roleswap')) return 'role_swap';
  if (lowerDetails.includes('promot')) return 'promoted';
  if (lowerDetails.includes('demot')) return 'demoted';
  if (lowerDetails.includes('extend') || lowerDetails.includes('renew')) return 'contract_extension';

  if (!fromTeam && toTeam) return 'signed';
  if (fromTeam && !toTeam) return 'released';
  if (fromTeam && toTeam) return 'signed';

  return 'unknown';
}

/**
 * Parse date string from Liquipedia format
 */
function parseTransferDate(dateStr: string): Date | null {
  try {
    // Common formats: "2024-01-15", "January 15, 2024", "15 Jan 2024"
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date;
    }

    // Try parsing "YYYY-MM-DD" explicitly
    const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch && isoMatch[1] && isoMatch[2] && isoMatch[3]) {
      return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract region from team or context
 */
function extractRegion(teamName: string | null, context: string): string | null {
  const regionPatterns: Record<string, RegExp> = {
    'KR': /korea|lck|t1|gen\.?g|drx|kt|hanwha|dplus|kwangdong/i,
    'CN': /china|lpl|jdg|bilibili|weibo|lng|tes|edg|rng|fpx|ig/i,
    'EU': /europe|lec|fnatic|g2|mad|vitality|excel|heretics|bds|karmine/i,
    'NA': /north america|lcs|cloud9|100 ?thieves|team liquid|flyquest|dignitas|nrg|eg|immortals/i,
    'APAC': /pacific|pcs|vcs|lco|gam|loud|pain|rainbow7/i,
    'BR': /brazil|cblol/i,
    'LATAM': /latam|lla/i,
  };

  const textToCheck = `${teamName || ''} ${context}`;

  for (const [region, pattern] of Object.entries(regionPatterns)) {
    if (pattern.test(textToCheck)) {
      return region;
    }
  }

  return null;
}

// ============== SCRAPING FUNCTIONS ==============

/**
 * Scrape transfers from Liquipedia Portal:Transfers
 * The page structure has transfer tables organized by date sections
 */
export async function scrapeTransfers(): Promise<ScrapedTransfer[]> {
  console.log('[LolTransferService] Scraping transfers from Liquipedia...');

  try {
    // Try the main transfers page
    const response = await rateLimitedRequest(() =>
      liquipediaApi.get('/leagueoflegends/Portal:Transfers')
    );

    const $ = cheerio.load(response.data);
    const transfers: ScrapedTransfer[] = [];

    // Get current date for relative date parsing
    let currentDate = new Date();

    // Liquipedia transfer portal has sections by date (h3 headers)
    // followed by transfer tables
    $('h3, h2').each((_, header) => {
      const headerText = $(header).text().trim();

      // Check if this is a date header (e.g., "January 15, 2025" or "2025-01-15")
      const parsedDate = parseTransferDate(headerText);
      if (parsedDate) {
        currentDate = parsedDate;
      }
    });

    // Parse transfer divs/tables - Liquipedia uses multiple formats
    // Format 1: wikitable rows
    $('table.wikitable tbody tr, .roster-card').each((_, row) => {
      const $row = $(row);
      const cells = $row.find('td');

      if (cells.length < 2) return;

      try {
        // Try to parse different table formats
        let playerName = '';
        let fromTeam: string | null = null;
        let toTeam: string | null = null;
        let dateText = '';
        let details = '';

        // Format: Date | Player | From | To | Details
        if (cells.length >= 4) {
          dateText = $(cells[0]).text().trim();
          const playerCell = cells.length === 5 ? $(cells[1]) : $(cells[1]);
          playerName = playerCell.find('a').first().text().trim() || playerCell.text().trim();

          const fromIdx = cells.length === 5 ? 2 : 2;
          const toIdx = cells.length === 5 ? 3 : 3;

          fromTeam = $(cells[fromIdx]).find('a').first().text().trim() || $(cells[fromIdx]).text().trim();
          toTeam = $(cells[toIdx]).find('a').first().text().trim() || $(cells[toIdx]).text().trim();

          if (cells.length > 4) {
            details = $(cells[4]).text().trim();
          }
        }
        // Format: Player | From | To
        else if (cells.length === 3) {
          playerName = $(cells[0]).find('a').first().text().trim() || $(cells[0]).text().trim();
          fromTeam = $(cells[1]).find('a').first().text().trim() || $(cells[1]).text().trim();
          toTeam = $(cells[2]).find('a').first().text().trim() || $(cells[2]).text().trim();
        }

        if (!playerName || playerName.length < 2) return;

        // Parse date or use current section date
        let transferDate = parseTransferDate(dateText);
        if (!transferDate) {
          transferDate = currentDate;
        }

        // Clean up team names
        fromTeam = fromTeam && fromTeam !== 'None' && fromTeam !== '-' && fromTeam !== 'Free Agent' ? fromTeam : null;
        toTeam = toTeam && toTeam !== 'None' && toTeam !== '-' && toTeam !== 'Free Agent' ? toTeam : null;

        const fromTeamSlug = teamNameToSlug(fromTeam);
        const toTeamSlug = teamNameToSlug(toTeam);

        // Determine transfer type
        const transferType = parseTransferType(fromTeam, toTeam, details);

        // Extract role if present
        let role: string | undefined;
        const roleMatch = (details || playerName || '').match(/\b(Top|Jungle|Mid|ADC|Bot|Support|Coach|Analyst)\b/i);
        if (roleMatch) {
          role = roleMatch[1];
        }

        // Detect region
        const region = extractRegion(toTeam || fromTeam, details || '') || undefined;

        transfers.push({
          playerName,
          fromTeam,
          fromTeamSlug,
          toTeam,
          toTeamSlug,
          transferDate,
          transferType,
          role,
          details: details || undefined,
          region,
        });
      } catch (err) {
        // Skip malformed rows
      }
    });

    // Also try to scrape from transfer-specific divs
    $('.transfer-card, .roster-change').each((_, card) => {
      try {
        const $card = $(card);
        const playerName = $card.find('.player-name, .name a').first().text().trim();
        const fromTeam = $card.find('.from-team, .old-team').text().trim() || null;
        const toTeam = $card.find('.to-team, .new-team').text().trim() || null;
        const dateText = $card.find('.date').text().trim();

        if (!playerName) return;

        const transferDate = parseTransferDate(dateText) || new Date();
        const transferType = parseTransferType(fromTeam, toTeam);

        transfers.push({
          playerName,
          fromTeam: fromTeam && fromTeam !== 'Free Agent' ? fromTeam : null,
          fromTeamSlug: teamNameToSlug(fromTeam),
          toTeam: toTeam && toTeam !== 'Free Agent' ? toTeam : null,
          toTeamSlug: teamNameToSlug(toTeam),
          transferDate,
          transferType,
        });
      } catch (err) {
        // Skip
      }
    });

    console.log(`[LolTransferService] Scraped ${transfers.length} transfers`);
    return transfers;
  } catch (error: any) {
    console.error('[LolTransferService] Error scraping transfers:', error.message);
    throw new Error(`Failed to scrape transfers: ${error.message}`);
  }
}

/**
 * Scrape transfers from year-specific pages for historical data
 */
export async function scrapeHistoricalTransfers(year: number): Promise<ScrapedTransfer[]> {
  console.log(`[LolTransferService] Scraping ${year} transfers from Liquipedia...`);

  const transfers: ScrapedTransfer[] = [];

  try {
    // Try various URL formats
    const urls = [
      `/leagueoflegends/Portal:Transfers/${year}`,
      `/leagueoflegends/Transfers/${year}`,
      `/leagueoflegends/${year}/Transfers`,
    ];

    for (const url of urls) {
      try {
        const response = await rateLimitedRequest(() =>
          liquipediaApi.get(url)
        );

        if (response.status === 200) {
          const $ = cheerio.load(response.data);

          $('table.wikitable tbody tr').each((_, row) => {
            const cells = $(row).find('td');
            if (cells.length < 3) return;

            try {
              const dateText = $(cells[0]).text().trim();
              const playerName = $(cells[1]).find('a').first().text().trim() || $(cells[1]).text().trim();
              const fromTeam = $(cells[2]).find('a').first().text().trim() || null;
              const toTeam = cells.length > 3 ? ($(cells[3]).find('a').first().text().trim() || null) : null;

              if (!playerName) return;

              const transferDate = parseTransferDate(dateText) || new Date(`${year}-01-01`);

              transfers.push({
                playerName,
                fromTeam: fromTeam && fromTeam !== 'None' ? fromTeam : null,
                fromTeamSlug: teamNameToSlug(fromTeam),
                toTeam: toTeam && toTeam !== 'None' ? toTeam : null,
                toTeamSlug: teamNameToSlug(toTeam),
                transferDate,
                transferType: parseTransferType(fromTeam, toTeam),
              });
            } catch (err) {
              // Skip
            }
          });

          if (transfers.length > 0) break;
        }
      } catch (err) {
        // Try next URL format
      }
    }

    console.log(`[LolTransferService] Scraped ${transfers.length} transfers for ${year}`);
    return transfers;
  } catch (error: any) {
    console.error(`[LolTransferService] Error scraping ${year} transfers:`, error.message);
    return [];
  }
}

// ============== DATABASE SYNC FUNCTIONS ==============

/**
 * Sync recent transfers to database
 */
export async function syncTransfers(): Promise<{
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}> {
  console.log('[LolTransferService] Starting transfer sync...');

  const result = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [] as string[],
  };

  try {
    const scrapedTransfers = await scrapeTransfers();

    for (const transfer of scrapedTransfers) {
      try {
        // Try to find existing player
        const player = await prisma.lolPlayer.findFirst({
          where: {
            OR: [
              { currentIgn: { equals: transfer.playerName, mode: 'insensitive' } },
            ],
          },
        });

        // Check if this exact transfer already exists
        const existingTransfer = await prisma.lolTransfer.findFirst({
          where: {
            playerName: { equals: transfer.playerName, mode: 'insensitive' },
            transferDate: transfer.transferDate,
            fromOrgSlug: transfer.fromTeamSlug,
            toOrgSlug: transfer.toTeamSlug,
          },
        });

        if (existingTransfer) {
          result.skipped++;
          continue;
        }

        // Ensure orgs exist if needed
        if (transfer.fromTeamSlug) {
          await prisma.lolOrganization.upsert({
            where: { slug: transfer.fromTeamSlug },
            create: {
              slug: transfer.fromTeamSlug,
              name: transfer.fromTeam || transfer.fromTeamSlug,
              region: transfer.region,
            },
            update: {},
          });
        }

        if (transfer.toTeamSlug) {
          await prisma.lolOrganization.upsert({
            where: { slug: transfer.toTeamSlug },
            create: {
              slug: transfer.toTeamSlug,
              name: transfer.toTeam || transfer.toTeamSlug,
              region: transfer.region,
            },
            update: {},
          });
        }

        // Create the transfer record
        await prisma.lolTransfer.create({
          data: {
            lolPlayerId: player?.lolPlayerId || null,
            playerName: transfer.playerName,
            fromOrgSlug: transfer.fromTeamSlug,
            toOrgSlug: transfer.toTeamSlug,
            transferDate: transfer.transferDate,
            transferType: transfer.transferType,
            role: transfer.role,
            announcementUrl: transfer.announcementUrl,
            details: transfer.details,
            source: 'liquipedia',
          },
        });

        result.created++;

        // Update player's current team if they were signed
        if (player && transfer.toTeamSlug) {
          // Update or create roster entry
          const existingRoster = await prisma.lolTeamRoster.findFirst({
            where: {
              lolPlayerId: player.lolPlayerId,
              orgSlug: transfer.toTeamSlug,
              status: 'current',
            },
          });

          if (!existingRoster) {
            // Mark previous roster entries as former
            await prisma.lolTeamRoster.updateMany({
              where: {
                lolPlayerId: player.lolPlayerId,
                status: 'current',
              },
              data: {
                status: 'former',
                leaveDate: transfer.transferDate,
                leaveReason: 'transfer',
              },
            });

            // Create new roster entry
            await prisma.lolTeamRoster.create({
              data: {
                orgSlug: transfer.toTeamSlug,
                lolPlayerId: player.lolPlayerId,
                playerName: transfer.playerName,
                role: transfer.role || 'Player',
                status: 'current',
                joinDate: transfer.transferDate,
                isStarter: true,
                isActive: true,
              },
            });
          }
        }
      } catch (err: any) {
        result.errors.push(`Error processing ${transfer.playerName}: ${err.message}`);
      }
    }

    console.log(`[LolTransferService] Sync complete: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`);
    return result;
  } catch (error: any) {
    console.error('[LolTransferService] Sync failed:', error.message);
    throw new Error(`Transfer sync failed: ${error.message}`);
  }
}

// ============== QUERY FUNCTIONS ==============

/**
 * Get recent transfers with filters
 */
export async function getRecentTransfers(filters: TransferFilters = {}): Promise<TransferWithDetails[]> {
  const {
    fromDate,
    toDate,
    team,
    player,
    type,
    region,
    limit = 50,
    offset = 0,
  } = filters;

  const where: any = {};

  // Date filters
  if (fromDate || toDate) {
    where.transferDate = {};
    if (fromDate) where.transferDate.gte = fromDate;
    if (toDate) where.transferDate.lte = toDate;
  }

  // Team filter (matches either from or to)
  if (team) {
    where.OR = [
      { fromOrgSlug: { contains: team, mode: 'insensitive' } },
      { toOrgSlug: { contains: team, mode: 'insensitive' } },
    ];
  }

  // Player filter
  if (player) {
    where.playerName = { contains: player, mode: 'insensitive' };
  }

  // Transfer type filter
  if (type) {
    where.transferType = type;
  }

  // Region filter (based on org region)
  if (region) {
    where.OR = [
      { fromOrg: { region: region } },
      { toOrg: { region: region } },
    ];
  }

  const transfers = await prisma.lolTransfer.findMany({
    where,
    include: {
      player: {
        select: {
          lolPlayerId: true,
          currentIgn: true,
          realName: true,
          nationality: true,
          imageUrl: true,
        },
      },
      fromOrg: {
        select: {
          slug: true,
          name: true,
          logoUrl: true,
          region: true,
        },
      },
      toOrg: {
        select: {
          slug: true,
          name: true,
          logoUrl: true,
          region: true,
        },
      },
    },
    orderBy: { transferDate: 'desc' },
    take: limit,
    skip: offset,
  });

  return transfers.map(t => ({
    id: t.id,
    playerName: t.playerName,
    fromOrg: t.fromOrg,
    toOrg: t.toOrg,
    transferDate: t.transferDate,
    transferType: t.transferType,
    role: t.role,
    announcementUrl: t.announcementUrl,
    details: t.details,
    player: t.player,
  }));
}

/**
 * Get a single transfer by ID
 */
export async function getTransferById(transferId: string): Promise<TransferWithDetails | null> {
  const transfer = await prisma.lolTransfer.findUnique({
    where: { id: transferId },
    include: {
      player: {
        select: {
          lolPlayerId: true,
          currentIgn: true,
          realName: true,
          nationality: true,
          imageUrl: true,
        },
      },
      fromOrg: {
        select: {
          slug: true,
          name: true,
          logoUrl: true,
          region: true,
        },
      },
      toOrg: {
        select: {
          slug: true,
          name: true,
          logoUrl: true,
          region: true,
        },
      },
    },
  });

  if (!transfer) return null;

  return {
    id: transfer.id,
    playerName: transfer.playerName,
    fromOrg: transfer.fromOrg,
    toOrg: transfer.toOrg,
    transferDate: transfer.transferDate,
    transferType: transfer.transferType,
    role: transfer.role,
    announcementUrl: transfer.announcementUrl,
    details: transfer.details,
    player: transfer.player,
  };
}

/**
 * Get transfer history for a player
 */
export async function getPlayerTransferHistory(playerId: string): Promise<TransferWithDetails[]> {
  const transfers = await prisma.lolTransfer.findMany({
    where: { lolPlayerId: playerId },
    include: {
      player: {
        select: {
          lolPlayerId: true,
          currentIgn: true,
          realName: true,
          nationality: true,
          imageUrl: true,
        },
      },
      fromOrg: {
        select: {
          slug: true,
          name: true,
          logoUrl: true,
          region: true,
        },
      },
      toOrg: {
        select: {
          slug: true,
          name: true,
          logoUrl: true,
          region: true,
        },
      },
    },
    orderBy: { transferDate: 'desc' },
  });

  return transfers.map(t => ({
    id: t.id,
    playerName: t.playerName,
    fromOrg: t.fromOrg,
    toOrg: t.toOrg,
    transferDate: t.transferDate,
    transferType: t.transferType,
    role: t.role,
    announcementUrl: t.announcementUrl,
    details: t.details,
    player: t.player,
  }));
}

/**
 * Get team transfer activity (incoming or outgoing)
 */
export async function getTeamTransferActivity(
  teamSlug: string,
  type: 'incoming' | 'outgoing' | 'all' = 'all'
): Promise<TransferWithDetails[]> {
  const where: any = {};

  if (type === 'incoming') {
    where.toOrgSlug = teamSlug;
  } else if (type === 'outgoing') {
    where.fromOrgSlug = teamSlug;
  } else {
    where.OR = [
      { toOrgSlug: teamSlug },
      { fromOrgSlug: teamSlug },
    ];
  }

  const transfers = await prisma.lolTransfer.findMany({
    where,
    include: {
      player: {
        select: {
          lolPlayerId: true,
          currentIgn: true,
          realName: true,
          nationality: true,
          imageUrl: true,
        },
      },
      fromOrg: {
        select: {
          slug: true,
          name: true,
          logoUrl: true,
          region: true,
        },
      },
      toOrg: {
        select: {
          slug: true,
          name: true,
          logoUrl: true,
          region: true,
        },
      },
    },
    orderBy: { transferDate: 'desc' },
  });

  return transfers.map(t => ({
    id: t.id,
    playerName: t.playerName,
    fromOrg: t.fromOrg,
    toOrg: t.toOrg,
    transferDate: t.transferDate,
    transferType: t.transferType,
    role: t.role,
    announcementUrl: t.announcementUrl,
    details: t.details,
    player: t.player,
  }));
}

/**
 * Get transfer window summary for a season/offseason
 */
export async function getTransferWindowSummary(season?: string): Promise<TransferWindowSummary> {
  // Default to current year if no season specified
  const year = season || new Date().getFullYear().toString();

  // Define transfer window dates (roughly November-January for offseason)
  let startDate: Date;
  let endDate: Date;

  if (season?.toLowerCase().includes('spring')) {
    // Spring split preparation: Nov - Jan
    startDate = new Date(`${parseInt(year) - 1}-11-01`);
    endDate = new Date(`${year}-01-31`);
  } else if (season?.toLowerCase().includes('summer')) {
    // Summer split preparation: May - June
    startDate = new Date(`${year}-05-01`);
    endDate = new Date(`${year}-06-30`);
  } else {
    // Default: Full year
    startDate = new Date(`${year}-01-01`);
    endDate = new Date(`${year}-12-31`);
  }

  const transfers = await prisma.lolTransfer.findMany({
    where: {
      transferDate: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      fromOrg: { select: { slug: true, name: true, region: true } },
      toOrg: { select: { slug: true, name: true, region: true } },
    },
  });

  // Calculate statistics
  const signings = transfers.filter(t => t.transferType === 'signed').length;
  const releases = transfers.filter(t => t.transferType === 'released').length;
  const trades = transfers.filter(t => t.transferType === 'trade').length;
  const retirements = transfers.filter(t => t.transferType === 'retired').length;

  // Count acquisitions by team
  const acquisitionCounts: Record<string, { slug: string; name: string; count: number }> = {};
  const releaseCounts: Record<string, { slug: string; name: string; count: number }> = {};
  const regionCounts: Record<string, number> = {};
  const roleCounts: Record<string, number> = {};

  for (const transfer of transfers) {
    // Acquisitions
    if (transfer.toOrgSlug && transfer.toOrg) {
      const toOrgSlug = transfer.toOrgSlug;
      if (!acquisitionCounts[toOrgSlug]) {
        acquisitionCounts[toOrgSlug] = {
          slug: toOrgSlug,
          name: transfer.toOrg.name || toOrgSlug,
          count: 0,
        };
      }
      acquisitionCounts[toOrgSlug].count++;

      // Region count
      if (transfer.toOrg.region) {
        regionCounts[transfer.toOrg.region] = (regionCounts[transfer.toOrg.region] || 0) + 1;
      }
    }

    // Releases
    if (transfer.fromOrgSlug && transfer.fromOrg) {
      const fromOrgSlug = transfer.fromOrgSlug;
      if (!releaseCounts[fromOrgSlug]) {
        releaseCounts[fromOrgSlug] = {
          slug: fromOrgSlug,
          name: transfer.fromOrg.name || fromOrgSlug,
          count: 0,
        };
      }
      releaseCounts[fromOrgSlug].count++;
    }

    // Role count
    if (transfer.role) {
      roleCounts[transfer.role] = (roleCounts[transfer.role] || 0) + 1;
    }
  }

  // Sort and get top teams
  const topAcquiring = Object.values(acquisitionCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map(t => ({ teamSlug: t.slug, teamName: t.name, acquisitions: t.count }));

  const topReleasing = Object.values(releaseCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map(t => ({ teamSlug: t.slug, teamName: t.name, releases: t.count }));

  // Get actual date range
  const sortedDates = transfers
    .map(t => t.transferDate)
    .sort((a, b) => a.getTime() - b.getTime());

  return {
    season: season || year,
    totalTransfers: transfers.length,
    signings,
    releases,
    trades,
    retirements,
    topAcquiringTeams: topAcquiring,
    topReleasingTeams: topReleasing,
    transfersByRegion: regionCounts,
    transfersByRole: roleCounts,
    dateRange: {
      start: sortedDates[0] || null,
      end: sortedDates[sortedDates.length - 1] || null,
    },
  };
}

// ============== EXPORT SERVICE OBJECT ==============

export const lolTransferService = {
  // Scraping
  scrapeTransfers,
  scrapeHistoricalTransfers,
  syncTransfers,

  // Queries
  getRecentTransfers,
  getTransferById,
  getPlayerTransferHistory,
  getTeamTransferActivity,
  getTransferWindowSummary,
};
