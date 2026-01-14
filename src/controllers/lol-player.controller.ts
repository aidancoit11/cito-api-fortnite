import { Request, Response } from 'express';
import { lolPlayerService, LolPlayerFilters, LolPlayerStatsFilters } from '../services/lol/lol-player.service.js';

export async function getAllPlayers(req: Request, res: Response): Promise<void> {
  try {
    const filters: LolPlayerFilters = {
      team: req.query.team as string | undefined,
      role: req.query.role as LolPlayerFilters['role'],
      region: req.query.region as string | undefined,
      nationality: req.query.nationality as string | undefined,
      active: req.query.active === 'true' ? true : req.query.active === 'false' ? false : undefined,
      freeAgent: req.query.freeAgent === 'true' ? true : req.query.freeAgent === 'false' ? false : undefined,
      search: req.query.search as string | undefined,
      sort: req.query.sort as LolPlayerFilters['sort'],
      sortOrder: req.query.sortOrder as LolPlayerFilters['sortOrder'],
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    };
    const players = await lolPlayerService.getAllPlayers(filters);
    res.json(players);
  } catch (error) {
    console.error('Error getting all players:', error);
    res.status(500).json({ error: 'Failed to get players' });
  }
}

export async function searchPlayers(req: Request, res: Response): Promise<void> {
  try {
    const q = req.query.q as string;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const players = await lolPlayerService.searchPlayers(q, { limit });
    res.json(players);
  } catch (error) {
    console.error('Error searching players:', error);
    res.status(500).json({ error: 'Failed to search players' });
  }
}

export async function getPlayerById(req: Request, res: Response): Promise<void> {
  try {
    const playerId = req.params.playerId as string;
    const player = await lolPlayerService.getPlayerById(playerId);
    if (!player) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }
    res.json(player);
  } catch (error) {
    console.error('Error getting player by ID:', error);
    res.status(500).json({ error: 'Failed to get player' });
  }
}

export async function getPlayerStats(req: Request, res: Response): Promise<void> {
  try {
    const playerId = req.params.playerId as string;
    const filters: LolPlayerStatsFilters = {
      season: req.query.season as string | undefined,
      tournament: req.query.tournament as string | undefined,
      team: req.query.team as string | undefined,
      champion: req.query.champion as string | number | undefined,
      league: req.query.league as string | undefined,
    };
    const stats = await lolPlayerService.getPlayerStats(playerId, filters);
    if (!stats) {
      res.status(404).json({ error: 'Player stats not found' });
      return;
    }
    res.json(stats);
  } catch (error) {
    console.error('Error getting player stats:', error);
    res.status(500).json({ error: 'Failed to get player stats' });
  }
}

export async function getPlayerCareerStats(req: Request, res: Response): Promise<void> {
  try {
    const playerId = req.params.playerId as string;
    const careerStats = await lolPlayerService.getPlayerCareerStats(playerId);
    if (!careerStats) {
      res.status(404).json({ error: 'Player career stats not found' });
      return;
    }
    res.json(careerStats);
  } catch (error) {
    console.error('Error getting player career stats:', error);
    res.status(500).json({ error: 'Failed to get player career stats' });
  }
}

export async function getPlayerEarnings(req: Request, res: Response): Promise<void> {
  try {
    const playerId = req.params.playerId as string;
    const options = {
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    };
    const earnings = await lolPlayerService.getPlayerEarnings(playerId, options);
    if (!earnings) {
      res.status(404).json({ error: 'Player earnings not found' });
      return;
    }
    res.json(earnings);
  } catch (error) {
    console.error('Error getting player earnings:', error);
    res.status(500).json({ error: 'Failed to get player earnings' });
  }
}

export async function getPlayerEarningsSummary(req: Request, res: Response): Promise<void> {
  try {
    const playerId = req.params.playerId as string;
    const summary = await lolPlayerService.getPlayerEarningsSummary(playerId);
    if (!summary) {
      res.status(404).json({ error: 'Player earnings summary not found' });
      return;
    }
    res.json(summary);
  } catch (error) {
    console.error('Error getting player earnings summary:', error);
    res.status(500).json({ error: 'Failed to get player earnings summary' });
  }
}

export async function getPlayerTeamHistory(req: Request, res: Response): Promise<void> {
  try {
    const playerId = req.params.playerId as string;
    const teamHistory = await lolPlayerService.getPlayerTeamHistory(playerId);
    if (!teamHistory) {
      res.status(404).json({ error: 'Player team history not found' });
      return;
    }
    res.json(teamHistory);
  } catch (error) {
    console.error('Error getting player team history:', error);
    res.status(500).json({ error: 'Failed to get player team history' });
  }
}

export async function getPlayerMatches(req: Request, res: Response): Promise<void> {
  try {
    const playerId = req.params.playerId as string;
    const options = {
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    };
    const matches = await lolPlayerService.getPlayerMatches(playerId, options);
    if (!matches) {
      res.status(404).json({ error: 'Player matches not found' });
      return;
    }
    res.json(matches);
  } catch (error) {
    console.error('Error getting player matches:', error);
    res.status(500).json({ error: 'Failed to get player matches' });
  }
}

export async function getPlayerChampions(req: Request, res: Response): Promise<void> {
  try {
    const playerId = req.params.playerId as string;
    const options = {
      season: req.query.season as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };
    const champions = await lolPlayerService.getPlayerChampions(playerId, options);
    if (!champions) {
      res.status(404).json({ error: 'Player champions not found' });
      return;
    }
    res.json(champions);
  } catch (error) {
    console.error('Error getting player champions:', error);
    res.status(500).json({ error: 'Failed to get player champions' });
  }
}

export async function getPlayerAchievements(req: Request, res: Response): Promise<void> {
  try {
    const playerId = req.params.playerId as string;
    const achievements = await lolPlayerService.getPlayerAchievements(playerId);
    if (!achievements) {
      res.status(404).json({ error: 'Player achievements not found' });
      return;
    }
    res.json(achievements);
  } catch (error) {
    console.error('Error getting player achievements:', error);
    res.status(500).json({ error: 'Failed to get player achievements' });
  }
}

export async function comparePlayer(req: Request, res: Response): Promise<void> {
  try {
    const playerId = req.params.playerId as string;
    const otherPlayerId = req.params.otherPlayerId as string;
    const comparison = await lolPlayerService.comparePlayer(playerId, otherPlayerId);
    if (!comparison) {
      res.status(404).json({ error: 'Player comparison not found' });
      return;
    }
    res.json(comparison);
  } catch (error) {
    console.error('Error comparing players:', error);
    res.status(500).json({ error: 'Failed to compare players' });
  }
}

export async function getPlayerPeers(req: Request, res: Response): Promise<void> {
  try {
    const playerId = req.params.playerId as string;
    const options = {
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };
    const peers = await lolPlayerService.getPlayerPeers(playerId, options);
    if (!peers) {
      res.status(404).json({ error: 'Player peers not found' });
      return;
    }
    res.json(peers);
  } catch (error) {
    console.error('Error getting player peers:', error);
    res.status(500).json({ error: 'Failed to get player peers' });
  }
}
