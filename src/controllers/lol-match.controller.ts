import { Request, Response } from 'express';
import { lolMatchService } from '../services/lol/lol-match.service.js';

export async function getMatchById(req: Request, res: Response): Promise<void> {
  try {
    const matchId = req.params.matchId as string;
    const match = await lolMatchService.getMatchById(matchId);
    res.json(match);
  } catch (error) {
    console.error('Error fetching match by ID:', error);
    res.status(500).json({ error: 'Failed to fetch match' });
  }
}

export async function getMatchGames(req: Request, res: Response): Promise<void> {
  try {
    const matchId = req.params.matchId as string;
    const games = await lolMatchService.getMatchGames(matchId);
    res.json(games);
  } catch (error) {
    console.error('Error fetching match games:', error);
    res.status(500).json({ error: 'Failed to fetch match games' });
  }
}

export async function getMatchStats(req: Request, res: Response): Promise<void> {
  try {
    const matchId = req.params.matchId as string;
    const stats = await lolMatchService.getMatchStats(matchId);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching match stats:', error);
    res.status(500).json({ error: 'Failed to fetch match stats' });
  }
}

export async function getMatchTimeline(req: Request, res: Response): Promise<void> {
  try {
    const matchId = req.params.matchId as string;
    const timeline = await lolMatchService.getMatchTimeline(matchId);
    res.json(timeline);
  } catch (error) {
    console.error('Error fetching match timeline:', error);
    res.status(500).json({ error: 'Failed to fetch match timeline' });
  }
}

export async function getGameById(req: Request, res: Response): Promise<void> {
  try {
    const gameId = req.params.gameId as string;
    const game = await lolMatchService.getGameById(gameId);
    res.json(game);
  } catch (error) {
    console.error('Error fetching game by ID:', error);
    res.status(500).json({ error: 'Failed to fetch game' });
  }
}

export async function getGameStats(req: Request, res: Response): Promise<void> {
  try {
    const gameId = req.params.gameId as string;
    const stats = await lolMatchService.getGameStats(gameId);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching game stats:', error);
    res.status(500).json({ error: 'Failed to fetch game stats' });
  }
}

export async function getGameTimeline(req: Request, res: Response): Promise<void> {
  try {
    const gameId = req.params.gameId as string;
    const timeline = await lolMatchService.getGameTimeline(gameId);
    res.json(timeline);
  } catch (error) {
    console.error('Error fetching game timeline:', error);
    res.status(500).json({ error: 'Failed to fetch game timeline' });
  }
}

export async function getGameBuilds(req: Request, res: Response): Promise<void> {
  try {
    const gameId = req.params.gameId as string;
    const builds = await lolMatchService.getGameBuilds(gameId);
    res.json(builds);
  } catch (error) {
    console.error('Error fetching game builds:', error);
    res.status(500).json({ error: 'Failed to fetch game builds' });
  }
}

export async function getGameGoldGraph(req: Request, res: Response): Promise<void> {
  try {
    const gameId = req.params.gameId as string;
    const goldGraph = await lolMatchService.getGameGoldGraph(gameId);
    res.json(goldGraph);
  } catch (error) {
    console.error('Error fetching game gold graph:', error);
    res.status(500).json({ error: 'Failed to fetch game gold graph' });
  }
}

export async function getGameObjectives(req: Request, res: Response): Promise<void> {
  try {
    const gameId = req.params.gameId as string;
    const objectives = await lolMatchService.getGameObjectives(gameId);
    res.json(objectives);
  } catch (error) {
    console.error('Error fetching game objectives:', error);
    res.status(500).json({ error: 'Failed to fetch game objectives' });
  }
}
