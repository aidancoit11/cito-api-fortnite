import { Request, Response } from 'express';
import { lolTeamService } from '../services/lol/lol-team.service.js';

export async function getAllTeams(req: Request, res: Response) {
  try {
    const { league, region, active, search, limit, offset } = req.query;
    const teams = await lolTeamService.getAllTeams({
      league: league as string,
      region: region as string,
      active: active === 'true' ? true : active === 'false' ? false : undefined,
      search: search as string,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    });
    res.json(teams);
  } catch (error) {
    console.error('Error fetching all teams:', error);
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
}

export async function getTeamBySlug(req: Request, res: Response): Promise<void> {
  try {
    const slug = req.params.slug as string;
    const team = await lolTeamService.getTeamBySlug(slug);
    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    res.json(team);
  } catch (error) {
    console.error('Error fetching team by slug:', error);
    res.status(500).json({ error: 'Failed to fetch team' });
  }
}

export async function getTeamRoster(req: Request, res: Response) {
  try {
    const slug = req.params.slug as string;
    const roster = await lolTeamService.getTeamRoster(slug);
    res.json(roster);
  } catch (error) {
    console.error('Error fetching team roster:', error);
    res.status(500).json({ error: 'Failed to fetch team roster' });
  }
}

export async function getTeamRosterHistory(req: Request, res: Response) {
  try {
    const slug = req.params.slug as string;
    const history = await lolTeamService.getTeamRosterHistory(slug);
    res.json(history);
  } catch (error) {
    console.error('Error fetching team roster history:', error);
    res.status(500).json({ error: 'Failed to fetch team roster history' });
  }
}

export async function getTeamMatches(req: Request, res: Response) {
  try {
    const slug = req.params.slug as string;
    const { tournamentId, state, limit, offset } = req.query;
    const matches = await lolTeamService.getTeamMatches(slug, {
      tournamentId: tournamentId as string,
      state: state as 'completed' | 'upcoming' | 'all',
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    });
    res.json(matches);
  } catch (error) {
    console.error('Error fetching team matches:', error);
    res.status(500).json({ error: 'Failed to fetch team matches' });
  }
}

export async function getTeamStats(req: Request, res: Response) {
  try {
    const slug = req.params.slug as string;
    const { season, tournamentId } = req.query;
    const stats = await lolTeamService.getTeamStats(slug, {
      season: season as string,
      tournamentId: tournamentId as string,
    });
    res.json(stats);
  } catch (error) {
    console.error('Error fetching team stats:', error);
    res.status(500).json({ error: 'Failed to fetch team stats' });
  }
}

export async function getTeamHeadToHead(req: Request, res: Response) {
  try {
    const slug = req.params.slug as string;
    const opponentSlug = req.params.opponentSlug as string;
    const h2h = await lolTeamService.getTeamHeadToHead(slug, opponentSlug);
    res.json(h2h);
  } catch (error) {
    console.error('Error fetching team head-to-head:', error);
    res.status(500).json({ error: 'Failed to fetch team head-to-head' });
  }
}

export async function getTeamEarnings(req: Request, res: Response) {
  try {
    const slug = req.params.slug as string;
    const earnings = await lolTeamService.getTeamEarnings(slug);
    res.json(earnings);
  } catch (error) {
    console.error('Error fetching team earnings:', error);
    res.status(500).json({ error: 'Failed to fetch team earnings' });
  }
}

export async function getTeamAchievements(req: Request, res: Response) {
  try {
    const slug = req.params.slug as string;
    const achievements = await lolTeamService.getTeamAchievements(slug);
    res.json(achievements);
  } catch (error) {
    console.error('Error fetching team achievements:', error);
    res.status(500).json({ error: 'Failed to fetch team achievements' });
  }
}

export async function getTeamChampionPool(req: Request, res: Response) {
  try {
    const slug = req.params.slug as string;
    const champions = await lolTeamService.getTeamChampionPool(slug);
    res.json(champions);
  } catch (error) {
    console.error('Error fetching team champion pool:', error);
    res.status(500).json({ error: 'Failed to fetch team champion pool' });
  }
}
