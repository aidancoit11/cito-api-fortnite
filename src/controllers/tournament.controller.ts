import { Request, Response, NextFunction } from 'express';
import { tournamentService } from '../services/scraper/tournament.service.js';
import { eventsService } from '../services/epic/events.service.js';
import { prisma } from '../db/client.js';

/**
 * GET /tournaments
 * List all tournaments with filters
 * Query params: status (upcoming|ongoing|completed), region, year, tier, limit, offset
 */
export async function listTournaments(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      status,
      region,
      year,
      tier,
      limit = '50',
      offset = '0',
    } = req.query;

    const tournaments = await tournamentService.getTournaments({
      status: status as 'upcoming' | 'ongoing' | 'completed' | undefined,
      region: region as string | undefined,
      year: year ? parseInt(year as string, 10) : undefined,
      tier: tier as string | undefined,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
    });

    // Get total count for pagination
    const where: any = {};
    if (status === 'completed') where.isCompleted = true;
    if (region) where.region = { contains: region, mode: 'insensitive' };
    if (year) {
      where.startDate = {
        gte: new Date(`${year}-01-01`),
        lt: new Date(`${parseInt(year as string, 10) + 1}-01-01`),
      };
    }

    const totalCount = await prisma.tournament.count({ where });

    res.json({
      success: true,
      count: tournaments.length,
      total: totalCount,
      data: tournaments.map(t => ({
        tournamentId: t.tournamentId,
        name: t.name,
        organizer: t.organizer,
        startDate: t.startDate,
        endDate: t.endDate,
        region: t.region,
        prizePool: t.prizePool,
        format: t.format,
        isCompleted: t.isCompleted,
        tier: (t.data as any)?.tier || null,
        logoUrl: (t.data as any)?.logoUrl || null,
      })),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /tournaments/upcoming
 * Get upcoming tournaments (from Epic API + database)
 */
export async function getUpcomingTournaments(req: Request, res: Response, next: NextFunction) {
  try {
    const { limit = '20' } = req.query;

    // Get from Epic API
    let epicEvents: any[] = [];
    try {
      const events = await eventsService.getUpcomingEvents();
      epicEvents = events.map(event => ({
        tournamentId: event.eventId,
        name: event.name,
        source: 'epic',
        regions: event.regions,
        windows: event.eventWindows.map(w => ({
          windowId: w.eventWindowId,
          startTime: w.beginTime,
          endTime: w.endTime,
          round: w.round,
        })),
      }));
    } catch (error: any) {
      console.error('Failed to fetch Epic events:', error.message);
    }

    // Get from database
    const dbTournaments = await prisma.tournament.findMany({
      where: {
        startDate: { gt: new Date() },
      },
      orderBy: { startDate: 'asc' },
      take: parseInt(limit as string, 10),
    });

    const upcoming = dbTournaments.map(t => ({
      tournamentId: t.tournamentId,
      name: t.name,
      source: 'liquipedia',
      startDate: t.startDate,
      endDate: t.endDate,
      region: t.region,
      prizePool: t.prizePool,
      tier: (t.data as any)?.tier || null,
    }));

    res.json({
      success: true,
      data: {
        epic: epicEvents,
        scheduled: upcoming,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /tournaments/live
 * Get currently live tournaments with real-time leaderboards
 */
export async function getLiveTournaments(req: Request, res: Response, next: NextFunction) {
  try {
    const { includeLeaderboard = 'true' } = req.query;

    // Get live events from Epic API
    const liveEvents = await eventsService.getLiveEvents();

    const liveTournaments = [];

    for (const event of liveEvents) {
      for (const window of event.eventWindows) {
        const now = new Date();
        if (window.beginTime <= now && window.endTime >= now) {
          let leaderboard: any[] = [];

          if (includeLeaderboard === 'true') {
            try {
              const entries = await eventsService.getEventLeaderboard(
                event.eventId,
                window.eventWindowId,
                { limit: 100 }
              );
              leaderboard = entries.map(e => ({
                rank: e.rank,
                displayName: e.displayName,
                accountId: e.accountId,
                score: e.score,
                kills: e.sessions.reduce((sum, s) => sum + s.kills, 0),
                matchesPlayed: e.sessions.length,
              }));
            } catch (error: any) {
              console.error(`Failed to get leaderboard for ${event.eventId}:`, error.message);
            }
          }

          liveTournaments.push({
            eventId: event.eventId,
            eventWindowId: window.eventWindowId,
            name: event.name,
            regions: event.regions,
            startTime: window.beginTime,
            endTime: window.endTime,
            isLive: true,
            leaderboardCount: leaderboard.length,
            leaderboard: includeLeaderboard === 'true' ? leaderboard : undefined,
          });
        }
      }
    }

    res.json({
      success: true,
      count: liveTournaments.length,
      data: liveTournaments,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /tournaments/past
 * Get past/completed tournaments (paginated)
 */
export async function getPastTournaments(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      region,
      year,
      tier,
      limit = '50',
      offset = '0',
    } = req.query;

    const tournaments = await tournamentService.getTournaments({
      status: 'completed',
      region: region as string | undefined,
      year: year ? parseInt(year as string, 10) : undefined,
      tier: tier as string | undefined,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
    });

    // Get total count
    const where: any = { isCompleted: true };
    if (region) where.region = { contains: region, mode: 'insensitive' };
    if (year) {
      where.startDate = {
        gte: new Date(`${year}-01-01`),
        lt: new Date(`${parseInt(year as string, 10) + 1}-01-01`),
      };
    }
    const totalCount = await prisma.tournament.count({ where });

    res.json({
      success: true,
      count: tournaments.length,
      total: totalCount,
      data: tournaments.map(t => ({
        tournamentId: t.tournamentId,
        name: t.name,
        organizer: t.organizer,
        startDate: t.startDate,
        endDate: t.endDate,
        region: t.region,
        prizePool: t.prizePool,
        format: t.format,
        tier: (t.data as any)?.tier || null,
        gameMode: (t.data as any)?.gameMode || null,
      })),
      pagination: {
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
        total: totalCount,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /tournaments/:id
 * Get tournament details with results
 */
export async function getTournament(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({ success: false, error: 'Tournament ID is required' });
      return;
    }

    const tournament = await tournamentService.getTournamentById(id);

    if (!tournament) {
      res.status(404).json({
        success: false,
        error: 'Tournament not found',
      });
      return;
    }

    const data = tournament.data as any;

    res.json({
      success: true,
      data: {
        tournamentId: tournament.tournamentId,
        name: tournament.name,
        organizer: tournament.organizer,
        startDate: tournament.startDate,
        endDate: tournament.endDate,
        region: tournament.region,
        prizePool: tournament.prizePool,
        format: tournament.format,
        isCompleted: tournament.isCompleted,
        url: tournament.url,
        tier: data?.tier || null,
        description: data?.description || null,
        logoUrl: data?.logoUrl || null,
        venue: data?.venue || null,
        gameMode: data?.gameMode || null,
        teamSize: data?.teamSize || null,
        participantCount: data?.participantCount || null,
        resultsCount: tournament.results.length,
        topResults: tournament.results.slice(0, 10).map((r: any) => ({
          rank: r.rank,
          displayName: r.displayName,
          accountId: r.accountId,
          points: r.points,
          kills: r.kills,
          earnings: r.earnings,
          teamName: r.teamName,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /tournaments/:id/results
 * Get full tournament results (top 500)
 */
export async function getTournamentResults(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { limit = '100', offset = '0' } = req.query;

    if (!id) {
      res.status(400).json({ success: false, error: 'Tournament ID is required' });
      return;
    }

    const results = await tournamentService.getTournamentResults(id, {
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
    });

    // Get total count
    const totalCount = await prisma.tournamentResult.count({
      where: { tournamentId: id },
    });

    res.json({
      success: true,
      count: results.length,
      total: totalCount,
      data: results.map(r => ({
        rank: r.rank,
        displayName: r.displayName,
        accountId: r.accountId,
        points: r.points,
        kills: r.kills,
        wins: r.wins,
        matchesPlayed: r.matchesPlayed,
        earnings: r.earnings,
        teamName: r.teamName,
        orgSlug: r.orgSlug,
        data: r.data,
      })),
      pagination: {
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
        total: totalCount,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /tournaments/:id/matches
 * Get match-by-match breakdown for tournament
 */
export async function getTournamentMatches(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { limit = '100', offset = '0' } = req.query;

    if (!id) {
      res.status(400).json({ success: false, error: 'Tournament ID is required' });
      return;
    }

    // Get match results from database
    const matches = await prisma.matchResult.findMany({
      where: { tournamentId: id },
      orderBy: [{ matchNumber: 'asc' }, { placement: 'asc' }],
      take: parseInt(limit as string, 10),
      skip: parseInt(offset as string, 10),
    });

    // Group by match number
    const matchesGrouped = new Map<number, any[]>();
    for (const match of matches) {
      const existing = matchesGrouped.get(match.matchNumber) || [];
      existing.push({
        rank: match.placement,
        displayName: match.displayName,
        accountId: match.accountId,
        kills: match.kills,
        points: match.points,
        damageDealt: match.damageDealt,
        timeAlive: match.timeAlive,
      });
      matchesGrouped.set(match.matchNumber, existing);
    }

    // Convert to array
    const matchesArray = Array.from(matchesGrouped.entries()).map(([matchNumber, results]) => ({
      matchNumber,
      resultsCount: results.length,
      results: results.sort((a, b) => (a.rank || 999) - (b.rank || 999)),
    }));

    res.json({
      success: true,
      count: matchesArray.length,
      data: matchesArray,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /tournaments/:id/player/:accountId
 * Get specific player's performance in tournament
 */
export async function getPlayerTournamentStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id, accountId } = req.params;

    if (!id || !accountId) {
      res.status(400).json({ success: false, error: 'Tournament ID and Account ID are required' });
      return;
    }

    // Get tournament result
    const result = await prisma.tournamentResult.findUnique({
      where: {
        tournamentId_accountId: {
          tournamentId: id,
          accountId,
        },
      },
      include: {
        tournament: true,
      },
    });

    if (!result) {
      res.status(404).json({
        success: false,
        error: 'Player not found in this tournament',
      });
      return;
    }

    // Get match-by-match data
    const matches = await prisma.matchResult.findMany({
      where: {
        tournamentId: id,
        accountId,
      },
      orderBy: { matchNumber: 'asc' },
    });

    // Calculate stats
    const totalKills = matches.reduce((sum, m) => sum + (m.kills || 0), 0);
    const totalPoints = matches.reduce((sum, m) => sum + (Number(m.points) || 0), 0);
    const avgPlacement = matches.length > 0
      ? matches.reduce((sum, m) => sum + (m.placement || 0), 0) / matches.length
      : null;
    const bestPlacement = matches.length > 0
      ? Math.min(...matches.map(m => m.placement || 999))
      : null;

    res.json({
      success: true,
      data: {
        tournament: {
          tournamentId: result.tournament.tournamentId,
          name: result.tournament.name,
          startDate: result.tournament.startDate,
          region: result.tournament.region,
        },
        player: {
          accountId: result.accountId,
          displayName: result.displayName,
          finalRank: result.rank,
          totalPoints: result.points,
          totalKills: result.kills,
          earnings: result.earnings,
          teamName: result.teamName,
        },
        stats: {
          matchesPlayed: matches.length,
          totalKills,
          totalPoints,
          avgPlacement,
          bestPlacement,
          avgKillsPerMatch: matches.length > 0 ? totalKills / matches.length : 0,
        },
        matches: matches.map(m => ({
          matchNumber: m.matchNumber,
          placement: m.placement,
          kills: m.kills,
          points: m.points,
          damageDealt: m.damageDealt,
          timeAlive: m.timeAlive,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /tournaments/live/:eventId/:windowId
 * Get real-time leaderboard for specific live event
 */
export async function getLiveEventLeaderboard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { eventId, windowId } = req.params;

    if (!eventId || !windowId) {
      res.status(400).json({ success: false, error: 'Event ID and Window ID are required' });
      return;
    }

    const liveData = await eventsService.getLiveTournamentData(eventId, windowId);

    if (!liveData) {
      res.status(404).json({
        success: false,
        error: 'Live tournament not found',
      });
      return;
    }

    res.json({
      success: true,
      data: {
        eventId: liveData.eventId,
        eventWindowId: liveData.eventWindowId,
        name: liveData.name,
        region: liveData.region,
        startTime: liveData.startTime,
        endTime: liveData.endTime,
        isLive: liveData.isLive,
        lastUpdated: liveData.lastUpdated,
        leaderboardCount: liveData.leaderboard.length,
        leaderboard: liveData.leaderboard.map(e => ({
          rank: e.rank,
          displayName: e.displayName,
          accountId: e.accountId,
          teamAccountIds: e.teamAccountIds,
          score: e.score,
          kills: e.sessions.reduce((sum, s) => sum + s.kills, 0),
          matchesPlayed: e.sessions.length,
          sessions: e.sessions.map(s => ({
            matchNumber: s.matchNumber,
            placement: s.placement,
            kills: s.kills,
            points: s.points,
            damageDealt: s.damageDealt,
            timeAlive: s.timeAlive,
          })),
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /tournaments/sync (admin)
 * Trigger sync of all tournaments from Liquipedia
 */
export async function syncTournaments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { years, scrapeDetails = 'false', scrapeResults = 'false' } = req.query;

    const yearsList = years
      ? (years as string).split(',').map(y => parseInt(y.trim(), 10))
      : undefined;

    const result = await tournamentService.syncTournamentsToDatabase({
      years: yearsList,
      scrapeDetails: scrapeDetails === 'true',
      scrapeResults: scrapeResults === 'true',
    });

    res.json({
      success: true,
      message: `Synced ${result.tournaments} tournaments and ${result.results} results`,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /tournaments/:id/sync (admin)
 * Sync results for a specific tournament
 */
export async function syncTournamentResults(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({ success: false, error: 'Tournament ID is required' });
      return;
    }

    const synced = await tournamentService.syncTournamentResults(id);

    res.json({
      success: true,
      message: `Synced ${synced} results for tournament ${id}`,
      synced,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /tournaments/sync-live (admin)
 * Sync all currently live events from Epic API
 */
export async function syncLiveEvents(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await eventsService.syncAllLiveEvents();

    res.json({
      success: true,
      message: `Synced ${result.events} live events with ${result.results} results and ${result.matches} matches`,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}
