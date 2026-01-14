import { Request, Response } from 'express';
import { lolChampionService } from '../services/lol/lol-champion.service.js';

export async function getChampionStats(req: Request, res: Response): Promise<void> {
  try {
    const stats = await lolChampionService.getChampionStats(req.query);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching champion stats:', error);
    res.status(500).json({ error: 'Failed to fetch champion stats' });
  }
}

export async function getChampionById(req: Request, res: Response): Promise<void> {
  try {
    const { championId } = req.params;
    const champion = await lolChampionService.getChampionById(parseInt(championId as string, 10));
    if (!champion) {
      res.status(404).json({ error: 'Champion not found' });
      return;
    }
    res.json(champion);
  } catch (error) {
    console.error('Error fetching champion by ID:', error);
    res.status(500).json({ error: 'Failed to fetch champion' });
  }
}

export async function getChampionPlayers(req: Request, res: Response): Promise<void> {
  try {
    const { championId } = req.params;
    const players = await lolChampionService.getChampionPlayers(parseInt(championId as string, 10), req.query);
    if (!players) {
      res.status(404).json({ error: 'Champion players not found' });
      return;
    }
    res.json(players);
  } catch (error) {
    console.error('Error fetching champion players:', error);
    res.status(500).json({ error: 'Failed to fetch champion players' });
  }
}

export async function getChampionMatchups(req: Request, res: Response): Promise<void> {
  try {
    const { championId } = req.params;
    const matchups = await lolChampionService.getChampionMatchups(parseInt(championId as string, 10), req.query);
    if (!matchups) {
      res.status(404).json({ error: 'Champion matchups not found' });
      return;
    }
    res.json(matchups);
  } catch (error) {
    console.error('Error fetching champion matchups:', error);
    res.status(500).json({ error: 'Failed to fetch champion matchups' });
  }
}

export async function getMetaSummary(req: Request, res: Response): Promise<void> {
  try {
    const patch = req.query.patch as string;
    const league = req.query.league as string | undefined;
    const role = req.query.role as string | undefined;
    const metaSummary = await lolChampionService.getMetaSummary(patch, league, role);
    res.json(metaSummary);
  } catch (error) {
    console.error('Error fetching meta summary:', error);
    res.status(500).json({ error: 'Failed to fetch meta summary' });
  }
}

export async function getPatchChanges(req: Request, res: Response): Promise<void> {
  try {
    const patch = req.query.patch as string;
    const patchChanges = await lolChampionService.getPatchChanges(patch);
    res.json(patchChanges);
  } catch (error) {
    console.error('Error fetching patch changes:', error);
    res.status(500).json({ error: 'Failed to fetch patch changes' });
  }
}
