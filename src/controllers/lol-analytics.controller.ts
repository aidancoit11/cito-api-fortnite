import { Request, Response } from 'express';
import { lolAnalyticsService } from '../services/lol/lol-analytics.service.js';

export async function getPlayerPerformanceTrend(req: Request, res: Response): Promise<void> {
  try {
    const playerId = req.params.playerId as string;
    const metric = (req.query.metric as string) || 'kda';
    const period = (req.query.period as string) || '30d';
    const trend = await lolAnalyticsService.getPlayerPerformanceTrend(playerId, metric as any, period as any);
    if (!trend) {
      res.status(404).json({ error: 'Player performance trend not found' });
      return;
    }
    res.json(trend);
  } catch (error) {
    console.error('Error fetching player performance trend:', error);
    res.status(500).json({ error: 'Failed to fetch player performance trend' });
  }
}

export async function getTeamPerformanceTrend(req: Request, res: Response): Promise<void> {
  try {
    const teamId = req.params.teamId as string;
    const metric = (req.query.metric as string) || 'kda';
    const period = (req.query.period as string) || '30d';
    const trend = await lolAnalyticsService.getTeamPerformanceTrend(teamId, metric as any, period as any);
    if (!trend) {
      res.status(404).json({ error: 'Team performance trend not found' });
      return;
    }
    res.json(trend);
  } catch (error) {
    console.error('Error fetching team performance trend:', error);
    res.status(500).json({ error: 'Failed to fetch team performance trend' });
  }
}

export async function getRoleComparison(req: Request, res: Response): Promise<void> {
  try {
    const role = (req.query.role as string) || 'Mid';
    const league = (req.query.league as string) || null;
    const metric = (req.query.metric as string) || 'kda';
    const comparison = await lolAnalyticsService.getRoleComparison(role, league, metric as any);
    res.json(comparison);
  } catch (error) {
    console.error('Error fetching role comparison:', error);
    res.status(500).json({ error: 'Failed to fetch role comparison' });
  }
}

export async function getRegionComparison(_req: Request, res: Response): Promise<void> {
  try {
    const comparison = await lolAnalyticsService.getRegionComparison();
    res.json(comparison);
  } catch (error) {
    console.error('Error fetching region comparison:', error);
    res.status(500).json({ error: 'Failed to fetch region comparison' });
  }
}

export async function getDraftAnalysis(req: Request, res: Response): Promise<void> {
  try {
    const { matchId } = req.params;
    if (!matchId) {
      res.status(400).json({ error: 'matchId is required' });
      return;
    }
    const analysis = await lolAnalyticsService.getDraftAnalysis(matchId);
    if (!analysis) {
      res.status(404).json({ error: 'Draft analysis not found' });
      return;
    }
    res.json(analysis);
  } catch (error) {
    console.error('Error fetching draft analysis:', error);
    res.status(500).json({ error: 'Failed to fetch draft analysis' });
  }
}

export async function getTeamWinConditions(req: Request, res: Response): Promise<void> {
  try {
    const { teamId } = req.params;
    const winConditions = await lolAnalyticsService.getTeamWinConditions(teamId as string);
    if (!winConditions) {
      res.status(404).json({ error: 'Team win conditions not found' });
      return;
    }
    res.json(winConditions);
  } catch (error) {
    console.error('Error fetching team win conditions:', error);
    res.status(500).json({ error: 'Failed to fetch team win conditions' });
  }
}

export async function getPlayerImpactScore(req: Request, res: Response): Promise<void> {
  try {
    const { playerId } = req.params;
    const impactScore = await lolAnalyticsService.getPlayerImpactScore(playerId as string);
    if (!impactScore) {
      res.status(404).json({ error: 'Player impact score not found' });
      return;
    }
    res.json(impactScore);
  } catch (error) {
    console.error('Error fetching player impact score:', error);
    res.status(500).json({ error: 'Failed to fetch player impact score' });
  }
}

export async function getClutchFactor(req: Request, res: Response): Promise<void> {
  try {
    const { playerId } = req.params;
    const clutchFactor = await lolAnalyticsService.getClutchFactor(playerId as string);
    if (!clutchFactor) {
      res.status(404).json({ error: 'Clutch factor not found' });
      return;
    }
    res.json(clutchFactor);
  } catch (error) {
    console.error('Error fetching clutch factor:', error);
    res.status(500).json({ error: 'Failed to fetch clutch factor' });
  }
}
