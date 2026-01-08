import { Request, Response } from 'express';
import { prisma } from '../db/client.js';

/**
 * Search Controller
 * Global search across players, organizations, and tournaments
 */

/**
 * GET /search
 * Global search across all entities
 * Query params: q (required), type (players|orgs|tournaments|all), limit
 */
export async function globalSearch(req: Request, res: Response): Promise<void> {
  try {
    const { q, type = 'all', limit = '10' } = req.query;

    if (!q || (q as string).length < 2) {
      res.status(400).json({
        success: false,
        error: 'Query too short',
        message: 'Search query must be at least 2 characters',
      });
      return;
    }

    const query = q as string;
    const limitNum = Math.min(parseInt(limit as string) || 10, 50);
    const searchType = type as string;

    const results: any = {};

    // Search players
    if (searchType === 'all' || searchType === 'players') {
      const players = await prisma.player.findMany({
        where: {
          OR: [
            { currentIgn: { contains: query, mode: 'insensitive' } },
            { realName: { contains: query, mode: 'insensitive' } },
          ],
        },
        include: {
          earningsSummary: true,
          rosterHistory: {
            where: { isActive: true },
            take: 1,
            include: { organization: true },
          },
        },
        take: limitNum,
        orderBy: [
          { earningsSummary: { totalEarnings: 'desc' } },
        ],
      });

      results.players = players.map(p => ({
        type: 'player',
        id: p.playerId,
        ign: p.currentIgn,
        realName: p.realName,
        nationality: p.nationality,
        imageUrl: p.imageUrl,
        totalEarnings: p.earningsSummary?.totalEarnings
          ? Number(p.earningsSummary.totalEarnings)
          : 0,
        currentOrg: p.rosterHistory[0]?.organization?.name || null,
        currentOrgSlug: p.rosterHistory[0]?.orgSlug || null,
      }));
    }

    // Search organizations
    if (searchType === 'all' || searchType === 'orgs') {
      const orgs = await prisma.organization.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { slug: { contains: query, mode: 'insensitive' } },
          ],
        },
        include: {
          _count: {
            select: { roster: { where: { isActive: true } } },
          },
          earningsSummary: true,
        },
        take: limitNum,
        orderBy: [
          { earningsSummary: { totalEarnings: 'desc' } },
        ],
      });

      results.orgs = orgs.map(o => ({
        type: 'org',
        slug: o.slug,
        name: o.name,
        logoUrl: o.logoUrl,
        region: o.region,
        activeRosterCount: o._count.roster,
        totalEarnings: o.earningsSummary?.totalEarnings
          ? Number(o.earningsSummary.totalEarnings)
          : 0,
      }));
    }

    // Search tournaments
    if (searchType === 'all' || searchType === 'tournaments') {
      const tournaments = await prisma.tournament.findMany({
        where: {
          name: { contains: query, mode: 'insensitive' },
        },
        include: {
          _count: { select: { results: true } },
        },
        take: limitNum,
        orderBy: { startDate: 'desc' },
      });

      results.tournaments = tournaments.map(t => ({
        type: 'tournament',
        id: t.tournamentId,
        name: t.name,
        startDate: t.startDate,
        endDate: t.endDate,
        region: t.region,
        prizePool: t.prizePool ? Number(t.prizePool) : null,
        isCompleted: t.isCompleted,
        resultCount: t._count.results,
      }));
    }

    // Calculate total results
    const totalResults =
      (results.players?.length || 0) +
      (results.orgs?.length || 0) +
      (results.tournaments?.length || 0);

    res.json({
      success: true,
      query,
      totalResults,
      data: results,
    });
  } catch (error: any) {
    console.error('Error in global search:', error);
    res.status(500).json({
      success: false,
      error: 'Search failed',
      message: error.message,
    });
  }
}

/**
 * GET /search/autocomplete
 * Quick autocomplete for search suggestions
 * Query params: q (required), limit
 */
export async function autocomplete(req: Request, res: Response): Promise<void> {
  try {
    const { q, limit = '8' } = req.query;

    if (!q || (q as string).length < 2) {
      res.json({ success: true, suggestions: [] });
      return;
    }

    const query = q as string;
    const limitNum = Math.min(parseInt(limit as string) || 8, 20);

    // Get suggestions from each type
    const [players, orgs, tournaments] = await Promise.all([
      prisma.player.findMany({
        where: { currentIgn: { startsWith: query, mode: 'insensitive' } },
        select: { currentIgn: true, playerId: true },
        take: limitNum,
        orderBy: { currentIgn: 'asc' },
      }),
      prisma.organization.findMany({
        where: { name: { startsWith: query, mode: 'insensitive' } },
        select: { name: true, slug: true },
        take: limitNum,
        orderBy: { name: 'asc' },
      }),
      prisma.tournament.findMany({
        where: { name: { startsWith: query, mode: 'insensitive' } },
        select: { name: true, tournamentId: true },
        take: limitNum,
        orderBy: { startDate: 'desc' },
      }),
    ]);

    const suggestions = [
      ...players.map(p => ({ type: 'player', text: p.currentIgn, id: p.playerId })),
      ...orgs.map(o => ({ type: 'org', text: o.name, id: o.slug })),
      ...tournaments.map(t => ({ type: 'tournament', text: t.name, id: t.tournamentId })),
    ].slice(0, limitNum);

    res.json({
      success: true,
      query,
      suggestions,
    });
  } catch (error: any) {
    console.error('Error in autocomplete:', error);
    res.status(500).json({
      success: false,
      error: 'Autocomplete failed',
      message: error.message,
    });
  }
}

/**
 * GET /search/stats
 * Get database statistics
 */
export async function getStats(req: Request, res: Response): Promise<void> {
  try {
    const [
      playerCount,
      orgCount,
      tournamentCount,
      resultCount,
      transferCount,
      earningsCount,
      rosterCount,
    ] = await Promise.all([
      prisma.player.count(),
      prisma.organization.count(),
      prisma.tournament.count(),
      prisma.tournamentResult.count(),
      prisma.playerTransfer.count(),
      prisma.playerTournamentEarning.count(),
      prisma.teamRoster.count({ where: { isActive: true } }),
    ]);

    // Get upcoming tournaments
    const upcomingTournaments = await prisma.tournament.count({
      where: { startDate: { gt: new Date() } },
    });

    // Get completed tournaments
    const completedTournaments = await prisma.tournament.count({
      where: { isCompleted: true },
    });

    // Get total earnings
    const earningsSum = await prisma.playerEarningsSummary.aggregate({
      _sum: { totalEarnings: true },
    });

    res.json({
      success: true,
      data: {
        players: playerCount,
        organizations: orgCount,
        tournaments: {
          total: tournamentCount,
          upcoming: upcomingTournaments,
          completed: completedTournaments,
        },
        tournamentResults: resultCount,
        playerEarnings: earningsCount,
        transfers: transferCount,
        activeRosters: rosterCount,
        totalPrizeMoneyTracked: earningsSum._sum.totalEarnings
          ? Number(earningsSum._sum.totalEarnings)
          : 0,
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('Error getting stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get stats',
      message: error.message,
    });
  }
}
