import { Request, Response } from 'express';
import { lolLeagueService } from '../services/lol/lol-league.service.js';

/**
 * GET /leagues
 * Get all leagues
 * Query params: region, tier, active
 */
export async function getAllLeagues(req: Request, res: Response): Promise<void> {
  try {
    const { region, tier, active } = req.query;

    const leagues = await lolLeagueService.getAllLeagues({
      region: region as string | undefined,
      tier: tier as string | undefined,
      isActive: active !== undefined ? active === 'true' : undefined,
    });

    res.json({
      success: true,
      count: leagues.length,
      data: leagues,
    });
  } catch (error: any) {
    console.error('[LolLeagueController] Error getting all leagues:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get leagues',
      message: error.message,
    });
  }
}

/**
 * GET /leagues/:leagueId
 * Get league by ID
 */
export async function getLeagueById(req: Request, res: Response): Promise<void> {
  try {
    const { leagueId } = req.params;

    if (!leagueId) {
      res.status(400).json({
        success: false,
        error: 'Missing league ID',
      });
      return;
    }

    const league = await lolLeagueService.getLeagueById(leagueId);

    if (!league) {
      res.status(404).json({
        success: false,
        error: 'League not found',
        message: `No league found with ID: ${leagueId}`,
      });
      return;
    }

    res.json({
      success: true,
      data: league,
    });
  } catch (error: any) {
    console.error('[LolLeagueController] Error getting league by ID:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get league',
      message: error.message,
    });
  }
}

/**
 * GET /leagues/:leagueId/standings
 * Get league standings
 * Query params: season, stage
 */
export async function getLeagueStandings(req: Request, res: Response): Promise<void> {
  try {
    const { leagueId } = req.params;
    const { season, stage } = req.query;

    if (!leagueId) {
      res.status(400).json({
        success: false,
        error: 'Missing league ID',
      });
      return;
    }

    const standings = await lolLeagueService.getLeagueStandings(
      leagueId,
      season as string | undefined,
      stage as string | undefined
    );

    if (!standings) {
      res.status(404).json({
        success: false,
        error: 'Standings not found',
        message: `No standings found for league ID: ${leagueId}`,
      });
      return;
    }

    res.json({
      success: true,
      data: standings,
    });
  } catch (error: any) {
    console.error('[LolLeagueController] Error getting league standings:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get league standings',
      message: error.message,
    });
  }
}

/**
 * GET /leagues/:leagueId/schedule
 * Get league schedule
 * Query params: from, to, state
 */
export async function getLeagueSchedule(req: Request, res: Response): Promise<void> {
  try {
    const { leagueId } = req.params;
    const { from, to, state } = req.query;

    if (!leagueId) {
      res.status(400).json({
        success: false,
        error: 'Missing league ID',
      });
      return;
    }

    const schedule = await lolLeagueService.getLeagueSchedule(leagueId, {
      startDate: from ? new Date(from as string) : undefined,
      endDate: to ? new Date(to as string) : undefined,
      state: state as 'completed' | 'inProgress' | 'unstarted' | undefined,
    });

    if (!schedule) {
      res.status(404).json({
        success: false,
        error: 'Schedule not found',
        message: `No schedule found for league ID: ${leagueId}`,
      });
      return;
    }

    res.json({
      success: true,
      data: schedule,
    });
  } catch (error: any) {
    console.error('[LolLeagueController] Error getting league schedule:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get league schedule',
      message: error.message,
    });
  }
}

/**
 * GET /leagues/:leagueId/history
 * Get league history
 */
export async function getLeagueHistory(req: Request, res: Response): Promise<void> {
  try {
    const { leagueId } = req.params;

    if (!leagueId) {
      res.status(400).json({
        success: false,
        error: 'Missing league ID',
      });
      return;
    }

    const history = await lolLeagueService.getLeagueHistory(leagueId);

    if (!history) {
      res.status(404).json({
        success: false,
        error: 'History not found',
        message: `No history found for league ID: ${leagueId}`,
      });
      return;
    }

    res.json({
      success: true,
      data: history,
    });
  } catch (error: any) {
    console.error('[LolLeagueController] Error getting league history:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get league history',
      message: error.message,
    });
  }
}

/**
 * GET /leagues/:leagueId/teams
 * Get league teams
 */
export async function getLeagueTeams(req: Request, res: Response): Promise<void> {
  try {
    const { leagueId } = req.params;

    if (!leagueId) {
      res.status(400).json({
        success: false,
        error: 'Missing league ID',
      });
      return;
    }

    const teams = await lolLeagueService.getLeagueTeams(leagueId);

    if (!teams) {
      res.status(404).json({
        success: false,
        error: 'Teams not found',
        message: `No teams found for league ID: ${leagueId}`,
      });
      return;
    }

    res.json({
      success: true,
      data: teams,
    });
  } catch (error: any) {
    console.error('[LolLeagueController] Error getting league teams:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get league teams',
      message: error.message,
    });
  }
}
