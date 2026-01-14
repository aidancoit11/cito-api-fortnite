import { Request, Response } from 'express';
import { lolTournamentService } from '../services/lol/lol-tournament.service.js';

export async function getAllTournaments(_req: Request, res: Response): Promise<void> {
  try {
    const tournaments = await lolTournamentService.getAllTournaments();
    res.json(tournaments);
  } catch (error) {
    console.error('Error fetching all tournaments:', error);
    res.status(500).json({ error: 'Failed to fetch tournaments' });
  }
}

export async function getTournamentById(req: Request, res: Response): Promise<void> {
  try {
    const { tournamentId } = req.params;
    const tournament = await lolTournamentService.getTournamentById(tournamentId as string);
    if (!tournament) {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }
    res.json(tournament);
  } catch (error) {
    console.error('Error fetching tournament by ID:', error);
    res.status(500).json({ error: 'Failed to fetch tournament' });
  }
}

export async function getTournamentStandings(req: Request, res: Response): Promise<void> {
  try {
    const { tournamentId } = req.params;
    const standings = await lolTournamentService.getTournamentStandings(tournamentId as string);
    if (!standings) {
      res.status(404).json({ error: 'Tournament standings not found' });
      return;
    }
    res.json(standings);
  } catch (error) {
    console.error('Error fetching tournament standings:', error);
    res.status(500).json({ error: 'Failed to fetch tournament standings' });
  }
}

export async function getTournamentBracket(req: Request, res: Response): Promise<void> {
  try {
    const { tournamentId } = req.params;
    const bracket = await lolTournamentService.getTournamentBracket(tournamentId as string);
    if (!bracket) {
      res.status(404).json({ error: 'Tournament bracket not found' });
      return;
    }
    res.json(bracket);
  } catch (error) {
    console.error('Error fetching tournament bracket:', error);
    res.status(500).json({ error: 'Failed to fetch tournament bracket' });
  }
}

export async function getTournamentMatches(req: Request, res: Response): Promise<void> {
  try {
    const { tournamentId } = req.params;
    const matches = await lolTournamentService.getTournamentMatches(tournamentId as string);
    if (!matches) {
      res.status(404).json({ error: 'Tournament matches not found' });
      return;
    }
    res.json(matches);
  } catch (error) {
    console.error('Error fetching tournament matches:', error);
    res.status(500).json({ error: 'Failed to fetch tournament matches' });
  }
}

export async function getTournamentResults(req: Request, res: Response): Promise<void> {
  try {
    const { tournamentId } = req.params;
    const results = await lolTournamentService.getTournamentResults(tournamentId as string);
    if (!results) {
      res.status(404).json({ error: 'Tournament results not found' });
      return;
    }
    res.json(results);
  } catch (error) {
    console.error('Error fetching tournament results:', error);
    res.status(500).json({ error: 'Failed to fetch tournament results' });
  }
}

export async function getTournamentStats(req: Request, res: Response): Promise<void> {
  try {
    const { tournamentId } = req.params;
    const stats = await lolTournamentService.getTournamentStats(tournamentId as string);
    if (!stats) {
      res.status(404).json({ error: 'Tournament stats not found' });
      return;
    }
    res.json(stats);
  } catch (error) {
    console.error('Error fetching tournament stats:', error);
    res.status(500).json({ error: 'Failed to fetch tournament stats' });
  }
}

export async function getTournamentMVP(req: Request, res: Response): Promise<void> {
  try {
    const { tournamentId } = req.params;
    const mvp = await lolTournamentService.getTournamentMVP(tournamentId as string);
    if (!mvp) {
      res.status(404).json({ error: 'Tournament MVP not found' });
      return;
    }
    res.json(mvp);
  } catch (error) {
    console.error('Error fetching tournament MVP:', error);
    res.status(500).json({ error: 'Failed to fetch tournament MVP' });
  }
}
