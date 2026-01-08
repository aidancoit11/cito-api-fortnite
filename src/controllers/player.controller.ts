import { Request, Response } from 'express';
import { prisma } from '../db/client.js';
import { playerService } from '../services/player.service.js';

/**
 * Player Controller
 * Handles player-related endpoints
 */

/**
 * GET /players
 * Search/list players
 * Query params: q (search), limit, offset, org
 */
export async function listPlayers(req: Request, res: Response): Promise<void> {
  try {
    const { q, limit = '50', offset = '0', org } = req.query;
    const limitNum = Math.min(parseInt(limit as string) || 50, 100);
    const offsetNum = parseInt(offset as string) || 0;

    let players;
    let total;

    if (q) {
      // Search mode
      players = await playerService.searchPlayers(q as string, {
        limit: limitNum,
        offset: offsetNum,
      });
      total = await prisma.player.count({
        where: {
          OR: [
            { currentIgn: { contains: q as string, mode: 'insensitive' } },
            { realName: { contains: q as string, mode: 'insensitive' } },
          ],
        },
      });
    } else if (org) {
      // Filter by org
      const rosters = await prisma.teamRoster.findMany({
        where: { orgSlug: org as string, isActive: true },
        include: { player: true },
        take: limitNum,
        skip: offsetNum,
      });
      players = rosters.filter(r => r.player).map(r => r.player!);
      total = await prisma.teamRoster.count({
        where: { orgSlug: org as string, isActive: true },
      });
    } else {
      // List all players (sorted by earnings)
      players = await prisma.player.findMany({
        take: limitNum,
        skip: offsetNum,
        include: {
          earningsSummary: true,
          rosterHistory: {
            where: { isActive: true },
            take: 1,
          },
        },
        orderBy: [
          { earningsSummary: { totalEarnings: 'desc' } },
          { currentIgn: 'asc' },
        ],
      });
      total = await prisma.player.count();
    }

    res.json({
      success: true,
      data: players.map(p => formatPlayer(p)),
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + players.length < total,
      },
    });
  } catch (error: any) {
    console.error('Error listing players:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list players',
      message: error.message,
    });
  }
}

/**
 * GET /players/top-earners
 * Get top earning players
 * Query params: limit, region
 */
export async function getTopEarners(req: Request, res: Response): Promise<void> {
  try {
    const { limit = '100', region } = req.query;
    const limitNum = Math.min(parseInt(limit as string) || 100, 500);

    const summaries = await prisma.playerEarningsSummary.findMany({
      take: limitNum,
      orderBy: { totalEarnings: 'desc' },
      include: {
        player: {
          include: {
            rosterHistory: {
              where: { isActive: true },
              take: 1,
              include: { organization: true },
            },
          },
        },
      },
    });

    const topEarners = summaries.map((s, index) => ({
      rank: index + 1,
      playerId: s.playerId,
      ign: s.player.currentIgn,
      realName: s.player.realName,
      nationality: s.player.nationality,
      totalEarnings: Number(s.totalEarnings),
      tournamentCount: s.tournamentCount,
      firstPlaceCount: s.firstPlaceCount,
      top10Count: s.top10Count,
      avgPlacement: s.avgPlacement ? Number(s.avgPlacement) : null,
      bestPlacement: s.bestPlacement,
      currentOrg: s.player.rosterHistory[0]?.organization?.name || null,
      currentOrgSlug: s.player.rosterHistory[0]?.orgSlug || null,
    }));

    res.json({
      success: true,
      data: topEarners,
      total: topEarners.length,
    });
  } catch (error: any) {
    console.error('Error getting top earners:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get top earners',
      message: error.message,
    });
  }
}

/**
 * GET /players/:identifier
 * Get player by ID, IGN, or Epic Account ID
 */
export async function getPlayer(req: Request, res: Response): Promise<void> {
  try {
    const { identifier } = req.params;

    let player;

    // Try UUID first
    if (identifier.match(/^[0-9a-f-]{36}$/i)) {
      player = await prisma.player.findUnique({
        where: { playerId: identifier },
        include: {
          ignHistory: { orderBy: { usedFrom: 'desc' } },
          rosterHistory: {
            orderBy: { joinDate: 'desc' },
            include: { organization: true },
          },
          earningsSummary: true,
          tournamentEarnings: {
            orderBy: { tournamentDate: 'desc' },
            take: 10,
          },
        },
      });
    }

    // Try Epic Account ID (32 char hex)
    if (!player && identifier.match(/^[0-9a-f]{32}$/i)) {
      player = await prisma.player.findUnique({
        where: { epicAccountId: identifier },
        include: {
          ignHistory: { orderBy: { usedFrom: 'desc' } },
          rosterHistory: {
            orderBy: { joinDate: 'desc' },
            include: { organization: true },
          },
          earningsSummary: true,
          tournamentEarnings: {
            orderBy: { tournamentDate: 'desc' },
            take: 10,
          },
        },
      });
    }

    // Try IGN
    if (!player) {
      player = await prisma.player.findFirst({
        where: {
          OR: [
            { currentIgn: { equals: identifier, mode: 'insensitive' } },
          ],
        },
        include: {
          ignHistory: { orderBy: { usedFrom: 'desc' } },
          rosterHistory: {
            orderBy: { joinDate: 'desc' },
            include: { organization: true },
          },
          earningsSummary: true,
          tournamentEarnings: {
            orderBy: { tournamentDate: 'desc' },
            take: 10,
          },
        },
      });
    }

    // Try IGN history
    if (!player) {
      const history = await prisma.playerIgnHistory.findFirst({
        where: { ign: { equals: identifier, mode: 'insensitive' } },
        include: {
          player: {
            include: {
              ignHistory: { orderBy: { usedFrom: 'desc' } },
              rosterHistory: {
                orderBy: { joinDate: 'desc' },
                include: { organization: true },
              },
              earningsSummary: true,
              tournamentEarnings: {
                orderBy: { tournamentDate: 'desc' },
                take: 10,
              },
            },
          },
        },
      });
      player = history?.player;
    }

    if (!player) {
      res.status(404).json({
        success: false,
        error: 'Player not found',
        message: `No player found with identifier: ${identifier}`,
      });
      return;
    }

    // Get current org
    const currentRoster = player.rosterHistory.find(r => r.isActive);

    res.json({
      success: true,
      data: {
        playerId: player.playerId,
        epicAccountId: player.epicAccountId,
        currentIgn: player.currentIgn,
        realName: player.realName,
        nationality: player.nationality,
        country: player.country,
        birthDate: player.birthDate,
        wikiUrl: player.wikiUrl,
        imageUrl: player.imageUrl,
        socialMedia: player.socialMedia,
        currentOrg: currentRoster ? {
          slug: currentRoster.orgSlug,
          name: currentRoster.organization?.name,
          role: currentRoster.role,
          joinDate: currentRoster.joinDate,
        } : null,
        earnings: player.earningsSummary ? {
          total: Number(player.earningsSummary.totalEarnings),
          tournamentCount: player.earningsSummary.tournamentCount,
          firstPlaceCount: player.earningsSummary.firstPlaceCount,
          top10Count: player.earningsSummary.top10Count,
          avgPlacement: player.earningsSummary.avgPlacement ? Number(player.earningsSummary.avgPlacement) : null,
          bestPlacement: player.earningsSummary.bestPlacement,
          highestEarning: player.earningsSummary.highestEarning ? Number(player.earningsSummary.highestEarning) : null,
          byYear: player.earningsSummary.earningsByYear,
          byRegion: player.earningsSummary.earningsByRegion,
        } : null,
        ignHistory: player.ignHistory.map(h => ({
          ign: h.ign,
          from: h.usedFrom,
          until: h.usedUntil,
        })),
        teamHistory: player.rosterHistory.map(r => ({
          orgSlug: r.orgSlug,
          orgName: r.organization?.name,
          role: r.role,
          status: r.status,
          joinDate: r.joinDate,
          leaveDate: r.leaveDate,
          isActive: r.isActive,
        })),
        recentTournaments: player.tournamentEarnings.map(t => ({
          tournamentId: t.tournamentId,
          name: t.tournamentName,
          date: t.tournamentDate,
          placement: t.placement,
          earnings: Number(t.earnings),
          region: t.region,
        })),
      },
    });
  } catch (error: any) {
    console.error('Error getting player:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get player',
      message: error.message,
    });
  }
}

/**
 * GET /players/:identifier/earnings
 * Get player's full earnings history
 */
export async function getPlayerEarnings(req: Request, res: Response): Promise<void> {
  try {
    const { identifier } = req.params;
    const { limit = '100', offset = '0' } = req.query;
    const limitNum = Math.min(parseInt(limit as string) || 100, 500);
    const offsetNum = parseInt(offset as string) || 0;

    // Find player
    const player = await findPlayerByIdentifier(identifier);
    if (!player) {
      res.status(404).json({
        success: false,
        error: 'Player not found',
      });
      return;
    }

    const earnings = await prisma.playerTournamentEarning.findMany({
      where: { playerId: player.playerId },
      orderBy: { tournamentDate: 'desc' },
      take: limitNum,
      skip: offsetNum,
    });

    const total = await prisma.playerTournamentEarning.count({
      where: { playerId: player.playerId },
    });

    res.json({
      success: true,
      data: {
        playerId: player.playerId,
        ign: player.currentIgn,
        earnings: earnings.map(e => ({
          tournamentId: e.tournamentId,
          tournamentName: e.tournamentName,
          date: e.tournamentDate,
          placement: e.placement,
          earnings: Number(e.earnings),
          prizePool: e.prizePool ? Number(e.prizePool) : null,
          tier: e.tier,
          gameMode: e.gameMode,
          region: e.region,
          season: e.season,
          teamSize: e.teamSize,
          teammates: e.teammates,
          orgAtTime: e.orgSlugAtTime,
        })),
      },
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + earnings.length < total,
      },
    });
  } catch (error: any) {
    console.error('Error getting player earnings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get player earnings',
      message: error.message,
    });
  }
}

/**
 * GET /players/:identifier/tournaments
 * Get player's tournament history
 */
export async function getPlayerTournaments(req: Request, res: Response): Promise<void> {
  try {
    const { identifier } = req.params;
    const { limit = '50', offset = '0' } = req.query;
    const limitNum = Math.min(parseInt(limit as string) || 50, 200);
    const offsetNum = parseInt(offset as string) || 0;

    const player = await findPlayerByIdentifier(identifier);
    if (!player) {
      res.status(404).json({
        success: false,
        error: 'Player not found',
      });
      return;
    }

    // Get tournament results if we have Epic account ID
    let results: any[] = [];
    let total = 0;

    if (player.epicAccountId) {
      results = await prisma.tournamentResult.findMany({
        where: { accountId: player.epicAccountId },
        include: { tournament: true },
        orderBy: { tournament: { startDate: 'desc' } },
        take: limitNum,
        skip: offsetNum,
      });
      total = await prisma.tournamentResult.count({
        where: { accountId: player.epicAccountId },
      });
    }

    // Also get from earnings if no results
    if (results.length === 0) {
      const earnings = await prisma.playerTournamentEarning.findMany({
        where: { playerId: player.playerId },
        orderBy: { tournamentDate: 'desc' },
        take: limitNum,
        skip: offsetNum,
      });
      total = await prisma.playerTournamentEarning.count({
        where: { playerId: player.playerId },
      });

      res.json({
        success: true,
        data: {
          playerId: player.playerId,
          ign: player.currentIgn,
          tournaments: earnings.map(e => ({
            tournamentId: e.tournamentId,
            name: e.tournamentName,
            date: e.tournamentDate,
            placement: e.placement,
            earnings: Number(e.earnings),
            region: e.region,
            source: 'earnings',
          })),
        },
        pagination: { total, limit: limitNum, offset: offsetNum, hasMore: offsetNum + earnings.length < total },
      });
      return;
    }

    res.json({
      success: true,
      data: {
        playerId: player.playerId,
        ign: player.currentIgn,
        tournaments: results.map(r => ({
          tournamentId: r.tournamentId,
          name: r.tournament?.name,
          date: r.tournament?.startDate,
          rank: r.rank,
          points: Number(r.points),
          kills: r.kills,
          earnings: r.earnings ? Number(r.earnings) : null,
          matchesPlayed: r.matchesPlayed,
          source: 'results',
        })),
      },
      pagination: { total, limit: limitNum, offset: offsetNum, hasMore: offsetNum + results.length < total },
    });
  } catch (error: any) {
    console.error('Error getting player tournaments:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get player tournaments',
      message: error.message,
    });
  }
}

// Helper functions
async function findPlayerByIdentifier(identifier: string) {
  // Try UUID
  if (identifier.match(/^[0-9a-f-]{36}$/i)) {
    return prisma.player.findUnique({ where: { playerId: identifier } });
  }
  // Try Epic ID
  if (identifier.match(/^[0-9a-f]{32}$/i)) {
    return prisma.player.findUnique({ where: { epicAccountId: identifier } });
  }
  // Try IGN
  return prisma.player.findFirst({
    where: { currentIgn: { equals: identifier, mode: 'insensitive' } },
  });
}

function formatPlayer(player: any) {
  return {
    playerId: player.playerId,
    epicAccountId: player.epicAccountId,
    ign: player.currentIgn,
    realName: player.realName,
    nationality: player.nationality,
    country: player.country,
    imageUrl: player.imageUrl,
    totalEarnings: player.earningsSummary?.totalEarnings
      ? Number(player.earningsSummary.totalEarnings)
      : null,
    tournamentCount: player.earningsSummary?.tournamentCount || null,
    currentOrg: player.rosterHistory?.[0]?.orgSlug || null,
  };
}
