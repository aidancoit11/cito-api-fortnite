import { Request, Response } from 'express';
import { lolTransferService } from '../services/lol/lol-transfer.service.js';

export async function getRecentTransfers(req: Request, res: Response): Promise<void> {
  try {
    const transfers = await lolTransferService.getRecentTransfers(req.query);
    res.json(transfers);
  } catch (error) {
    console.error('Error fetching recent transfers:', error);
    res.status(500).json({ error: 'Failed to fetch recent transfers' });
  }
}

export async function getTransferById(req: Request, res: Response): Promise<void> {
  try {
    const { transferId } = req.params;
    const transfer = await lolTransferService.getTransferById(transferId as string);
    if (!transfer) {
      res.status(404).json({ error: 'Transfer not found' });
      return;
    }
    res.json(transfer);
  } catch (error) {
    console.error('Error fetching transfer by ID:', error);
    res.status(500).json({ error: 'Failed to fetch transfer' });
  }
}

export async function getPlayerTransferHistory(req: Request, res: Response): Promise<void> {
  try {
    const { playerId } = req.params;
    const history = await lolTransferService.getPlayerTransferHistory(playerId as string);
    if (!history) {
      res.status(404).json({ error: 'Player transfer history not found' });
      return;
    }
    res.json(history);
  } catch (error) {
    console.error('Error fetching player transfer history:', error);
    res.status(500).json({ error: 'Failed to fetch player transfer history' });
  }
}

export async function getTeamTransferActivity(req: Request, res: Response): Promise<void> {
  try {
    const { teamId } = req.params;
    const activity = await lolTransferService.getTeamTransferActivity(teamId as string);
    if (!activity) {
      res.status(404).json({ error: 'Team transfer activity not found' });
      return;
    }
    res.json(activity);
  } catch (error) {
    console.error('Error fetching team transfer activity:', error);
    res.status(500).json({ error: 'Failed to fetch team transfer activity' });
  }
}

export async function getTransferWindowSummary(req: Request, res: Response): Promise<void> {
  try {
    const season = req.query.season as string | undefined;
    const summary = await lolTransferService.getTransferWindowSummary(season);
    res.json(summary);
  } catch (error) {
    console.error('Error fetching transfer window summary:', error);
    res.status(500).json({ error: 'Failed to fetch transfer window summary' });
  }
}
