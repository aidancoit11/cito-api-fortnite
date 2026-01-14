import { Request, Response } from 'express';
import { lolLeaderboardService } from '../services/lol/lol-leaderboard.service.js';

export async function getTopEarners(req: Request, res: Response): Promise<void> {
  try {
    const topEarners = await lolLeaderboardService.getTopEarners(req.query);
    res.json(topEarners);
  } catch (error) {
    console.error('Error fetching top earners:', error);
    res.status(500).json({ error: 'Failed to fetch top earners' });
  }
}

export async function getKdaLeaderboard(req: Request, res: Response): Promise<void> {
  try {
    const kdaLeaderboard = await lolLeaderboardService.getKdaLeaderboard(req.query);
    res.json(kdaLeaderboard);
  } catch (error) {
    console.error('Error fetching KDA leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch KDA leaderboard' });
  }
}

export async function getCsLeaderboard(req: Request, res: Response): Promise<void> {
  try {
    const csLeaderboard = await lolLeaderboardService.getCsLeaderboard(req.query);
    res.json(csLeaderboard);
  } catch (error) {
    console.error('Error fetching CS leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch CS leaderboard' });
  }
}

export async function getWinRateLeaderboard(req: Request, res: Response): Promise<void> {
  try {
    const winRateLeaderboard = await lolLeaderboardService.getWinRateLeaderboard(req.query);
    res.json(winRateLeaderboard);
  } catch (error) {
    console.error('Error fetching win rate leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch win rate leaderboard' });
  }
}

export async function getVisionLeaderboard(req: Request, res: Response): Promise<void> {
  try {
    const visionLeaderboard = await lolLeaderboardService.getVisionLeaderboard(req.query);
    res.json(visionLeaderboard);
  } catch (error) {
    console.error('Error fetching vision leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch vision leaderboard' });
  }
}

export async function getFirstBloodLeaderboard(req: Request, res: Response): Promise<void> {
  try {
    const firstBloodLeaderboard = await lolLeaderboardService.getFirstBloodLeaderboard(req.query);
    res.json(firstBloodLeaderboard);
  } catch (error) {
    console.error('Error fetching first blood leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch first blood leaderboard' });
  }
}

export async function getDamageLeaderboard(req: Request, res: Response): Promise<void> {
  try {
    const damageLeaderboard = await lolLeaderboardService.getDamageLeaderboard(req.query);
    res.json(damageLeaderboard);
  } catch (error) {
    console.error('Error fetching damage leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch damage leaderboard' });
  }
}

export async function getMostChampionships(req: Request, res: Response): Promise<void> {
  try {
    const typeParam = req.query.type;
    const validTypes = ['worlds', 'msi', 'regional', 'all'] as const;
    type ChampionshipType = typeof validTypes[number];

    // Parse and validate the type parameter
    const type: ChampionshipType = typeof typeParam === 'string' && validTypes.includes(typeParam as ChampionshipType)
      ? (typeParam as ChampionshipType)
      : 'all';

    const mostChampionships = await lolLeaderboardService.getMostChampionships(type);
    res.json(mostChampionships);
  } catch (error) {
    console.error('Error fetching most championships:', error);
    res.status(500).json({ error: 'Failed to fetch most championships' });
  }
}
