import { Request, Response } from 'express';
import { lolRecordsService } from '../services/lol/lol-records.service.js';

export async function getAllRecords(req: Request, res: Response): Promise<void> {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const league = typeof req.query.league === 'string' ? req.query.league : undefined;
    const region = typeof req.query.region === 'string' ? req.query.region : undefined;
    const records = await lolRecordsService.getAllRecords(category, league, region);
    res.json(records);
  } catch (error) {
    console.error('Error fetching all records:', error);
    res.status(500).json({ error: 'Failed to fetch all records' });
  }
}

export async function getRecordHolders(req: Request, res: Response): Promise<void> {
  try {
    const recordType = req.params.recordType as string;
    if (!recordType) {
      res.status(400).json({ error: 'Record type is required' });
      return;
    }
    const holders = await lolRecordsService.getRecordHolders(recordType);
    if (!holders) {
      res.status(404).json({ error: 'Record holders not found' });
      return;
    }
    res.json(holders);
  } catch (error) {
    console.error('Error fetching record holders:', error);
    res.status(500).json({ error: 'Failed to fetch record holders' });
  }
}

export async function getPlayerRecords(req: Request, res: Response): Promise<void> {
  try {
    const playerId = req.params.playerId as string;
    if (!playerId) {
      res.status(400).json({ error: 'Player ID is required' });
      return;
    }
    const records = await lolRecordsService.getPlayerRecords(playerId);
    if (!records) {
      res.status(404).json({ error: 'Player records not found' });
      return;
    }
    res.json(records);
  } catch (error) {
    console.error('Error fetching player records:', error);
    res.status(500).json({ error: 'Failed to fetch player records' });
  }
}

export async function getTeamRecords(req: Request, res: Response): Promise<void> {
  try {
    const teamId = req.params.teamId as string;
    if (!teamId) {
      res.status(400).json({ error: 'Team ID is required' });
      return;
    }
    const records = await lolRecordsService.getTeamRecords(teamId);
    if (!records) {
      res.status(404).json({ error: 'Team records not found' });
      return;
    }
    res.json(records);
  } catch (error) {
    console.error('Error fetching team records:', error);
    res.status(500).json({ error: 'Failed to fetch team records' });
  }
}

export async function getHistoricalStats(req: Request, res: Response): Promise<void> {
  try {
    const yearParam = req.query.year;
    const year = typeof yearParam === 'string' ? parseInt(yearParam, 10) : NaN;
    if (isNaN(year)) {
      res.status(400).json({ error: 'Valid year is required' });
      return;
    }
    const stats = await lolRecordsService.getHistoricalStats(year);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching historical stats:', error);
    res.status(500).json({ error: 'Failed to fetch historical stats' });
  }
}

export async function getWorldsChampions(_req: Request, res: Response): Promise<void> {
  try {
    const champions = await lolRecordsService.getWorldsChampions();
    res.json(champions);
  } catch (error) {
    console.error('Error fetching Worlds champions:', error);
    res.status(500).json({ error: 'Failed to fetch Worlds champions' });
  }
}

export async function getMsiChampions(_req: Request, res: Response): Promise<void> {
  try {
    const champions = await lolRecordsService.getMsiChampions();
    res.json(champions);
  } catch (error) {
    console.error('Error fetching MSI champions:', error);
    res.status(500).json({ error: 'Failed to fetch MSI champions' });
  }
}

export async function getHallOfFame(_req: Request, res: Response): Promise<void> {
  try {
    const hallOfFame = await lolRecordsService.getHallOfFame();
    res.json(hallOfFame);
  } catch (error) {
    console.error('Error fetching Hall of Fame:', error);
    res.status(500).json({ error: 'Failed to fetch Hall of Fame' });
  }
}
