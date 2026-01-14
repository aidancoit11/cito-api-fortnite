import { Request, Response } from 'express';
import { lolLiveService } from '../services/lol/lol-live.service.js';

export async function getLiveMatches(_req: Request, res: Response): Promise<void> {
  try {
    const matches = await lolLiveService.getLiveMatches();
    res.json(matches);
  } catch (error) {
    console.error('Error fetching live matches:', error);
    res.status(500).json({ error: 'Failed to fetch live matches' });
  }
}

export async function getLiveMatch(req: Request, res: Response): Promise<void> {
  try {
    const { matchId } = req.params;
    const match = await lolLiveService.getLiveMatch(matchId as string);
    if (!match) {
      res.status(404).json({ error: 'Live match not found' });
      return;
    }
    res.json(match);
  } catch (error) {
    console.error('Error fetching live match:', error);
    res.status(500).json({ error: 'Failed to fetch live match' });
  }
}

export async function getLiveGameStats(req: Request, res: Response): Promise<void> {
  try {
    const { gameId } = req.params;
    const stats = await lolLiveService.getLiveGameStats(gameId as string);
    if (!stats) {
      res.status(404).json({ error: 'Live game stats not found' });
      return;
    }
    res.json(stats);
  } catch (error) {
    console.error('Error fetching live game stats:', error);
    res.status(500).json({ error: 'Failed to fetch live game stats' });
  }
}

export async function getLiveGameWindow(req: Request, res: Response): Promise<void> {
  try {
    const { gameId } = req.params;
    const { timestamp } = req.query;
    const window = await lolLiveService.getLiveGameWindow(gameId as string, timestamp as string | undefined);
    if (!window) {
      res.status(404).json({ error: 'Live game window not found' });
      return;
    }
    res.json(window);
  } catch (error) {
    console.error('Error fetching live game window:', error);
    res.status(500).json({ error: 'Failed to fetch live game window' });
  }
}

export async function getLiveGameDetails(req: Request, res: Response): Promise<void> {
  try {
    const { gameId } = req.params;
    const details = await lolLiveService.getLiveGameDetails(gameId as string);
    if (!details) {
      res.status(404).json({ error: 'Live game details not found' });
      return;
    }
    res.json(details);
  } catch (error) {
    console.error('Error fetching live game details:', error);
    res.status(500).json({ error: 'Failed to fetch live game details' });
  }
}

export async function getLiveGameEvents(req: Request, res: Response): Promise<void> {
  try {
    const { gameId } = req.params;
    const events = await lolLiveService.getLiveGameEvents(gameId as string);
    if (!events) {
      res.status(404).json({ error: 'Live game events not found' });
      return;
    }
    res.json(events);
  } catch (error) {
    console.error('Error fetching live game events:', error);
    res.status(500).json({ error: 'Failed to fetch live game events' });
  }
}
