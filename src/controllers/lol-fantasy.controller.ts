import { Request, Response } from 'express';
import { lolFantasyService } from '../services/lol/lol-fantasy.service.js';

export async function getPlayerProjections(req: Request, res: Response): Promise<void> {
  try {
    const projections = await lolFantasyService.getPlayerProjections(req.query);
    res.json(projections);
  } catch (error) {
    console.error('Error fetching player projections:', error);
    res.status(500).json({ error: 'Failed to fetch player projections' });
  }
}

export async function getPlayerFantasyStats(req: Request, res: Response): Promise<void> {
  try {
    const { playerId } = req.params;
    const stats = await lolFantasyService.getPlayerFantasyStats(playerId as string, req.query);
    if (!stats) {
      res.status(404).json({ error: 'Player fantasy stats not found' });
      return;
    }
    res.json(stats);
  } catch (error) {
    console.error('Error fetching player fantasy stats:', error);
    res.status(500).json({ error: 'Failed to fetch player fantasy stats' });
  }
}

export async function getOptimalLineup(req: Request, res: Response): Promise<void> {
  try {
    const lineup = await lolFantasyService.getOptimalLineup(req.query);
    res.json(lineup);
  } catch (error) {
    console.error('Error fetching optimal lineup:', error);
    res.status(500).json({ error: 'Failed to fetch optimal lineup' });
  }
}

export async function getValuePicks(req: Request, res: Response): Promise<void> {
  try {
    const valuePicks = await lolFantasyService.getValuePicks(req.query);
    res.json(valuePicks);
  } catch (error) {
    console.error('Error fetching value picks:', error);
    res.status(500).json({ error: 'Failed to fetch value picks' });
  }
}
