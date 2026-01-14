import { Request, Response } from 'express';
import { lolSearchService } from '../services/lol/lol-search.service.js';

export async function globalSearch(req: Request, res: Response): Promise<void> {
  try {
    const { q, limit, type } = req.query;
    const results = await lolSearchService.globalSearch(
      q as string,
      (type as 'player' | 'team' | 'tournament' | 'all') || 'all',
      limit ? parseInt(limit as string, 10) : undefined
    );
    res.json(results);
  } catch (error) {
    console.error('Error performing global search:', error);
    res.status(500).json({ error: 'Failed to perform search' });
  }
}

export async function autocomplete(req: Request, res: Response): Promise<void> {
  try {
    const { q, limit, type } = req.query;
    const suggestions = await lolSearchService.autocomplete(
      q as string,
      (type as 'player' | 'team' | 'tournament' | 'all') || 'all',
      limit ? parseInt(limit as string, 10) : undefined
    );
    res.json(suggestions);
  } catch (error) {
    console.error('Error fetching autocomplete suggestions:', error);
    res.status(500).json({ error: 'Failed to fetch autocomplete suggestions' });
  }
}

export async function getTrending(_req: Request, res: Response): Promise<void> {
  try {
    const trending = await lolSearchService.getTrending();
    res.json(trending);
  } catch (error) {
    console.error('Error fetching trending:', error);
    res.status(500).json({ error: 'Failed to fetch trending' });
  }
}
